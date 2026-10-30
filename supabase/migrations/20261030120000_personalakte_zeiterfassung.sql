-- Reiter "Zeiterfassung" in der Personalakte (Fabian, 2026-10-30): Wochenstunden, vereinbarte Arbeitstage,
-- Stundenkonto ab, Übertrag und Stempel-Terminal (Chip/PIN). Pflegen dürfen Admin und Personalabteilung
-- (nicht für sich selbst). Die Arbeitstage bestimmen das Soll im Überstundenkonto.

alter table public.employees
  add column if not exists work_days smallint[] not null default '{1,2,3,4,5}'
    check (cardinality(work_days) between 1 and 5 and work_days <@ '{1,2,3,4,5}'::smallint[]);

-- Stundenkonto ab / Übertrag: auch die Personalabteilung (nicht beim eigenen Konto)
create or replace function public.profiles_zz_overtime_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and not (public.has_hr_access() and new.id <> auth.uid() and new.weekly_hours is not distinct from old.weekly_hours)
     and coalesce(current_setting('app.employee_sync', true), '') <> '1'
     and (new.weekly_hours is distinct from old.weekly_hours
          or new.overtime_start is distinct from old.overtime_start
          or new.overtime_opening is distinct from old.overtime_opening) then
    raise exception 'Stundenkonto und Übertrag pflegen Admin und Personalabteilung';
  end if;
  return new;
end;
$$;

create or replace function public.set_time_account(p_user uuid, p_start date, p_opening numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or (public.has_hr_access() and p_user <> auth.uid())) then
    raise exception 'Stundenkonto und Übertrag pflegen Admin und Personalabteilung (nicht das eigene)';
  end if;
  if p_start is null then
    raise exception 'Bitte ein Startdatum für das Stundenkonto eintragen';
  end if;
  if p_opening is null or abs(p_opening) > 999 then
    raise exception 'Bitte beim Übertrag eine Zahl in Stunden eintragen';
  end if;
  update public.profiles set overtime_start = p_start, overtime_opening = p_opening
   where id = p_user and (overtime_start is distinct from p_start or overtime_opening is distinct from p_opening);
end;
$$;
revoke execute on function public.set_time_account(uuid, date, numeric) from public, anon;
grant execute on function public.set_time_account(uuid, date, numeric) to authenticated;

-- Stempel-Terminal: Chip und PIN darf auch die Personalabteilung vergeben
create or replace function public.terminal_credentials_list()
returns table (user_id uuid, badge_uid text, has_pin boolean, locked_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_hr_access()) then
    return;
  end if;
  return query
    select c.user_id, c.badge_uid, c.pin_hash is not null, c.locked_until from public.terminal_credentials c;
end;
$$;

create or replace function public.set_terminal_badge(p_user uuid, p_badge text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge text := public.normalize_badge(p_badge);
  v_other uuid;
begin
  if not (public.is_admin() or public.has_hr_access()) then
    raise exception 'Chips ordnen Admin und Personalabteilung zu';
  end if;
  if v_badge is not null then
    if v_badge !~ '^[0-9a-z]{4,40}$' then
      raise exception 'Die Chipnummer ist ungültig';
    end if;
    select c.user_id into v_other from public.terminal_credentials c where c.badge_uid = v_badge and c.user_id <> p_user;
    if found then
      raise exception 'Dieser Chip ist schon % zugeordnet',
        (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_other);
    end if;
  end if;
  insert into public.terminal_credentials (user_id, badge_uid) values (p_user, v_badge)
  on conflict (user_id) do update set badge_uid = excluded.badge_uid, updated_at = now();
end;
$$;

create or replace function public.set_terminal_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_hr_access()) then
    raise exception 'PINs vergeben Admin und Personalabteilung';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'Die PIN muss aus 4 bis 8 Ziffern bestehen';
  end if;
  insert into public.terminal_credentials (user_id, pin_hash)
  values (p_user, case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf')) end)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
end;
$$;

-- Überstundenkonto: Soll nur an den vereinbarten Arbeitstagen
create or replace function public.overtime_balance(p_user uuid, p_until date default null)
returns table (
  since date, until date, target_min int, actual_min int, opening_min int, balance_min int,
  planned_min int, requested_min int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
  v_until date := coalesce(p_until, (now() at time zone 'Europe/Berlin')::date - 1);
  v_daily numeric;
  v_days numeric;
  v_actual int;
  v_wd smallint[];
begin
  if not (p_user = auth.uid()
          or coalesce(public.my_role()::text, '') in ('admin', 'teamleiter', 'disposition')
          or public.is_supervisor_of(p_user)
          or public.has_hr_access()) then
    raise exception 'Keine Berechtigung';
  end if;
  select * into v_p from public.profiles where id = p_user;
  if not found then
    raise exception 'Benutzer nicht gefunden';
  end if;
  -- Vereinbarte Arbeitstage aus der Personalakte (ohne Akte: Mo–Fr); Soll je Arbeitstag = Wochenstunden / Anzahl Tage
  select e.work_days into v_wd from public.employees e where e.user_id = p_user order by e.id limit 1;
  if coalesce(cardinality(v_wd), 0) = 0 then
    v_wd := '{1,2,3,4,5}';
  end if;
  v_daily := v_p.weekly_hours * 60 / cardinality(v_wd);

  -- Solltage: vereinbarte Arbeitstage, kein Feiertag; genehmigter Urlaub, Krankheit und Sonderurlaub mindern das Soll
  -- (halbe Tage anteilig). Überstunden-Freizeit bleibt Soll.
  select coalesce(sum(1 - least(1, coalesce((
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date), 0))
           from public.vacation_requests v
           where v.user_id = p_user and v.state = 'genehmigt' and v.kind in ('urlaub', 'krank', 'sonderurlaub')
             and g.d::date between v.start_date and v.end_date), 0))), 0)
    into v_days
  from generate_series(v_p.overtime_start, v_until, interval '1 day') g(d)
  where extract(isodow from g.d)::smallint = any(v_wd)
    and not public.is_holiday_rlp(g.d::date);

  -- Ist: gestempelte Zeit ohne die festen Pausen
  select coalesce(sum(extract(epoch from (a.ended_at - a.started_at)) / 60
                      - public.fixed_break_minutes(a.started_at, a.ended_at)), 0)::int into v_actual
  from public.attendance a
  where a.installer_id = p_user
    and a.ended_at is not null
    and (a.started_at at time zone 'Europe/Berlin')::date between v_p.overtime_start and v_until;

  since := v_p.overtime_start;
  until := v_until;
  target_min := round(v_days * v_daily)::int;
  actual_min := v_actual;
  opening_min := round(v_p.overtime_opening * 60)::int;
  balance_min := opening_min + actual_min - target_min;

  -- Künftige Freizeit über Überstunden (ab heute), genehmigt bzw. noch beantragt
  select
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date))
          filter (where v.state = 'genehmigt'), 0) * v_daily)::int,
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date))
          filter (where v.state = 'beantragt'), 0) * v_daily)::int
  into planned_min, requested_min
  from public.vacation_requests v
  where v.user_id = p_user and v.kind = 'ueberstunden' and v.end_date > v_until
    and v.state in ('genehmigt', 'beantragt');
  return next;
end;
$$;
