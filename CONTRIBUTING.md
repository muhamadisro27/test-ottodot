# Contributing Guide — Ottodot Trial Booking

Conventions for committing in this monorepo. Scope = the app (or root) a change touches; a feature is delivered as a series of small atomic commits.

## Commit format

```
<type>(<scope>): <imperative subject>
```

- **Subject**: imperative mood (`add`, `fix`, not `added`, `fixed`), ≤ 72 chars, no trailing period.
- **Body** (required for non-trivial changes): explain *why*, not just *what*. Reference the invariant or scenario when relevant (e.g. duplicate booking, last-seat race).
- **Footer** (optional): `Refs`, `BREAKING CHANGE:` when applicable.
- Messages are written in English.

### Scopes

| Scope | Applies to |
|---|---|
| `api` | `apps/api/*` — schema, migrations, services, endpoints, tests |
| `web` | `apps/web/*` — Next.js UI, pages, components, styles |
| `root` | Everything at the repo root — turbo config, docker-compose, package.json, README, CI |

### Types

| Type | Use for |
|---|---|
| `feat` | New user-visible or API behavior |
| `fix` | A bug correction |
| `refactor` | Behavior-preserving code change |
| `test` | Adding or changing tests |
| `docs` | Documentation only |
| `chore` | Tooling, scripts, deps, seed data, non-code upkeep |
| `build` | Build system / pipeline changes |
| `perf` | Performance improvement |
| `revert` | Reverting a previous commit |

## Working per feature

A feature is not one giant commit. Land it as a short sequence of small commits, in dependency order:

1. Schema / migration
2. Domain / service logic
3. API endpoint
4. UI (if applicable)
5. Tests (in the same commit as the behavior they cover)
6. Seed data / docs

Before committing: run `pnpm typecheck` and `pnpm test`. Both must pass.

## Example commit messages

### `api` — booking flow

```
feat(api): create pending_payment booking for student and class
```
```
feat(api): reject duplicate active booking for same child and class
```
```
feat(api): return 409 DUPLICATE_BOOKING for existing confirmed booking
```

### `api` — payments and last-seat race

```
feat(api): record payment attempt with unique idempotency key
```
```
feat(api): confirm booking via atomic conditional seat grab
```
```
feat(api): mark booking payment_failed on card decline without consuming seat
```
```
feat(api): mark booking payment_failed with seat_unavailable when class is full
```
```
test(api): prove exactly one winner in concurrent last-seat race
```

### `api` — data

```
chore(api): add seed data covering full, near-full, and failed-payment classes
```
```
chore(api): add migration for confirmed_count and partial unique index
```

### `web` — booking UI

```
feat(web): render parent-child-class picker with seat availability
```
```
feat(web): allow forcing payment outcome for deterministic demos
```
```
feat(web): show booking status after payment
```

### `web` — roster

```
feat(web): teacher roster page showing confirmed students only
```

### `root`

```
build(root): add turbo pipeline for dev, test, and typecheck
```
```
docs(root): document backend design and last-seat race handling
```

## Rules

- One commit = one logical change. Split mixed changes.
- Keep tests in the same commit as the code they test.
- No `fix(api): fix bug` — say what was fixed (`fix(api): prevent overbooking when two payments race`).
- Breaking changes are okay, but they must be explicit: `feat(api)!: ...` plus a `BREAKING CHANGE:` body.
- Do not commit secrets, `.env` files, build output, or `node_modules`.
