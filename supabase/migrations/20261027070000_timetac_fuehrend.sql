-- TimeTac ist führend (Fabian, 2026-10-27): Beim Import werden vorhandene Stempelzeiten und Abwesenheiten
-- der zugeordneten Mitarbeiter im Importzeitraum ersetzt. Ersetzte Stempelzeiten werden vorher in
-- attendance_backup gesichert (nur per SQL einsehbar), ersetzte Abwesenheiten werden storniert. Früher aus TimeTac
-- übernommene Einträge werden einfach gelöscht, sie kommen beim Import neu.

create table if not exists public.attendance_backup (
  id bigint not null,
  installer_id uuid not null,
  started_at timestamptz not null,
  ended_at timestamptz,
  note text not null default '',
  edited_by uuid,
  created_at timestamptz not null,
  replaced_at timestamptz not null default now(),
  replaced_by uuid
);
alter table public.attendance_backup enable row level security;

-- Stempelzeiten eines Mitarbeiters im Zeitraum (Tage, deutsche Zeit) sichern und löschen.
-- Laufende Stempelungen und künftige Zeiten bleiben stehen.
create or replace function public.clear_attendance(p_user uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  -- früher aus TimeTac übernommene Zeiten nicht sichern, die kommen ja wieder aus TimeTac
  with gone as (
    delete from public.attendance a
     where a.installer_id = p_user
       and a.ended_at is not null
       and a.started_at >= (p_from::timestamp at time zone 'Europe/Berlin')
       and a.started_at < ((p_to + 1)::timestamp at time zone 'Europe/Berlin')
       and a.started_at < now()
    returning a.*
  ), saved as (
    insert into public.attendance_backup (id, installer_id, started_at, ended_at, note, edited_by, created_at, replaced_by)
    select id, installer_id, started_at, ended_at, note, edited_by, created_at, auth.uid() from gone
     where note not like 'TimeTac%'
  )
  select count(*) into v_n from gone;
  return v_n;
end;
$$;

-- Abwesenheiten eines Mitarbeiters, die ganz im Zeitraum liegen, stornieren
create or replace function public.clear_absences(p_user uuid, p_from date, p_to date)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_n int;
  v_m int;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  -- früher aus TimeTac übernommene löschen (kommen neu), alle anderen stornieren (bleiben sichtbar)
  delete from public.vacation_requests
   where user_id = p_user and note like 'TimeTac%'
     and start_date >= p_from and end_date <= p_to;
  get diagnostics v_n = row_count;
  update public.vacation_requests
     set state = 'storniert', decided_by = auth.uid(), decided_at = now(), decision_note = 'durch TimeTac ersetzt'
   where user_id = p_user
     and state in ('beantragt', 'genehmigt')
     and start_date >= p_from
     and end_date <= p_to;
  get diagnostics v_m = row_count;
  return v_n + v_m;
end;
$$;

revoke execute on function public.clear_attendance(uuid, date, date) from public, anon;
revoke execute on function public.clear_absences(uuid, date, date) from public, anon;
grant execute on function public.clear_attendance(uuid, date, date) to authenticated;
grant execute on function public.clear_absences(uuid, date, date) to authenticated;
