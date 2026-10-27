-- Abwesenheiten aus TimeTac (Fabian, 2026-10-27): neben Urlaub und Überstunden-Freizeit gibt es jetzt
-- Krankheit und Sonderurlaub (sonstige bezahlte Freistellung). Beide zählen nicht gegen den Urlaubsanspruch,
-- mindern aber wie Urlaub die Soll-Zeit. Halbe Tage sind möglich (days als Dezimalzahl).

alter table public.vacation_requests drop constraint if exists vacation_requests_kind_check;
alter table public.vacation_requests
  add constraint vacation_requests_kind_check check (kind in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub'));
alter table public.vacation_requests alter column days type numeric(5,1);

-- Import (nur Admin): bereits genehmigte Abwesenheiten übernehmen, Überschneidungen überspringen
create or replace function public.import_absences(p_user uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  s date;
  e date;
  d numeric;
  k text;
  v_in int := 0;
  v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'App-Benutzer nicht gefunden';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      s := (r ->> 'start')::date;
      e := (r ->> 'end')::date;
      d := round((r ->> 'days')::numeric * 2) / 2;
      k := r ->> 'kind';
    exception when others then
      v_skip := v_skip + 1;
      continue;
    end;
    if s is null or e is null or e < s or extract(year from s) <> extract(year from e)
       or d is null or d <= 0 or k not in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub')
       or exists (select 1 from public.vacation_requests v
                   where v.user_id = p_user and v.state in ('beantragt', 'genehmigt')
                     and v.start_date <= e and v.end_date >= s) then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state, decided_by, decided_at, decision_note)
    values (p_user, s, e, d, left(trim('TimeTac ' || coalesce(r ->> 'note', '')), 300), k, 'genehmigt', auth.uid(), now(), 'aus TimeTac übernommen');
    v_in := v_in + 1;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end;
$$;

revoke execute on function public.import_absences(uuid, jsonb) from public, anon;
grant execute on function public.import_absences(uuid, jsonb) to authenticated;

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

  -- Solltage: Mo–Fr, kein Feiertag; genehmigter Urlaub, Krankheit und Sonderurlaub mindern das Soll
  -- (halbe Tage anteilig). Überstunden-Freizeit bleibt Soll.
  select coalesce(sum(1 - least(1, coalesce((
           select sum(v.days / nullif(public.vacation_workdays(v.start_date, v.end_date), 0))
           from public.vacation_requests v
           where v.user_id = p_user and v.state = 'genehmigt' and v.kind in ('urlaub', 'krank', 'sonderurlaub')
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
