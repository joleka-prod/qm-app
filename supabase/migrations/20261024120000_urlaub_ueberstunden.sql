-- Freizeit über Überstunden (Fabian, 2026-10-24): Beim Antrag wählt man Urlaubstage oder Überstunden.
-- Überstunden-Tage zählen nicht gegen den Urlaubsanspruch, sondern bleiben Soll-Tage und mindern so
-- das Überstundenkonto. Verplante (künftige) Überstunden-Tage zeigt overtime_balance gesondert an.

alter table public.vacation_requests
  add column if not exists kind text not null default 'urlaub' check (kind in ('urlaub', 'ueberstunden'));

drop function if exists public.request_vacation(date, date, text);
create or replace function public.request_vacation(p_start date, p_end date, p_note text default '', p_kind text default 'urlaub')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int;
  v_id bigint;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if coalesce(p_kind, '') not in ('urlaub', 'ueberstunden') then
    raise exception 'Bitte Urlaubstage oder Überstunden wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if extract(year from p_start) <> extract(year from p_end) then
    raise exception 'Bitte Urlaub über den Jahreswechsel in zwei Anträgen stellen';
  end if;
  v_days := public.vacation_workdays(p_start, p_end);
  if v_days = 0 then
    raise exception 'Im gewählten Zeitraum liegen keine Arbeitstage';
  end if;
  if exists (
    select 1 from public.vacation_requests
    where user_id = auth.uid() and state in ('beantragt', 'genehmigt')
      and start_date <= p_end and end_date >= p_start
  ) then
    raise exception 'Für diesen Zeitraum gibt es schon einen Urlaubsantrag';
  end if;
  insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind)
  values (auth.uid(), p_start, p_end, v_days, trim(coalesce(p_note, '')), p_kind)
  returning id into v_id;
  return v_id;
end;
$$;
revoke execute on function public.request_vacation(date, date, text, text) from public, anon;
grant execute on function public.request_vacation(date, date, text, text) to authenticated;

drop function if exists public.overtime_balance(uuid, date);
create function public.overtime_balance(p_user uuid, p_until date default null)
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

  select coalesce(sum(extract(epoch from (a.ended_at - a.started_at)) / 60), 0)::int into v_actual
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

revoke execute on function public.overtime_balance(uuid, date) from public, anon;
grant execute on function public.overtime_balance(uuid, date) to authenticated;
