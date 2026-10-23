-- Reparaturaufträge: nach "Erledigt" automatisch "Zur Berechnung". QM und Teamleiter
-- tragen dann je Position einen Preis ein und schließen die Berechnung ab ("Berechnet").
-- Preise und Berechnungsstatus ändern nur die Funktionen set_position_price,
-- finish_billing und reopen_billing.

create type public.billing_state as enum ('keine', 'zur_berechnung', 'berechnet');

alter table public.tickets
  add column billing_state public.billing_state not null default 'keine',
  add column billed_at timestamptz,
  add column billed_by uuid references public.profiles (id) on delete set null;

alter table public.ticket_positions
  add column price numeric(10, 2) check (price >= 0);

-- Bereits erledigte Reparaturaufträge warten auf die Berechnung
update public.tickets set billing_state = 'zur_berechnung'
where ticket_type = 'reparatur' and status = 'abgeschlossen';

create or replace function public.tickets_zz_billing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.billing', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.billing_state := 'keine';
    new.billed_at := null;
    new.billed_by := null;
    return new;
  end if;
  new.billing_state := old.billing_state;
  new.billed_at := old.billed_at;
  new.billed_by := old.billed_by;
  if new.ticket_type = 'reparatur' and new.status = 'abgeschlossen' and old.status <> 'abgeschlossen' then
    new.billing_state := 'zur_berechnung';
  elsif new.status <> 'abgeschlossen' or new.ticket_type <> 'reparatur' then
    -- Wieder geöffnet (oder keine Reparatur mehr): Berechnung beginnt später neu
    new.billing_state := 'keine';
    new.billed_at := null;
    new.billed_by := null;
  end if;
  return new;
end;
$$;

create trigger tickets_zz_billing
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_billing();

create or replace function public.log_ticket_billing()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.billing_state = 'zur_berechnung' and old.billing_state = 'keine' then
    insert into public.ticket_events (ticket_id, actor, kind) values (new.id, auth.uid(), 'zur_berechnung');
  end if;
  return new;
end;
$$;

create trigger tickets_log_zz_billing
  after update on public.tickets
  for each row execute function public.log_ticket_billing();

-- Preis nur über set_position_price
create or replace function public.positions_zz_price()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_setting('app.billing', true) = 'on' then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.price := null;
  else
    new.price := old.price;
  end if;
  return new;
end;
$$;

create trigger positions_zz_price
  before insert or update on public.ticket_positions
  for each row execute function public.positions_zz_price();

create or replace function public.set_position_price(p_position_id bigint, p_price numeric)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
begin
  if public.my_role() not in ('admin', 'teamleiter') then
    raise exception 'Nur QM und Teamleiter können Preise eintragen';
  end if;
  select t.* into v_ticket from public.tickets t
    join public.ticket_positions p on p.ticket_id = t.id
    where p.id = p_position_id;
  if not found then
    raise exception 'Position nicht gefunden';
  end if;
  if v_ticket.billing_state <> 'zur_berechnung' then
    raise exception 'Preise können nur eingetragen werden, solange der Auftrag zur Berechnung steht';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'Der Preis darf nicht negativ sein';
  end if;
  perform set_config('app.billing', 'on', true);
  update public.ticket_positions set price = round(p_price, 2) where id = p_position_id;
  perform set_config('app.billing', 'off', true);
end;
$$;

create or replace function public.finish_billing(p_ticket_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_ticket public.tickets;
  v_sum numeric;
begin
  if public.my_role() not in ('admin', 'teamleiter') then
    raise exception 'Nur QM und Teamleiter können die Berechnung abschließen';
  end if;
  select * into v_ticket from public.tickets where id = p_ticket_id for update;
  if not found or v_ticket.billing_state <> 'zur_berechnung' then
    raise exception 'Der Auftrag steht nicht zur Berechnung';
  end if;
  if not exists (select 1 from public.ticket_positions where ticket_id = p_ticket_id) then
    raise exception 'Der Auftrag hat keine Positionen';
  end if;
  if exists (select 1 from public.ticket_positions where ticket_id = p_ticket_id and price is null) then
    raise exception 'Bitte bei allen Positionen einen Preis eintragen (0 € ist erlaubt)';
  end if;
  select sum(price) into v_sum from public.ticket_positions where ticket_id = p_ticket_id;

  perform set_config('app.billing', 'on', true);
  update public.tickets set billing_state = 'berechnet', billed_at = now(), billed_by = auth.uid()
  where id = p_ticket_id;
  perform set_config('app.billing', 'off', true);

  insert into public.ticket_events (ticket_id, actor, kind, details)
  values (p_ticket_id, auth.uid(), 'berechnet',
          'Summe ' || translate(to_char(v_sum, 'FM999,999,990.00'), ',.', '.,') || ' €');
end;
$$;

-- Nur Admins können eine abgeschlossene Berechnung wieder öffnen
create or replace function public.reopen_billing(p_ticket_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur QM/Admin kann die Berechnung wieder öffnen';
  end if;
  if not exists (select 1 from public.tickets where id = p_ticket_id and billing_state = 'berechnet') then
    raise exception 'Der Auftrag ist nicht berechnet';
  end if;
  perform set_config('app.billing', 'on', true);
  update public.tickets set billing_state = 'zur_berechnung', billed_at = null, billed_by = null
  where id = p_ticket_id;
  perform set_config('app.billing', 'off', true);
  insert into public.ticket_events (ticket_id, actor, kind) values (p_ticket_id, auth.uid(), 'berechnung_geoeffnet');
end;
$$;

revoke execute on function public.set_position_price(bigint, numeric) from public, anon;
revoke execute on function public.finish_billing(bigint) from public, anon;
revoke execute on function public.reopen_billing(bigint) from public, anon;
grant execute on function public.set_position_price(bigint, numeric) to authenticated;
grant execute on function public.finish_billing(bigint) to authenticated;
grant execute on function public.reopen_billing(bigint) to authenticated;
