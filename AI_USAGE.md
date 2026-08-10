# AI Usage — Ottodot Trial Booking Take-Home

Transparency note: this solution was built in a pairing workflow with an AI coding agent (opencode, Claude-powered) and the Context7 MCP for up-to-date library docs. The task instructions explicitly encourage using and steering AI tools.

## Which AI tools were used

- **opencode (CLI coding agent)** — interactive planning, code generation, refactoring, running commands, and verification.
- **Context7 MCP** — fetched current Drizzle ORM documentation (transaction API, async node-postgres driver result shapes, `timestamp`/`bigint` modes) to avoid relying on stale training data.
- **Web search / docs fetches** — confirmed latest package versions (Next.js 16, Express 5, Drizzle 0.45, pg 8, Vitest 4, Turbo 2.10).

## What AI was used for

- Turning the take-home instructions + email into a scoped plan (data model, invariants, API surface, test matrix).
- Scaffolding the Turborepo/workspace config and boilerplate (tsconfigs, drizzle-kit config, vitest config).
- Writing the Express/Drizzle service layer, the race/duplicate tests, and the minimal Next.js UI.
- Debugging environment quirks (pnpm build-script approval, Docker Desktop engine startup, Windows process management).

## One place AI helped me move faster

The **concurrency race test**. I described the last-seat scenario and the AI drafted a multi-connection test (two separate pg connection pools on the same database, random payment delays, repeated 5×, plus an 8-way burst test) that directly exercises the atomic conditional `UPDATE`. Getting a real concurrency test right from scratch would have taken far longer; the drafted version needed only small tweaks.

## One place I disagreed with / corrected / rejected AI output

1. **Rejected the shared `packages/db` package.** The first plan extracted the Drizzle schema into a separate workspace package. Since only the API consumes it, that added a build-ordering layer for zero benefit in a 4-hour take-home — I collapsed it into `apps/api/src/db/` to keep scope tight.
2. **Corrected the transaction-rollback design.** An early approach returned a "seat unavailable" value from inside the Drizzle transaction after calling `tx.rollback()`. In Drizzle, `rollback()` throws internally, so the value would never return — the correct shape is to throw a custom `SeatUnavailableError`, let the transaction roll back, and handle it outside.
3. **Rejected the relational `db.query.*` API.** AI initially used `db.query.bookings.findFirst({ with: ... })`; typecheck showed the sync driver returns a query object, not data. I switched everything to the classic builder (`.select().from(...).get()`), which is also the API I could verify quickly.
4. **Caught and fixed AI's earlier mistakes** that it flagged itself via typecheck: `cors`/`@types/cors` never added to `package.json`, `.returning()` used without `.get()`/`.all()`, an overly strict `noUncheckedIndexedAccess` that produced noise, and a parents route that referenced the wrong identifier.

## What I would change about the AI workflow next time

- **Pin library versions before coding.** I generated the plan against a guessed stack then had to adapt when Drizzle/Vitest APIs differed slightly. Checking docs (Context7) up front saved most of this, but I would do it even earlier.
- **Ask the AI to show database-level proof earlier.** The most valuable output was the SQL (conditional `UPDATE`, partial unique index) — I would request the exact generated SQL from the migration before writing business logic.
- **More aggressive early typecheck.** Run `tsc --noEmit` after each file rather than after several files; several errors shared a root cause (sync driver API) and were cheaper to fix one at a time.

## How the final implementation was verified

1. `tsc --noEmit` typecheck passes for both `apps/api` and `apps/web`.
2. `pnpm test` — **13 Vitest tests pass**, including the multi-connection last-seat race (5 iterations) and the 8-way burst overbooking test.
3. `next build` succeeds (production build).
4. **Manual smoke tests through the running API**: create booking → forced-success payment → confirmed; duplicate booking → 409; forced `card_declined` → `payment_failed` with seats and roster unchanged.
5. **End-to-end through the web app**: `pnpm dev` (turbo) runs both apps; the Next.js rewrite proxy to Express was verified (`/api/health` via :3000) and a full booking→pay→detail flow was exercised through the proxy.
6. Generated SQL migration was inspected to confirm the **partial unique index** (`WHERE status = 'confirmed'`) was actually created.

## Follow-up work (PostgreSQL migration + `next-env.d.ts`)

After the first delivery, two requested changes were made with AI assistance:

1. **SQLite → PostgreSQL.** The full stack was migrated to `postgres:16` via `docker-compose.yml` (dev + tests). AI handled: swapping `better-sqlite3` for `pg`, rewriting the Drizzle schema (`sqliteTable` → `pgTable`, `serial` ids, `bigint` epoch-ms timestamps), converting the sync service layer to the async driver, regenerating the committed migrations, and adapting the Vitest suite to run against a dedicated `ottodot_test` DB (created + migrated in `globalSetup`, truncated per test). The race test now uses **two separate pg pools → true row-level lock contention** instead of SQLite's single-writer serialization.
   - **A real bug caught by the migration:** `Date.now()` (~1.7e12) overflows Postgres `integer` (32-bit), so timestamps had to be `bigint`/`timestamp`, not `integer`. Also, Drizzle 0.45 wraps driver errors in `DrizzleQueryError` (real pg error on `.cause`); `isUniqueConstraintError` had to walk the `cause` chain so a DB-level duplicate still maps to a 409 `DUPLICATE_BOOKING`.
2. **`next-env.d.ts` untracked.** Deleted the file and added it to `.gitignore` (Next regenerates it on every `dev`/`build`; it is build output, not source).

Verification for the follow-up: `pnpm db:setup` (migrate + seed), all **13 tests green on Postgres**, `pnpm typecheck` + `pnpm build` pass, and end-to-end smoke tests through the API (`:4000`) and the Next.js proxy (`:3000`) confirmed booking → payment → roster still work.
