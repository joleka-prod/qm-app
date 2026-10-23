-- Termin mit dem Kunden: "Termin bei Kunde angemeldet" und "Termin von Kunde bestätigt"
-- für Restarbeiten, Beanstandungen und Reparaturaufträge. Gesetzt wird nur über die
-- Funktionen announce_appointment und confirm_appointment, der Verlauf hält alles fest.

create type public.appointment_state as enum ('offen', 'angemeldet', 'bestaetigt');

alter table public.tickets
  add column appointment_state public.appointment_state not null default 'offen',
  add column appointment_date date,
  add column appointment_time time,
  add column appointment_told_by uuid references public.profiles (id) on delete set null,
  add column appointment_announced_by uuid references public.profiles (id) on delete set null,
  add column appointment_announced_at timestamptz,
  add column appointment_note text not null default '',
  add column appointment_confirmed_by uuid references public.profiles (id) on delete set null,
  add column appointment_confirmed_at timestamptz;

-- Schützt die Felder: nur die beiden Funktionen dürfen sie ändern. Wird der geplante
-- Termin verschoben, ist die Anmeldung beim Kunden nicht mehr gültig.
create or replace function public.tickets_zz_appointment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.appointment', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.appointment_state := 'offen';
    new.appointment_date := null;
    new.appointment_time := null;
    new.appointment_told_by := null;
    new.appointment_announced_by := null;
    new.appointment_announced_at := null;
    new.appointment_note := '';
    new.appointment_confirmed_by := null;
    new.appointment_confirmed_at := null;
    return new;
  end if;
  new.appointment_state := old.appointment_state;
  new.appointment_date := old.appointment_date;
  new.appointment_time := old.appointment_time;
  new.appointment_told_by := old.appointment_told_by;
  new.appointment_announced_by := old.appointment_announced_by;
  new.appointment_announced_at := old.appointment_announced_at;
  new.appointment_note := old.appointment_note;
  new.appointment_confirmed_by := old.appointment_confirmed_by;
  new.appointment_confirmed_at := old.appointment_confirmed_at;
  if old.appointment_state <> 'offen'
     and new.status <> 'abgeschlossen'
     and (new.montage_date is distinct from old.montage_date
          or new.montage_time is distinct from old.montage_time) then
    new.appointment_state := 'offen';
    new.appointment_confirmed_by := null;
    new.appointment_confirmed_at := null;
  end if;
  return new;
end;
$$;

create trigger tickets_zz_appointment
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_appointment();

create or replace function public.log_ticket_appointment_reset()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if old.appointment_state <> 'offen' and new.appointment_state = 'offen' then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'termin_zurueckgesetzt', 'Planung geändert, Termin neu anmelden');
  end if;
  return new;
end;
$$;

create trigger tickets_log_appointment_reset
  after update on public.tickets
  for each row execute function public.log_ticket_appointment_reset();

create or replace function public.announce_appointment(
  p_ticket_id bigint,
  p_date date,
  p_time time,
  p_told_by uuid,
  p_note text default ''
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
  v_name text;
begin
  if public.my_role() not in ('admin', 'teamleiter') then
    raise exception 'Nur QM und Teamleiter können Termine beim Kunden anmelden';
  end if;
  select * into t from public.tickets where id = p_ticket_id for update;
  if not found or t.ticket_type = 'qm' then
    raise exception 'Auftrag nicht gefunden';
  end if;
  if t.status <> 'zugewiesen' or t.montage_date is null then
    raise exception 'Der Auftrag muss zuerst eingeplant sein';
  end if;
  if p_date is null then
    raise exception 'Bitte den mitgeteilten Termin angeben';
  end if;
  select full_name into v_name from public.profiles where id = p_told_by and active;
  if not found then
    raise exception 'Bitte angeben, wer den Termin mitgeteilt hat';
  end if;

  perform set_config('app.appointment', 'on', true);
  update public.tickets set
    appointment_state = 'angemeldet',
    appointment_date = p_date,
    appointment_time = p_time,
    appointment_told_by = p_told_by,
    appointment_announced_by = auth.uid(),
    appointment_announced_at = now(),
    appointment_note = trim(coalesce(p_note, '')),
    appointment_confirmed_by = null,
    appointment_confirmed_at = null
  where id = p_ticket_id;
  perform set_config('app.appointment', 'off', true);

  insert into public.ticket_events (ticket_id, actor, kind, details)
  values (p_ticket_id, auth.uid(), 'termin_angemeldet',
          concat_ws(', ',
                    concat_ws(' ', to_char(p_date, 'DD.MM.YYYY'), to_char(p_time, 'HH24:MI') || ' Uhr'),
                    'mitgeteilt von ' || coalesce(nullif(v_name, ''), 'unbekannt'),
                    nullif(trim(coalesce(p_note, '')), '')));
end;
$$;

create or replace function public.confirm_appointment(p_ticket_id bigint, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  t public.tickets;
begin
  if public.my_role() not in ('admin', 'teamleiter') then
    raise exception 'Nur QM und Teamleiter können die Bestätigung eintragen';
  end if;
  select * into t from public.tickets where id = p_ticket_id for update;
  if not found or t.ticket_type = 'qm' then
    raise exception 'Auftrag nicht gefunden';
  end if;
  if t.appointment_state <> 'angemeldet' then
    raise exception 'Der Termin muss zuerst beim Kunden angemeldet sein';
  end if;

  perform set_config('app.appointment', 'on', true);
  update public.tickets set
    appointment_state = 'bestaetigt',
    appointment_confirmed_by = auth.uid(),
    appointment_confirmed_at = now()
  where id = p_ticket_id;
  perform set_config('app.appointment', 'off', true);

  insert into public.ticket_events (ticket_id, actor, kind, details)
  values (p_ticket_id, auth.uid(), 'termin_bestaetigt',
          concat_ws(', ',
                    concat_ws(' ', to_char(t.appointment_date, 'DD.MM.YYYY'), to_char(t.appointment_time, 'HH24:MI') || ' Uhr'),
                    nullif(trim(coalesce(p_note, '')), '')));
end;
$$;

revoke execute on function public.announce_appointment(bigint, date, time, uuid, text) from public, anon;
revoke execute on function public.confirm_appointment(bigint, text) from public, anon;
grant execute on function public.announce_appointment(bigint, date, time, uuid, text) to authenticated;
grant execute on function public.confirm_appointment(bigint, text) to authenticated;
