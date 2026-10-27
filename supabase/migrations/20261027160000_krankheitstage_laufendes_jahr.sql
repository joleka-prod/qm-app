-- Kennzahl Krankheitstage zusätzlich für das laufende Geschäftsjahr (Fabian 2026-10-27).
-- Annahme: Geschäftsjahr = Kalenderjahr. cur_days = Krankheitstage im laufenden Jahr bis heute,
-- null wenn es im laufenden Jahr noch keine Zeiterfassung für den Mitarbeiter gibt.
drop function if exists public.employees_sick_days_avg();

create function public.employees_sick_days_avg()
returns table (employee_id bigint, years int, avg_days numeric, cur_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_year int := extract(year from (now() at time zone 'Europe/Berlin'))::int;
begin
  if not public.has_hr_access() then
    raise exception 'Keine Berechtigung';
  end if;
  return query
    with jahre as (
      select a.installer_id as uid, extract(year from (a.started_at at time zone 'Europe/Berlin'))::int as y
      from public.attendance a
      union
      select v.user_id, extract(year from v.start_date)::int
      from public.vacation_requests v
      where v.state = 'genehmigt'
    ),
    krank as (
      select v.user_id as uid, extract(year from v.start_date)::int as y, sum(v.days) as days
      from public.vacation_requests v
      where v.kind = 'krank' and v.state = 'genehmigt'
      group by 1, 2
    )
    select e.id, count(*)::int, avg(coalesce(k.days, 0)),
           max(case when j.y = v_year then coalesce(k.days, 0) end)
    from public.employees e
    join jahre j on j.uid = e.user_id
    left join krank k on k.uid = j.uid and k.y = j.y
    group by e.id;
end;
$$;

revoke execute on function public.employees_sick_days_avg() from public, anon;
grant execute on function public.employees_sick_days_avg() to authenticated;
