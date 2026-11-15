-- A renter's conversation with a program, on the portal or in Telegram. The bot answers while it can; a person takes it
-- over when asked, for a claim, or when the bot cannot help. `context` is what the person needs to pick it up.
create table conversation (
  id text primary key,
  program_id text not null references program (id),
  channel text not null check (channel in ('web', 'telegram')),
  -- The Telegram chat id, or a random handle for the web.
  external_id text not null,
  -- The web chat proves it is the same browser with a secret; only its hash is kept.
  secret_hash text,
  renter_id text references renter (id),
  state text not null default 'bot' check (state in ('bot', 'waiting', 'human', 'closed')),
  context jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (program_id, channel, external_id)
);
create index conversation_state_updated on conversation (state, updated_at desc);

-- Each line as written, with personal details replaced by tags; the originals are sealed with the program's key and
-- the message id, like a description's.
create table message (
  id text primary key,
  conversation_id text not null references conversation (id),
  sender text not null check (sender in ('renter', 'bot', 'staff')),
  text text not null,
  vault text,
  at timestamptz not null default clock_timestamp()
);
create index message_conversation_at on message (conversation_id, at);
