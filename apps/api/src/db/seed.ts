import 'dotenv/config';

import { sql } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { createDb, DEFAULT_DATABASE_URL } from './client.js';
import { bookings, parents, paymentAttempts, students, trialClasses } from './schema.js';

function now(): number {
  return Date.now();
}

function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

export async function seedDatabase(db: ReturnType<typeof createDb>): Promise<void> {
  await db.execute(
    sql`TRUNCATE payment_attempts, bookings, students, trial_classes, parents RESTART IDENTITY CASCADE`,
  );

  const [alice] = await db.insert(parents).values({ name: 'Alice Parent', email: 'alice@example.com' }).returning();
  const [bob] = await db.insert(parents).values({ name: 'Bob Parent', email: 'bob@example.com' }).returning();

  const [leo, maya, zara] = await db
    .insert(students)
    .values([
      { parentId: alice.id, name: 'Leo', grade: '5' },
      { parentId: alice.id, name: 'Maya', grade: '4' },
      { parentId: alice.id, name: 'Zara', grade: '4' },
    ])
    .returning();
  const [noah] = await db.insert(students).values({ parentId: bob.id, name: 'Noah', grade: '6' }).returning();

  // Class A: fully available (0 confirmed, 4 seats). Maya has a pending booking, Zara already hit a payment failure here.
  const [mathFractions] = await db
    .insert(trialClasses)
    .values({
      subject: 'Math',
      topic: 'Fractions with Pizza',
      startsAt: iso(2),
      capacity: 4,
      confirmedCount: 0,
    })
    .returning();

  // Class B: exactly 3 confirmed -> exactly one seat left (last-seat race demo).
  const [scienceVolcano] = await db
    .insert(trialClasses)
    .values({
      subject: 'Science',
      topic: 'Volcano Eruption',
      startsAt: iso(3),
      capacity: 4,
      confirmedCount: 3,
    })
    .returning();

  // Class C: available (0 confirmed).
  const [mathShapes] = await db
    .insert(trialClasses)
    .values({
      subject: 'Math',
      topic: 'Shapes in Art',
      startsAt: iso(5),
      capacity: 4,
      confirmedCount: 0,
    })
    .returning();

  const t = now();
  await db.insert(bookings).values([
    // Class B: three confirmed students -> one seat left.
    { studentId: leo.id, classId: scienceVolcano.id, status: 'confirmed', createdAt: t, updatedAt: t },
    { studentId: maya.id, classId: scienceVolcano.id, status: 'confirmed', createdAt: t, updatedAt: t },
    { studentId: noah.id, classId: scienceVolcano.id, status: 'confirmed', createdAt: t, updatedAt: t },
    // Class A: in-progress booking (does not consume a seat).
    { studentId: maya.id, classId: mathFractions.id, status: 'pending_payment', createdAt: t, updatedAt: t },
    // Class A: payment failure case - Zara's card was declined; seat was NOT consumed.
    { studentId: zara.id, classId: mathFractions.id, status: 'payment_failed', createdAt: t, updatedAt: t },
    // Class C: clean booking for demo.
    { studentId: zara.id, classId: mathShapes.id, status: 'pending_payment', createdAt: t, updatedAt: t },
  ]);

  await db.insert(parents).values({ name: 'Anna Teacher', email: 'anna@ottodot.com' });
}

async function main(): Promise<void> {
  const db = createDb();
  await migrate(db, { migrationsFolder: './drizzle' });
  await seedDatabase(db);
  console.log(`Seeded ${process.env.DATABASE_URL ?? DEFAULT_DATABASE_URL}`);
  await db.$client.end();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
