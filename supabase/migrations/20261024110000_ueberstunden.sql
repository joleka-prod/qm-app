-- Überstundenkonto (Fabian, 2026-10-24): Soll aus der Wochenarbeitszeit (Mo–Fr, ohne Feiertage RLP und
-- genehmigten Urlaub), Ist aus der Stempeluhr (attendance), plus Übertrag. Gerechnet bis einschließlich gestern.

alter table public.profiles
  add column if not exists weekly_hours numeric(4, 1) not null default 40
    check (weekly_hours >= 0 and weekly_hours <= 60),
  add column if not exists overtime_start date not null default current_date,
  add column if not exists overtime_opening numeric(6, 2) not null default 0
    check (overtime_opening between -999 and 999);

-- Nur der Admin pflegt Wochenstunden, Startdatum und Übertrag
create or replace function public.profiles_zz_overtime_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null and not public.is_admin()
     and (new.weekly_hours is distinct from old.weekly_hours
          or new.overtime_start is distinct from old.overtime_start
          or new.overtime_opening is distinct from old.overtime_opening) then
    raise exception 'Wochenstunden und Überstunden-Übertrag pflegt nur der Admin';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_zz_overtime_guard on public.profiles;
create trigger profiles_zz_overtime_guard
  before update on public.profiles
  for each row execute function public.profiles_zz_overtime_guard();

create or replace function public.overtime_balance(p_user uuid, p_until date default null)
returns table (since date, until date, target_min int, actual_min int, opening_min int, balance_min int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_p public.profiles;
  v_until date := coalesce(p_until, (now() at time zone 'Europe/Berlin')::date - 1);
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

  -- Solltage: Mo–Fr, kein Feiertag, kein genehmigter Urlaub
  select count(*) into v_days
  from generate_series(v_p.overtime_start, v_until, interval '1 day') g(d)
  where extract(isodow from g.d) <= 5
    and not public.is_holiday_rlp(g.d::date)
    and not exists (
      select 1 from public.vacation_requests v
      where v.user_id = p_user and v.state = 'genehmigt' and g.d::date between v.start_date and v.end_date
    );

  select coalesce(sum(extract(epoch from (a.ended_at - a.started_at)) / 60), 0)::int into v_actual
  from public.attendance a
  where a.installer_id = p_user
    and a.ended_at is not null
    and (a.started_at at time zone 'Europe/Berlin')::date between v_p.overtime_start and v_until;

  since := v_p.overtime_start;
  until := v_until;
  target_min := round(v_days * v_p.weekly_hours * 60 / 5)::int;
  actual_min := v_actual;
  opening_min := round(v_p.overtime_opening * 60)::int;
  balance_min := opening_min + actual_min - target_min;
  return next;
end;
$$;

revoke execute on function public.overtime_balance(uuid, date) from public, anon;
grant execute on function public.overtime_balance(uuid, date) to authenticated;
