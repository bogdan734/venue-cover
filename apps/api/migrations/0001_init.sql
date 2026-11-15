create extension if not exists vector;
create extension if not exists pg_trgm;

create table broker (
  id text primary key,
  name text not null,
  email text not null
);

create table program (
  id text primary key,
  code text not null unique,
  name text not null,
  province text not null check (province in ('AB','BC','MB','NB','NL','NS','NT','NU','ON','PE','QC','SK','YT')),
  broker_id text not null references broker (id),
  loading_bps integer not null check (loading_bps between 0 and 9000),
  commission_bps integer not null check (commission_bps between 0 and 9000),
  fee_cents integer not null check (fee_cents >= 0),
  created_at timestamptz not null default now(),
  check (commission_bps <= loading_bps)
);

create table venue (
  id text primary key,
  program_id text not null references program (id),
  name text not null,
  municipality text not null,
  contact_email text not null
);

-- A booking reference comes from the venue's own booking system; it ties a quote to a venue so that certificates can be routed.
create table rental (
  program_id text not null references program (id),
  ref text not null,
  venue_id text not null references venue (id),
  primary key (program_id, ref)
);

create table coverage_product (
  id text primary key,
  code text not null unique,
  name text not null,
  max_hours integer not null check (max_hours > 0)
);

create table activity (
  id text primary key,
  product_id text not null references coverage_product (id),
  title text not null,
  risk_class text not null check (risk_class in ('A', 'B', 'C', 'X')),
  aliases text[] not null default '{}',
  search_text text not null,
  embedding vector(384),
  -- which model made the vector: vectors of different models cannot be compared
  embedding_model text
);
create index activity_search_trgm on activity using gin (search_text gin_trgm_ops);
create index activity_embedding_hnsw on activity using hnsw (embedding vector_cosine_ops);

create table rate_row (
  id text primary key,
  product_id text not null references coverage_product (id),
  risk_class text not null check (risk_class in ('A', 'B', 'C')),
  limit_cents integer not null,
  alcohol text not null check (alcohol in ('none', 'served', 'sold')),
  participants_min integer not null,
  participants_max integer not null,
  net_cents_per_hour integer not null check (net_cents_per_hour > 0),
  effective_from date not null,
  effective_to date,
  check (participants_min <= participants_max),
  unique (product_id, risk_class, limit_cents, alcohol, participants_min, effective_from)
);

create table classification (
  id text primary key,
  program_id text not null references program (id),
  masked_text text not null,
  facts jsonb not null,
  matches jsonb not null,
  risk_class text check (risk_class in ('A', 'B', 'C', 'X')),
  confidence real not null,
  degraded boolean not null default false,
  created_at timestamptz not null default now()
);

create table quote (
  id text primary key,
  program_id text not null references program (id),
  venue_id text references venue (id),
  product_id text not null references coverage_product (id),
  activity_id text not null references activity (id),
  classification_id text references classification (id),
  state text not null check (state in ('quoted', 'referred', 'declined', 'bound', 'issued', 'expired')),
  input jsonb not null,
  premium jsonb,
  holder jsonb not null,
  details jsonb,
  booking_ref text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create table referral (
  id text primary key,
  quote_id text not null unique references quote (id),
  reasons text[] not null,
  state text not null default 'open' check (state in ('open', 'claimed', 'decided')),
  claimed_by text,
  due_at timestamptz not null,
  created_at timestamptz not null default now(),
  decided_at timestamptz,
  decision jsonb
);
create index referral_open on referral (due_at) where state <> 'decided';

create table policy (
  id text primary key,
  quote_id text not null unique references quote (id),
  program_id text not null references program (id),
  policy_number text not null unique,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  total_cents integer not null,
  snapshot jsonb not null,
  issued_at timestamptz not null default now()
);

create table policy_counter (
  program_id text primary key references program (id),
  last_number integer not null
);

create table outbox_event (
  seq integer generated always as identity primary key,
  event_id uuid not null unique,
  type text not null,
  program_id text not null,
  occurred_at timestamptz not null,
  data jsonb not null,
  processed_at timestamptz,
  attempts integer not null default 0,
  last_error text
);
create index outbox_pending on outbox_event (seq) where processed_at is null;

create table webhook_endpoint (
  id text primary key,
  program_id text not null references program (id),
  url text not null,
  secret text not null,
  events text[] not null,
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table webhook_delivery (
  id text primary key,
  endpoint_id text not null references webhook_endpoint (id),
  event_id uuid not null,
  attempt integer not null default 0,
  state text not null default 'pending' check (state in ('pending', 'delivered', 'dead')),
  next_attempt_at timestamptz not null,
  last_status integer,
  last_error text,
  created_at timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
create index webhook_delivery_due on webhook_delivery (next_attempt_at) where state = 'pending';

create table api_key (
  id text primary key,
  program_id text references program (id),
  name text not null,
  key_hash text not null unique,
  scopes text[] not null,
  created_at timestamptz not null default now(),
  revoked_at timestamptz
);

create table idempotency_key (
  principal_id text not null,
  key text not null,
  request_hash text not null,
  response jsonb,
  created_at timestamptz not null default now(),
  primary key (principal_id, key)
);

create table sanctions_entry (
  id text primary key,
  name text not null,
  list_name text not null
);
create index sanctions_name_trgm on sanctions_entry using gin (name gin_trgm_ops);

create table labelled_example (
  id text primary key,
  text text not null,
  activity_id text references activity (id),
  risk_class text not null check (risk_class in ('A', 'B', 'C', 'X')),
  source text not null check (source in ('golden', 'underwriter')),
  created_at timestamptz not null default now()
);

create table program_rules (
  id text primary key,
  program_id text not null references program (id),
  version integer not null,
  effective_from date not null,
  rules jsonb not null,
  created_at timestamptz not null default now(),
  unique (program_id, version),
  unique (program_id, effective_from)
);

create table claim (
  id text primary key,
  policy_id text not null references policy (id),
  loss_date date not null,
  description text not null,
  reporter jsonb not null,
  created_at timestamptz not null default now()
);

create table submission (
  id text primary key,
  program_id text not null references program (id),
  state text not null check (state in ('incomplete', 'needs_review', 'ready')),
  facts jsonb not null,
  missing jsonb not null,
  attachments jsonb not null,
  quote_id text references quote (id),
  created_at timestamptz not null default now()
);
