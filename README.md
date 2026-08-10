# Ottodot Trial Booking — Take-Home

Trial class booking system for Ottodot (live online science/math classes for kids). **Trial booking only** (no regular enrollment). Trial classes are capped at **4 students**.

Built as a small Turborepo monorepo: an **Express 5 + Drizzle + PostgreSQL** API that owns all booking/payment correctness, and a minimal **Next.js 16** UI for the parent booking flow and the teacher roster.

> Backend correctness, edge cases, and invariants are the point of this exercise. The UI is deliberately plain.

---

## Quick Start

Requirements: Node ≥ 20, pnpm ≥ 10, Docker (for PostgreSQL).

```bash
cd app
pnpm install
pnpm db:up           # start PostgreSQL (docker compose)
pnpm db:setup        # migrate + seed a fresh PostgreSQL DB
pnpm dev             # turbo: runs API (:4000) + web (:3000) together
```

Open http://localhost:3000 (parent booking) and http://localhost:3000/roster (teacher roster).

Reset the demo data any time with `pnpm db:setup` (migrate + re-seed). Tear down Postgres with `pnpm db:down`; start over from an empty volume with `pnpm db:reset`.

### Tests & checks

```bash
pnpm db:up          # required first: tests run against the same PostgreSQL instance
pnpm test           # Vitest suite (bookings, payments, last-seat race)
pnpm typecheck
pnpm build
```

The test suite auto-creates a dedicated `ottodot_test` database and runs migrations against it during setup.

---

## What Was Built

1. **Parent booking flow** — pick a parent → child → available trial class → create booking → mock pay (random or forced outcome) → see the resulting status.
2. **Teacher roster** — pick a class → see confirmed students (only `confirmed` status counts).
3. **Payment simulation** — outcomes are random by default (`success`, `card_declined`, `insufficient_funds`, `network_error`) but can be **forced** so every edge case is demonstrable/deterministic.
4. **REST API** — all correctness logic lives behind a small, documented API.

Booking statuses: `pending_payment` → `confirmed` | `payment_failed` | `cancelled`.

---

## Backend Design

### Data model (Drizzle, PostgreSQL)

```
parents(id, name, email)
students(id, parent_id, name, grade)
trial_classes(id, subject, topic, starts_at, capacity=4, confirmed_count)
bookings(id, student_id, class_id, status, created_at, updated_at)
payment_attempts(id, booking_id, amount, idempotency_key UNIQUE, result, reason, created_at)
```

Two deliberate modeling choices:

- **`trial_classes.confirmed_count`** is a denormalized counter that enables an **atomic conditional seat grab**. It is only written inside the same transaction that confirms a booking, so it cannot drift from the `bookings` table.
- **Partial unique index** on `bookings(student_id, class_id) WHERE status = 'confirmed'` makes "no duplicate confirmed booking" a database fact, not an app-level hope.

### Key API endpoints

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/classes` | Classes + `availableSeats = capacity - confirmed_count` |
| GET | `/api/classes/:id/roster` | Confirmed students |
| GET | `/api/parents` | Parents + their students |
| POST | `/api/bookings` | `{ studentId, classId }` → `pending_payment` booking |
| POST | `/api/payments/attempt` | `{ bookingId, idempotencyKey?, forceResult?, delayMs? }` → mock pay + confirm |
| GET | `/api/bookings/:id` | Booking status + payment attempts |

### How duplicates are prevented

- **App level:** `createBooking` rejects if the child already has an active (`pending_payment` or `confirmed`) booking for that class — friendly 409.
- **DB level:** the partial unique index above rejects a second `confirmed` even if two pending bookings sneak in concurrently; the confirm transaction rolls back, so no seat is lost.

### How payment failure is handled

The gateway outcome is recorded in `payment_attempts` first. On failure the booking becomes `payment_failed` and **`confirmed_count` is never touched**. The roster only ever reads `status = 'confirmed'`, so a failed payment can never appear as a student. Retry = create a new booking (old one is no longer "active"); the seat is re-checked atomically at payment time.

### How the last-seat race is handled

The scenario: A and B both select the last slot → B pays first and confirms → A then pays.

Seats are **not** reserved at selection time. Both users hold a `pending_payment` booking, and the seat is grabbed **atomically when the payment commits**:

```sql
UPDATE trial_classes
SET    confirmed_count = confirmed_count + 1
WHERE  id = :classId AND confirmed_count < capacity
```

If the conditional UPDATE matches `0` rows, the payment succeeded at the gateway but there is no seat → the booking becomes `payment_failed` (reason `seat_unavailable`) and nothing is added to the roster. In PostgreSQL the two concurrent transactions serialize on the **row-level lock** of that `trial_classes` row; the second writer re-evaluates the `WHERE` against the updated row and matches nothing. **At most one user can end up confirmed, guaranteed by the database.**

**Why this approach:** the invariant is enforced by a single atomic statement rather than by a check-then-act sequence in application code, so it holds even under retries, multi-instance deployments, or app bugs. It also keeps the "select a class" step cheap and non-locking (no seat holds to expire).

**Tradeoffs accepted:**
- A `pending_payment` booking does **not** hold a seat, so a parent can "sit" on the last seat while someone else takes it. Good for availability, bad for conversion; see "next steps" for hold/TTL.
- Confirmed-seat count is denormalized; keeping it correct depends on every confirm going through the one transaction that owns it (which the tests assert).

### Where checks live

| Concern | Layer |
|---|---|
| Disable full classes, disable pay button, show status | UI (UX only) |
| Friendly duplicate/full errors, status transitions, idempotency | Backend service |
| Capacity invariant (atomic seat grab) | **Database** (conditional UPDATE) |
| Duplicate-confirmed invariant | **Database** (partial unique index) |
| Payment idempotency | **Database** (unique idempotency_key) |
| Stale `pending_payment` expiry / seat-hold TTL | Not in v1 → **background job** (next steps) |

---

## Seed Data

`pnpm db:setup` seeds a fresh PostgreSQL database (via `docker compose`) covering every required scenario:

- **Class 1 – Math “Fractions with Pizza”**: 0 confirmed / 4 seats (available), plus a `pending_payment` (Maya) and a `payment_failed` (Zara — card declined, **seat not consumed**).
- **Class 2 – Science “Volcano Eruption”**: **3 confirmed / 4 seats → exactly one seat left** (last-seat race demo).
- **Class 3 – Math “Shapes in Art”**: 0 confirmed / 4 seats (available).
- Parents: Alice (Leo, Maya, Zara), Bob (Noah). Teacher: Anna.

---

## Verification / Tests

13 Vitest tests across 3 files. Highlights:

- **Payment failure** → booking `payment_failed`, roster and `confirmed_count` unchanged.
- **Duplicate** → app-level 409 *and* DB-level partial-index rejection (two pending bookings, both paid → only one confirms, seat rolled back).
- **Idempotency** → the same `idempotencyKey` is never processed twice.
- **Last-seat race (true concurrency)** → two separate pg connection pools to the same database pay for the last seat with random delays, repeated 5× → **exactly one `confirmed`** (row-level lock on the conditional UPDATE).
- **Burst** → 8 concurrent payments for 4 seats → exactly 4 confirmed, 4 `seat_unavailable`.

Run with `pnpm test`.

---

## Assumptions

- Payment amount is a flat $50.00 trial fee (`TRIAL_PRICE_CENTS = 5000`).
- "Available" = seats not already confirmed; a `pending_payment` booking is shown to the parent but does not consume a seat.
- One parent can have many children; a child belongs to one parent.
- No authentication — parents and teachers are picked from seeded data. Auth was explicitly out of scope.
- PostgreSQL runs via `docker-compose.yml` (port 5432, volume-persisted); everything is re-creatable with `pnpm db:reset && pnpm db:setup`.

## Time Spent

~4 hours total (scaffolding, backend + invariants, tests incl. concurrency, minimal UI, docs).

## What Was Deliberately Cut

- Authentication/roles, real payment integration, webhooks/refunds.
- Seat-hold/reservation model with TTL expiry.
- Background jobs, observability tooling, migrations beyond the initial schema.
- Frontend polish, validation libraries, component framework.
- Regular (non-trial) enrollment.

## What I Would Monitor After Release

- **`payment_failed` with reason `seat_unavailable`** rate (seat contention) and its refund/UX fallout.
- **Payment attempt success rate and failure reasons** (card_declined / insufficient_funds / network_error) — gateway health.
- **Idempotency replay rate** — signal of retry storms or double-click issues.
- **`pending_payment` age** — abandoned bookings.
- **Roster accuracy vs `confirmed_count`** — a nightly reconciliation job that flags drift.

## What I Would Do Next With More Time

1. **Seat holds**: reserve a seat for N minutes when the parent starts payment (`pending_payment` with TTL), expire via a background job — improves conversion, at the cost of the availability tradeoff above.
2. **Seat holds**: reserve a seat for N minutes when the parent starts payment (`pending_payment` with TTL), expire via a background job — improves conversion, at the cost of the availability tradeoff above.
3. **Real gateway adapter** behind the same `PaymentProvider` seam, with refund handling for `seat_unavailable`.
4. **Auth + RBAC** (parent vs teacher), booking cancellation flow.
5. **Observability**: structured logs, metrics, error tracking.
6. **Migrate schema changes properly** via generated migrations in CI.

## Project Layout

```
app/
├── apps/
│   ├── api/                 # Express + Drizzle + PostgreSQL
│   │   ├── src/
│   │   │   ├── app.ts       # routes + error handling
│   │   │   ├── index.ts     # server entry
│   │   │   ├── services/    # bookings.ts, payments.ts (core invariants)
│   │   │   └── db/          # schema.ts, client.ts, seed.ts
│   │   ├── test/            # Vitest + Supertest
│   │   └── drizzle/         # committed SQL migrations
│   └── web/                 # Next.js 16 UI (parent flow + roster)
├── docker-compose.yml       # PostgreSQL 16 (dev/test)
├── pnpm-workspace.yaml
└── turbo.json
```
