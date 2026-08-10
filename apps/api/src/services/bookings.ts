import { and, eq, sql } from 'drizzle-orm';
import type { DB } from '../db/client';
import { bookings, students, trialClasses } from '../db/schema';
import { AppError, DuplicateBookingError } from '../errors';

export const TRIAL_PRICE_CENTS = 5000;

export async function getBooking(db: DB, bookingId: number) {
  const rows = await db.select().from(bookings).where(eq(bookings.id, bookingId)).limit(1);
  return rows[0];
}

export async function getActiveBookingForStudentAndClass(db: DB, studentId: number, classId: number) {
  const rows = await db
    .select()
    .from(bookings)
    .where(
      and(
        eq(bookings.studentId, studentId),
        eq(bookings.classId, classId),
        sql`${bookings.status} in ('pending_payment', 'confirmed')`,
      ),
    )
    .limit(1);
  return rows[0];
}

export async function createBooking(db: DB, { studentId, classId }: { studentId: number; classId: number }) {
  const studentRows = await db.select().from(students).where(eq(students.id, studentId)).limit(1);
  const student = studentRows[0];
  if (!student) {
    throw new AppError(404, 'Student not found', 'STUDENT_NOT_FOUND');
  }

  const classRows = await db.select().from(trialClasses).where(eq(trialClasses.id, classId)).limit(1);
  const cls = classRows[0];
  if (!cls) {
    throw new AppError(404, 'Class not found', 'CLASS_NOT_FOUND');
  }

  const existing = await getActiveBookingForStudentAndClass(db, studentId, classId);
  if (existing) {
    throw new DuplicateBookingError();
  }

  if (cls.confirmedCount >= cls.capacity) {
    throw new AppError(409, 'Class is full', 'CLASS_FULL');
  }

  const t = Date.now();
  const rows = await db
    .insert(bookings)
    .values({ studentId, classId, status: 'pending_payment', createdAt: t, updatedAt: t })
    .returning();
  return rows[0];
}
