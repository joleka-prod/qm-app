-- Positionen werden als "erledigt" oder "nicht erledigt" abgehakt. "Nicht erledigt" braucht eine Begründung.
-- Ein Einsatz kann erst als erledigt gemeldet werden, wenn keine Position mehr offen ist.

create type public.position_state as enum ('offen', 'erledigt', 'nicht_erledigt');

alter table public.ticket_positions
  add column state public.position_state not null default 'offen',
  add column reason text not null default '';

update public.ticket_positions set state = 'erledigt' where done;

alter table public.ticket_positions drop column done;

alter table public.ticket_positions
  add constraint ticket_positions_reason_check
  check (state <> 'nicht_erledigt' or length(trim(reason)) > 0);

create or replace function public.positions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.position_number := trim(new.position_number);
  new.description := trim(new.description);
  new.reason := case when new.state = 'nicht_erledigt' then trim(new.reason) else '' end;
  if new.state = 'nicht_erledigt' and new.reason = '' then
    raise exception 'Bitte eine Begründung angeben, warum die Position nicht erledigt wurde';
  end if;
  if tg_op = 'UPDATE' then
    new.ticket_id := old.ticket_id;
    if auth.uid() is not null and not public.can_edit_positions(old.ticket_id)
       and (new.position_number is distinct from old.position_number
            or new.description is distinct from old.description
            or new.sort is distinct from old.sort) then
      raise exception 'Monteure dürfen Positionen nur abhaken';
    end if;
    if new.state is distinct from old.state or new.reason is distinct from old.reason then
      new.done_by := case when new.state <> 'offen' then auth.uid() end;
      new.done_at := case when new.state <> 'offen' then now() end;
    else
      new.done_by := old.done_by;
      new.done_at := old.done_at;
    end if;
  else
    new.state := 'offen';
    new.reason := '';
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;

-- Erledigt melden nur, wenn alle Positionen abgehakt sind
create function public.tickets_zz_positions_complete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'abgeschlossen' and old.status <> 'abgeschlossen' and new.ticket_type <> 'qm'
     and exists (select 1 from public.ticket_positions p where p.ticket_id = new.id and p.state = 'offen') then
    raise exception 'Bitte zuerst alle Positionen als erledigt oder nicht erledigt abhaken';
  end if;
  return new;
end;
$$;

create trigger tickets_zz_positions_complete
  before update of status on public.tickets
  for each row execute function public.tickets_zz_positions_complete();
