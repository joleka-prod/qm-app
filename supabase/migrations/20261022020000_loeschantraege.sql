-- Löschanträge: Nicht-Admins können das Löschen eines Tickets mit Begründung beantragen.
-- Gelöscht wird erst, wenn QM/Admin den Antrag freigibt (Löschen des Tickets).
-- Ablehnen = Admin löscht den Antrag; Zurückziehen = Antragsteller löscht ihn.

create table public.deletion_requests (
  ticket_id bigint primary key references public.tickets (id) on delete cascade,
  requested_by uuid not null default auth.uid() references public.profiles (id),
  reason text not null check (length(trim(reason)) > 0),
  created_at timestamptz not null default now()
);

alter table public.deletion_requests enable row level security;

create policy "Löschanträge sehen"
  on public.deletion_requests for select to authenticated
  using (public.can_view_ticket(ticket_id));

create policy "Löschung beantragen"
  on public.deletion_requests for insert to authenticated
  with check (
    requested_by = auth.uid()
    and public.can_view_ticket(ticket_id)
    and exists (
      select 1 from public.tickets t
      where t.id = ticket_id
        and (t.created_by = auth.uid() or t.assigned_to = auth.uid() or public.my_role() in ('teamleiter', 'admin'))
    )
  );

create policy "Antrag ablehnen oder zurückziehen"
  on public.deletion_requests for delete to authenticated
  using (requested_by = auth.uid() or public.is_admin());

create function public.log_deletion_request()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.ticket_id, auth.uid(), 'loeschantrag', new.reason);
    return new;
  end if;
  -- Beim Löschen des Tickets selbst (Freigabe) gibt es nichts mehr zu protokollieren.
  if exists (select 1 from public.tickets where id = old.ticket_id) then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (old.ticket_id, auth.uid(),
            case when old.requested_by = auth.uid() then 'loeschantrag_zurueck' else 'loeschantrag_abgelehnt' end,
            '');
  end if;
  return old;
end;
$$;

create trigger deletion_requests_log
  after insert or delete on public.deletion_requests
  for each row execute function public.log_deletion_request();
