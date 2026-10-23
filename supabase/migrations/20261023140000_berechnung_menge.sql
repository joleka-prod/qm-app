-- Berechnung: Menge und Einheit je Position. "price" ist der Einzelpreis (netto),
-- der Positionsbetrag ist Menge × Einzelpreis.

alter table public.ticket_positions
  add column quantity numeric(10, 2) not null default 1 check (quantity > 0),
  add column unit text not null default 'Stk' check (length(unit) <= 20);

-- Menge und Einheit wie den Preis nur über die Berechnung ändern
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
    new.quantity := 1;
    new.unit := 'Stk';
  else
    new.price := old.price;
    new.quantity := old.quantity;
    new.unit := old.unit;
  end if;
  return new;
end;
$$;

create or replace function public.set_position_billing(
  p_position_id bigint,
  p_quantity numeric,
  p_unit text,
  p_price numeric
)
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
  if p_quantity is null or p_quantity <= 0 then
    raise exception 'Die Menge muss größer als 0 sein';
  end if;
  if length(trim(coalesce(p_unit, ''))) = 0 then
    raise exception 'Bitte eine Einheit angeben';
  end if;
  if p_price is not null and p_price < 0 then
    raise exception 'Der Preis darf nicht negativ sein';
  end if;
  perform set_config('app.billing', 'on', true);
  update public.ticket_positions
    set quantity = round(p_quantity, 2), unit = left(trim(p_unit), 20), price = round(p_price, 2)
    where id = p_position_id;
  perform set_config('app.billing', 'off', true);
end;
$$;

-- Summe jetzt Menge × Einzelpreis
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
  select sum(round(quantity * price, 2)) into v_sum from public.ticket_positions where ticket_id = p_ticket_id;

  perform set_config('app.billing', 'on', true);
  update public.tickets set billing_state = 'berechnet', billed_at = now(), billed_by = auth.uid()
  where id = p_ticket_id;
  perform set_config('app.billing', 'off', true);

  insert into public.ticket_events (ticket_id, actor, kind, details)
  values (p_ticket_id, auth.uid(), 'berechnet',
          'Summe ' || translate(to_char(v_sum, 'FM999,999,990.00'), ',.', '.,') || ' €');
end;
$$;

revoke execute on function public.set_position_billing(bigint, numeric, text, numeric) from public, anon;
grant execute on function public.set_position_billing(bigint, numeric, text, numeric) to authenticated;
