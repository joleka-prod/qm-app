-- Urlaub und Abwesenheiten zählen nur an den vereinbarten Arbeitstagen der Person (Fabian, 2026-10-31):
-- wer Mo–Do arbeitet, verbraucht für eine Urlaubswoche 4 Tage, ein Freitag ist kein Urlaubstag.
-- Grundlage ist employees.work_days (Reiter Zeiterfassung der Personalakte), ohne Akte Mo–Fr.

create or replace function public.vacation_workdays(p_start date, p_end date, p_user uuid)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  with wd as (
    select coalesce(nullif((select e.work_days from public.employees e where e.user_id = p_user order by e.id limit 1), '{}'),
                    '{1,2,3,4,5}'::smallint[]) as days
  )
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') g(d), wd
  where extract(isodow from g.d)::smallint = any(wd.days) and not public.is_holiday_rlp(g.d::date);
$$;
revoke execute on function public.vacation_workdays(date, date, uuid) from public, anon;
grant execute on function public.vacation_workdays(date, date, uuid) to authenticated;

create or replace function public.request_vacation(p_start date, p_end date, p_note text default '', p_kind text default 'urlaub')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days numeric;
  v_id bigint;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if coalesce(p_kind, '') not in ('urlaub', 'ueberstunden') then
    raise exception 'Bitte Urlaubstage oder Überstunden wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Bitte Urlaub über den Jahreswechsel in zwei Anträgen stellen';
  end if;
  v_days := public.vacation_workdays(p_start, p_end, auth.uid());
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine deiner Arbeitstage';
  end if;
  if exists (
    select 1 from public.vacation_requests
    where user_id = auth.uid() and state in ('beantragt', 'genehmigt')
      and start_date <= p_end and end_date >= p_start
  ) then
    raise exception 'Für diesen Zeitraum gibt es schon einen Urlaubsantrag';
  end if;
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind)
  values (auth.uid(), p_start, p_end, v_days, trim(coalesce(p_note, '')), p_kind)
  returning id into v_id;
  return v_id;
end;
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
  v_days := public.vacation_workdays(p_start, p_end, p_user);
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine Arbeitstage (Wochenende, kein vereinbarter Arbeitstag oder gesetzlicher Feiertag in Rheinland-Pfalz)';
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

-- Überstundenkonto: Abwesenheiten anteilig je vereinbartem Arbeitstag
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
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date, p_user), 0))
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
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date, p_user))
          filter (where v.state = 'genehmigt'), 0) * v_daily)::int,
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date, p_user))
          filter (where v.state = 'beantragt'), 0) * v_daily)::int
  into planned_min, requested_min
  from public.vacation_requests v
  where v.user_id = p_user and v.kind = 'ueberstunden' and v.end_date > v_until
    and v.state in ('genehmigt', 'beantragt');
  return next;
end;
$$;

-- Bestehende Einträge von Teilzeitkräften neu zählen, soweit sie noch nach Mo–Fr gezählt sind
-- (keine halben Tage, nichts aus TimeTac, das bringt seine Tage selbst mit)
update public.vacation_requests v
   set days = public.vacation_workdays(v.start_date, v.end_date, v.user_id)
  from public.employees e
 where e.user_id = v.user_id
   and e.work_days <> '{1,2,3,4,5}'::smallint[]
   and v.state in ('beantragt', 'genehmigt')
   and v.decision_note is distinct from 'aus TimeTac übernommen'
   and v.days = public.vacation_workdays(v.start_date, v.end_date)
   and public.vacation_workdays(v.start_date, v.end_date, v.user_id) > 0;
