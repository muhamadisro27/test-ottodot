'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState } from 'react';
import { toast } from 'sonner';

type Student = { id: number; name: string; grade: string };
type Parent = { id: number; name: string; email?: string; students: Student[] };
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
  { value: 'random', label: 'Random (Gateway Simulation)' },
  { value: 'success', label: 'Force Success (Confirm Booking)' },
  { value: 'card_declined', label: 'Force Card Declined' },
  { value: 'insufficient_funds', label: 'Force Insufficient Funds' },
] as const;

function getSubjectBadge(subject: string) {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'MATH';
  if (s.includes('science')) return 'SCI';
  return 'ART';
}

function getSubjectClass(subject: string) {
  const s = subject.toLowerCase();
  if (s.includes('math')) return 'math';
  if (s.includes('science')) return 'science';
  return 'art';
}

export default function HomePage() {
  const [parents, setParents] = useState<Parent[]>([]);
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [parentId, setParentId] = useState<number | ''>('');
  const [studentId, setStudentId] = useState<number | ''>('');
  const [classId, setClassId] = useState<number | ''>('');
  const [forceResult, setForceResult] = useState<string>('random');
  const [bookingId, setBookingId] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      const [p, c] = await Promise.all([
        fetch('/api/parents').then((r) => r.json()),
        fetch('/api/classes').then((r) => r.json()),
      ]);
      setParents(p.parents ?? []);
      setClasses(c.classes ?? []);
    } catch (e) {
      toast.error('Unable to load classes', { description: 'Please refresh the page.' });
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const selectedParent = parents.find((p) => p.id === parentId);
  const selectedStudent = selectedParent?.students.find((s) => s.id === studentId);

  // Stepper calculations
  const step1Done = Boolean(studentId);
  const step3Active = Boolean(bookingId);

  async function createBooking() {
    setBusy(true);
    try {
      const res = await fetch('/api/bookings', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ studentId, classId }),
      });
      const body = await res.json();

      if (!res.ok) {
        const message = body.error?.message ?? 'Could not create booking.';
        const code = body.error?.code;

        if (code === 'DUPLICATE_BOOKING') {
          toast.warning('Already Registered', {
            description: 'This child already has an active booking for this class.',
          });
        } else if (code === 'CLASS_FULL') {
          toast.error('Class Full', {
            description: 'Sorry, all spots in this class have been filled.',
          });
        } else {
          toast.error('Unable to Reserve Spot', {
            description: message,
          });
        }
        return;
      }

      setBookingId(body.booking.id);
      toast.success('Spot Reserved!', {
        description: 'Please complete your payment below to confirm your spot.',
      });
      await load();
    } catch (e) {
      toast.error('Network Error', { description: 'Unable to connect to server. Please try again.' });
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
        toast.error('Payment Error', {
          description: body.error?.message ?? 'Unable to process payment.',
        });
        return;
      }

      const isConfirmed = body.bookingStatus === 'confirmed';
      if (isConfirmed) {
        toast.success('Payment Successful!', {
          description: `Class spot is now confirmed for ${selectedStudent?.name ?? 'your child'}.`,
        });
      } else {
        let failureDetail = 'Your payment could not be completed.';
        if (body.reason === 'card_declined') {
          failureDetail = 'Your card was declined by the bank.';
        } else if (body.reason === 'insufficient_funds') {
          failureDetail = 'Insufficient funds in the selected account.';
        } else if (body.reason === 'network_error') {
          failureDetail = 'A network error occurred with the payment gateway.';
        } else if (body.reason === 'seat_unavailable') {
          failureDetail = 'The last seat was taken by another user before payment finished.';
        }
        toast.error('Payment Unsuccessful', {
          description: failureDetail,
        });
      }
      await load();
    } catch (e) {
      toast.error('Network Error', { description: 'Unable to connect to payment server.' });
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <header>
        <Link href="/" className="logo-group">
          <div className="logo-badge" style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>O</div>
          <h1>Ottodot</h1>
        </Link>
        <Link href="/roster" className="nav-link">
          Teacher Roster →
        </Link>
      </header>

      <main>
        <section className="hero">
          <div className="hero-pill">Live Online Science & Math Classes</div>
          <h2>Book a Trial Class</h2>
          <p>Small interactive classes capped at 4 students for personal attention.</p>
        </section>

        {/* Stepper Progress */}
        <div className="stepper">
          <div className={`step-item ${step1Done ? 'completed' : 'active'}`}>
            <div className="step-number">{step1Done ? '✓' : '1'}</div>
            <div className="step-label">1. Child Info</div>
          </div>
          <div className={`step-item ${step1Done && !step3Active ? 'active' : step3Active ? 'completed' : ''}`}>
            <div className="step-number">{step3Active ? '✓' : '2'}</div>
            <div className="step-label">2. Select Class</div>
          </div>
          <div className={`step-item ${step3Active ? 'active' : ''}`}>
            <div className="step-number">3</div>
            <div className="step-label">3. Confirm & Pay</div>
          </div>
        </div>

        <div className="card">
          <h3 className="card-title">
            <span>Step 1: Select Parent & Child</span>
          </h3>

          <div className="form-grid">
            <div className="field-group">
              <label>Parent Profile</label>
              <select
                value={parentId}
                onChange={(e) => {
                  setParentId(Number(e.target.value));
                  setStudentId('');
                  setBookingId(null);
                }}
              >
                <option value="">Choose parent profile…</option>
                {parents.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}{p.email ? ` (${p.email})` : ''}
                  </option>
                ))}
              </select>
            </div>

            <div className="field-group">
              <label>Child Student</label>
              <select
                value={studentId}
                onChange={(e) => {
                  setStudentId(Number(e.target.value));
                  setBookingId(null);
                }}
                disabled={!selectedParent}
              >
                <option value="">Choose child…</option>
                {selectedParent?.students.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} (Grade {s.grade})
                  </option>
                ))}
              </select>
            </div>
          </div>

          <h3 className="card-title" style={{ marginTop: 28 }}>
            <span>Step 2: Choose Available Trial Class</span>
          </h3>

          <div className="classes-grid">
            {classes.map((c) => {
              const full = c.availableSeats <= 0;
              const isSelected = classId === c.id;
              const badgeText = getSubjectBadge(c.subject);
              const subjectClass = getSubjectClass(c.subject);
              const fillPercentage = (c.confirmedCount / c.capacity) * 100;

              return (
                <div
                  key={c.id}
                  className={`class-card ${isSelected ? 'selected' : ''} ${full ? 'full' : ''}`}
                  onClick={() => {
                    if (!full) {
                      setClassId(c.id);
                      setBookingId(null);
                    }
                  }}
                >
                  <div className="class-info">
                    <div className={`subject-icon ${subjectClass}`} style={{ fontSize: 13, fontWeight: 800, color: '#334155' }}>
                      {badgeText}
                    </div>
                    <div className="class-details">
                      <h4>
                        {c.subject}: {c.topic}
                      </h4>
                      <div className="time">
                        {new Date(c.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                      </div>
                    </div>
                  </div>

                  <div className="seat-status">
                    {full ? (
                      <span className="badge bad">Class Full</span>
                    ) : c.availableSeats === 1 ? (
                      <span className="badge warn">1 seat left</span>
                    ) : (
                      <span className="badge ok">{c.availableSeats} seats open</span>
                    )}

                    <div className="capacity-bar">
                      <div
                        className={`capacity-fill ${full ? 'full' : c.availableSeats === 1 ? 'warn' : ''}`}
                        style={{ width: `${fillPercentage}%` }}
                      />
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {bookingId === null ? (
            <button className="btn-primary" onClick={createBooking} disabled={!studentId || !classId || busy}>
              {busy ? 'Reserving Spot...' : 'Reserve Trial Spot ($50.00)'}
            </button>
          ) : (
            <div className="payment-box">
              <h3>
                <span>Step 3: Confirm Payment for Booking #{bookingId}</span>
              </h3>
              <p className="muted" style={{ marginTop: 0, marginBottom: 12 }}>
                Mock payment simulator — choose a gateway outcome to test business logic:
              </p>

              <div className="field-group">
                <label>Gateway Result Override</label>
                <select value={forceResult} onChange={(e) => setForceResult(e.target.value)}>
                  {FORCE_OPTIONS.map((o) => (
                    <option key={o.value} value={o.value}>
                      {o.label}
                    </option>
                  ))}
                </select>
              </div>

              <button className="btn-primary" onClick={pay} disabled={busy} style={{ marginTop: 16 }}>
                {busy ? 'Processing Payment...' : `Pay $50.00 Now (Booking #${bookingId})`}
              </button>
            </div>
          )}
        </div>
      </main>
    </>
  );
}
