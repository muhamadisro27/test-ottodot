import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { bookings, paymentAttempts, trialClasses } from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { seedBase, setupDb, type BaseFixture } from './helpers';
import type { DB } from '../src/db/client';

async function fixture(): Promise<{ db: DB; data: BaseFixture; app: ReturnType<typeof buildApp> }> {
  const db = await setupDb();
  const data = await seedBase(db);
  return { db, data, app: buildApp(db) };
}

async function createPending(
  app: ReturnType<typeof buildApp>,
  studentId: number,
  classId: number,
): Promise<number> {
  const res = await request(app).post('/api/bookings').send({ studentId, classId });
  expect(res.status).toBe(201);
  return res.body.booking.id;
}

async function confirmedCount(db: DB, classId: number): Promise<number> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, 'confirmed')));
  return rows.length;
}

describe('payment failure', () => {
  it('does not add the child to the roster and does not consume a seat', async () => {
    const { db, data, app } = await fixture();
    // Kid D takes the last seat in the "last seat" class, then their card is declined.
    const bookingId = await createPending(app, data.kids[3], data.lastSeatClassId);

    const res = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId, forceResult: 'card_declined', idempotencyKey: 'declined-1' });

    expect(res.status).toBe(200);
    expect(res.body.result).toBe('failure');
    expect(res.body.bookingStatus).toBe('payment_failed');

    const rows = await db.select().from(trialClasses).where(eq(trialClasses.id, data.lastSeatClassId)).limit(1);
    expect(rows[0]?.confirmedCount).toBe(3);
    expect(await confirmedCount(db, data.lastSeatClassId)).toBe(3);

    const roster = await request(app).get(`/api/classes/${data.lastSeatClassId}/roster`);
    expect(roster.body.confirmed).toHaveLength(3);
  });

  it('a parent can retry with a fresh booking after a failure, as long as a seat is available', async () => {
    const { db, data, app } = await fixture();
    const b1 = await createPending(app, data.kids[3], data.lastSeatClassId);
    await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId: b1, forceResult: 'network_error', idempotencyKey: 'net-1' });

    // Old booking is payment_failed -> a new booking for the same child+class is allowed.
    const b2 = await createPending(app, data.kids[3], data.lastSeatClassId);
    const res = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId: b2, forceResult: 'success', idempotencyKey: 'retry-1' });

    expect(res.body.bookingStatus).toBe('confirmed');
    expect(await confirmedCount(db, data.lastSeatClassId)).toBe(4);
  });
});

describe('successful payment', () => {
  it('confirms the booking and consumes exactly one seat', async () => {
    const { db, data, app } = await fixture();
    const bookingId = await createPending(app, data.kids[3], data.openClassId);

    const res = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId, forceResult: 'success', idempotencyKey: 'ok-1' });

    expect(res.body.bookingStatus).toBe('confirmed');
    const rows = await db.select().from(trialClasses).where(eq(trialClasses.id, data.openClassId)).limit(1);
    expect(rows[0]?.confirmedCount).toBe(1);
  });

  it('is idempotent: the same idempotency key is not processed twice', async () => {
    const { db, data, app } = await fixture();
    const bookingId = await createPending(app, data.kids[3], data.openClassId);

    const r1 = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId, idempotencyKey: 'same-key', forceResult: 'success' });
    const r2 = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId, idempotencyKey: 'same-key', forceResult: 'card_declined' });

    expect(r1.body.bookingStatus).toBe('confirmed');
    expect(r2.body.replay).toBe(true);
    expect(r2.body.bookingStatus).toBe('confirmed');
    const attempts = await db
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.idempotencyKey, 'same-key'));
    expect(attempts).toHaveLength(1);
    expect(await confirmedCount(db, data.openClassId)).toBe(1);
  });

  it('rejects payment for a booking that already failed', async () => {
    const { data, app } = await fixture();
    const bookingId = await createPending(app, data.kids[3], data.openClassId);
    await request(app).post('/api/payments/attempt').send({ bookingId, forceResult: 'card_declined' });

    const res = await request(app)
      .post('/api/payments/attempt')
      .send({ bookingId, forceResult: 'success', idempotencyKey: 'new-key' });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('BOOKING_NOT_PAYABLE');
  });
});

describe('duplicate confirmed at the database level', () => {
  it('the partial unique index prevents two confirmed bookings for the same child and class', async () => {
    const { db, data, app } = await fixture();
    // Bypass the app-level guard: create two pending bookings directly for the same kid+class.
    const t = Date.now();
    const b = await db
      .insert(bookings)
      .values([
        {
          studentId: data.kids[3],
          classId: data.openClassId,
          status: 'pending_payment',
          createdAt: t,
          updatedAt: t,
        },
        {
          studentId: data.kids[3],
          classId: data.openClassId,
          status: 'pending_payment',
          createdAt: t,
          updatedAt: t,
        },
      ])
      .returning();
    const [b1, b2] = b;

    const r1 = await request(app).post('/api/payments/attempt').send({ bookingId: b1.id, forceResult: 'success' });
    const r2 = await request(app).post('/api/payments/attempt').send({ bookingId: b2.id, forceResult: 'success' });

    expect(r1.body.bookingStatus).toBe('confirmed');
    expect(r2.status).toBe(409);
    expect(r2.body.error.code).toBe('DUPLICATE_BOOKING');

    // The failed second confirm must not have consumed a seat (transaction rolled back).
    const rows = await db.select().from(trialClasses).where(eq(trialClasses.id, data.openClassId)).limit(1);
    expect(rows[0]?.confirmedCount).toBe(1);
    expect(await confirmedCount(db, data.openClassId)).toBe(1);
  });
});
