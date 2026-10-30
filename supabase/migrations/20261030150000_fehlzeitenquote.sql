-- Kennzahlen "Ø Krankheitstage" werden zur Fehlzeitenquote nach Tagen (Fabian 2026-10-30):
-- Fehlzeitenquote (%) = Fehltage / mögliche Arbeitstage × 100. Die App summiert über die Mitarbeiter.
-- Je Personalakte mit App-Benutzer und Jahr mit Zeiterfassung:
--   sick_days     = genehmigte Krank-Einträge (wie bisher, Jahr nach Beginn des Eintrags)
--   possible_days = vereinbarte Arbeitstage (employees.work_days) ohne Feiertage RLP, gezählt ab dem
--                   spätesten von 1.1., Firmeneintritt und erstem Eintrag in der Zeiterfassung bis zum
--                   frühesten von 31.12., Austritt und heute
-- cur_* = nur laufendes Jahr (null ohne Zeiterfassung im laufenden Jahr).
drop function if exists public.employees_sick_days_avg();

create function public.employees_absence_rate()
returns table (employee_id bigint, sick_days numeric, possible_days numeric, cur_sick_days numeric, cur_possible_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_today date := (now() at time zone 'Europe/Berlin')::date;
  v_year int := extract(year from (now() at time zone 'Europe/Berlin'))::int;
begin
  if not public.has_hr_access() then
    raise exception 'Keine Berechtigung';
  end if;
  return query
    with erfasst as (
      select a.installer_id as uid, (a.started_at at time zone 'Europe/Berlin')::date as d
      from public.attendance a
      union all
      select v.user_id, v.start_date
      from public.vacation_requests v
      where v.state = 'genehmigt'
    ),
    jahre as (
      select uid, extract(year from d)::int as y, min(d) as first_day
      from erfasst
      group by 1, 2
    ),
    krank as (
      select v.user_id as uid, extract(year from v.start_date)::int as y, sum(v.days) as days
      from public.vacation_requests v
      where v.kind = 'krank' and v.state = 'genehmigt'
      group by 1, 2
    ),
    erster as (
      select uid, min(first_day) as first_day from jahre group by 1
    ),
    je_jahr as (
      select e.id, j.y, coalesce(k.days, 0) as sick,
             (select count(*)
              from generate_series(
                     greatest(make_date(j.y, 1, 1), e.entry_date, f.first_day),
                     least(make_date(j.y, 12, 31), e.exit_date, v_today),
                     interval '1 day') g(d)
              where extract(isodow from g.d)::smallint = any(coalesce(nullif(e.work_days, '{}'), '{1,2,3,4,5}'))
                and not public.is_holiday_rlp(g.d::date))::numeric as possible
      from public.employees e
      join jahre j on j.uid = e.user_id
      join erster f on f.uid = e.user_id
      left join krank k on k.uid = j.uid and k.y = j.y
    )
    select id, sum(sick), sum(possible),
           max(case when y = v_year then sick end),
           max(case when y = v_year then possible end)
    from je_jahr
    group by id;
end;
$$;

revoke execute on function public.employees_absence_rate() from public, anon;
grant execute on function public.employees_absence_rate() to authenticated;
