-- Krankheitstage je Jahr für den Reiter Fehlzeiten der Personalakte.
-- Quelle: Abwesenheiten der Zeiterfassung (vacation_requests, kind 'krank', z. B. aus TimeTac),
-- nur genehmigte Einträge (stornierte/abgelehnte zählen nicht). Ein Eintrag liegt immer in einem Jahr.
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
    select extract(year from v.start_date)::int, sum(v.days)
    from public.vacation_requests v
    where v.user_id = v_user and v.kind = 'krank' and v.state = 'genehmigt'
    group by 1
    order by 1 desc;
end;
$$;

revoke execute on function public.employee_sick_days(bigint) from public, anon;
grant execute on function public.employee_sick_days(bigint) to authenticated;
