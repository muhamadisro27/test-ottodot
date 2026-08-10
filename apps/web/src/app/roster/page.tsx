'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';

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

export default function RosterPage() {
  const [classes, setClasses] = useState<TrialClass[]>([]);
  const [classId, setClassId] = useState<number | ''>('');
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  const [capacity, setCapacity] = useState(0);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    fetch('/api/classes')
      .then((r) => r.json())
      .then((d) => setClasses(d.classes))
      .catch((e) => setError(String(e)));
  }, []);

  useEffect(() => {
    if (classId === '') return;
    fetch(`/api/classes/${classId}/roster`)
      .then((r) => r.json())
      .then((d) => {
        setRoster(d.confirmed);
        setCapacity(d.capacity);
        setError(null);
      })
      .catch((e) => setError(String(e)));
  }, [classId]);

  const selected = classes.find((c) => c.id === classId);

  return (
    <>
      <header>
        <h1>Teacher Roster</h1>
        <Link href="/">Parent booking</Link>
      </header>
      <main>
        <div className="card">
          <h2>Choose a class</h2>
          <select value={classId} onChange={(e) => setClassId(Number(e.target.value))}>
            <option value="">Select class…</option>
            {classes.map((c) => (
              <option key={c.id} value={c.id}>
                {c.subject} · {c.topic} — {c.confirmedCount}/{c.capacity} confirmed
              </option>
            ))}
          </select>
        </div>

        {selected && (
          <div className="card">
            <h2>
              {selected.subject} · {selected.topic}
            </h2>
            <p className="muted">
              {new Date(selected.startsAt).toLocaleString()} — {roster.length}/{capacity} confirmed
            </p>
            {roster.length === 0 ? (
              <p className="muted">No confirmed students yet.</p>
            ) : (
              <table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Grade</th>
                    <th>Booking ID</th>
                  </tr>
                </thead>
                <tbody>
                  {roster.map((r) => (
                    <tr key={r.bookingId}>
                      <td>{r.studentName}</td>
                      <td>{r.grade}</td>
                      <td>{r.bookingId}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {error && <div className="status-line payment_failed">{error}</div>}
      </main>
    </>
  );
}
