# Ottodot Trial Booking — Take-Home

Trial class booking system for Ottodot (live online science/math classes for kids). **Trial booking only** (no regular enrollment). Trial classes are capped at **4 students**.

Built as a small Turborepo monorepo: an **Express 5 + Drizzle + PostgreSQL** API that owns all booking/payment correctness, and a minimal **Next.js 16** UI for the parent booking flow and the teacher roster.

> Backend correctness, edge cases, and invariants are the point of this exercise. The UI is deliberately plain.

The solution is built around four invariants, all enforced by the database (not just the app):

1. **No duplicate confirmed booking** for the same child and class — partial unique index.
2. **No overbooking** beyond capacity — atomic conditional seat grab at payment commit.
3. **A failed payment never consumes a seat** — the roster only reads `confirmed`.
4. **At most one winner for the last seat** — row-level lock + re-checked `WHERE` in the confirm transaction.

---

## Table of Contents

- [Quick Start](#quick-start)
- [Environment variables](#environment-variables)
- [Tests & checks](#tests--checks)
- [What Was Built](#what-was-built)
- [System Architecture](#system-architecture)
- [Data Model](#data-model)
- [Booking Lifecycle](#booking-lifecycle)
- [Core Flows](#core-flows)
- [API Reference](#api-reference)
- [Error Codes](#error-codes)
- [Deploying the API to Vercel](#deploying-the-api-to-vercel)
- [Concurrency & Correctness](#concurrency--correctness)
- [Seed Data](#seed-data)
- [Verification / Tests](#verification--tests)
- [Assumptions](#assumptions)
- [Time Spent](#time-spent)
- [What Was Deliberately Cut](#what-was-deliberately-cut)
- [What I Would Monitor After Release](#what-i-would-monitor-after-release)
- [What I Would Do Next With More Time](#what-i-would-do-next-with-more-time)
- [Project Layout](#project-layout)
- [Conventions](#conventions)
- [AI Usage](#ai-usage)

---

## Quick Start

Requirements: **Node ≥ 20**, **pnpm ≥ 10**, **Docker** (for PostgreSQL).

```bash
cd app
pnpm install
pnpm db:up           # start PostgreSQL (docker compose)
pnpm db:setup        # migrate + seed a fresh PostgreSQL DB
pnpm dev             # turbo: runs API (:4000) + web (:3000) together
```

Open http://localhost:3000 (parent booking) and http://localhost:3000/roster (teacher roster).

### What each command does

| Command | What it does |
|---|---|
| `pnpm install` | Installs workspace deps (Turborepo + both apps). |
| `pnpm db:up` | `docker compose up -d` — starts `ottodot-db` (PostgreSQL 16) on port 5432, waits for `healthy`. |
| `pnpm db:setup` | Runs `db:up`, then `drizzle-kit migrate` and the seed script against the `ottodot` database. |
| `pnpm dev` | Turborepo runs both dev servers: API on `:4000` (tsx watch) and web on `:3000` (next dev). |
| `pnpm db:down` | Stops the Postgres container (data persisted in a volume). |
| `pnpm db:reset` | `docker compose down -v` then `up -d` — wipes the volume and starts fresh. |

Reset the demo data any time with `pnpm db:setup` (migrate + re-seed).

### Troubleshooting

- **Port already in use (5432 / 4000 / 3000)** — either stop the conflicting process or change `POSTGRES_PORT` / `PORT` / `API_URL` in the `.env` files (see below).
- **`ECONNREFUSED` on `:5432`** — make sure `pnpm db:up` finished and the container reports `healthy` (`docker compose ps`).
- **Stale demo data** — run `pnpm db:reset && pnpm db:setup` to start from an empty volume.
- **Tests failing with duplicate database errors** — ensure the DB is up first (`pnpm db:up`); the suite auto-creates and reuses `ottodot_test`.

---

## Environment variables

All values have working defaults for local dev, so the quick start above runs without any env setup. To override, copy the examples and edit:

```bash
cp .env.example .env                    # repo root — PostgreSQL container (docker compose)
cp apps/api/.env.example apps/api/.env  # API — PORT, DATABASE_URL, TEST_DATABASE_URL
cp apps/web/.env.example apps/web/.env.local  # web — API_URL (Next.js proxy target)
```

| Var | Default | Used by |
|---|---|---|
| `POSTGRES_USER` / `POSTGRES_PASSWORD` / `POSTGRES_DB` / `POSTGRES_PORT` | `ottodot` / `ottodot` / `ottodot` / `5432` | `docker-compose.yml` |
| `PORT` | `4000` | `apps/api/src/index.ts` |
| `DATABASE_URL` | `postgres://ottodot:ottodot@localhost:5432/ottodot` | API, drizzle, seed, test global-setup |
| `TEST_DATABASE_URL` | `postgres://ottodot:ottodot@localhost:5432/ottodot_test` | Vitest suite |
| `API_URL` | `http://localhost:4000` | `apps/web/next.config.ts` (rewrite proxy) |

Keep `POSTGRES_*` in `.env` in sync with `DATABASE_URL` in `apps/api/.env`.

---

## Tests & checks

```bash
pnpm db:up          # required first: tests run against the same PostgreSQL instance
pnpm test           # Vitest suite (bookings, payments, last-seat race)
pnpm typecheck
pnpm build
```

The test suite auto-creates a dedicated `ottodot_test` database and runs migrations against it during setup (see `apps/api/test/global-setup.ts`).

---

## What Was Built

1. **Parent booking flow** — pick a parent → child → available trial class → create booking → mock pay (random or forced outcome) → see the resulting status.
2. **Teacher roster** — pick a class → see confirmed students (only `confirmed` status counts).
3. **Payment simulation** — outcomes are random by default (`success`, `card_declined`, `insufficient_funds`, `network_error`) but can be **forced** so every edge case is demonstrable/deterministic.
4. **REST API** — all correctness logic lives behind a small, documented API.

Booking statuses: `pending_payment` → `confirmed` | `payment_failed` | `cancelled`.

---

## System Architecture

```mermaid
flowchart LR
    subgraph Browser["Browser"]
        ParentUI["Parent booking flow</br>/ (Next.js page)"]
        RosterUI["Teacher roster</br>/roster (Next.js page)"]
    end

    subgraph Web["apps/web — Next.js 16 on :3000"]
        Next["Next.js router</br>rewrites /api/*"]
    end

    subgraph Api["apps/api — Express 5 on :4000"]
        Routes["REST routes</br>src/app.ts"]
        Services["Services</br>bookings.ts · payments.ts"]
        Errors["AppError + error middleware"]
        Routes --> Services
        Routes --> Errors
    end

    subgraph Db["PostgreSQL 16 on :5432</br>(docker-compose.yml)"]
        DB[("ottodot (dev)</br>ottodot_test (tests)")]
    end

    ParentUI --> Next
    RosterUI --> Next
    Next -->|"proxy /api/*"| Routes
    Services --> DB
```

- The **web app never talks to the database**; it proxies `/api/*` to the API and renders responses.
- All correctness logic (duplicates, capacity, idempotency, race) lives in the **API services**, backed by database constraints.
- The **database is the last line of defense** for the invariants that must never break under concurrency.

---

## Data Model

Drizzle schema (`apps/api/src/db/schema.ts`), migrated via committed SQL in `apps/api/drizzle/`.

```mermaid
erDiagram
    PARENTS ||--o{ STUDENTS : "has children"
    STUDENTS ||--o{ BOOKINGS : "places"
    TRIAL_CLASSES ||--o{ BOOKINGS : "has bookings"
    BOOKINGS ||--o{ PAYMENT_ATTEMPTS : "records"

    PARENTS {
        serial id PK
        text name
        text email UK
    }

    STUDENTS {
        serial id PK
        int parent_id FK
        text name
        text grade
    }

    TRIAL_CLASSES {
        serial id PK
        text subject
        text topic
        text starts_at
        int capacity "default 4"
        int confirmed_count "denormalized seat counter"
    }

    BOOKINGS {
        serial id PK
        int student_id FK
        int class_id FK
        text status "pending_payment | confirmed | payment_failed | cancelled"
        bigint created_at
        bigint updated_at
    }

    PAYMENT_ATTEMPTS {
        serial id PK
        int booking_id FK
        int amount "5000 cents = $50.00"
        text idempotency_key UK
        text result "success | failure"
        text reason "card_declined | insufficient_funds | network_error | seat_unavailable"
        bigint created_at
    }
```

Two deliberate modeling choices:

- **`trial_classes.confirmed_count`** is a denormalized counter that enables an **atomic conditional seat grab**. It is only written inside the same transaction that confirms a booking, so it cannot drift from the `bookings` table.
- **Partial unique index** `uq_booking_confirmed_student_class` on `bookings(student_id, class_id) WHERE status = 'confirmed'` makes "no duplicate confirmed booking" a database fact, not an app-level hope.

Additional indexes: `idx_booking_class_status (class_id, status)` (fast roster lookups), `idx_booking_student (student_id)`, and the unique `payment_attempts(idempotency_key)`.

---

## Booking Lifecycle

```mermaid
stateDiagram-v2
    direction LR
    [*] --> pending_payment: POST /api/bookings
    pending_payment --> confirmed: payment success + seat grabbed atomically
    pending_payment --> payment_failed: gateway failure (no seat touched)
    pending_payment --> payment_failed: gateway success but seat_unavailable (race loser)
    confirmed --> [*]
    payment_failed --> [*]: retry = create a NEW booking
```

Notes:

- `cancelled` exists in the status enum but is **not reachable in v1** (no cancellation endpoint yet) — reserved for the auth/cancellation next step.
- A `pending_payment` booking does **not** hold a seat.
- After `payment_failed`, the booking is no longer "active", so the same child/class can be retried via a fresh booking.

---

## Core Flows

### Happy path — create booking, pay, confirm

```mermaid
sequenceDiagram
    autonumber
    actor Parent
    participant UI as Next.js UI
    participant API as Express API
    participant GW as Mock gateway
    participant DB as PostgreSQL

    Parent->>UI: pick parent, child, class
    UI->>API: POST /api/bookings {studentId, classId}
    API->>DB: student exists? class exists? active booking? class full?
    alt duplicate or full
        API-->>UI: 409 DUPLICATE_BOOKING / CLASS_FULL
    else ok
        API->>DB: INSERT booking (status = pending_payment)
        API-->>UI: 201 { booking }
    end

    Parent->>UI: click Pay $50.00
    UI->>API: POST /api/payments/attempt {bookingId, idempotencyKey, forceResult}
    API->>GW: charge $50.00 (simulated, optional delay)
    GW-->>API: outcome
    API->>DB: record payment_attempt (idempotency_key unique)
    alt gateway failure
        API->>DB: booking set to payment_failed
        API-->>UI: { result: failure, bookingStatus: payment_failed }
    else success
        API->>DB: BEGIN; conditional UPDATE trial_classes
        API->>DB: increment confirmed_count only while below capacity
        API->>DB: mark booking confirmed; COMMIT
        API-->>UI: { result: success, bookingStatus: confirmed }
    end
    UI->>Parent: show status; roster now includes child
```

### Last-seat race — the core scenario

The brief's scenario: **A** selects the last slot → moves to payment; **B** selects the same slot; **B** pays and confirms first; **A** then tries to pay.

```mermaid
sequenceDiagram
    autonumber
    actor A as User A (Zara)
    actor B as User B (Noah)
    participant API as Express API
    participant DB as PostgreSQL

    Note over A,B: Class 2 has 3/4 confirmed - 1 seat left
    A->>API: create booking (pending_payment)
    B->>API: create booking (pending_payment)
    Note over A,B: NO seat is reserved at selection time
    B->>API: pay (arrives first)
    API->>DB: BEGIN; conditional UPDATE trial_classes
    API->>DB: confirmed_count 3 to 4; confirm B; COMMIT
    API-->>B: { bookingStatus: "confirmed" }
    A->>API: pay (arrives second)
    API->>DB: BEGIN; conditional UPDATE trial_classes
    API->>DB: WHERE below capacity: matches 0 rows
    API->>DB: booking A set to payment_failed (reason seat_unavailable)
    API-->>A: { result: "success", reason: "seat_unavailable", bookingStatus: "payment_failed" }
    Note over A,DB: PostgreSQL row-level lock serializes the two writers; the loser re-evaluates WHERE and loses: AT MOST ONE confirmed, guaranteed by the DB
```

Key point: the gateway charge for user A can still *succeed* — but because the conditional UPDATE matched zero rows, the seat is **not** consumed and A's booking ends `payment_failed`. There is never a refund-or-reconcile problem because the seat was never granted.

---

## API Reference

Base URL: `http://localhost:4000` (proxied through the web app at `/api/*`). All responses are JSON.

| Method | Endpoint | Purpose |
|---|---|---|
| GET | `/api/health` | Liveness probe |
| GET | `/api/classes` | Classes + `availableSeats = capacity - confirmed_count` |
| GET | `/api/classes/:id/roster` | Confirmed students for a class |
| GET | `/api/parents` | Parents + their students |
| POST | `/api/bookings` | `{ studentId, classId }` → `pending_payment` booking |
| POST | `/api/payments/attempt` | `{ bookingId, idempotencyKey?, forceResult?, delayMs? }` → mock pay + confirm |
| GET | `/api/bookings/:id` | Booking status + payment attempts |

### GET /api/classes

```bash
curl http://localhost:4000/api/classes
```

```json
{
  "classes": [
    {
      "id": 1,
      "subject": "Math",
      "topic": "Fractions with Pizza",
      "startsAt": "2026-08-15T09:00:00.000Z",
      "capacity": 4,
      "confirmedCount": 0,
      "availableSeats": 4
    }
  ]
}
```

### GET /api/classes/:id/roster

```bash
curl http://localhost:4000/api/classes/2/roster
```

```json
{
  "class": {
    "id": 2,
    "subject": "Science",
    "topic": "Volcano Eruption",
    "startsAt": "2026-08-16T10:00:00.000Z",
    "capacity": 4,
    "confirmedCount": 3
  },
  "capacity": 4,
  "confirmedCount": 3,
  "confirmed": [
    { "bookingId": 1, "studentId": 1, "studentName": "Leo", "grade": "4" }
  ]
}
```

### GET /api/parents

```bash
curl http://localhost:4000/api/parents
```

```json
{
  "parents": [
    {
      "id": 1,
      "name": "Alice",
      "email": "alice@example.com",
      "students": [
        { "id": 1, "parentId": 1, "name": "Leo", "grade": "4" }
      ]
    }
  ]
}
```

### POST /api/bookings

```bash
curl -X POST http://localhost:4000/api/bookings \
  -H "Content-Type: application/json" \
  -d '{"studentId": 1, "classId": 1}'
```

```json
{
  "booking": {
    "id": 5,
    "studentId": 1,
    "classId": 1,
    "status": "pending_payment",
    "createdAt": 1779000000000,
    "updatedAt": 1779000000000
  }
}
```

### POST /api/payments/attempt

The `idempotencyKey` is optional — the server generates a UUID if omitted. `forceResult` makes every edge case deterministic for demos/tests: `success`, `card_declined`, `insufficient_funds`, `network_error`, `random` (default). `delayMs` (optional) simulates gateway latency to make races realistic.

```bash
curl -X POST http://localhost:4000/api/payments/attempt \
  -H "Content-Type: application/json" \
  -d '{"bookingId": 5, "forceResult": "success", "idempotencyKey": "8f8c0f5e-aaaa-4b1c-9d3e-111111111111"}'
```

```json
{
  "idempotencyKey": "8f8c0f5e-aaaa-4b1c-9d3e-111111111111",
  "result": "success",
  "reason": null,
  "bookingStatus": "confirmed"
}
```

Forced failure:

```json
{
  "idempotencyKey": "8f8c0f5e-aaaa-4b1c-9d3e-222222222222",
  "result": "failure",
  "reason": "card_declined",
  "bookingStatus": "payment_failed"
}
```

Race loser (payment succeeded at gateway, but no seat):

```json
{
  "idempotencyKey": "8f8c0f5e-aaaa-4b1c-9d3e-333333333333",
  "result": "success",
  "reason": "seat_unavailable",
  "bookingStatus": "payment_failed"
}
```

Replaying the same `idempotencyKey` never processes the charge twice — it returns the stored outcome with `"replay": true`.

### GET /api/bookings/:id

```bash
curl http://localhost:4000/api/bookings/5
```

```json
{
  "booking": { "id": 5, "studentId": 1, "classId": 1, "status": "confirmed", "createdAt": 1779000000000, "updatedAt": 1779000001000 },
  "student": { "id": 1, "parentId": 1, "name": "Leo", "grade": "4" },
  "class": { "id": 1, "subject": "Math", "topic": "Fractions with Pizza", "startsAt": "2026-08-15T09:00:00.000Z", "capacity": 4, "confirmedCount": 1 },
  "attempts": [
    { "id": 3, "bookingId": 5, "amount": 5000, "idempotencyKey": "8f8c0f5e-aaaa-4b1c-9d3e-111111111111", "result": "success", "reason": null, "createdAt": 1779000001000 }
  ]
}
```

---

## Error Codes

Every error is returned as `{ "error": { "code", "message" } }` with an appropriate HTTP status.

| HTTP | Code | When |
|---|---|---|
| 400 | `INVALID_INPUT` | Missing/malformed `studentId`, `classId`, `bookingId`, or unknown `forceResult` |
| 404 | `STUDENT_NOT_FOUND` / `CLASS_NOT_FOUND` / `BOOKING_NOT_FOUND` | Referenced entity does not exist |
| 409 | `DUPLICATE_BOOKING` | Child already has an active (`pending_payment` or `confirmed`) booking for that class |
| 409 | `CLASS_FULL` | Class already at capacity at booking-creation time |
| 409 | `SEAT_UNAVAILABLE` | Last seat taken during payment (race loser) |
| 409 | `BOOKING_NOT_PAYABLE` | Payment attempted on a booking that is not `pending_payment` |
| 500 | `INTERNAL_ERROR` | Unexpected server error (logged) |

---

## Deploying the API to Vercel

The API deploys as a single [Vercel Function](https://vercel.com/docs/functions) from a dedicated serverless entrypoint (`apps/api/api/index.ts`). The local `src/index.ts` (which calls `app.listen()`) is not used on Vercel.

**Project root directory:** `apps/api` — so env vars are configured **per-project on Vercel**, completely separate from the root `.env` (docker compose) and `apps/api/.env` (local dev).

1. **Import the repo** → New Project → set **Root Directory** to `apps/api` (Framework Preset: Other / Express).
2. **Add the env var** in Project Settings → Environment Variables (or `vercel env add DATABASE_URL production`):

   | Var | Value |
   |---|---|
   | `DATABASE_URL` | Neon **pooled** connection string, e.g. `postgres://<user>:<pass>@ep-<slug>-pooler.<region>.aws.neon.tech/ottodot?sslmode=require` |

   `PORT` and `TEST_DATABASE_URL` are **not** needed on Vercel (see `apps/api/.env.production.example`).
3. **Apply migrations to Neon** (from your machine or CI):

   ```bash
   DATABASE_URL="postgres://<user>:<pass>@ep-<slug>-pooler.<region>.aws.neon.tech/ottodot?sslmode=require" \
     pnpm --filter @ottodot/api db:migrate
   ```

   Optionally seed the production DB the same way with `pnpm --filter @ottodot/api db:seed`.
4. **Deploy** — then verify: `curl https://<project>.vercel.app/api/health` → `{ "ok": true }`.

Notes:

- On Vercel, the pool is configured serverless-safe (`max: 1` + timeouts) via `process.env.VERCEL`.
- `dotenv/config` never overrides platform-injected vars, so it stays in the dev entrypoints.
- If the Next.js web app is deployed later, set its `API_URL` to the deployed API URL (e.g. `https://<project>.vercel.app`) so the `/api/*` proxy keeps working. CORS is already wide open (`cors()`).
- Migrations (`apps/api/drizzle/`) are not required at runtime; they are applied against the hosted DB before/after deploy as above.

---

### How duplicates are prevented

- **App level:** `createBooking` (`apps/api/src/services/bookings.ts`) rejects if the child already has an active (`pending_payment` or `confirmed`) booking for that class — friendly 409.
- **DB level:** the partial unique index above rejects a second `confirmed` even if two pending bookings sneak in concurrently; the confirm transaction rolls back, so no seat is lost.

### How payment failure is handled

The gateway outcome is recorded in `payment_attempts` **first**. On failure the booking becomes `payment_failed` and **`confirmed_count` is never touched**. The roster only ever reads `status = 'confirmed'`, so a failed payment can never appear as a student. Retry = create a new booking (the old one is no longer "active"); the seat is re-checked atomically at payment time.

### How the last-seat race is handled

The scenario: A and B both select the last slot → B pays first and confirms → A then pays.

Seats are **not** reserved at selection time. Both users hold a `pending_payment` booking, and the seat is grabbed **atomically when the payment commits**:

```sql
UPDATE trial_classes
SET    confirmed_count = confirmed_count + 1
WHERE  id = :classId AND confirmed_count < capacity
```

If the conditional UPDATE matches `0` rows, the payment succeeded at the gateway but there is no seat → the booking becomes `payment_failed` (reason `seat_unavailable`) and nothing is added to the roster. In PostgreSQL the two concurrent transactions serialize on the **row-level lock** of that `trial_classes` row; the second writer re-evaluates the `WHERE` against the updated row and matches nothing. **At most one user can end up confirmed, guaranteed by the database.** (See the [last-seat race sequence diagram](#core-flows).)

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

- **Class 1 – Math "Fractions with Pizza"**: 0 confirmed / 4 seats (available), plus a `pending_payment` (Maya) and a `payment_failed` (Zara — card declined, **seat not consumed**).
- **Class 2 – Science "Volcano Eruption"**: **3 confirmed / 4 seats → exactly one seat left** (last-seat race demo).
- **Class 3 – Math "Shapes in Art"**: 0 confirmed / 4 seats (available).
- Parents: Alice (Leo, Maya, Zara), Bob (Noah). Teacher: Anna.

---

## Verification / Tests

13 Vitest tests across 3 files (`apps/api/test/`). Highlights:

- **Payment failure** → booking `payment_failed`, roster and `confirmed_count` unchanged.
- **Duplicate** → app-level 409 *and* DB-level partial-index rejection (two pending bookings, both paid → only one confirms, seat rolled back).
- **Idempotency** → the same `idempotencyKey` is never processed twice.
- **Last-seat race (true concurrency)** → two separate pg connection pools to the same database pay for the last seat with random delays, repeated 5× → **exactly one `confirmed`** (row-level lock on the conditional UPDATE).
- **Burst** → 8 concurrent payments for 4 seats → exactly 4 confirmed, 4 `seat_unavailable`.

| File | Tests | Covers |
|---|---|---|
| `test/bookings.test.ts` | 5 | create pending booking, class-full rejection, app-level duplicate 409, parent listing, booking lookup |
| `test/payments.test.ts` | 6 | confirm + one seat, failure leaves roster untouched, retry after failure, idempotent replay, non-payable booking, DB partial-index rejection |
| `test/last-seat-race.test.ts` | 2 | exactly one winner under concurrent payments (5 iterations), no overbooking under an 8-way burst |

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
2. **Real gateway adapter** behind the same `PaymentProvider` seam, with refund handling for `seat_unavailable`.
3. **Auth + RBAC** (parent vs teacher) and a booking cancellation flow (activating the reserved `cancelled` status).
4. **Observability**: structured logs, metrics, error tracking.
5. **Migrate schema changes properly** via generated migrations in CI.

## Project Layout

```
app/
├── apps/
│   ├── api/                 # Express + Drizzle + PostgreSQL
│   │   ├── src/
│   │   │   ├── app.ts       # routes + error handling
│   │   │   ├── index.ts     # server entry (dotenv)
│   │   │   ├── services/    # bookings.ts, payments.ts (core invariants)
│   │   │   └── db/          # schema.ts, client.ts, seed.ts
│   │   ├── test/            # Vitest + Supertest
│   │   └── drizzle/         # committed SQL migrations
│   └── web/                 # Next.js 16 UI (parent flow + roster)
├── docker-compose.yml       # PostgreSQL 16 (dev/test)
├── pnpm-workspace.yaml
├── turbo.json
└── .env.example / apps/*/.env.example
```

## Conventions

- **Commits**: Conventional Commits with per-app scopes — `<type>(<scope>): <subject>` where scope is `api`, `web`, or `root`. See [CONTRIBUTING.md](./CONTRIBUTING.md).
- **AI agents**: working rules (checks before finishing, commit format) live in [AGENTS.md](./AGENTS.md).

## AI Usage

AI tools were used during development. A full breakdown — which tools, what they were used for, where they helped, where output was rejected/corrected, and how the final result was verified — is in [AI_USAGE.md](./AI_USAGE.md).
