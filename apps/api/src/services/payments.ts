import { and, eq, lt, sql } from 'drizzle-orm';
import type { DB } from '../db/client.js';
import { bookings, paymentAttempts, trialClasses } from '../db/schema.js';
import type { BookingStatus } from '../db/schema.js';
import { AppError, DuplicateBookingError, isUniqueConstraintError, SeatUnavailableError } from '../errors.js';
import { getBooking, TRIAL_PRICE_CENTS } from './bookings.js';

export type PaymentOutcome = {
  result: 'success' | 'failure';
  reason?: string | null;
  bookingStatus: BookingStatus;
  replay?: boolean;
};

export type ForceResult = 'success' | 'card_declined' | 'insufficient_funds' | 'network_error' | 'random';

const FAILURE_REASONS = ['card_declined', 'insufficient_funds', 'network_error'] as const;
type FailureReason = (typeof FAILURE_REASONS)[number];

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function resolveOutcome(force?: ForceResult): 'success' | FailureReason {
  if (force !== undefined && force !== 'random') {
    return force;
  }
  const outcomes: ('success' | FailureReason)[] = [
    'success',
    'success',
    'success',
    'success',
    'card_declined',
    'insufficient_funds',
    'network_error',
  ];
  return outcomes[Math.floor(Math.random() * outcomes.length)] ?? 'success';
}

async function findAttempt(db: DB, idempotencyKey: string) {
  const rows = await db
    .select()
    .from(paymentAttempts)
    .where(eq(paymentAttempts.idempotencyKey, idempotencyKey))
    .limit(1);
  return rows[0];
}

export async function processPayment(
  db: DB,
  {
    bookingId,
    idempotencyKey,
    forceResult,
    paymentDelayMs = 0,
  }: {
    bookingId: number;
    idempotencyKey: string;
    forceResult?: ForceResult;
    paymentDelayMs?: number;
  },
): Promise<PaymentOutcome> {
  const existingAttempt = await findAttempt(db, idempotencyKey);
  if (existingAttempt) {
    const booking = await getBooking(db, bookingId);
    return {
      replay: true,
      result: existingAttempt.result,
      reason: existingAttempt.reason,
      bookingStatus: booking?.status ?? 'payment_failed',
    };
  }

  const booking = await getBooking(db, bookingId);
  if (!booking) {
    throw new AppError(404, 'Booking not found', 'BOOKING_NOT_FOUND');
  }
  if (booking.status === 'confirmed') {
    return { replay: true, result: 'success', reason: null, bookingStatus: 'confirmed' };
  }
  if (booking.status !== 'pending_payment') {
    throw new AppError(
      409,
      `Booking is already ${booking.status}; create a new booking to retry`,
      'BOOKING_NOT_PAYABLE',
    );
  }

  // Simulate the payment gateway round-trip. The delay lets concurrent requests interleave,
  // which is what makes the last-seat race test meaningful.
  if (paymentDelayMs > 0) {
    await sleep(paymentDelayMs);
  }
  const outcome = resolveOutcome(forceResult);
  const gatewayResult = outcome === 'success' ? 'success' : 'failure';
  const t = Date.now();

  try {
    await db.insert(paymentAttempts).values({
      bookingId: booking.id,
      amount: TRIAL_PRICE_CENTS,
      idempotencyKey,
      result: gatewayResult,
      reason: outcome === 'success' ? null : outcome,
      createdAt: t,
    });
  } catch (err) {
    // Concurrent request with the same idempotency key: replay the stored outcome.
    if (isUniqueConstraintError(err)) {
      const attempt = await findAttempt(db, idempotencyKey);
      if (attempt) {
        const current = await getBooking(db, bookingId);
        return {
          replay: true,
          result: attempt.result,
          reason: attempt.reason,
          bookingStatus: current?.status ?? 'payment_failed',
        };
      }
    }
    throw err;
  }

  if (gatewayResult === 'failure') {
    await db.update(bookings).set({ status: 'payment_failed', updatedAt: Date.now() }).where(eq(bookings.id, booking.id));
    return { result: 'failure', reason: outcome, bookingStatus: 'payment_failed' };
  }

  // Seat grab + confirm happen atomically in a single write transaction.
  // The conditional UPDATE is the source of truth for the capacity invariant:
  // it only increments confirmed_count while confirmed_count < capacity.
  try {
    await db.transaction(async (tx) => {
      const grabbed = await tx
        .update(trialClasses)
        .set({ confirmedCount: sql`${trialClasses.confirmedCount} + 1` })
        .where(and(eq(trialClasses.id, booking.classId), lt(trialClasses.confirmedCount, trialClasses.capacity)))
        .returning({ id: trialClasses.id });

      if (grabbed.length === 0) {
        throw new SeatUnavailableError();
      }

      await tx
        .update(bookings)
        .set({ status: 'confirmed', updatedAt: Date.now() })
        .where(eq(bookings.id, booking.id));
    });
    return { result: 'success', reason: null, bookingStatus: 'confirmed' };
  } catch (err) {
    if (err instanceof SeatUnavailableError) {
      await db
        .update(bookings)
        .set({ status: 'payment_failed', updatedAt: Date.now() })
        .where(eq(bookings.id, booking.id));
      return { result: 'success', reason: 'seat_unavailable', bookingStatus: 'payment_failed' };
    }
    if (isUniqueConstraintError(err)) {
      throw new DuplicateBookingError();
    }
    throw err;
  }
}
