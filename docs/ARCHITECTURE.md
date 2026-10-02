# LeadVault Outreach — Architecture Proposal

Status: **APPROVED — Phase 1 (foundation) implemented. §32 records implementation notes and departures.**
Prepared: 2026-10-01 · Revision 2: email-infrastructure verification gate · **Revision 3 (2026-10-01): outreach sending-infrastructure market investigation (§14.7)**

**Revision 3 changes:** the outreach provider market was screened from official terms (§14.7). **Mission Inbox (Sales)** expressly permits B2B cold outreach with explicit conditions and becomes the **primary** infrastructure, with **Infraforge** as fallback, both via a generic SMTP/IMAP adapter. Google Workspace is demoted to last-resort fallback. One technical contradiction was found and resolved: Railway blocks outbound SMTP below **Pro**, so production/staging use Railway Pro. Added: warm-up/ramp enforcement, provider-threshold guardrails, pre-send email verification, and the B2B-only rule. Locked decisions are unchanged.
Scope: architecture, research and planning only (brief §46).

**Revision 2 changes:** email-provider policies re-verified against official documents only (§14.1). The earlier claim that Google/Microsoft mailboxes are "allowed" for cold outreach is **corrected to UNCLEAR**. Gmail scopes are now mapped per function, with Google's classification (§14.3). Google verification/assessment rules are stated per app type (§14.4), and reply/bounce ingestion alternatives compared (§14.5). Ambiguous-send recovery is redesigned around `RECONCILIATION_REQUIRED` with positive-confirmation-only auto-resolution (§11–12). Suppression scopes are made explicit (§18), and the US-only defaults are replaced by country/jurisdiction support (§4.3, §10). Unverified CASA cost/duration estimates are removed.

Pricing and limits below were checked against official provider pages on 2026-10-01 unless marked **(secondary source)** or **(not re-verified)**. Prices change often, so re-check them before purchase. Sources are listed at the end.

---

## 0. The findings that shape everything

Four research results change the shape of the system. Read these first.

1. **Transactional email APIs prohibit cold outreach, and no mailbox provider expressly permits it** (verified, §14.1). Resend, Amazon SES, SendGrid and Postmark all require recipient opt-in/permission in their official policies, so they are **NOT SUITABLE** for outreach. Google Workspace and Microsoft 365 do **not** expressly prohibit individual, lawful B2B email: their governing AUPs prohibit "unsolicited **mass** email" and "spam". But they do not expressly permit it either, and other official Google/Microsoft pages use broader "unsolicited commercial mail" wording. Status: **UNCLEAR**. **Revision 3 resolved this:** dedicated cold-outreach infrastructure providers (Mission Inbox, Infraforge, Mailforge) **expressly permit** lawful B2B cold outreach in their terms, so outreach now runs on those (§14.7). A transactional provider (Resend) is still used, but **only for system email** (password resets, invitations, alerts), which is solicited.
2. **Mailbox-native sending changes the event model.** There is no "delivered" webhook. Replies **and bounces** arrive as messages in the sending mailbox and must be ingested by mailbox sync. Therefore "Delivered" is not reliably available (brief §29 anticipated this), and bounce handling means parsing DSN/NDR reports.
3. **Serverless-only hosts cannot run the engine alone.** Vercel Hobby forbids commercial use and limits cron to once per day. Vercel Pro functions cap at 800s. Supabase Edge Functions cap at 2s CPU and 400s wall-clock, and block outbound ports 25/587. Netlify has no persistent processes. Lovable Cloud's backend is only Supabase Edge Functions. A **persistent worker process** is the simplest reliable design, so it drives the hosting choice.
4. **Google OAuth is cheap for LeadVault's own mailboxes and expensive for customers' mailboxes.** An OAuth app with user type **Internal** (used only by people in the Workspace org that owns the Cloud project) needs **no Google verification**, even with restricted Gmail scopes. Connecting mailboxes in **other** organisations needs an **External** app. If it requests restricted scopes, that means restricted-scope verification plus a security assessment by a Google-empanelled assessor, repeated **at least every 12 months**. Reading replies through the Gmail API needs a **restricted** scope (§14.3). An inbound-routing ingestion design can avoid restricted scopes for future customer mailboxes (§14.5). **External customer Gmail connections are deferred from MVP.**

---

## 1. Executive Architecture Summary

LeadVault Outreach is a single TypeScript codebase deployed as **two processes**:

- **Web**: a Next.js app (UI, server actions, API/webhook routes, public unsubscribe endpoint).
- **Worker**: a long-running Node process (scheduler/dispatcher, send executor, mailbox sync, bounce/reply processing, imports, maintenance).

Both share one **Supabase PostgreSQL** database. Postgres is the system of record **and** the queue: there is no Redis. The domain tables (`campaign_recipients`, `messages`) are the authoritative schedule and outbox. **pg-boss** (a Postgres-backed job library) handles generic background jobs, retries, cron and dead-lettering.

Email is sent **from LeadVault-controlled mailboxes** through a provider-adapter interface. The first adapter is a generic **SMTP/IMAP adapter** on **Mission Inbox** cold-outreach mailboxes (Infraforge as fallback), chosen because their terms expressly permit B2B outreach (§14.7). Gmail API / Microsoft Graph adapters remain optional fallbacks behind the same interface.

The key guarantees come from database structure, not code discipline:

- **No duplicate sends**: a unique `(campaign_recipient_id, step_number)` on `messages`, deterministic `Message-ID` + `X-LV-Message-Id` headers, lease-based claiming with `FOR UPDATE SKIP LOCKED`, one in-flight send per mailbox, and a `RECONCILIATION_REQUIRED` state for any ambiguous result. That state is auto-resolved **only on positive evidence** of a send. It is **never auto-retried**, and an operator decides if no evidence appears (§12).
- **No send after reply, unsubscribe, bounce or suppression**: a pre-send recheck inside the claim transaction, plus state-guarded updates.
- **No cross-workspace access**: a workspace-scoped data-access layer, composite tenant foreign keys, and Supabase RLS as a second layer.

**Recommended hosting:** GitHub → **Railway** (web service + worker service, auto-deploy from `main`, PR environments) + **Supabase Pro**.
**Realistic early production cost:** about **$45–55/month** in platform fees (Railway Pro + Supabase Pro), plus **≈$50/month** sending infrastructure (Mission Inbox Lite), outreach domains and an email-verification service (§29).

---

## 2. Final Recommended Technology Stack

| Layer | Choice | Why (and what was rejected) |
|---|---|---|
| Language | **TypeScript (strict)** on **Node 24 LTS** | One language across web, worker and shared domain logic. |
| Framework | **Next.js (current stable, App Router), React 19** | Server Components keep data fetching on the server. Run as a **persistent Node server** (`next start`, `output: 'standalone'`), not serverless. |
| UI system | **Tailwind CSS v4 + shadcn/ui (Radix primitives)**, **TanStack Table**, **Recharts** (via shadcn charts), **lucide** icons, **Inter** or **Geist** font | We own the component code (no black-box kit). Radix gives accessible dialogs, menus and focus management. TanStack Table is headless with server-side pagination and sorting. |
| URL/filter state | **nuqs** (typed URL search params) | Filters, sorting and pagination live in the URL, so they are shareable, survive reloads, and work with server rendering. |
| Forms / validation | **React Hook Form + Zod** | Zod schemas are shared by the client form, server action, worker and import pipeline: one definition of "valid". |
| Database | **PostgreSQL** (locked) | — |
| DB hosting | **Supabase** (Free for staging, **Pro** for production) | Managed Postgres with auth, storage, backups, pooler and RLS. No technical blocker found. See §2a. |
| ORM / query layer | **Drizzle ORM + drizzle-kit**, driver **postgres.js** | SQL-shaped: partial unique indexes, CHECK constraints, `FOR UPDATE SKIP LOCKED`, CTEs and RLS policies are all expressible and typed. Light enough for a worker. Prisma was rejected for this app: its DX is excellent, but the features this app depends on most (locking queries, partial indexes, RLS context) push you into raw SQL anyway. |
| Migrations | drizzle-kit **generated SQL files, reviewed and committed**. Applied by a Railway **pre-deploy** command. Local stack via **Supabase CLI**. | One migration source of truth. Use expand/contract migrations so old and new web/worker versions coexist during deploys. |
| Authentication | **Supabase Auth** (email + password, invite-only, signups disabled, optional TOTP MFA) via **@supabase/ssr** cookies | No extra vendor. Works with RLS. Custom SMTP (Resend) required, because the built-in mailer allows only 2 emails/hour and only to team addresses. |
| Authorization | App-layer role checks in a workspace-scoped DAL **plus** Postgres RLS | Defense in depth (§7). |
| Background jobs | **pg-boss** inside the worker process | Postgres-backed (`SKIP LOCKED`), with retries/backoff, cron, singleton keys, dead-letter queues and throttling. No Redis. |
| Scheduler / send queue | **Domain tables as the queue** (`campaign_recipients.next_send_at`, `messages.status`) driven by worker loops | The schedule *is* business state, so it cannot drift from a separate queue (§13). |
| Outreach email | **`SmtpImapAdapter` on Mission Inbox (Sales) mailboxes** (primary), **Infraforge** fallback on the same adapter. `GoogleWorkspaceAdapter` is last-resort/post-MVP. | Expressly-permitting infrastructure (§14.7). ESPs are NOT PERMITTED; Google/Microsoft are UNCLEAR. |
| Gmail OAuth scopes (fallback only) | `gmail.send` (sensitive) + `gmail.readonly` (restricted), Internal app | §14.3. Applies only if the Google fallback is ever enabled. |
| System email | **Resend** (free tier: 3,000/month, 100/day) | Auth emails, invitations, operator alerts only. Never prospect email. |
| Reply ingestion | Ingestion is its own interface. MVP: **IMAP polling** (UID cursor) per mailbox every 2–5 min (IMAP IDLE optional). Gmail API / inbound routing remain alternative ingestors. | §14.5, §14.7 |
| CSV parsing | **Papa Parse** (streaming) in the worker; file in a private Supabase Storage bucket | Large files never pass through a request body or the browser's memory. |
| Search | Postgres **pg_trgm** GIN indexes | No search service needed at this scale. |
| Date/time | **Luxon** (or @date-fns/tz) with IANA zones | Sending windows across DST need a real timezone library. |
| Testing | **Vitest** (unit/integration), **fast-check** (state-machine property tests), **Playwright** (E2E), local Postgres via Supabase CLI | §26 |
| Logging / errors | **pino** structured JSON logs with redaction → Railway logs; **Sentry** (free Developer tier to start) | §27 |
| Uptime | Free external uptime checker (e.g. Better Stack / UptimeRobot free tier) on `/api/health` | Health includes worker-heartbeat freshness. |
| Deployment | **GitHub → Railway Pro** (2 services: `web`, `worker`) + Supabase Pro. Pro is required because Railway blocks outbound SMTP below Pro. | §24, §14.7.4 |

### 2a. Supabase evaluation (brief §3)

| Concern | Finding | Decision |
|---|---|---|
| Postgres | Full Postgres with extensions (`pg_trgm`, `pgcrypto`; `pg_cron`/`pgmq` available) | ✅ Host the DB on Supabase. |
| Auth | Email/password, invites, password recovery, MFA (TOTP), SSR cookie helpers. Default SMTP limited to **2 msgs/hour**, team addresses only. | ✅ Use it, with custom SMTP (Resend). |
| RLS | First-class. Drizzle can declare policies and run queries under the `authenticated` role with JWT claims inside a transaction. | ✅ Defense in depth. |
| Pooling | Supavisor: **session mode** (5432, IPv4) for persistent servers; **transaction mode** (6543) for serverless (no prepared statements). Direct connection is **IPv6** unless you buy the IPv4 add-on. Pro Micro includes 200 pooler connections. | Web and worker on Railway use **session mode** with small pools (about 5 each). Migrations use session mode or direct connection. The IPv4 add-on is not needed. |
| Backups | Pro: daily backups, 7-day retention. PITR is $100/month per 7 days. | Daily backups are enough for MVP. Add a weekly `pg_dump` to separate storage for portability (cheap insurance). |
| Free plan | 500 MB DB, **pauses after 1 week inactive**, no backups | Fine for **staging/dev**, **not** for production. |
| Background compute | Edge Functions: 2s CPU, 150s/400s wall-clock, ports 25/587 blocked. Cron: sub-minute, max 8 concurrent jobs, 10 min each. | Not used as the primary engine (lock-in to Deno runtime, limits). Kept as an emergency fallback runtime. |
| Lock-in | Data is plain Postgres. Auth is the stickiest piece. | Keep `auth.users` references minimal (`user_id` UUIDs). The app never relies on Supabase-only SQL beyond auth helpers. |

---

## 3. System Architecture Diagram

### 3a. Outbound path

```
 Browser (LeadVault staff)
    │  HTTPS (Supabase session cookie)
    ▼
 ┌──────────────────────────── Railway ────────────────────────────┐
 │  WEB service (Next.js, persistent Node)                          │
 │   • Server Components / Server Actions (workspace-scoped DAL)    │
 │   • /api/webhooks/*   • /u/[token] unsubscribe   • /api/health   │
 │                                                                  │
 │  WORKER service (Node, same repo)                                │
 │   • Dispatcher loop  (due recipients → messages outbox)          │
 │   • Executor loop    (claim message → provider send)             │
 │   • pg-boss jobs     (imports, mailbox sync, bounces, reconcile, │
 │                       token refresh, retention, rollups)         │
 └──────────────┬───────────────────────────────┬───────────────────┘
                │ Supavisor (session mode)       │ Provider adapter
                ▼                                ▼
     ┌─────────────────────┐          ┌──────────────────────────┐
     │ Supabase PostgreSQL │          │ Gmail API (Workspace     │
     │  app tables, RLS,   │          │ mailbox) / Graph / SMTP  │
     │  pg-boss schema,    │          └────────────┬─────────────┘
     │  Storage (CSVs)     │                       │ SMTP delivery by Google/Microsoft
     │  Auth (users)       │                       ▼
     └─────────────────────┘                  Recipient inbox
```

### 3b. Inbound path

```
 Recipient replies / remote server bounces / recipient clicks unsubscribe
    │                         │                                  │
    ▼                         ▼                                  ▼
 Lands in sending mailbox (reply or DSN/NDR report)     HTTPS POST/GET /u/[token]
    │                                                            │ (WEB)
    ▼                                                            ▼
 WORKER: mailbox-sync job (poll history.list;          Verify HMAC token → txn:
   optional Pub/Sub push → /api/webhooks/gmail          unsubscribe + suppression +
   → webhook_events → enqueue sync)                     cancel pending/scheduled sends
    │
    ▼
 Classify each new message: bounce (DSN) | auto-reply | human reply | unrelated (ignored)
    │
    ▼
 Match to outbound message: In-Reply-To → References → provider thread id → sender fallback
    │
    ▼
 ONE transaction:
   insert reply / message_event (dedupe keys)  → recipient REPLIED / BOUNCED (state-guarded)
   → cancel PENDING message rows → suppression (hard bounce) → reply_thread upsert (Inbox)
    │
    ▼
 Inbox (UNREVIEWED) · campaign analytics · audit/activity
```

---

## 4. PostgreSQL Schema Proposal

### 4.1 Conventions (apply to every table unless noted)

- **PK**: `id uuid`, generated app-side as **UUIDv7** (time-ordered, so index-friendly; no sequence enumeration).
- **Timestamps**: `created_at timestamptz not null default now()`, `updated_at timestamptz not null default now()`, maintained by trigger. All times are stored in UTC. Timezones are stored as IANA names.
- **Tenancy**: every business table has `workspace_id uuid not null`. Parents expose `unique (workspace_id, id)`, and children reference them with **composite FKs** `(workspace_id, parent_id) → parent(workspace_id, id)`. The database therefore *cannot* link a campaign in workspace A to a prospect in workspace B, even if application code has a bug.
- **Enums**: `text` + `CHECK (... in (...))`, with values defined once in a shared TS constant. This is easier to evolve than Postgres `ENUM` types (no `ALTER TYPE` transaction caveats) and is equally safe.
- **Deletes**: business objects are **archived** (`archived_at`), not deleted. Hard-delete cascades exist only for pure child rows (import rows, audience membership, draft sequence steps). Anything referenced by send history uses `ON DELETE RESTRICT`.
- **JSONB** is used only for raw import cells, raw provider/webhook payloads, provider metadata, audit metadata, saved filter definitions and controlled custom fields. No core domain state lives in JSONB.
- **Emails** are stored as supplied plus `*_normalized` (trimmed, lowercased). All matching uses the normalized value.
- `users` = Supabase `auth.users`, with app data in `profiles`. Actor columns (`created_by`, etc.) are plain `uuid` (no FK), so history survives user removal.

### 4.2 Tenancy and identity

```sql
create table workspaces (
  id uuid primary key,
  name text not null,
  slug text not null unique check (slug ~ '^[a-z0-9-]{2,48}$'),
  kind text not null default 'client' check (kind in ('internal','client')),
  default_timezone text not null,          -- IANA; chosen at creation (no US default)
  sender_country_code char(2),             -- ISO 3166-1 alpha-2 of the sending legal entity
  compliance_postal_address text,          -- required before launch where jurisdiction policy requires it (§19)
  is_demo boolean not null default false,  -- demo/seed data is visibly labelled in the UI
  archived_at timestamptz,
  created_by uuid, created_at, updated_at
);

create table profiles (
  user_id uuid primary key references auth.users(id) on delete cascade,
  full_name text,
  is_platform_admin boolean not null default false, -- may create workspaces; nothing else
  created_at, updated_at
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('OWNER','ADMIN','OPERATOR','VIEWER')),
  status text not null default 'active' check (status in ('invited','active','disabled')),
  invited_by uuid, created_at, updated_at,
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);
-- Integrity rule: each active workspace keeps ≥1 active OWNER (enforced in the role-change transaction).
```

### 4.3 Prospects: research truth vs outreach state (brief §7)

Research truth and outreach state live in **separate tables**. The engine never writes to `prospects`. Imports and explicit, audited research corrections never write to `prospect_outreach_state`.

```sql
create table prospects (                        -- RESEARCH TRUTH
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  company_name text not null,
  website text, website_domain text,            -- domain: lowercased host, no "www."
  contact_name text, first_name text, last_name text,
  contact_title text,
  email text, email_normalized text, email_domain text,
  phone text,
  address_line text, city text,
  state text,                                   -- as researched (free text, any country)
  postal_code text,
  country_code char(2),                         -- ISO 3166-1 alpha-2; NO default (null → NEEDS_REVIEW)
  region_code text,                             -- ISO 3166-2 subdivision when derivable (e.g. US-TX, CA-ON)
  business_type text,                           -- delivery column "PROVIDER TYPE"
  qualification_basis text,
  evidence_url text,
  custom_fields jsonb not null default '{}',    -- only keys registered in workspace_custom_fields
  research_source_ref text,                     -- ID from LeadVault research system, if supplied
  research_approved_at timestamptz,
  first_import_id uuid, last_import_id uuid,    -- FK → prospect_imports
  archived_at timestamptz,
  created_at, updated_at,
  unique (workspace_id, id)
);
create unique index prospects_ws_email_uq on prospects (workspace_id, email_normalized)
  where email_normalized is not null;
create unique index prospects_ws_research_ref_uq on prospects (workspace_id, research_source_ref)
  where research_source_ref is not null;
create index on prospects (workspace_id, country_code, region_code);
create index on prospects (workspace_id, state);
create index on prospects (workspace_id, business_type);
create index on prospects (workspace_id, website_domain);
create index on prospects (workspace_id, created_at desc);
create index on prospects using gin (company_name gin_trgm_ops);
create index on prospects using gin (contact_name gin_trgm_ops);
create index on prospects using gin (email_normalized gin_trgm_ops);

create table prospect_outreach_state (           -- OUTREACH STATE (1:1)
  prospect_id uuid primary key,
  workspace_id uuid not null,
  foreign key (workspace_id, prospect_id) references prospects(workspace_id, id) on delete cascade,
  eligibility text not null check (eligibility in ('ELIGIBLE','INELIGIBLE','SUPPRESSED','NEEDS_REVIEW')),
  eligibility_reasons text[] not null default '{}',   -- reason codes (§10)
  eligibility_checked_at timestamptz not null,
  review_decision text check (review_decision in ('approved','rejected')),
  review_decided_by uuid, review_decided_at timestamptz,
  last_contacted_at timestamptz, last_reply_at timestamptz,
  last_outcome text,
  active_enrollment_count int not null default 0,
  updated_at
);
create index on prospect_outreach_state (workspace_id, eligibility);

create table jurisdiction_policies (             -- data-driven compliance rules by geography
  id uuid primary key,
  scope text not null check (scope in ('global','workspace')),
  workspace_id uuid references workspaces(id),  -- null when global; workspace rows override global
  country_code char(2) not null,
  region_code text,                             -- null = whole country
  outreach_status text not null check (outreach_status in ('allowed','review','blocked')),
  requires_postal_address boolean not null default true,
  requires_unsubscribe_link boolean not null default true,
  footer_template text,                         -- jurisdiction-specific footer/opt-out wording
  notes text,                                   -- legal basis / reference, set by owner/counsel
  updated_by uuid, created_at, updated_at,
  check ((scope = 'global') = (workspace_id is null))
);
create unique index on jurisdiction_policies (coalesce(workspace_id,'00000000-0000-0000-0000-000000000000'),
  country_code, coalesce(region_code,''));
-- Unknown country, or a country with no policy row → 'review' (fail closed). Seed rows are set by the owner;
-- the application ships with NO country pre-marked 'allowed'.

create table workspace_custom_fields (           -- controlled custom variables
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  key text not null check (key ~ '^[a-z][a-z0-9_]{1,40}$'),
  label text not null,
  data_type text not null default 'text' check (data_type in ('text','number','date','url')),
  created_at, updated_at,
  unique (workspace_id, key)
);
```

### 4.4 Imports

```sql
create table prospect_imports (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  created_by uuid not null,
  source_label text,                         -- e.g. "OTD Global – TX batch 3"
  file_name text not null,
  storage_path text not null,                -- private bucket, signed-URL upload
  file_sha256 text not null,                 -- re-upload of same file → warning
  row_count int,
  status text not null check (status in
    ('uploaded','parsed','mapped','validating','ready','importing','completed','failed','cancelled')),
  column_mapping jsonb,                      -- {"EMAIL ADDRESS":"email", "Specialty":"custom:specialty", "Notes":"ignore"}
  options jsonb,                             -- Zod-typed: update policy for matched records, etc.
  created_count int not null default 0, updated_count int not null default 0,
  unchanged_count int not null default 0, skipped_count int not null default 0,
  invalid_count int not null default 0, suppressed_count int not null default 0,
  duplicate_count int not null default 0,
  error_code text, completed_at timestamptz,
  created_at, updated_at,
  unique (workspace_id, id)
);
create index on prospect_imports (workspace_id, created_at desc);
create index on prospect_imports (workspace_id, file_sha256);

create table prospect_import_rows (              -- every row is accounted for: never silently dropped
  import_id uuid not null,
  row_number int not null,
  workspace_id uuid not null,
  raw jsonb not null,                        -- verbatim cells
  mapped jsonb,                              -- normalized candidate values
  outcome text not null check (outcome in ('pending','create','update','unchanged',
    'duplicate_in_file','duplicate_existing','invalid','suppressed','skipped')),
  issues jsonb not null default '[]',        -- [{code, field, severity, message}]
  prospect_id uuid,
  overridden_by uuid,                        -- operator changed the default outcome in preview
  primary key (import_id, row_number),
  foreign key (workspace_id, import_id) references prospect_imports(workspace_id, id) on delete cascade
);
create index on prospect_import_rows (import_id, outcome);
```

### 4.5 Audiences

```sql
create table audiences (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null, description text,
  source_import_id uuid,                     -- context: created from an import
  saved_filter jsonb,                        -- filter used to build it (Zod-typed), informational
  created_by uuid, archived_at timestamptz, created_at, updated_at,
  unique (workspace_id, id)
);
create unique index on audiences (workspace_id, lower(name)) where archived_at is null;

create table audience_members (                  -- static membership (snapshot), MVP
  audience_id uuid not null,
  prospect_id uuid not null,
  workspace_id uuid not null,
  added_via text not null check (added_via in ('manual','import','filter')),
  added_by uuid, added_at timestamptz not null default now(),
  primary key (audience_id, prospect_id),
  foreign key (workspace_id, audience_id) references audiences(workspace_id, id) on delete cascade,
  foreign key (workspace_id, prospect_id) references prospects(workspace_id, id) on delete restrict
);
create index on audience_members (prospect_id);
```
The audience prospect count is computed (indexed `count(*)`); it is not stored.

### 4.6 Templates

```sql
create table templates (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null,
  subject text not null,
  body text not null,                        -- plain text (first-class); light markdown later
  variables_used text[] not null default '{}',  -- extracted + validated on save
  created_by uuid, archived_at timestamptz, created_at, updated_at,
  unique (workspace_id, id)
);
create unique index on templates (workspace_id, lower(name)) where archived_at is null;
```

### 4.7 Mailboxes, connections, identities

```sql
create table provider_connections (             -- OAuth/credential holder; secrets encrypted
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  provider text not null check (provider in ('google_workspace','microsoft_365','smtp_imap')),
  account_email text not null,
  external_account_id text,                  -- Google user id / Entra object id
  status text not null check (status in ('active','needs_reauth','revoked','error')),
  encrypted_credentials bytea not null,      -- AES-256-GCM (refresh token / SMTP password)
  credentials_key_version smallint not null,
  scopes text[] not null default '{}',
  ingestion_mode text not null default 'provider_api'
    check (ingestion_mode in ('provider_api','inbound_routing')),   -- §14.5
  inbound_routing_address text,              -- app-owned address receiving routed copies (inbound_routing mode)
  access_token_expires_at timestamptz,
  sync_cursor text,                          -- Gmail historyId / Graph deltaLink
  push_watch_expires_at timestamptz,         -- Gmail watch() renewal (≤7 days)
  last_verified_at timestamptz, last_error_code text, last_error_at timestamptz,
  metadata jsonb not null default '{}',      -- non-secret provider metadata
  created_by uuid, created_at, updated_at,
  unique (workspace_id, id),
  unique (workspace_id, provider, account_email)
);

create table mailboxes (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  provider_connection_id uuid not null,
  email_address text not null,
  display_name text not null,
  status text not null check (status in ('CONNECTED','NEEDS_ATTENTION','PAUSED','DISCONNECTED')),
  status_reason text,                        -- reason code shown in UI (e.g. AUTH_EXPIRED, BOUNCE_RATE)
  enabled boolean not null default true,
  daily_send_limit int not null check (daily_send_limit between 1 and 2000),
  min_seconds_between_sends int not null default 90,
  send_days smallint[] not null default '{1,2,3,4,5}',  -- ISO weekday
  window_start time not null default '08:00', window_end time not null default '17:00',
  timezone text not null,
  signature text,
  next_available_at timestamptz not null default now(),  -- pacing cursor (§13)
  infra_vendor text not null,                -- mission_inbox | infraforge | mailforge | google_workspace | ... (§14.7)
  warmup_status text not null default 'warming' check (warmup_status in ('warming','ready','paused')),
  warmup_started_at timestamptz,
  ramp_schedule jsonb,                       -- e.g. [{"fromDay":0,"limit":5},{"fromDay":14,"limit":15},...]; Zod-typed
  b2b_only boolean not null default true,    -- provider condition (Mission Inbox §4.2)
  last_send_at timestamptz, last_sync_at timestamptz,
  created_at, updated_at,
  unique (workspace_id, id),
  foreign key (workspace_id, provider_connection_id) references provider_connections(workspace_id, id)
);
create unique index on mailboxes (workspace_id, lower(email_address));

create table sending_identities (                -- From-name / reply-to / alias per mailbox
  id uuid primary key,
  workspace_id uuid not null,
  mailbox_id uuid not null,
  from_name text not null,
  from_email text not null,                  -- the mailbox or a verified "send as" alias
  reply_to_email text,
  is_default boolean not null default false,
  created_at, updated_at,
  unique (workspace_id, id),
  foreign key (workspace_id, mailbox_id) references mailboxes(workspace_id, id)
);
create unique index on sending_identities (mailbox_id) where is_default;

create table mailbox_daily_usage (               -- atomic daily-cap enforcement
  mailbox_id uuid not null references mailboxes(id),
  usage_date date not null,                  -- date in the mailbox timezone
  sent_count int not null default 0,
  primary key (mailbox_id, usage_date)
);
```

### 4.8 Campaigns, sequences, recipients

```sql
create table campaigns (
  id uuid primary key,
  workspace_id uuid not null references workspaces(id),
  name text not null, description text, objective text,
  status text not null check (status in ('DRAFT','SCHEDULED','ACTIVE','PAUSED','COMPLETED','CANCELLED')),
  audience_id uuid,                          -- source audience (provenance)
  mailbox_id uuid, sending_identity_id uuid,
  timezone text,
  send_days smallint[], window_start time, window_end time,
  daily_limit int check (daily_limit > 0),   -- campaign cap; mailbox cap also applies
  min_seconds_between_sends int,
  continue_on_auto_reply boolean not null default true,   -- OOO does not stop the sequence
  target_country_codes char(2)[],            -- optional campaign geography restriction; recipients outside → EXCLUDED
  start_at timestamptz,
  launched_at timestamptz, launched_by uuid,
  paused_at timestamptz, pause_reason text,
  completed_at timestamptz, cancelled_at timestamptz,
  version int not null default 1,            -- optimistic concurrency for builder edits
  archived_at timestamptz, created_by uuid, created_at, updated_at,
  unique (workspace_id, id),
  foreign key (workspace_id, mailbox_id) references mailboxes(workspace_id, id),
  foreign key (workspace_id, audience_id) references audiences(workspace_id, id)
);
create index on campaigns (workspace_id, status);
create index on campaigns (workspace_id, created_at desc);
create index on campaigns (mailbox_id) where status in ('SCHEDULED','ACTIVE','PAUSED');

create table sequence_steps (                    -- campaign-owned SNAPSHOT of content
  id uuid primary key,
  workspace_id uuid not null,
  campaign_id uuid not null,
  step_number int not null check (step_number >= 1),
  delay_minutes int not null default 0 check (delay_minutes >= 0),  -- after previous step (step 1: 0)
  thread_mode text not null default 'reply' check (thread_mode in ('new','reply')),
  subject text,                              -- required for step 1 / 'new'; 'reply' reuses "Re: <step 1>"
  body text not null,
  enabled boolean not null default true,
  source_template_id uuid,                   -- provenance only; template edits do NOT propagate
  created_at, updated_at,
  unique (workspace_id, id),
  unique (campaign_id, step_number),
  foreign key (workspace_id, campaign_id) references campaigns(workspace_id, id) on delete cascade
);
-- Deleting a campaign is only allowed in DRAFT (no recipients/messages), so the cascade only affects drafts.

create table campaign_recipients (
  id uuid primary key,
  workspace_id uuid not null,
  campaign_id uuid not null,
  prospect_id uuid not null,
  email_normalized text not null,            -- address frozen at enrollment
  status text not null check (status in ('QUEUED','SCHEDULED','SENDING','COMPLETED','REPLIED',
    'BOUNCED','UNSUBSCRIBED','SUPPRESSED','STOPPED','FAILED','CANCELLED','EXCLUDED')),
  last_sent_step int not null default 0,
  next_step int,                             -- null when no further step
  next_send_at timestamptz,                  -- earliest time next step may go (window applied by dispatcher)
  provider_thread_id text,                   -- for threaded follow-ups
  first_message_rfc_id text,                 -- In-Reply-To / References anchor
  stop_reason text,                          -- reason code for terminal states
  stopped_at timestamptz, stopped_by uuid,
  excluded_reasons text[],                   -- when EXCLUDED at launch (shown in Review)
  outcome text,                              -- current business outcome (history in campaign_outcomes)
  enrolled_at timestamptz not null default now(), enrolled_by uuid,
  last_sent_at timestamptz, replied_at timestamptz,
  updated_at,
  unique (workspace_id, id),
  unique (campaign_id, prospect_id),
  foreign key (workspace_id, campaign_id) references campaigns(workspace_id, id) on delete restrict,
  foreign key (workspace_id, prospect_id) references prospects(workspace_id, id) on delete restrict
);
create index cr_due_idx on campaign_recipients (next_send_at) where status = 'SCHEDULED';  -- dispatcher
create index on campaign_recipients (campaign_id, status);
create index on campaign_recipients (workspace_id, email_normalized);   -- stop-on-unsubscribe fan-out
create index on campaign_recipients (prospect_id);

create table campaign_outcomes (                 -- append-only outcome history
  id uuid primary key,
  workspace_id uuid not null,
  campaign_recipient_id uuid not null,
  campaign_id uuid not null,
  outcome text not null check (outcome in ('INTERESTED','NOT_INTERESTED','FOLLOW_UP',
    'OUT_OF_OFFICE','UNSUBSCRIBE','OTHER')),
  source text not null check (source in ('inbox_classification','manual','system')),
  set_by uuid, note text, created_at,
  foreign key (workspace_id, campaign_recipient_id) references campaign_recipients(workspace_id, id)
);
create index on campaign_outcomes (campaign_id, created_at);
```

### 4.9 Messages, attempts, events

```sql
create table messages (                          -- outbound; also the send OUTBOX
  id uuid primary key,
  workspace_id uuid not null,
  kind text not null check (kind in ('sequence','manual_reply','test')),
  campaign_id uuid, campaign_recipient_id uuid, sequence_step_id uuid, step_number int,
  prospect_id uuid,
  mailbox_id uuid not null, sending_identity_id uuid,
  to_email text not null, from_email text not null, from_name text,
  subject text not null, body_text text not null,          -- rendered snapshot actually sent
  rfc_message_id text not null unique,       -- "<{id}@{sending-domain}>", reused on every attempt
  lv_message_header text not null unique,    -- value of X-LV-Message-Id (= id); fallback lookup key (§12)
  in_reply_to text, references_header text,
  provider_message_id text, provider_thread_id text,
  status text not null check (status in ('PENDING','SENDING','RETRY_WAIT',
    'RECONCILIATION_REQUIRED','OPERATOR_REVIEW','SENT','FAILED','CANCELLED')),
  scheduled_for timestamptz not null,
  next_attempt_at timestamptz,
  lease_owner text, lease_expires_at timestamptz,
  attempt_count int not null default 0,
  reconciliation_checks int not null default 0,
  reconciliation_next_at timestamptz,
  resolution text check (resolution in ('confirmed_sent_auto','confirmed_sent_operator',
    'operator_retry_authorized','operator_skipped','operator_stopped')),
  resolved_by uuid, resolved_at timestamptz,
  sent_at timestamptz, failed_at timestamptz,
  error_code text, error_message text,       -- sanitized; never raw provider bodies
  bounced_at timestamptz, bounce_type text,  -- denormalized from events for fast analytics
  created_at, updated_at,
  unique (workspace_id, id),
  foreign key (workspace_id, campaign_recipient_id) references campaign_recipients(workspace_id, id),
  foreign key (workspace_id, mailbox_id) references mailboxes(workspace_id, id)
);
-- THE duplicate-send guard: one message per recipient per step, ever.
create unique index messages_recipient_step_uq on messages (campaign_recipient_id, step_number)
  where kind = 'sequence';
create index messages_executor_idx on messages (mailbox_id, scheduled_for)
  where status in ('PENDING','RETRY_WAIT');
create index on messages (lease_expires_at) where status = 'SENDING';
create index on messages (reconciliation_next_at) where status = 'RECONCILIATION_REQUIRED';
create index on messages (workspace_id, mailbox_id) where status = 'OPERATOR_REVIEW';
create index on messages (campaign_id, sent_at);
create index on messages (mailbox_id, sent_at);
create index on messages (provider_thread_id);

create table send_attempts (
  id uuid primary key,
  message_id uuid not null references messages(id),
  attempt_number int not null,
  worker_id text not null,
  started_at timestamptz not null, finished_at timestamptz,
  mailbox_history_id_before text,            -- Gmail getProfile().historyId captured just before send
  request_dispatched boolean not null default false, -- set true immediately before bytes are written
  result text check (result in ('accepted','rejected_not_sent','ambiguous')),
  provider_status int, error_code text, error_detail text,  -- sanitized
  unique (message_id, attempt_number)
);

create table message_events (                    -- normalized, idempotent event log
  id uuid primary key,
  workspace_id uuid not null,
  message_id uuid references messages(id),
  campaign_recipient_id uuid,
  event_type text not null check (event_type in ('sent','send_failed','delivered','soft_bounce',
    'hard_bounce','blocked','replied','auto_replied','unsubscribed','complaint')),
  occurred_at timestamptz not null,
  source text not null check (source in ('provider_api','mailbox_sync','webhook','user','system')),
  dedupe_key text not null unique,           -- e.g. "hard_bounce:{message_id}:{dsn provider msg id}"
  webhook_event_id uuid, inbound_message_id uuid,
  data jsonb not null default '{}',          -- e.g. DSN status code, diagnostic (sanitized)
  created_at
);
create index on message_events (workspace_id, event_type, occurred_at);
create index on message_events (message_id);
```

### 4.10 Inbox

```sql
create table reply_threads (
  id uuid primary key,
  workspace_id uuid not null,
  mailbox_id uuid not null,
  provider_thread_id text not null,
  campaign_id uuid, campaign_recipient_id uuid, prospect_id uuid,  -- null = unmatched thread
  subject text,
  classification text not null default 'UNREVIEWED' check (classification in ('UNREVIEWED',
    'INTERESTED','NOT_INTERESTED','FOLLOW_UP','OUT_OF_OFFICE','UNSUBSCRIBE','OTHER')),
  classified_by uuid, classified_at timestamptz,
  is_unread boolean not null default true,
  archived_at timestamptz,
  last_message_at timestamptz not null,
  created_at, updated_at,
  unique (workspace_id, id),
  unique (mailbox_id, provider_thread_id)
);
create index on reply_threads (workspace_id, classification, last_message_at desc);
create index on reply_threads (workspace_id, campaign_id, last_message_at desc);

create table replies (                           -- inbound messages (the brief's "replies")
  id uuid primary key,
  workspace_id uuid not null,
  mailbox_id uuid not null,
  reply_thread_id uuid,
  provider_message_id text not null,
  rfc_message_id text, in_reply_to text, references_header text,
  from_email text not null, from_name text, to_emails text[],
  subject text, snippet text,
  body_text text, body_html_sanitized text,
  received_at timestamptz not null,
  kind text not null check (kind in ('human_reply','auto_reply','bounce_report','unsubscribe_request','other')),
  matched_message_id uuid references messages(id),
  match_method text check (match_method in ('in_reply_to','references','provider_thread','sender_fallback','none')),
  processed_at timestamptz,
  raw_headers jsonb,                         -- selected headers only
  created_at,
  unique (mailbox_id, provider_message_id)   -- re-sync never duplicates
);
create index on replies (reply_thread_id, received_at);
create index on replies (workspace_id, received_at desc);
```
Only messages that match outreach (header/thread match, a known prospect sender, or a DSN) are stored. Unrelated personal mail in the mailbox is **ignored, not persisted**.

### 4.11 Suppression and unsubscribe

```sql
create table suppressions (
  id uuid primary key,
  scope text not null check (scope in ('workspace','global')),
  workspace_id uuid references workspaces(id),          -- null only when scope = 'global'
  value_type text not null check (value_type in ('email','domain')),
  value_normalized text not null,
  reason text not null check (reason in ('UNSUBSCRIBE','HARD_BOUNCE','MANUAL_DO_NOT_CONTACT',
    'COMPLIANCE','COMPLAINT')),
  source text not null check (source in ('unsubscribe_link','reply','bounce','manual','import','system')),
  source_message_id uuid, source_campaign_id uuid,
  note text,
  created_by uuid, created_at,
  lifted_at timestamptz, lifted_by uuid, lift_reason text,   -- never hard-deleted
  check ((scope = 'global') = (workspace_id is null))
);
create unique index supp_ws_active_uq on suppressions (workspace_id, value_type, value_normalized)
  where lifted_at is null and scope = 'workspace';
create unique index supp_global_active_uq on suppressions (value_type, value_normalized)
  where lifted_at is null and scope = 'global';
create index on suppressions (value_normalized) where lifted_at is null;

create table unsubscribes (                      -- event record; suppression is the enforcement
  id uuid primary key,
  workspace_id uuid not null,
  email_normalized text not null,
  message_id uuid, campaign_id uuid, campaign_recipient_id uuid,
  method text not null check (method in ('one_click_post','link_confirm','reply','manual')),
  suppression_id uuid not null references suppressions(id),
  user_agent text, ip_hash text,             -- hashed; no raw IPs
  occurred_at timestamptz not null default now(),
  unique (message_id, method)                -- repeated clicks are idempotent
);
create index on unsubscribes (workspace_id, occurred_at desc);
```
No FK from suppressions to prospects. Suppression is keyed on the address, so it survives prospect deletion, re-import and workspace re-organisation.

### 4.12 Infrastructure tables

```sql
create table webhook_events (
  id uuid primary key,
  provider text not null, endpoint text not null,
  provider_event_id text,
  dedupe_key text not null unique,           -- provider event id, else sha256(raw body)
  signature_valid boolean not null,
  headers jsonb not null,                    -- allowlisted headers only
  payload jsonb not null,
  workspace_id uuid,                         -- resolved during processing
  status text not null check (status in ('received','processing','processed','failed','ignored')),
  attempts int not null default 0, last_error text,
  received_at timestamptz not null default now(), processed_at timestamptz
);
create index on webhook_events (status, received_at) where status in ('received','failed');

create table audit_logs (                        -- append-only (UPDATE/DELETE revoked)
  id uuid primary key,
  workspace_id uuid,
  actor_type text not null check (actor_type in ('user','system','worker')),
  actor_user_id uuid, actor_email text,      -- snapshot; survives user deletion
  action text not null,                      -- 'campaign.launched', 'suppression.lifted', ...
  entity_type text not null, entity_id uuid,
  metadata jsonb not null default '{}',      -- allowlisted keys; never secrets or email bodies
  request_id text,
  created_at timestamptz not null default now()
);
create index on audit_logs (workspace_id, created_at desc);
create index on audit_logs (entity_type, entity_id, created_at desc);

create table worker_heartbeats (
  worker_id text primary key,
  service text not null, version text not null,
  started_at timestamptz not null, last_beat_at timestamptz not null,
  loops jsonb not null                       -- {dispatcher:{lastRunAt,lagMs}, executor:{...}}
);

-- pg-boss creates and owns its own schema ("pgboss") for jobs, schedules and archives.
```

### 4.13 Data-integrity rules and transaction boundaries

| Operation | One transaction contains | Guards |
|---|---|---|
| Import commit (per batch of ~500 rows) | upsert prospects + outreach_state + import_rows outcome + counters | `ON CONFLICT (workspace_id,email_normalized)`. The suppression lookup happens inside the txn. Suppressions are never touched. |
| Campaign launch | lock campaign `FOR UPDATE` → re-validate → re-evaluate eligibility of all audience members → insert recipients (eligible→SCHEDULED, others→EXCLUDED with reasons) → status ACTIVE/SCHEDULED → audit | `version` check (optimistic). Launch is rejected if any validation fails. |
| Dispatch (per recipient) | lock recipient `SKIP LOCKED` → recheck suppression/campaign/mailbox → insert message (PENDING) → recipient SENDING | unique `(campaign_recipient_id, step_number)` |
| Claim for send | lock message + mailbox rows → final pre-send checks → increment daily usage (conditional) → message SENDING + lease | conditional `UPDATE … WHERE status IN (…)` |
| Record send result | message SENT + event + recipient advance (next step/COMPLETED) + outreach_state | state-guarded updates |
| Reply/bounce/unsubscribe | insert inbound/event (dedupe) → recipient terminal → cancel PENDING messages → suppression → thread upsert → audit | unique dedupe keys; `WHERE status NOT IN (terminal)` |
| Pause/cancel/stop | campaign/recipient status + cancel PENDING messages + audit | — |

Lock ordering, used everywhere to avoid deadlocks: **campaign → campaign_recipient → message → mailbox**.

---

## 5. Entity Relationship Model

```
auth.users ─1:1─ profiles
auth.users ─M:N─ workspaces            (via workspace_members: role)

workspaces ─1:N─┬─ prospects ─1:1─ prospect_outreach_state
                │      ▲  ▲
                │      │  └──────────── audience_members ───N:1── audiences
                │      │
                ├─ prospect_imports ─1:N─ prospect_import_rows ──(0..1)→ prospects
                ├─ workspace_custom_fields
                ├─ templates  ┄┄(provenance)┄┄> sequence_steps
                ├─ provider_connections ─1:N─ mailboxes ─1:N─ sending_identities
                │                                  └─1:N─ mailbox_daily_usage
                ├─ campaigns ─1:N─ sequence_steps
                │      │  └──N:1── mailboxes / sending_identities / audiences(provenance)
                │      └─1:N─ campaign_recipients ──N:1── prospects
                │                 ├─1:N─ messages ─1:N─ send_attempts
                │                 │          └─1:N─ message_events
                │                 ├─1:N─ campaign_outcomes
                │                 └─0..N─ reply_threads ─1:N─ replies ──(matched)→ messages
                ├─ suppressions (scope=workspace)     + global suppressions (workspace_id NULL)
                ├─ unsubscribes ──N:1── suppressions
                └─ audit_logs
webhook_events (provider-level; workspace resolved during processing)
worker_heartbeats, pgboss.* (infrastructure)
```

---

## 6. Workspace / Multi-Tenancy Architecture

- **Model:** shared database, shared schema, `workspace_id` on every business row, with composite tenant FKs. This is the standard SaaS pattern and fits until well beyond the planned scale.
- **Recommended mapping (owner decision §30-3):** **one workspace per client** (e.g. "OTD Global"), plus one `internal` LeadVault workspace. Staff are members of every client workspace. When customer logins arrive later, customer users simply become `VIEWER`/`OPERATOR` members of their own workspace, with **no schema change**.
- **Workspace in the URL:** `/w/[slug]/…`. This prevents the "wrong workspace in another tab" class of mistake, makes links shareable, and lets the server resolve and authorize the workspace on every request.
- **Workspace switcher** at the top of the sidebar. The last-used workspace is remembered per user.
- **Cross-workspace resources:** only **global suppressions** (null `workspace_id`) and provider-level `webhook_events` are cross-tenant, and both are handled by the worker with explicit scoping.
- **Platform admin:** `profiles.is_platform_admin` only allows creating workspaces. It does **not** bypass membership checks.

## 7. Authentication / Authorization Architecture

**Authentication (Supabase Auth):**
- Email + password; **public signup disabled**. Users are **invited** by an OWNER/ADMIN (`auth.admin.inviteUserByEmail` from a server action), and the invite link sets the password.
- Login, logout, password recovery (`/forgot-password` → email via Resend SMTP → `/reset-password`).
- Sessions: `@supabase/ssr` HTTP-only cookies, refreshed in Next.js middleware/proxy. Server code verifies the user with `getUser()`/`getClaims()`, never by trusting an unverified session object.
- **MFA (TOTP)** for OWNER/ADMIN is recommended (supported by Supabase; owner decision §30-7).
- Auth-endpoint rate limits are Supabase built-ins.

**Authorization: three layers**
1. **Route guard** (middleware/proxy): unauthenticated → `/login`. This is a convenience only. Middleware is **not** a security boundary (cf. the 2025 Next.js middleware-bypass CVE).
2. **Data-access layer (the real boundary).** Every server action, route handler and RSC data call goes through `requireWorkspaceAccess(slug, minRole)`. That function resolves the membership, and repository functions take a `WorkspaceContext` (`workspaceId`, `userId`, `role`) and **always** filter by `workspace_id`. There is no direct DB access from components.
3. **Postgres RLS (defense in depth).** RLS is enabled on **every** app table with default-deny. Policies check `exists (select 1 from workspace_members m where m.workspace_id = <row>.workspace_id and m.user_id = auth.uid() and m.status='active')`, with role checks for writes. User-initiated queries run inside `withUserContext(tx)`, which sets `role authenticated` and `request.jwt.claims` for the transaction (pattern supported by Drizzle). A DAL bug therefore still cannot read another workspace. The **worker** uses a privileged connection and must pass `workspace_id` explicitly. Supabase's auto-generated **Data API** is disabled for app tables (they are only reached through our server), which removes the anon-key exposure surface.

**Role matrix (MVP)**

| Capability | OWNER | ADMIN | OPERATOR | VIEWER |
|---|---|---|---|---|
| View everything in workspace | ✓ | ✓ | ✓ | ✓ |
| Import prospects, manage audiences/templates | ✓ | ✓ | ✓ | — |
| Build, launch, pause, resume campaigns; stop recipients | ✓ | ✓ | ✓ | — |
| Classify replies | ✓ | ✓ | ✓ | — |
| Add suppression | ✓ | ✓ | ✓ | — |
| **Lift** suppression | ✓ | ✓ | — | — |
| Connect/disable mailboxes, sending settings | ✓ | ✓ | — | — |
| Invite/remove members, change roles | ✓ | ✓ (not OWNER) | — | — |
| Workspace settings, compliance address, transfer ownership | ✓ | — | — | — |

---

## 8. Application Route Map

Public / auth:

| Route | Purpose |
|---|---|
| `/login` | Sign in |
| `/forgot-password`, `/reset-password` | Password recovery |
| `/auth/confirm`, `/auth/callback` | Supabase token exchange (invites, recovery) |
| `/u/[token]` | **Unsubscribe**: GET shows confirmation, POST performs it (RFC 8058 one-click target) |
| `/` | Redirects to the last workspace dashboard |

Workspace-scoped (`/w/[ws]/…`):

| Route | Purpose |
|---|---|
| `dashboard` | Operational dashboard |
| `prospects` | Prospect table (search, filters, bulk actions) |
| `prospects/[id]` | Prospect detail: research data, outreach state, eligibility reasons, history |
| `prospects/imports` | Import history |
| `prospects/imports/new` | Import wizard (upload → map → validate → preview → confirm) |
| `prospects/imports/[id]` | Import summary + row-level outcomes (filter by outcome, export issues CSV) |
| `audiences`, `audiences/[id]` | Audience list / detail (members, add/remove, campaign history) |
| `campaigns` | Campaign list |
| `campaigns/new` | Creates a DRAFT and redirects to the builder |
| `campaigns/[id]/build/[step]` | Builder: `details` · `audience` · `identity` · `sequence` · `schedule` · `review` |
| `campaigns/[id]` | Campaign overview (status, controls, progress, warnings) |
| `campaigns/[id]/recipients` | Recipient table with per-recipient state + stop action |
| `campaigns/[id]/analytics` | Campaign analytics (by step, by day) |
| `campaigns/[id]/activity` | Campaign audit/activity timeline |
| `inbox`, `inbox/[threadId]` | Unified inbox, thread view |
| `templates`, `templates/[id]` | Templates |
| `mailboxes`, `mailboxes/connect`, `mailboxes/[id]` | Mailboxes, OAuth connect flow, detail/health/limits |
| `suppression` | Suppression list (add, lift with reason, search, reason/source) |
| `analytics` | Cross-campaign analytics (campaign, step, mailbox, date range) |
| `settings/workspace` · `team` · `sending` · `integrations` · `compliance` · `notifications` · `security` · `audit-log` | Settings (MVP: workspace, team, compliance, audit-log; others stubbed) |
| `/account/profile` | User profile, password, MFA |

API / machine endpoints:

| Route | Purpose |
|---|---|
| `/api/oauth/google/start`, `/api/oauth/google/callback` | Mailbox OAuth (state + PKCE, CSRF-bound) |
| `/api/webhooks/gmail` | Optional Gmail Pub/Sub push (OIDC-JWT verified) |
| `/api/webhooks/[provider]` | Generic adapter webhooks (future ESP/Graph) |
| `/api/imports/upload-url` | Issues a signed Storage upload URL |
| `/api/health` | Liveness + DB + worker-heartbeat freshness |

Mutations otherwise use **Server Actions** (built-in Origin check) rather than bespoke API routes.

---

## 9. Campaign State Machine

```
           ┌────────── edit freely ──────────┐
           ▼                                 │
        DRAFT ── launch (validation passes) ─┼─► start_at in future ─► SCHEDULED ─(start_at reached)─► ACTIVE
           │                                 └─► start now ───────────────────────────────────────────► ACTIVE
           │ delete (only while DRAFT)                                                                  │  ▲
           ▼                                                                                   pause    │  │ resume
        (deleted)                                                                                       ▼  │
                                                                                                     PAUSED
 ACTIVE ── all recipients terminal ──► COMPLETED
 SCHEDULED | ACTIVE | PAUSED ── cancel (confirm) ──► CANCELLED   (recipients → CANCELLED, PENDING messages → CANCELLED)
```

Rules:
- Only **ACTIVE** campaigns dispatch or send. The dispatcher and the executor both check this, so pausing takes effect even for already-created PENDING messages.
- **Resume** recomputes nothing destructive. Recipients keep `next_send_at`, and anything overdue is sent in the next valid window, subject to limits. There is no burst catch-up beyond the daily limit.
- **Editing a launched campaign:** schedule/limits are editable at any time (audited). Sequence content is editable only for steps that no recipient has reached yet, and only while PAUSED. Content already sent is immutable in `messages`.
- **Adding recipients** to SCHEDULED/ACTIVE/PAUSED campaigns uses the same eligibility-checked enrollment function as launch.
- **Automatic transitions:** SCHEDULED→ACTIVE (worker at `start_at`); ACTIVE→COMPLETED (worker when no non-terminal recipients remain); ACTIVE→PAUSED (system, if the campaign's mailbox enters DISCONNECTED/NEEDS_ATTENTION; shown as a system pause with reason).
- **ARCHIVED** is a flag (`archived_at`) for list hygiene, not a state.

## 10. Campaign Recipient State Machine

Persisted states are deliberately few. "Waiting for follow-up" and "Follow-up due" are **derived** in the UI from `next_send_at` vs now and the sending window. Fewer persisted states means fewer illegal transitions to guard.

```
                       launch / add (eligible)
  (not eligible) ◄─────────────────────────────── enrollment
   EXCLUDED  [terminal, reasons recorded]               │
                                                        ▼
                                                    QUEUED      (campaign not yet ACTIVE)
                                                        │ campaign becomes ACTIVE
                                                        ▼
            ┌──────────────────────────────────►  SCHEDULED   next_step, next_send_at set
            │                                          │ dispatcher: due + campaign ACTIVE + mailbox OK
            │                                          │           + recheck suppression/reply/unsub
            │                                          ▼
            │   step sent & more enabled steps     SENDING     message row exists (PENDING→SENDING→…)
            └──────────────────────────────────────────┤
                                                       │ last enabled step sent
                                                       ▼
                                                   COMPLETED [terminal]

 Interrupts (from QUEUED | SCHEDULED | SENDING; all terminal; all cancel PENDING messages):
   human reply received ─────────────► REPLIED
   hard bounce on any step ──────────► BOUNCED        (+ HARD_BOUNCE suppression)
   unsubscribe (link/reply/manual) ──► UNSUBSCRIBED   (+ UNSUBSCRIBE suppression)
   suppression found at dispatch/claim or added later ► SUPPRESSED
   operator "Stop" ──────────────────► STOPPED        (stopped_by recorded)
   permanent send failure ───────────► FAILED         (e.g. recipient address rejected at submit)
   campaign cancelled ───────────────► CANCELLED
```

Transition rules:
- Every transition is a conditional `UPDATE … WHERE id = $1 AND status IN (<allowed sources>)`. If 0 rows are affected, it was a no-op, because someone else already moved the recipient. This makes duplicate events harmless.
- **Terminal is terminal.** Nothing returns a recipient from a terminal state to the queue. Re-contacting a prospect requires a new campaign enrollment, which re-runs eligibility and therefore suppression.
- **Replies after COMPLETED** are still ingested into the Inbox and set `outcome`, but there is no state change.
- **Auto-replies (out-of-office)** do not interrupt by default (`continue_on_auto_reply`). They appear in the Inbox as OUT_OF_OFFICE.
- **Soft bounces** do not interrupt. They are recorded, and after N (default 3) soft bounces across steps the recipient → FAILED (`SOFT_BOUNCE_LIMIT`).
- Campaign **PAUSED** does not change recipient states. It is enforced by the dispatcher and executor filters.

**Eligibility (campaign-ready gate) reason codes**, shown verbatim in the UI as plain-English labels:
`MISSING_EMAIL`, `INVALID_EMAIL_SYNTAX`, `EMAIL_DOMAIN_NO_MX`, `ROLE_OR_FREE_MAILBOX` (configurable: e.g. `info@`, gmail.com → NEEDS_REVIEW), `MISSING_CONTACT_NAME` (NEEDS_REVIEW), `MISSING_REQUIRED_VARIABLE` (per campaign), `SUPPRESSED_EMAIL`, `SUPPRESSED_DOMAIN`, `ALREADY_IN_ACTIVE_CAMPAIGN`, `RECENTLY_CONTACTED` (cool-down, default 30 days), `DUPLICATE_CONTACT`, `REVIEW_REJECTED`, `EMAIL_UNVERIFIED` (NEEDS_REVIEW) / `EMAIL_VERIFICATION_FAILED` (INELIGIBLE) (§14.7.5), `FREE_MAILBOX_B2B_ONLY` (INELIGIBLE when the mailbox is `b2b_only`), `COUNTRY_UNKNOWN` (NEEDS_REVIEW), `JURISDICTION_REVIEW` (policy = review → NEEDS_REVIEW), `JURISDICTION_BLOCKED` (policy = blocked → INELIGIBLE), `OUTSIDE_CAMPAIGN_GEOGRAPHY` (excluded from that campaign only).

**Jurisdiction resolution** is a pure domain function `resolveJurisdictionPolicy(prospect, workspace)`. Its precedence is: workspace row for country+region, then workspace row for country, then global row for country+region, then global row for country, then the default `review`. It fails closed. The app is not US-only: country is a first-class attribute. The import wizard requires either a mapped country column or an explicit "country for rows without one" choice, which is recorded on the import. The address format, `state`/region and phone stay free-form research data. Region codes are derived only when unambiguous. Footers and postal-address requirements come from the resolved policy (§19). Compliance rules are **data, not code**, so policy can vary by geography without a release.
Precedence: SUPPRESSED > INELIGIBLE > NEEDS_REVIEW > ELIGIBLE. An operator can approve NEEDS_REVIEW, but can **never** override SUPPRESSED except by lifting the suppression (ADMIN+, audited).

---

## 11. Message / Send-Attempt Model

- **`messages`** = one logical email. It is created by the dispatcher **before** any provider call and holds the **rendered** subject and body (personalization resolved), the deterministic `rfc_message_id` and threading headers. It is the outbox row.
- **`send_attempts`** = each attempt to hand that message to the provider, with sanitized outcome detail.
- **`message_events`** = everything that happened *after* (sent, bounce, reply, unsubscribe), deduplicated by `dedupe_key`.

Message status machine (revised; see §12 for the outcome classification):
```
PENDING ──claim──► SENDING ── 2xx with message id ───────────────────────────────► SENT
   ▲                  │ REJECTED_NOT_SENT, transient (429 / quota 403, token refresh failed,
   │                  │   connect/DNS/TLS failure before dispatch) ─► RETRY_WAIT ─(backoff)─► claim again
   │                  │ REJECTED_NOT_SENT, permanent (400 invalid message/recipient) ─► FAILED
   │                  │ AMBIGUOUS (timeout or reset after dispatch, 5xx, malformed 2xx,
   │                  │   worker crash / lease expiry while SENDING) ─► RECONCILIATION_REQUIRED
   │                                                                          │ automated checks (+1, +5, +15, +60 min)
   │                                     positive evidence found ─► SENT ◄─────┤ (resolution = confirmed_sent_auto)
   │                                                                          │ no evidence after final check
   │                                                                          ▼
   │                                                                   OPERATOR_REVIEW   (never auto-retried)
   │        operator: "Retry — I confirm it was not sent" (ADMIN+, audited) ──┤
   └──────────────────────────────────────────────────────────────────────────┤
                                     operator: "Mark as sent" ─► SENT          │
                                     operator: "Skip step" / "Stop recipient" ─► CANCELLED (recipient advanced/STOPPED)
PENDING | RETRY_WAIT ── recipient terminal / campaign cancelled ──► CANCELLED
RECONCILIATION_REQUIRED | OPERATOR_REVIEW are NEVER cancelled automatically (the email may exist); a later
reply/bounce/unsubscribe still stops the recipient, and resolution records what happened.
```
While a message is `RECONCILIATION_REQUIRED` or `OPERATOR_REVIEW`, its recipient stays `SENDING`, so no later step can be scheduled for that recipient.
**Personalization:** variables `{{first_name}}`, `{{last_name}}`, `{{company_name}}`, `{{contact_title}}`, `{{city}}`, `{{state}}`, `{{website}}`, `{{sender_name}}`, `{{custom.<key>}}`, with optional fallback syntax `{{first_name|there}}`. Unknown variables are a **save-time error**. A missing value with no fallback makes that recipient NEEDS_REVIEW at launch (`MISSING_REQUIRED_VARIABLE`). It never sends "Hi {{first_name}}". Rendering is plain-text substitution with no code execution and no HTML injection.

**Format:** plain-text, person-to-person email is the default and first-class. There are no tracking pixels and no link rewriting in MVP, for deliverability reasons and because open tracking is unreliable. Follow-ups default to `thread_mode='reply'`: same thread, `Re:` subject, `In-Reply-To`/`References` set to the step-1 Message-ID.

## 12. Idempotency Strategy (duplicate-send prevention)

Goal: for any `(campaign_recipient, sequence_step)`, **at most one** email is accepted by the provider.

| Threat | Defense |
|---|---|
| Two dispatchers create two messages for the same step | **Unique index** `messages (campaign_recipient_id, step_number)` + `INSERT … ON CONFLICT DO NOTHING`. Dispatcher locks recipients with `FOR UPDATE SKIP LOCKED`. |
| Two executors send the same message | Claim = `UPDATE messages SET status='SENDING', lease_owner=$w, lease_expires_at=now()+'5 min', attempt_count=attempt_count+1 WHERE id=$id AND status IN ('PENDING','RETRY_WAIT') RETURNING *`. Only one wins. Candidates come from `FOR UPDATE SKIP LOCKED`. |
| Worker crash mid-send | Lease expiry moves SENDING → **RECONCILIATION_REQUIRED** (never back to PENDING). |
| Provider timeout / network failure after the request was sent | → **RECONCILIATION_REQUIRED**. Never retried automatically (§12.1). |
| Retry after a *definite* rejection | Same `messages` row, same `Message-ID`/`X-LV-Message-Id`, a new `send_attempts` row. Only outcomes classified `rejected_not_sent` (§12.1) may retry automatically. |
| Two sends in flight on one mailbox blur reconciliation | Executor allows **at most one in-flight send per mailbox** (mailbox row lock + `next_available_at`), so each Sent-history window maps to one candidate message. |
| Duplicate webhook / re-synced mailbox message | `webhook_events.dedupe_key` unique; `replies (mailbox_id, provider_message_id)` unique; `message_events.dedupe_key` unique. |
| Duplicate state transitions | State-guarded conditional updates (§10). |
| Daily limit exceeded by concurrent claims | `mailbox_daily_usage` incremented inside the claim txn with `UPDATE … SET sent_count = sent_count+1 WHERE sent_count < limit RETURNING`, under the mailbox row lock. |
| Duplicate job enqueue (pg-boss) | Jobs carry `singletonKey` (e.g. `sync:{mailbox_id}`). Handlers are written to be idempotent anyway. |
| Same person in two campaigns at once | Eligibility rule `ALREADY_IN_ACTIVE_CAMPAIGN` (by `email_normalized` across the workspace). |

### 12.1 Ambiguous-send recovery (revised)

**Is "check Sent before retrying" sufficient? No.** A single Sent-folder check gives a reliable answer only when it finds the message. A "not found" can be a false negative because:
1. **Search is not guaranteed to be immediately consistent.** Gmail documents no consistency guarantee for `q` search, so an accepted message may not be searchable yet.
2. **Message-ID preservation is undocumented.** The Gmail API reference for `messages.send` and the sending guide say nothing about whether a client-supplied `Message-ID` is kept. A lookup keyed only on it could miss.
3. **History expires.** Google: a `historyId` "is typically valid for at least a week, but in some rare circumstances may be valid for only a few hours". A late check can lose the window (404).
4. **The mailbox is user-modifiable.** Someone can delete or move the sent copy.
5. **Concurrency.** Without a lease, two workers can each "check then retry".
6. **Scope.** `gmail.send` alone cannot read Sent at all. Reconciliation needs a read scope (§14.3) or an independent copy (§14.5).

The conclusion is that **absence of evidence is not evidence of absence**. Automatic resolution must happen only on **positive** evidence.

**Outcome classification at send time** (adapter → `send_attempts.result`):

| Result | Conditions | Next state |
|---|---|---|
| `accepted` | HTTP 2xx with a message `id` | SENT |
| `rejected_not_sent` | Failure **before dispatch** (`request_dispatched=false`: token refresh failed, DNS/connect/TLS failure). Or an HTTP **4xx** response: 400 invalid, 401/403 auth or permission, 403/429 rate/quota limits. A 4xx is a completed response rejecting the request. | RETRY_WAIT (transient) or FAILED (permanent) |
| `ambiguous` | Timeout or connection reset **after** dispatch, any **5xx**, a 2xx without a parseable id, or a process crash/lease expiry while SENDING | **RECONCILIATION_REQUIRED** |

Treating 5xx as ambiguous is deliberately conservative. Google does not document that a 5xx guarantees non-delivery.

**Evidence that resolves `RECONCILIATION_REQUIRED` → SENT** (any one is sufficient):
- **E1 Sent history (primary).** Just before every send, the executor records `getProfile().historyId` (`mailbox_history_id_before`). Reconciliation runs `history.list(startHistoryId=…, historyTypes=messageAdded, labelId=SENT)`, then `messages.get(format=METADATA, metadataHeaders=[Message-ID, X-LV-Message-Id])` for each added message, and matches on **either** header. This uses the change log, not the search index, so it has no search-consistency dependency. It works with `gmail.metadata` or `gmail.readonly`.
- **E2 Header search (secondary).** `messages.list(q="rfc822msgid:<id>")`, plus a search for the `X-LV-Message-Id` value. Requires `gmail.readonly`, because `q` cannot be used with `gmail.metadata`.
- **E3 Independent copy (when inbound routing is configured, §14.5).** An outbound routing copy received by our inbound processor carrying the `X-LV-Message-Id` header.
- **E4 Downstream evidence.** A reply or DSN referencing the message's Message-ID proves it was sent.

**Schedule:** checks at +1, +5, +15 and +60 minutes. Each check holds the message row lease, so two workers never reconcile the same message concurrently. If the history cursor 404s before a check, E1 is unavailable and E2/E3/E4 are used.

**If no evidence after the final check → `OPERATOR_REVIEW`. Never an automatic retry.** The System status panel and the campaign page show the message, recipient, attempt log (sanitized), and each check's result. Actions (ADMIN+, reason required, audited):
- **Mark as sent** — e.g. the operator checked the mailbox.
- **Retry: confirmed not sent** — creates a new attempt on the **same** message row with the same headers.
- **Skip this step** — the recipient advances.
- **Stop recipient.**

The recipient stays `SENDING` throughout, so the sequence cannot advance or double-send meanwhile. A later reply, bounce or unsubscribe still terminates the recipient normally.

**Fencing:** every state write after a provider call includes `WHERE id=$id AND attempt_count=$n AND lease_owner=$w`. A stalled worker that wakes after its lease expired cannot overwrite a newer resolution.

**Deterministic identity headers on every attempt:** `Message-ID: <{message.id}@{sending-domain}>` and `X-LV-Message-Id: {message.id}`. Both survive retries. The **Phase 0 spike** confirms whether Gmail preserves each header, and E1 matches on whichever survives.

**Rejected design: draft-then-send** (`drafts.create` + `drafts.send`, hoping a second `drafts.send` fails). It needs the restricted `gmail.compose` scope, and Google's `drafts.send` reference does not document what happens to the draft after sending, so it cannot be relied on as an idempotency mechanism.

**Residual risks (documented, not hideable):**
1. A reply that arrives *during* the provider call cannot stop that call. The pre-send recheck shrinks the window to one API request.
2. If an operator chooses "Retry: confirmed not sent" when the email *was* in fact sent and then deleted from Sent, a duplicate is possible. That decision is explicit and audited.

---

## 13. Queue / Background Job Architecture

### 13.1 Options compared

| Option | Infra added | Fit | Verdict |
|---|---|---|---|
| **pg-boss in a persistent worker** | none (uses Postgres) | Retries/backoff, cron, singleton/dedupe, DLQ, throttling; `SKIP LOCKED` | **Chosen** |
| Graphile Worker | none | Excellent and very fast, but fewer built-ins (cron yes; DLQ/rate-policies manual) | Strong alternative |
| Supabase Queues (pgmq) + Supabase Cron → Edge Functions | none | Postgres-native, but consumers would be Edge Functions (2s CPU, 400s wall, Deno, SMTP ports blocked) | Fallback only |
| Trigger.dev / Inngest (managed) | external SaaS ($0–50+/mo) | Good DX, no timeouts, but a second platform, data leaves the DB, and vendor coupling of the core engine | Not for MVP |
| BullMQ + Redis | Redis service | Proven, but adds paid infra and dual-write between Redis and Postgres | Rejected for MVP |
| Vercel Cron/Queues/Workflows | Vercel Pro | Proprietary; queues/workflows in beta at time of writing | Rejected |
| Browser timers / setTimeout | — | Forbidden by brief | ✗ |

### 13.2 Worker design

One Node process with independent loops. All of them are safe to run as **multiple replicas** because of the `SKIP LOCKED` and lease design.

| Loop / job | Cadence | Does |
|---|---|---|
| **Dispatcher** | every 20s | Finds `campaign_recipients` where `status='SCHEDULED' AND next_send_at <= now()` (partial index), joined to `ACTIVE` campaigns with usable mailboxes. Applies the sending-window check (campaign tz, `send_days`, window) and remaining daily capacity. Locks a batch `FOR UPDATE SKIP LOCKED`, rechecks suppression, creates `messages` (PENDING, `scheduled_for`), and sets the recipient to SENDING. **Due follow-ups are ordered before new first-touch emails.** |
| **Executor** | continuous, about 1s idle poll | For each mailbox with `next_available_at <= now()`: lock the mailbox row and claim one PENDING message. Final pre-send checks: campaign ACTIVE, mailbox CONNECTED+enabled, recipient still SENDING, no active suppression, no reply recorded, inside window, daily usage below cap. Then set `mailbox.next_available_at = now() + min_gap + random jitter(0–40%)`, commit, record `getProfile().historyId` on the attempt, mark `request_dispatched`, call the adapter, and record the result in a new fenced txn. **One in-flight send per mailbox.** |
| `mailbox.sync` (pg-boss) | every 3 min per mailbox (`singletonKey`) + on push notification | Incremental sync from `sync_cursor`. Classifies and ingests replies/DSNs (§15–17). |
| `messages.reconcile` | every 1 min (due rows only) | Expired SENDING leases → RECONCILIATION_REQUIRED. Runs evidence checks E1–E4 on schedule (§12.1). No evidence after the final check → OPERATOR_REVIEW + alert. |
| `campaigns.lifecycle` | every 1 min | SCHEDULED→ACTIVE at `start_at`; ACTIVE→COMPLETED when done. |
| `imports.process` | on demand | Parse → validate → preview rows → commit in batches. |
| `connections.maintain` | hourly | Token-refresh health, Gmail `watch()` renewal (<7 days), mailbox health/auto-pause rules. |
| `webhooks.process` | on receipt + retry sweep every 5 min | Processes `webhook_events` in received/failed state. |
| `maintenance.retention` | daily | Purges import rows/raw payloads past retention. Archives pg-boss jobs. |
| `heartbeat` | every 15s | Upserts `worker_heartbeats`. |

**After a successful send:** recipient `last_sent_step = n`. If another enabled step exists: `next_step`, `next_send_at = sent_at + delay` → SCHEDULED. Otherwise COMPLETED. The sending window is applied at dispatch, not here, so a window change takes effect immediately.

**Timezones and windows:** a pure, heavily tested function `isWithinWindow(instant, window, tz)` and `nextWindowStart(after, window, tz)` (Luxon). It covers DST transitions, windows that cross midnight (rejected in validation for MVP), and holidays (later). MVP sends in the **campaign timezone**. Recipient-local time (inferred from `state`) is a later extension.

**Rate/limit hierarchy:** provider hard limits (Google Workspace official: 2,000 messages/user/day, 2,000 unique external recipients/day; Exchange Online: 10,000 recipients/day and 30 messages/minute per mailbox, plus a tenant-wide external-recipient limit) > **mailbox `daily_send_limit`** (shared across campaigns; recommended defaults 30–50/day per mailbox) > campaign `daily_limit` > per-mailbox spacing `min_seconds_between_sends` + jitter.

**Failures and dead-letter:** retryable errors use exponential backoff (1m, 5m, 15m, 1h, 3h), max 5 attempts → FAILED with `error_code`. Provider-level signals act on the **mailbox**, not the message: auth errors → mailbox NEEDS_ATTENTION (campaigns using it auto-pause); "daily sending quota exceeded" → mailbox paused until the next local day. pg-boss failures past their retry limit land in its dead-letter queue, shown on a **System status** panel (Settings → Integrations, and as a dashboard alert).

**Scaling path:** (1) raise worker concurrency; (2) add worker replicas (no code change); (3) split the executor and sync into separate services; (4) only at very high volume, consider a dedicated queue. Postgres-backed queues comfortably handle thousands of jobs per second, orders of magnitude above cold-outreach volumes.

---

## 14. Email Provider Research & Recommendation

### 14.1 Provider policy verification (official sources only, checked 2026-10-01)

Use case assessed: individually addressed, low-volume, person-to-person B2B email to business contacts who have **not** opted in. The addresses come from LeadVault research, i.e. third-party-sourced.

| Provider | Official policy text (quoted) | Source | Classification |
|---|---|---|---|
| **Resend** | "You are prohibited from sending unsolicited messages of any kind, including cold outreach, purchased lists, or scraped contact data." · "All mail must be sent to recipients who have explicitly opted in to receive communications from you. Sending to unsolicited recipients is not permitted on Resend." | Resend Acceptable Use Policy (updated 2026-08-27) | **NOT SUITABLE** (outreach). OK for system email. |
| **Amazon SES** | AWS AUP prohibits using services "to distribute, publish, send, or facilitate the sending of unsolicited mass email or other messages, promotions, advertising, or solicitations (or "spam")". SES FAQ: "Unsolicited emails are emails that the recipient didn't explicitly ask to receive." · "Don't buy, rent, or share email addresses. Send email only to recipients who explicitly requested to receive email from you." | AWS AUP (updated 2021-07-01); *Amazon SES Sending review process FAQs* (Manual investigation Q3; Bounce Q11) | **NOT SUITABLE** |
| **SendGrid (Twilio)** | "Except for transactional email, affirmative consent is required for all email sent using Twilio SendGrid." · "Consent cannot be blanket consent or gathered from a third party… Not from a purchased list, a third party lead generator, or an affiliate." Prohibited: "Sending emails to email addresses that you obtained from the Internet or social media … without obtaining prior affirmative consent". | SendGrid Support: *Email Opt-in and Opt-out Requirements*; *Email Prohibited Content Types and Uses* | **NOT SUITABLE** |
| **Postmark** | "All email lists contained and/or used with respect to the Service must be permission-based subscriptions." · "Use of a list that has been purchased or rented from a third party is prohibited." | Postmark Terms of Service §5(c) "Appropriate Email Practices" (effective 2024-12-10 for new customers) | **NOT SUITABLE** |
| **Google Workspace / Gmail** | Governing AUP (referenced by the Workspace agreement at `workspace.google.com/intl/en/terms/use_policy.html`, currently served as the Google Cloud AUP, modified 2025-10-13) prohibits using the services "to generate, distribute, publish or facilitate unsolicited mass email, promotions, advertisements, or other solicitations ("spam")". Separately, the *Gmail Program Policies* say "Don't use Gmail to distribute spam or unsolicited commercial mail", and note that for work accounts "terms may apply based on your organization's agreement with Google". Sending limits: 2,000 messages/user/day; 2,000 unique external recipients/day; exceeding them blocks sending for up to 24 hours. | Google Workspace Terms + AUP; Gmail Program Policies; *Gmail sending limits in Google Workspace* | **UNCLEAR / REQUIRES PROVIDER CONFIRMATION**. The governing AUP bans unsolicited *mass* email and spam, not individual messages, and "mass" is undefined. The Gmail Program Policies' broader "unsolicited commercial mail" wording may or may not govern Workspace accounts. Nothing expressly permits cold outreach. |
| **Microsoft 365 / Outlook** | Current *Product Terms* (Online Services AUP): customers may not use an Online Service "to spam or distribute malware" ("spam" undefined there). The *Microsoft Online Services AUP* page (dated Feb 2011) and the Microsoft Anti-Spam Policy prohibit transmitting "any unsolicited bulk or unsolicited commercial e-mail (i.e., spam)". The *Exchange Online limits* page says recipient rate limits exist "to discourage the delivery of unsolicited bulk messages" and that customers "who need to send legitimate bulk commercial email … should use third-party providers". Limits: 10,000 recipients/day, 30 messages/minute per mailbox, plus a tenant external-recipient rate limit. | Microsoft Product Terms; Microsoft 365 legal docid12; Exchange Online limits (updated 2026-09) | **UNCLEAR / REQUIRES PROVIDER CONFIRMATION**. The current Product Terms prohibit only "spam". The older AUP and anti-spam pages literally cover "unsolicited commercial e-mail", which on its face includes cold B2B email. |

**What this means.** None of the six providers *expressly* permits cold B2B outreach. The four ESPs expressly forbid it. Google and Microsoft mailboxes are the only candidates whose governing terms can be read as permitting individual, lawful, low-volume business email, but that is an interpretation and not a provider statement. The architecture therefore stays **mailbox-native and provider-abstracted**, and LeadVault must make a documented **risk-acceptance decision** (§30-1).

Risk containment that does not depend on the interpretation:
- **Isolate outreach mailboxes in a separate Google Workspace organization** on dedicated outreach domain(s), so any enforcement action cannot touch LeadVault's primary Workspace or `leadvaultdata.com`. This is a recommendation based on reasoning, not a provider rule. The "Internal" OAuth app must then be owned by a Cloud project in that outreach org.
- Keep volumes strictly individual and modest (defaults 30–50/day per mailbox, far below the provider caps), honor opt-outs immediately, use lawful content, and auto-pause on bounce/block signals (§17).
- If LeadVault wants a provider whose terms **expressly** allow cold B2B outreach, that is a separate research task (specialised cold-outreach sending infrastructure). It would plug in as another adapter and was not evaluated here.

Other options:

| Option | Notes |
|---|---|
| Generic SMTP/IMAP | Policy depends on the host. For Google, IMAP/SMTP via OAuth requires the full `https://mail.google.com/` scope (restricted), and password-based access is unsupported for Workspace since 2025-05-01. Works only from the worker. |
| Unified mailbox APIs (Nylas, EmailEngine) | Pass-through of the underlying mailbox, so provider policies are unchanged. Nylas from $15/mo. Not needed for MVP. |

### 14.2 Adapter interface

```ts
interface MailboxProviderAdapter {
  readonly provider: 'google_workspace' | 'microsoft_365' | 'smtp_imap';
  verifyConnection(conn): Promise<ConnectionHealth>;
  getSendCheckpoint(conn): Promise<string | null>;                // Gmail: getProfile().historyId
  sendMessage(conn, msg: OutboundMime): Promise<SendResult>;      // accepted | rejected_not_sent | ambiguous (§12.1)
  findSentEvidence(conn, ids: {rfcMessageId; lvMessageId}, checkpoint): Promise<SentEvidence>; // E1/E2; never returns "proven absent"
  syncMailbox(conn, cursor): Promise<{ items: InboundItem[]; nextCursor: string }>;
  parseInbound(raw): ParsedInbound;                               // shared MIME/DSN parsing lives outside adapters
  processWebhook?(req): Promise<NormalizedWebhook[]>;             // push (Gmail Pub/Sub, Graph notifications, future ESPs)
}
```
Campaign logic only ever sees `SendResult` / normalized events, never provider SDK types. MIME building (RFC 5322 headers, `List-Unsubscribe`, threading) is shared code. Tests run against a **FakeProvider** with scriptable failures (timeout-after-accept, 429, invalid recipient, delayed bounce).

Inbound processing is a **separate interface**, so the source of replies and bounces can change without touching campaign logic:
```ts
interface InboundIngestor {           // implementations: GmailApiIngestor (MVP), InboundRoutingIngestor (future), GraphIngestor
  ingest(conn): AsyncIterable<RawInboundMessage>;   // raw RFC 5322 + provider ids → shared parser → §15–17 pipeline
}
```

### 14.3 Gmail OAuth scopes: minimum per function (Google classifications from the official *Choose Gmail API scopes* page)

| Function | API calls needed | Minimum scope | Google class | Notes |
|---|---|---|---|---|
| **A. Sending** | `users.messages.send` (accepts `mail.google.com`, `gmail.modify`, `gmail.compose`, `gmail.send`) | `gmail.send` | **SENSITIVE** | Send-only; cannot read anything. |
| **B. Detecting replies** | `history.list`, `messages.get` (accept `mail.google.com`, `gmail.modify`, `gmail.readonly`, `gmail.metadata`) | Detection only: `gmail.metadata`. **With reply content in the Inbox: `gmail.readonly`** | metadata: **RESTRICTED**; readonly: **RESTRICTED** | `gmail.metadata` gives headers and labels but "not the email body", which is enough for In-Reply-To/References/Auto-Submitted, but the Inbox (an MVP feature) needs the body. |
| **C. Detecting bounces** | same as B | Detection: `gmail.metadata` (From mailer-daemon, `Content-Type: multipart/report`, `X-Failed-Recipients`). **Hard/soft classification: `gmail.readonly`** | **RESTRICTED** | The RFC 3464 `Status:` code (5.1.1 vs 4.x.x vs 5.7.x) and the original Message-ID live in the DSN **body parts**, which metadata cannot read. Without them, hard-bounce suppression would be guesswork. |
| **D. Threading replies** | Outbound: `messages.send` with `threadId` + `In-Reply-To`/`References`/matching subject (per Google's sending guide), and the response returns `id`/`threadId` | Outbound: `gmail.send`. Inbound matching: `gmail.metadata` minimum | SENSITIVE / RESTRICTED | Inbound thread matching needs headers, so a read scope. |
| **E. Checking Sent after an ambiguous result** | E1: `getProfile` (historyId), `history.list` (labelId=SENT), `messages.get` METADATA. E2: `messages.list` with `q` | E1: `gmail.metadata`. E2: `gmail.readonly` (Google: `q` "cannot be used when accessing the api using the gmail.metadata scope") | **RESTRICTED** | `getProfile` does **not** accept `gmail.send`. With send-only scope, automated reconciliation is impossible without inbound routing (§14.5). |

**Recommendation for MVP (LeadVault-owned mailboxes, Internal app): `gmail.send` + `gmail.readonly`.**
- `gmail.readonly` is a superset of every read call above, and its restriction class equals `gmail.metadata`'s (both RESTRICTED). So the narrower metadata scope buys no verification benefit, and it would cost reliable bounce classification and the Inbox.
- **Not requested:** `gmail.modify` (we keep processed-state in our DB, not Gmail labels), `gmail.compose` (draft-send idempotency rejected, §12.1), `https://mail.google.com/` (full access incl. permanent delete), and `gmail.settings.*`.
- Least-privilege compensation: only outreach-matched messages and DSNs are persisted (§15), unrelated mail is never stored, and refresh tokens are encrypted (§21).

### 14.4 When Google requires verification and a security assessment

| | **A. Internal app** (user type *Internal*; only users in the Workspace/Cloud Identity org that owns the Cloud project) | **B. External production app** (connects other organisations' Workspace accounts) |
|---|---|---|
| OAuth / brand verification | **Not required.** Google: "Verification is not required" for Internal apps. | **Required** for published External apps requesting sensitive or restricted scopes. Unverified published apps are capped at **100 users** and show warnings. External apps in *Testing* status get refresh tokens that **expire in 7 days**, so they are unusable for a background engine. |
| Sensitive scope (`gmail.send`) | Not required | Sensitive-scope verification required |
| Restricted scope (`gmail.readonly`/`metadata`) | **Not required.** Google lists internal organisational use ("used only by people in your Google Workspace or Cloud Identity organization") as an exception. | **Restricted-scope verification required** |
| Third-party security assessment | Not required (follows from the exception) | **Required:** "Every app that requests access to Google users' restricted data and has the ability to access data from or through a third-party server must go through a security assessment from Google-empanelled security assessors". Reassessment "at least every 12 months". Server-side processing like ours triggers it. |
| Domain-wide installation | — | Google: "If you plan for your app to only target users of a Google Workspace or Cloud Identity organization and always use domain-wide installation, then your app won't require **brand** verification." Whether this also waives restricted-scope verification and the assessment is **not stated**. **UNCLEAR, requires Google confirmation.** |
| Cost / duration | — | Google's pages state no cost. The assessment is performed by Google-empanelled assessors. Google mentions only that brand verification takes about 2–3 business days and restricted-scope review "several weeks". No estimate is given here. |

Operational notes (official): Workspace admins can apply session-control policies that invalidate tokens (`invalid_grant`, subtype `invalid_rapt`). Outreach mailboxes must be in an org unit **without** reauthentication session control, and the app must treat this error as "reconnect required". Admins may also need to allow the app under Admin console › Security › API controls.

### 14.5 Reducing Gmail scope needs: reply/bounce ingestion alternatives

| Mechanism | Gmail scope needed | Reliability | Security / privacy | Operations | Verdict |
|---|---|---|---|---|---|
| **Gmail API polling** (`history.list`) | `gmail.readonly` (RESTRICTED) | High. Self-healing via cursor, with full re-scan fallback when history expires. | Token can read the whole mailbox (mitigated: dedicated outreach mailboxes, store matched mail only) | Simple, no extra infra | **MVP** |
| **Gmail push** (Pub/Sub `watch`) | Same read scope (watch + history.list); no reduction | Lower alone: max 1 notification/sec per mailbox, notifications can drop, `watch` must be renewed every 7 days | Adds a public push endpoint (OIDC-verified) | GCP Pub/Sub topic setup | Optional latency add-on; polling stays on |
| **IMAP** (XOAUTH2) | `https://mail.google.com/` (RESTRICTED, *full* access) | Good, but more connection handling | **Worse:** broadest scope | Long-lived connections | Rejected for Gmail |
| **Inbound routing** (Workspace Admin › Gmail › Routing, "Add more recipients" on inbound **and outbound** mail for the outreach mailboxes, to an app-owned inbound address processed by an inbound-mail service on our own domain) | **None for reading.** Only `gmail.send` (SENSITIVE) for sending | Server-side, independent of OAuth tokens. The outbound copy gives send-confirmation evidence (E3). Unverified: whether Gmail-generated NDRs from `mailer-daemon` are covered by routing rules (Google's page documents no answer), so this needs a test. Rule changes "can take up to 24 hours". | Full message copies leave Google to our inbound processor (data-processing implications). Narrower OAuth blast radius. | Admin-console rules per org, an inbound mail service + DNS, and canary monitoring (periodic test message) to detect a silently removed rule | **Future path for customer-owned mailboxes**: avoids restricted scopes, so verification would be sensitive-scope only and **no security assessment**, provided Google confirms. Must be validated by spike. |
| User-level auto-forwarding (per-user Gmail filter) | None | Weaker: user-editable, admin can disable external forwarding | Same data-egress concern | Per-mailbox manual setup | Not recommended |
| Microsoft equivalents | Graph `Mail.Send` + `Mail.Read` (delegated), or Exchange transport rules (BCC to inbound address) | Analogous | Analogous | Analogous | Same pattern available |

Conclusion: for LeadVault-owned mailboxes the restricted scope costs nothing (Internal exemption) and gives the most reliable result, so **Gmail API polling is the MVP choice**. The ingestion interface keeps **inbound routing** available as the scope-minimising design for customer mailboxes later.

### 14.6 Recommendation (Revision 2), superseded by §14.7

Revision 2 recommended Google Workspace via the Gmail API. §14.7 found infrastructure providers whose terms **expressly permit** B2B cold outreach and that are technically adequate. Per the owner's rule ("do not recommend a provider whose policy remains UNCLEAR if a technically adequate provider expressly permits our use case"), Google Workspace / Microsoft 365 are now **fallback-only** adapters. The Gmail scope and verification analysis in §14.3–14.5 remains valid for that fallback. Still in force: external customer mailbox connections are **deferred**; **system email** uses Resend (solicited mail); **no transactional ESP for outreach**.

### 14.7 Outreach sending infrastructure: market investigation (Revision 3, 2026-10-01)

Question: *which email/mailbox infrastructure should LeadVault's own campaign engine use underneath?* Policies were taken from each provider's **own** terms or help pages. Marketing to sales teams was **not** treated as permission. Third-party review sites were used only to find candidates, never as evidence.

#### 14.7.1 Policy screen (all candidates)

| Category | Provider | Official policy (quoted / cited) | Classification |
|---|---|---|---|
| **Cold-outreach mailbox infrastructure** (own mail servers) | **Mission Inbox**, *Sales/outbound* product | ToS & AUP (updated 2026-01-01) §4.2 "Sales & Marketing: Permitted Use": "B2B only: Sends must target business email addresses…"; "Personalization required: Emails must be individually relevant to the recipient's business role, company, or function. Mass, non-personalized blasts are prohibited."; "Opt-out mechanism: All outbound emails must contain a clear, functional, and immediately honored opt-out or unsubscribe mechanism."; "Reasonable volume: … Blasting unwarmed mailboxes is a Terms violation." §4.1: complaint rate "Below 1.0% of sends" (else "Immediate suspension"), hard bounce "Below 4.0% of sends" (warning, suspension if not fixed in 48h), unsubscribes honored "Within 7 calendar days". §4.4 prohibits list brokers/rental. | **EXPRESSLY PERMITTED — with explicit conditions** |
| | **Infraforge** (Salesforge group; dedicated IPs) | Terms (updated 2025-12-29) Art. 3.4 Sending Policy: "The Services may be used for lawful commercial email outreach, including unsolicited business-to-business outreach where permitted by applicable law." Also: "The Services will only be used to send emails to verified addresses."; "Where consent or another lawful basis is required, you must obtain and document it."; all emails must include an "Unsubscribe" link, honored "promptly, without intentional delay". Termination for an "unusual number of spam or abuse complaints". | **EXPRESSLY PERMITTED — conditional on applicable law, verified addresses, unsubscribe** |
| | **Mailforge** (Salesforge group; shared IP pool) | Terms (updated 2025-12-29) Art. 3.4: the same "including unsolicited business-to-business outreach where permitted by applicable law" and "verified addresses" wording. | **EXPRESSLY PERMITTED — same conditions** |
| | Maildoso | Official terms not retrievable this session (only third-party descriptions) | **UNCLEAR (not verified)** |
| **Google/Microsoft mailbox resellers** | Primeforge, Zapmail, Instantly DFY accounts, similar | They provision real Google Workspace / Microsoft 365 accounts, so **Google's/Microsoft's own terms govern sending** (§14.1) | **UNCLEAR** (inherits Google/Microsoft) |
| **Google Workspace / Microsoft 365** | — | §14.1 | **UNCLEAR** |
| **Sales-engagement apps** | Instantly, Smartlead, Lemlist, Reply.io, Mailshake, Woodpecker, Saleshandy | Instantly ToS (updated 2026-09-22) §1.10 permits "Subscriber's own direct business-to-business (B2B) sales, marketing … activities". These are **campaign engines**. They send through connected Google/Microsoft/SMTP mailboxes, so the underlying mailbox policy still applies. Instantly's documented API sends first-touch email via campaigns (`/campaigns/…`) and replies via `/emails/reply`. Smartlead's documented API is campaign-centric (`/campaigns/{id}/reply-email-thread`). Individual terms for Lemlist, Reply.io, Mailshake, Woodpecker and Saleshandy **were not verified**, because the category fails requirement 15 regardless. | App permits; **sending layer inherits the mailbox provider**. **Excluded: replaces our engine.** |
| **Transactional / marketing ESPs** | Mailgun | AUP (2023-01-16) 1b: "Use of contact lists that are bought, rented or scraped from third-parties is prohibited"; 1c: only "where permission has been expressly obtained" | **NOT PERMITTED** |
| | SMTP2GO | Terms: "We forbid the use of the service to send unsolicited mass emails or unsolicited emails of any kind." "Lists must be 100% opt-in." Not allowed: "marketing leads (including lists built via LinkedIn or obtained from a 3rd party)" | **NOT PERMITTED** |
| | Mailjet | Sending policy (AUP): bought/rented/scraped third-party lists "absolutely prohibited on Mailjet servers"; consent must be "clear, explicit and provable" | **NOT PERMITTED** |
| | Brevo | Anti-spam policy: lists "scraped on the internet, acquired or purchased from a third-party … strictly prohibited" (official help/policy pages; full-text fetch blocked, wording from Brevo's own pages) | **NOT PERMITTED** |
| | SparkPost (Bird) | Messaging Policy v3.0: "Use only permission-based marketing email lists…"; "Do not send to … purchased or rented email lists … scraped from the Internet" | **NOT PERMITTED** |
| | MailerSend | Anti-Spam Policy (2026-08-31): spam = mail to someone "who has not given you their direct permission or when you do not have other legal grounds"; no sending to addresses "acquired from a third party, no matter what they claim about the quality or permission" | **NOT PERMITTED** |
| | Resend, Amazon SES, SendGrid, Postmark | §14.1 | **NOT PERMITTED** |
| **Mailbox access APIs** | Nylas, Unipile, EmailEngine | Pass-through to the underlying mailbox; add nothing to policy | Inherit the underlying provider |

**Important for LeadVault:** LeadVault research data is third-party-sourced from the recipient's point of view. Every expressly-permitting provider still requires **lawful** sending under the recipient's jurisdiction, opt-out handling, and (Infraforge/Mailforge) **"verified addresses"**. Those conditions are already architectural: jurisdiction policies (§10), unsubscribe (§19) and suppression (§18). The new requirement is **pre-send email verification** (§14.7.5).

#### 14.7.2 Technical comparison: serious candidates

Serious = the three expressly-permitting providers, plus Google Workspace (the incumbent fallback, UNCLEAR) for reference.

| # | Criterion | **Mission Inbox (Sales)** | **Infraforge** | **Mailforge** | Google Workspace (fallback) |
|---|---|---|---|---|---|
| 1 | Cold B2B policy | **Expressly permitted, explicit conditions** | **Expressly permitted** (law + verified addresses) | **Expressly permitted** (same) | UNCLEAR |
| 2 | Programmatic sending | Yes: **SMTP per mailbox** (`smtp.missioninbox.com:465`). A REST send API exists in the *Transactional* product (separate key, separate product; not the cold-outreach line) | Yes: **SMTP per mailbox** (credentials exportable; API also exports them) | Yes: **SMTP per mailbox** (credentials CSV export) | Gmail API (HTTPS) |
| 3 | Reply detection | **IMAP** (`imap.missioninbox.com:993`) | **IMAP** | **IMAP** | Gmail API |
| 4 | Bounce handling | DSNs to the mailbox, read via IMAP. The suppression-list API exists (`/api/servers/suppressions`) | DSNs via IMAP | DSNs via IMAP | DSNs via Gmail API |
| 5 | Webhooks / events | Signed (HMAC `X-MI-Signature`) delivery webhooks (`message.sent/delivered/bounced/complained/…`) are documented for the **Transactional** product; inbound webhooks are a Scale-tier feature. For Sales mailboxes, plan on **IMAP polling** (verify in spike). | None documented; IMAP polling | None documented; IMAP polling | Pub/Sub push (optional) |
| 6 | Threading | Standard RFC headers via SMTP. ⚠ MI docs state that for the transactional **relay**, "The recipient's copy carries the provider's own Message-ID". Whether Sales-mailbox SMTP preserves our Message-ID is **unverified** and is spike item #1. Sub-addressing (reply token in address) is available on request. | Standard RFC headers; preservation **unverified** (spike) | Same as Infraforge | Thread via `threadId`; Message-ID preservation unverified |
| 7 | SMTP / API / IMAP | SMTP + IMAP + **management REST API** (domains, mailboxes, bulk create, credentials, warmup, health checks, suppressions; official Node SDK) | SMTP + IMAP + **management API** (buy/generate/list/update/delete/export mailboxes) | SMTP + IMAP; management API (vendor-documented) | API only (IMAP needs full-access scope) |
| 8 | Dedicated domains/mailboxes | Yes; **dedicated IPs included** in outbound plans; domains + DNS automation | Yes; **dedicated IPs** add-on ($99/mo per vendor pricing page) | Yes; **shared IP pool** | Yes |
| 9 | Sending limits | Plan volume: **Lite 5,000 sends/mo (15 mailboxes)**, Scale 10,000/mo (30 mailboxes), expandable. Volume must be "proportionate to mailbox count and warm-up status". | Vendor guidance: "30 emails per mailbox per day (max 100)" | Same guidance | 2,000/user/day hard cap |
| 10 | Warm-up / reputation | **Required by ToS** (unwarmed blasting = violation). Automated mailbox warmup + API (`/api/warmup/mailboxes`, daily-limit control); domain warmup on Scale | Vendor warm-up tooling (Warmforge; pricing not verified) | Same | Not provided |
| 11 | AUP restrictions | B2B addresses only, personalization, opt-out honored ≤7 days, no list brokers, volume proportional to warm-up | Lawful only, verified addresses, unsubscribe link in **all** emails | Lawful only, verified addresses | §14.1 |
| 12 | Suspension risk | **Explicit and measurable**: complaints ≥1% → immediate suspension; hard bounces ≥4% → 48h to fix; sole-discretion clause for infrastructure harm | Termination for "unusual number" of complaints (unquantified); sending limits possible | Same as Infraforge; plus shared-IP reputation coupling with other customers | Unquantified |
| 13 | Current pricing (official pages) | Lite **$50/mo** (15 mailboxes, 5,000 sends); Scale **$199/mo** (30 mailboxes, 10,000 sends) | Mailboxes ~**$4/mailbox/mo** billed quarterly ($12/qtr) or $40/yr (min 10 slots); domains $14/yr; dedicated IP $99/mo. Figures read from the official pricing calculator; confirm at checkout. | ~**$3/mailbox/mo** monthly or $30/yr (min 10 slots); domains $14/yr | ~€6.80/user/mo (§29) |
| 14 | **Min. realistic MVP cost** (≈10–15 mailboxes, ~4–5k sends/mo, 4–5 domains) | **≈ $50/mo** + domains (~$5/mo amortised) | **≈ $40/mo** shared IP, or **≈ $140/mo** with one dedicated IP, + domains | **≈ $30/mo** + domains | ≈ $70–120/mo seats |
| 15 | LeadVault keeps campaign logic, sequences, scheduling, prospects, analytics, suppression, reply classification | **Yes**: raw mailboxes; no campaign UI imposed | **Yes** | **Yes** | Yes |
| 16 | Vendor lock-in | **Low**: standard SMTP/IMAP; management API optional. Check domain ownership/transfer terms. | **Low**: same | **Low**: same | Low |
| 17 | Architecture fit (worker → adapter → infra; IMAP → app → Postgres) | **Clean** via a generic `SmtpImapAdapter` + optional `MissionInboxManagement` client. ⚠ Railway **Pro** required (outbound SMTP blocked below Pro, §14.7.4). | **Clean**, same adapter | **Clean**, same adapter | Clean (built for it) |

#### 14.7.3 Verdicts

| Award | Pick | Reason |
|---|---|---|
| **BEST POLICY FIT** | **Mission Inbox (Sales)** | The only candidate whose terms give an explicit permitted-use section for cold B2B *and* measurable thresholds (complaint <1%, hard bounce <4%, unsubscribe ≤7 days). LeadVault can encode those as hard guardrails. Infraforge/Mailforge expressly permit too, but with unquantified enforcement. |
| **BEST TECHNICAL FIT** | **Mission Inbox (Sales)** | Standard SMTP/IMAP mailboxes **plus** the richest management API (provisioning, credentials, warmup, health checks, suppressions; Node SDK). Dedicated IPs are included at the entry plan. |
| **BEST LOW-COST FIT** | **Mailforge** | ≈$30/mo for 10 mailboxes. Trade-off: a shared IP pool means reputation is coupled to other senders. |
| **BEST LONG-TERM FIT** | **Mission Inbox primary + Infraforge secondary**, both behind the same `SmtpImapAdapter` | Two independent, expressly-permitting providers with standard protocols. If one provider suspends or degrades, the other keeps sending, without code changes. |
| **BEST FALLBACK** | **Infraforge** (dedicated-IP option). Google Workspace via Gmail API stays a *last-resort* adapter only (policy UNCLEAR). | Same protocol path as the primary, so switching means credentials only. |

#### 14.7.4 Technical contradictions found (resolved)

1. **Railway blocks outbound SMTP below Pro.** Railway docs: "SMTP is only available on the Pro plan and above. Free, Trial, and Hobby plans must use transactional email services with HTTPS APIs." All expressly-permitting providers deliver mailboxes via SMTP, so **production and staging must run on Railway Pro** ($20/mo, incl. $20 usage). IMAP (993) and HTTPS are unaffected. Local development is unaffected. This does not reopen the Railway decision; it fixes the plan tier.
2. **Message-ID rewriting.** Mission Inbox documents that its transactional relay rewrites the Message-ID. If Sales-mailbox SMTP does the same, reply matching cannot rely on `In-Reply-To` = our ID. Mitigations, in order: (a) choose the provider that preserves it (spike); (b) **per-message reply token via sub-addressing** (`Reply-To: box+{token}@domain`, available from MI on request); (c) learn the provider-assigned ID from the copy in the mailbox, if one is stored; (d) the existing sender-fallback matcher (§16). This is resolved by design and confirmed in Phase 0.
3. **Ambiguous-send evidence over SMTP.** There is no Gmail-style Sent history. Evidence sources: E2' provider email-log lookup by Message-ID (MI documents `POST /api/email/status` for its relay; applicability to Sales mailboxes is a spike item), E3 inbound/journal copy (a **Bcc to a LeadVault-owned journal mailbox**, if the provider permits and it is counted in volume), and E4 downstream reply/DSN. Absence of evidence still → `OPERATOR_REVIEW` (§12.1, unchanged). An SMTP `250` after `DATA` = accepted. A connection lost after the final `.` before `250` = ambiguous. 4xx/5xx replies to `MAIL/RCPT/DATA` = rejected_not_sent.

#### 14.7.5 Required additions to the approved architecture (no locked decision changes)

- **Adapters:** `SmtpImapAdapter` (generic; nodemailer for SMTP, imapflow for IMAP, mailparser shared with the DSN parser) becomes the **first** adapter. `MissionInboxManagement` (optional provisioning/warmup/health via REST). `GoogleWorkspaceAdapter` is moved to **fallback/post-MVP**. `provider_connections.provider = 'smtp_imap'` (already in the schema), plus `infra_vendor` (`mission_inbox` | `infraforge` | `mailforge` | `google_workspace` | …). `sync_cursor` = IMAP `UIDVALIDITY:lastUID`.
- **Warm-up/ramp enforced by our scheduler:** add `mailboxes.warmup_status` (`warming` | `ready` | `paused`), `warmup_started_at`, and `ramp_schedule`. The effective daily limit = min(mailbox limit, ramp step, provider plan volume share). A mailbox in `warming` cannot be selected for campaigns until the ramp target is reached. Provider warm-up runs on the provider's side.
- **Provider guardrails stricter than provider thresholds:** mailbox auto-pause at hard-bounce rate **≥ 2%** (rolling) and complaint signals **≥ 0.3%** (below MI's 4% / 1%). Unsubscribes take effect immediately (within MI's 7-day limit by design).
- **Pre-send email verification** (Infraforge/Mailforge "verified addresses"; MI bounce threshold): a new eligibility code `EMAIL_UNVERIFIED`/`EMAIL_VERIFICATION_FAILED`, via a verification-provider adapter or verified-status provenance from LeadVault research. Choosing a verification vendor is an owner decision (§30).
- **B2B-only rule (MI condition):** `ROLE_OR_FREE_MAILBOX` becomes **INELIGIBLE** for free consumer domains (gmail.com, yahoo.com, …) when the mailbox's `infra_vendor` requires B2B-only.
- **Unsubscribe link in every email** (Infraforge requirement): already the design (§19).

#### 14.7.6 Final recommendation for LeadVault Outreach

- **Primary outreach infrastructure: Mission Inbox, Sales/outbound product, Lite plan (≈$50/mo) for MVP.** Use LeadVault-controlled dedicated outreach domains and mailboxes, connected through LeadVault's own `SmtpImapAdapter`. The provider's campaign features are not used. Its policy **expressly permits** our use case with explicit conditions, which our design already enforces or now adds (§14.7.5).
- **Condition:** the Phase 0 spike must confirm Message-ID preservation or sub-addressing, IMAP delivery of DSNs, and reconciliation evidence. **If Mission Inbox fails the spike, Infraforge takes the primary role on the same adapter.**
- **Secondary/fallback: Infraforge.** Keep a small warmed pool once volume justifies it.
- **Not recommended for outreach:** every ESP screened (NOT PERMITTED); Google Workspace / Microsoft 365 and their resellers (UNCLEAR, last-resort fallback only); sales-engagement apps (they replace our engine).
- A suitable, technically adequate provider **was** verified as expressly permitting the use case, so the "no suitable provider" outcome does **not** apply.

---

## 15. Reply Processing Architecture

1. **Trigger:** `mailbox.sync` every ~3 min (MVP), or immediately on a Gmail Pub/Sub push (optional). Push notifications are capped at 1 event/sec per mailbox and can be dropped, so **polling stays on as the safety net**.
2. **Fetch:** Gmail `history.list(startHistoryId=sync_cursor)` → new message IDs → `messages.get(format=full|raw)`. If the cursor has expired (404), fall back to a bounded `messages.list` of the last N days.
3. **Filter before storing:** keep only messages (a) whose `In-Reply-To`/`References` contains one of our `rfc_message_id`s, (b) whose provider thread id is one of ours, (c) from an address we have sent to, or (d) that are DSN/NDR bounce reports. Everything else is skipped and **not persisted** (privacy).
4. **Classify kind:**
   - **bounce_report**: `Content-Type: multipart/report; report-type=delivery-status`, or `mailer-daemon`/`postmaster` sender → §17.
   - **auto_reply**: `Auto-Submitted: auto-replied|auto-generated`, `X-Autoreply`, `X-Autorespond`, `Precedence: auto_reply|bulk|junk`, or OOO subject heuristics → stored, thread classification OUT_OF_OFFICE, **no stop** (default).
   - **unsubscribe_request**: human reply whose body matches clear opt-out phrases ("unsubscribe", "remove me", "stop emailing") → treated as a reply **and** an unsubscribe (§19). It is also flagged in the Inbox, so an operator can lift it if it was a false positive.
   - **human_reply**: everything else that matched.
5. **Match (§16)** → one transaction (§4.13): insert `replies`, upsert `reply_threads` (classification UNREVIEWED, unread), insert `message_events(replied)`, recipient → **REPLIED** (state-guarded), cancel PENDING messages, update `prospect_outreach_state.last_reply_at`, audit.
6. Mailbox messages **we** sent manually from Gmail inside a tracked thread are recorded as `messages(kind='manual_reply')`, so the thread view in the Inbox is complete.

## 16. Inbox Threading Architecture

Match priority (stop at first hit):
1. **`In-Reply-To`** = an `messages.rfc_message_id` → exact.
2. **`References`** contains any of our `rfc_message_id`s → exact (handles replies-to-replies and forwards-with-reply).
3. **Provider thread id** (Gmail `threadId` / Graph `conversationId`) = a `messages.provider_thread_id` → strong.
4. **Sender fallback:** `from_email` equals a recipient's address that we sent to from **this mailbox** within the last 90 days, with exactly one candidate recipient → probable (`match_method='sender_fallback'`, shown with a "matched by sender" hint).
5. Otherwise **unmatched**: shown in an Inbox "Unmatched" filter for manual linking (if the sender is an outreach address). Never auto-assigned.

Subject-line matching is **not** used. `reply_threads` is unique per `(mailbox_id, provider_thread_id)`, so all messages in a conversation collapse into one Inbox row. A reply from a *different* person at the prospect's company that is matched by headers (colleague replied) still stops the sequence for that recipient. The UI shows the actual sender.

Inbox UI: a two-pane list/detail on desktop and stacked on mobile. Filters: classification, campaign, mailbox, unread, unmatched. Keyboard: `j/k` move, `1–7` classify, `e` archive. Inbound HTML is sanitized server-side (allowlist) and rendered in a **sandboxed iframe** with remote images blocked by default (prevents tracking pixels and XSS). Plain-text view is the default.

MVP replies **from** the app are optional (Phase 6 stretch). The baseline is an "Open in Gmail" deep link, and the operator's Gmail reply is captured by sync (step 6 above).

## 17. Bounce Processing

Source: DSN/NDR messages delivered to the sending mailbox, plus synchronous rejections at submit time (adapter returns `rejected_not_sent` with a permanent code). Classifying a bounce requires reading the DSN body parts, so `gmail.readonly` is required (§14.3).

1. Parse `message/delivery-status` parts: `Final-Recipient`, `Action`, `Status` (RFC 3463 enhanced code), `Diagnostic-Code`; plus `X-Failed-Recipients`.
2. Identify the original message: the `text/rfc822-headers` / `message/rfc822` part's `Message-ID` → `messages.rfc_message_id`. Fallback: `Final-Recipient` + mailbox + recent send window.
3. Classify:

| Class | Typical codes | Action |
|---|---|---|
| **Hard bounce** (address invalid) | `5.1.1`, `5.1.10`, `5.1.2`, `5.4.1` (no such user/domain) | event `hard_bounce`; recipient → **BOUNCED**; cancel PENDING; **HARD_BOUNCE suppression, scope `global` by default** (§18) |
| **Soft bounce** | `4.x.x`, `5.2.2` mailbox full, delivery-delayed notices | event `soft_bounce`; no suppression; recipient continues; after 3 → FAILED |
| **Blocked / policy** | `5.7.x` (spam/policy/auth), "message rejected" | event `blocked`; **do not** suppress the address (it is our reputation, not their address); count toward **mailbox health**; auto-pause the mailbox above threshold |
| Unparseable | — | stored as `bounce_report` with `match_method='none'`, surfaced in System status for manual review |

4. Dedupe: `message_events.dedupe_key = 'bounce:' || message_id || ':' || dsn_provider_message_id`.
5. **Mailbox health rule** (set stricter than provider suspension thresholds, §14.7.5): rolling hard-bounce rate **≥ 2%** of the last 100 sends, complaint signals ≥ 0.3%, or ≥ 3 `blocked` events in 24h → mailbox NEEDS_ATTENTION and its campaigns auto-pause, with a reason shown and an operator alert. A workspace-wide hard-bounce rate ≥ 2% also pauses new first-touch sends pending review of the source data.

`messages.bounced_at`/`bounce_type` are denormalized for analytics.

## 18. Suppression Architecture

- **Reasons:** UNSUBSCRIBE, HARD_BOUNCE, MANUAL_DO_NOT_CONTACT, COMPLIANCE (+ COMPLAINT, reserved for future ESP feedback loops).
- **Both scopes are first-class (confirmed in the schema, §4.11):** `scope='workspace'` (row has `workspace_id`) and `scope='global'` (`workspace_id IS NULL`, enforced by a CHECK). Each has its own partial unique index on active values. **Value:** a single email **or** a whole domain.
- **Default scope by reason** (configurable in platform settings; defaults pending §30-4):

| Reason | Default scope | Why |
|---|---|---|
| HARD_BOUNCE | **global** | The address is unusable for everyone. Sending to it again from any workspace only harms reputation. |
| COMPLIANCE | **global** | Legal/regulatory do-not-contact applies to LeadVault as a whole. |
| COMPLAINT (future) | **global** | Same reasoning as hard bounce. |
| UNSUBSCRIBE | **workspace** (the sender/client the person opted out of) — owner may switch to global | The recipient opted out of *that* sender. |
| MANUAL_DO_NOT_CONTACT | operator chooses; workspace preselected | — |

- **Who may create/lift:** workspace scope by OPERATOR+ (create) and ADMIN+ (lift). Global scope is created automatically by the system (hard bounce, compliance) or manually by a **platform admin**. **Lifting a global suppression requires a platform admin**, with a reason, and is audited. A workspace ADMIN can never lift a global suppression.
- **Visibility:** workspace users see global suppressions that affect their prospects (value, reason, date). They do not see which other workspace's campaign produced them; the source is shown as "LeadVault-wide".
- **Durable:** never hard-deleted. "Remove" = **lift** (reason required, audited); history stays visible.
- **Enforced at four points:** (1) import (row flagged SUPPRESSED; record stored as research truth but never enrollable), (2) eligibility evaluation, (3) dispatch, (4) **final pre-send claim**. Check = active email match **or** active domain match, in **this workspace or global**. It is a single indexed query.
- **Fan-out on creation:** adding a suppression immediately, in the same transaction, moves all non-terminal `campaign_recipients` with that address/domain in scope to SUPPRESSED (or UNSUBSCRIBED/BOUNCED per reason) and cancels their PENDING messages.
- **Re-import never reactivates:** imports never write to `suppressions`. A previously suppressed address re-imported is counted in "Suppressed" in the summary and its prospect shows the suppression badge plus reason, source, date and the message/campaign that caused it.
- **UI:** the Suppression page lists value, type, scope, reason, source (with link to the originating message/campaign), created by/at, and lifted info. Prospect and recipient views show a suppression banner with the same "why".

## 19. Unsubscribe Architecture

**Every sequence email includes:**
- Headers: `List-Unsubscribe: <https://{unsub-host}/u/{token}>, <mailto:{mailbox}?subject=unsubscribe>` and `List-Unsubscribe-Post: List-Unsubscribe=One-Click` (RFC 8058). Gmail, Yahoo and Microsoft expect this from bulk senders. It is cheap to include for every sender.
- A short, human, plain-text opt-out line in the body plus a footer, both taken from the recipient's **resolved jurisdiction policy** (§10, `jurisdiction_policies.footer_template`, `requires_postal_address`). Example: *"Not relevant? Reply 'no thanks' or opt out here: <link>"*. Where the policy requires it (e.g. US CAN-SPAM requires a valid physical postal address in commercial email), the workspace postal address is included, and launch is blocked for affected recipients until it is set. Policies per country are owner/counsel-maintained data (§30-5). Unknown jurisdiction → NEEDS_REVIEW, never sent by default.

**Token:** `base64url(message_id) + '.' + HMAC-SHA256(message_id, UNSUBSCRIBE_SIGNING_SECRET)`. It is stateless, unforgeable and non-enumerable, and it resolves to message → recipient → workspace → email. Key rotation is supported by a key-id prefix.

**Flow (`/u/[token]`):**
- `POST` (one-click from mail clients, or the confirm button) → verify HMAC → **one transaction**: upsert `unsubscribes` (unique per message + method, so repeated clicks are idempotent) → create/keep an active `UNSUBSCRIBE` suppression → recipient(s) → UNSUBSCRIBED → cancel PENDING messages → `message_events(unsubscribed)` → `campaign_outcomes(UNSUBSCRIBE)` → audit (`actor_type='system'`). Responds 200 with a simple confirmation.
- `GET` → a confirmation page with a single button (POST). **GET never unsubscribes**, because corporate link scanners prefetch URLs and would cause false opt-outs.
- No login, no tracking. Rate-limited per IP hash. Invalid tokens return a generic page (no information leak).
- **Reply-based** ("please remove me") → §15 classification → the same transaction with `method='reply'`.
- **Manual** (operator marks thread UNSUBSCRIBE) → the same transaction with `method='manual'`.

Unsubscribe-link host: see §30-8. Using `app.leadvaultdata.com` ties the primary brand domain to cold-email links. A host on the outreach domain (CNAME to the app) keeps reputations separate.

## 20. Webhook Architecture

MVP inbound webhooks are few (optional Gmail Pub/Sub push; unsubscribe POST is our own endpoint). The pipeline is built generically for future providers (Graph change notifications, ESP events, outbound customer webhooks later).

```
POST /api/webhooks/{provider}
  1. Verify authenticity BEFORE parsing the body as trusted:
       Gmail Pub/Sub push → Google-signed OIDC JWT (issuer, audience = our URL, service-account email)
       Graph → clientState secret + validation token handshake
       Signature-based providers → HMAC over the raw body, constant-time compare, timestamp tolerance (replay window)
  2. Insert webhook_events (dedupe_key = provider event id or sha256(raw body)) ON CONFLICT DO NOTHING
  3. Return 2xx fast (< 1s). Never do business work in the request.
  4. Enqueue pg-boss job webhooks.process(id) (singletonKey = id)
Worker:
  5. Lock row (status received|failed) → normalize → idempotent domain actions (unique dedupe keys,
     state-guarded transitions) → status processed | ignored | failed (+attempts, sanitized error)
  6. Retry sweep for failed rows. Admin "replay" button re-enqueues a stored event (safe: idempotent).
Out-of-order handling: events carry occurred_at. Terminal states never regress, and a 'sent' event
arriving after a 'bounce' cannot un-bounce. Counters are derived from events, not incremented blindly.
```
Invalid signatures are stored with `signature_valid=false` (for forensics, minimal payload), never processed, and return 401. Raw payload retention: 30 days, then the payload is pruned and the normalized rows kept.

---

## 21. Security Model

| Area | Design |
|---|---|
| AuthN | Supabase Auth, invite-only, optional TOTP MFA for OWNER/ADMIN, secure HTTP-only SameSite=Lax cookies. |
| AuthZ | DAL `requireWorkspaceAccess` + role matrix (§7) + RLS default-deny + composite tenant FKs. |
| Server/client boundary | All DB access and provider calls are server-only (`import 'server-only'` guards). The browser receives only the Supabase **anon/publishable** key (needed for auth), with the Data API disabled for app tables. The **service role key is never used by the web app's user paths** and is never shipped to the client. |
| CSRF | Server Actions (Origin-checked by Next.js). Route-handler mutations require same-origin checks. OAuth uses `state` + PKCE. The unsubscribe POST is token-authorized (CSRF-irrelevant by design). |
| XSS | React escaping. **No** `dangerouslySetInnerHTML` except sanitized inbound email inside a sandboxed iframe. Strict CSP (nonce-based scripts), `X-Content-Type-Options`, `frame-ancestors 'none'`, `Referrer-Policy`. |
| Input validation | Zod at every boundary (actions, routes, worker job payloads, CSV rows, webhook bodies). |
| SQL injection | Drizzle parameterized queries only. Raw SQL via tagged templates (parameterized). Sort/filter fields are allowlisted (never interpolated identifiers). |
| Rate limiting | Supabase limits for auth. App-level Postgres-backed limiter for `/u/*`, webhooks, test-send, and invite actions. |
| Secrets | Railway environment variables (sealed). Nothing in Git. `.env.example` lists names only. Separate secrets per environment. |
| Provider credentials | OAuth refresh tokens / SMTP passwords encrypted with **AES-256-GCM** at the application layer (key `CREDENTIALS_ENCRYPTION_KEY`, versioned for rotation) before storage in `provider_connections.encrypted_credentials`. Access tokens are kept in memory only. |
| Logging hygiene | pino redaction paths (`authorization`, `cookie`, `*.token`, `*password*`, `encrypted_credentials`, email bodies). Audit metadata is allowlisted. |
| Errors | Users see a stable error code + friendly message + request ID. Stack traces and provider bodies go to Sentry/logs only. |
| Least privilege | Gmail scopes limited to send + read. The worker DB role is separate from the migration role (Phase 8 hardening). Storage bucket is private, with signed URLs that expire in minutes. |
| Dependency hygiene | Lockfile committed, Dependabot/Renovate, `npm audit` in CI, minimal dependencies. |
| Data protection | Inbound email bodies retained per policy (§30-9). Import files deleted after N days. Hashed IPs. Backups encrypted at rest (Supabase). |

---

## 22. UI/UX Architecture

**Shell:** a fixed left sidebar (collapsible to icons; becomes a slide-over sheet below 1024px) + a top bar.

```
┌──────────────────────┬──────────────────────────────────────────────────────────┐
│ ◆ LEADVAULT OUTREACH │  Campaigns › Georgia Healthcare Q4      [⌘K Search] [+ New] 🔔 ◉ │
│ [OTD Global      ▾]  ├──────────────────────────────────────────────────────────┤
│                      │                                                          │
│ Dashboard            │   page content                                           │
│                      │                                                          │
│ PROSPECTING          │                                                          │
│   Prospects          │                                                          │
│   Audiences          │                                                          │
│   Imports            │                                                          │
│ OUTREACH             │                                                          │
│   Campaigns          │                                                          │
│   Inbox        (12)  │                                                          │
│   Templates          │                                                          │
│ DELIVERABILITY       │                                                          │
│   Mailboxes     ⚠    │                                                          │
│   Suppression        │                                                          │
│ INSIGHTS             │                                                          │
│   Analytics          │                                                          │
│ ──────────────────── │                                                          │
│ Settings             │                                                          │
│ ◉ Jane D. · Admin    │                                                          │
└──────────────────────┴──────────────────────────────────────────────────────────┘
```
Changes from the suggested nav (with reasons): (1) a **workspace switcher** at the top, required for workspace-per-client. (2) **Imports** promoted to the nav, because imports are a frequent operational task with their own history. (3) "Infrastructure" renamed **Deliverability**, which says why Mailboxes and Suppression matter to an operator. (4) Inbox shows an unread badge; Mailboxes shows a warning badge when any mailbox needs attention. (5) **System status** (worker heartbeat, dead-letter count) lives in the top-bar status indicator.

**Top bar:** breadcrumb/page title · **⌘K command palette** (global search across prospects, campaigns, audiences, plus quick actions) · "New" quick-action menu (Import, Campaign, Audience, Template) · notifications/system status · profile menu.

**Visual language:** neutral grey surfaces, one restrained brand accent, Inter/Geist at 14px base with tabular numerals in tables, 4/8px spacing scale, small radii (6px), 1px borders over shadows, no gradients or glassmorphism. Density toggle (comfortable/compact) for tables. **Light theme default**, with dark mode supported via tokens.

**Core patterns:**
- **Data tables:** server-side pagination (cursor or keyset for large sets), sortable columns, a sticky header, a column visibility menu, a filter bar with removable chips (in the URL via nuqs), bulk-select with action bar ("Add to audience", "Enroll in campaign", "Suppress"), and row → detail.
- **Status badges:** text + color + icon (never color alone), with one consistent mapping app-wide (e.g. ELIGIBLE green, NEEDS_REVIEW amber, SUPPRESSED red-grey, PAUSED amber).
- **"Why" everywhere:** eligibility, exclusion, suppression and mailbox warnings always show reason labels, with a tooltip/detail.
- **Campaign builder:** a left vertical stepper (7 steps), autosave per step (optimistic version check), with the step validity state shown. Review shows blocking errors (red, launch disabled) vs warnings (amber, launch allowed with acknowledgement). Launch uses a confirmation dialog that restates recipient count, mailbox and first-send time.
- **Sequence editor:** a step list (drag to reorder in DRAFT), a subject/body textarea with a variable picker and inline validation, delay as "Wait N days" (business-days option later), **Preview as recipient** (pick any enrolled/eligible prospect; shows rendered output + missing variables), **Send test** (to the operator's own address only, from the selected mailbox, `kind='test'`).
- **States:** skeleton loading for tables/cards. Purposeful empty states with the next action ("No prospects yet — Import CSV"). Toasts for success. Inline field errors. Page-level alert banners for warnings/provider errors ("Mailbox x@y needs re-authentication — Reconnect"). A permission state ("You need Operator access"). A system error page with request ID.
- **Dashboard:** KPI row (Active campaigns · Prospects in campaigns · Sent (7d) · Replies · Positive replies · Bounces · Unsubscribes · Scheduled next 24h) → "Needs attention" list (paused-by-system campaigns, mailboxes with warnings, unreviewed replies, failed imports) → Sending activity chart (sent/replies/bounces per day) → Reply outcomes (bar) → Recent campaigns table → Recent replies → Mailbox health. In demo workspaces, a persistent **"Demo data"** banner. Production numbers are never fabricated.
- **Responsive:** desktop-first. Below 768px, tables become **stacked cards** showing the 3–4 key fields with a "details" sheet. Filters move into a bottom sheet, the builder stepper becomes a top progress bar with one step per screen, and the Inbox becomes list → thread navigation. Bulk operations and the sequence editor remain usable on tablet. Mobile is aimed at triage (Inbox, pause campaign, mailbox status), not mass editing.
- **Accessibility:** Radix primitives (focus trap, ARIA for dialogs/menus/tabs), visible focus rings, labelled controls, `th scope`, an announcement region for async results, WCAG AA contrast checked on tokens, full keyboard operation, `prefers-reduced-motion` respected.
- **Performance:** RSC for initial data, streaming with Suspense per panel, no client-side bulk data (max 100 rows per page, bulk actions executed server-side by filter or IDs, e.g. "select all 4,212 matching"), keyset pagination for large tables, and indexes for every filter combination listed in §34.

---

## 23. Hosting Comparison

Evaluated for the **whole** system: persistent Next.js + **persistent worker** + Postgres/Supabase + cron + webhooks + logs.

| Platform | Free tier | Likely MVP $/mo (hosting only) | Next.js | Persistent workers | Cron | Webhooks | GitHub deploy | Supabase/PG compat | Secrets | Logging | Ease | Scalability | Major limitation | **Fit** |
|---|---|---|---|---|---|---|---|---|---|---|---|---|---|---|
| **Railway** | Trial ($5 credit); Free plan (0.5 GB RAM/service) | **$5 Hobby incl. $5 usage → ~$8–15** for web+worker (RAM $10/GB-mo, vCPU $20/vCPU-mo, usage-billed) | Good (Node server / Docker) | **Yes**: any service runs always-on | Yes (≥5 min, UTC); not needed, worker owns scheduling | Yes, always-on HTTPS | Yes: auto-deploy, **PR environments**, pre-deploy command | Supabase session pooler (IPv4) ✓; outbound IPv6 now opt-in | Per-env variables, sealed vars | Per-service logs, metrics; basic alerts | High | Replicas, vertical to 48 GB/svc on Hobby | Usage billing needs a spend cap; fewer enterprise certs | **★★★★★ Best fit** |
| **Render** | Free web (sleeps after 15 min, ~1 min cold start); free PG expires in 30 days; **no free workers/cron** | Web Starter $7 + Worker Starter $7 = **~$14+** **(secondary source)** | Good (Node) | **Yes** (Background Worker) | Yes (cron services, $1/mo min each) | Yes | Yes + preview envs | ✓ (IPv4 pooler) | Env groups | Logs, metrics | High | Autoscaling on higher tiers | Fixed-size instances cost more than usage-billing at tiny scale | ★★★★☆ Strong alternative |
| **Fly.io** | No ongoing free allowance found for new orgs **(not re-verified)** | shared-cpu-1x 512 MB ≈ $3.89; web+worker **~$8–12** | Containerized (Dockerfile) | **Yes** (Machines, process groups) | Via scheduled machines or in-worker | Yes | GitHub Actions (manual setup) | ✓ (IPv6-native, so direct works) | `fly secrets` | Logs; metrics via Grafana | Medium (more DIY) | Excellent, multi-region | More ops knowledge needed; support plans paid ($29+) | ★★★★☆ |
| **DigitalOcean App Platform** | 3 static sites only | $5 (512 MiB) web + $5 worker = **~$10–24** | Good (buildpack/Docker) | **Yes** (worker components) | Jobs component; scheduled jobs **(not re-verified)** | Yes | Yes | ✓ | App-level env/secrets | Logs, insights, alerts | High | Autoscale on dedicated tiers only | 512 MiB shared instances are tight for a Next.js build/runtime | ★★★☆☆ |
| **Vercel** | Hobby: **non-commercial only**; cron once/day (±59 min) | **Pro $20/user** (+usage) **plus a separate worker host** (~$5–10) | **First-class** | **No** (functions ≤800s Pro; Workflows/Queues are proprietary, partly beta) | Pro: per-minute, 100/project | Yes | Excellent, previews | Requires transaction-mode pooler, `prepare:false` | Good | Good (paid add-ons for retention) | High for web | Excellent for web | Engine must live elsewhere → two platforms; Hobby unusable commercially | ★★★☆☆ (only as web half of Option B) |
| **Netlify** | Free 300 credits/mo | Pro $20 (3,000 credits) + separate worker host | Supported via OpenNext adapter | **No** (background functions ≈15 min max **(not re-verified)**) | Scheduled functions (short) | Yes | Yes | Transaction pooler | Good | Basic | Medium | Good for web | Same as Vercel; credit model hard to predict | ★★☆☆☆ |
| **Lovable / Lovable Cloud** | Free (5 build credits/day, 20 Cloud credits/mo) | Pro from **$25/mo** (100 credits) + Cloud usage | **No**: generates React + **Vite SPA**; cannot host Next.js | **No**: backend = Supabase Edge Functions only | Supabase cron → Edge Functions | Via Edge Functions | 2-way GitHub sync | It *is* Supabase (managed by Lovable; export to own Supabase added Jul 2026) | Supabase secrets | Limited | Very easy to prototype | Bound to Edge-Function limits | No persistent worker, no Next.js, AI-generated code structure not under our architecture control | ★☆☆☆☆ (UI mock-ups at most) |
| **Supabase-only** (Edge Functions + Cron + Queues) | Free (pauses after 7 days idle) | $25 Pro (already budgeted) | **No** Next.js hosting | **No**: Edge Functions 2s CPU, 400s wall, Deno; ports 25/587 blocked | **pg_cron, every second** | Edge Functions | CLI deploy from CI | Native | Function secrets | Function logs | Medium | Good | Engine bound to Deno/Edge limits; SMTP adapter impossible | ★★☆☆☆ (emergency fallback for worker) |
| **Hostinger VPS** (KVM 1/2) | No | **$6.49–8.99 intro → $11.99–14.99 renewal** (secondary sources) | Self-run (Docker/PM2) | Yes (you supervise) | systemd/cron | Yes (you run TLS proxy) | DIY (Actions + SSH, or Coolify) | ✓ (direct IPv6 or pooler) | DIY | DIY | **Low**: patching, backups, monitoring, TLS, uptime are on us | Manual | Hidden ops cost; single point of failure | ★★☆☆☆ |
| **Google Cloud Run** (other) | Generous free request tier | Web scale-to-zero + worker with min-instances=1 (always-allocated CPU) **(not priced this session)** | Container | Yes, with min instances | Cloud Scheduler | Yes | Cloud Build | ✓ | Secret Manager | Excellent (Cloud Logging) | Medium-low (GCP IAM complexity) | Excellent | Complexity; natural only if we lean on Gmail Pub/Sub heavily | ★★★☆☆ (future scale option) |

**BEST OVERALL:** **Railway**. One platform, two always-on services from one repo, PR environments, pre-deploy migrations, usage billing that is cheapest at our scale, and no architectural compromise.
**BEST LOWEST-COST:** **Railway Hobby** (~$8–15) for development only. *Revision 3: production/staging require **Railway Pro** ($20/mo incl. $20 usage), because outbound SMTP is blocked below Pro (§14.7.4).* A VPS is cheaper on paper, but patching, backups, TLS, supervision and monitoring cost more in owner/engineer time than the ~$5/month difference, and it adds a single point of failure.
**BEST DEVELOPMENT / PROTOTYPE:** **local Supabase CLI (Docker) + FakeProvider**, then a Railway **staging** environment + Supabase **Free** project. Lovable is only suitable for throwaway visual mock-ups.
**BEST SCALE-UP OPTION:** **Railway Pro** (more replicas/resources, team features) first. Because both services are standard containers (`output: 'standalone'` + Dockerfile kept in repo), moving to **Render**, **Fly.io** or **Cloud Run** later is a configuration change, not a rewrite.

### 23a. Deployment models

| Model | Example | Simplicity | Reliability | Cost | Verdict |
|---|---|---|---|---|---|
| **A: single application platform** | Railway: web + worker → Supabase | ★★★★★ | ★★★★ | ★★★★★ | **Recommended** |
| B: split web + worker | Vercel Pro (web) + Railway/Render (worker) → Supabase | ★★★ (two platforms, two env sets, two log streams) | ★★★★ | ★★★ ($20 + worker) | Only if Vercel-specific web features become important |
| C: container platform | Fly.io / Cloud Run web + worker containers | ★★★ | ★★★★★ | ★★★★ | Best scale-up path; more ops for MVP |

A and C converge: Railway runs the same two containers C would. We get C's portability with A's simplicity.

---

## 24. Recommended Deployment Architecture

```
 Developer laptop                         GitHub (private repo, protected main)
  ├ Next.js dev server                       │  PR → CI (typecheck, lint, unit, integration w/ Supabase CLI,
  ├ worker (tsx watch)                       │        migration dry-run, Playwright smoke)
  ├ Supabase CLI local stack (Docker)        │  PR → Railway PR environment (web+worker) → STAGING Supabase
  └ FakeProvider / Mailpit                   │  merge → main
                                             ▼
                               Railway project "leadvault-outreach"
                 ┌──────────────── environment: production ────────────────┐
                 │ pre-deploy:  drizzle migrate (expand/contract)          │
                 │ service web     next start  (1 replica → 2 later)       │
                 │ service worker  node dist/worker.js (1 replica)         │
                 │ healthchecks, restart-on-failure, spend limit set       │
                 └───────────────┬─────────────────────────────────────────┘
                                 │ Supavisor session pooler (TLS)
                                 ▼
                     Supabase PRO project (production): Postgres, Auth, Storage, daily backups
                     Supabase FREE project (staging)
 External: Google Workspace (Gmail API, Internal OAuth app) · Resend (system email) · Sentry · uptime monitor
 Domain (later, owner action): app.leadvaultdata.com → Railway (auto TLS); unsubscribe host on outreach domain → same app
```

- **Release safety:** migrations are backward-compatible (expand → deploy → contract in a later release), so web and worker can deploy independently. The worker handles SIGTERM gracefully (stops claiming, finishes in-flight sends ≤30s, releases leases).
- **Single worker replica for MVP.** The design is multi-replica-safe, so scaling later needs no code change.
- **Kill switch:** env/DB flag `SENDING_ENABLED=false` halts all executors within one loop iteration, independent of campaign state.

## 25. Environment / Secrets Strategy

| Environment | Database | Email | Purpose |
|---|---|---|---|
| **local** | Supabase CLI (Docker) + seed script (clearly fake demo data, `is_demo=true`) | `EMAIL_TRANSPORT=fake` (FakeProvider) by default; optional test Workspace mailbox | Development |
| **staging** | Supabase Free project | Real Gmail adapter, **sandbox mode**: executor refuses any recipient not on `SEND_ALLOWLIST_DOMAINS` (e.g. LeadVault-owned test domains) | Integration/UAT, PR environments |
| **production** | Supabase Pro | Real adapters, allowlist disabled | Live |

The **allowlist guard lives in the executor's final pre-send check**, so it is enforced in code no matter what data is loaded. Real customer prospect files are never loaded into local/staging. Seed data uses reserved domains (`example.com`) and LeadVault-owned test inboxes.

`.env.example` (to be created in Phase 1; **names only**):
```
# Runtime
NODE_ENV=
APP_ENV=                         # local | staging | production
APP_BASE_URL=
UNSUBSCRIBE_BASE_URL=
# Supabase
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY=
SUPABASE_SECRET_KEY=             # server-only (admin invites); never in client bundles
DATABASE_URL=                    # session-mode pooler, app role
DATABASE_MIGRATION_URL=          # migration role
# Security
CREDENTIALS_ENCRYPTION_KEY=      # base64 32 bytes, versioned
CREDENTIALS_ENCRYPTION_KEY_VERSION=
UNSUBSCRIBE_SIGNING_SECRET=
# Google Workspace adapter
GOOGLE_OAUTH_CLIENT_ID=
GOOGLE_OAUTH_CLIENT_SECRET=
GOOGLE_PUBSUB_TOPIC=             # optional (push)
GOOGLE_PUBSUB_PUSH_AUDIENCE=     # optional (push JWT verification)
# Sending safety
SENDING_ENABLED=
EMAIL_TRANSPORT=                 # fake | live
SEND_ALLOWLIST_DOMAINS=          # non-production only
# System email
RESEND_API_KEY=
SYSTEM_EMAIL_FROM=
# Observability
SENTRY_DSN=
NEXT_PUBLIC_SENTRY_DSN=
LOG_LEVEL=
WORKER_ID=
```
Secrets live in Railway variables (production/staging separated) and the Supabase dashboard (auth SMTP). GitHub Actions secrets are used only for CI. Secret scanning is enabled on the repo, and `.env*` is git-ignored from the first commit.

## 26. Development & Testing Strategy

- **Repo layout (single package, two entrypoints):** `src/app` (Next.js), `src/worker` (worker entry + loops), `src/domain` (pure logic: state machines, eligibility, scheduling windows, rendering; no I/O), `src/db` (Drizzle schema, migrations, repositories), `src/providers` (adapters + FakeProvider + MIME/DSN parsing), `src/lib` (auth, crypto, logging). Pure domain logic makes the critical guarantees cheaply testable.
- **Unit (Vitest):** variable rendering/validation, eligibility rules, window/DST math, DSN classification (corpus of real anonymised Gmail/Outlook bounce samples), threading matcher, token signing.
- **State-machine tests (fast-check):** random event sequences (send results, replies, bounces, unsubscribes, pauses, retries, duplicates, out-of-order) must never violate the invariants: no transition out of terminal states, ≤1 SENT per recipient-step, no SENT after a stop event.
- **Integration (real Postgres via Supabase CLI):** repositories, constraints, RLS policies, the dispatcher/executor against FakeProvider, import pipeline.
- **Concurrency/idempotency tests:** run N executors and dispatchers in parallel against the same data, and inject timeouts-after-accept, crashes (lease expiry) and duplicate webhooks. Assert that provider `send` was called exactly once per recipient-step.
- **API/webhook tests:** signature verification (valid/invalid/replayed), dedupe, replay.
- **Authorization tests:** every server action and route is checked against a matrix of roles × own/foreign workspace. RLS is tested directly with JWT claims.
- **E2E (Playwright, critical paths only):** login → import CSV → audience → build + launch campaign (FakeProvider) → simulated reply stops follow-up → unsubscribe link → suppression visible.
- **Named guarantee suites (must pass in CI to merge):** `NO_SEND_AFTER_REPLY`, `NO_SEND_AFTER_UNSUBSCRIBE`, `NO_SEND_AFTER_HARD_BOUNCE`, `NO_SEND_AFTER_SUPPRESSION`, `NO_DUPLICATE_SEND_AFTER_RETRY`, `NO_CROSS_WORKSPACE_ACCESS`, plus `NO_SEND_WHILE_PAUSED` and `NO_SEND_OUTSIDE_ALLOWLIST_IN_STAGING`.
- **CI (GitHub Actions):** typecheck, lint, unit, integration (Supabase CLI in Docker), migration up-check on a fresh DB, Playwright smoke, `npm audit`.

## 27. Monitoring / Logging Strategy

| Signal | Tool | Alert |
|---|---|---|
| Application/worker logs | pino JSON → Railway log streams (per service), with `request_id`/`job_id`/`message_id` correlation fields | — |
| Errors | Sentry (web + worker), with source maps and PII scrubbing | New issue → email |
| Worker liveness | `worker_heartbeats` + `/api/health` checks heartbeat < 60s old | Uptime monitor → email/SMS if unhealthy > 3 min |
| Engine health | System status panel: dispatcher lag, PENDING backlog, RECONCILIATION_REQUIRED and **OPERATOR_REVIEW** counts, dead-letter jobs, webhook failures | In-app banner + email (Resend) to OWNER/ADMIN. Any OPERATOR_REVIEW message alerts immediately. |
| Mailbox health | Status, auth errors, bounce/blocked rate, quota errors | Mailbox NEEDS_ATTENTION → email + dashboard |
| Deployments | Railway deploy logs + GitHub checks | Failed deploy → Railway notification |
| Database | Supabase dashboard (CPU, connections, disk), Supabase advisors (RLS/security lints) | Weekly review. Disk > 70% → upgrade. |
| Audit | `audit_logs` UI (Settings → Audit log) | — |

---

## 28. Implementation Phases

Adjusted from the brief: **basic suppression moves earlier** (imports must check it), and there is a hard **"no real prospect sends" gate** until Phase 6 is complete.

| Phase | Scope | Exit criteria |
|---|---|---|
| **0. Provider spike** (≈1 week of active testing inside a warm-up period, after §30-1 approval) | Throwaway scripts, test recipients **only** (LeadVault-owned inboxes at Gmail, Outlook and one other host), on **Mission Inbox** and **Infraforge** test mailboxes. Checks: (1) is our `Message-ID` / `X-LV-Message-Id` preserved end-to-end (inspect the recipient's copy)? (2) do recipient replies' `In-Reply-To` reference our ID? (3) sub-addressing availability; (4) do DSNs arrive in the mailbox via IMAP, and in what format? (5) is a Sent copy stored server-side, and is MI's email-status lookup available for Sales mailboxes? (6) IMAP UID/IDLE behaviour; (7) SMTP reply codes for throttling; (8) warm-up duration and API. | Selects primary provider; confirms the §12.1 evidence sources for SMTP; DSN corpus captured. |
| **1. Foundation** | Repo, CI, Railway staging, Supabase projects, Drizzle + migrations, auth (invite-only, recovery), workspaces/members/roles, RLS + DAL, app shell (nav, top bar, ⌘K skeleton), audit-log writer, error/empty/loading patterns, Sentry, health, `.env.example`. | Login works; workspace isolation tests pass. |
| **2. Prospects, imports, suppression (basic), audiences** | Import wizard end-to-end with row-level outcomes; prospect table/detail; eligibility engine; suppression list (manual add/lift); audiences. | 10k-row CSV imports with accurate summary; no row unaccounted. |
| **3. Templates, campaigns, sequences** | Builder steps 1–6, variable validation, preview-as-recipient, campaign state machine (launch disabled until Phase 5). | Draft campaigns fully configurable and validated. |
| **4. Mailboxes and provider abstraction** | Encrypted SMTP/IMAP credentials, mailbox settings/limits/health, **warm-up status and ramp**, adapter interface + **`SmtpImapAdapter`** + FakeProvider (+ local Mailpit), optional Mission Inbox management client, **test send** (from Railway Pro staging). | Test email sends from a connected mailbox; reconnect flow works. |
| **5. Engine** | pg-boss worker, dispatcher, executor, leases, fencing, outcome classification, reconciliation (E1/E2) + OPERATOR_REVIEW UI, windows/timezones, daily caps, pause/resume/cancel, kill switch, allowlist sandbox. | All idempotency/concurrency suites pass; staging sends only to allowlisted test inboxes. |
| **6. Replies, inbox, bounces, unsubscribe** | Mailbox sync, threading matcher, Inbox UI + classification, stop-on-reply, DSN processing + suppression, unsubscribe headers/page/flows, suppression fan-out. | All six NO_SEND guarantees pass. **Gate: first real prospect campaign may launch only after this phase + owner sign-off.** |
| **7. Analytics and audit UI** | Dashboard KPIs, campaign/step/mailbox/date analytics, audit-log viewer, outcome reporting. | Metrics reconcile with raw message/event counts. |
| **8. Hardening and production readiness** | Security review (CSP, rate limits, role separation), load test (e.g. 50k recipients scheduled), backup/restore drill, runbook (pause all, rotate keys, reconnect mailbox), domain + TLS, optional Gmail push, MFA enforcement. | Production go-live checklist signed off. |

## 29. Current External Service Costs

All USD unless noted, checked 2026-10-01 against official pricing pages except where marked.

**Development cost: ~$0/month**
- Supabase CLI local stack: $0. Supabase Free (staging): $0 (pauses after 7 days idle; 500 MB).
- Railway trial ($5 credit) or Free plan for early staging: $0. Hobby $5 once staging runs continuously.
- Resend Free: $0 (3,000/mo, 100/day). Sentry Developer: $0 (1 user, 5k errors).
- Phase 0 spike: one Mission Inbox Lite month ($50) and/or 10 Infraforge mailbox slots (~$40) **only after owner approval**. Real SMTP tests run from local dev or from Railway Pro, since Hobby blocks SMTP.

**Minimum production cost (platform + sending): ~$95–100/month**
| Item | Cost |
|---|---|
| Supabase Pro (includes $10 compute credit = Micro instance, 8 GB disk, daily backups 7 days) | $25 |
| **Railway Pro** ($20 includes $20 usage; required for outbound SMTP) | $20 |
| **Mission Inbox Lite** (15 mailboxes, 5,000 sends/mo, dedicated IPs, warmup) | $50 |
| Resend Free / Sentry Developer / uptime-monitor free tier | $0 |

**Likely early-MVP monthly cost: ~$100–130/month**
| Item | Estimate |
|---|---|
| Supabase Pro | $25 |
| Railway Pro (web + worker usage fits within the $20 credit at MVP scale) | ~$20–25 |
| Mission Inbox Lite | $50 |
| Outreach domains (4–5 × ~$14/yr per Mailforge/Infraforge pricing; MI domain pricing not verified) | ~$5–6/mo amortised |
| Email verification service (vendor TBD, §30) | ~$0–30 depending on volume **(not priced)** |
| Optional: Sentry Team | $26/mo (annual) |
| Optional fallback pool: Infraforge 10 mailboxes | ~$40 |
| Scale-up: Mission Inbox Scale (30 mailboxes, 10,000 sends/mo) | $199 |

**Usage-variable costs**
- Railway: RAM $10/GB-month, vCPU $20/vCPU-month, egress $0.05/GB, volumes $0.15/GB-month.
- Supabase Pro: disk beyond 8 GB $0.125/GB; egress beyond 250 GB $0.09/GB; MAU beyond 100k $0.00325 (irrelevant at our scale); larger compute add-ons as data grows; PITR $100/mo per 7 days (optional).
- Resend: Pro $20/mo for 50k emails if system email exceeds the free tier (unlikely).
- Gmail API: free within quotas. Google has stated per-project daily quota billing details will come "later in 2026 with at least 90 days' notice" (80M units/day threshold is far above our needs). **Watch this.**
- Optional later: Nylas $15–49/mo (if multi-provider via unified API), Trigger.dev, PITR. Google third-party security assessment, only if External customer mailboxes with restricted scopes are ever added: Google's official pages state **no price or duration**, so none is estimated here.
- Mission Inbox overage: plan sends are capped. The Developer/Transactional line lists "$1 per 1,000" additional sends; Sales-line expansion pricing is via the calculator (not verified).
- Google Workspace seats (~€6.80/user/mo) apply only if the Google fallback is ever activated.

## 30. Owner Decisions Required

Only items that need business or owner input:

1. **Outreach infrastructure approval (Revision 3).** Approve **Mission Inbox (Sales, Lite plan)** as primary and **Infraforge** as fallback (§14.7.6), plus a paid **Phase 0 spike** on both: about one month each. This is the gate before any purchase. *The Revision 2 blocker (risk acceptance for Google/Microsoft) is withdrawn, because expressly-permitting providers exist.*
2. **Sending domains.** Approve **dedicated outreach domains** separate from `leadvaultdata.com`, registered **in LeadVault's own name** (or confirm the provider's domain-ownership/transfer terms before buying through them). Client-owned mailboxes remain **deferred**.
2a. **Email verification.** Choose how "verified addresses" are guaranteed. Either (a) LeadVault research already verifies deliverability and records it in the import file (a `verification_status` + date column), or (b) the app calls an email-verification vendor before enrollment. Vendor selection and cost are pending.
2b. **Railway Pro** ($20/mo) for staging and production, replacing Hobby (SMTP requirement, §14.7.4).
3. **Workspace mapping.** One workspace **per client** (recommended) vs a single LeadVault workspace for MVP.
4. **Suppression scope defaults.** Recommended defaults (§18): HARD_BOUNCE, COMPLIANCE → **global**; UNSUBSCRIBE → **workspace**. Alternative: every unsubscribe global (more conservative).
5. **Jurisdiction policy data.** The system supports any country (§4.3, §10) and fails closed: unknown or unconfigured country means NEEDS_REVIEW. The owner/counsel must decide which countries/regions are `allowed`, `review` or `blocked`, plus the footer/opt-out wording and the postal address for each. Rules differ materially by geography (e.g. US CAN-SPAM vs Canada CASL vs EU/UK GDPR/PECR). **Legal counsel review recommended** before the first live campaign.
6. **Budget approval.** About $100–130/mo early MVP (Railway Pro + Supabase Pro + Mission Inbox Lite + domains), plus email verification.
7. **MFA** required for OWNER/ADMIN from day one? (Recommended: yes.)
8. **Application and unsubscribe hostnames.** `app.leadvaultdata.com` for the app (recommended); unsubscribe links on an **outreach-domain** host (recommended) vs the main brand domain.
9. **Retention.** How long to keep inbound reply bodies, import files/rows, and raw webhook payloads (proposal: replies indefinitely while the workspace is active; import files 30 days; import rows 180 days; raw payloads 30 days).
10. **Sending policy defaults.** Per-mailbox daily limit after warm-up (proposal **20–30**, following vendor guidance of ~30/day), warm-up period before campaigns (provider warmup; proposal ≥ 2–3 weeks, confirmed in the spike), and cool-down before re-contacting a prospect across campaigns (proposal 30–90 days).
11. **Research-system hand-off.** Will approved prospect files always arrive as CSV in the customer-delivery layout, and does the research system provide a **stable record ID** (`research_source_ref`)? A stable ID makes re-imports and corrections far more reliable than email-based matching.

## 31. Risks

| Category | Risk | Mitigation |
|---|---|---|
| **Deliverability** | Cold outreach damages domain/mailbox reputation; Gmail/Microsoft filtering | Dedicated outreach domains, SPF/DKIM/DMARC, conservative daily limits + spacing/jitter, plain-text, no tracking pixels, one-click unsubscribe, bounce-rate auto-pause, high-quality research data. |
| **Provider policy (reduced, Revision 3)** | Primary provider (Mission Inbox) expressly permits B2B outreach but **suspends** on complaints ≥1%, unremediated hard bounces ≥4%, unsubscribes not honored within 7 days, or "sole discretion" harm. Infraforge/Mailforge terminate on "unusual" complaint levels. | App guardrails set stricter than the provider's (§14.7.5), pre-send verification, B2B-only rule, warm-up ramp enforcement, a second expressly-permitting provider (Infraforge) on the same adapter. |
| **Provider (young vendors)** | Cold-outreach infrastructure vendors are smaller and newer than Google/Microsoft; terms, pricing and product lines change (MI's docs changelog shows plan renames in 2026-09) | Standard SMTP/IMAP only in the critical path, domains in LeadVault's name, two-provider setup, quarterly terms review. |
| **Technical (Revision 3)** | Message-ID rewritten by the provider's SMTP → reply matching weaker; no Sent history for reconciliation | Phase 0 spike decides the primary; sub-addressing reply tokens; sender-fallback matching; OPERATOR_REVIEW default. |
| **Provider (OAuth)** | Customer-owned Google mailboxes need an External app + restricted-scope verification + annual security assessment; domain-wide-install exemption scope unclear | Deferred from MVP. Inbound-routing design (§14.5) as the scope-minimising path; get written Google confirmation before building. |
| **Provider (tokens)** | Workspace session-control policies invalidate refresh tokens (`invalid_rapt`) | Outreach mailboxes in an OU without reauth policy; detect → mailbox NEEDS_ATTENTION → campaigns auto-pause. |
| **Technical** | Ambiguous send outcomes | §12.1: positive-evidence-only resolution, OPERATOR_REVIEW instead of auto-retry, fencing, one in-flight send per mailbox. |
| **Provider (API)** | Gmail per-project quota billing announced for "later in 2026"; Microsoft auth changes | Abstraction layer; quota usage logged; review notices. |
| **Technical** | Duplicate or post-reply sends | §12 design + named guarantee suites. The residual seconds-long race is documented. |
| **Technical** | Reply/bounce detection gaps (unusual DSN formats, replies from other addresses) | Layered matching, DSN sample corpus, "Unmatched" inbox bucket, manual stop. |
| **Technical** | Timezone/DST errors in windows | Pure, property-tested window functions; IANA zones. |
| **Security** | Token/credential leakage | App-level encryption, server-only boundaries, redaction, least-privilege scopes, key rotation. |
| **Security** | Cross-workspace data leak | DAL + RLS + composite FKs + isolation test suite. |
| **Compliance** | Requirements vary by recipient jurisdiction (e.g. CAN-SPAM opt-out/postal address; stricter consent regimes elsewhere) | Country/region on every prospect, data-driven `jurisdiction_policies` that fail closed, built-in unsubscribe enforcement, footer/postal-address per policy, legal review (§30-5). |
| **Data** | Bad research data → high bounces | Import validation, MX check, NEEDS_REVIEW states, bounce-rate guardrails, feedback of bounces to research team (export). |
| **Data** | Research truth mutated by outreach activity | Separate tables; the engine has no write path to `prospects`. |
| **Hosting** | Railway incident or pricing change | Standard containers + Dockerfile → portable to Render/Fly/Cloud Run. Weekly `pg_dump` off-platform. |
| **Hosting** | Supabase Free used in prod pauses or loses data | Production must be Pro (backups, no pausing). |
| **Scaling** | Many workspaces/mailboxes increase sync load | Per-mailbox sync jobs with singleton keys; push notifications; worker replicas; Supabase compute upgrades. |
| **Operational** | Worker silently stops → campaigns stall | Heartbeat + uptime alerts + System status panel + restart policies. |
| **Operational** | Mailbox disconnects (password change, revoked token) | Auto-detect → NEEDS_ATTENTION → campaigns auto-pause → reconnect flow + alert. |
| **Operational** | Single-person knowledge concentration | Runbook in repo (Phase 8); conventional, documented stack. |

---

## 32. Phase 1 implementation notes (2026-10-01)

Phase 1 built the foundation described above. Where the implementation differs from or refines
this document, the change is recorded here.

| # | Change | Why | Affects later phases? |
|---|---|---|---|
| 1 | All tables live in a dedicated **`app` schema** (not `public`). | Supabase's Data API exposes `public` only, so app tables are unreachable with the publishable key without any dashboard setting (implements §7 "Data API disabled for app tables"). | No. Drizzle/migrations already target `app`. |
| 2 | **Schema additions:** `prospects.email_verification_status` / `email_verified_at` / `email_verification_source` / `email_verification_detail` (with a provenance CHECK); `prospect_imports.default_country_code`; `profiles.email` (synced from `auth.users` by trigger). | Verification model (§14.7.5); import-level country choice (§10); team views cannot read `auth.users` under RLS. | Yes, used from Phase 2. |
| 3 | `pg_trgm` search indexes on prospects are **deferred** to the Phase 2 migration. | Search ships in Phase 2. Adding indexes later is non-destructive. | Phase 2 adds them. |
| 4 | Routes are workspace-scoped: **`/w/[workspaceSlug]/…`** (§6). `/dashboard`, `/prospects`, `/campaigns`, etc. redirect to the last-used workspace (cookie set by the proxy, re-verified on use). | Meets the brief's route list without losing workspace-in-URL safety. | No. |
| 5 | Sidebar group is labelled **Infrastructure** (Phase 1 brief) rather than "Deliverability" (§22). Imports sits under Prospecting. | Latest owner instruction. | No. |
| 6 | Runtime **Node 22.12+** (local machine has Node 22); §2 said Node 24 LTS. | Available toolchain; Next.js 16 supports both. | Railway image pins `node:22-alpine`; can move to 24 later. |
| 7 | Minimal redacting JSON logger (`src/server/logger.ts`) instead of **pino**; **Sentry not configured**. | No new dependency or account in Phase 1. Same log shape. | pino arrives with the worker (Phase 5). Sentry needs an account (free tier) before staging. |
| 8 | React Hook Form, nuqs and TanStack Table are **not installed yet**. | Phase 1 forms are small server-action forms (Zod-validated server-side). No data tables yet. | Added in Phase 2 when tables/filters ship. |
| 9 | Supabase auth emails use **token-hash links** (`/auth/confirm`), and the local stack catches them in Mailpit. Custom SMTP (Resend) is **not configured**. | Works across browsers/devices. $0 local development. | Production requires custom SMTP before invitations are used. |
| 10 | Local Supabase: `[auth] enable_signup = false` (public sign-up blocked); `[auth.email] enable_signup` must stay **true**. In this CLI version, setting it to false disables email login entirely. | Verified empirically (sign-in OK, public sign-up returns `signup_disabled`). | Hosted project: disable sign-ups in Auth settings. |
| 11 | Database tests run on **PGlite** (real PostgreSQL in WebAssembly) with a small shim for Supabase's `auth.users`, `anon` and `authenticated`. E2E runs on the Supabase CLI stack. | Fast, $0, no Docker for unit/DB tests. The suite was mutation-checked: disabling RLS on one table makes isolation tests fail. | No. |
| 12 | Every route is rendered dynamically (`force-dynamic` in the root layout). | Required for the per-request CSP nonce (§21). | No. Pages are per-user anyway. |
| 13 | Workspace-access denials are audited as **workspace-less** events attributed to the user (privileged insert). | A non-member has no workspace context to write into. Avoids revealing workspace existence. | No. |
| 14 | MFA not enforced. Workspace-creation and team-invitation UIs are not built (read-only Team/Workspace pages). | Phase 1 scope; MFA is owner decision §30-7. | Later phases. |

**Phase 0 provider test:** **DEFERRED — PAYMENT REQUIRED.** Mission Inbox and Infraforge have no
free tier, and no purchase is authorized in Phase 1. Running SMTP from Railway also needs Pro.

## 33. Phase 2 implementation notes (2026-10-01)

Phase 2 built imports, the prospect repository, eligibility, suppression, unsubscribe records and
audiences. Departures from and refinements to this document:

| # | Change | Why | Affects later phases? |
|---|---|---|---|
| 1 | **One eligibility engine**: `src/domain/eligibility.ts` (pure). It returns a status plus *every* applicable reason code in a stable order. The Phase 1 helper `verificationEligibility()` was removed. Decisions are cached in `prospect_outreach_state` (`eligibility`, `eligibility_reasons`, `eligibility_expires_at`) and recomputed on import, suppression add/lift, and expiry (lazy refresh before lists, audiences and the dashboard). | A single source of truth; the cache makes filtering and counting indexable. | Campaign launch (Phase 5) must re-run the engine per recipient at send time, not trust the cache. |
| 2 | Status names stay `ELIGIBLE / NEEDS_REVIEW / INELIGIBLE / SUPPRESSED`. `NEEDS_REVIEW` is shown as **"Review required"**. | No schema churn. | No. |
| 3 | **Jurisdictions:** no country is approved by default. Unconfigured places resolve to REVIEW (`JURISDICTION_REVIEW`), unknown countries to REVIEW (`COUNTRY_UNKNOWN`). The demo seed adds one **workspace-level, demo-only** `US-TX = allowed` policy (with a note saying it is not a legal approval), so the eligible path can be shown on fictional data. | Brief: never assume legality. | Real policies are an owner/legal decision (§30). |
| 4 | **Email-domain class** BUSINESS / CONSUMER / UNKNOWN (`src/domain/email-domain.ts`). BUSINESS only when the email domain equals the website domain or is a subdomain of it. CONSUMER from a built-in list of webmail providers. Everything else is UNKNOWN → review. B2B-only, so CONSUMER → ineligible. | Conservative and free; no paid lookup. | A provider-based check could refine UNKNOWN later. |
| 5 | **Uploaded CSVs are not put in Supabase Storage.** The verbatim cells of every row are stored in `prospect_import_rows.raw` (RLS-protected; `storage_path` is now nullable). Limits: 5 MB, 10,000 rows, 100 columns, 2,000 characters per cell; strict UTF-8; CSV only (no XLSX). | Private by construction, nothing public, no bucket policies to get wrong, and it is what "every row explainable" needs. | Larger files would need Storage plus background parsing (worker, Phase 5). |
| 6 | Import lifecycle: `uploaded → mapped → ready → importing → completed / completed_with_issues / failed / cancelled`. The commit claims `ready → importing` atomically (runs once), writes in batches of 500 per transaction, and always ends in a terminal state. Every row records a **data action** (create, update, unchanged, duplicate in file, duplicate existing, invalid, skipped, error) **plus** its eligibility. | Deterministic, never ambiguous after failure. | Background execution moves to pg-boss in Phase 5. |
| 7 | Re-imports: rows match existing prospects by normalized email, then research reference, then company + contact + domain. Blank cells never erase data. Verification is replaced only by a recognized, dated, newer result. Cosmetic differences (case, `www.`) are not updates. Matching never crosses workspaces. | Idempotent re-import. | No. |
| 8 | Prospect create/update audit events are **aggregated** into `import.completed` (counts). Row-level provenance lives in `prospect_import_rows`. | Avoids thousands of noisy audit entries per import. | No. |
| 9 | **Global suppressions** can be added or lifted only by platform administrators, through the privileged server path (the database still refuses user writes). Workspace suppressions: OPERATOR+ add, ADMIN+ lift. A reason is always required, and records are never deleted. | §18 plus the brief. | No. |
| 10 | **Unsubscribes**: there is no public endpoint yet. Unsubscribe records (with their suppression) make prospects SUPPRESSED (`UNSUBSCRIBED`). The demo seed contains one. | Brief. | Phase 6 adds the signed public link. |
| 11 | **RLS performance (migration 0004):** tenant policies now use `workspace_id IN (SELECT app.my_workspace_ids(role))` instead of a per-row `app.has_workspace_role(workspace_id, role)` call. Same rules, but evaluated once per statement. Measured at 12,000 prospects: 1.3–3.2 s → 25–100 ms per list query (`docs/PERFORMANCE.md`). | The per-row SECURITY DEFINER call cost ~0.1 ms per row. | New tenant tables must use the set-based form. |
| 12 | Search uses a generated, stored `prospects.search_text` (lower-case company, contact, title, email, domain, city, state, type) with a `pg_trgm` GIN index. Every word must match (`LIKE`, escaped). Filters, sort and pagination are server-side and URL-driven (GET forms and links). **nuqs and TanStack Table were not added.** | Bookmarkable views that work without JavaScript; fewer dependencies. | Revisit if client-side table features are needed. |
| 13 | Exported CSVs neutralize formula injection (a leading `= + - @`, tab or CR gets an apostrophe) and are served as `no-store` attachments. | CSV security. | No. |
| 14 | Synthetic scale data lives in a separate local `scale-demo` workspace (`npm run db:seed:synthetic`) and is measured with `npm run perf:prospects`. | Brief: ≥10,000 prospects. | No. |

**Login anomaly (Phase 1, monitored):** it recurred once during a Phase 2 E2E run (the
isolated-user sign-in landed on the global error page). The trace shows the sign-in Server Action
request failing at the browser network layer with `net::ERR_NETWORK_IO_SUSPENDED` (no response
reached the server), which then surfaced as `TypeError: Failed to fetch`. The same period showed
host-level stalls (a 12k insert took 430 s and then 15 s when repeated). Classified as an
environment event, not an application defect. Possible hardening (not done, to avoid a
speculative change to authentication): catch network failures in the sign-in form and show an
inline "couldn't reach the server, try again" message instead of the global error page.

## 34. MVP completion notes (2026-10-01)

The original MVP workflow is implemented end to end with a **fake email transport**: import →
prospects → audience → campaign → linear sequence → preview → schedule → worker execution →
reply / bounce / unsubscribe → stop rules → basic results. Real delivery needs a purchased
provider (separate, controlled step). Refinements and departures:

| # | Decision | Why |
|---|---|---|
| 1 | Campaign states stay as in §9 (`DRAFT, SCHEDULED, ACTIVE, PAUSED, COMPLETED, CANCELLED`), shown as Draft / Scheduled / **Running** / Paused / Completed / **Stopped**. "Ready" is not stored: the preview computes readiness (blockers) every time. | No schema churn; readiness depends on live data anyway. |
| 2 | Enrolled recipients start as `SCHEDULED` (next step 1, `next_send_at` = start). `QUEUED` is unused. The dispatcher only takes recipients of `ACTIVE` campaigns, so a scheduled campaign's recipients simply wait. | One fewer transition to guard. |
| 3 | The worker (`src/worker/main.ts`, `npm run worker`) runs the §13.2 loops (lifecycle, dispatcher, executor, reconciliation, heartbeat) as plain PostgreSQL polling with `FOR UPDATE SKIP LOCKED`, leases and fenced writes. **pg-boss is not added**: without a real provider there are no mailbox-sync or webhook jobs for it to schedule. | Minimum reliable infrastructure; Postgres-backed as approved. |
| 4 | Locking queries are written in SQL with table aliases (`for update of r skip locked`). | Drizzle emits schema-qualified names in `FOR UPDATE OF`, which PostgreSQL rejects. |
| 5 | `messages` stays engine-written (read-only for users, §7). Stops started by a user (stop campaign, add suppression) halt recipients inside the user's RLS transaction; a worker sweep then cancels any not-yet-sent message whose recipient is no longer `SENDING`, and the executor re-checks the recipient before claiming. | Keeps least-privilege grants intact. |
| 6 | Eligibility is re-evaluated with the authoritative engine at launch, at dispatch and immediately before each send. Only `ELIGIBLE` prospects are ever sent to; review-required prospects are excluded (no operator override in the MVP). | §10, brief §10. |
| 7 | Personalization uses existing normalized fields only (`first_name, last_name, contact_name, contact_title, company_name, provider_type, city, state, country, website, sender_name`) with `{{field|fallback}}`. Unknown tokens fail on save; a missing value without fallback excludes the prospect at launch (`MISSING_REQUIRED_VARIABLE`) and stops it at dispatch if data changed. Custom fields are not tokens in the MVP. | Never "Hi undefined". |
| 8 | Every email gets an opt-out line with a signed link (`/u/{token}`), the List-Unsubscribe headers (RFC 8058 one-click to `/api/unsubscribe/{token}`), the policy footer and the workspace postal address. **Launch requires the postal address and the signing secret.** | §19; policies default to requiring a postal address. |
| 9 | The sending window is the **campaign's** (days + hours in the campaign time zone; "any time" allowed for testing). The mailbox's own window columns are not enforced; mailbox daily limits and spacing are. | One clear window per campaign. |
| 10 | Inbound processing (`ingestInbound`) is complete (classification, header matching, sender fallback, threads, stop rules, hard-bounce → global suppression, opt-out replies → unsubscribe). No mailbox sync loop runs yet, because no real mailbox exists; with the fake transport, the campaign page's **Test** menu builds realistic inbound messages and feeds them through the same pipeline. | Brief §17–§18 allow fake/test events. |
| 11 | Ambiguous sends → `RECONCILIATION_REQUIRED` → positive evidence only (fake provider history) → otherwise `OPERATOR_REVIEW`. Admins can resolve with "It was sent" or "Stop this recipient". **There is no "retry" button.** | §12.1: never blindly retry. |
| 12 | Safety interlocks: `SENDING_ENABLED=false` kill switch; the worker refuses the fake transport when `APP_ENV=production`; **demo workspaces can never use a live transport** (their Texas policy is demo-only and labelled as such on Settings → Compliance). | Brief §14, §24. |
| 13 | Results show recipients, sent, replied, positive (Inbox "Interested"), bounced, unsubscribed, suppressed/stopped, remaining and excluded. Reply rate = replies ÷ prospects emailed. No "delivered" or open metrics. | Brief §22. |
| 14 | The demo seed no longer fabricates campaign history; it provides audiences, three templates, fictional mailboxes (5 s spacing for a quick demo) and fictional postal addresses. Campaign data comes from running the real pipeline. | Dashboard shows real application data. |
| 15 | Not implemented (outside the frozen MVP or needing a provider): live provider adapter, mailbox sync, webhooks, recipient-local send times, holiday calendars, per-IP rate limiting of the unsubscribe endpoint, replying from the app. | Scope freeze. |

**Login failures — root cause found (2026-10-02).** The intermittent first-sign-in failure seen
since Phase 1 was traced in the Supabase Auth container log to its own database connection:
`couldn't start a new transaction … failed to connect to host=supabase_db… dial tcp …:5432: i/o
timeout` (10.5 s), on the first sign-in after idle time on the local Docker stack, while the next
sign-ins succeeded. Two app-side consequences were fixed without changing the authentication
design: (1) a server-side auth failure (HTTP 5xx or no status) was reported as "The email or
password is incorrect" — it now says "Couldn't reach the server. Check your connection and try
again." and is logged as `auth.sign_in_unavailable`; (2) a request that never reaches the server
(the Phase 2 `ERR_NETWORK_IO_SUSPENDED` case) now shows the same inline message instead of the
global error page. Wrong passwords (HTTP 400) still show the generic credentials message. The E2E
sign-in setup retries once when it sees the unavailable message. The underlying Docker
connection timeout is a local-environment condition (small Docker VM under load); hosted
Supabase is not affected by it.

## Sources (consulted 2026-10-01)

- Railway plans & resource pricing — https://docs.railway.com/reference/pricing/plans
- Railway cron jobs — https://docs.railway.com/reference/cron-jobs
- Railway serverless / outbound IPv6 notes — https://docs.railway.com/deployments/serverless · https://station.railway.com/questions/subject-application-cannot-connect-to-e-efcf376c
- Vercel pricing — https://vercel.com/pricing
- Vercel function limits — https://vercel.com/docs/functions/limitations
- Vercel cron limits — https://vercel.com/docs/cron-jobs/usage-and-pricing
- Netlify pricing — https://www.netlify.com/pricing/
- Render free tier — https://render.com/docs/free · Render paid instance prices (secondary): https://www.saaspricepulse.com/tools/render
- Fly.io pricing — https://fly.io/pricing/
- DigitalOcean App Platform pricing — https://www.digitalocean.com/pricing/app-platform
- Lovable plans & credits — https://lovable.dev/pricing · https://docs.lovable.dev/introduction/subscription-plans · https://docs.lovable.dev/introduction/plans-and-credits · https://docs.lovable.dev/features/cloud
- Hostinger VPS pricing (secondary) — https://hostadvice.com/hosting-company/hostinger-reviews/vps-pricing/
- Supabase pricing — https://supabase.com/pricing
- Supabase connecting to Postgres — https://supabase.com/docs/guides/database/connecting-to-postgres
- Supabase Edge Function limits — https://supabase.com/docs/guides/functions/limits
- Supabase Cron — https://supabase.com/docs/guides/cron · Supabase Queues — https://supabase.com/docs/guides/queues
- Supabase Auth SMTP — https://supabase.com/docs/guides/auth/auth-smtp
- Drizzle RLS — https://orm.drizzle.team/docs/rls
- pg-boss — https://github.com/timgit/pg-boss
- Trigger.dev pricing — https://trigger.dev/pricing
- Resend acceptable use — https://resend.com/legal/acceptable-use · Resend pricing — https://resend.com/pricing
- Amazon SES pricing — https://aws.amazon.com/ses/pricing/ · SES enforcement FAQ — https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html
- Gmail API quotas — https://developers.google.com/workspace/gmail/api/reference/quota
- Gmail push notifications — https://developers.google.com/workspace/gmail/api/guides/push
- Google OAuth consent (Internal apps) — https://developers.google.com/workspace/guides/configure-oauth-consent
- Restricted scope verification — https://developers.google.com/identity/protocols/oauth2/production-readiness/restricted-scope-verification
- Gmail sending limits in Google Workspace (official) — https://knowledge.workspace.google.com/admin/gmail/gmail-sending-limits-in-google-workspace
- **Revision 2 (email verification) sources:**
  - Resend Acceptable Use Policy (updated 2026-08-27) — https://resend.com/legal/acceptable-use
  - AWS Acceptable Use Policy — https://aws.amazon.com/aup/ · SES sending review FAQs — https://docs.aws.amazon.com/ses/latest/dg/faqs-enforcement.html
  - SendGrid opt-in requirements — https://support.sendgrid.com/hc/en-us/articles/4404315959835-Email-Opt-in-and-Opt-out-Requirements · prohibited uses — https://support.sendgrid.com/hc/en-us/articles/4404316003483-Email-Prohibited-Content-Types-and-Uses
  - Postmark Terms of Service §5(c) — https://postmarkapp.com/terms-of-service/
  - Google Workspace AUP — https://workspace.google.com/terms/use_policy.html · Workspace agreement (AUP definition) — https://workspace.google.com/terms/2013/1/premier_terms.html · Gmail Program Policies — https://support.google.com/mail/answer/16734397
  - Microsoft Product Terms (Online Services AUP) — https://www.microsoft.com/licensing/terms/product/ForOnlineServices/all · Microsoft Online Services AUP — https://www.microsoft.com/en-us/microsoft-365/legal/docid12 · Exchange Online limits — https://learn.microsoft.com/en-us/office365/servicedescriptions/exchange-online-service-description/exchange-online-limits
  - Gmail API scopes & classifications — https://developers.google.com/workspace/gmail/api/auth/scopes
  - Gmail API method references (send, list, get, history.list, getProfile, drafts.send) — https://developers.google.com/workspace/gmail/api/reference/rest
  - Gmail sending guide (threading) — https://developers.google.com/workspace/gmail/api/guides/sending
  - Gmail IMAP/SMTP XOAUTH2 scope — https://developers.google.com/workspace/gmail/imap/xoauth2-protocol
  - OAuth app states (internal vs external) — https://developers.google.com/identity/protocols/oauth2/production-readiness/overview
  - OAuth 2.0 (Testing-status 7-day refresh tokens; session control) — https://developers.google.com/identity/protocols/oauth2
  - Workspace less-secure-apps end (2025-05-01) — https://knowledge.workspace.google.com/admin/apps/control-access-to-less-secure-apps
  - Gmail routing settings — https://knowledge.workspace.google.com/admin/gmail/advanced/add-gmail-routing-settings
- **Revision 3 (sending-infrastructure market) sources — official provider pages:**
  - Mission Inbox Terms of Service & AUP (updated 2026-01-01) — https://www.missioninbox.com/terms-of-service-and-acceptable-use-policy · pricing — https://missioninbox.com/pricing · API/SMTP — https://www.missioninbox.com/api-smtp-integrations · API docs — https://docs.missioninbox.com/
  - Infraforge Terms (updated 2025-12-29) — https://www.infraforge.ai/terms · pricing — https://www.infraforge.ai/pricing
  - Mailforge Terms (updated 2025-12-29) — https://www.mailforge.ai/terms · pricing — https://www.mailforge.ai/pricing · SMTP/IMAP export (Salesforge help) — https://help.salesforge.ai/en/articles/9829200-how-to-connect-mailboxes-to-providers-that-don-t-support-bulk-import
  - Mailgun AUP — https://www.mailgun.com/legal/aup/
  - SMTP2GO Terms — https://www.smtp2go.com/terms/
  - Mailjet sending policy — https://www.mailjet.com/legal/sending-policy/
  - Brevo anti-spam policy — https://www.brevo.com/legal/antispampolicy/
  - SparkPost Messaging Policy — https://bird.com/legal/sparkpost-messaging-policy
  - MailerSend Anti-Spam Policy — https://www.mailersend.com/legal/anti-spam-policy
  - Instantly Terms (updated 2026-09-22) — https://instantly.ai/terms · API — https://developer.instantly.ai/api-reference/email/reply-to-an-email
  - Smartlead API (webhooks, reply-email-thread) — https://api.smartlead.ai/api-reference/webhooks/events · https://helpcenter.smartlead.ai/en/articles/125-full-api-documentation
  - Railway outbound networking (SMTP only on Pro and above) — https://docs.railway.com/networking/outbound-networking
  - Candidate discovery only (not used as evidence): Primeforge/Zapmail/Maildoso review and listing pages.
- Google Workspace pricing — https://workspace.google.com/pricing
- Exchange Online SMTP AUTH retirement — https://techcommunity.microsoft.com/blog/exchange/exchange-online-to-retire-basic-auth-for-client-submission-smtp-auth/4114750 · https://office365itpros.com/2026/01/29/smtp-auth-basic-retirement/
- Outlook high-volume sender requirements — https://techcommunity.microsoft.com/blog/microsoftdefenderforoffice365blog/strengthening-email-ecosystem-outlook%E2%80%99s-new-requirements-for-high%E2%80%90volume-senders/4399730
- Nylas pricing — https://www.nylas.com/pricing/ · EmailEngine — https://learn.emailengine.app/
- Sentry pricing — https://sentry.io/pricing/
