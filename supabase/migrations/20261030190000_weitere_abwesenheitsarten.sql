-- Weitere Abwesenheitsarten (Fabian, 2026-10-30): Schulung, Schule, Unbezahlter Urlaub, Kindkrank.
-- Alle vier mindern das Soll im Überstundenkonto (wie Krank/Sonderurlaub), zählen nicht gegen den Urlaubsanspruch
-- und sperren das Einplanen im Kalender. Beim TimeTac-Import bleiben sie stehen (gibt es dort nicht).
-- Fehlzeiten-/Krankenquote (employees_absence_rate) passt der Kennzahlen-Umbau an.

alter table public.vacation_requests drop constraint if exists vacation_requests_kind_check;
alter table public.vacation_requests
  add constraint vacation_requests_kind_check check (kind in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub', 'schulung', 'schule', 'unbezahlt', 'kindkrank'));


create or replace function public.notice_absence(p_kind text, p_start date, p_end date, p_days numeric)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_kind when 'urlaub' then 'Urlaub' when 'ueberstunden' then 'Zeitausgleich'
                     when 'krank' then 'Krank' when 'sonderurlaub' then 'Sonderurlaub'
                     when 'schulung' then 'Schulung' when 'schule' then 'Schule'
                     when 'unbezahlt' then 'Unbezahlter Urlaub' when 'kindkrank' then 'Kindkrank' else p_kind end
         || ' ' || to_char(p_start, 'DD.MM.YYYY')
         || case when p_end > p_start then ' bis ' || to_char(p_end, 'DD.MM.YYYY') else '' end
         || ' (' || replace(trim_scale(p_days)::text, '.', ',')
         || case when p_days = 1 then ' Tag)' else ' Tage)' end;
$$;

create or replace function public.enter_absence(
  p_user uuid, p_start date, p_end date, p_kind text, p_note text default '', p_half boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days numeric;
  v_id bigint;
begin
  if not public.can_edit_times(p_user) then
    raise exception 'Abwesenheiten für andere tragen Vorgesetzte, Personalabteilung oder Admin ein (nicht für sich selbst)';
  end if;
  if coalesce(p_kind, '') not in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub', 'schulung', 'schule', 'unbezahlt', 'kindkrank') then
    raise exception 'Bitte eine Art der Abwesenheit wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Bitte Zeiträume über den Jahreswechsel in zwei Einträgen erfassen';
  end if;
  v_days := public.vacation_workdays(p_start, p_end);
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine Arbeitstage (Wochenende oder gesetzlicher Feiertag in Rheinland-Pfalz)';
  end if;
  if coalesce(p_half, false) then
    if v_days <> 1 then
      raise exception 'Einen halben Tag bitte nur für einen einzelnen Arbeitstag eintragen';
    end if;
    if p_kind = 'ueberstunden' then
      raise exception 'Zeitausgleich bitte als ganzen Tag eintragen';
    end if;
    v_days := 0.5;
  end if;
  if exists (
    select 1 from public.vacation_requests
    where user_id = p_user and state in ('beantragt', 'genehmigt')
      and start_date <= p_end and end_date >= p_start
  ) then
    raise exception 'In diesem Zeitraum gibt es schon Urlaub oder eine Abwesenheit. Bitte diese zuerst stornieren.';
  end if;
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state, decided_by, decided_at, decision_note)
  values (p_user, p_start, p_end, v_days, left(trim(coalesce(p_note, '')), 300), p_kind, 'genehmigt', auth.uid(), now(), 'eingetragen')
  returning id into v_id;
  perform public.notify_time_change(p_user,
    public.notice_absence(p_kind, p_start, p_end, v_days) || ' eingetragen'
    || case when trim(coalesce(p_note, '')) <> '' then '. Notiz: ' || left(trim(p_note), 300) else '' end || '.');
  return v_id;
end;
$$;

create or replace function public.team_members_absence()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_kind text;
  v_start date;
  v_end date;
  v_name text;
begin
  if tg_op = 'UPDATE' and new.day is not distinct from old.day and new.installer_id is not distinct from old.installer_id then
    return new;
  end if;
  select kind, start_date, end_date into v_kind, v_start, v_end
    from public.vacation_requests
   where user_id = new.installer_id and state = 'genehmigt' and new.day between start_date and end_date
   order by start_date
   limit 1;
  if v_kind is null then
    return new;
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into v_name from public.profiles where id = new.installer_id;
  raise exception '% hat am % % (% – %) und kann nicht eingeplant werden',
    coalesce(v_name, 'Der Monteur'), to_char(new.day, 'DD.MM.YYYY'),
    case v_kind when 'urlaub' then 'Urlaub' when 'ueberstunden' then 'Zeitausgleich'
                when 'krank' then 'eine Krankmeldung' when 'sonderurlaub' then 'Sonderurlaub'
                when 'schulung' then 'eine Schulung' when 'schule' then 'Schule'
                when 'unbezahlt' then 'unbezahlten Urlaub' when 'kindkrank' then 'Kindkrank' else 'eine Abwesenheit' end,
    to_char(v_start, 'DD.MM.YYYY'), to_char(v_end, 'DD.MM.YYYY');
end;
$$;

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

  -- Solltage: vereinbarte Arbeitstage, kein Feiertag; alle genehmigten Abwesenheiten außer Zeitausgleich mindern das Soll
  -- (halbe Tage anteilig). Überstunden-Freizeit bleibt Soll.
  select coalesce(sum(1 - least(1, coalesce((
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date), 0))
           from public.vacation_requests v
           where v.user_id = p_user and v.state = 'genehmigt' and v.kind <> 'ueberstunden'
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

create or replace function public.import_absences(p_user uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  s date;
  e date;
  d numeric;
  k text;
  v_by uuid;
  v_at timestamptz;
  v_in int := 0;
  v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'App-Benutzer nicht gefunden';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      s := (r ->> 'start')::date;
      e := (r ->> 'end')::date;
      d := round((r ->> 'days')::numeric * 2) / 2;
      k := r ->> 'kind';
    exception when others then
      v_skip := v_skip + 1;
      continue;
    end;
    -- Genehmiger und Zeitpunkt sind freiwillig; Unbrauchbares wird ignoriert
    begin
      v_by := nullif(r ->> 'decided_by', '')::uuid;
    exception when others then
      v_by := null;
    end;
    if v_by is not null and not exists (select 1 from public.profiles where id = v_by) then
      v_by := null;
    end if;
    begin
      v_at := coalesce(nullif(r ->> 'decided_at', '')::timestamptz, now());
    exception when others then
      v_at := now();
    end;
    if s is null or e is null or e < s or extract(year from s) <> extract(year from e)
       or d is null or d <= 0 or k not in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub', 'schulung', 'schule', 'unbezahlt', 'kindkrank')
       or exists (select 1 from public.vacation_requests v
                   where v.user_id = p_user and v.state in ('beantragt', 'genehmigt')
                     and v.start_date <= e and v.end_date >= s) then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state,
                                          decided_by, decided_by_name, decided_at, decision_note)
    values (p_user, s, e, d, left(trim('TimeTac ' || coalesce(r ->> 'note', '')), 300), k, 'genehmigt',
            v_by, case when v_by is null then left(trim(coalesce(r ->> 'decided_by_name', '')), 120) else '' end,
            v_at, 'aus TimeTac übernommen');
    v_in := v_in + 1;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end;
$$;

create or replace function public.clear_absences(p_user uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_m int;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  -- früher aus TimeTac übernommene löschen (kommen neu), alle anderen stornieren (bleiben sichtbar);
  -- Schulung, Schule, Unbezahlter Urlaub und Kindkrank kommen nicht aus TimeTac und bleiben stehen
  delete from public.vacation_requests
   where user_id = p_user and note like 'TimeTac%'
     and start_date >= p_from and end_date <= p_to;
  get diagnostics v_n = row_count;
  update public.vacation_requests
     set state = 'storniert', decided_by = auth.uid(), decided_at = now(), decision_note = 'durch TimeTac ersetzt'
   where user_id = p_user
     and state in ('beantragt', 'genehmigt')
     and kind in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub')
     and start_date >= p_from
     and end_date <= p_to;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;
