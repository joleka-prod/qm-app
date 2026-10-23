-- Monteure können eine abgehakte Position nicht wieder auf "offen" setzen,
-- nur zwischen "erledigt" und "nicht erledigt" wechseln.

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
    if auth.uid() is not null and not public.can_edit_positions(old.ticket_id) then
      if new.position_number is distinct from old.position_number
         or new.description is distinct from old.description
         or new.sort is distinct from old.sort then
        raise exception 'Monteure dürfen Positionen nur abhaken';
      end if;
      if new.state = 'offen' and old.state <> 'offen' then
        raise exception 'Eine Position muss erledigt oder nicht erledigt sein';
      end if;
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
