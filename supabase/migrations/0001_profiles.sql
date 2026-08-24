-- Unified auth: one profiles row per Supabase auth user, carrying the role
-- picked at signup (buyer / seller / driver) and the fields specific to it.
--
-- This is deliberately a NEW, separate identity system from the existing
-- SQLite buyers/farmers/drivers tables in packages/core — see
-- supabase/README.md for why, and what still needs deciding before this
-- becomes the only identity system in the product.

create type public.app_role as enum ('buyer', 'seller', 'driver');
create type public.verification_status as enum ('pending', 'verified', 'rejected');

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  role public.app_role not null,
  full_name text not null,
  phone text,

  -- buyer-only
  company text,

  -- driver-only
  vehicle_class text,
  license_number text,
  license_photo_path text, -- path within the driver-licenses bucket, not a public URL
  verification_status public.verification_status,

  created_at timestamptz not null default now()
);

-- A driver's verification status defaults to 'pending' the moment the row
-- exists — never null-then-forgotten, never defaulted to something that
-- reads as cleared. Buyers/sellers simply never get this column set.
create or replace function public.set_driver_verification_default()
returns trigger
language plpgsql
as $$
begin
  if new.role = 'driver' and new.verification_status is null then
    new.verification_status := 'pending';
  end if;
  return new;
end;
$$;

create trigger profiles_driver_verification_default
  before insert on public.profiles
  for each row execute function public.set_driver_verification_default();

-- Standard Supabase pattern: a profile is created atomically with the auth
-- user via a trigger on auth.users, reading the metadata the client passed
-- to supabase.auth.signUp({ options: { data: { ... } } }). This avoids a
-- window where an auth user exists but has no profile yet.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
  insert into public.profiles (id, role, full_name, phone, company, vehicle_class, license_number)
  values (
    new.id,
    (new.raw_user_meta_data ->> 'role')::public.app_role,
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    new.raw_user_meta_data ->> 'phone',
    new.raw_user_meta_data ->> 'company',
    new.raw_user_meta_data ->> 'vehicle_class',
    new.raw_user_meta_data ->> 'license_number'
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- Row-level security: a profile is visible and editable only by the person
-- it belongs to. No cross-account reads — a buyer cannot list drivers'
-- license numbers, a driver cannot read another driver's verification
-- status.
alter table public.profiles enable row level security;

create policy "profiles are readable by their owner"
  on public.profiles for select
  using (auth.uid() = id);

create policy "profiles are updatable by their owner"
  on public.profiles for update
  using (auth.uid() = id);

-- No insert/delete policy: rows are created only by the handle_new_user
-- trigger (security definer, bypasses RLS) and deleted only via the
-- auth.users cascade. A client should never insert or delete a profile
-- directly.

-- ── Storage: driver license photos ──────────────────────────────────────
-- Private bucket — license photos are never publicly readable. A driver
-- can upload/read only their own file, keyed by their own auth uid as the
-- path prefix (enforced below, not just by convention).
insert into storage.buckets (id, name, public)
values ('driver-licenses', 'driver-licenses', false);

create policy "drivers can upload their own license photo"
  on storage.objects for insert
  with check (
    bucket_id = 'driver-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
  );

create policy "drivers can read their own license photo"
  on storage.objects for select
  using (
    bucket_id = 'driver-licenses'
    and (storage.foldername(name))[1] = auth.uid()::text
  );
