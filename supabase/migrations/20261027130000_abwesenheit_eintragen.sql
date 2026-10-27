-- Abwesenheiten durch Vorgesetzte (Fabian, 2026-10-27): Teamleiter bzw. Vorgesetzte und der Admin tragen
-- für ihre Mitarbeiter Krankheit, Sonderurlaub (sonstige bezahlte Abwesenheit) und Feiertag direkt ein.
-- Solche Einträge sind sofort genehmigt. Neue Art 'feiertag' für Feiertage, die nicht schon als gesetzlicher
-- Feiertag in Rheinland-Pfalz automatisch zählen (is_holiday_rlp); sie mindert das Soll wie Krankheit.

alter table public.vacation_requests drop constraint if exists vacation_requests_kind_check;
alter table public.vacation_requests
  add constraint vacation_requests_kind_check check (kind in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub', 'feiertag'));

create or replace function public.enter_absence(
  p_user uuid, p_start date, p_end date, p_kind text, p_note text default '', p_half boolean default false
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days numeric;
  v_id bigint;
begin
  if not public.can_decide_vacation(p_user) then
    raise exception 'Abwesenheiten trägt der Vorgesetzte oder der Admin ein (nicht für sich selbst)';
  end if;
  if coalesce(p_kind, '') not in ('krank', 'sonderurlaub', 'feiertag') then
    raise exception 'Bitte Krank, Sonderurlaub oder Feiertag wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Bitte Zeiträume über den Jahreswechsel in zwei Einträgen erfassen';
  end if;
  v_days := public.vacation_workdays(p_start, p_end);
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine Arbeitstage (Wochenende oder gesetzlicher Feiertag in Rheinland-Pfalz)';
  end if;
  if coalesce(p_half, false) then
    if v_days <> 1 then
      raise exception 'Einen halben Tag bitte nur für einen einzelnen Arbeitstag eintragen';
    end if;
    v_days := 0.5;
  end if;
  if exists (
    select 1 from public.vacation_requests
    where user_id = p_user and state in ('beantragt', 'genehmigt')
      and start_date <= p_end and end_date >= p_start
  ) then
    raise exception 'In diesem Zeitraum gibt es schon Urlaub oder eine Abwesenheit. Bitte diese zuerst stornieren.';
  end if;
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state, decided_by, decided_at, decision_note)
  values (p_user, p_start, p_end, v_days, left(trim(coalesce(p_note, '')), 300), p_kind, 'genehmigt', auth.uid(), now(), 'eingetragen')
  returning id into v_id;
  return v_id;
end;
$$;

revoke execute on function public.enter_absence(uuid, date, date, text, text, boolean) from public, anon;
grant execute on function public.enter_absence(uuid, date, date, text, text, boolean) to authenticated;

-- Überstundenkonto: eingetragene Feiertage mindern das Soll
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
  v_days numeric;
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

  -- Solltage: Mo–Fr, kein gesetzlicher Feiertag; genehmigter Urlaub, Krankheit, Sonderurlaub und
  -- eingetragene Feiertage mindern das Soll (halbe Tage anteilig). Überstunden-Freizeit bleibt Soll.
  select coalesce(sum(1 - least(1, coalesce((
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date), 0))
           from public.vacation_requests v
           where v.user_id = p_user and v.state = 'genehmigt' and v.kind in ('urlaub', 'krank', 'sonderurlaub', 'feiertag')
             and g.d::date between v.start_date and v.end_date), 0))), 0)
    into v_days
  from generate_series(v_p.overtime_start, v_until, interval '1 day') g(d)
  where extract(isodow from g.d) <= 5
    and not public.is_holiday_rlp(g.d::date);

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
