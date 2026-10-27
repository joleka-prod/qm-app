-- Kennzahl "Ø Krankheitstage pro Jahr" auf der Personal-Übersicht (Fabian 2026-10-27).
-- Je Personalakte mit App-Benutzer: Durchschnitt der Krankheitstage pro Jahr, gleiche Logik wie
-- employee_sick_days (genehmigte Krank-Einträge, Jahre mit Zeiterfassung ohne Krankheit zählen mit 0).
-- Die Auswahl (aktive Mitarbeiter ohne Geschäftsführung) trifft die App.
create or replace function public.employees_sick_days_avg()
returns table (employee_id bigint, years int, avg_days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
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
    select e.id, count(*)::int, avg(coalesce(k.days, 0))
    from public.employees e
    join jahre j on j.uid = e.user_id
    left join krank k on k.uid = j.uid and k.y = j.y
    group by e.id;
end;
$$;

revoke execute on function public.employees_sick_days_avg() from public, anon;
grant execute on function public.employees_sick_days_avg() to authenticated;
