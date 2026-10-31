-- Zeiten und Abwesenheiten sehen nur noch: der Mitarbeiter selbst, seine Vorgesetzten (über alle Ebenen),
-- die Personalabteilung und der Admin (Fabian, 2026-10-31). Teamleiter sehen nicht mehr alle,
-- die Disposition keine fremden Zeiten. Der Einsatzkalender bekommt nur "abwesend" ohne Art (planning_absences).

drop policy if exists "Stempelzeiten sehen" on public.attendance;
create policy "Stempelzeiten sehen"
  on public.attendance for select to authenticated
  using (installer_id = auth.uid() or public.is_admin() or public.is_supervisor_of(installer_id)
         or public.has_hr_access());

drop policy if exists "Urlaub sehen" on public.vacation_requests;
create policy "Urlaub sehen"
  on public.vacation_requests for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_supervisor_of(user_id)
         or public.has_hr_access());

drop policy if exists "Zeitnachträge sehen" on public.attendance_requests;
create policy "Zeitnachträge sehen" on public.attendance_requests
  for select to authenticated
  using (user_id = auth.uid() or requested_by = auth.uid()
         or public.is_admin()
         or public.is_supervisor_of(user_id)
         or public.has_hr_access());

-- Stempelzeit nachtragen/korrigieren: nicht mehr für beliebige Mitarbeiter durch Teamleiter/Disposition
create or replace function public.request_attendance_change(
  p_user uuid, p_attendance_id bigint, p_start timestamptz, p_end timestamptz, p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.attendance;
  v_id bigint;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not (p_user = auth.uid()
          or public.is_admin()
          or public.is_supervisor_of(p_user)
          or public.has_hr_access()) then
    raise exception 'Keine Berechtigung';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Bitte einen Grund angeben';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Das Ende muss nach dem Beginn liegen';
  end if;
  if p_start > now() or p_end > now() + interval '5 minutes' then
    raise exception 'Zeiten in der Zukunft können nicht nachgetragen werden';
  end if;
  if p_attendance_id is not null then
    select * into v_old from public.attendance where id = p_attendance_id and installer_id = p_user;
    if not found then
      raise exception 'Stempelzeit nicht gefunden';
    end if;
    if exists (select 1 from public.attendance_requests where attendance_id = p_attendance_id and state = 'beantragt') then
      raise exception 'Für diese Stempelzeit gibt es schon eine offene Korrektur';
    end if;
  end if;

  insert into public.attendance_requests (user_id, attendance_id, started_at, ended_at, old_started_at, old_ended_at, reason, requested_by)
  values (p_user, p_attendance_id, p_start, p_end, v_old.started_at, v_old.ended_at, trim(p_reason), auth.uid())
  returning id into v_id;

  if public.can_edit_times(p_user) then
    perform public.apply_attendance_request(v_id);
    update public.attendance_requests set state = 'genehmigt', decided_by = auth.uid(), decided_at = now() where id = v_id;
    perform public.notify_time_change(p_user,
      case when p_attendance_id is null
        then 'Zeit nachgetragen am ' || public.notice_day(p_start) || ': ' || public.notice_span(p_start, p_end)
        else 'Stempelzeit korrigiert am ' || public.notice_day(p_start) || ': jetzt ' || public.notice_span(p_start, p_end)
             || ', vorher ' || public.notice_span(v_old.started_at, v_old.ended_at)
      end || '. Grund: ' || trim(p_reason));
    return 'genehmigt';
  end if;
  return 'beantragt';
end;
$$;


-- Überstundenkonto: nur selbst, Vorgesetzte, Personalabteilung, Admin
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


-- Einsatzkalender: genehmigte Abwesenheiten für alle Planer, aber ohne Art (z. B. nicht "krank")
create or replace function public.planning_absences(p_from date, p_to date)
returns table (user_id uuid, start_date date, end_date date)
language sql
stable
security definer
set search_path = ''
as $$
  select v.user_id, v.start_date, v.end_date
  from public.vacation_requests v
  where v.state = 'genehmigt' and v.start_date <= p_to and v.end_date >= p_from
    and (coalesce(public.my_role()::text, '') in ('admin', 'teamleiter', 'disposition') or public.has_hr_access());
$$;
revoke execute on function public.planning_absences(date, date) from public, anon;
grant execute on function public.planning_absences(date, date) to authenticated;
