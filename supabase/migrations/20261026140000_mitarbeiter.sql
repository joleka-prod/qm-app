-- Personal nach dem Vorbild der Ninox-Mitarbeiterdatenbank (Fabian, 2026-10-26): gleiche Reiter, Felder und
-- Untertabellen wie in Ninox. Ein Mitarbeiter muss keinen App-Benutzer haben (ehemalige, Langzeitkranke).
-- Sehen und pflegen dürfen nur der Admin und Benutzer mit dem Haken "Zugriff auf Personalakten".

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

-- ---------------------------------------------------------------- Mitarbeiter (Reiter "Mitarbeiter" und "Lohnkonzept")

create table if not exists public.employees (
  id bigint generated always as identity primary key,
  ninox_id text unique,
  user_id uuid unique references public.profiles (id) on delete set null,
  personnel_number text not null default '',
  status text not null default 'Aktiv',
  tax_class text not null default '',
  salutation text not null default '',
  first_name text not null default '',
  last_name text not null default '',
  mother_tongue text not null default '',
  birth_date date,
  marital_status text not null default '',
  -- Anschrift
  street text not null default '',
  house_no text not null default '',
  zip text not null default '',
  city text not null default '',
  phone_private text not null default '',
  mobile_private text not null default '',
  email_private text not null default '',
  -- Vertragsdaten
  vacation_days numeric(5, 1),
  entry_date date,
  department text not null default '',
  specific_experience text not null default '',
  -- Vermögenswirksame Leistungen
  vl_payment boolean not null default false,
  -- Arbeits- und Aufenthaltsgenehmigungen
  residence_title text not null default '',
  residence_valid_until date,
  -- Lohnkonzept: angekreuzte Punkte (Schlüssel -> true)
  wage_concept jsonb not null default '{}'::jsonb,
  -- Ninox-Felder ohne eigenes Feld in der App (Feldname -> Wert)
  extra jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid references public.profiles (id) on delete set null
);

create index if not exists employees_name_idx on public.employees (last_name, first_name);

-- Untertabellen (Kinder, Lohn und Gehalt, Prämien, Schulungen, Sicherheitsschuhe, Krankheitstage …):
-- eine Zeile je Eintrag, die Spalten je Art legt die App fest (src/lib/employee.ts)
create table if not exists public.employee_entries (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees (id) on delete cascade,
  kind text not null check (kind ~ '^[a-z0-9_]{1,40}$'),
  data jsonb not null default '{}'::jsonb,
  ninox_id text,
  created_at timestamptz not null default now()
);

create index if not exists employee_entries_emp_idx on public.employee_entries (employee_id, kind);

create or replace function public.employees_touch()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  return new;
end;
$$;

drop trigger if exists employees_touch on public.employees;
create trigger employees_touch
  before insert or update on public.employees
  for each row execute function public.employees_touch();

alter table public.employees enable row level security;
alter table public.employee_entries enable row level security;

drop policy if exists "Personal sieht Mitarbeiter" on public.employees;
drop policy if exists "Personal legt Mitarbeiter an" on public.employees;
drop policy if exists "Personal ändert Mitarbeiter" on public.employees;
drop policy if exists "Admin löscht Mitarbeiter" on public.employees;
create policy "Personal sieht Mitarbeiter" on public.employees for select to authenticated using (public.has_hr_access());
create policy "Personal legt Mitarbeiter an" on public.employees for insert to authenticated with check (public.has_hr_access());
create policy "Personal ändert Mitarbeiter" on public.employees for update to authenticated
  using (public.has_hr_access()) with check (public.has_hr_access());
create policy "Admin löscht Mitarbeiter" on public.employees for delete to authenticated using (public.is_admin());

drop policy if exists "Personal sieht Einträge" on public.employee_entries;
drop policy if exists "Personal legt Einträge an" on public.employee_entries;
drop policy if exists "Personal ändert Einträge" on public.employee_entries;
drop policy if exists "Personal löscht Einträge" on public.employee_entries;
create policy "Personal sieht Einträge" on public.employee_entries for select to authenticated using (public.has_hr_access());
create policy "Personal legt Einträge an" on public.employee_entries for insert to authenticated with check (public.has_hr_access());
create policy "Personal ändert Einträge" on public.employee_entries for update to authenticated
  using (public.has_hr_access()) with check (public.has_hr_access());
create policy "Personal löscht Einträge" on public.employee_entries for delete to authenticated using (public.has_hr_access());
