-- Verlauf "Termin mit dem Kunden": Aufheben der Anmeldung nach dem Eintrag "Eingeplant"
-- protokollieren (Trigger laufen alphabetisch) und den alten und neuen Termin nennen.

create or replace function public.log_ticket_appointment_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.appointment_state <> 'offen' and new.appointment_state = 'offen' then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'termin_zurueckgesetzt',
            concat('Termin geändert von ',
                   coalesce(concat_ws(' ', to_char(old.montage_date, 'DD.MM.YYYY'), to_char(old.montage_time, 'HH24:MI') || ' Uhr'), '–'),
                   ' auf ',
                   coalesce(nullif(concat_ws(' ', to_char(new.montage_date, 'DD.MM.YYYY'), to_char(new.montage_time, 'HH24:MI') || ' Uhr'), ''), 'ungeplant'),
                   ', Kunde muss neu informiert werden'));
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_log_appointment_reset on public.tickets;
create trigger tickets_log_zz_appointment_reset
  after update on public.tickets
  for each row execute function public.log_ticket_appointment_reset();
