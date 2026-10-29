-- Einteilung nur mit Arbeitserlaubnis (Fabian, 2026-10-29): Liegt das Bauvorhaben eines Einsatzes
-- in Luxemburg, Belgien oder Holland, muss jeder Monteur des Teams an dem Tag in seiner
-- Personalakte den passenden Haken haben. Sonst wird die Einteilung mit Fehlermeldung abgelehnt.
-- Geprüft wird beim Einteilen des Monteurs ins Team und beim Zuordnen des Einsatzes zu Team/Tag.

-- Land des Bauvorhabens -> 'lu' / 'be' / 'nl' (auch Schreibweisen aus 3E), sonst null
create or replace function public.permit_country(p_country text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case
    when v in ('luxemburg', 'luxembourg', 'letzebuerg', 'lu', 'lux', 'l') then 'lu'
    when v in ('belgien', 'belgium', 'belgique', 'belgie', 'belgië', 'be', 'bel', 'b') then 'be'
    when v in ('niederlande', 'holland', 'nederland', 'netherlands', 'the netherlands', 'nl', 'nld') then 'nl'
  end
  from (select lower(trim(coalesce(p_country, ''))) as v) x;
$$;

-- Fehlermeldung, wenn der Monteur für das Land keine Arbeitserlaubnis hat, sonst null
create or replace function public.missing_work_permit(p_installer uuid, p_country text)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_key text := public.permit_country(p_country);
  v_ok boolean;
  v_name text;
begin
  if v_key is null then
    return null;
  end if;
  select case v_key when 'lu' then e.work_permit_lu when 'be' then e.work_permit_be else e.work_permit_nl end
    into v_ok
    from public.employees e where e.user_id = p_installer;
  if coalesce(v_ok, false) then
    return null;
  end if;
  select coalesce(nullif(trim(full_name), ''), email) into v_name from public.profiles where id = p_installer;
  return format('%s hat keine Arbeitserlaubnis in %s (Personal → Stammdaten → Arbeits- und Aufenthaltsgenehmigungen)',
                coalesce(v_name, 'Der Monteur'),
                case v_key when 'lu' then 'Luxemburg' when 'be' then 'Belgien' else 'Holland' end);
end;
$$;

revoke all on function public.missing_work_permit(uuid, text) from public, anon;

-- Monteur wird ins Team eingeteilt: Einsätze des Teams an dem Tag prüfen
create or replace function public.team_members_work_permit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  r record;
  v_msg text;
begin
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id and new.day is not distinct from old.day
     and new.installer_id is not distinct from old.installer_id then
    return new;
  end if;
  for r in
    select p.country, p.name from public.tickets t join public.projects p on p.id = t.project_id
     where t.team_id = new.team_id and t.montage_date = new.day
  loop
    v_msg := public.missing_work_permit(new.installer_id, r.country);
    if v_msg is not null then
      raise exception '% – am % ist das Team für das Bauvorhaben „%“ eingeplant', v_msg, to_char(new.day, 'DD.MM.YYYY'), r.name;
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists team_members_work_permit on public.team_members;
create trigger team_members_work_permit
  before insert or update on public.team_members
  for each row execute function public.team_members_work_permit();

-- Einsatz wird einem Team/Tag zugeordnet: alle Monteure des Teams an dem Tag prüfen
create or replace function public.tickets_work_permit()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_country text;
  v_project text;
  m record;
  v_msg text;
begin
  if new.team_id is null or new.montage_date is null or new.project_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE' and new.team_id is not distinct from old.team_id and new.montage_date is not distinct from old.montage_date
     and new.project_id is not distinct from old.project_id then
    return new;
  end if;
  select country, name into v_country, v_project from public.projects where id = new.project_id;
  if public.permit_country(v_country) is null then
    return new;
  end if;
  for m in select installer_id from public.team_members where team_id = new.team_id and day = new.montage_date loop
    v_msg := public.missing_work_permit(m.installer_id, v_country);
    if v_msg is not null then
      raise exception '% – der Einsatz (Bauvorhaben „%“) kann am % nicht diesem Team zugeordnet werden', v_msg, v_project, to_char(new.montage_date, 'DD.MM.YYYY');
    end if;
  end loop;
  return new;
end;
$$;

drop trigger if exists tickets_work_permit on public.tickets;
create trigger tickets_work_permit
  before insert or update on public.tickets
  for each row execute function public.tickets_work_permit();
