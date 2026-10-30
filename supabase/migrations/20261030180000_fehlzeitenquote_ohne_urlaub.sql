-- Fehlzeitenquote ohne Urlaub (Fabian 2026-10-30): Fehltage = Krank + Sonderurlaub.
-- Sonst unverändert gegenüber 20261030170000_fehlzeiten_krankenquote.sql.
drop function if exists public.employees_absence_rate();

create function public.employees_absence_rate()
returns table (employee_id bigint, sick_days numeric, absent_days numeric, possible_days numeric,
               cur_sick_days numeric, cur_absent_days numeric, cur_possible_days numeric)
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
      select distinct uid, extract(year from d)::int as y
      from erfasst
    ),
    erster as (
      select uid, min(d) as first_day, max(d) as last_day from erfasst group by 1
    ),
    fehl as (
      select v.user_id as uid, extract(year from v.start_date)::int as y,
             sum(v.days) filter (where v.kind = 'krank') as krank,
             sum(v.days) as alle
      from public.vacation_requests v
      where v.kind in ('krank', 'sonderurlaub') and v.state = 'genehmigt'
        and v.start_date <= (now() at time zone 'Europe/Berlin')::date
      group by 1, 2
    ),
    je_jahr as (
      select e.id, j.y, coalesce(k.krank, 0) as sick, coalesce(k.alle, 0) as absent,
             (select count(*)
              from generate_series(
                     greatest(make_date(j.y, 1, 1), e.entry_date, f.first_day),
                     least(make_date(j.y, 12, 31), e.exit_date, v_today,
                           case when e.status = 'nicht aktiv' and e.exit_date is null then f.last_day end),
                     interval '1 day') g(d)
              where extract(isodow from g.d)::smallint = any(coalesce(nullif(e.work_days, '{}'), '{1,2,3,4,5}'))
                and not public.is_holiday_rlp(g.d::date))::numeric as possible
      from public.employees e
      join jahre j on j.uid = e.user_id
      join erster f on f.uid = e.user_id
      left join fehl k on k.uid = j.uid and k.y = j.y
    )
    select id, sum(sick), sum(absent), sum(possible),
           max(case when y = v_year then sick end),
           max(case when y = v_year then absent end),
           max(case when y = v_year then possible end)
    from je_jahr
    group by id;
end;
$$;

revoke execute on function public.employees_absence_rate() from public, anon;
grant execute on function public.employees_absence_rate() to authenticated;
