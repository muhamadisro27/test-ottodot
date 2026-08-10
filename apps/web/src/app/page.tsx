'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';

type Student = { id: number; name: string; grade: string };
type Parent = { id: number; name: string; students: Student[] };
type TrialClass = {
  id: number;
  subject: string;
  topic: string;
  startsAt: string;
  capacity: number;
  confirmedCount: number;
  availableSeats: number;
};

const FORCE_OPTIONS = [
  { value: 'random', label: 'Random (as a real gateway would)' },
  { value: 'success', label: 'Force success' },
  { value: 'card_declined', label: 'Force card declined' },
  { value: 'insufficient_funds', label: 'Force insufficient funds' },
] as const;

export default function HomePage() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [parentId, setParentId] = useState<number | ''>('');
  const [studentId, setStudentId] = useState<number | ''>('');
  const [classId, setClassId] = useState<number | ''>('');
  const [forceResult, setForceResult] = useState<string>('random');
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ text: string; tone: 'neutral' | 'confirmed' | 'payment_failed' | 'error' } | null>(null);

  const load = useCallback(async () => {
    const [p, c] = await Promise.all([
      fetch('/api/parents').then((r) => r.json()),
      fetch('/api/classes').then((r) => r.json()),
    ]);
    setParents(p.parents);
    setClasses(c.classes);
  }, []);

  useEffect(() => {
    load().catch((e) => setStatus({ text: `Failed to load data: ${String(e)}`, tone: 'error' }));
  }, [load]);

  const selectedParent = parents.find((p) => p.id === parentId);
  const selectedClass = classes.find((c) => c.id === classId);

  async function createBooking() {
    setBusy(true);
    setStatus(null);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, classId }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ text: `${body.error?.code}: ${body.error?.message}`, tone: 'error' });
        return;
      }
      setBookingId(body.booking.id);
      setStatus({ text: `Booking #${body.booking.id} created. Status: ${body.booking.status}`, tone: 'neutral' });
      await load();
    } catch (e) {
      setStatus({ text: `Error: ${String(e)}`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  async function pay() {
    if (bookingId === null) return;
    setBusy(true);
    try {
      const res = await fetch('/api/payments/attempt', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          bookingId,
          forceResult,
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      const body = await res.json();
      if (!res.ok) {
        setStatus({ text: `${body.error?.code}: ${body.error?.message}`, tone: 'error' });
        return;
      }
      const tone = body.bookingStatus === 'confirmed' ? 'confirmed' : 'payment_failed';
      setStatus({
        text: `Payment ${body.result}. Booking status: ${body.bookingStatus}${body.reason ? ` (${body.reason})` : ''}\nidempotencyKey: ${body.idempotencyKey}`,
        tone,
      });
      await load();
    } catch (e) {
      setStatus({ text: `Error: ${String(e)}`, tone: 'error' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <h1>Ottodot Trial Booking</h1>
        <Link href="/roster">Teacher roster</Link>
      </header>
      <main>
        <div className="card">
          <h2>Book a trial class</h2>

          <label>Parent</label>
          <select value={parentId} onChange={(e) => { setParentId(Number(e.target.value)); setStudentId(''); }}>
            <option value="">Select parent…</option>
            {parents.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>

          <label>Child</label>
          <select value={studentId} onChange={(e) => setStudentId(Number(e.target.value))} disabled={!selectedParent}>
            <option value="">Select child…</option>
            {selectedParent?.students.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name} (grade {s.grade})
              </option>
            ))}
          </select>

          <label>Trial class</label>
          <ul className="classes">
            {classes.map((c) => {
              const full = c.availableSeats <= 0;
              return (
                <li
                  key={c.id}
                  className={`${classId === c.id ? 'selected' : ''} ${full ? 'full' : ''}`}
                  onClick={() => !full && setClassId(c.id)}
                >
                  <span>
                    <strong>
                      {c.subject} · {c.topic}
                    </strong>
                    <br />
                    <span className="muted">{new Date(c.startsAt).toLocaleString()}</span>
                  </span>
                  {full ? (
                    <span className="badge bad">Full</span>
                  ) : c.availableSeats === 1 ? (
                    <span className="badge warn">1 seat left</span>
                  ) : (
                    <span className="badge ok">{c.availableSeats} seats</span>
                  )}
                </li>
              );
            })}
          </ul>

          <button onClick={createBooking} disabled={!studentId || !classId || busy}>
            Create booking
          </button>

          {bookingId !== null && (
            <>
              <label>Mock payment outcome</label>
              <select value={forceResult} onChange={(e) => setForceResult(e.target.value)}>
                {FORCE_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
              <button onClick={pay} disabled={busy}>
                Pay $50.00 for booking #{bookingId}
              </button>
            </>
          )}

          {status && <div className={`status-line ${status.tone}`}>{status.text}</div>}
        </div>
      </main>
    </>
  );
}
