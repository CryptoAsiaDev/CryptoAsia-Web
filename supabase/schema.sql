-- Crypto Asia jobs board: run this once in Supabase → SQL Editor → New query → Run.

create table if not exists public.submissions (
  id           bigint generated always as identity primary key,
  kind         text   not null check (kind in ('profile','job','seeker')),
  wallet       text   not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  role         text   not null check (role in ('employer','seeker')),
  data         jsonb  not null,
  chain_id     integer,
  tx_hash      text   check (tx_hash is null or tx_hash ~ '^0x[0-9a-f]{64}$'),
  message      text   not null,
  signature    text   not null,
  verified     boolean not null default false,
  hidden       boolean not null default false,      -- set to true in the dashboard to take a listing down
  reject_reason text,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz,
  expires_at   timestamptz,
  constraint data_size check (pg_column_size(data) < 6000)
);

-- one payment can only ever be used once
create unique index if not exists submissions_tx_unique on public.submissions (tx_hash) where tx_hash is not null;
create index if not exists submissions_public on public.submissions (kind, verified, hidden, created_at desc);

alter table public.submissions enable row level security;

-- anyone can read listings that passed verification and are not hidden or expired
drop policy if exists "read verified" on public.submissions;
create policy "read verified" on public.submissions for select to anon
  using (verified and not hidden and (expires_at is null or expires_at > now()));

-- anyone can submit, but only as unverified; the verifier (service key) is the only thing that can verify
drop policy if exists "insert unverified" on public.submissions;
create policy "insert unverified" on public.submissions for insert to anon
  with check (verified = false and hidden = false and verified_at is null and expires_at is null and reject_reason is null);

-- no update or delete policy for anon: nobody on the website can change or remove rows
