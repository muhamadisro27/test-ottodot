import cors from 'cors';
import express, { type NextFunction, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import { and, eq } from 'drizzle-orm';
import type { DB } from './db/client';
import { getDb } from './db/client';
import { bookings, parents, paymentAttempts, students, trialClasses } from './db/schema';
import { AppError, isUniqueConstraintError } from './errors';
import { createBooking, getBooking } from './services/bookings';
import { processPayment, type ForceResult } from './services/payments';

const FORCE_RESULTS: ForceResult[] = ['success', 'card_declined', 'insufficient_funds', 'network_error', 'random'];

export function buildApp(database: DB = getDb()): express.Express {
  const app = express();
  app.use(cors());
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  app.get('/api/classes', async (_req, res) => {
    const classes = await database.select().from(trialClasses);
    res.json({
      classes: classes.map((c) => ({
        ...c,
        availableSeats: c.capacity - c.confirmedCount,
      })),
    });
  });

  app.get('/api/classes/:id/roster', async (req, res) => {
    const classId = Number(req.params.id);
    const rows = await database.select().from(trialClasses).where(eq(trialClasses.id, classId)).limit(1);
    const cls = rows[0];
    if (!cls) {
      throw new AppError(404, 'Class not found', 'CLASS_NOT_FOUND');
    }
    const confirmed = await database
      .select({
        bookingId: bookings.id,
        studentId: students.id,
        studentName: students.name,
        grade: students.grade,
      })
      .from(bookings)
      .innerJoin(students, eq(bookings.studentId, students.id))
      .where(and(eq(bookings.classId, classId), eq(bookings.status, 'confirmed')));

    res.json({
      class: cls,
      capacity: cls.capacity,
      confirmedCount: cls.confirmedCount,
      confirmed,
    });
  });

  app.get('/api/parents', async (_req, res) => {
    const parentRows = await database.select().from(parents);
    const rows = await database.select({ student: students, parentId: students.parentId }).from(students);
    res.json({
      parents: parentRows.map((p) => ({
        ...p,
        students: rows.filter((r) => r.parentId === p.id).map((r) => r.student),
      })),
    });
  });

  app.post('/api/bookings', async (req, res) => {
    const { studentId, classId } = req.body ?? {};
    if (!Number.isInteger(studentId) || !Number.isInteger(classId)) {
      throw new AppError(400, 'studentId and classId (integers) are required', 'INVALID_INPUT');
    }
    const booking = await createBooking(database, { studentId, classId });
    res.status(201).json({ booking });
  });

  app.get('/api/bookings/:id', async (req, res) => {
    const booking = await getBooking(database, Number(req.params.id));
    if (!booking) {
      throw new AppError(404, 'Booking not found', 'BOOKING_NOT_FOUND');
    }
    const studentRows = await database.select().from(students).where(eq(students.id, booking.studentId)).limit(1);
    const student = studentRows[0];
    const classRows = await database.select().from(trialClasses).where(eq(trialClasses.id, booking.classId)).limit(1);
    const cls = classRows[0];
    const attempts = await database
      .select()
      .from(paymentAttempts)
      .where(eq(paymentAttempts.bookingId, booking.id))
      .orderBy(paymentAttempts.createdAt);
    res.json({ booking, student, class: cls, attempts });
  });

  app.post('/api/payments/attempt', async (req, res) => {
    const { bookingId, idempotencyKey, forceResult, delayMs } = req.body ?? {};
    if (!Number.isInteger(bookingId)) {
      throw new AppError(400, 'bookingId (integer) is required', 'INVALID_INPUT');
    }
    if (forceResult !== undefined && !FORCE_RESULTS.includes(forceResult)) {
      throw new AppError(400, `forceResult must be one of: ${FORCE_RESULTS.join(', ')}`, 'INVALID_INPUT');
    }

    const key = typeof idempotencyKey === 'string' && idempotencyKey.length > 0 ? idempotencyKey : randomUUID();
    const outcome = await processPayment(database, {
      bookingId,
      idempotencyKey: key,
      forceResult,
      paymentDelayMs: Number.isFinite(delayMs) && delayMs >= 0 ? delayMs : 0,
    });
    res.json({ idempotencyKey: key, ...outcome });
  });

  app.use((err: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (err instanceof AppError) {
      return res.status(err.status).json({ error: { code: err.code, message: err.message } });
    }
    if (isUniqueConstraintError(err)) {
      return res.status(409).json({
        error: { code: 'DUPLICATE_BOOKING', message: 'This child already has a confirmed booking for this class' },
      });
    }
    console.error(err);
    return res.status(500).json({ error: { code: 'INTERNAL_ERROR', message: 'Internal server error' } });
  });

  return app;
}
