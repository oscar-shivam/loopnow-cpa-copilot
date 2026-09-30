import {
  boolean,
  index,
  integer,
  jsonb,
  numeric,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const documentStatusValues = ["available", "missing", "partial", "suspicious"] as const;
export const processingStatusValues = ["pending", "processing", "processed", "review_required", "failed"] as const;
export const expenseStatusValues = ["proposed", "approved", "review_required", "rejected"] as const;
export const approvalStatusValues = ["pending", "approved", "rejected", "superseded"] as const;
export const agentRunStatusValues = ["running", "completed", "review_required", "failed"] as const;
export const toolCallStatusValues = ["running", "completed", "failed", "rejected"] as const;

export const documentStatusEnum = pgEnum("document_status", documentStatusValues);
export const processingStatusEnum = pgEnum("processing_status", processingStatusValues);
export const expenseStatusEnum = pgEnum("expense_status", expenseStatusValues);
export const approvalStatusEnum = pgEnum("approval_status", approvalStatusValues);
export const agentRunStatusEnum = pgEnum("agent_run_status", agentRunStatusValues);
export const toolCallStatusEnum = pgEnum("tool_call_status", toolCallStatusValues);

const createdAt = timestamp("created_at", { withTimezone: true }).defaultNow().notNull();
const updatedAt = timestamp("updated_at", { withTimezone: true }).defaultNow().notNull();

export const companies = pgTable(
  "companies",
  {
    id: text("id").primaryKey(),
    name: text("name").notNull(),
    businessNumber: text("business_number").notNull(),
    gstHstNumber: text("gst_hst_number"),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("companies_business_number_unique").on(table.businessNumber)],
);

export const receipts = pgTable(
  "receipts",
  {
    id: text("id").primaryKey(),
    companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
    receiptNumber: text("receipt_number").notNull(),
    vendorName: text("vendor_name").notNull(),
    receiptDate: timestamp("receipt_date", { withTimezone: false }).notNull(),
    description: text("description").notNull(),
    subtotal: numeric("subtotal", { precision: 14, scale: 2 }).notNull(),
    taxAmount: numeric("tax_amount", { precision: 14, scale: 2 }).notNull(),
    taxType: text("tax_type").notNull(),
    total: numeric("total", { precision: 14, scale: 2 }).notNull(),
    gstHstNumber: text("gst_hst_number"),
    commercialUsePercentage: numeric("commercial_use_percentage", { precision: 5, scale: 2 }).notNull(),
    documentStatus: documentStatusEnum("document_status").notNull().default("available"),
    processingStatus: processingStatusEnum("processing_status").notNull().default("pending"),
    sourceType: text("source_type").notNull().default("seed"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
    updatedAt,
  },
  (table) => [
    uniqueIndex("receipts_company_number_unique").on(table.companyId, table.receiptNumber),
    index("receipts_company_processing_idx").on(table.companyId, table.processingStatus),
  ],
);

export const gifiCodes = pgTable(
  "gifi_codes",
  {
    id: text("id").primaryKey(),
    code: text("code").notNull(),
    description: text("description").notNull(),
    category: text("category").notNull(),
    parentCategory: text("parent_category"),
    applicableExpenseTypes: jsonb("applicable_expense_types").$type<string[]>().notNull().default([]),
    confidence: numeric("confidence", { precision: 5, scale: 4 }),
    source: text("source").notNull(),
    active: boolean("active").notNull().default(true),
  },
  (table) => [uniqueIndex("gifi_codes_code_unique").on(table.code)],
);

export const complianceSources = pgTable("compliance_sources", {
  id: text("id").primaryKey(),
  authority: text("authority").notNull(),
  title: text("title").notNull(),
  url: text("url").notNull(),
  retrievedAt: timestamp("retrieved_at", { withTimezone: true }),
  ruleVersion: text("rule_version").notNull(),
});

export const complianceRules = pgTable(
  "compliance_rules",
  {
    id: text("id").primaryKey(),
    ruleKey: text("rule_key").notNull(),
    ruleVersion: text("rule_version").notNull(),
    effectiveFrom: timestamp("effective_from", { withTimezone: false }).notNull(),
    effectiveTo: timestamp("effective_to", { withTimezone: false }),
    configuration: jsonb("configuration").$type<Record<string, unknown>>().notNull(),
    sourceId: text("source_id").notNull().references(() => complianceSources.id),
    active: boolean("active").notNull().default(true),
    createdAt,
  },
  (table) => [
    uniqueIndex("compliance_rules_key_version_unique").on(table.ruleKey, table.ruleVersion),
    index("compliance_rules_active_idx").on(table.active, table.effectiveFrom),
  ],
);

export const agentRuns = pgTable(
  "agent_runs",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "restrict" }),
    modelProvider: text("model_provider").notNull(),
    modelName: text("model_name").notNull(),
    status: agentRunStatusEnum("status").notNull().default("running"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    ttftMs: integer("ttft_ms"),
    firstToolCallMs: integer("first_tool_call_ms"),
    totalLatencyMs: integer("total_latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    errorCode: text("error_code"),
  },
  (table) => [index("agent_runs_receipt_started_idx").on(table.receiptId, table.startedAt)],
);

export const expenses = pgTable(
  "expenses",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    category: text("category").notNull(),
    gifiCode: text("gifi_code").references(() => gifiCodes.code),
    classificationConfidence: numeric("classification_confidence", { precision: 5, scale: 4 }),
    itcPercentage: numeric("itc_percentage", { precision: 5, scale: 4 }).notNull(),
    grossTax: numeric("gross_tax", { precision: 14, scale: 2 }).notNull(),
    eligibleItc: numeric("eligible_itc", { precision: 14, scale: 2 }).notNull(),
    status: expenseStatusEnum("status").notNull(),
    reasonCode: text("reason_code").notNull(),
    ruleVersion: text("rule_version").notNull(),
    createdAt,
    updatedAt,
  },
  (table) => [uniqueIndex("expenses_receipt_unique").on(table.receiptId)],
);

export const toolCalls = pgTable(
  "tool_calls",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id").notNull().references(() => agentRuns.id, { onDelete: "cascade" }),
    toolName: text("tool_name").notNull(),
    input: jsonb("input_json").$type<Record<string, unknown>>().notNull(),
    output: jsonb("output_json").$type<Record<string, unknown>>(),
    status: toolCallStatusEnum("status").notNull().default("running"),
    latencyMs: integer("latency_ms"),
    errorCode: text("error_code"),
    startedAt: timestamp("started_at", { withTimezone: true }).defaultNow().notNull(),
    completedAt: timestamp("completed_at", { withTimezone: true }),
  },
  (table) => [index("tool_calls_run_started_idx").on(table.agentRunId, table.startedAt)],
);

export const auditEvents = pgTable(
  "audit_events",
  {
    id: text("id").primaryKey(),
    agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "restrict" }),
    actor: text("actor").notNull(),
    action: text("action").notNull(),
    inputHash: text("input_hash").notNull(),
    resultHash: text("result_hash").notNull(),
    ruleVersion: text("rule_version").notNull(),
    modelProvider: text("model_provider"),
    modelName: text("model_name"),
    status: text("status").notNull(),
    metadata: jsonb("metadata_json").$type<Record<string, unknown>>().notNull().default({}),
    createdAt,
  },
  (table) => [index("audit_events_receipt_created_idx").on(table.receiptId, table.createdAt)],
);

export const approvals = pgTable(
  "approvals",
  {
    id: text("id").primaryKey(),
    receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    agentRunId: text("agent_run_id").references(() => agentRuns.id, { onDelete: "set null" }),
    proposedCategory: text("proposed_category").notNull(),
    proposedGifiCode: text("proposed_gifi_code"),
    proposedItc: numeric("proposed_itc", { precision: 14, scale: 2 }).notNull(),
    reason: text("reason").notNull(),
    status: approvalStatusEnum("status").notNull().default("pending"),
    createdBy: text("created_by").notNull(),
    createdAt,
    resolvedAt: timestamp("resolved_at", { withTimezone: true }),
    resolutionNotes: text("resolution_notes"),
  },
  (table) => [index("approvals_status_created_idx").on(table.status, table.createdAt)],
);

export const idempotencyKeys = pgTable(
  "idempotency_keys",
  {
    id: text("id").primaryKey(),
    key: text("key").notNull(),
    operation: text("operation").notNull(),
    receiptId: text("receipt_id").notNull().references(() => receipts.id, { onDelete: "cascade" }),
    resultHash: text("result_hash"),
    status: text("status").notNull(),
    createdAt,
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  },
  (table) => [uniqueIndex("idempotency_key_operation_unique").on(table.key, table.operation)],
);

export const selectedReceiptContexts = pgTable("selected_receipt_contexts", {
  sessionId: text("session_id").notNull(),
  companyId: text("company_id").notNull().references(() => companies.id, { onDelete: "cascade" }),
  receiptId: text("receipt_id").references(() => receipts.id, { onDelete: "set null" }),
  updatedAt,
}, (table) => [primaryKey({ columns: [table.sessionId, table.companyId] })]);
