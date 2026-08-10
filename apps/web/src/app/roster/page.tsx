'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { toast } from 'sonner';

type TrialClass = {
  id: number;
  subject: string;
  topic: string;
  startsAt: string;
  capacity: number;
  confirmedCount: number;
  availableSeats: number;
};

type RosterEntry = { bookingId: number; studentId: number; studentName: string; grade: string };

function getInitials(name: string) {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .substring(0, 2)
    .toUpperCase();
}

export default function RosterPage() {
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [classId, setClassId] = useState<number | ''>('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [capacity, setCapacity] = useState(0);

  useEffect(() => {
    fetch('/api/classes')
      .then((r) => r.json())
      .then((d) => setClasses(d.classes ?? []))
      .catch((e) => toast.error('Failed to load classes', { description: String(e) }));
  }, []);

  useEffect(() => {
    if (classId === '') return;
    fetch(`/api/classes/${classId}/roster`)
      .then((r) => r.json())
      .then((d) => {
        setRoster(d.confirmed ?? []);
        setCapacity(d.capacity ?? 4);
      })
      .catch((e) => toast.error('Failed to load roster', { description: String(e) }));
  }, [classId]);

  const selected = classes.find((c) => c.id === classId);

  return (
    <>
      <header>
        <Link href="/" className="logo-group">
          <div className="logo-badge" style={{ fontSize: 14, fontWeight: 800, color: 'white' }}>O</div>
          <h1>Ottodot Roster</h1>
        </Link>
        <Link href="/" className="nav-link">
          ← Parent Booking
        </Link>
      </header>

      <main>
        <section className="hero">
          <div className="hero-pill">Teacher Dashboard</div>
          <h2>Class Roster Overview</h2>
          <p>View confirmed student enrollments for upcoming trial sessions.</p>
        </section>

        <div className="card">
          <h3 className="card-title">
            <span>Select Class Roster</span>
          </h3>

          <div className="field-group">
            <select value={classId} onChange={(e) => setClassId(Number(e.target.value))}>
              <option value="">Choose a trial class…</option>
              {classes.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.subject}: {c.topic} — {c.confirmedCount}/{c.capacity} Confirmed
                </option>
              ))}
            </select>
          </div>
        </div>

        {selected && (
          <div className="card">
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', flexWrap: 'wrap', gap: 12 }}>
              <div>
                <h3 className="card-title" style={{ marginBottom: 4 }}>
                  <span>{selected.subject}: {selected.topic}</span>
                </h3>
                <div className="muted">
                  {new Date(selected.startsAt).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })}
                </div>
              </div>

              <span className={`badge ${roster.length >= capacity ? 'bad' : roster.length > 0 ? 'ok' : 'warn'}`}>
                {roster.length}/{capacity} Confirmed Enrolled
              </span>
            </div>

            {roster.length === 0 ? (
              <div style={{ textAlign: 'center', padding: '32px 16px' }}>
                <h4 style={{ margin: 0, color: '#334155' }}>No confirmed students yet</h4>
                <p className="muted" style={{ marginTop: 4 }}>Students will appear here once their payment is confirmed.</p>
              </div>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Student Name</th>
                    <th>Grade</th>
                    <th>Booking ID</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.bookingId}>
                      <td>
                        <div className="avatar-chip">
                          <div className="avatar-circle">{getInitials(r.studentName)}</div>
                          <span>{r.studentName}</span>
                        </div>
                      </td>
                      <td>
                        <span className="badge ok">Grade {r.grade}</span>
                      </td>
                      <td>
                        <code style={{ background: '#f1f5f9', padding: '4px 8px', borderRadius: 6, fontSize: 13 }}>
                          #{r.bookingId}
                        </code>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}
      </main>
    </>
  );
}
