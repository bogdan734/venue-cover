-- A link that opens one program's client console: its figures, policies and conversations. The link is shown
-- once; only its hash is kept. Revoking it closes the console at once, because every visit asks again.
create table program_access (
  id text primary key,
  program_id text not null references program (id),
  token_hash text not null unique,
  label text not null,
  created_at timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at timestamptz
);
create index program_access_program on program_access (program_id, created_at desc);
