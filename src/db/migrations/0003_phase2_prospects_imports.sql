-- Trigram search (prospect repository). Supabase provides the `extensions` schema.
CREATE SCHEMA IF NOT EXISTS extensions;--> statement-breakpoint
CREATE EXTENSION IF NOT EXISTS pg_trgm WITH SCHEMA extensions;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" DROP CONSTRAINT "prospect_import_rows_outcome_check";--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" DROP CONSTRAINT "prospect_imports_status_check";--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ALTER COLUMN "storage_path" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD COLUMN "planned_outcome" text;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD COLUMN "eligibility" text;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD COLUMN "eligibility_reasons" text[] DEFAULT '{}'::text[] NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ADD COLUMN "review_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ADD COLUMN "error_count" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ADD COLUMN "started_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."prospect_outreach_state" ADD COLUMN "eligibility_expires_at" timestamp with time zone;--> statement-breakpoint
ALTER TABLE "app"."prospects" ADD COLUMN "search_text" text GENERATED ALWAYS AS (lower(coalesce(company_name, '') || ' ' || coalesce(contact_name, '') || ' ' || coalesce(contact_title, '') || ' ' || coalesce(email_normalized, '') || ' ' || coalesce(website_domain, '') || ' ' || coalesce(city, '') || ' ' || coalesce(state, '') || ' ' || coalesce(business_type, ''))) STORED;--> statement-breakpoint
CREATE INDEX "prospect_import_rows_planned_idx" ON "app"."prospect_import_rows" USING btree ("import_id","planned_outcome");--> statement-breakpoint
CREATE INDEX "prospect_import_rows_prospect_idx" ON "app"."prospect_import_rows" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "prospect_outreach_state_ws_expires_idx" ON "app"."prospect_outreach_state" USING btree ("workspace_id","eligibility_expires_at");--> statement-breakpoint
CREATE INDEX "prospects_search_trgm_idx" ON "app"."prospects" USING gin ("search_text" extensions.gin_trgm_ops);--> statement-breakpoint
CREATE INDEX "prospects_ws_verification_idx" ON "app"."prospects" USING btree ("workspace_id","email_verification_status");--> statement-breakpoint
CREATE INDEX "prospects_ws_updated_idx" ON "app"."prospects" USING btree ("workspace_id","updated_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prospects_ws_company_idx" ON "app"."prospects" USING btree ("workspace_id","company_name");--> statement-breakpoint
CREATE INDEX "prospects_ws_last_import_idx" ON "app"."prospects" USING btree ("workspace_id","last_import_id");--> statement-breakpoint
CREATE INDEX "unsubscribes_ws_email_idx" ON "app"."unsubscribes" USING btree ("workspace_id","email_normalized");--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_planned_check" CHECK ("app"."prospect_import_rows"."planned_outcome" is null or "app"."prospect_import_rows"."planned_outcome" in ('pending', 'create', 'update', 'unchanged', 'duplicate_in_file', 'duplicate_existing', 'invalid', 'suppressed', 'skipped', 'error'));--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_eligibility_check" CHECK ("app"."prospect_import_rows"."eligibility" is null or "app"."prospect_import_rows"."eligibility" in ('ELIGIBLE', 'INELIGIBLE', 'SUPPRESSED', 'NEEDS_REVIEW'));--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_outcome_check" CHECK ("app"."prospect_import_rows"."outcome" in ('pending', 'create', 'update', 'unchanged', 'duplicate_in_file', 'duplicate_existing', 'invalid', 'suppressed', 'skipped', 'error'));--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ADD CONSTRAINT "prospect_imports_status_check" CHECK ("app"."prospect_imports"."status" in ('uploaded', 'parsed', 'mapped', 'validating', 'ready', 'importing', 'completed', 'completed_with_issues', 'failed', 'cancelled'));