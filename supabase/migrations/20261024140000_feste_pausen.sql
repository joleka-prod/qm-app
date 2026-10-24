-- Feste Pausen (Fabian, 2026-10-24): Frühstück 09:00–09:15 und Mittag 12:00–12:30 (deutsche Zeit) werden jeden
-- Tag automatisch von der gestempelten Zeit abgezogen, soweit man in dieser Zeit eingestempelt war.
-- Muss zu FIXED_BREAKS in src/lib/clock.ts passen.

create or replace function public.fixed_break_minutes(p_start timestamptz, p_end timestamptz)
returns numeric
language sql
immutable
set search_path = ''
as $$
  select coalesce(sum(greatest(0, extract(epoch from
           least(p_end, (g.d::date + w.t_to) at time zone 'Europe/Berlin')
           - greatest(p_start, (g.d::date + w.t_from) at time zone 'Europe/Berlin')))), 0) / 60
  from generate_series((p_start at time zone 'Europe/Berlin')::date, (p_end at time zone 'Europe/Berlin')::date, interval '1 day') g(d)
  cross join (values (time '09:00', time '09:15'), (time '12:00', time '12:30')) w(t_from, t_to)
$$;

grant execute on function public.fixed_break_minutes(timestamptz, timestamptz) to authenticated;

create or replace function public.overtime_balance(p_user uuid, p_until date default null)
returns table (
  since date, until date, target_min int, actual_min int, opening_min int, balance_min int,
  planned_min int, requested_min int
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
  v_until date := coalesce(p_until, (now() at time zone 'Europe/Berlin')::date - 1);
  v_daily numeric;
  v_days int;
  v_actual int;
begin
  if not (p_user = auth.uid()
          or coalesce(public.my_role()::text, '') in ('admin', 'teamleiter', 'disposition')
          or public.is_supervisor_of(p_user)) then
    raise exception 'Keine Berechtigung';
  end if;
  select * into v_p from public.profiles where id = p_user;
  if not found then
    raise exception 'Benutzer nicht gefunden';
  end if;
  v_daily := v_p.weekly_hours * 60 / 5;

  -- Solltage: Mo–Fr, kein Feiertag, kein genehmigter Urlaub (Überstunden-Freizeit bleibt Soll)
  select count(*) into v_days
  from generate_series(v_p.overtime_start, v_until, interval '1 day') g(d)
  where extract(isodow from g.d) <= 5
    and not public.is_holiday_rlp(g.d::date)
    and not exists (
      select 1 from public.vacation_requests v
      where v.user_id = p_user and v.state = 'genehmigt' and v.kind = 'urlaub'
        and g.d::date between v.start_date and v.end_date
    );

  -- Ist: gestempelte Zeit ohne die festen Pausen
  select coalesce(sum(extract(epoch from (a.ended_at - a.started_at)) / 60
                      - public.fixed_break_minutes(a.started_at, a.ended_at)), 0)::int into v_actual
  from public.attendance a
  where a.installer_id = p_user
    and a.ended_at is not null
    and (a.started_at at time zone 'Europe/Berlin')::date between v_p.overtime_start and v_until;

  since := v_p.overtime_start;
  until := v_until;
  target_min := round(v_days * v_daily)::int;
  actual_min := v_actual;
  opening_min := round(v_p.overtime_opening * 60)::int;
  balance_min := opening_min + actual_min - target_min;

  -- Künftige Freizeit über Überstunden (ab heute), genehmigt bzw. noch beantragt
  select
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date))
          filter (where v.state = 'genehmigt'), 0) * v_daily)::int,
    round(coalesce(sum(public.vacation_workdays(greatest(v.start_date, v_until + 1), v.end_date))
          filter (where v.state = 'beantragt'), 0) * v_daily)::int
  into planned_min, requested_min
  from public.vacation_requests v
  where v.user_id = p_user and v.kind = 'ueberstunden' and v.end_date > v_until
    and v.state in ('genehmigt', 'beantragt');
  return next;
end;
$$;
