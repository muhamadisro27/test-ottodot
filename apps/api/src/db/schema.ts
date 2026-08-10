import { bigint, index, integer, pgTable, serial, text, uniqueIndex } from 'drizzle-orm/pg-core';
import { relations, sql } from 'drizzle-orm';

export const parents = pgTable('parents', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
});

export const students = pgTable('students', {
  id: serial('id').primaryKey(),
  parentId: integer('parent_id')
    .notNull()
    .references(() => parents.id),
  name: text('name').notNull(),
  grade: text('grade').notNull(),
});

export const trialClasses = pgTable('trial_classes', {
  id: serial('id').primaryKey(),
  subject: text('subject').notNull(),
  topic: text('topic').notNull(),
  startsAt: text('starts_at').notNull(),
  capacity: integer('capacity').notNull().default(4),
  confirmedCount: integer('confirmed_count').notNull().default(0),
});

export const bookingStatuses = ['pending_payment', 'confirmed', 'payment_failed', 'cancelled'] as const;
export type BookingStatus = (typeof bookingStatuses)[number];

export const bookings = pgTable(
  'bookings',
  {
    id: serial('id').primaryKey(),
    studentId: integer('student_id')
      .notNull()
      .references(() => students.id),
    classId: integer('class_id')
      .notNull()
      .references(() => trialClasses.id),
    status: text('status', { enum: bookingStatuses }).notNull().default('pending_payment'),
    createdAt: bigint('created_at', { mode: 'number' }).notNull(),
    updatedAt: bigint('updated_at', { mode: 'number' }).notNull(),
  },
  (table) => [
    uniqueIndex('uq_booking_confirmed_student_class')
      .on(table.studentId, table.classId)
      .where(sql`${table.status} = 'confirmed'`),
    index('idx_booking_class_status').on(table.classId, table.status),
    index('idx_booking_student').on(table.studentId),
  ],
);

export const paymentResults = ['success', 'failure'] as const;
export type PaymentResult = (typeof paymentResults)[number];

export const paymentAttempts = pgTable('payment_attempts', {
  id: serial('id').primaryKey(),
  bookingId: integer('booking_id')
    .notNull()
    .references(() => bookings.id),
  amount: integer('amount').notNull(),
  idempotencyKey: text('idempotency_key').notNull().unique(),
  result: text('result', { enum: paymentResults }).notNull(),
  reason: text('reason'),
  createdAt: bigint('created_at', { mode: 'number' }).notNull(),
});

export type Parent = typeof parents.$inferSelect;
export type Student = typeof students.$inferSelect;
export type TrialClass = typeof trialClasses.$inferSelect;
export type Booking = typeof bookings.$inferSelect;
export type PaymentAttempt = typeof paymentAttempts.$inferSelect;

export const studentsRelations = relations(students, ({ one }) => ({
  parent: one(parents, { fields: [students.parentId], references: [parents.id] }),
}));

export const bookingsRelations = relations(bookings, ({ one }) => ({
  student: one(students, { fields: [bookings.studentId], references: [students.id] }),
  trialClass: one(trialClasses, { fields: [bookings.classId], references: [trialClasses.id] }),
}));

export const paymentAttemptsRelations = relations(paymentAttempts, ({ one }) => ({
  booking: one(bookings, { fields: [paymentAttempts.bookingId], references: [bookings.id] }),
}));
