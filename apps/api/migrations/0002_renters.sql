-- People who buy cover on a portal. An account is the person's, across programs; partners still use API keys.
create table renter (
  id text primary key,
  -- stored lower-cased, so one address is one account however it is typed
  email text not null unique,
  name text not null,
  -- scrypt$N$r$p$salt$hash
  password_hash text not null,
  email_verified_at timestamptz,
  failed_logins integer not null default 0,
  locked_until timestamptz,
  created_at timestamptz not null default now()
);

-- Confirmation links and sessions. Only the SHA-256 of a token is stored; the token itself exists in the e-mail or the cookie.
create table renter_token (
  token_hash text primary key,
  renter_id text not null references renter (id) on delete cascade,
  purpose text not null check (purpose in ('verify', 'session')),
  expires_at timestamptz not null,
  -- set when a confirmation link is used or a session is signed out; either way the token stops working
  used_at timestamptz,
  created_at timestamptz not null default now()
);
create index renter_token_renter on renter_token (renter_id, purpose);

-- A quote made by a signed-in renter belongs to them.
alter table quote add column renter_id text references renter (id);
create index quote_renter on quote (renter_id) where renter_id is not null;
