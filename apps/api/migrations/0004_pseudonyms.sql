-- What each tag given to a key without personal:read stands for, sealed with its program's key, so that a tag handed
-- back (an agent quoting for the same person) can be turned into the value again. `scope` is the program, or 'platform'.
create table pseudonym (
  scope text not null,
  tag text not null,
  sealed text not null,
  created_at timestamptz not null default now(),
  primary key (scope, tag)
);
