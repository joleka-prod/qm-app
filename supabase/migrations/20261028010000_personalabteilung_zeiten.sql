-- Personalabteilung sieht in der Zeiterfassung alle Mitarbeiter (Fabian, 2026-10-28).
-- "Personalabteilung" = Rolle personal bzw. Haken "Zugriff auf Personalakten" (has_hr_access, wie bei der Personalakte).
-- Nur lesen: Korrigieren, Genehmigen und Abwesenheiten eintragen bleiben bei Vorgesetzten und Admin.

drop policy if exists "Stempelzeiten sehen" on public.attendance;
create policy "Stempelzeiten sehen"
  on public.attendance for select to authenticated
  using (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter') or public.is_supervisor_of(installer_id)
         or public.has_hr_access());

drop policy if exists "Zeiten sehen" on public.time_entries;
create policy "Zeiten sehen"
  on public.time_entries for select to authenticated
  using (installer_id = auth.uid() or public.can_view_ticket(ticket_id) or public.is_supervisor_of(installer_id)
         or public.has_hr_access());

drop policy if exists "Urlaub sehen" on public.vacation_requests;
create policy "Urlaub sehen"
  on public.vacation_requests for select to authenticated
  using (user_id = auth.uid() or public.my_role() in ('admin', 'teamleiter') or public.is_supervisor_of(user_id)
         or public.has_hr_access());

drop policy if exists "Zeitnachträge sehen" on public.attendance_requests;
create policy "Zeitnachträge sehen" on public.attendance_requests
  for select to authenticated
  using (user_id = auth.uid() or requested_by = auth.uid()
         or public.my_role()::text in ('admin', 'teamleiter', 'disposition')
         or public.is_supervisor_of(user_id)
         or public.has_hr_access());

-- Überstundenkonto: auch für die Personalabteilung
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
  v_daily := v_p.weekly_hours * 60 / 5;

  -- Solltage: Mo–Fr, kein Feiertag; genehmigter Urlaub, Krankheit und Sonderurlaub mindern das Soll
  -- (halbe Tage anteilig). Überstunden-Freizeit bleibt Soll.
  select coalesce(sum(1 - least(1, coalesce((
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date), 0))
           from public.vacation_requests v
           where v.user_id = p_user and v.state = 'genehmigt' and v.kind in ('urlaub', 'krank', 'sonderurlaub')
             and g.d::date between v.start_date and v.end_date), 0))), 0)
    into v_days
  from generate_series(v_p.overtime_start, v_until, interval '1 day') g(d)
  where extract(isodow from g.d) <= 5
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
