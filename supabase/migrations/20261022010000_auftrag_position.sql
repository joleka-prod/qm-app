-- Auftrags- und Positionsnummer am Ticket.
-- Ändern dürfen: Admin, Ersteller solange das Ticket neu ist, und der verantwortliche Teamleiter.

alter table public.tickets
  add column order_number text not null default '',
  add column position_number text not null default '';

create index tickets_order_number_idx on public.tickets (order_number);

create or replace function public.tickets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.user_role := public.my_role();
begin
  if new.assigned_to is not null
     and not exists (select 1 from public.profiles
                     where id = new.assigned_to and role in ('teamleiter', 'admin') and active) then
    raise exception 'Verantwortlicher muss ein aktiver Teamleiter sein';
  end if;

  new.order_number := trim(new.order_number);
  new.position_number := trim(new.position_number);

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.cause := '';
    new.corrective_action := '';
    new.review_note := '';
    new.closed_at := null;
    new.status := case when new.assigned_to is null then 'neu' else 'zugewiesen' end;
    return new;
  end if;

  new.updated_at := now();
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if auth.uid() is null or v_role = 'admin' then
    -- Admin: darf alles; Status folgt der Zuweisung, wenn er nicht bewusst gesetzt wird.
    if new.assigned_to is distinct from old.assigned_to and new.status = old.status then
      if new.assigned_to is null then
        new.status := 'neu';
      elsif old.status = 'neu' then
        new.status := 'zugewiesen';
      end if;
    end if;
  elsif old.assigned_to = auth.uid() then
    -- Verantwortlicher Teamleiter: Ursache, Maßnahme, Auftrag/Position und Status-Fortschritt.
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.assigned_to is distinct from old.assigned_to
       or new.review_note is distinct from old.review_note then
      raise exception 'Teamleiter dürfen nur Ursache, Maßnahme, Auftrags- und Positionsnummer bearbeiten';
    end if;
    if old.status = 'abgeschlossen' then
      raise exception 'Ticket ist bereits abgeschlossen';
    end if;
    if new.status is distinct from old.status
       and not (new.status = 'in_bearbeitung' and old.status in ('zugewiesen', 'zur_pruefung'))
       and not (new.status = 'zur_pruefung' and old.status in ('zugewiesen', 'in_bearbeitung')) then
      raise exception 'Statuswechsel nicht erlaubt';
    end if;
    if new.status = old.status and old.status = 'zugewiesen'
       and (new.cause is distinct from old.cause or new.corrective_action is distinct from old.corrective_action) then
      new.status := 'in_bearbeitung';
    end if;
  elsif old.created_by = auth.uid() and old.status = 'neu' then
    -- Ersteller: darf sein Ticket korrigieren, solange es noch nicht zugewiesen ist.
    if new.status is distinct from old.status
       or new.assigned_to is distinct from old.assigned_to
       or new.cause is distinct from old.cause
       or new.corrective_action is distinct from old.corrective_action
       or new.review_note is distinct from old.review_note then
      raise exception 'Keine Berechtigung';
    end if;
  else
    raise exception 'Keine Berechtigung';
  end if;

  if new.status = 'zur_pruefung' and old.status <> 'zur_pruefung'
     and (length(trim(new.cause)) = 0 or length(trim(new.corrective_action)) = 0) then
    raise exception 'Ursache und Maßnahme müssen ausgefüllt sein';
  end if;
  if new.status in ('zugewiesen', 'in_bearbeitung', 'zur_pruefung') and new.assigned_to is null then
    raise exception 'Ticket braucht einen verantwortlichen Teamleiter';
  end if;

  new.closed_at := case when new.status = 'abgeschlossen' then coalesce(old.closed_at, now()) end;
  return new;
end;
$$;

-- Änderungen an Auftrag/Position im Verlauf festhalten.
create function public.log_ticket_reference()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.order_number is distinct from old.order_number
     or new.position_number is distinct from old.position_number then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'auftrag',
            concat_ws(' / ', nullif(new.order_number, ''), nullif(new.position_number, '')));
  end if;
  return new;
end;
$$;

create trigger tickets_log_reference
  after update on public.tickets
  for each row execute function public.log_ticket_reference();
