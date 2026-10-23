-- Mehrere Positionen pro Einsatz (Restarbeit, Beanstandung, Reparaturauftrag).
-- Positionen anlegen/ändern/löschen: QM/Admin, Teamleiter (solange nicht erledigt)
-- und der Ersteller, solange der Einsatz ungeplant ist. Der Monteur hakt Positionen ab.

create table public.ticket_positions (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  sort integer not null default 0,
  position_number text not null default '',
  description text not null default '',
  done boolean not null default false,
  done_by uuid references public.profiles (id),
  done_at timestamptz,
  created_at timestamptz not null default now(),
  check (length(trim(position_number)) > 0 or length(trim(description)) > 0)
);

create index ticket_positions_ticket_idx on public.ticket_positions (ticket_id, sort);

-- Bisherige einzelne Positionsnummer von Einsätzen übernehmen
insert into public.ticket_positions (ticket_id, position_number)
select id, position_number from public.tickets
where ticket_type <> 'qm' and length(trim(position_number)) > 0;

update public.tickets set position_number = '' where ticket_type <> 'qm';

create function public.can_edit_positions(p_ticket_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and t.ticket_type <> 'qm'
      and (
        public.my_role() = 'admin'
        or (public.my_role() = 'teamleiter' and t.status <> 'abgeschlossen')
        or (t.created_by = auth.uid() and t.status = 'neu')
      )
  )
$$;

create function public.is_installer_of(p_ticket_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id and t.installer_id = auth.uid() and t.status <> 'abgeschlossen'
  )
$$;

alter table public.ticket_positions enable row level security;

create policy "Positionen sehen"
  on public.ticket_positions for select to authenticated
  using (public.can_view_ticket(ticket_id));

create policy "Positionen anlegen"
  on public.ticket_positions for insert to authenticated
  with check (public.can_edit_positions(ticket_id));

create policy "Positionen ändern oder abhaken"
  on public.ticket_positions for update to authenticated
  using (public.can_edit_positions(ticket_id) or public.is_installer_of(ticket_id))
  with check (public.can_edit_positions(ticket_id) or public.is_installer_of(ticket_id));

create policy "Positionen löschen"
  on public.ticket_positions for delete to authenticated
  using (public.can_edit_positions(ticket_id));

-- Monteure dürfen nur abhaken; Erledigt-Vermerk wird automatisch gesetzt.
create function public.positions_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.position_number := trim(new.position_number);
  new.description := trim(new.description);
  if tg_op = 'UPDATE' then
    new.ticket_id := old.ticket_id;
    if auth.uid() is not null and not public.can_edit_positions(old.ticket_id)
       and (new.position_number is distinct from old.position_number
            or new.description is distinct from old.description
            or new.sort is distinct from old.sort) then
      raise exception 'Monteure dürfen Positionen nur abhaken';
    end if;
    if new.done is distinct from old.done then
      new.done_by := case when new.done then auth.uid() end;
      new.done_at := case when new.done then now() end;
    else
      new.done_by := old.done_by;
      new.done_at := old.done_at;
    end if;
  else
    new.done := false;
    new.done_by := null;
    new.done_at := null;
  end if;
  return new;
end;
$$;

create trigger positions_guard
  before insert or update on public.ticket_positions
  for each row execute function public.positions_guard();
