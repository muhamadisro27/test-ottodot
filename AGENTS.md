# AGENTS.md

Working rules for AI agents in this monorepo (Ottodot trial booking). Scope = Turborepo with `apps/api` (Express 5 + Drizzle + PostgreSQL) and `apps/web` (Next.js).

## Before finishing any task

- Run checks and ensure they pass:
  - `pnpm typecheck`
  - `pnpm test`
  - `pnpm build`
- Only commit when the user explicitly asks.

## Commit convention

Format: `<type>(<scope>): <imperative subject>` with a body explaining *why* when non-trivial. English, subject ≤ 72 chars, imperative mood.

Scopes:
- `api` — `apps/api/*` (schema, migrations, services, endpoints, tests)
- `web` — `apps/web/*` (pages, components, styles)
- `root` — repo root (turbo, docker-compose, package.json, README, CI)

Types: `feat`, `fix`, `refactor`, `test`, `docs`, `chore`, `build`, `perf`, `revert`.

Feature = a series of small atomic commits (schema → service → endpoint → UI → tests → seed/docs), not one big commit. Tests ship in the same commit as the behavior they cover.

Examples:
- `feat(api): reject duplicate active booking for same child and class`
- `test(api): prove exactly one winner in concurrent last-seat race`
- `feat(web): teacher roster page showing confirmed students only`
- `chore(api): add seed data covering full, near-full, and failed-payment classes`
- `docs(root): document backend design and last-seat race handling`

Full details: see `CONTRIBUTING.md`.
