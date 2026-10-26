-- Personalakte (Fabian, 2026-10-26): alle Personal- und Lohnstammdaten aus Ninox in der App, streng geschützt.
-- Sehen und pflegen dürfen nur der Admin und Benutzer mit dem Haken "Zugriff auf Personalakten"
-- (profiles.hr_access, nur der Admin vergibt ihn). Die Lohnabrechnung selbst bleibt in ADDISON;
-- die App liefert später die Bewegungsdaten als Export.

alter table public.profiles add column if not exists hr_access boolean not null default false;

create or replace function public.profiles_zz_hr_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin() and new.hr_access is distinct from old.hr_access then
    raise exception 'Den Zugriff auf Personalakten vergibt nur der Admin';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_zz_hr_guard on public.profiles;
create trigger profiles_zz_hr_guard
  before update on public.profiles
  for each row execute function public.profiles_zz_hr_guard();

create or replace function public.has_hr_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.profiles where id = auth.uid() and active and (role = 'admin' or hr_access))
$$;

-- ---------------------------------------------------------------- Akte

create table if not exists public.personnel_files (
  user_id uuid primary key references public.profiles (id) on delete restrict,
  personnel_number text not null default '',
  -- Person
  salutation text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  birth_name text not null default '',
  birth_date date,
  birth_place text not null default '',
  nationality text not null default '',
  -- Anschrift und Kontakt
  street text not null default '',
  zip text not null default '',
  city text not null default '',
  phone text not null default '',
  private_email text not null default '',
  emergency_contact text not null default '',
  -- Bank
  iban text not null default '',
  bic text not null default '',
  bank_name text not null default '',
  -- Steuer und Sozialversicherung
  tax_id text not null default '',
  tax_class text not null default '',
  child_allowance numeric(4, 1),
  confession text not null default '',
  social_security_number text not null default '',
  health_insurance text not null default '',
  disability text not null default '',
  -- Beschäftigung und Lohn
  entry_date date,
  exit_date date,
  job_title text not null default '',
  employment_type text not null default '',
  hourly_wage numeric(8, 2),
  monthly_salary numeric(10, 2),
  notes text not null default '',
  -- weitere Felder aus Ninox (Feldname -> Wert) und der unveränderte Ninox-Datensatz
  extra jsonb not null default '{}'::jsonb,
  source jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create unique index if not exists personnel_files_number_idx
  on public.personnel_files (personnel_number) where personnel_number <> '';

alter table public.personnel_files enable row level security;
drop policy if exists "Personal sieht Akten" on public.personnel_files;
drop policy if exists "Personal legt Akten an" on public.personnel_files;
drop policy if exists "Personal ändert Akten" on public.personnel_files;
drop policy if exists "Admin löscht Akten" on public.personnel_files;
create policy "Personal sieht Akten" on public.personnel_files for select to authenticated using (public.has_hr_access());
create policy "Personal legt Akten an" on public.personnel_files for insert to authenticated with check (public.has_hr_access());
create policy "Personal ändert Akten" on public.personnel_files for update to authenticated
  using (public.has_hr_access()) with check (public.has_hr_access());
create policy "Admin löscht Akten" on public.personnel_files for delete to authenticated using (public.is_admin());

-- Verlauf: wer hat wann welches Feld geändert (alter und neuer Wert)
create table if not exists public.personnel_log (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  actor uuid references public.profiles (id) on delete set null,
  at timestamptz not null default now(),
  kind text not null,
  changes jsonb not null default '{}'::jsonb
);
create index if not exists personnel_log_user_idx on public.personnel_log (user_id, at desc);

alter table public.personnel_log enable row level security;
drop policy if exists "Personal sieht Verlauf" on public.personnel_log;
create policy "Personal sieht Verlauf" on public.personnel_log for select to authenticated using (public.has_hr_access());

create or replace function public.personnel_files_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new) - 'updated_at' - 'updated_by' - 'source';
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' - 'updated_by' - 'source' else '{}'::jsonb end;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- upsert auf eine vorhandene Akte: protokolliert wird erst das folgende UPDATE
  if tg_op = 'INSERT' and exists (select 1 from public.personnel_files f where f.user_id = new.user_id) then
    return new;
  end if;
  for k in select jsonb_object_keys(v_new) loop
    if k <> 'user_id' and (v_new -> k) is distinct from (v_old -> k)
       and not (tg_op = 'INSERT' and (v_new -> k) in ('""'::jsonb, 'null'::jsonb, '{}'::jsonb)) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('alt', v_old -> k, 'neu', v_new -> k));
    end if;
  end loop;
  if v_changes <> '{}'::jsonb then
    insert into public.personnel_log (user_id, actor, kind, changes)
    values (new.user_id, auth.uid(), case when tg_op = 'INSERT' then 'angelegt' else 'geändert' end, v_changes);
  end if;
  return new;
end;
$$;

drop trigger if exists personnel_files_track on public.personnel_files;
create trigger personnel_files_track
  before insert or update on public.personnel_files
  for each row execute function public.personnel_files_track();

-- ---------------------------------------------------------------- Dokumente

insert into storage.buckets (id, name, public, file_size_limit)
values ('personnel-docs', 'personnel-docs', false, 20971520)
on conflict (id) do nothing;

create table if not exists public.personnel_documents (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete restrict,
  title text not null check (length(trim(title)) between 1 and 200),
  storage_path text not null unique,
  uploaded_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now()
);

alter table public.personnel_documents enable row level security;
drop policy if exists "Personal sieht Dokumente" on public.personnel_documents;
drop policy if exists "Personal legt Dokumente ab" on public.personnel_documents;
drop policy if exists "Personal löscht Dokumente" on public.personnel_documents;
create policy "Personal sieht Dokumente" on public.personnel_documents for select to authenticated using (public.has_hr_access());
create policy "Personal legt Dokumente ab" on public.personnel_documents for insert to authenticated
  with check (public.has_hr_access() and uploaded_by = auth.uid());
create policy "Personal löscht Dokumente" on public.personnel_documents for delete to authenticated using (public.has_hr_access());

drop policy if exists "Personal liest Personaldokumente" on storage.objects;
drop policy if exists "Personal lädt Personaldokumente hoch" on storage.objects;
drop policy if exists "Personal löscht Personaldokumente" on storage.objects;
create policy "Personal liest Personaldokumente" on storage.objects for select to authenticated
  using (bucket_id = 'personnel-docs' and public.has_hr_access());
create policy "Personal lädt Personaldokumente hoch" on storage.objects for insert to authenticated
  with check (bucket_id = 'personnel-docs' and public.has_hr_access());
create policy "Personal löscht Personaldokumente" on storage.objects for delete to authenticated
  using (bucket_id = 'personnel-docs' and public.has_hr_access());

create or replace function public.personnel_documents_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.personnel_log (user_id, actor, kind, changes)
    values (new.user_id, auth.uid(), 'dokument', jsonb_build_object('hochgeladen', new.title));
    return new;
  end if;
  insert into public.personnel_log (user_id, actor, kind, changes)
  values (old.user_id, auth.uid(), 'dokument', jsonb_build_object('gelöscht', old.title));
  return old;
end;
$$;

drop trigger if exists personnel_documents_log on public.personnel_documents;
create trigger personnel_documents_log
  after insert or delete on public.personnel_documents
  for each row execute function public.personnel_documents_log();
