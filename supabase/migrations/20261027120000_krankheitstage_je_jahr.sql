-- Krankheitstage je Jahr für den Reiter Fehlzeiten der Personalakte.
-- Quelle: Abwesenheiten der Zeiterfassung (vacation_requests, kind 'krank', z. B. aus TimeTac),
-- nur genehmigte Einträge (stornierte/abgelehnte zählen nicht). Ein Eintrag liegt immer in einem Jahr.
-- Jahre mit Zeiterfassung, aber ohne Krankheit, erscheinen mit 0 Tagen (zählen für den Durchschnitt mit).
-- Lesbar für alle mit Zugriff auf die Personalakte (Admin, Personalabteilung, hr_access).
create or replace function public.employee_sick_days(p_employee bigint)
returns table (year int, days numeric)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_user uuid;
begin
  if not public.has_hr_access() then
    raise exception 'Keine Berechtigung';
  end if;
  select e.user_id into v_user from public.employees e where e.id = p_employee;
  if v_user is null then
    return;
  end if;
  return query
    with jahre as (
      select extract(year from (a.started_at at time zone 'Europe/Berlin'))::int as y
      from public.attendance a
      where a.installer_id = v_user
      union
      select extract(year from v.start_date)::int
      from public.vacation_requests v
      where v.user_id = v_user and v.state = 'genehmigt'
    )
    select j.y,
           coalesce((select sum(v.days) from public.vacation_requests v
                     where v.user_id = v_user and v.kind = 'krank' and v.state = 'genehmigt'
                       and extract(year from v.start_date)::int = j.y), 0)
    from jahre j
    order by 1 desc;
end;
$$;

revoke execute on function public.employee_sick_days(bigint) from public, anon;
grant execute on function public.employee_sick_days(bigint) to authenticated;

-- Manuelle Tabelle "Krankheitstage" (aus Ninox) entfällt samt Daten (Fabian 2026-10-27)
delete from public.employee_entries where kind = 'krankheit';
