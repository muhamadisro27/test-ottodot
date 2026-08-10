import { sql } from 'drizzle-orm';
import { createDb, type DB } from '../src/db/client';
import { bookings, parents, students, trialClasses } from '../src/db/schema';

export const TEST_DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgres://ottodot:ottodot@localhost:5432/ottodot_test';

export async function setupDb(): Promise<DB> {
  const db = createDb(TEST_DATABASE_URL);
  await db.execute(
    sql`TRUNCATE payment_attempts, bookings, students, trial_classes, parents RESTART IDENTITY CASCADE`,
  );
  return db;
}

export function iso(daysFromNow: number): string {
  return new Date(Date.now() + daysFromNow * 24 * 60 * 60 * 1000).toISOString();
}

export type BaseFixture = {
  parentId: number;
  kids: number[];
  openClassId: number;
  lastSeatClassId: number;
  fullClassId: number;
};

/**
 * Seeds:
 * - 1 parent, 5 kids (Kid A..E)
 * - "open" class: capacity 4, 0 confirmed
 * - "last seat" class: capacity 4, 3 confirmed (Kid A, B, C) -> exactly one seat left
 * - "full" class: capacity 4, confirmedCount 4
 */
export async function seedBase(db: DB): Promise<BaseFixture> {
  const [parent] = await db.insert(parents).values({ name: 'Parent', email: 'parent@example.com' }).returning();
  const kids = await db
    .insert(students)
    .values([
      { parentId: parent.id, name: 'Kid A', grade: '4' },
      { parentId: parent.id, name: 'Kid B', grade: '5' },
      { parentId: parent.id, name: 'Kid C', grade: '5' },
      { parentId: parent.id, name: 'Kid D', grade: '4' },
      { parentId: parent.id, name: 'Kid E', grade: '6' },
    ])
    .returning();

  const [openClass] = await db
    .insert(trialClasses)
    .values({ subject: 'Math', topic: 'Open class', startsAt: iso(2), capacity: 4, confirmedCount: 0 })
    .returning();
  const [lastSeatClass] = await db
    .insert(trialClasses)
    .values({ subject: 'Science', topic: 'Last seat class', startsAt: iso(3), capacity: 4, confirmedCount: 3 })
    .returning();
  const [fullClass] = await db
    .insert(trialClasses)
    .values({ subject: 'Math', topic: 'Full class', startsAt: iso(4), capacity: 4, confirmedCount: 4 })
    .returning();

  const t = Date.now();
  await db.insert(bookings).values([
    { studentId: kids[0].id, classId: lastSeatClass.id, status: 'confirmed', createdAt: t, updatedAt: t },
    { studentId: kids[1].id, classId: lastSeatClass.id, status: 'confirmed', createdAt: t, updatedAt: t },
    { studentId: kids[2].id, classId: lastSeatClass.id, status: 'confirmed', createdAt: t, updatedAt: t },
  ]);

  return {
    parentId: parent.id,
    kids: kids.map((k) => k.id),
    openClassId: openClass.id,
    lastSeatClassId: lastSeatClass.id,
    fullClassId: fullClass.id,
  };
}
