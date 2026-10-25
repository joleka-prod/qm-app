-- Vorplanung nur für die Auftragsart Montageauftrag (Fabian, 2026-10-25).
-- Andere Auftragsarten können keiner Kalenderwoche mehr vorgemerkt werden.

create or replace function public.tickets_zz_planned_week()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_planner boolean := auth.uid() is null or coalesce(public.my_role()::text, '') in ('admin', 'teamleiter', 'disposition');
begin
  if new.ticket_type::text <> 'montageauftrag' then
    new.planned_week := null;
    return new;
  end if;
  if new.planned_week is not null then
    new.planned_week := date_trunc('week', new.planned_week)::date;
  end if;
  if not v_planner then
    new.planned_week := case when tg_op = 'INSERT' then null else old.planned_week end;
  end if;
  return new;
end;
$$;

update public.tickets set planned_week = null
 where planned_week is not null and ticket_type::text <> 'montageauftrag';
