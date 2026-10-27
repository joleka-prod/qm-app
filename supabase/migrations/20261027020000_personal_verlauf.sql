-- Verlauf der Personalakte (Fabian, 2026-10-27): jede Änderung mit Datum, Uhrzeit und Benutzer.
-- Erfasst werden die Akte selbst, alle Untertabellen, der App-Benutzer (Rolle, Login, Urlaub …)
-- sowie Chip und PIN. Geschrieben wird nur über Trigger; lesen dürfen Admin und Personalabteilung.

create table if not exists public.employee_log (
  id bigint generated always as identity primary key,
  employee_id bigint not null references public.employees (id) on delete cascade,
  at timestamptz not null default now(),
  actor uuid references public.profiles (id) on delete set null,
  -- Name zum Zeitpunkt der Änderung (bleibt lesbar, auch wenn der Benutzer gelöscht wird)
  actor_name text not null default '',
  action text not null,
  area text,
  changes jsonb not null default '{}'::jsonb
);

create index if not exists employee_log_emp_idx on public.employee_log (employee_id, at desc);

alter table public.employee_log enable row level security;
drop policy if exists "Personal sieht Verlauf" on public.employee_log;
create policy "Personal sieht Verlauf" on public.employee_log for select to authenticated using (public.has_hr_access());

create or replace function public.employee_log_write(p_employee bigint, p_action text, p_area text, p_changes jsonb)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if current_setting('app.employee_merge', true) = '1' and p_action <> 'zusammengeführt' and p_action <> 'geändert' then
    return;
  end if;
  insert into public.employee_log (employee_id, actor, actor_name, action, area, changes)
  values (
    p_employee,
    auth.uid(),
    coalesce((select nullif(full_name, '') from public.profiles where id = auth.uid()),
             (select email from public.profiles where id = auth.uid()),
             'System'),
    p_action, p_area, coalesce(p_changes, '{}'::jsonb)
  );
end;
$$;

-- Unterschiede zweier Datensätze als {feld: {alt, neu}}; Weitere Felder je Unterfeld
create or replace function public.employee_diff(p_old jsonb, p_new jsonb, p_skip text[])
returns jsonb
language plpgsql
immutable
set search_path = ''
as $$
declare
  v jsonb := '{}'::jsonb;
  k text;
begin
  for k in select distinct key from (select jsonb_object_keys(coalesce(p_old, '{}'::jsonb)) as key
                                      union select jsonb_object_keys(coalesce(p_new, '{}'::jsonb))) x loop
    continue when k = any (p_skip);
    if k = 'extra' and jsonb_typeof(coalesce(p_old -> k, p_new -> k)) = 'object' then
      v := v || coalesce((
        select jsonb_object_agg('extra.' || e.key, jsonb_build_object('alt', p_old -> 'extra' -> e.key, 'neu', p_new -> 'extra' -> e.key))
        from (select jsonb_object_keys(coalesce(p_old -> 'extra', '{}'::jsonb)) as key
              union select jsonb_object_keys(coalesce(p_new -> 'extra', '{}'::jsonb))) e
        where (p_old -> 'extra' -> e.key) is distinct from (p_new -> 'extra' -> e.key)
      ), '{}'::jsonb);
    elsif (p_old -> k) is distinct from (p_new -> k) then
      v := v || jsonb_build_object(k, jsonb_build_object('alt', p_old -> k, 'neu', p_new -> k));
    end if;
  end loop;
  return v;
end;
$$;

-- Akte
create or replace function public.employees_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
begin
  if tg_op = 'INSERT' then
    perform public.employee_log_write(new.id, 'angelegt', null,
      public.employee_diff('{}'::jsonb,
        (select coalesce(jsonb_object_agg(key, value), '{}'::jsonb) from jsonb_each(to_jsonb(new))
         where value not in ('null'::jsonb, '""'::jsonb, 'false'::jsonb, '{}'::jsonb)),
        array['id', 'created_at', 'updated_at', 'updated_by']));
    return new;
  end if;
  v := public.employee_diff(to_jsonb(old), to_jsonb(new), array['id', 'created_at', 'updated_at', 'updated_by']);
  if v <> '{}'::jsonb then
    perform public.employee_log_write(new.id, 'geändert', null, v);
  end if;
  return new;
end;
$$;

drop trigger if exists employees_log on public.employees;
create trigger employees_log
  after insert or update on public.employees
  for each row execute function public.employees_log();

-- Untertabellen
create or replace function public.employee_entries_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    perform public.employee_log_write(new.employee_id, 'eintrag_neu', new.kind, public.employee_diff('{}'::jsonb, new.data, '{}'));
    return new;
  elsif tg_op = 'DELETE' then
    -- Akte selbst wird gelöscht: kein Eintrag (Verlauf geht mit)
    if exists (select 1 from public.employees where id = old.employee_id) then
      perform public.employee_log_write(old.employee_id, 'eintrag_gelöscht', old.kind, public.employee_diff(old.data, '{}'::jsonb, '{}'));
    end if;
    return old;
  end if;
  if old.data is distinct from new.data and old.employee_id = new.employee_id then
    perform public.employee_log_write(new.employee_id, 'eintrag_geändert', new.kind, public.employee_diff(old.data, new.data, '{}'));
  end if;
  return new;
end;
$$;

drop trigger if exists employee_entries_log on public.employee_entries;
create trigger employee_entries_log
  after insert or update or delete on public.employee_entries
  for each row execute function public.employee_entries_log();

-- App-Benutzer des Mitarbeiters
create or replace function public.profiles_employee_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v jsonb;
  e bigint;
begin
  select id into e from public.employees where user_id = new.id;
  if e is null then
    return new;
  end if;
  v := public.employee_diff(to_jsonb(old), to_jsonb(new), array['id', 'created_at']);
  if v <> '{}'::jsonb then
    perform public.employee_log_write(e, 'benutzer_geändert', null, v);
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_employee_log on public.profiles;
create trigger profiles_employee_log
  after update on public.profiles
  for each row execute function public.profiles_employee_log();

-- Chip und PIN (PIN nur "geändert", nie der Wert)
create or replace function public.terminal_credentials_employee_log()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  e bigint;
  v jsonb := '{}'::jsonb;
begin
  r := case when tg_op = 'DELETE' then old else new end;
  select id into e from public.employees where user_id = r.user_id;
  if e is null then
    return r;
  end if;
  if tg_op = 'DELETE' then
    v := jsonb_build_object('badge_uid', jsonb_build_object('alt', old.badge_uid, 'neu', null));
  else
    if tg_op = 'INSERT' or old.badge_uid is distinct from new.badge_uid then
      v := v || jsonb_build_object('badge_uid', jsonb_build_object('alt', case when tg_op = 'UPDATE' then old.badge_uid end, 'neu', new.badge_uid));
    end if;
    if (tg_op = 'INSERT' and new.pin_hash is not null) or (tg_op = 'UPDATE' and old.pin_hash is distinct from new.pin_hash) then
      v := v || jsonb_build_object('pin', jsonb_build_object('alt', null, 'neu', case when new.pin_hash is null then 'entfernt' else 'neu gesetzt' end));
    end if;
  end if;
  if v <> '{}'::jsonb then
    perform public.employee_log_write(e, 'benutzer_geändert', null, v);
  end if;
  return r;
end;
$$;

drop trigger if exists terminal_credentials_employee_log on public.terminal_credentials;
create trigger terminal_credentials_employee_log
  after insert or update of badge_uid, pin_hash or delete on public.terminal_credentials
  for each row execute function public.terminal_credentials_employee_log();

-- Zusammenführen: Verlauf der aufgelösten Akte übernehmen und den Vorgang selbst vermerken
create or replace function public.merge_employees(p_keep bigint, p_drop bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  d public.employees;
  v_user uuid;
begin
  if not public.has_hr_access() then
    raise exception 'Nur für die Personalabteilung';
  end if;
  if p_keep = p_drop then
    raise exception 'Bitte zwei verschiedene Mitarbeiter wählen';
  end if;
  select * into d from public.employees where id = p_drop for update;
  if not found or not exists (select 1 from public.employees where id = p_keep) then
    raise exception 'Mitarbeiter nicht gefunden';
  end if;

  perform set_config('app.employee_merge', '1', true);
  update public.employee_log set employee_id = p_keep where employee_id = p_drop;

  update public.employee_entries set employee_id = p_keep where employee_id = p_drop;
  delete from public.employee_entries e
  using public.employee_entries o
  where e.employee_id = p_keep and o.employee_id = p_keep
    and e.kind = o.kind and e.data = o.data and e.id > o.id;

  v_user := d.user_id;
  update public.employees set user_id = null where id = p_drop;

  update public.employees k set
    personnel_number = case when k.personnel_number = '' then d.personnel_number else k.personnel_number end,
    status = case when k.status = '' then d.status else k.status end,
    tax_class = case when k.tax_class = '' then d.tax_class else k.tax_class end,
    salutation = case when k.salutation = '' then d.salutation else k.salutation end,
    first_name = case when k.first_name = '' then d.first_name else k.first_name end,
    last_name = case when k.last_name = '' then d.last_name else k.last_name end,
    mother_tongue = case when k.mother_tongue = '' then d.mother_tongue else k.mother_tongue end,
    marital_status = case when k.marital_status = '' then d.marital_status else k.marital_status end,
    street = case when k.street = '' then d.street else k.street end,
    house_no = case when k.house_no = '' then d.house_no else k.house_no end,
    zip = case when k.zip = '' then d.zip else k.zip end,
    city = case when k.city = '' then d.city else k.city end,
    phone_private = case when k.phone_private = '' then d.phone_private else k.phone_private end,
    mobile_private = case when k.mobile_private = '' then d.mobile_private else k.mobile_private end,
    email_private = case when k.email_private = '' then d.email_private else k.email_private end,
    department = case when k.department = '' then d.department else k.department end,
    specific_experience = case when k.specific_experience = '' then d.specific_experience else k.specific_experience end,
    residence_title = case when k.residence_title = '' then d.residence_title else k.residence_title end,
    birth_date = coalesce(k.birth_date, d.birth_date),
    vacation_days = coalesce(k.vacation_days, d.vacation_days),
    entry_date = coalesce(k.entry_date, d.entry_date),
    residence_valid_until = coalesce(k.residence_valid_until, d.residence_valid_until),
    vl_payment = k.vl_payment or d.vl_payment,
    wage_concept = d.wage_concept || k.wage_concept,
    extra = d.extra || k.extra,
    user_id = coalesce(k.user_id, v_user)
  where k.id = p_keep;

  perform public.employee_log_write(p_keep, 'zusammengeführt', null, jsonb_build_object(
    'akte', jsonb_build_object('alt', trim(d.first_name || ' ' || d.last_name) || coalesce(' (Nr. ' || nullif(d.personnel_number, '') || ')', ''), 'neu', null)));

  delete from public.employees where id = p_drop;
end;
$$;
