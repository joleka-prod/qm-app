-- Monteure dürfen in ihren Einsätzen (Team am Montagetag, nicht erledigt) Positionen ergänzen.
-- Ändern und löschen bleibt den Planern vorbehalten; ergänzte Positionen stehen im Verlauf.

create policy "Monteure ergänzen Positionen"
  on public.ticket_positions for insert to authenticated
  with check (public.is_installer_of(ticket_id));

create or replace function public.positions_log_added()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.can_edit_positions(new.ticket_id) then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.ticket_id, auth.uid(), 'position_ergaenzt',
            'Pos. ' || new.position_number || ' – ' || left(new.description, 200));
  end if;
  return new;
end;
$$;

create trigger positions_zz_log_added
  after insert on public.ticket_positions
  for each row execute function public.positions_log_added();
