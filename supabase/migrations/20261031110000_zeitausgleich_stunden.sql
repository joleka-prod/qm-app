-- Zeitausgleich stundenweise (Fabian, 2026-10-31)
-- Bei Zeitausgleich kann zusätzlich eine Uhrzeit von/bis angegeben werden (nur für einen einzelnen Arbeitstag).
-- Gespeichert in vacation_requests.start_time/end_time, die Dauer ohne feste Pausen in minutes.
-- days = Anteil des Tagessolls (eine Nachkommastelle). Das Soll bleibt wie bei ganzen Tagen bestehen,
-- der Überstundensaldo sinkt also durch die fehlende Arbeitszeit. Stundenweiser Zeitausgleich sperrt das
-- Einplanen nicht (Monteur arbeitet an dem Tag ja noch).

alter table public.vacation_requests
  add column if not exists start_time time,
  add column if not exists end_time time,
  add column if not exists minutes int;

alter table public.vacation_requests drop constraint if exists vacation_requests_time_check;
alter table public.vacation_requests add constraint vacation_requests_time_check check (
  (start_time is null and end_time is null and minutes is null)
  or (start_time is not null and end_time is not null and end_time > start_time
      and start_date = end_date and kind = 'ueberstunden' and minutes > 0)
);

-- Tagessoll in Minuten (Wochenstunden / vereinbarte Arbeitstage, ohne Akte Mo–Fr)
create or replace function public.daily_target_minutes(p_user uuid)
returns numeric
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_hours numeric;
  v_wd smallint[];
begin
  select weekly_hours into v_hours from public.profiles where id = p_user;
  select e.work_days into v_wd from public.employees e where e.user_id = p_user order by e.id limit 1;
  if coalesce(cardinality(v_wd), 0) = 0 then
    v_wd := '{1,2,3,4,5}';
  end if;
  return coalesce(v_hours, 40) * 60 / cardinality(v_wd);
end;
$$;
revoke execute on function public.daily_target_minutes(uuid) from public, anon;
grant execute on function public.daily_target_minutes(uuid) to authenticated;

-- Dauer eines stundenweisen Zeitausgleichs ohne die festen Pausen; prüft die Eingaben
create or replace function public.compensation_minutes(p_user uuid, p_kind text, p_start date, p_end date, p_from time, p_to time)
returns int
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_from timestamptz;
  v_to timestamptz;
  v_min int;
begin
  if p_from is null and p_to is null then
    return null;
  end if;
  if p_from is null or p_to is null then
    raise exception 'Bitte bei der Uhrzeit sowohl von als auch bis eintragen';
  end if;
  if p_kind <> 'ueberstunden' then
    raise exception 'Eine Uhrzeit gibt es nur beim Zeitausgleich';
  end if;
  if p_start <> p_end then
    raise exception 'Zeitausgleich mit Uhrzeit bitte nur für einen einzelnen Tag';
  end if;
  if p_to <= p_from then
    raise exception 'Die Uhrzeit bis muss nach der Uhrzeit von liegen';
  end if;
  v_from := (p_start + p_from) at time zone 'Europe/Berlin';
  v_to := (p_start + p_to) at time zone 'Europe/Berlin';
  v_min := (extract(epoch from (v_to - v_from)) / 60 - public.fixed_break_minutes(v_from, v_to))::int;
  if v_min <= 0 then
    raise exception 'Im gewählten Zeitraum liegt keine Arbeitszeit';
  end if;
  return v_min;
end;
$$;
revoke execute on function public.compensation_minutes(uuid, text, date, date, time, time) from public, anon;

drop function if exists public.request_vacation(date, date, text, text);
create or replace function public.request_vacation(p_start date, p_end date, p_note text default '', p_kind text default 'urlaub',
  p_start_time time default null, p_end_time time default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days numeric;
  v_min int;
  v_id bigint;
  b public.vacation_blocks;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if coalesce(p_kind, '') not in ('urlaub', 'ueberstunden') then
    raise exception 'Bitte Urlaubstage oder Zeitausgleich wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Bitte Urlaub über den Jahreswechsel in zwei Anträgen stellen';
  end if;
  v_days := public.vacation_workdays(p_start, p_end);
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine Arbeitstage';
  end if;
  v_min := public.compensation_minutes(auth.uid(), p_kind, p_start, p_end, p_start_time, p_end_time);
  if v_min is not null then
    v_days := greatest(0.1, round(v_min / public.daily_target_minutes(auth.uid()), 1));
  end if;
  select * into b from public.vacation_blocks
   where kind = 'sperre' and start_date <= p_end and end_date >= p_start
     and public.vacation_block_applies(departments, auth.uid())
   order by start_date limit 1;
  if found then
    raise exception 'Urlaubssperre vom % bis %. Bitte einen anderen Zeitraum wählen oder mit dem Vorgesetzten sprechen.',
      to_char(b.start_date, 'DD.MM.YYYY'),
      to_char(b.end_date, 'DD.MM.YYYY') || case when trim(b.reason) <> '' then ' (' || trim(b.reason) || ')' else '' end;
  end if;
  if exists (
    select 1 from public.vacation_requests
    where user_id = auth.uid() and state in ('beantragt', 'genehmigt')
      and start_date <= p_end and end_date >= p_start
  ) then
    raise exception 'Für diesen Zeitraum gibt es schon einen Urlaubsantrag';
  end if;
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, start_time, end_time, minutes)
  values (auth.uid(), p_start, p_end, v_days, trim(coalesce(p_note, '')), p_kind, p_start_time, p_end_time, v_min)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_vacation(date, date, text, text, time, time) from public, anon;
grant execute on function public.request_vacation(date, date, text, text, time, time) to authenticated;

drop function if exists public.enter_absence(uuid, date, date, text, text, boolean);
create or replace function public.enter_absence(
  p_user uuid, p_start date, p_end date, p_kind text, p_note text default '', p_half boolean default false,
  p_start_time time default null, p_end_time time default null
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days numeric;
  v_min int;
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
  v_min := public.compensation_minutes(p_user, p_kind, p_start, p_end, p_start_time, p_end_time);
  if v_min is not null then
    v_days := greatest(0.1, round(v_min / public.daily_target_minutes(p_user), 1));
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
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state, decided_by, decided_at, decision_note, start_time, end_time, minutes)
  values (p_user, p_start, p_end, v_days, left(trim(coalesce(p_note, '')), 300), p_kind, 'genehmigt', auth.uid(), now(), 'eingetragen', p_start_time, p_end_time, v_min)
  returning id into v_id;
  perform public.notify_time_change(p_user,
    public.notice_absence(p_kind, p_start, p_end, v_days)
    || case when v_min is not null then ' von ' || to_char(p_start_time, 'HH24:MI') || ' bis ' || to_char(p_end_time, 'HH24:MI') || ' Uhr' else '' end
    || ' eingetragen'
    || case when trim(coalesce(p_note, '')) <> '' then '. Notiz: ' || left(trim(p_note), 300) else '' end || '.');
  return v_id;
end;
$$;
revoke execute on function public.enter_absence(uuid, date, date, text, text, boolean, time, time) from public, anon;
grant execute on function public.enter_absence(uuid, date, date, text, text, boolean, time, time) to authenticated;

-- Stundenweiser Zeitausgleich sperrt das Einplanen nicht
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
     and start_time is null
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

-- Verplanter/beantragter Zeitausgleich: stundenweise mit den echten Minuten
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
          or public.is_admin()
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
    round(coalesce(sum(coalesce(v.minutes, public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date) * v_daily))
          filter (where v.state = 'genehmigt'), 0))::int,
    round(coalesce(sum(coalesce(v.minutes, public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date) * v_daily))
          filter (where v.state = 'beantragt'), 0))::int
  into planned_min, requested_min
  from public.vacation_requests v
  where v.user_id = p_user and v.kind = 'ueberstunden' and v.end_date > v_until
    and v.state in ('genehmigt', 'beantragt');
  return next;
end;
$$;
