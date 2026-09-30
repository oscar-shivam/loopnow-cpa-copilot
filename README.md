# Loopnow CPA Copilot

Loopnow is a controlled Canadian bookkeeping prototype. It processes a selected receipt through server-side documentation checks, GST/HST format validation, Decimal-safe ITC calculation, controlled GIFI mapping, transactionally persisted decisions, human review, and an audit replay.

It is not tax advice and does not verify CRA registration. It validates a GST/HST number's format only and never represents an outcome as CRA approval.

## What is implemented

- Next.js App Router dashboard with a server-backed selected-receipt context and typed SSE activity stream.
- PostgreSQL/Drizzle schema, checked-in migration, repeatable seed data, readiness endpoint, and Compose startup flow.
- Immutable deterministic policy sets for the assessment's legacy `$30/$150` boundaries and the configured default current `$100/$500` structure.
- Decimal.js monetary calculations, commercial-use handling, ordinary-meal limitation, controlled GIFI mappings, explicit receipt state transitions, stale-review supersession, human review, corrections, approval/rejection, idempotency, and audit events.
- Strict tool contracts, tenant-scoped repository queries, development-only demo reviewer role, request-size/rate/same-origin mutation checks, security headers, structured trace/span logs, and persisted TTFT/first-tool/total timings.
- 55 local unit/security tests, four PostgreSQL integration scenarios, three browser E2E journeys, and 51 deterministic evaluation cases. The integration/E2E suites require a PostgreSQL `DATABASE_URL`; CI provisions both PostgreSQL and Chromium.

## Quick start

Prerequisites: Node 24 (or Node 22+ for the AI SDK dependency) and PostgreSQL 17. Copy `.env.example` to `.env` and set a database URL appropriate for your environment.

```powershell
npm ci
npm run db:migrate
npm run db:seed
npm run dev
```

Open `http://localhost:3000`, then choose **Open bookkeeping workspace**. The seeded receipts demonstrate the expected paths:

- `001`: office supplies; deterministic approval.
- `002`: ordinary business meal; 50% ITC limitation.
- `003`: incomplete high-value documentation; human review.
- `004`: bank deposit; non-expense, no ITC.
- `005`: adversarial receipt text; review, never policy override.

## Commands

| Command | Purpose |
| --- | --- |
| `npm run typecheck` | Strict TypeScript check |
| `npm run lint` | ESLint across product and test sources |
| `npm run test:unit` | Pure CRA, GST/HST, ITC, GIFI and provider tests |
| `npm run test:security` | Input/schema, prompt-injection, authorization, financial-bound tests |
| `npm run test:evaluation` | 51 deterministic golden cases |
| `npm run report:performance` | JSON p50/p95 report from persisted agent/tool timing data |
| `npm run test:integration` | Real PostgreSQL selected-context, audit, review and idempotency flow |
| `npm run test:e2e` | Chromium dashboard journeys; requires PostgreSQL and Playwright Chromium |
| `npm run build` | Production Next.js build |
| `npm run db:migrate` / `npm run db:seed` | Apply migration / load demo dataset |

Run the full database-backed integration suite only after migrating and seeding a non-production database:

```powershell
npm run test:integration
```

For the browser suite, start from that migrated/seeded non-production database and install Chromium once:

```powershell
npx playwright install chromium
npm run test:e2e
```

The E2E suite runs receipt `001` (processing plus replay), `002` (ordinary-meal limitation), and `003`/`005` (missing evidence and prompt injection review paths).

## Docker

With Docker Desktop available, Compose waits for PostgreSQL, applies the migration, seeds the demo tenant, and starts the app:

```powershell
docker compose up --build
```

Then use `http://localhost:3000/api/health` for liveness and `http://localhost:3000/api/ready` for database readiness. Docker was not available in the build workstation, so this Compose path is checked in and CI builds the image, but it has not been executed locally here.

## Architecture and safeguards

The model/provider layer is deliberately not the financial authority. The real deterministic orchestrator calls persisted, allowlisted tools and remains usable when no model endpoint is configured. When `MODEL_EXPLANATIONS_ENABLED=true`, the installed AI SDK can call an Ollama-compatible or OpenAI-compatible model for a clearly labelled, non-authoritative narrative from curated post-decision facts. That model receives no business tools and cannot mutate state; unsafe/unavailable output is discarded.

Read the supporting material before deploying or extending the prototype:

- [Architecture](docs/architecture.md)
- [Security and threat model](docs/security.md)
- [State, policy and source guide](docs/state-and-policy.md)
- [Demo script](docs/demo-script.md)
- [Implementation plan](docs/implementation-plan.md)

## Deliberate limits

- The seeded demo identity is explicitly enabled only by `LOOPNOW_DEMO_MODE=true`. Without it, production API requests fail closed with `AUTH_NOT_CONFIGURED`; replace `getDemoActor` with verified SSO/session claims before handling real data. The reviewer header is demonstrative only and must never be trusted after that replacement.
- The in-memory rate limiter is bounded and prunes expired keys, but is not distributed; replace it with Redis or API-gateway controls in a multi-instance deployment.
- Trace/span logs are OpenTelemetry-shaped structured logs. No OTLP exporter is enabled yet, so telemetry delivery must be configured and verified per deployment.
- This prototype has no OCR, CRA registration lookup, banking integration, upload scanning, SSO, distributed queue, or automated LLM-directed financial tool loop.
- Rule records are versioned, but policy changes require human review, source retrieval, tests, a new migration/seed policy record, and release approval.
