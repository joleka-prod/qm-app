-- Kapazitätsplanung Montage (Fabian, 2026-10-25): kalkulierte Montagezeit je Auftrag als
-- Anzahl Monteure (Mann) und Dauer (Tage). Manntage = Mann × Tage.
-- Ändern dürfen Planer (Admin, Teamleiter, Disposition) und der Ersteller, solange der Auftrag ungeplant ist.

alter table public.tickets
  add column if not exists calc_men smallint check (calc_men between 1 and 50),
  add column if not exists calc_days numeric(5, 1) check (calc_days > 0 and calc_days <= 365);

create or replace function public.tickets_zz_calc_time()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
     and (new.calc_men is distinct from old.calc_men or new.calc_days is distinct from old.calc_days)
     and auth.uid() is not null
     and coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter', 'disposition')
     and not (old.created_by = auth.uid() and old.status = 'neu') then
    new.calc_men := old.calc_men;
    new.calc_days := old.calc_days;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_zz_calc_time on public.tickets;
create trigger tickets_zz_calc_time
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_calc_time();

-- Vormerken in der Einplanung darf auch die Disposition
create or replace function public.tickets_zz_planned_week()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_planner boolean := auth.uid() is null or coalesce(public.my_role()::text, '') in ('admin', 'teamleiter', 'disposition');
begin
  if new.planned_week is not null then
    new.planned_week := date_trunc('week', new.planned_week)::date;
  end if;
  if not v_planner then
    new.planned_week := case when tg_op = 'INSERT' then null else old.planned_week end;
  end if;
  return new;
end;
$$;
