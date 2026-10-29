-- Neue Selbstkostensätze (Fabian, 2026-10-29): 0,39 € je Kilometer, 42,00 € je Stunde.
-- Gilt für jede neue Berechnung; bereits gespeicherte Ergebnisse werden einmalig umgerechnet (Fabian, 2026-10-29).

create or replace function public.calc_self_cost(p_ticket_id bigint)
returns public.ticket_costs
language plpgsql
security definer
set search_path = ''
as $$
declare
  c_km_rate constant numeric := 0.39;
  c_hour_rate constant numeric := 42.00;
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

-- Gespeicherte Ergebnisse mit den neuen Sätzen umrechnen (km, Arbeitszeit und Positionen bleiben wie berechnet)
update public.ticket_costs set
  km_rate = 0.39,
  km_cost = round(km * 0.39, 2),
  hour_rate = 42.00,
  work_cost = round(work_minutes / 60.0 * 42.00, 2),
  total = round(km * 0.39, 2) + round(work_minutes / 60.0 * 42.00, 2) + positions_cost
where km_rate <> 0.39 or hour_rate <> 42.00;
