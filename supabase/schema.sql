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


-- ============================================================
-- NFT Studio: paid exports (run this part too, once)
-- ============================================================
create table if not exists public.studio_exports (
  id           bigint generated always as identity primary key,
  wallet       text   not null check (wallet ~ '^0x[0-9a-f]{40}$'),
  fingerprint  text   not null check (fingerprint ~ '^[0-9a-f]{64}$'),
  size         integer not null check (size between 1 and 100000),
  fee          numeric not null,
  chain_id     integer not null,
  tx_hash      text   not null check (tx_hash ~ '^0x[0-9a-f]{64}$'),
  message      text   not null,
  signature    text   not null,
  verified     boolean not null default false,
  reject_reason text,
  created_at   timestamptz not null default now(),
  verified_at  timestamptz
);
create unique index if not exists studio_exports_tx_unique on public.studio_exports (tx_hash);
create index if not exists studio_exports_lookup on public.studio_exports (wallet, fingerprint, verified);

alter table public.studio_exports enable row level security;

-- anyone can check whether a wallet has a verified payment for a collection version (payments are public on-chain anyway)
drop policy if exists "read verified exports" on public.studio_exports;
create policy "read verified exports" on public.studio_exports for select to anon using (verified);

drop policy if exists "insert unverified exports" on public.studio_exports;
create policy "insert unverified exports" on public.studio_exports for insert to anon
  with check (verified = false and verified_at is null and reject_reason is null);


-- ============================================================
-- Events directory (run this part too, once)
-- Visitors submit events as 'pending'. You approve them in events-admin.html
-- (or in Table Editor: set status to 'approved'). Only approved, upcoming events are public.
-- ============================================================
create table if not exists public.events (
  id          bigint generated always as identity primary key,
  title       text not null check (char_length(title) between 3 and 120),
  type        text not null check (type in ('Conference','Side event','Hackathon','Meetup','AMA / Space','Workshop','Other')),
  starts_on   date not null,
  ends_on     date not null,
  online      boolean not null default false,
  city        text check (char_length(city) <= 80),
  country     text check (char_length(country) <= 80),
  organizer   text not null check (char_length(organizer) between 2 and 80),
  url         text not null check (url ~* '^https://[^ ]{4,400}$'),
  description text not null check (char_length(description) between 10 and 600),
  contact     text check (char_length(contact) <= 80),
  status      text not null default 'pending' check (status in ('pending','approved','rejected')),
  featured    boolean not null default false,
  created_at  timestamptz not null default now(),
  constraint dates_ok check (ends_on >= starts_on and starts_on <= current_date + 800)
);
create unique index if not exists events_url_unique on public.events (lower(url));
create index if not exists events_public on public.events (status, starts_on);

alter table public.events enable row level security;

drop policy if exists "events read approved" on public.events;
create policy "events read approved" on public.events for select to anon
  using (status = 'approved' and ends_on >= current_date);

drop policy if exists "events submit pending" on public.events;
create policy "events submit pending" on public.events for insert to anon
  with check (status = 'pending' and featured = false);

-- you (a logged-in Supabase user) can see and change everything
drop policy if exists "events admin all" on public.events;
create policy "events admin all" on public.events for all to authenticated using (true) with check (true);

-- flood guard: refuse new submissions when more than 40 arrived in the last hour
create or replace function public.events_flood_guard() returns trigger language plpgsql as $$
begin
  if (select count(*) from public.events where created_at > now() - interval '1 hour') > 40 then
    raise exception 'Too many submissions right now, try again later';
  end if;
  return new;
end $$;
drop trigger if exists events_flood on public.events;
create trigger events_flood before insert on public.events for each row execute function public.events_flood_guard();

-- "Report this event" button
create table if not exists public.event_reports (
  id         bigint generated always as identity primary key,
  event_id   bigint not null references public.events(id) on delete cascade,
  reason     text check (char_length(reason) <= 200),
  created_at timestamptz not null default now()
);
alter table public.event_reports enable row level security;
drop policy if exists "reports insert" on public.event_reports;
create policy "reports insert" on public.event_reports for insert to anon with check (true);
drop policy if exists "reports admin" on public.event_reports;
create policy "reports admin" on public.event_reports for all to authenticated using (true) with check (true);
