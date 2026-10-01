# LeadVault Outreach

LeadVault Outreach is LeadVault's authenticated B2B outreach application. It starts where LeadVault
research ends: it takes **approved prospect intelligence** and will run it through import →
prospects → audiences → campaigns → sequences → scheduling → controlled sending → replies →
suppression → analytics.

It is **not** the leadvaultdata.com marketing site, and it is **not** a prospect research or
acquisition engine. The architecture source of truth is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Status: Phase 2 (prospects).** Phase 1 delivered authentication, workspaces, roles, the
> database with Row Level Security, the application shell and the dashboard. Phase 2 adds CSV
> imports, the prospect repository, the eligibility engine, suppression, unsubscribe records and
> audiences. **No email can be sent**: no mailbox is connected, and sending is not implemented.

This README has two parts:

1. [**Developer setup**](#part-1--developer-setup): for engineers working on the code.
2. [**Owner's local testing guide**](#part-2--owners-local-testing-guide): plain-language steps
   for trying the app on your own Windows computer.

---

# PART 1 — DEVELOPER SETUP

## Technology

| Area          | Choice                                                                                  |
| ------------- | --------------------------------------------------------------------------------------- |
| App           | Next.js 16 (App Router), React 19, TypeScript (strict)                                  |
| UI            | Tailwind CSS v4, shadcn/ui on Radix primitives, lucide icons, Recharts                  |
| Database      | PostgreSQL (Supabase), Drizzle ORM + drizzle-kit migrations, postgres.js, `pg_trgm`     |
| Auth          | Supabase Auth (email + password, invite-only), `@supabase/ssr` HTTP-only cookies        |
| CSV           | papaparse (parsing), own encoder with formula-injection protection (export)             |
| Validation    | Zod                                                                                     |
| Tests         | Vitest (unit + PGlite database tests), Playwright + axe (end-to-end, accessibility)     |
| Deploy target | Railway (web + worker services), Supabase; **not deployed** (Phases 1–2 are local only) |

## Local setup

Prerequisites: **Node 22.12+** and **Docker Desktop** (for the free local Supabase stack). No paid
service or account is needed.

```bash
npm install
npm run supabase:start          # local Supabase (Postgres, Auth, Mailpit) in Docker
cp .env.example .env.local      # then fill values from `npx supabase status`
npm run db:migrate              # apply committed SQL migrations
npm run db:seed                 # fictional demo data + demo users (local only)
npm run dev                     # http://localhost:3000
```

Optional: `npm run db:seed:synthetic` adds a separate **scale-demo** workspace with 12,000
fictional prospects for performance work, and `npm run perf:prospects` measures the prospect
queries through RLS (see [`docs/PERFORMANCE.md`](docs/PERFORMANCE.md)).

Sign in with any demo account (`owner@`, `admin@`, `operator@`, `viewer@`, `isolated@` at
`leadvault-demo.test`). The password is your `SEED_DEMO_PASSWORD` from `.env.local`.
Password-reset emails go to the local Mailpit inbox at http://127.0.0.1:54324, and nothing
leaves your machine.

### Environment variables

[`.env.example`](.env.example) lists every variable, with comments. It holds names only: **never
commit values**. `.env*` files are git-ignored except `.env.example`.

| Variable                                                           | Purpose                                                                           |
| ------------------------------------------------------------------ | --------------------------------------------------------------------------------- |
| `APP_ENV`                                                          | `local` / `staging` / `production`                                                |
| `APP_BASE_URL`                                                     | Base URL used in auth email links                                                 |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project (publishable key is public by design; used server-side for auth) |
| `SUPABASE_SECRET_KEY`                                              | **Server-only** admin key (seed now, invitations later)                           |
| `DATABASE_URL`, `DATABASE_MIGRATION_URL`                           | App and migration connections                                                     |
| `SEED_DEMO_PASSWORD`                                               | Demo-account password (local only)                                                |

## Database

All schema changes go through migrations. Tables live in the `app` schema, which Supabase's
auto-generated Data API does not expose.

| Command                                           | What it does                                                                        |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run db:generate`                             | Generate a migration from `src/db/schema` changes (review the SQL, commit it)       |
| `npx drizzle-kit generate --custom --name <name>` | Empty migration for hand-written SQL (policies, triggers, functions)                |
| `npm run db:migrate`                              | Apply migrations (`scripts/migrate.ts`; the future Railway pre-deploy command)      |
| `npm run db:check`                                | Validate migration history consistency                                              |
| `npm run db:seed`                                 | Fictional demo data (refuses to run unless `APP_ENV=local` and the DB is localhost) |
| `npm run db:seed:synthetic`                       | 12,000 fictional prospects in a separate `scale-demo` workspace (local only)        |
| `npm run db:reset`                                | Wipe the local DB, re-apply all migrations, re-seed                                 |
| `npm run perf:prospects`                          | Query timings and EXPLAIN ANALYZE under RLS (`-- --write` updates the report)       |
| `npm run db:studio`                               | Drizzle Studio                                                                      |

Migrations:

- `0000_init_schema`: all tables, keys, composite tenant foreign keys, CHECK constraints and
  indexes.
- `0001_security_rls`: helper functions, least-privilege grants, RLS on every table,
  `updated_at` triggers, the append-only audit trigger, and the `auth.users` → `profiles` sync.
- `0002_profile_email`: mirrors the auth email into `profiles` for team views.
- `0003_phase2_prospects_imports`: `pg_trgm`, the generated prospect search column with its
  trigram index, import lifecycle and row outcome columns, the eligibility cache expiry, and
  the list/filter indexes.
- `0004_rls_set_based`: the same RLS rules in a set-based form (membership is evaluated once
  per statement instead of once per row). List queries went from about 1.5 s to about 50 ms at
  12,000 prospects.

## Development commands

| Command                           |                                                                                                |
| --------------------------------- | ---------------------------------------------------------------------------------------------- |
| `npm run dev`                     | Dev server                                                                                     |
| `npm run build`                   | Production build (standalone output)                                                           |
| `npm run start:standalone`        | Run the production build on http://localhost:3100                                              |
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
    w/[workspaceSlug]/    Workspace-scoped app
      prospects/          List (filters, search, selection) and prospect detail; actions.ts
      audiences/          List, detail, members; actions.ts
      imports/            History, the import wizard, row-results CSV export; actions.ts
      suppression/        Suppression list, add and lift; actions.ts
    [module]/             /prospects etc. → last-used workspace
    api/health/           Liveness + DB check
  components/             UI: shell, states, dashboard, imports, prospects, audiences, suppression
    ui/                   shadcn/ui primitives (owned code)
  config/                 Navigation, module and settings definitions (single source)
  domain/                 Pure business rules (no I/O):
    eligibility.ts        THE eligibility engine and its reason codes
    imports/              CSV limits/parsing/escaping, field mapping, row planning
    prospects/            Normalization (email, website, phone, names), list filters
    geo.ts                Country and region normalization (ISO 3166)
    email-domain.ts       Business / consumer / unknown email-domain classification
    suppression.ts, verification.ts, jurisdiction.ts, permissions.ts, audit.ts, enums.ts
  services/               Data operations used by pages/actions (take a DB or RLS transaction):
                          import-service, prospect-query, eligibility-service,
                          suppression-service, audience-service
  db/
    schema/               Drizzle schema (app schema)
    migrations/           Committed SQL migrations
    client.ts             DB pool, withUserContext (RLS), systemDb (privileged), userTxRunner
    rls.ts                runAsUser: role `authenticated` + JWT claims per transaction
  providers/mailbox/      Provider contract, normalized results/errors, fake adapter, registry
  server/                 Server-only: auth/session, workspace resolution, audit, action results
  lib/                    Utilities (ids, formatting, safe redirects, Supabase client)
  proxy.ts                Session refresh, route protection, CSP nonce, request id
scripts/                  migrate, seed, seed-synthetic, perf-prospects, start-standalone
samples/                  Fictional sample CSV (reserved .example domains) + what each row shows
tests/unit, tests/db      Vitest suites
e2e/                      Playwright suites
supabase/                 Local stack config and auth email templates
```

## Security notes

- **Workspace isolation is enforced three times**: in the server data-access layer
  (`resolveWorkspace` / `can()`), by PostgreSQL RLS (queries run as role `authenticated` with
  the caller's JWT claims), and by composite `(workspace_id, id)` foreign keys. Malicious
  cross-workspace attempts (with real foreign ids) are covered by database tests.
- The browser never receives database or secret keys. All data access is server-side.
- Uploaded CSV content is stored only in the private database (`prospect_import_rows.raw`), is
  readable only by members of the workspace, and is never served publicly. Exported CSVs
  neutralize spreadsheet formulas (cells starting with `= + - @`, tab or carriage return).
- Suppression records are never deleted. Lifting one requires a reason and keeps the history.
  LeadVault-wide (global) suppressions can only be added or lifted by platform administrators.
- Public sign-up is disabled. Accounts are created by invitation only.
- The audit log is append-only, attributed to the caller, and its metadata is sanitized.
- **Never use real customer prospects or addresses in development.** All seed and sample data
  is invented and uses the reserved `.test` / `.example` domains.

## Deployment (later)

The `Dockerfile` builds the standalone web service for Railway (or Render/Fly/Cloud Run).
Production needs Railway **Pro** (outbound SMTP) and Supabase **Pro** (backups, no pausing); see
`docs/ARCHITECTURE.md` §24 and §29. **Nothing is deployed.**

---

# PART 2 — OWNER'S LOCAL TESTING GUIDE

This part is for trying LeadVault Outreach on your own Windows computer. You don't need to know
how to program. Everything runs **only on your computer**: no email is sent, nothing is
published, and all the data is invented.

## What you need (one-time)

1. **Docker Desktop** is installed and running. Look for the whale icon in the taskbar near the
   clock; it should say "Docker Desktop is running".
2. **Node.js 22** is installed.
3. The project folder is open in **VS Code** (`OUTREACH-LEADVAULT` on your Desktop).
4. A file called `.env.local` exists in the project folder. It holds the local settings,
   including the demo password. If it is missing, ask your developer to create it. Never share
   this file and never put it on GitHub.

To type commands, open the VS Code terminal: menu **Terminal → New Terminal**. A panel appears
at the bottom of the window. Type each command there and press **Enter**.

## Start the app

Run these one at a time, waiting for each to finish:

```
npm run supabase:start
npm run build
npm run start:standalone
```

- The first command starts the local database. The first time, it downloads Docker images
  and can take several minutes. Afterwards it takes about 30 seconds.
- The second command prepares the app (1–3 minutes).
- The third command runs it. Leave this terminal open while you use the app.

Then open your web browser at **http://localhost:3100**.

> First time only (or to start over with clean demo data), run `npm run db:reset` after the
> first command. It rebuilds the local database and the fictional demo data.

## Stop, and start again

- **Stop the app:** click into the terminal where it runs and press **Ctrl + C**.
- **Stop the database** (frees memory): `npm run supabase:stop`.
- **Restart:** run `npm run supabase:start`, then `npm run start:standalone`. You only need
  `npm run build` again after the code changes.

## Sign in

Use one of the demo accounts. Each has a different role, so you can see what each kind of user
may do:

| Email                          | Role                  | Can…                                                           |
| ------------------------------ | --------------------- | -------------------------------------------------------------- |
| `owner@leadvault-demo.test`    | Owner, platform admin | Everything, including LeadVault-wide suppression               |
| `admin@leadvault-demo.test`    | Admin                 | Everything in the workspace, including lifting suppressions    |
| `operator@leadvault-demo.test` | Operator              | Import prospects, build audiences, add suppressions            |
| `viewer@leadvault-demo.test`   | Viewer                | Look only; cannot change anything                              |
| `isolated@leadvault-demo.test` | Owner of another one  | Sees only the "Harbor Dental Group" workspace, never Northwind |

The password is the value after `SEED_DEMO_PASSWORD=` in your `.env.local` file. It is not
written here on purpose.

## The sidebar, section by section

| Section                                               | What it is                                                                                                                                                     |
| ----------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Dashboard**                                         | Prospect totals (eligible, review required, suppressed), recent imports and audiences. The campaign figures below them are **demo data** (marked "Demo data"). |
| **Prospects**                                         | Every company/contact in the workspace, with search, filters and eligibility. Click a company for its full detail.                                             |
| **Audiences**                                         | Saved groups of prospects for future campaigns, with their eligibility summary.                                                                                |
| **Imports**                                           | Upload a CSV of approved prospects and see the history of every import, row by row.                                                                            |
| **Campaigns, Inbox, Templates, Mailboxes, Analytics** | Explanations of what comes in later phases. They are not working yet.                                                                                          |
| **Suppression**                                       | The do-not-contact list: email addresses and whole domains that must never be contacted.                                                                       |
| **Settings**                                          | Workspace details, team members and roles, compliance (jurisdiction policies), and the audit log.                                                              |

## Try it: import the sample CSV

There is a fictional sample file at **`samples\leadvault-sample-prospects.csv`**. Every
company and person in it is invented, and all addresses use `.example` domains that can never
receive email. [`samples/README.md`](samples/README.md) explains what each row demonstrates.

1. Sign in as **operator@leadvault-demo.test**.
2. Go to **Imports → New import**.
3. Drag the sample file onto the upload area, or click it and choose the file. The page shows
   the file name, its size and about 16 rows. Click **Upload and continue**.
4. **Map columns.** The app suggests a match for every standard column. "Specialty" is not a
   standard field, so it stays "Ignore" (an Admin could keep it as a custom field). Click
   **Save mapping and continue**.
5. **Settings.** Give the import a name. Leave "Default country" empty: the app never assumes a
   country. Click **Validate and preview**.
6. **Preview.** Every row shows what will happen and why: ready, review required, invalid,
   duplicate, and so on. Nothing has been saved yet.
7. Click **Import** and confirm. The results page shows the outcome of every row. You can
   download the results as a CSV.

Importing the same file again does **not** create duplicates. Existing prospects are recognized
and updated or left unchanged, and the app warns that the file was uploaded before.

## Try it: inspect prospects and eligibility

1. Open **Prospects**. The shortcuts at the top (All / Eligible / Review required /
   Ineligible / Suppressed) filter the list. **More filters** adds state, business type, import,
   audience and data completeness.
2. Search for **Lone Star**, then click **Lone Star Family Clinic**.
3. The detail page shows company, contact, location, qualification, email verification,
   audiences, where the record came from (provenance) and its activity.
4. The **Eligibility** box explains the decision. Lone Star is _Eligible_: it is in Texas, and
   the demo workspace has a **demo-only** Texas policy so you can see the eligible path. Open
   **Peach State Orthodontics** (Georgia): it is _Review required_ with the reason "Jurisdiction
   not approved", because no policy has been set for Georgia.

**What "eligible" means.** A prospect is eligible only when it passes every rule:

- It has a valid business email.
- The email was verified within the last 90 days.
- The email domain matches the company website.
- The address is not a role mailbox like `info@`.
- It is not suppressed or unsubscribed.
- Its country or state has an approved outreach policy.

**No country is ever assumed to be legally approved.** Places without a policy stay _Review
required_. The Texas policy in the demo workspace is fictional and exists only to demonstrate
the screens. Real policies are an owner/legal decision (**Settings → Compliance**).

## Try it: create an audience

1. Sign in as **operator@** (or owner/admin), open **Prospects** and filter, for example
   Country = United States.
2. Tick the box at the top of the list to select the page. A bar appears: "Select all N
   matching" selects every matching prospect, not just this page.
3. Click **Add to audience** → **Create a new audience**, give it a name, and choose which
   prospects to include (by default only the _eligible_ ones).
4. The app reports exactly what happened: how many were added, how many were already members,
   and how many were left out and why. Nothing is silently dropped.
5. Click **Open audience** to see the members and their eligibility summary. To remove members,
   tick them and click **Remove from audience**. This only removes them from the audience, never
   from the workspace.

## Try it: suppression

1. Sign in as **admin@leadvault-demo.test** and open **Suppression**.
2. Click **Add suppression**. Enter an email such as
   `avery.collins@lonestar-family-clinic.example` (from the sample file), choose a reason and
   write a note.
3. Open that prospect: it is now **Suppressed** ("Workspace suppression"). Suppression
   always wins over audiences and campaigns.
4. Back on **Suppression**, click **Lift** and enter a reason (at least 10 characters). The
   prospect becomes contactable again only if every other rule passes. The record stays in the
   history (filter Status = Lifted).

Operators can add suppressions but cannot lift them. Only the platform owner can add or lift
LeadVault-wide ones. The demo data also includes an **unsubscribe record** (an unsubscribed
contact in the Texas list), which shows on its prospect page and makes it **Suppressed**.

## Try it: roles and isolation

- Sign in as **viewer@**: you can look at everything, but there are no Import, selection or
  suppression controls, and opening _New import_ directly says you don't have access.
- Sign in as **isolated@**: you only see "Harbor Dental Group". If you paste a Northwind page
  address, the app says "Workspace not available".

## What is NOT implemented yet

No email is sent, or can be sent. These parts come in later phases:

- Campaign builder, sequences and scheduling
- Sending (no worker, SMTP or job queue), mailboxes and warm-up
- Inbox and reply or bounce handling, and the public unsubscribe link
- Paid email verification, AI features, billing, public sign-up, deployment to a real server

Excel files (.xlsx) are not accepted. Save as **CSV UTF-8** first.

## Troubleshooting

| Problem                                                    | What to do                                                                                                               |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `npm run supabase:start` says Docker is not running        | Start Docker Desktop, wait until it says "running", and try again.                                                       |
| The browser says "This site can't be reached"              | The app isn't running. Run `npm run start:standalone` and keep that terminal open.                                       |
| "Port 3100 is already in use"                              | The app is already running in another terminal. Use that one, or close it with Ctrl + C.                                 |
| Sign-in says the email or password is wrong                | Check the `SEED_DEMO_PASSWORD` value in `.env.local`. If the database was reset without seeding, run `npm run db:reset`. |
| "LeadVault Outreach is unavailable" right after signing in | This was seen twice, during slow runs when the computer's network was briefly suspended. Click **Try again** or reload.  |
| Pages show old data after changing code                    | Stop the app (Ctrl + C), run `npm run build`, then `npm run start:standalone`.                                           |
| You want a clean start                                     | `npm run db:reset` (deletes all local data and recreates the fictional demo data).                                       |
| The upload is rejected                                     | Only `.csv` files up to 5 MB and 10,000 rows, UTF-8 encoded, with column headers in the first row.                       |
