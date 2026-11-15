import type { ColumnType, Generated } from 'kysely';
import type {
  AlcoholMode,
  Cents,
  Contacts,
  ConversationState,
  PricedRiskClass,
  ProgramRules,
  ProgramStatus,
  ProvinceCode,
  QuoteState,
  RiskClass,
  Scope,
  Theme,
} from '../domain/types.js';

// JSON columns are written as strings (JSON.stringify) and read back as parsed values.
type Json<T> = ColumnType<T, string, string>;
type Stamp = Generated<Date>;

interface BrokerTable {
  id: string;
  name: string;
  email: string;
}

interface ProgramTable {
  id: string;
  code: string;
  name: string;
  province: ProvinceCode;
  broker_id: string;
  loading_bps: number;
  commission_bps: number;
  fee_cents: Cents;
  status: Generated<ProgramStatus>;
  theme: Json<Theme> | null;
  contacts: Json<Contacts> | null;
  created_at: Stamp;
}

interface VenueTable {
  id: string;
  program_id: string;
  name: string;
  municipality: string;
  contact_email: string;
}

interface RentalTable {
  program_id: string;
  ref: string;
  venue_id: string;
}

interface CoverageProductTable {
  id: string;
  code: string;
  name: string;
  max_hours: number;
}

interface ActivityTable {
  id: string;
  product_id: string;
  title: string;
  risk_class: RiskClass;
  aliases: string[];
  search_text: string;
  embedding: string | null;
  embedding_model: string | null;
}

interface RateRowTable {
  id: string;
  product_id: string;
  risk_class: PricedRiskClass;
  limit_cents: Cents;
  alcohol: AlcoholMode;
  participants_min: number;
  participants_max: number;
  net_cents_per_hour: number;
  effective_from: string;
  effective_to: string | null;
}

interface ClassificationTable {
  id: string;
  program_id: string;
  masked_text: string;
  /** The originals behind the tags in `masked_text`, sealed; null when there were none. */
  vault: Generated<string | null>;
  facts: Json<unknown>;
  matches: Json<unknown>;
  risk_class: RiskClass | null;
  confidence: number;
  degraded: Generated<boolean>;
  created_at: Stamp;
}

interface QuoteTable {
  id: string;
  program_id: string;
  renter_id: Generated<string | null>;
  venue_id: string | null;
  product_id: string;
  activity_id: string;
  classification_id: string | null;
  state: QuoteState;
  input: Json<unknown>;
  premium: Json<unknown> | null;
  holder: Json<unknown>;
  details: Json<unknown> | null;
  booking_ref: string | null;
  created_at: Stamp;
  expires_at: Date;
}

interface SubmissionTable {
  id: string;
  program_id: string;
  state: 'incomplete' | 'needs_review' | 'ready';
  facts: Json<unknown>;
  missing: Json<unknown>;
  attachments: Json<unknown>;
  quote_id: string | null;
  created_at: Stamp;
}

interface ReferralTable {
  id: string;
  quote_id: string;
  reasons: string[];
  state: Generated<'open' | 'claimed' | 'decided'>;
  claimed_by: string | null;
  due_at: Date;
  created_at: Stamp;
  decided_at: Date | null;
  decision: Json<unknown> | null;
}

interface PolicyTable {
  id: string;
  quote_id: string;
  program_id: string;
  policy_number: string;
  starts_at: Date;
  ends_at: Date;
  total_cents: Cents;
  snapshot: Json<unknown>;
  issued_at: Stamp;
}

interface PolicyCounterTable {
  program_id: string;
  last_number: number;
}

interface OutboxEventTable {
  seq: Generated<number>;
  event_id: string;
  type: string;
  program_id: string;
  occurred_at: Date;
  data: Json<unknown>;
  processed_at: Date | null;
  attempts: Generated<number>;
  last_error: string | null;
}

interface WebhookEndpointTable {
  id: string;
  program_id: string;
  url: string;
  secret: string;
  events: string[];
  active: Generated<boolean>;
  created_at: Stamp;
}

interface WebhookDeliveryTable {
  id: string;
  endpoint_id: string;
  event_id: string;
  attempt: Generated<number>;
  state: Generated<'pending' | 'delivered' | 'dead'>;
  next_attempt_at: Date;
  last_status: number | null;
  last_error: string | null;
  created_at: Stamp;
}

interface ApiKeyTable {
  id: string;
  program_id: string | null;
  name: string;
  key_hash: string;
  scopes: Scope[];
  created_at: Stamp;
  revoked_at: Date | null;
}

interface IdempotencyKeyTable {
  principal_id: string;
  key: string;
  request_hash: string;
  response: Json<unknown> | null;
  created_at: Stamp;
}

interface SanctionsEntryTable {
  id: string;
  name: string;
  list_name: string;
}

interface LabelledExampleTable {
  id: string;
  text: string;
  activity_id: string | null;
  risk_class: RiskClass;
  source: 'golden' | 'underwriter';
  created_at: Stamp;
}

interface ProgramRulesTable {
  id: string;
  program_id: string;
  version: number;
  effective_from: string;
  rules: ColumnType<ProgramRules, string, string>;
  created_at: Stamp;
}

interface ClaimTable {
  id: string;
  policy_id: string;
  loss_date: string;
  description: string;
  reporter: Json<unknown>;
  created_at: Stamp;
}

interface RenterTable {
  id: string;
  email: string;
  name: string;
  password_hash: string;
  email_verified_at: Date | null;
  failed_logins: Generated<number>;
  locked_until: Date | null;
  created_at: Stamp;
}

interface RenterTokenTable {
  token_hash: string;
  renter_id: string;
  purpose: 'verify' | 'session';
  expires_at: Date;
  used_at: Date | null;
  created_at: Stamp;
}

export interface PseudonymTable {
  scope: string;
  tag: string;
  sealed: string;
  created_at: Stamp;
}

interface PortalVisitTable {
  program_id: string;
  day: string;
  visitors: Generated<number>;
}

interface AuditLogTable {
  id: string;
  at: Stamp;
  key_id: string;
  program_id: string | null;
  action: string;
  detail: Json<unknown>;
}

interface ConversationTable {
  id: string;
  program_id: string;
  channel: 'web' | 'telegram';
  external_id: string;
  secret_hash: string | null;
  renter_id: string | null;
  state: Generated<ConversationState>;
  context: ColumnType<Record<string, unknown>, string | undefined, string>;
  created_at: Stamp;
  updated_at: ColumnType<Date, Date | undefined, Date>;
}

interface MessageTable {
  id: string;
  conversation_id: string;
  sender: 'renter' | 'bot' | 'staff';
  text: string;
  vault: string | null;
  at: Stamp;
}

interface ProgramAccessTable {
  id: string;
  program_id: string;
  token_hash: string;
  label: string;
  created_at: Stamp;
  last_used_at: Date | null;
  revoked_at: Date | null;
}

interface RequestLogTable {
  id: Generated<string>;
  key_id: string;
  program_id: string | null;
  at: Stamp;
  method: string;
  route: string;
  status: number;
  ms: number;
}

export interface Database {
  pseudonym: PseudonymTable;
  broker: BrokerTable;
  program: ProgramTable;
  venue: VenueTable;
  rental: RentalTable;
  coverage_product: CoverageProductTable;
  activity: ActivityTable;
  rate_row: RateRowTable;
  classification: ClassificationTable;
  quote: QuoteTable;
  referral: ReferralTable;
  submission: SubmissionTable;
  policy: PolicyTable;
  policy_counter: PolicyCounterTable;
  outbox_event: OutboxEventTable;
  webhook_endpoint: WebhookEndpointTable;
  webhook_delivery: WebhookDeliveryTable;
  api_key: ApiKeyTable;
  idempotency_key: IdempotencyKeyTable;
  sanctions_entry: SanctionsEntryTable;
  labelled_example: LabelledExampleTable;
  program_rules: ProgramRulesTable;
  claim: ClaimTable;
  renter: RenterTable;
  renter_token: RenterTokenTable;
  portal_visit: PortalVisitTable;
  audit_log: AuditLogTable;
  conversation: ConversationTable;
  message: MessageTable;
  program_access: ProgramAccessTable;
  request_log: RequestLogTable;
}
