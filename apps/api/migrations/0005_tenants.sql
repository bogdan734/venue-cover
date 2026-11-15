-- A client program's place in its life (draft and test portals are for staff; paused stops new business), how its
-- portal looks and who its renters can reach. Programs that existed before this migration stay live.
alter table program
  add column status text not null default 'live' check (status in ('draft', 'test', 'live', 'paused')),
  add column theme jsonb,
  add column contacts jsonb;

-- Portal visitors per program and day. The web side counts each visitor once a day and sends no address or cookie.
create table portal_visit (
  program_id text not null references program (id),
  day date not null,
  visitors integer not null default 0,
  primary key (program_id, day)
);

-- Who changed what about a client program. `key_id` is the API key that made the change. The time is the clock's, not
-- the transaction's, so two changes made in one transaction still sort in the order they were made.
create table audit_log (
  id text primary key,
  at timestamptz not null default clock_timestamp(),
  key_id text not null,
  program_id text references program (id),
  action text not null,
  detail jsonb not null
);
create index audit_log_program_at on audit_log (program_id, at desc);
