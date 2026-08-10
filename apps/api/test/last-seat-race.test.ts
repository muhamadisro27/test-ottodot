import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { and, eq } from 'drizzle-orm';
import { buildApp } from '../src/app';
import { createDb, type DB } from '../src/db/client';
import { bookings, students, trialClasses } from '../src/db/schema';
import { seedBase, setupDb, TEST_DATABASE_URL } from './helpers';

async function confirmedCount(db: DB, classId: number): Promise<number> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, 'confirmed')));
  return rows.length;
}

function randomDelay(): number {
  return Math.floor(Math.random() * 60);
}

describe('last-seat race condition', () => {
  it('exactly one user confirms the last available seat, even with concurrent payments', async () => {
    for (let iteration = 0; iteration < 5; iteration++) {
      const dbA = await setupDb();
      const data = await seedBase(dbA);
      // Second connection to the SAME database (separate pg pool) -> real row-level lock contention.
      const dbB = createDb(TEST_DATABASE_URL);

      const [kidX] = await dbA
        .insert(students)
        .values({ parentId: data.parentId, name: 'Kid X', grade: '5' })
        .returning();
      const [kidY] = await dbA
        .insert(students)
        .values({ parentId: data.parentId, name: 'Kid Y', grade: '5' })
        .returning();

      const appA = buildApp(dbA);
      const appB = buildApp(dbB);

      // User A and User B both "select" the last slot -> both get a pending booking.
      const bx = await request(appA).post('/api/bookings').send({ studentId: kidX.id, classId: data.lastSeatClassId });
      const by = await request(appB).post('/api/bookings').send({ studentId: kidY.id, classId: data.lastSeatClassId });
      expect(bx.status).toBe(201);
      expect(by.status).toBe(201);

      // Both pay at the same time; random delays make the interleaving non-deterministic.
      const [ra, rb] = await Promise.all([
        request(appA)
          .post('/api/payments/attempt')
          .send({ bookingId: bx.body.booking.id, forceResult: 'success', delayMs: randomDelay() }),
        request(appB)
          .post('/api/payments/attempt')
          .send({ bookingId: by.body.booking.id, forceResult: 'success', delayMs: randomDelay() }),
      ]);

      const outcomes = [ra.body, rb.body];
      const confirmed = outcomes.filter((o) => o.bookingStatus === 'confirmed');
      expect(confirmed).toHaveLength(1);
      expect(outcomes.filter((o) => o.bookingStatus === 'payment_failed')).toHaveLength(1);

      const loser = outcomes.find((o) => o.bookingStatus !== 'confirmed');
      expect(loser?.reason).toBe('seat_unavailable');

      // The class ended at exactly capacity, no more, no less.
      const cls = await dbA.select().from(trialClasses).where(eq(trialClasses.id, data.lastSeatClassId)).limit(1);
      expect(cls[0]?.confirmedCount).toBe(4);
      expect(await confirmedCount(dbA, data.lastSeatClassId)).toBe(4);

      await dbA.$client.end();
      await dbB.$client.end();
    }
  });

  it('never overbooks beyond capacity under a burst of concurrent payments', async () => {
    const db = await setupDb();
    const data = await seedBase(db);

    const [burstClass] = await db
      .insert(trialClasses)
      .values({ subject: 'Math', topic: 'Burst class', startsAt: new Date().toISOString(), capacity: 4, confirmedCount: 0 })
      .returning();

    const kids = await db
      .insert(students)
      .values(
        Array.from({ length: 8 }, (_, i) => ({
          parentId: data.parentId,
          name: `Burst Kid ${i}`,
          grade: '5',
        })),
      )
      .returning();

    const t = Date.now();
    const inserted = await db
      .insert(bookings)
      .values(
        kids.map((k) => ({
          studentId: k.id,
          classId: burstClass.id,
          status: 'pending_payment' as const,
          createdAt: t,
          updatedAt: t,
        })),
      )
      .returning();

    const app = buildApp(db);
    const results = await Promise.all(
      inserted.map((b) =>
        request(app)
          .post('/api/payments/attempt')
          .send({ bookingId: b.id, forceResult: 'success', delayMs: randomDelay() }),
      ),
    );

    const confirmed = results.filter((r) => r.body.bookingStatus === 'confirmed');
    const failed = results.filter((r) => r.body.bookingStatus === 'payment_failed');

    expect(confirmed).toHaveLength(4);
    expect(failed).toHaveLength(4);
    for (const r of failed) {
      expect(r.body.reason).toBe('seat_unavailable');
    }
    expect(await confirmedCount(db, burstClass.id)).toBe(4);
    const cls = await db.select().from(trialClasses).where(eq(trialClasses.id, burstClass.id)).limit(1);
    expect(cls[0]?.confirmedCount).toBe(4);

    await db.$client.end();
  });
});
