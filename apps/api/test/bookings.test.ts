import { describe, expect, it } from 'vitest';
import request from 'supertest';
import { buildApp } from '../src/app';
import { bookings, trialClasses } from '../src/db/schema';
import { and, eq } from 'drizzle-orm';
import { seedBase, setupDb, type BaseFixture } from './helpers';
import type { DB } from '../src/db/client';

async function fixture(): Promise<{ db: DB; data: BaseFixture; app: ReturnType<typeof buildApp> }> {
  const db = await setupDb();
  const data = await seedBase(db);
  return { db, data, app: buildApp(db) };
}

async function confirmedCount(db: DB, classId: number): Promise<number> {
  const rows = await db
    .select()
    .from(bookings)
    .where(and(eq(bookings.classId, classId), eq(bookings.status, 'confirmed')));
  return rows.length;
}

describe('create booking', () => {
  it('creates a pending_payment booking for an available class', async () => {
    const { db, data, app } = await fixture();
    const res = await request(app).post('/api/bookings').send({ studentId: data.kids[3], classId: data.openClassId });

    expect(res.status).toBe(201);
    expect(res.body.booking.status).toBe('pending_payment');
    const rows = await db.select().from(trialClasses).where(eq(trialClasses.id, data.openClassId)).limit(1);
    expect(rows[0]?.confirmedCount).toBe(0);
  });

  it('rejects a duplicate booking for the same child and class', async () => {
    const { data, app } = await fixture();
    // Kid A is already confirmed in the "last seat" class
    const res = await request(app)
      .post('/api/bookings')
      .send({ studentId: data.kids[0], classId: data.lastSeatClassId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('DUPLICATE_BOOKING');
  });

  it('rejects booking when the class is already full', async () => {
    const { data, app } = await fixture();
    const res = await request(app).post('/api/bookings').send({ studentId: data.kids[3], classId: data.fullClassId });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CLASS_FULL');
  });

  it('rejects unknown student or class', async () => {
    const { data, app } = await fixture();
    const res1 = await request(app).post('/api/bookings').send({ studentId: 9999, classId: data.openClassId });
    const res2 = await request(app).post('/api/bookings').send({ studentId: data.kids[3], classId: 9999 });

    expect(res1.status).toBe(404);
    expect(res2.status).toBe(404);
  });
});

describe('roster', () => {
  it('shows only confirmed students for a class', async () => {
    const { db, data, app } = await fixture();
    const res = await request(app).get(`/api/classes/${data.lastSeatClassId}/roster`);

    expect(res.status).toBe(200);
    expect(res.body.confirmedCount).toBe(3);
    expect(res.body.confirmed).toHaveLength(3);
    expect(res.body.confirmed.map((c: { studentName: string }) => c.studentName)).toEqual([
      'Kid A',
      'Kid B',
      'Kid C',
    ]);
    expect(await confirmedCount(db, data.lastSeatClassId)).toBe(3);
  });
});
