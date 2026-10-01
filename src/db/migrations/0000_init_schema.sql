CREATE SCHEMA "app";
--> statement-breakpoint
CREATE TABLE "app"."profiles" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"full_name" text,
	"is_platform_admin" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_members" (
	"workspace_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"role" text NOT NULL,
	"status" text DEFAULT 'active' NOT NULL,
	"invited_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_members_workspace_id_user_id_pk" PRIMARY KEY("workspace_id","user_id"),
	CONSTRAINT "workspace_members_role_check" CHECK ("app"."workspace_members"."role" in ('OWNER', 'ADMIN', 'OPERATOR', 'VIEWER')),
	CONSTRAINT "workspace_members_status_check" CHECK ("app"."workspace_members"."status" in ('invited', 'active', 'disabled'))
);
--> statement-breakpoint
CREATE TABLE "app"."workspaces" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"name" text NOT NULL,
	"slug" text NOT NULL,
	"kind" text DEFAULT 'client' NOT NULL,
	"default_timezone" text NOT NULL,
	"sender_country_code" char(2),
	"compliance_postal_address" text,
	"is_demo" boolean DEFAULT false NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspaces_slug_unique" UNIQUE("slug"),
	CONSTRAINT "workspaces_slug_format" CHECK ("app"."workspaces"."slug" ~ '^[a-z0-9-]{2,48}$'),
	CONSTRAINT "workspaces_kind_check" CHECK ("app"."workspaces"."kind" in ('internal', 'client')),
	CONSTRAINT "workspaces_sender_country_format" CHECK ("app"."workspaces"."sender_country_code" is null or "app"."workspaces"."sender_country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "app"."prospect_import_rows" (
	"import_id" uuid NOT NULL,
	"row_number" integer NOT NULL,
	"workspace_id" uuid NOT NULL,
	"raw" jsonb NOT NULL,
	"mapped" jsonb,
	"outcome" text NOT NULL,
	"issues" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"prospect_id" uuid,
	"overridden_by" uuid,
	CONSTRAINT "prospect_import_rows_import_id_row_number_pk" PRIMARY KEY("import_id","row_number"),
	CONSTRAINT "prospect_import_rows_outcome_check" CHECK ("app"."prospect_import_rows"."outcome" in ('pending', 'create', 'update', 'unchanged', 'duplicate_in_file', 'duplicate_existing', 'invalid', 'suppressed', 'skipped')),
	CONSTRAINT "prospect_import_rows_row_number_check" CHECK ("app"."prospect_import_rows"."row_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."prospect_imports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"created_by" uuid NOT NULL,
	"source_label" text,
	"file_name" text NOT NULL,
	"storage_path" text NOT NULL,
	"file_sha256" text NOT NULL,
	"default_country_code" char(2),
	"row_count" integer,
	"status" text NOT NULL,
	"column_mapping" jsonb,
	"options" jsonb,
	"created_count" integer DEFAULT 0 NOT NULL,
	"updated_count" integer DEFAULT 0 NOT NULL,
	"unchanged_count" integer DEFAULT 0 NOT NULL,
	"skipped_count" integer DEFAULT 0 NOT NULL,
	"invalid_count" integer DEFAULT 0 NOT NULL,
	"suppressed_count" integer DEFAULT 0 NOT NULL,
	"duplicate_count" integer DEFAULT 0 NOT NULL,
	"error_code" text,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_imports_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "prospect_imports_status_check" CHECK ("app"."prospect_imports"."status" in ('uploaded', 'parsed', 'mapped', 'validating', 'ready', 'importing', 'completed', 'failed', 'cancelled')),
	CONSTRAINT "prospect_imports_default_country_format" CHECK ("app"."prospect_imports"."default_country_code" is null or "app"."prospect_imports"."default_country_code" ~ '^[A-Z]{2}$')
);
--> statement-breakpoint
CREATE TABLE "app"."prospect_outreach_state" (
	"prospect_id" uuid PRIMARY KEY NOT NULL,
	"workspace_id" uuid NOT NULL,
	"eligibility" text NOT NULL,
	"eligibility_reasons" text[] DEFAULT '{}'::text[] NOT NULL,
	"eligibility_checked_at" timestamp with time zone NOT NULL,
	"review_decision" text,
	"review_decided_by" uuid,
	"review_decided_at" timestamp with time zone,
	"last_contacted_at" timestamp with time zone,
	"last_reply_at" timestamp with time zone,
	"last_outcome" text,
	"active_enrollment_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospect_outreach_state_eligibility_check" CHECK ("app"."prospect_outreach_state"."eligibility" in ('ELIGIBLE', 'INELIGIBLE', 'SUPPRESSED', 'NEEDS_REVIEW')),
	CONSTRAINT "prospect_outreach_state_review_check" CHECK ("app"."prospect_outreach_state"."review_decision" is null or "app"."prospect_outreach_state"."review_decision" in ('approved', 'rejected')),
	CONSTRAINT "prospect_outreach_state_count_check" CHECK ("app"."prospect_outreach_state"."active_enrollment_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."prospects" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"company_name" text NOT NULL,
	"website" text,
	"website_domain" text,
	"contact_name" text,
	"first_name" text,
	"last_name" text,
	"contact_title" text,
	"email" text,
	"email_normalized" text,
	"email_domain" text,
	"email_verification_status" text DEFAULT 'UNKNOWN' NOT NULL,
	"email_verified_at" timestamp with time zone,
	"email_verification_source" text,
	"email_verification_detail" text,
	"phone" text,
	"address_line" text,
	"city" text,
	"state" text,
	"postal_code" text,
	"country_code" char(2),
	"region_code" text,
	"business_type" text,
	"qualification_basis" text,
	"evidence_url" text,
	"custom_fields" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"research_source_ref" text,
	"research_approved_at" timestamp with time zone,
	"first_import_id" uuid,
	"last_import_id" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "prospects_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "prospects_email_normalized_check" CHECK ("app"."prospects"."email_normalized" is null or "app"."prospects"."email_normalized" = lower(btrim("app"."prospects"."email_normalized"))),
	CONSTRAINT "prospects_country_format" CHECK ("app"."prospects"."country_code" is null or "app"."prospects"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "prospects_verification_status_check" CHECK ("app"."prospects"."email_verification_status" in ('VERIFIED', 'INVALID', 'RISKY', 'UNKNOWN', 'STALE')),
	CONSTRAINT "prospects_verification_provenance_check" CHECK ("app"."prospects"."email_verification_status" = 'UNKNOWN' or ("app"."prospects"."email_verified_at" is not null and "app"."prospects"."email_verification_source" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."workspace_custom_fields" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"key" text NOT NULL,
	"label" text NOT NULL,
	"data_type" text DEFAULT 'text' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "workspace_custom_fields_ws_key_key" UNIQUE("workspace_id","key"),
	CONSTRAINT "workspace_custom_fields_key_format" CHECK ("app"."workspace_custom_fields"."key" ~ '^[a-z][a-z0-9_]{1,40}$'),
	CONSTRAINT "workspace_custom_fields_type_check" CHECK ("app"."workspace_custom_fields"."data_type" in ('text', 'number', 'date', 'url'))
);
--> statement-breakpoint
CREATE TABLE "app"."audience_members" (
	"audience_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"workspace_id" uuid NOT NULL,
	"added_via" text NOT NULL,
	"added_by" uuid,
	"added_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audience_members_audience_id_prospect_id_pk" PRIMARY KEY("audience_id","prospect_id"),
	CONSTRAINT "audience_members_added_via_check" CHECK ("app"."audience_members"."added_via" in ('manual', 'import', 'filter'))
);
--> statement-breakpoint
CREATE TABLE "app"."audiences" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"source_import_id" uuid,
	"saved_filter" jsonb,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audiences_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."templates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"subject" text NOT NULL,
	"body" text NOT NULL,
	"variables_used" text[] DEFAULT '{}'::text[] NOT NULL,
	"created_by" uuid,
	"archived_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "templates_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."mailbox_daily_usage" (
	"mailbox_id" uuid NOT NULL,
	"usage_date" date NOT NULL,
	"sent_count" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "mailbox_daily_usage_mailbox_id_usage_date_pk" PRIMARY KEY("mailbox_id","usage_date"),
	CONSTRAINT "mailbox_daily_usage_count_check" CHECK ("app"."mailbox_daily_usage"."sent_count" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."mailboxes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider_connection_id" uuid NOT NULL,
	"email_address" text NOT NULL,
	"display_name" text NOT NULL,
	"status" text NOT NULL,
	"status_reason" text,
	"enabled" boolean DEFAULT true NOT NULL,
	"daily_send_limit" integer NOT NULL,
	"min_seconds_between_sends" integer DEFAULT 90 NOT NULL,
	"send_days" smallint[] DEFAULT '{1,2,3,4,5}'::smallint[] NOT NULL,
	"window_start" time DEFAULT '08:00' NOT NULL,
	"window_end" time DEFAULT '17:00' NOT NULL,
	"timezone" text NOT NULL,
	"signature" text,
	"next_available_at" timestamp with time zone DEFAULT now() NOT NULL,
	"infra_vendor" text NOT NULL,
	"warmup_status" text DEFAULT 'warming' NOT NULL,
	"warmup_started_at" timestamp with time zone,
	"ramp_schedule" jsonb,
	"b2b_only" boolean DEFAULT true NOT NULL,
	"last_send_at" timestamp with time zone,
	"last_sync_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "mailboxes_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "mailboxes_status_check" CHECK ("app"."mailboxes"."status" in ('CONNECTED', 'NEEDS_ATTENTION', 'PAUSED', 'DISCONNECTED')),
	CONSTRAINT "mailboxes_warmup_status_check" CHECK ("app"."mailboxes"."warmup_status" in ('warming', 'ready', 'paused')),
	CONSTRAINT "mailboxes_daily_limit_check" CHECK ("app"."mailboxes"."daily_send_limit" between 1 and 2000),
	CONSTRAINT "mailboxes_min_gap_check" CHECK ("app"."mailboxes"."min_seconds_between_sends" >= 0),
	CONSTRAINT "mailboxes_window_check" CHECK ("app"."mailboxes"."window_start" < "app"."mailboxes"."window_end"),
	CONSTRAINT "mailboxes_send_days_check" CHECK ("app"."mailboxes"."send_days" <@ '{1,2,3,4,5,6,7}'::smallint[])
);
--> statement-breakpoint
CREATE TABLE "app"."provider_connections" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"provider" text NOT NULL,
	"account_email" text NOT NULL,
	"external_account_id" text,
	"status" text NOT NULL,
	"encrypted_credentials" "bytea" NOT NULL,
	"credentials_key_version" smallint NOT NULL,
	"scopes" text[] DEFAULT '{}'::text[] NOT NULL,
	"ingestion_mode" text DEFAULT 'provider_api' NOT NULL,
	"inbound_routing_address" text,
	"access_token_expires_at" timestamp with time zone,
	"sync_cursor" text,
	"push_watch_expires_at" timestamp with time zone,
	"last_verified_at" timestamp with time zone,
	"last_error_code" text,
	"last_error_at" timestamp with time zone,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "provider_connections_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "provider_connections_ws_provider_email_key" UNIQUE("workspace_id","provider","account_email"),
	CONSTRAINT "provider_connections_provider_check" CHECK ("app"."provider_connections"."provider" in ('smtp_imap', 'google_workspace', 'microsoft_365')),
	CONSTRAINT "provider_connections_status_check" CHECK ("app"."provider_connections"."status" in ('active', 'needs_reauth', 'revoked', 'error')),
	CONSTRAINT "provider_connections_ingestion_check" CHECK ("app"."provider_connections"."ingestion_mode" in ('provider_api', 'inbound_routing'))
);
--> statement-breakpoint
CREATE TABLE "app"."sending_identities" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"from_name" text NOT NULL,
	"from_email" text NOT NULL,
	"reply_to_email" text,
	"is_default" boolean DEFAULT false NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sending_identities_workspace_id_id_key" UNIQUE("workspace_id","id")
);
--> statement-breakpoint
CREATE TABLE "app"."campaign_outcomes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_recipient_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"outcome" text NOT NULL,
	"source" text NOT NULL,
	"set_by" uuid,
	"note" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_outcomes_outcome_check" CHECK ("app"."campaign_outcomes"."outcome" in ('INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'OTHER')),
	CONSTRAINT "campaign_outcomes_source_check" CHECK ("app"."campaign_outcomes"."source" in ('inbox_classification', 'manual', 'system'))
);
--> statement-breakpoint
CREATE TABLE "app"."campaign_recipients" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"prospect_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"status" text NOT NULL,
	"last_sent_step" integer DEFAULT 0 NOT NULL,
	"next_step" integer,
	"next_send_at" timestamp with time zone,
	"provider_thread_id" text,
	"first_message_rfc_id" text,
	"stop_reason" text,
	"stopped_at" timestamp with time zone,
	"stopped_by" uuid,
	"excluded_reasons" text[],
	"outcome" text,
	"enrolled_at" timestamp with time zone DEFAULT now() NOT NULL,
	"enrolled_by" uuid,
	"last_sent_at" timestamp with time zone,
	"replied_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaign_recipients_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaign_recipients_campaign_prospect_key" UNIQUE("campaign_id","prospect_id"),
	CONSTRAINT "campaign_recipients_status_check" CHECK ("app"."campaign_recipients"."status" in ('QUEUED', 'SCHEDULED', 'SENDING', 'COMPLETED', 'REPLIED', 'BOUNCED', 'UNSUBSCRIBED', 'SUPPRESSED', 'STOPPED', 'FAILED', 'CANCELLED', 'EXCLUDED')),
	CONSTRAINT "campaign_recipients_outcome_check" CHECK ("app"."campaign_recipients"."outcome" is null or "app"."campaign_recipients"."outcome" in ('INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'OTHER')),
	CONSTRAINT "campaign_recipients_last_step_check" CHECK ("app"."campaign_recipients"."last_sent_step" >= 0),
	CONSTRAINT "campaign_recipients_scheduled_check" CHECK ("app"."campaign_recipients"."status" <> 'SCHEDULED' or ("app"."campaign_recipients"."next_step" is not null and "app"."campaign_recipients"."next_send_at" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."campaigns" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"name" text NOT NULL,
	"description" text,
	"objective" text,
	"status" text DEFAULT 'DRAFT' NOT NULL,
	"audience_id" uuid,
	"mailbox_id" uuid,
	"sending_identity_id" uuid,
	"timezone" text,
	"send_days" smallint[],
	"window_start" time,
	"window_end" time,
	"daily_limit" integer,
	"min_seconds_between_sends" integer,
	"continue_on_auto_reply" boolean DEFAULT true NOT NULL,
	"target_country_codes" char(2)[],
	"start_at" timestamp with time zone,
	"launched_at" timestamp with time zone,
	"launched_by" uuid,
	"paused_at" timestamp with time zone,
	"pause_reason" text,
	"completed_at" timestamp with time zone,
	"cancelled_at" timestamp with time zone,
	"version" integer DEFAULT 1 NOT NULL,
	"archived_at" timestamp with time zone,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "campaigns_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "campaigns_status_check" CHECK ("app"."campaigns"."status" in ('DRAFT', 'SCHEDULED', 'ACTIVE', 'PAUSED', 'COMPLETED', 'CANCELLED')),
	CONSTRAINT "campaigns_daily_limit_check" CHECK ("app"."campaigns"."daily_limit" is null or "app"."campaigns"."daily_limit" > 0),
	CONSTRAINT "campaigns_window_check" CHECK ("app"."campaigns"."window_start" is null or "app"."campaigns"."window_end" is null or "app"."campaigns"."window_start" < "app"."campaigns"."window_end"),
	CONSTRAINT "campaigns_version_check" CHECK ("app"."campaigns"."version" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."sequence_steps" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"campaign_id" uuid NOT NULL,
	"step_number" integer NOT NULL,
	"delay_minutes" integer DEFAULT 0 NOT NULL,
	"thread_mode" text DEFAULT 'reply' NOT NULL,
	"subject" text,
	"body" text NOT NULL,
	"enabled" boolean DEFAULT true NOT NULL,
	"source_template_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "sequence_steps_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "sequence_steps_campaign_step_key" UNIQUE("campaign_id","step_number"),
	CONSTRAINT "sequence_steps_step_number_check" CHECK ("app"."sequence_steps"."step_number" >= 1),
	CONSTRAINT "sequence_steps_delay_check" CHECK ("app"."sequence_steps"."delay_minutes" >= 0),
	CONSTRAINT "sequence_steps_thread_mode_check" CHECK ("app"."sequence_steps"."thread_mode" in ('new', 'reply')),
	CONSTRAINT "sequence_steps_subject_check" CHECK ("app"."sequence_steps"."subject" is not null or ("app"."sequence_steps"."thread_mode" = 'reply' and "app"."sequence_steps"."step_number" > 1))
);
--> statement-breakpoint
CREATE TABLE "app"."message_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"message_id" uuid,
	"campaign_recipient_id" uuid,
	"event_type" text NOT NULL,
	"occurred_at" timestamp with time zone NOT NULL,
	"source" text NOT NULL,
	"dedupe_key" text NOT NULL,
	"webhook_event_id" uuid,
	"inbound_message_id" uuid,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "message_events_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "message_events_type_check" CHECK ("app"."message_events"."event_type" in ('sent', 'send_failed', 'delivered', 'soft_bounce', 'hard_bounce', 'blocked', 'replied', 'auto_replied', 'unsubscribed', 'complaint')),
	CONSTRAINT "message_events_source_check" CHECK ("app"."message_events"."source" in ('provider_api', 'mailbox_sync', 'webhook', 'user', 'system'))
);
--> statement-breakpoint
CREATE TABLE "app"."messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"kind" text NOT NULL,
	"campaign_id" uuid,
	"campaign_recipient_id" uuid,
	"sequence_step_id" uuid,
	"step_number" integer,
	"prospect_id" uuid,
	"mailbox_id" uuid NOT NULL,
	"sending_identity_id" uuid,
	"to_email" text NOT NULL,
	"from_email" text NOT NULL,
	"from_name" text,
	"subject" text NOT NULL,
	"body_text" text NOT NULL,
	"rfc_message_id" text NOT NULL,
	"lv_message_header" text NOT NULL,
	"in_reply_to" text,
	"references_header" text,
	"provider_message_id" text,
	"provider_thread_id" text,
	"status" text NOT NULL,
	"scheduled_for" timestamp with time zone NOT NULL,
	"next_attempt_at" timestamp with time zone,
	"lease_owner" text,
	"lease_expires_at" timestamp with time zone,
	"attempt_count" integer DEFAULT 0 NOT NULL,
	"reconciliation_checks" integer DEFAULT 0 NOT NULL,
	"reconciliation_next_at" timestamp with time zone,
	"resolution" text,
	"resolved_by" uuid,
	"resolved_at" timestamp with time zone,
	"sent_at" timestamp with time zone,
	"failed_at" timestamp with time zone,
	"error_code" text,
	"error_message" text,
	"bounced_at" timestamp with time zone,
	"bounce_type" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "messages_rfc_message_id_unique" UNIQUE("rfc_message_id"),
	CONSTRAINT "messages_lv_message_header_unique" UNIQUE("lv_message_header"),
	CONSTRAINT "messages_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "messages_kind_check" CHECK ("app"."messages"."kind" in ('sequence', 'manual_reply', 'test')),
	CONSTRAINT "messages_status_check" CHECK ("app"."messages"."status" in ('PENDING', 'SENDING', 'RETRY_WAIT', 'RECONCILIATION_REQUIRED', 'OPERATOR_REVIEW', 'SENT', 'FAILED', 'CANCELLED')),
	CONSTRAINT "messages_resolution_check" CHECK ("app"."messages"."resolution" is null or "app"."messages"."resolution" in ('confirmed_sent_auto', 'confirmed_sent_operator', 'operator_retry_authorized', 'operator_skipped', 'operator_stopped')),
	CONSTRAINT "messages_sequence_shape_check" CHECK ("app"."messages"."kind" <> 'sequence' or ("app"."messages"."campaign_id" is not null and "app"."messages"."campaign_recipient_id" is not null and "app"."messages"."step_number" is not null)),
	CONSTRAINT "messages_sent_at_check" CHECK ("app"."messages"."status" <> 'SENT' or "app"."messages"."sent_at" is not null),
	CONSTRAINT "messages_attempts_check" CHECK ("app"."messages"."attempt_count" >= 0 and "app"."messages"."reconciliation_checks" >= 0)
);
--> statement-breakpoint
CREATE TABLE "app"."replies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"reply_thread_id" uuid,
	"provider_message_id" text NOT NULL,
	"rfc_message_id" text,
	"in_reply_to" text,
	"references_header" text,
	"from_email" text NOT NULL,
	"from_name" text,
	"to_emails" text[],
	"subject" text,
	"snippet" text,
	"body_text" text,
	"body_html_sanitized" text,
	"received_at" timestamp with time zone NOT NULL,
	"kind" text NOT NULL,
	"matched_message_id" uuid,
	"match_method" text,
	"processed_at" timestamp with time zone,
	"raw_headers" jsonb,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "replies_mailbox_provider_message_key" UNIQUE("mailbox_id","provider_message_id"),
	CONSTRAINT "replies_kind_check" CHECK ("app"."replies"."kind" in ('human_reply', 'auto_reply', 'bounce_report', 'unsubscribe_request', 'other')),
	CONSTRAINT "replies_match_method_check" CHECK ("app"."replies"."match_method" is null or "app"."replies"."match_method" in ('in_reply_to', 'references', 'provider_thread', 'sender_fallback', 'none'))
);
--> statement-breakpoint
CREATE TABLE "app"."reply_threads" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"mailbox_id" uuid NOT NULL,
	"provider_thread_id" text NOT NULL,
	"campaign_id" uuid,
	"campaign_recipient_id" uuid,
	"prospect_id" uuid,
	"subject" text,
	"classification" text DEFAULT 'UNREVIEWED' NOT NULL,
	"classified_by" uuid,
	"classified_at" timestamp with time zone,
	"is_unread" boolean DEFAULT true NOT NULL,
	"archived_at" timestamp with time zone,
	"last_message_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "reply_threads_workspace_id_id_key" UNIQUE("workspace_id","id"),
	CONSTRAINT "reply_threads_mailbox_thread_key" UNIQUE("mailbox_id","provider_thread_id"),
	CONSTRAINT "reply_threads_classification_check" CHECK ("app"."reply_threads"."classification" in ('UNREVIEWED', 'INTERESTED', 'NOT_INTERESTED', 'FOLLOW_UP', 'OUT_OF_OFFICE', 'UNSUBSCRIBE', 'OTHER'))
);
--> statement-breakpoint
CREATE TABLE "app"."send_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message_id" uuid NOT NULL,
	"attempt_number" integer NOT NULL,
	"worker_id" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"finished_at" timestamp with time zone,
	"mailbox_history_id_before" text,
	"request_dispatched" boolean DEFAULT false NOT NULL,
	"result" text,
	"provider_status" integer,
	"error_code" text,
	"error_detail" text,
	CONSTRAINT "send_attempts_message_attempt_key" UNIQUE("message_id","attempt_number"),
	CONSTRAINT "send_attempts_result_check" CHECK ("app"."send_attempts"."result" is null or "app"."send_attempts"."result" in ('accepted', 'rejected_not_sent', 'ambiguous')),
	CONSTRAINT "send_attempts_number_check" CHECK ("app"."send_attempts"."attempt_number" >= 1)
);
--> statement-breakpoint
CREATE TABLE "app"."jurisdiction_policies" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"workspace_id" uuid,
	"country_code" char(2) NOT NULL,
	"region_code" text,
	"outreach_status" text NOT NULL,
	"requires_postal_address" boolean DEFAULT true NOT NULL,
	"requires_unsubscribe_link" boolean DEFAULT true NOT NULL,
	"footer_template" text,
	"notes" text,
	"updated_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "jurisdiction_policies_scope_check" CHECK ("app"."jurisdiction_policies"."scope" in ('global', 'workspace')),
	CONSTRAINT "jurisdiction_policies_scope_workspace_check" CHECK (("app"."jurisdiction_policies"."scope" = 'global') = ("app"."jurisdiction_policies"."workspace_id" is null)),
	CONSTRAINT "jurisdiction_policies_status_check" CHECK ("app"."jurisdiction_policies"."outreach_status" in ('allowed', 'review', 'blocked')),
	CONSTRAINT "jurisdiction_policies_country_format" CHECK ("app"."jurisdiction_policies"."country_code" ~ '^[A-Z]{2}$'),
	CONSTRAINT "jurisdiction_policies_region_format" CHECK ("app"."jurisdiction_policies"."region_code" is null or "app"."jurisdiction_policies"."region_code" ~ '^[A-Z]{2}-[A-Z0-9]{1,3}$')
);
--> statement-breakpoint
CREATE TABLE "app"."suppressions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"scope" text NOT NULL,
	"workspace_id" uuid,
	"value_type" text NOT NULL,
	"value_normalized" text NOT NULL,
	"reason" text NOT NULL,
	"source" text NOT NULL,
	"source_message_id" uuid,
	"source_campaign_id" uuid,
	"note" text,
	"created_by" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"lifted_at" timestamp with time zone,
	"lifted_by" uuid,
	"lift_reason" text,
	CONSTRAINT "suppressions_scope_check" CHECK ("app"."suppressions"."scope" in ('workspace', 'global')),
	CONSTRAINT "suppressions_scope_workspace_check" CHECK (("app"."suppressions"."scope" = 'global') = ("app"."suppressions"."workspace_id" is null)),
	CONSTRAINT "suppressions_value_type_check" CHECK ("app"."suppressions"."value_type" in ('email', 'domain')),
	CONSTRAINT "suppressions_reason_check" CHECK ("app"."suppressions"."reason" in ('UNSUBSCRIBE', 'HARD_BOUNCE', 'MANUAL_DO_NOT_CONTACT', 'COMPLIANCE', 'COMPLAINT')),
	CONSTRAINT "suppressions_source_check" CHECK ("app"."suppressions"."source" in ('unsubscribe_link', 'reply', 'bounce', 'manual', 'import', 'system')),
	CONSTRAINT "suppressions_value_normalized_check" CHECK ("app"."suppressions"."value_normalized" = lower(btrim("app"."suppressions"."value_normalized")) and length("app"."suppressions"."value_normalized") > 0),
	CONSTRAINT "suppressions_lift_check" CHECK (("app"."suppressions"."lifted_at" is null and "app"."suppressions"."lifted_by" is null and "app"."suppressions"."lift_reason" is null) or ("app"."suppressions"."lifted_at" is not null and "app"."suppressions"."lift_reason" is not null))
);
--> statement-breakpoint
CREATE TABLE "app"."unsubscribes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"email_normalized" text NOT NULL,
	"message_id" uuid,
	"campaign_id" uuid,
	"campaign_recipient_id" uuid,
	"method" text NOT NULL,
	"suppression_id" uuid NOT NULL,
	"user_agent" text,
	"ip_hash" text,
	"occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "unsubscribes_message_method_key" UNIQUE("message_id","method"),
	CONSTRAINT "unsubscribes_method_check" CHECK ("app"."unsubscribes"."method" in ('one_click_post', 'link_confirm', 'reply', 'manual'))
);
--> statement-breakpoint
CREATE TABLE "app"."audit_logs" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid,
	"actor_type" text NOT NULL,
	"actor_user_id" uuid,
	"actor_email" text,
	"action" text NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"request_id" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "audit_logs_actor_type_check" CHECK ("app"."audit_logs"."actor_type" in ('user', 'system', 'worker')),
	CONSTRAINT "audit_logs_action_format" CHECK ("app"."audit_logs"."action" ~ '^[a-z_]+(\.[a-z_]+)+$'),
	CONSTRAINT "audit_logs_user_actor_check" CHECK ("app"."audit_logs"."actor_type" <> 'user' or "app"."audit_logs"."actor_user_id" is not null)
);
--> statement-breakpoint
CREATE TABLE "app"."webhook_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"provider" text NOT NULL,
	"endpoint" text NOT NULL,
	"provider_event_id" text,
	"dedupe_key" text NOT NULL,
	"signature_valid" boolean NOT NULL,
	"headers" jsonb NOT NULL,
	"payload" jsonb NOT NULL,
	"workspace_id" uuid,
	"status" text NOT NULL,
	"attempts" integer DEFAULT 0 NOT NULL,
	"last_error" text,
	"received_at" timestamp with time zone DEFAULT now() NOT NULL,
	"processed_at" timestamp with time zone,
	CONSTRAINT "webhook_events_dedupe_key_unique" UNIQUE("dedupe_key"),
	CONSTRAINT "webhook_events_status_check" CHECK ("app"."webhook_events"."status" in ('received', 'processing', 'processed', 'failed', 'ignored'))
);
--> statement-breakpoint
CREATE TABLE "app"."worker_heartbeats" (
	"worker_id" text PRIMARY KEY NOT NULL,
	"service" text NOT NULL,
	"version" text NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"last_beat_at" timestamp with time zone NOT NULL,
	"loops" jsonb NOT NULL
);
--> statement-breakpoint
ALTER TABLE "app"."profiles" ADD CONSTRAINT "profiles_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_members" ADD CONSTRAINT "workspace_members_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_members" ADD CONSTRAINT "workspace_members_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_import_fk" FOREIGN KEY ("workspace_id","import_id") REFERENCES "app"."prospect_imports"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospect_import_rows" ADD CONSTRAINT "prospect_import_rows_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospect_imports" ADD CONSTRAINT "prospect_imports_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospect_outreach_state" ADD CONSTRAINT "prospect_outreach_state_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospects" ADD CONSTRAINT "prospects_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospects" ADD CONSTRAINT "prospects_first_import_fk" FOREIGN KEY ("workspace_id","first_import_id") REFERENCES "app"."prospect_imports"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."prospects" ADD CONSTRAINT "prospects_last_import_fk" FOREIGN KEY ("workspace_id","last_import_id") REFERENCES "app"."prospect_imports"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."workspace_custom_fields" ADD CONSTRAINT "workspace_custom_fields_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audience_members" ADD CONSTRAINT "audience_members_audience_fk" FOREIGN KEY ("workspace_id","audience_id") REFERENCES "app"."audiences"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audience_members" ADD CONSTRAINT "audience_members_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audiences" ADD CONSTRAINT "audiences_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audiences" ADD CONSTRAINT "audiences_source_import_fk" FOREIGN KEY ("workspace_id","source_import_id") REFERENCES "app"."prospect_imports"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."templates" ADD CONSTRAINT "templates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mailbox_daily_usage" ADD CONSTRAINT "mailbox_daily_usage_mailbox_id_mailboxes_id_fk" FOREIGN KEY ("mailbox_id") REFERENCES "app"."mailboxes"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mailboxes" ADD CONSTRAINT "mailboxes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."mailboxes" ADD CONSTRAINT "mailboxes_connection_fk" FOREIGN KEY ("workspace_id","provider_connection_id") REFERENCES "app"."provider_connections"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."provider_connections" ADD CONSTRAINT "provider_connections_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sending_identities" ADD CONSTRAINT "sending_identities_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "app"."mailboxes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaign_outcomes" ADD CONSTRAINT "campaign_outcomes_recipient_fk" FOREIGN KEY ("workspace_id","campaign_recipient_id") REFERENCES "app"."campaign_recipients"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaign_outcomes" ADD CONSTRAINT "campaign_outcomes_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "app"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "app"."campaigns"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaign_recipients" ADD CONSTRAINT "campaign_recipients_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaigns" ADD CONSTRAINT "campaigns_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaigns" ADD CONSTRAINT "campaigns_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "app"."mailboxes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaigns" ADD CONSTRAINT "campaigns_sending_identity_fk" FOREIGN KEY ("workspace_id","sending_identity_id") REFERENCES "app"."sending_identities"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."campaigns" ADD CONSTRAINT "campaigns_audience_fk" FOREIGN KEY ("workspace_id","audience_id") REFERENCES "app"."audiences"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_steps" ADD CONSTRAINT "sequence_steps_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "app"."campaigns"("workspace_id","id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."sequence_steps" ADD CONSTRAINT "sequence_steps_template_fk" FOREIGN KEY ("workspace_id","source_template_id") REFERENCES "app"."templates"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_events" ADD CONSTRAINT "message_events_message_fk" FOREIGN KEY ("workspace_id","message_id") REFERENCES "app"."messages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."message_events" ADD CONSTRAINT "message_events_recipient_fk" FOREIGN KEY ("workspace_id","campaign_recipient_id") REFERENCES "app"."campaign_recipients"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_recipient_fk" FOREIGN KEY ("workspace_id","campaign_recipient_id") REFERENCES "app"."campaign_recipients"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "app"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_step_fk" FOREIGN KEY ("workspace_id","sequence_step_id") REFERENCES "app"."sequence_steps"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "app"."mailboxes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."messages" ADD CONSTRAINT "messages_sending_identity_fk" FOREIGN KEY ("workspace_id","sending_identity_id") REFERENCES "app"."sending_identities"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replies" ADD CONSTRAINT "replies_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "app"."mailboxes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replies" ADD CONSTRAINT "replies_thread_fk" FOREIGN KEY ("workspace_id","reply_thread_id") REFERENCES "app"."reply_threads"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."replies" ADD CONSTRAINT "replies_matched_message_fk" FOREIGN KEY ("workspace_id","matched_message_id") REFERENCES "app"."messages"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reply_threads" ADD CONSTRAINT "reply_threads_mailbox_fk" FOREIGN KEY ("workspace_id","mailbox_id") REFERENCES "app"."mailboxes"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reply_threads" ADD CONSTRAINT "reply_threads_campaign_fk" FOREIGN KEY ("workspace_id","campaign_id") REFERENCES "app"."campaigns"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reply_threads" ADD CONSTRAINT "reply_threads_recipient_fk" FOREIGN KEY ("workspace_id","campaign_recipient_id") REFERENCES "app"."campaign_recipients"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."reply_threads" ADD CONSTRAINT "reply_threads_prospect_fk" FOREIGN KEY ("workspace_id","prospect_id") REFERENCES "app"."prospects"("workspace_id","id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."send_attempts" ADD CONSTRAINT "send_attempts_message_id_messages_id_fk" FOREIGN KEY ("message_id") REFERENCES "app"."messages"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."jurisdiction_policies" ADD CONSTRAINT "jurisdiction_policies_workspace_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."suppressions" ADD CONSTRAINT "suppressions_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."unsubscribes" ADD CONSTRAINT "unsubscribes_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."unsubscribes" ADD CONSTRAINT "unsubscribes_suppression_id_suppressions_id_fk" FOREIGN KEY ("suppression_id") REFERENCES "app"."suppressions"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "app"."audit_logs" ADD CONSTRAINT "audit_logs_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "app"."workspaces"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "workspace_members_user_idx" ON "app"."workspace_members" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "prospect_import_rows_outcome_idx" ON "app"."prospect_import_rows" USING btree ("import_id","outcome");--> statement-breakpoint
CREATE INDEX "prospect_imports_ws_created_idx" ON "app"."prospect_imports" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "prospect_imports_ws_sha_idx" ON "app"."prospect_imports" USING btree ("workspace_id","file_sha256");--> statement-breakpoint
CREATE INDEX "prospect_outreach_state_ws_eligibility_idx" ON "app"."prospect_outreach_state" USING btree ("workspace_id","eligibility");--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_ws_email_uq" ON "app"."prospects" USING btree ("workspace_id","email_normalized") WHERE "app"."prospects"."email_normalized" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "prospects_ws_research_ref_uq" ON "app"."prospects" USING btree ("workspace_id","research_source_ref") WHERE "app"."prospects"."research_source_ref" is not null;--> statement-breakpoint
CREATE INDEX "prospects_ws_country_idx" ON "app"."prospects" USING btree ("workspace_id","country_code","region_code");--> statement-breakpoint
CREATE INDEX "prospects_ws_state_idx" ON "app"."prospects" USING btree ("workspace_id","state");--> statement-breakpoint
CREATE INDEX "prospects_ws_business_type_idx" ON "app"."prospects" USING btree ("workspace_id","business_type");--> statement-breakpoint
CREATE INDEX "prospects_ws_domain_idx" ON "app"."prospects" USING btree ("workspace_id","website_domain");--> statement-breakpoint
CREATE INDEX "prospects_ws_created_idx" ON "app"."prospects" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audience_members_prospect_idx" ON "app"."audience_members" USING btree ("prospect_id");--> statement-breakpoint
CREATE UNIQUE INDEX "audiences_ws_name_uq" ON "app"."audiences" USING btree ("workspace_id",lower("name")) WHERE "app"."audiences"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "templates_ws_name_uq" ON "app"."templates" USING btree ("workspace_id",lower("name")) WHERE "app"."templates"."archived_at" is null;--> statement-breakpoint
CREATE UNIQUE INDEX "mailboxes_ws_email_uq" ON "app"."mailboxes" USING btree ("workspace_id",lower("email_address"));--> statement-breakpoint
CREATE UNIQUE INDEX "sending_identities_default_uq" ON "app"."sending_identities" USING btree ("mailbox_id") WHERE "app"."sending_identities"."is_default";--> statement-breakpoint
CREATE INDEX "campaign_outcomes_campaign_idx" ON "app"."campaign_outcomes" USING btree ("campaign_id","created_at");--> statement-breakpoint
CREATE INDEX "campaign_recipients_due_idx" ON "app"."campaign_recipients" USING btree ("next_send_at") WHERE "app"."campaign_recipients"."status" = 'SCHEDULED';--> statement-breakpoint
CREATE INDEX "campaign_recipients_campaign_status_idx" ON "app"."campaign_recipients" USING btree ("campaign_id","status");--> statement-breakpoint
CREATE INDEX "campaign_recipients_ws_email_idx" ON "app"."campaign_recipients" USING btree ("workspace_id","email_normalized");--> statement-breakpoint
CREATE INDEX "campaign_recipients_prospect_idx" ON "app"."campaign_recipients" USING btree ("prospect_id");--> statement-breakpoint
CREATE INDEX "campaigns_ws_status_idx" ON "app"."campaigns" USING btree ("workspace_id","status");--> statement-breakpoint
CREATE INDEX "campaigns_ws_created_idx" ON "app"."campaigns" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "campaigns_live_mailbox_idx" ON "app"."campaigns" USING btree ("mailbox_id") WHERE "app"."campaigns"."status" in ('SCHEDULED', 'ACTIVE', 'PAUSED');--> statement-breakpoint
CREATE INDEX "message_events_ws_type_idx" ON "app"."message_events" USING btree ("workspace_id","event_type","occurred_at");--> statement-breakpoint
CREATE INDEX "message_events_message_idx" ON "app"."message_events" USING btree ("message_id");--> statement-breakpoint
CREATE UNIQUE INDEX "messages_recipient_step_uq" ON "app"."messages" USING btree ("campaign_recipient_id","step_number") WHERE "app"."messages"."kind" = 'sequence';--> statement-breakpoint
CREATE INDEX "messages_executor_idx" ON "app"."messages" USING btree ("mailbox_id","scheduled_for") WHERE "app"."messages"."status" in ('PENDING', 'RETRY_WAIT');--> statement-breakpoint
CREATE INDEX "messages_lease_idx" ON "app"."messages" USING btree ("lease_expires_at") WHERE "app"."messages"."status" = 'SENDING';--> statement-breakpoint
CREATE INDEX "messages_reconciliation_idx" ON "app"."messages" USING btree ("reconciliation_next_at") WHERE "app"."messages"."status" = 'RECONCILIATION_REQUIRED';--> statement-breakpoint
CREATE INDEX "messages_operator_review_idx" ON "app"."messages" USING btree ("workspace_id","mailbox_id") WHERE "app"."messages"."status" = 'OPERATOR_REVIEW';--> statement-breakpoint
CREATE INDEX "messages_campaign_sent_idx" ON "app"."messages" USING btree ("campaign_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_mailbox_sent_idx" ON "app"."messages" USING btree ("mailbox_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_ws_sent_idx" ON "app"."messages" USING btree ("workspace_id","sent_at");--> statement-breakpoint
CREATE INDEX "messages_provider_thread_idx" ON "app"."messages" USING btree ("provider_thread_id");--> statement-breakpoint
CREATE INDEX "replies_thread_idx" ON "app"."replies" USING btree ("reply_thread_id","received_at");--> statement-breakpoint
CREATE INDEX "replies_ws_received_idx" ON "app"."replies" USING btree ("workspace_id","received_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reply_threads_ws_class_idx" ON "app"."reply_threads" USING btree ("workspace_id","classification","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "reply_threads_ws_campaign_idx" ON "app"."reply_threads" USING btree ("workspace_id","campaign_id","last_message_at" DESC NULLS LAST);--> statement-breakpoint
CREATE UNIQUE INDEX "jurisdiction_policies_scope_uq" ON "app"."jurisdiction_policies" USING btree (coalesce("workspace_id", '00000000-0000-0000-0000-000000000000'::uuid),"country_code",coalesce("region_code", ''));--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_ws_active_uq" ON "app"."suppressions" USING btree ("workspace_id","value_type","value_normalized") WHERE "app"."suppressions"."lifted_at" is null and "app"."suppressions"."scope" = 'workspace';--> statement-breakpoint
CREATE UNIQUE INDEX "suppressions_global_active_uq" ON "app"."suppressions" USING btree ("value_type","value_normalized") WHERE "app"."suppressions"."lifted_at" is null and "app"."suppressions"."scope" = 'global';--> statement-breakpoint
CREATE INDEX "suppressions_active_value_idx" ON "app"."suppressions" USING btree ("value_normalized") WHERE "app"."suppressions"."lifted_at" is null;--> statement-breakpoint
CREATE INDEX "suppressions_ws_created_idx" ON "app"."suppressions" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "unsubscribes_ws_occurred_idx" ON "app"."unsubscribes" USING btree ("workspace_id","occurred_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_ws_created_idx" ON "app"."audit_logs" USING btree ("workspace_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_entity_idx" ON "app"."audit_logs" USING btree ("entity_type","entity_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "audit_logs_actor_idx" ON "app"."audit_logs" USING btree ("actor_user_id","created_at" DESC NULLS LAST);--> statement-breakpoint
CREATE INDEX "webhook_events_pending_idx" ON "app"."webhook_events" USING btree ("status","received_at") WHERE "app"."webhook_events"."status" in ('received', 'failed');