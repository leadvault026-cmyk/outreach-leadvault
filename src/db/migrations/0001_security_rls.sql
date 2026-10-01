-- LeadVault Outreach — security foundation (architecture §7, §21, §30).
-- Hand-written, reviewed SQL: helper functions, grants, Row Level Security, integrity triggers.
--
-- Model:
--   * App tables live in schema `app`, which Supabase's Data API does not expose.
--   * User-initiated queries run as role `authenticated` with the caller's JWT claims set for the
--     transaction (src/db/client.ts withUserContext). RLS below is the second, database-level
--     layer behind the application authorization layer (src/server/authz).
--   * The worker/seed connect with the privileged table-owner role, which bypasses RLS and must
--     scope by workspace explicitly.
--   * Grants are least-privilege: tables written only by the engine are read-only for users.

--> statement-breakpoint
-- ───────────────────────────── Helper functions ─────────────────────────────
CREATE OR REPLACE FUNCTION app.current_user_id() RETURNS uuid
LANGUAGE sql STABLE
SET search_path = ''
AS $$
  SELECT nullif(
    coalesce(
      nullif(current_setting('request.jwt.claim.sub', true), ''),
      (nullif(current_setting('request.jwt.claims', true), '')::jsonb ->> 'sub')
    ),
    ''
  )::uuid
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.role_rank(role_name text) RETURNS integer
LANGUAGE sql IMMUTABLE
SET search_path = ''
AS $$
  SELECT CASE role_name
    WHEN 'OWNER' THEN 4
    WHEN 'ADMIN' THEN 3
    WHEN 'OPERATOR' THEN 2
    WHEN 'VIEWER' THEN 1
    ELSE 0
  END
$$;

--> statement-breakpoint
-- SECURITY DEFINER so membership checks do not recurse through workspace_members' own RLS.
CREATE OR REPLACE FUNCTION app.has_workspace_role(ws uuid, min_role text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT ws IS NOT NULL AND EXISTS (
    SELECT 1
    FROM app.workspace_members m
    JOIN app.workspaces w ON w.id = m.workspace_id
    WHERE m.workspace_id = ws
      AND m.user_id = app.current_user_id()
      AND m.status = 'active'
      AND w.archived_at IS NULL
      AND app.role_rank(m.role) >= app.role_rank(min_role)
  )
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.has_any_membership() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM app.workspace_members m
    WHERE m.user_id = app.current_user_id() AND m.status = 'active'
  )
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.shares_workspace_with(other_user uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM app.workspace_members mine
    JOIN app.workspace_members theirs ON theirs.workspace_id = mine.workspace_id
    WHERE mine.user_id = app.current_user_id()
      AND mine.status = 'active'
      AND theirs.user_id = other_user
  )
$$;

--> statement-breakpoint
CREATE OR REPLACE FUNCTION app.is_platform_admin() RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT coalesce(
    (SELECT p.is_platform_admin FROM app.profiles p WHERE p.user_id = app.current_user_id()),
    false
  )
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_workspace_role(uuid, text) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.has_any_membership() FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.shares_workspace_with(uuid) FROM PUBLIC;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.is_platform_admin() FROM PUBLIC;
--> statement-breakpoint
GRANT USAGE ON SCHEMA app TO authenticated;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.current_user_id(), app.role_rank(text),
  app.has_workspace_role(uuid, text), app.has_any_membership(),
  app.shares_workspace_with(uuid), app.is_platform_admin() TO authenticated;

--> statement-breakpoint
-- ───────────────────────────── Integrity triggers ─────────────────────────────
CREATE OR REPLACE FUNCTION app.set_updated_at() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END
$$;

--> statement-breakpoint
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'workspaces', 'profiles', 'workspace_members', 'prospects', 'prospect_outreach_state',
    'workspace_custom_fields', 'prospect_imports', 'audiences', 'templates',
    'provider_connections', 'mailboxes', 'sending_identities', 'campaigns', 'sequence_steps',
    'campaign_recipients', 'messages', 'reply_threads', 'jurisdiction_policies'
  ] LOOP
    EXECUTE format(
      'CREATE TRIGGER set_updated_at BEFORE UPDATE ON app.%I FOR EACH ROW EXECUTE FUNCTION app.set_updated_at()',
      t
    );
  END LOOP;
END
$$;

--> statement-breakpoint
-- Audit logs are append-only for every role, including the table owner.
CREATE OR REPLACE FUNCTION app.reject_audit_mutation() RETURNS trigger
LANGUAGE plpgsql
SET search_path = ''
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs is append-only' USING ERRCODE = 'insufficient_privilege';
END
$$;

--> statement-breakpoint
CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON app.audit_logs
  FOR EACH ROW EXECUTE FUNCTION app.reject_audit_mutation();

--> statement-breakpoint
-- Every Supabase Auth user gets an app profile (invited users included).
CREATE OR REPLACE FUNCTION app.handle_new_auth_user() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO app.profiles (user_id, full_name)
  VALUES (NEW.id, nullif(NEW.raw_user_meta_data ->> 'full_name', ''))
  ON CONFLICT (user_id) DO NOTHING;
  RETURN NEW;
END
$$;

--> statement-breakpoint
REVOKE ALL ON FUNCTION app.handle_new_auth_user() FROM PUBLIC;

--> statement-breakpoint
CREATE TRIGGER on_auth_user_created_app_profile
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION app.handle_new_auth_user();

--> statement-breakpoint
-- ───────────────────────────── Grants (least privilege) ─────────────────────────────
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM PUBLIC;
--> statement-breakpoint
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    EXECUTE 'REVOKE ALL ON ALL TABLES IN SCHEMA app FROM anon';
    EXECUTE 'REVOKE ALL ON SCHEMA app FROM anon';
  END IF;
END
$$;
--> statement-breakpoint
REVOKE ALL ON ALL TABLES IN SCHEMA app FROM authenticated;

--> statement-breakpoint
GRANT SELECT, UPDATE ON app.workspaces TO authenticated;
--> statement-breakpoint
GRANT INSERT ON app.workspaces TO authenticated;
--> statement-breakpoint
GRANT SELECT ON app.profiles TO authenticated;
--> statement-breakpoint
GRANT UPDATE (full_name) ON app.profiles TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON app.workspace_members TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON
  app.prospects, app.prospect_outreach_state, app.prospect_imports, app.prospect_import_rows,
  app.audiences, app.templates, app.mailboxes, app.sending_identities, app.campaigns,
  app.campaign_recipients, app.reply_threads, app.jurisdiction_policies
  TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE, DELETE ON
  app.audience_members, app.sequence_steps, app.workspace_custom_fields
  TO authenticated;
--> statement-breakpoint
GRANT DELETE ON app.campaigns, app.jurisdiction_policies TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT ON app.campaign_outcomes, app.audit_logs TO authenticated;
--> statement-breakpoint
GRANT SELECT, INSERT, UPDATE ON app.suppressions TO authenticated;
--> statement-breakpoint
-- Engine-written tables: read-only for users.
GRANT SELECT ON app.messages, app.message_events, app.replies, app.unsubscribes TO authenticated;
--> statement-breakpoint
-- provider_connections: every column EXCEPT encrypted_credentials.
GRANT SELECT (
  id, workspace_id, provider, account_email, external_account_id, status,
  credentials_key_version, scopes, ingestion_mode, inbound_routing_address,
  access_token_expires_at, sync_cursor, push_watch_expires_at, last_verified_at,
  last_error_code, last_error_at, metadata, created_by, created_at, updated_at
) ON app.provider_connections TO authenticated;
-- Service-only (no grants): webhook_events, worker_heartbeats, send_attempts, mailbox_daily_usage.

--> statement-breakpoint
-- ───────────────────────────── Row Level Security ─────────────────────────────
DO $$
DECLARE t text;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'app' LOOP
    EXECUTE format('ALTER TABLE app.%I ENABLE ROW LEVEL SECURITY', t);
  END LOOP;
END
$$;

--> statement-breakpoint
-- Standard tenant tables: members read; OPERATOR+ writes (where granted).
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prospects', 'prospect_outreach_state', 'prospect_imports', 'prospect_import_rows',
    'audiences', 'audience_members', 'templates', 'campaigns', 'sequence_steps',
    'campaign_recipients', 'campaign_outcomes', 'messages', 'message_events', 'reply_threads',
    'replies', 'unsubscribes'
  ] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON app.%I FOR SELECT TO authenticated USING (app.has_workspace_role(workspace_id, ''VIEWER''))', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON app.%I FOR INSERT TO authenticated WITH CHECK (app.has_workspace_role(workspace_id, ''OPERATOR''))', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON app.%I FOR UPDATE TO authenticated USING (app.has_workspace_role(workspace_id, ''OPERATOR'')) WITH CHECK (app.has_workspace_role(workspace_id, ''OPERATOR''))', t);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON app.%I FOR DELETE TO authenticated USING (app.has_workspace_role(workspace_id, ''OPERATOR''))', t);
  END LOOP;
END
$$;

--> statement-breakpoint
-- Only DRAFT campaigns may be deleted (architecture §9).
DROP POLICY tenant_delete ON app.campaigns;
--> statement-breakpoint
CREATE POLICY tenant_delete ON app.campaigns FOR DELETE TO authenticated
  USING (status = 'DRAFT' AND app.has_workspace_role(workspace_id, 'OPERATOR'));

--> statement-breakpoint
-- Infrastructure configuration: members read; ADMIN+ writes.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mailboxes', 'sending_identities', 'workspace_custom_fields', 'provider_connections'] LOOP
    EXECUTE format(
      'CREATE POLICY tenant_select ON app.%I FOR SELECT TO authenticated USING (app.has_workspace_role(workspace_id, ''VIEWER''))', t);
    EXECUTE format(
      'CREATE POLICY admin_insert ON app.%I FOR INSERT TO authenticated WITH CHECK (app.has_workspace_role(workspace_id, ''ADMIN''))', t);
    EXECUTE format(
      'CREATE POLICY admin_update ON app.%I FOR UPDATE TO authenticated USING (app.has_workspace_role(workspace_id, ''ADMIN'')) WITH CHECK (app.has_workspace_role(workspace_id, ''ADMIN''))', t);
    EXECUTE format(
      'CREATE POLICY admin_delete ON app.%I FOR DELETE TO authenticated USING (app.has_workspace_role(workspace_id, ''ADMIN''))', t);
  END LOOP;
END
$$;

--> statement-breakpoint
-- Workspaces
CREATE POLICY workspace_select ON app.workspaces FOR SELECT TO authenticated
  USING (app.has_workspace_role(id, 'VIEWER'));
--> statement-breakpoint
CREATE POLICY workspace_update ON app.workspaces FOR UPDATE TO authenticated
  USING (app.has_workspace_role(id, 'OWNER')) WITH CHECK (app.has_workspace_role(id, 'OWNER'));
--> statement-breakpoint
CREATE POLICY workspace_insert ON app.workspaces FOR INSERT TO authenticated
  WITH CHECK (app.is_platform_admin());

--> statement-breakpoint
-- Profiles: self, or people who share a workspace with you. Only full_name is updatable (grant).
CREATE POLICY profile_select ON app.profiles FOR SELECT TO authenticated
  USING (user_id = app.current_user_id() OR app.shares_workspace_with(user_id));
--> statement-breakpoint
CREATE POLICY profile_update ON app.profiles FOR UPDATE TO authenticated
  USING (user_id = app.current_user_id()) WITH CHECK (user_id = app.current_user_id());

--> statement-breakpoint
-- Workspace members: members see the team; ADMIN+ manage, but only OWNER may touch OWNER rows.
CREATE POLICY member_select ON app.workspace_members FOR SELECT TO authenticated
  USING (user_id = app.current_user_id() OR app.has_workspace_role(workspace_id, 'VIEWER'));
--> statement-breakpoint
CREATE POLICY member_insert ON app.workspace_members FOR INSERT TO authenticated
  WITH CHECK (
    app.has_workspace_role(workspace_id, 'OWNER')
    OR (app.has_workspace_role(workspace_id, 'ADMIN') AND role <> 'OWNER')
  );
--> statement-breakpoint
CREATE POLICY member_update ON app.workspace_members FOR UPDATE TO authenticated
  USING (
    app.has_workspace_role(workspace_id, 'OWNER')
    OR (app.has_workspace_role(workspace_id, 'ADMIN') AND role <> 'OWNER')
  )
  WITH CHECK (
    app.has_workspace_role(workspace_id, 'OWNER')
    OR (app.has_workspace_role(workspace_id, 'ADMIN') AND role <> 'OWNER')
  );
--> statement-breakpoint
CREATE POLICY member_delete ON app.workspace_members FOR DELETE TO authenticated
  USING (
    app.has_workspace_role(workspace_id, 'OWNER')
    OR (app.has_workspace_role(workspace_id, 'ADMIN') AND role <> 'OWNER')
  );

--> statement-breakpoint
-- Audit logs: ADMIN+ read their workspace; users read their own workspace-less entries;
-- inserts must be attributed to the caller. No UPDATE/DELETE (grant + trigger).
CREATE POLICY audit_select ON app.audit_logs FOR SELECT TO authenticated
  USING (
    app.has_workspace_role(workspace_id, 'ADMIN')
    OR (workspace_id IS NULL AND actor_user_id = app.current_user_id())
  );
--> statement-breakpoint
CREATE POLICY audit_insert ON app.audit_logs FOR INSERT TO authenticated
  WITH CHECK (
    actor_type = 'user'
    AND actor_user_id = app.current_user_id()
    AND (workspace_id IS NULL OR app.has_workspace_role(workspace_id, 'VIEWER'))
  );

--> statement-breakpoint
-- Suppressions: workspace rows by role; global rows readable by any active member,
-- written only by privileged server code (architecture §18).
CREATE POLICY suppression_select ON app.suppressions FOR SELECT TO authenticated
  USING (
    (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'VIEWER'))
    OR (scope = 'global' AND app.has_any_membership())
  );
--> statement-breakpoint
CREATE POLICY suppression_insert ON app.suppressions FOR INSERT TO authenticated
  WITH CHECK (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'OPERATOR'));
--> statement-breakpoint
CREATE POLICY suppression_lift ON app.suppressions FOR UPDATE TO authenticated
  USING (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'))
  WITH CHECK (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'));

--> statement-breakpoint
-- Jurisdiction policies: global rows readable by members; workspace overrides by ADMIN+.
CREATE POLICY jurisdiction_select ON app.jurisdiction_policies FOR SELECT TO authenticated
  USING (
    (scope = 'global' AND app.has_any_membership())
    OR (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'VIEWER'))
  );
--> statement-breakpoint
CREATE POLICY jurisdiction_insert ON app.jurisdiction_policies FOR INSERT TO authenticated
  WITH CHECK (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'));
--> statement-breakpoint
CREATE POLICY jurisdiction_update ON app.jurisdiction_policies FOR UPDATE TO authenticated
  USING (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'))
  WITH CHECK (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'));
--> statement-breakpoint
CREATE POLICY jurisdiction_delete ON app.jurisdiction_policies FOR DELETE TO authenticated
  USING (scope = 'workspace' AND app.has_workspace_role(workspace_id, 'ADMIN'));
