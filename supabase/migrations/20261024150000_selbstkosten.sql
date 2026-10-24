-- Selbstkosten einer abgeschlossenen Beanstandung (Fabian, 2026-10-24):
-- Fahrstrecke (km, hin und zurück) × 0,90 € + Arbeitszeit am Auftrag (alle Monteure) × 55,00 €/Std.
-- + Summe der Positionspreise (Menge × Einzelpreis). Ergebnis wird beim Klick auf "Selbstkosten berechnen"
-- gespeichert; nur Admin, Teamleiter und Disposition sehen und berechnen es.

create table if not exists public.ticket_costs (
  ticket_id bigint primary key references public.tickets (id) on delete cascade,
  km numeric(8, 1) not null,
  km_rate numeric(6, 2) not null,
  km_cost numeric(10, 2) not null,
  work_minutes int not null,
  hour_rate numeric(6, 2) not null,
  work_cost numeric(10, 2) not null,
  positions_cost numeric(10, 2) not null,
  positions_without_price int not null default 0,
  total numeric(10, 2) not null,
  calculated_by uuid references public.profiles (id) on delete set null,
  calculated_at timestamptz not null default now()
);

alter table public.ticket_costs enable row level security;

drop policy if exists "Planer sehen Selbstkosten" on public.ticket_costs;
create policy "Planer sehen Selbstkosten" on public.ticket_costs
  for select to authenticated
  using (public.my_role()::text in ('admin', 'teamleiter', 'disposition'));

create or replace function public.calc_self_cost(p_ticket_id bigint)
returns public.ticket_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_km_rate constant numeric := 0.90;
  c_hour_rate constant numeric := 55.00;
  t public.tickets;
  v_min int;
  v_pos numeric;
  v_missing int;
  r public.ticket_costs;
begin
  if coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter', 'disposition') then
    raise exception 'Selbstkosten berechnen nur Admin, Teamleiter und Disposition';
  end if;
  select * into t from public.tickets where id = p_ticket_id;
  if not found or t.ticket_type <> 'beanstandung' then
    raise exception 'Selbstkosten gibt es nur bei Beanstandungen';
  end if;
  if t.status <> 'abgeschlossen' then
    raise exception 'Die Beanstandung ist noch nicht abgeschlossen';
  end if;
  if t.distance_km is null then
    raise exception 'Die Fahrstrecke ist noch nicht berechnet';
  end if;

  select coalesce(sum(extract(epoch from (e.ended_at - e.started_at)) / 60), 0)::int into v_min
  from public.time_entries e
  where e.ticket_id = p_ticket_id and e.kind = 'arbeit' and e.ended_at is not null;

  select coalesce(sum(p.quantity * p.price), 0), count(*) filter (where p.price is null)
  into v_pos, v_missing
  from public.ticket_positions p where p.ticket_id = p_ticket_id;

  insert into public.ticket_costs as c (ticket_id, km, km_rate, km_cost, work_minutes, hour_rate, work_cost,
                                        positions_cost, positions_without_price, total, calculated_by, calculated_at)
  values (p_ticket_id, t.distance_km, c_km_rate, round(t.distance_km * c_km_rate, 2), v_min, c_hour_rate,
          round(v_min / 60.0 * c_hour_rate, 2), round(v_pos, 2), v_missing,
          round(t.distance_km * c_km_rate, 2) + round(v_min / 60.0 * c_hour_rate, 2) + round(v_pos, 2),
          auth.uid(), now())
  on conflict (ticket_id) do update set
    km = excluded.km, km_rate = excluded.km_rate, km_cost = excluded.km_cost,
    work_minutes = excluded.work_minutes, hour_rate = excluded.hour_rate, work_cost = excluded.work_cost,
    positions_cost = excluded.positions_cost, positions_without_price = excluded.positions_without_price,
    total = excluded.total, calculated_by = excluded.calculated_by, calculated_at = excluded.calculated_at
  returning * into r;

  insert into public.ticket_events (ticket_id, actor, kind, details)
  values (p_ticket_id, auth.uid(), 'selbstkosten', replace(to_char(r.total, 'FM999999990.00'), '.', ',') || ' €');
  return r;
end;
$$;

revoke execute on function public.calc_self_cost(bigint) from public, anon;
grant execute on function public.calc_self_cost(bigint) to authenticated;
