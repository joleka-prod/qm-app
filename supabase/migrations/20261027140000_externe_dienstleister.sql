-- Externe Dienstleister im Personal (Fabian, 2026-10-27): stehen getrennt von den Mitarbeitern,
-- haben nur Stammdaten und App-Benutzer und eigene Stammdaten (Firma, Gewerk, USt-IdNr. …).
-- Ansprechpartner, Adresse und Bankverbindung nutzen die vorhandenen Felder.

alter table public.employees
  add column if not exists employee_type text not null default 'mitarbeiter'
    check (employee_type in ('mitarbeiter', 'extern')),
  add column if not exists company text not null default '',
  add column if not exists trade text not null default '',
  add column if not exists phone text not null default '',
  add column if not exists mobile text not null default '',
  add column if not exists email text not null default '',
  add column if not exists vat_id text not null default '',
  add column if not exists tax_number text not null default '',
  add column if not exists note text not null default '';

-- Name des App-Benutzers: Ansprechpartner, ohne Ansprechpartner die Firma
create or replace function public.employees_sync_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
begin
  if new.user_id is null then
    return new;
  end if;
  if v_name = '' and new.employee_type = 'extern' then
    v_name := trim(coalesce(new.company, ''));
  end if;
  perform set_config('app.employee_sync', '1', true);
  update public.profiles p set
    full_name = case when v_name <> '' then v_name else p.full_name end,
    vacation_days = coalesce(new.vacation_days, p.vacation_days),
    weekly_hours = coalesce(new.weekly_hours, p.weekly_hours),
    -- den eigenen Zugang sperrt man sich nicht selbst
    active = case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end
  where p.id = new.user_id
    and (p.full_name is distinct from case when v_name <> '' then v_name else p.full_name end
         or p.vacation_days is distinct from coalesce(new.vacation_days, p.vacation_days)
         or p.weekly_hours is distinct from coalesce(new.weekly_hours, p.weekly_hours)
         or p.active is distinct from case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end);
  perform set_config('app.employee_sync', '', true);
  return new;
end;
$$;

drop trigger if exists employees_sync_user on public.employees;
create trigger employees_sync_user
  after insert or update of first_name, last_name, company, vacation_days, weekly_hours, status, user_id on public.employees
  for each row execute function public.employees_sync_user();
