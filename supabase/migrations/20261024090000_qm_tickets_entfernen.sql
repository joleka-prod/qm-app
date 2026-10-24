-- QM-Tickets werden nicht mehr verwendet (Fabian, 2026-10-24): alle vorhandenen QM-Tickets löschen
-- (Verlauf, Fotos-Einträge, Positionen, Zeiten und Löschanträge hängen per ON DELETE CASCADE daran)
-- und neue QM-Tickets verhindern. Alle anderen Aufträge bleiben unverändert.
-- Hinweis: Die Fotodateien im Speicher (Bucket ticket-photos, Ordner = Ticketnummer) lassen sich per SQL
-- nicht löschen; sie können bei Bedarf in Supabase unter Storage entfernt werden.

delete from public.tickets where ticket_type = 'qm';

create or replace function public.tickets_no_qm()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticket_type = 'qm' then
    raise exception 'QM-Tickets gibt es nicht mehr. Bitte eine andere Auftragsart wählen.';
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_a_no_qm on public.tickets;
create trigger tickets_a_no_qm
  before insert or update of ticket_type on public.tickets
  for each row execute function public.tickets_no_qm();

alter table public.tickets alter column ticket_type set default 'restarbeit';
