-- Urlaubsverwaltung: Anspruch je Benutzer (Admin pflegt), Anträge der Mitarbeiter,
-- Genehmigung durch den verantwortlichen Vorgesetzten (auch über mehrere Ebenen) oder den Admin.
-- Urlaubstage = Werktage Mo–Fr ohne gesetzliche Feiertage in Rheinland-Pfalz.

alter table public.profiles
  add column vacation_days numeric(4,1) not null default 0 check (vacation_days between 0 and 366);

-- Ostersonntag (Gauß/Anonymer gregorianischer Algorithmus)
create or replace function public.easter_sunday(p_year int)
returns date
language plpgsql
immutable
set search_path = ''
as $$
declare
  a int := p_year % 19;
  b int := p_year / 100;
  c int := p_year % 100;
  d int := b / 4;
  e int := b % 4;
  f int := (b + 8) / 25;
  g int := (b - f + 1) / 3;
  h int := (19 * a + b - d - g + 15) % 30;
  i int := c / 4;
  k int := c % 4;
  l int := (32 + 2 * e + 2 * i - h - k) % 7;
  m int := (a + 11 * h + 22 * l) / 451;
  mon int := (h + l - 7 * m + 114) / 31;
  day int := ((h + l - 7 * m + 114) % 31) + 1;
begin
  return make_date(p_year, mon, day);
end;
$$;

-- Gesetzliche Feiertage Rheinland-Pfalz
create or replace function public.is_holiday_rlp(p_day date)
returns boolean
language sql
immutable
set search_path = ''
as $$
  with e as (select public.easter_sunday(extract(year from p_day)::int) as d)
  select to_char(p_day, 'MM-DD') in ('01-01', '05-01', '10-03', '11-01', '12-25', '12-26')
      or p_day in (select d - 2 from e union all select d + 1 from e union all select d + 39 from e
                   union all select d + 50 from e union all select d + 60 from e);
$$;

-- Urlaubstage zwischen zwei Daten (Mo–Fr, ohne Feiertage)
create or replace function public.vacation_workdays(p_start date, p_end date)
returns int
language sql
immutable
set search_path = ''
as $$
  select count(*)::int
  from generate_series(p_start, p_end, interval '1 day') g(d)
  where extract(isodow from g.d) < 6 and not public.is_holiday_rlp(g.d::date);
$$;

create type public.vacation_state as enum ('beantragt', 'genehmigt', 'abgelehnt', 'storniert');

create table public.vacation_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  start_date date not null,
  end_date date not null,
  days int not null,
  note text not null default '' check (length(note) <= 300),
  state public.vacation_state not null default 'beantragt',
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '' check (length(decision_note) <= 300),
  created_at timestamptz not null default now(),
  check (end_date >= start_date)
);

create index vacation_requests_user_idx on public.vacation_requests (user_id, start_date);

alter table public.vacation_requests enable row level security;

-- Sehen: eigene, die der eigenen Mitarbeiter; QM und Teamleiter alle (Einsatzplanung).
-- Schreiben nur über die Funktionen unten.
create policy "Urlaub sehen"
  on public.vacation_requests for select to authenticated
  using (user_id = auth.uid() or public.my_role() in ('admin', 'teamleiter') or public.is_supervisor_of(user_id));

-- Darf der angemeldete Benutzer über Anträge von p_user entscheiden?
create or replace function public.can_decide_vacation(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_user <> auth.uid() and (public.is_admin() or public.is_supervisor_of(p_user));
$$;

create or replace function public.request_vacation(p_start date, p_end date, p_note text default '')
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
  insert into public.vacation_requests (user_id, start_date, end_date, days, note)
  values (auth.uid(), p_start, p_end, v_days, trim(coalesce(p_note, '')))
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.decide_vacation(p_id bigint, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.vacation_requests;
begin
  select * into r from public.vacation_requests where id = p_id for update;
  if not found then
    raise exception 'Antrag nicht gefunden';
  end if;
  if not public.can_decide_vacation(r.user_id) then
    raise exception 'Über diesen Antrag entscheidet der Vorgesetzte';
  end if;
  if r.state <> 'beantragt' then
    raise exception 'Über diesen Antrag wurde bereits entschieden';
  end if;
  update public.vacation_requests
  set state = case when p_approve then 'genehmigt'::public.vacation_state else 'abgelehnt'::public.vacation_state end,
      decided_by = auth.uid(), decided_at = now(), decision_note = trim(coalesce(p_note, ''))
  where id = p_id;
end;
$$;

-- Zurückziehen: eigener offener Antrag; genehmigten Urlaub storniert nur Vorgesetzter oder Admin
create or replace function public.cancel_vacation(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.vacation_requests;
begin
  select * into r from public.vacation_requests where id = p_id for update;
  if not found then
    raise exception 'Antrag nicht gefunden';
  end if;
  if r.state = 'beantragt' and r.user_id = auth.uid() then
    null;
  elsif r.state in ('beantragt', 'genehmigt') and public.can_decide_vacation(r.user_id) then
    null;
  else
    raise exception 'Diesen Antrag kannst du nicht zurückziehen';
  end if;
  update public.vacation_requests
  set state = 'storniert', decided_by = auth.uid(), decided_at = now()
  where id = p_id;
end;
$$;

revoke execute on function public.request_vacation(date, date, text) from public, anon;
revoke execute on function public.decide_vacation(bigint, boolean, text) from public, anon;
revoke execute on function public.cancel_vacation(bigint) from public, anon;
revoke execute on function public.can_decide_vacation(uuid) from public, anon;
grant execute on function public.request_vacation(date, date, text) to authenticated;
grant execute on function public.decide_vacation(bigint, boolean, text) to authenticated;
grant execute on function public.cancel_vacation(bigint) to authenticated;
grant execute on function public.can_decide_vacation(uuid) to authenticated;
grant execute on function public.vacation_workdays(date, date) to authenticated;

-- Urlaubsanspruch ändert nur der Admin
create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_up uuid;
  v_depth int := 0;
begin
  -- Keine Kreise: der Vorgesetzte darf nicht selbst (indirekt) unter dieser Person stehen
  if new.supervisor_id is not null and new.supervisor_id is distinct from old.supervisor_id then
    v_up := new.supervisor_id;
    while v_up is not null and v_depth < 20 loop
      if v_up = new.id then
        raise exception 'Diese Person steht bereits unter dem gewählten Vorgesetzten (Kreis)';
      end if;
      select supervisor_id into v_up from public.profiles where id = v_up;
      v_depth := v_depth + 1;
    end loop;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  new.full_name := trim(new.full_name);
  if new.email is distinct from old.email then
    raise exception 'Die E-Mail-Adresse kann nur über die Benutzerverwaltung geändert werden';
  end if;
  if public.is_admin() then
    if new.id = auth.uid() and (new.role is distinct from old.role or not new.active) then
      raise exception 'Die eigene Rolle und den eigenen Zugang kannst du nicht ändern';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active then
    raise exception 'Nur Admins dürfen Rolle oder Status ändern';
  end if;
  if new.supervisor_id is distinct from old.supervisor_id then
    raise exception 'Nur Admins dürfen den Vorgesetzten ändern';
  end if;
  if new.vacation_days is distinct from old.vacation_days then
    raise exception 'Nur Admins dürfen den Urlaubsanspruch ändern';
  end if;
  return new;
end;
$$;
