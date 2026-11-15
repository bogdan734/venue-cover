-- Every authenticated API request: which key, the route template (never the address with its ids and query, which can
-- hold personal details), the status and how long it took. A developer reads their own program's; the operator, all.
create table request_log (
  id bigserial primary key,
  key_id text not null,
  program_id text,
  at timestamptz not null default clock_timestamp(),
  method text not null,
  route text not null,
  status integer not null,
  ms integer not null
);
create index request_log_program_at on request_log (program_id, at desc);
