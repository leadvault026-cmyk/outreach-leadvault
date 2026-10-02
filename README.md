# LeadVault Outreach

LeadVault Outreach is LeadVault's authenticated B2B outreach application. It starts where LeadVault
research ends: it takes **approved prospect intelligence** (handed over as CSV) and runs it through
import → prospects → audiences → campaigns → email sequences → preview → scheduling → safe
execution → replies / bounces / unsubscribes → stop rules → campaign results.

It is **not** the leadvaultdata.com marketing site, and it is **not** a prospect research or
acquisition engine. The architecture source of truth is
[`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

> **Status: software MVP complete, running with a FAKE email transport.** The whole workflow
> works end to end on your computer: campaigns, sequences, personalization, scheduling, a
> background worker, replies, bounces, unsubscribes and results. Emails are processed by a
> **fake transport** that records them as sent — **no real email is ever sent**. Real sending
> needs a purchased mailbox provider; that is a separate, controlled step (see the end of Part 2).

This README has two parts:

1. [**Developer setup**](#part-1--developer-setup): for engineers working on the code.
2. [**Owner's local testing guide**](#part-2--owners-local-testing-guide): plain-language steps
   for trying the app on your own Windows computer.

---

# PART 1 — DEVELOPER SETUP

## Technology

| Area          | Choice                                                                               |
| ------------- | ------------------------------------------------------------------------------------ |
| App           | Next.js 16 (App Router), React 19, TypeScript (strict)                               |
| UI            | Tailwind CSS v4, shadcn/ui on Radix primitives, lucide icons, Recharts               |
| Database      | PostgreSQL (Supabase), Drizzle ORM + drizzle-kit migrations, postgres.js, `pg_trgm`  |
| Auth          | Supabase Auth (email + password, invite-only), `@supabase/ssr` HTTP-only cookies     |
| CSV           | papaparse (parsing), own encoder with formula-injection protection (export)          |
| Validation    | Zod                                                                                  |
| Tests         | Vitest (unit + PGlite database tests), Playwright + axe (end-to-end, accessibility)  |
| Worker        | Separate Node process (`npm run worker`): PostgreSQL-backed loops with `SKIP LOCKED` |
| Deploy target | Railway (web + worker services), Supabase; **not deployed** (local only)             |

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
npm run worker                  # in a second terminal: the campaign worker (fake transport)
```

`.env.local` also needs `UNSUBSCRIBE_SIGNING_SECRET` (at least 32 random characters) for
unsubscribe links. Generate one with
`node -e "console.log(require('crypto').randomBytes(36).toString('base64url'))"` and keep it out of
Git. `EMAIL_TRANSPORT=fake` (the default) never sends anything.

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

| Variable                                                           | Purpose                                                                             |
| ------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| `APP_ENV`                                                          | `local` / `staging` / `production`                                                  |
| `APP_BASE_URL`                                                     | Base URL used in auth email links                                                   |
| `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | Supabase project (publishable key is public by design; used server-side for auth)   |
| `SUPABASE_SECRET_KEY`                                              | **Server-only** admin key (seed now, invitations later)                             |
| `DATABASE_URL`, `DATABASE_MIGRATION_URL`                           | App and migration connections                                                       |
| `SEED_DEMO_PASSWORD`                                               | Demo-account password (local only)                                                  |
| `EMAIL_TRANSPORT`                                                  | `fake` (default: nothing leaves the machine) or `live` (needs a connected provider) |
| `SENDING_ENABLED`                                                  | Kill switch: `false` stops the worker from sending anything                         |
| `UNSUBSCRIBE_SIGNING_SECRET`                                       | **Secret** HMAC key for unsubscribe links (≥ 32 characters)                         |
| `UNSUBSCRIBE_BASE_URL`                                             | Public base URL in unsubscribe links (defaults to `APP_BASE_URL`)                   |

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
| `npm run worker`                  | Campaign worker (`-- --once` processes what is due now and exits)                              |
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
      campaigns/          List, builder (settings, sequence, preview & launch, recipients, results)
      templates/          Plain-text email templates with personalization
      inbox/              Replies, one row per conversation; classification
      mailboxes/          Sending mailboxes, limits and health
      analytics/          Basic campaign results
    [module]/             /prospects etc. → last-used workspace
    u/[token]/            Public unsubscribe confirmation page (signed token, no login)
    api/unsubscribe/      Unsubscribe endpoint (RFC 8058 one-click POST + confirmation button)
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
    personalization.ts    {{tokens}}, fallbacks, validation, rendering (never "Hi undefined")
    compose.ts            The exact email (subject, body, opt-out footer) — preview = what is sent
    campaigns.ts          Campaign/recipient states, time zones and sending windows
    inbound.ts            Reply / auto-reply / bounce / opt-out classification
    unsubscribe-token.ts  Signed, stateless unsubscribe tokens
    suppression.ts, verification.ts, jurisdiction.ts, permissions.ts, audit.ts, enums.ts
  services/               Data operations used by pages/actions (take a DB or RLS transaction):
                          import-service, prospect-query, eligibility-service,
                          suppression-service, audience-service, campaign-service,
                          template-service, send-engine (worker loops), inbound-service,
                          inbox-service, mailbox-service, recipient-control (stop rules)
  worker/main.ts          The worker process (lifecycle, dispatcher, executor, reconciliation)
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
- **Sending safety.** At most one message per recipient and step (unique index), work claimed
  with `FOR UPDATE SKIP LOCKED` and leases, fenced result writes, one in-flight send per mailbox,
  daily limits enforced atomically. A send with an uncertain result is **never retried
  automatically**: it waits for positive evidence or an Admin's decision. Eligibility is
  re-checked with the authoritative engine right before every send.
- **Fake transport is never "production".** The worker refuses the fake transport when
  `APP_ENV=production`, and demo workspaces (whose jurisdiction policy is demo-only) can never use
  a live transport.
- **Unsubscribe links** are HMAC-signed, reveal nothing about the recipient, and GET never
  unsubscribes (link scanners prefetch URLs); the opt-out is a POST.
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

**Fastest route:** follow [Start the app](#start-the-app), then
[The complete demonstration](#the-complete-demonstration-about-15-minutes).

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

You use **two terminals**: one for the app, one for the worker that sends campaign emails.

**Terminal 1** (menu Terminal → New Terminal). Run these one at a time, waiting for each to
finish:

```
npm run supabase:start
npm run build
npm run start:standalone
```

- The first command starts the local database. The first time, it downloads Docker images
  and can take several minutes. Afterwards it takes about 30 seconds.
- The second command prepares the app (1–3 minutes).
- The third command runs it. Leave this terminal open while you use the app.

**Terminal 2** (click the **+** in the terminal panel to open a second one):

```
npm run worker
```

The worker prints a line whenever it does something, for example
`Sent message 3f2a9c1d (fake transport).` Its first lines say
**"Transport: FAKE — … NO email leaves this computer."** Leave it open too.

Then open your web browser at **http://localhost:3100**.

> First time only (or to start over with clean demo data), run `npm run db:reset` after the
> first command. It rebuilds the local database and the fictional demo data.

## Stop, and start again

- **Stop the app and the worker:** click into each terminal and press **Ctrl + C**.
- **Stop the database** (frees memory): `npm run supabase:stop`.
- **Restart later:** Terminal 1: `npm run supabase:start`, then `npm run start:standalone`.
  Terminal 2: `npm run worker`. You only need `npm run build` again after the code changes.
  Your data is kept between restarts (until you run `npm run db:reset`).

## Sign in

Use one of the demo accounts. Each has a different role, so you can see what each kind of user
may do:

| Email                          | Role                  | Can…                                                           |
| ------------------------------ | --------------------- | -------------------------------------------------------------- |
| `owner@leadvault-demo.test`    | Owner, platform admin | Everything, including LeadVault-wide suppression               |
| `admin@leadvault-demo.test`    | Admin                 | Everything in the workspace, including lifting suppressions    |
| `operator@leadvault-demo.test` | Operator              | Import, audiences, templates, campaigns, Inbox, suppressions   |
| `viewer@leadvault-demo.test`   | Viewer                | Look only; cannot change anything                              |
| `isolated@leadvault-demo.test` | Owner of another one  | Sees only the "Harbor Dental Group" workspace, never Northwind |

The password is the value after `SEED_DEMO_PASSWORD=` in your `.env.local` file. It is not
written here on purpose.

## What is real, and what is fake

| REAL (works exactly as it will in production)                                                      | FAKE / TEST ONLY                                                                                        |
| -------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| Import, prospects, eligibility, suppression, audiences                                             | The **email transport**: messages are recorded as "sent", but nothing is delivered to anyone            |
| Campaigns, templates, sequences, personalization, preview, scheduling, pause / resume / stop       | The **mailboxes** (`@northwind-outreach.example`) are fictional; no real mailbox is connected           |
| The worker: choosing due emails, the final eligibility check, limits, duplicate protection, timing | **Replies and bounces** are simulated with a recipient's **Test** menu (there is no real inbox to read) |
| Reply, bounce and unsubscribe processing, and the stop rules                                       | All people, companies and addresses (reserved `.example` / `.test` domains)                             |
| The public unsubscribe page and its link in every email                                            | The demo Texas jurisdiction policy (demo workspaces only; never a legal approval)                       |
| Inbox, results, audit log, roles and workspace isolation                                           |                                                                                                         |

Simulated replies and bounces go through the **same processing** a real mailbox would use; only
their origin is simulated.

## The sidebar, section by section

| Section         | What it is                                                                                                                           |
| --------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Dashboard**   | Prospect totals, recent imports, audiences, and campaign activity (emails sent, replies, mailbox health) from real application data. |
| **Prospects**   | Every company/contact in the workspace, with search, filters and eligibility. Click a company for its full detail.                   |
| **Audiences**   | Saved groups of prospects for campaigns, with their eligibility summary.                                                             |
| **Imports**     | Upload a CSV of approved prospects and see the history of every import, row by row.                                                  |
| **Campaigns**   | Create a campaign (audience, schedule, a short email sequence), preview it, launch it, then follow its results and recipients.       |
| **Inbox**       | Replies to your campaigns, one row per conversation. Mark each as Interested, Not interested, Unsubscribe and so on.                 |
| **Templates**   | Reusable plain-text emails with personalization fields such as `{{first_name}}`.                                                     |
| **Mailboxes**   | The sending mailboxes, their daily limits and how much they sent today; also shows whether the worker is running.                    |
| **Analytics**   | Basic results for every launched campaign: sent, replies, reply rate, bounces, unsubscribes.                                         |
| **Suppression** | The do-not-contact list: email addresses and whole domains that must never be contacted.                                             |
| **Settings**    | Workspace details (including the postal address printed in every email), team, compliance policies, and the audit log.               |

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

## The complete demonstration (about 15 minutes)

Start the app **and** the worker first (see [Start the app](#start-the-app)). Sign in as
**operator@leadvault-demo.test**. The demo data already contains an audience called **Texas
Medical Providers**, three email templates and fictional mailboxes. (You can also import the
sample CSV first and build your own audience; see the sections below.)

**1. Look at the templates.** Open **Templates** and click **1 · Introduction**. Fields like
`{{first_name|there}}` are filled in for each prospect ("there" is used when the first name is
empty); the right side shows a preview with a fictional contact. An unknown field such as
`{{firstname}}` is refused when you save.

**2. Create a campaign.** Open **Campaigns → New campaign**.

- Name: anything, for example "Texas test".
- Audience: **Texas Medical Providers**. Sending mailbox: **Alex Romero**.
- Start: **As soon as it is launched**.
- Tick **Any day and time** (so the test also works in the evening and at weekends).
- Click **Create campaign and write the sequence**.

**3. Build a 3-step sequence.** On the **Sequence** tab:

- Step 1: "Start from a template" → **1 · Introduction**.
- Click **Add follow-up**. Choose **2 · Follow-up**, and set "Wait after the previous email" to
  **2 minutes** (real campaigns use days; minutes keep the demo short). Leave its subject empty
  so it replies in the same thread ("Re: …").
- Click **Add follow-up** again: **3 · Final note**, **2 minutes**.
- Click **Save sequence**.

**4. Preview.** Open **Preview & launch**.

- The tiles show how many prospects **will receive** the campaign and how many are left out
  (review required, ineligible, suppressed, missing personalization).
- **Who is left out, and why** lists every reason in plain language. Nobody is dropped silently.
- **Personalized preview** shows the three emails exactly as one prospect would receive them,
  including the opt-out line and the postal address. Pick another prospect from the list to
  compare.

**5. Launch.** Click **Launch campaign → Launch now**. The status becomes **Running**.

**6. Watch the worker.** In Terminal 2 you will see lines such as `Queued 22 email(s) to send.`
and `Sent message … (fake transport).`, about one email every 5 seconds (the demo mailbox waits
between emails, like a careful real mailbox). On the campaign's **Results** tab, "Emails sent"
goes up each time you reload the page.

**7. Simulate a reply.** Open the **Recipients** tab. Each prospect who has been emailed has a
**Test** button. On one of them choose **Simulate a reply**. The message confirms: _"Reply
recorded: the remaining sequence for this prospect has stopped."_ Its status becomes
**Replied**.

**8. Confirm the sequence stopped.** Wait two or three minutes and reload. Everyone else has
moved on to `2 of 3 sent`, but the prospect who replied stays at **1 of 3 sent**: no follow-up
goes to someone who answered.

**9. Simulate a hard bounce.** On another recipient choose **Test → Simulate a hard bounce**.
Its status becomes **Bounced**, and no further email goes to it.

**10. Confirm the suppression.** Open **Suppression** (sidebar), choose Status **All**, and
search for that prospect's email. It is listed as **LeadVault-wide**, reason **Hard bounce**: no
workspace will email that address again.

**11. Test the unsubscribe link.** On a third recipient choose **Test → Open this recipient's
unsubscribe page**. A new tab shows the page the prospect would see: no name, no company,
nothing about them. Click **Unsubscribe** → _"You have been unsubscribed."_ Back on the
campaign, that recipient is **Unsubscribed** and receives nothing more. This page is fully
real: every email contains a personal link to it.

**12. View the Inbox.** Open **Inbox**. The reply from step 7 is there, with the prospect, the
campaign and the time. Open it to see the whole conversation (your emails and their answer), and
click **Interested**.

**13. View the results.** Back on the campaign's **Results** tab (or **Analytics**): recipients,
emails sent, replied (1), positive replies (1), bounced (1), unsubscribed (1), remaining.
"Delivered" and "opened" are intentionally not shown: they cannot be measured reliably.

**14. Pause, resume, stop.** **Pause** holds every remaining email, **Resume** continues, and
**Stop** ends the campaign for good. Nothing more is sent after Stop.

> To repeat the demonstration, create a new campaign. Prospects already in a running campaign
> are left out of a second one ("Already in another running campaign"), so stop the first
> campaign before you start another one with the same audience, or reset everything with
> `npm run db:reset`.

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

- Sign in as **viewer@**: you can look at everything, but there are no Import, campaign,
  template, selection or suppression controls, and opening _New import_ or _New campaign_
  directly says you don't have access.
- Sign in as **isolated@**: you only see "Harbor Dental Group". If you paste a Northwind page
  address, the app says "Workspace not available".

## Before REAL email can be sent

The software is complete. Real sending is a separate, controlled step that needs decisions and
purchases that have not been made:

1. A mailbox provider must be purchased and set up (for example Mission Inbox or Infraforge),
   with proper DNS for the sending domain.
2. A live provider adapter must be connected to the existing provider boundary, with
   credentials stored encrypted (`CREDENTIALS_ENCRYPTION_KEY`).
3. Real jurisdiction policies must be decided with legal counsel (**Settings → Compliance**).
   Until then every place stays _Review required_, and nothing can be sent there.
4. Hosting (Railway Pro for outbound mail, Supabase Pro), a public address for unsubscribe
   links, and production secrets.
5. Then `EMAIL_TRANSPORT=live` is switched on deliberately, starting with a small allowlist.

Not part of this application at all: AI writing, scraping or prospect discovery, billing, public
sign-up, open/click tracking, Excel (.xlsx) import. Save spreadsheets as **CSV UTF-8**.

## Troubleshooting

| Problem                                                              | What to do                                                                                                                                                      |
| -------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run supabase:start` says Docker is not running                  | Start Docker Desktop, wait until it says "running", and try again.                                                                                              |
| The browser says "This site can't be reached"                        | The app isn't running. Run `npm run start:standalone` and keep that terminal open.                                                                              |
| "Port 3100 is already in use"                                        | The app is already running in another terminal. Use that one, or close it with Ctrl + C.                                                                        |
| Sign-in says the email or password is wrong                          | Check the `SEED_DEMO_PASSWORD` value in `.env.local`. If the database was reset without seeding, run `npm run db:reset`.                                        |
| Sign-in says "Couldn't reach the server"                             | The local sign-in service (in Docker) briefly lost its database connection, usually right after the computer was idle. Wait a few seconds and sign in again.    |
| A campaign stays "Running" but nothing is sent                       | The worker is not running. Start it in a second terminal: `npm run worker`. The campaign page shows "Worker running" when it is.                                |
| "Not ready to launch: … postal address is not set"                   | Sign in as the owner and add it in **Settings → Workspace** (the demo workspaces already have a fictional one).                                                 |
| "Not ready to launch: No audience member can be contacted right now" | Everyone is excluded (see "Who is left out, and why"), often because they are already in another running campaign. Stop that campaign, or use another audience. |
| The worker says "UNSUBSCRIBE_SIGNING_SECRET is missing"              | Ask your developer to add it to `.env.local` (Part 1 shows how), then restart the app and the worker.                                                           |
| Emails stop after about 50 in a day                                  | That is the mailbox's daily limit (Mailboxes → Settings). It protects real mailboxes, and resets the next day.                                                  |
| Pages show old data after changing code                              | Stop the app (Ctrl + C), run `npm run build`, then `npm run start:standalone`.                                                                                  |
| You want a clean start                                               | `npm run db:reset` (deletes all local data and recreates the fictional demo data).                                                                              |
| The upload is rejected                                               | Only `.csv` files up to 5 MB and 10,000 rows, UTF-8 encoded, with column headers in the first row.                                                              |
