-- Einteilung nicht bei Urlaub (Fabian, 2026-10-30): Hat ein Monteur an einem Tag genehmigten Urlaub
-- oder eine andere genehmigte Abwesenheit (Zeitausgleich, Sonderurlaub, Krank, auch halbe Tage),
-- wird das Einteilen ins Team mit Fehlermeldung abgelehnt. Beantragter Urlaub sperrt nicht.

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
   order by start_date
   limit 1;
  if v_kind is null then
    return new;
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into v_name from public.profiles where id = new.installer_id;
  raise exception '% hat am % % (% – %) und kann nicht eingeplant werden',
    coalesce(v_name, 'Der Monteur'), to_char(new.day, 'DD.MM.YYYY'),
    case v_kind when 'urlaub' then 'Urlaub' when 'ueberstunden' then 'Zeitausgleich'
                when 'krank' then 'eine Krankmeldung' else 'Sonderurlaub' end,
    to_char(v_start, 'DD.MM.YYYY'), to_char(v_end, 'DD.MM.YYYY');
end;
$$;

drop trigger if exists team_members_absence on public.team_members;
create trigger team_members_absence
  before insert or update on public.team_members
  for each row execute function public.team_members_absence();
