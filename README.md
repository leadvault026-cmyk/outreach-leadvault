# LeadVault Outreach

LeadVault Outreach is LeadVault's authenticated B2B outreach application. It starts where LeadVault
research ends: it takes **approved prospect intelligence** and will run it through import →
prospects → audiences → campaigns → sequences → scheduling → controlled sending → replies →
suppression → analytics.

It is **not** the leadvaultdata.com marketing site, and it is **not** a prospect research or
acquisition engine.

The architecture source of truth is [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Status: Phase 1 (foundation).** Authentication, workspaces, roles, the full database schema
> with Row Level Security, the application shell, the dashboard (demo data), and the
> provider/verification/jurisdiction/audit foundations. **No email can be sent**: no mailbox
> provider is connected, and sending is not implemented.

## Technology

| Area          | Choice                                                                              |
| ------------- | ----------------------------------------------------------------------------------- |
| App           | Next.js 16 (App Router), React 19, TypeScript (strict)                              |
| UI            | Tailwind CSS v4, shadcn/ui on Radix primitives, lucide icons, Recharts              |
| Database      | PostgreSQL (Supabase), Drizzle ORM + drizzle-kit migrations, postgres.js            |
| Auth          | Supabase Auth (email + password, invite-only), `@supabase/ssr` HTTP-only cookies    |
| Validation    | Zod                                                                                 |
| Tests         | Vitest (unit + PGlite database tests), Playwright + axe (end-to-end, accessibility) |
| Deploy target | Railway (web + worker services), Supabase; not deployed in Phase 1                  |

## Local setup

Prerequisites: **Node 22.12+**, **Docker Desktop** (for the free local Supabase stack). No paid
service or account is needed.

```bash
npm install
npm run supabase:start          # local Supabase (Postgres, Auth, Mailpit) in Docker
cp .env.example .env.local      # then fill values from `npx supabase status`
npm run db:migrate              # apply committed SQL migrations
npm run db:seed                 # fictional demo data + demo users (local only)
npm run dev                     # http://localhost:3000
```

Sign in with any demo account (`owner@`, `admin@`, `operator@`, `viewer@`, `isolated@` at
`leadvault-demo.test`). The password is your `SEED_DEMO_PASSWORD` from `.env.local`. Password-reset
emails go to the local Mailpit inbox at http://127.0.0.1:54324; nothing leaves your machine.

### Environment variables

See [`.env.example`](.env.example) for every variable, with comments. Names only: **never commit
values**. `.env*` files are git-ignored except `.env.example`.

| Variable                                                           | Purpose                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ENV`                                                          | `local` / `staging` / `production`                                                |
| `APP_BASE_URL`                                                     | Base URL used in auth email links                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project (publishable key is public by design; used server-side for auth) |
| `SUPABASE_SECRET_KEY`                                              | **Server-only** admin key (seed now, invitations later)                           |
| `DATABASE_URL`, `DATABASE_MIGRATION_URL`                           | App and migration connections                                                     |
| `SEED_DEMO_PASSWORD`                                               | Demo-account password (local only)                                                |

## Database

All schema changes are migration-driven. Tables live in the `app` schema, which Supabase's
auto-generated Data API does not expose.

| Command                                           | What it does                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run db:generate`                             | Generate a migration from `src/db/schema` changes (review the SQL, commit it)       |
| `npx drizzle-kit generate --custom --name <name>` | Empty migration for hand-written SQL (policies, triggers, functions)                |
| `npm run db:migrate`                              | Apply migrations (`scripts/migrate.ts`; the future Railway pre-deploy command)      |
| `npm run db:check`                                | Validate migration history consistency                                              |
| `npm run db:seed`                                 | Fictional demo data (refuses to run unless `APP_ENV=local` and the DB is localhost) |
| `npm run db:reset`                                | Wipe the local DB, re-apply all migrations, re-seed                                 |
| `npm run db:studio`                               | Drizzle Studio                                                                      |

Migrations:

- `0000_init_schema`: all tables, keys, composite tenant FKs, CHECK constraints, indexes.
- `0001_security_rls`: helper functions, least-privilege grants, RLS on every table, `updated_at`
  triggers, the append-only audit trigger, and `auth.users` → `profiles` sync.
- `0002_profile_email`: mirrors the auth email into `profiles` for team views.

## Development commands

| Command                           |                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                                                     |
| `npm run build` / `npm run start` | Production build / server                                                                      |
| `npm run lint`                    | ESLint (zero warnings allowed)                                                                 |
| `npm run typecheck`               | Route type generation + `tsc --noEmit`                                                         |
| `npm run format` / `format:check` | Prettier                                                                                       |
| `npm test`                        | All Vitest suites                                                                              |
| `npm run test:unit`               | Pure domain/unit tests                                                                         |
| `npm run test:db`                 | Real PostgreSQL (PGlite, in-process) with all migrations: RLS, isolation, constraints          |
| `npm run test:e2e`                | Playwright against a production build on :3100 (needs local Supabase + seed + `npm run build`) |
| `npm run check`                   | lint + typecheck + tests + build                                                               |

## Project structure

```
src/
  app/                    Routes (App Router)
    (auth)/               Login, forgot/reset password, auth server actions
    auth/confirm/         Email-link handler (recovery/invite)
    w/[workspaceSlug]/    Workspace-scoped app: dashboard, modules, settings, profile
    [module]/             /prospects etc. → last-used workspace
    api/health/           Liveness + DB check
  components/             UI: shell, states (empty/error/permission/loading), dashboard, forms
    ui/                   shadcn/ui primitives (owned code)
  config/                 Navigation, module and settings definitions (single source)
  domain/                 Pure business rules: enums, permissions, verification, jurisdiction, audit
  db/
    schema/               Drizzle schema (app schema)
    migrations/           Committed SQL migrations
    client.ts             DB pool, withUserContext (RLS), privilegedDb
    rls.ts                runAsUser: role `authenticated` + JWT claims per transaction
  providers/mailbox/      Provider contract, normalized results/errors, fake adapter, registry
  server/                 Server-only: auth/session, workspace resolution, audit writer, queries
  lib/                    Utilities (ids, formatting, safe redirects, Supabase client)
  proxy.ts                Session refresh, route protection, CSP nonce, request id
scripts/                  migrate.ts, seed.ts
tests/unit, tests/db      Vitest suites
e2e/                      Playwright suites
supabase/                 Local stack config and auth email templates
```

## Security notes

- **Workspace isolation is enforced three times**: in the server data-access layer
  (`resolveWorkspace`/`can()`), by PostgreSQL RLS (queries run as role `authenticated` with the
  caller's JWT claims), and by composite `(workspace_id, id)` foreign keys.
- The browser never receives database or secret keys. All data access is server-side.
  `SUPABASE_SECRET_KEY` is server-only and used only for admin operations.
- Public sign-up is disabled (`[auth] enable_signup = false`). Accounts are created by
  invitation only.
- The audit log is append-only (trigger), attributed to the caller (RLS), and its metadata is
  sanitized: credentials and message content are never recorded.
- Nonce-based CSP, `frame-ancestors 'none'`, nosniff, a strict referrer policy, and safe
  same-origin post-login redirects.
- Errors shown to users never include stack traces, SQL or provider details. A reference id is
  shown instead.
- **Never use real customer prospects or addresses in development.** The seed uses invented
  data on reserved `.test` / `.example` domains.

## Brand

The app uses a **temporary text-only wordmark** (`src/components/brand/wordmark.tsx`) and a
palette taken from leadvaultdata.com (near-black ink, lime `#b7ff00` accent, Inter). No logo
was created. **The approved LeadVault logo assets should be supplied** to replace the wordmark.

## Deployment (later)

`Dockerfile` builds the standalone web service for Railway (or Render/Fly/Cloud Run). Production
needs Railway **Pro** (outbound SMTP) and Supabase **Pro** (backups, no pausing); see
`docs/ARCHITECTURE.md` §24 and §29. Nothing is deployed in Phase 1.
