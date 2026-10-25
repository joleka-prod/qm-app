-- Kalender "Einplanung" (Fabian, 2026-10-25): Aufträge werden zuerst grob einer Kalenderwoche
-- vorgemerkt und später im Montage-/Kundendienst-Kalender taggenau einem Team zugeordnet.
-- planned_week ist immer der Montag der Woche. Vormerken dürfen nur Admin und Teamleiter.

alter table public.tickets add column if not exists planned_week date;
create index if not exists tickets_planned_week_idx on public.tickets (planned_week) where planned_week is not null;

create or replace function public.tickets_zz_planned_week()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_planner boolean := auth.uid() is null or public.my_role() in ('admin', 'teamleiter');
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

drop trigger if exists tickets_zz_planned_week on public.tickets;
create trigger tickets_zz_planned_week
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_planned_week();

create or replace function public.tickets_log_planned_week()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.planned_week is distinct from old.planned_week then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'kw_vorgemerkt',
            case when new.planned_week is null then ''
                 else 'KW ' || to_char(new.planned_week, 'IW/IYYY') end);
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_log_planned_week on public.tickets;
create trigger tickets_log_planned_week
  after update on public.tickets
  for each row execute function public.tickets_log_planned_week();
