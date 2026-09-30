CREATE TYPE "public"."agent_run_status" AS ENUM('running', 'completed', 'review_required', 'failed');--> statement-breakpoint
CREATE TYPE "public"."approval_status" AS ENUM('pending', 'approved', 'rejected', 'superseded');--> statement-breakpoint
CREATE TYPE "public"."document_status" AS ENUM('available', 'missing', 'partial', 'suspicious');--> statement-breakpoint
CREATE TYPE "public"."expense_status" AS ENUM('proposed', 'approved', 'review_required', 'rejected');--> statement-breakpoint
CREATE TYPE "public"."processing_status" AS ENUM('pending', 'processing', 'processed', 'review_required', 'failed');--> statement-breakpoint
CREATE TYPE "public"."tool_call_status" AS ENUM('running', 'completed', 'failed', 'rejected');--> statement-breakpoint
CREATE TABLE "agent_runs" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"model_provider" text NOT NULL,
	"model_name" text NOT NULL,
	"status" "agent_run_status" DEFAULT 'running' NOT NULL,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone,
	"ttft_ms" integer,
	"first_tool_call_ms" integer,
	"total_latency_ms" integer,
	"input_tokens" integer,
	"output_tokens" integer,
	"error_code" text
);
--> statement-breakpoint
CREATE TABLE "approvals" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"agent_run_id" text,
	"proposed_category" text NOT NULL,
	"proposed_gifi_code" text,
	"proposed_itc" numeric(14, 2) NOT NULL,
	"reason" text NOT NULL,
	"status" "approval_status" DEFAULT 'pending' NOT NULL,
	"created_by" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"resolved_at" timestamp with time zone,
	"resolution_notes" text
);
--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text,
	"receipt_id" text NOT NULL,
	"actor" text NOT NULL,
	"action" text NOT NULL,
	"input_hash" text NOT NULL,
	"result_hash" text NOT NULL,
	"rule_version" text NOT NULL,
	"model_provider" text,
	"model_name" text,
	"status" text NOT NULL,
	"metadata_json" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "companies" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"business_number" text NOT NULL,
	"gst_hst_number" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_rules" (
	"id" text PRIMARY KEY NOT NULL,
	"rule_key" text NOT NULL,
	"rule_version" text NOT NULL,
	"effective_from" timestamp NOT NULL,
	"effective_to" timestamp,
	"configuration" jsonb NOT NULL,
	"source_id" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "compliance_sources" (
	"id" text PRIMARY KEY NOT NULL,
	"authority" text NOT NULL,
	"title" text NOT NULL,
	"url" text NOT NULL,
	"retrieved_at" timestamp with time zone,
	"rule_version" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "expenses" (
	"id" text PRIMARY KEY NOT NULL,
	"receipt_id" text NOT NULL,
	"category" text NOT NULL,
	"gifi_code" text,
	"classification_confidence" numeric(5, 4),
	"itc_percentage" numeric(5, 4) NOT NULL,
	"gross_tax" numeric(14, 2) NOT NULL,
	"eligible_itc" numeric(14, 2) NOT NULL,
	"status" "expense_status" NOT NULL,
	"reason_code" text NOT NULL,
	"rule_version" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "gifi_codes" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL,
	"description" text NOT NULL,
	"category" text NOT NULL,
	"parent_category" text,
	"applicable_expense_types" jsonb DEFAULT '[]'::jsonb NOT NULL,
	"confidence" numeric(5, 4),
	"source" text NOT NULL,
	"active" boolean DEFAULT true NOT NULL
);
--> statement-breakpoint
CREATE TABLE "idempotency_keys" (
	"id" text PRIMARY KEY NOT NULL,
	"key" text NOT NULL,
	"operation" text NOT NULL,
	"receipt_id" text NOT NULL,
	"result_hash" text,
	"status" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone NOT NULL
);
--> statement-breakpoint
CREATE TABLE "receipts" (
	"id" text PRIMARY KEY NOT NULL,
	"company_id" text NOT NULL,
	"receipt_number" text NOT NULL,
	"vendor_name" text NOT NULL,
	"receipt_date" timestamp NOT NULL,
	"description" text NOT NULL,
	"subtotal" numeric(14, 2) NOT NULL,
	"tax_amount" numeric(14, 2) NOT NULL,
	"tax_type" text NOT NULL,
	"total" numeric(14, 2) NOT NULL,
	"gst_hst_number" text,
	"commercial_use_percentage" numeric(5, 2) NOT NULL,
	"document_status" "document_status" DEFAULT 'available' NOT NULL,
	"processing_status" "processing_status" DEFAULT 'pending' NOT NULL,
	"source_type" text DEFAULT 'seed' NOT NULL,
	"metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "selected_receipt_contexts" (
	"session_id" text NOT NULL,
	"company_id" text NOT NULL,
	"receipt_id" text,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "selected_receipt_contexts_session_id_company_id_pk" PRIMARY KEY("session_id","company_id")
);
--> statement-breakpoint
CREATE TABLE "tool_calls" (
	"id" text PRIMARY KEY NOT NULL,
	"agent_run_id" text NOT NULL,
	"tool_name" text NOT NULL,
	"input_json" jsonb NOT NULL,
	"output_json" jsonb,
	"status" "tool_call_status" DEFAULT 'running' NOT NULL,
	"latency_ms" integer,
	"error_code" text,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"completed_at" timestamp with time zone
);
--> statement-breakpoint
ALTER TABLE "agent_runs" ADD CONSTRAINT "agent_runs_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "approvals" ADD CONSTRAINT "approvals_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE restrict ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "compliance_rules" ADD CONSTRAINT "compliance_rules_source_id_compliance_sources_id_fk" FOREIGN KEY ("source_id") REFERENCES "public"."compliance_sources"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "gifi_codes_code_unique" ON "gifi_codes" USING btree ("code");--> statement-breakpoint
ALTER TABLE "expenses" ADD CONSTRAINT "expenses_gifi_code_gifi_codes_code_fk" FOREIGN KEY ("gifi_code") REFERENCES "public"."gifi_codes"("code") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "idempotency_keys" ADD CONSTRAINT "idempotency_keys_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "receipts" ADD CONSTRAINT "receipts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_receipt_contexts" ADD CONSTRAINT "selected_receipt_contexts_company_id_companies_id_fk" FOREIGN KEY ("company_id") REFERENCES "public"."companies"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "selected_receipt_contexts" ADD CONSTRAINT "selected_receipt_contexts_receipt_id_receipts_id_fk" FOREIGN KEY ("receipt_id") REFERENCES "public"."receipts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tool_calls" ADD CONSTRAINT "tool_calls_agent_run_id_agent_runs_id_fk" FOREIGN KEY ("agent_run_id") REFERENCES "public"."agent_runs"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "agent_runs_receipt_started_idx" ON "agent_runs" USING btree ("receipt_id","started_at");--> statement-breakpoint
CREATE INDEX "approvals_status_created_idx" ON "approvals" USING btree ("status","created_at");--> statement-breakpoint
CREATE INDEX "audit_events_receipt_created_idx" ON "audit_events" USING btree ("receipt_id","created_at");--> statement-breakpoint
CREATE UNIQUE INDEX "companies_business_number_unique" ON "companies" USING btree ("business_number");--> statement-breakpoint
CREATE UNIQUE INDEX "compliance_rules_key_version_unique" ON "compliance_rules" USING btree ("rule_key","rule_version");--> statement-breakpoint
CREATE INDEX "compliance_rules_active_idx" ON "compliance_rules" USING btree ("active","effective_from");--> statement-breakpoint
CREATE UNIQUE INDEX "expenses_receipt_unique" ON "expenses" USING btree ("receipt_id");--> statement-breakpoint
CREATE UNIQUE INDEX "idempotency_key_operation_unique" ON "idempotency_keys" USING btree ("key","operation");--> statement-breakpoint
CREATE UNIQUE INDEX "receipts_company_number_unique" ON "receipts" USING btree ("company_id","receipt_number");--> statement-breakpoint
CREATE INDEX "receipts_company_processing_idx" ON "receipts" USING btree ("company_id","processing_status");--> statement-breakpoint
CREATE INDEX "tool_calls_run_started_idx" ON "tool_calls" USING btree ("agent_run_id","started_at");