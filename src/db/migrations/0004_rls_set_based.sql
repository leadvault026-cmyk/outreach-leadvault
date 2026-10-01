-- Phase 2 performance: set-based tenant policies (hand-written).
--
-- 0001 policies called app.has_workspace_role(workspace_id, …) for EVERY row. That function is
-- SECURITY DEFINER (never inlined), so each row ran its own membership query: ~0.1 ms per row,
-- i.e. ~1.5 s to scan a 12,000-prospect workspace. The rules are unchanged here; only their form
-- is: `workspace_id IN (SELECT app.my_workspace_ids(role))` is evaluated ONCE per statement (an
-- uncorrelated subquery the planner hashes or turns into a semi-join), and lets the planner use
-- workspace_id indexes. NULL workspace_id never matches IN, exactly like has_workspace_role.

CREATE OR REPLACE FUNCTION app.my_workspace_ids(min_role text) RETURNS SETOF uuid
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = ''
AS $$
  SELECT m.workspace_id
  FROM app.workspace_members m
  JOIN app.workspaces w ON w.id = m.workspace_id
  WHERE m.user_id = app.current_user_id()
    AND m.status = 'active'
    AND w.archived_at IS NULL
    AND app.role_rank(m.role) >= app.role_rank(min_role)
$$;
--> statement-breakpoint
REVOKE ALL ON FUNCTION app.my_workspace_ids(text) FROM PUBLIC;
--> statement-breakpoint
GRANT EXECUTE ON FUNCTION app.my_workspace_ids(text) TO authenticated;

--> statement-breakpoint
-- Standard tenant tables: members read; OPERATOR+ writes (where granted). Same set as 0001.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'prospects', 'prospect_outreach_state', 'prospect_imports', 'prospect_import_rows',
    'audiences', 'audience_members', 'templates', 'campaigns', 'sequence_steps',
    'campaign_recipients', 'campaign_outcomes', 'messages', 'message_events', 'reply_threads',
    'replies', 'unsubscribes'
  ] LOOP
    EXECUTE format('DROP POLICY tenant_select ON app.%I', t);
    EXECUTE format('DROP POLICY tenant_insert ON app.%I', t);
    EXECUTE format('DROP POLICY tenant_update ON app.%I', t);
    EXECUTE format('DROP POLICY tenant_delete ON app.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_select ON app.%I FOR SELECT TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''VIEWER'')))', t);
    EXECUTE format(
      'CREATE POLICY tenant_insert ON app.%I FOR INSERT TO authenticated WITH CHECK (workspace_id IN (SELECT app.my_workspace_ids(''OPERATOR'')))', t);
    EXECUTE format(
      'CREATE POLICY tenant_update ON app.%I FOR UPDATE TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''OPERATOR''))) WITH CHECK (workspace_id IN (SELECT app.my_workspace_ids(''OPERATOR'')))', t);
    EXECUTE format(
      'CREATE POLICY tenant_delete ON app.%I FOR DELETE TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''OPERATOR'')))', t);
  END LOOP;
END
$$;

--> statement-breakpoint
-- Only DRAFT campaigns may be deleted (architecture §9).
DROP POLICY tenant_delete ON app.campaigns;
--> statement-breakpoint
CREATE POLICY tenant_delete ON app.campaigns FOR DELETE TO authenticated
  USING (status = 'DRAFT' AND workspace_id IN (SELECT app.my_workspace_ids('OPERATOR')));

--> statement-breakpoint
-- Infrastructure configuration: members read; ADMIN+ writes. Same set as 0001.
DO $$
DECLARE t text;
BEGIN
  FOREACH t IN ARRAY ARRAY['mailboxes', 'sending_identities', 'workspace_custom_fields', 'provider_connections'] LOOP
    EXECUTE format('DROP POLICY tenant_select ON app.%I', t);
    EXECUTE format('DROP POLICY admin_insert ON app.%I', t);
    EXECUTE format('DROP POLICY admin_update ON app.%I', t);
    EXECUTE format('DROP POLICY admin_delete ON app.%I', t);
    EXECUTE format(
      'CREATE POLICY tenant_select ON app.%I FOR SELECT TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''VIEWER'')))', t);
    EXECUTE format(
      'CREATE POLICY admin_insert ON app.%I FOR INSERT TO authenticated WITH CHECK (workspace_id IN (SELECT app.my_workspace_ids(''ADMIN'')))', t);
    EXECUTE format(
      'CREATE POLICY admin_update ON app.%I FOR UPDATE TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''ADMIN''))) WITH CHECK (workspace_id IN (SELECT app.my_workspace_ids(''ADMIN'')))', t);
    EXECUTE format(
      'CREATE POLICY admin_delete ON app.%I FOR DELETE TO authenticated USING (workspace_id IN (SELECT app.my_workspace_ids(''ADMIN'')))', t);
  END LOOP;
END
$$;

--> statement-breakpoint
-- Audit logs can grow large: same rule, set-based form.
DROP POLICY audit_select ON app.audit_logs;
--> statement-breakpoint
CREATE POLICY audit_select ON app.audit_logs FOR SELECT TO authenticated
  USING (
    workspace_id IN (SELECT app.my_workspace_ids('ADMIN'))
    OR (workspace_id IS NULL AND actor_user_id = app.current_user_id())
  );

--> statement-breakpoint
-- Suppressions can grow large (global list): same rules, set-based form.
DROP POLICY suppression_select ON app.suppressions;
--> statement-breakpoint
CREATE POLICY suppression_select ON app.suppressions FOR SELECT TO authenticated
  USING (
    (scope = 'workspace' AND workspace_id IN (SELECT app.my_workspace_ids('VIEWER')))
    OR (scope = 'global' AND (SELECT app.has_any_membership()))
  );
--> statement-breakpoint
DROP POLICY suppression_insert ON app.suppressions;
--> statement-breakpoint
CREATE POLICY suppression_insert ON app.suppressions FOR INSERT TO authenticated
  WITH CHECK (scope = 'workspace' AND workspace_id IN (SELECT app.my_workspace_ids('OPERATOR')));
--> statement-breakpoint
DROP POLICY suppression_lift ON app.suppressions;
--> statement-breakpoint
CREATE POLICY suppression_lift ON app.suppressions FOR UPDATE TO authenticated
  USING (scope = 'workspace' AND workspace_id IN (SELECT app.my_workspace_ids('ADMIN')))
  WITH CHECK (scope = 'workspace' AND workspace_id IN (SELECT app.my_workspace_ids('ADMIN')));
