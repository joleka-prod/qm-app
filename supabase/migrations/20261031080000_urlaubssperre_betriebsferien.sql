-- Urlaubssperren und Betriebsferien (Fabian, 2026-10-31)
-- Admin und Personalabteilung pflegen in der Zeiterfassung (Reiter "Urlaubssperren") Zeiträume für alle Mitarbeiter
-- oder einzelne Abteilungen (Feld Abteilung der Personalakte).
--  * Urlaubssperre: Mitarbeiter können dort keinen Urlaub und keinen Zeitausgleich beantragen. Vorgesetzte,
--    Personalabteilung und Admin dürfen trotzdem eintragen/genehmigen (die App zeigt einen Hinweis).
--    Krank, Kindkrank usw. sind nie gesperrt, schon genehmigter Urlaub bleibt bestehen.
--  * Betriebsferien: für alle betroffenen Mitarbeiter wird automatisch genehmigter Urlaub gebucht (zählt gegen den
--    Urlaubsanspruch). Tage mit schon eingetragener Abwesenheit/Antrag werden übersprungen, ebenso Tage vor dem
--    Eintritt bzw. nach dem Austritt. Einzelne Buchungen lassen sich wie jeder Urlaub stornieren und werden dann
--    nicht neu angelegt. Neue Mitarbeiter oder ein Abteilungswechsel werden automatisch nachgebucht.

create table if not exists public.vacation_blocks (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('sperre', 'betriebsferien')),
  start_date date not null,
  end_date date not null,
  reason text not null default '' check (length(reason) <= 200),
  -- leer = alle Mitarbeiter
  departments text[] not null default '{}',
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_date >= start_date)
);
create index if not exists vacation_blocks_range_idx on public.vacation_blocks (start_date, end_date);

alter table public.vacation_blocks enable row level security;
drop policy if exists "Urlaubssperren sehen" on public.vacation_blocks;
create policy "Urlaubssperren sehen" on public.vacation_blocks for select to authenticated using (true);

-- Automatisch gebuchter Urlaub der Betriebsferien
alter table public.vacation_requests
  add column if not exists block_id bigint references public.vacation_blocks (id) on delete cascade;
create index if not exists vacation_requests_block_idx on public.vacation_requests (block_id) where block_id is not null;

-- Gilt die Sperre/Betriebsferien für diese Person? (keine Abteilungen = alle)
create or replace function public.vacation_block_applies(p_departments text[], p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(cardinality(p_departments), 0) = 0
      or exists (
        select 1 from public.employees e
         where e.user_id = p_user
           and lower(trim(e.department)) in (select lower(trim(d)) from unnest(p_departments) d)
      );
$$;
revoke execute on function public.vacation_block_applies(text[], uuid) from public, anon, authenticated;

-- Betriebsferien buchen: legt für jede betroffene Person, die zu diesen Betriebsferien noch keine Buchung hat
-- (auch keine stornierte), genehmigten Urlaub an. Mit p_user nur für diese Person.
create or replace function public.apply_vacation_block(p_id bigint, p_user uuid default null)
returns int
language plpgsql
security definer
set search_path = ''
as $$
declare
  b public.vacation_blocks;
  u record;
  s record;
  v_n int := 0;
begin
  select * into b from public.vacation_blocks where id = p_id;
  if not found or b.kind <> 'betriebsferien' then
    return 0;
  end if;
  for u in
    select p.id as user_id,
           greatest(b.start_date, coalesce(e.entry_date, b.start_date)) as von,
           least(b.end_date, coalesce(e.exit_date, b.end_date)) as bis
      from public.profiles p
      join public.employees e on e.user_id = p.id
     where p.active
       and e.employee_type = 'mitarbeiter'
       and e.status <> 'nicht aktiv'
       and (p_user is null or p.id = p_user)
       and public.vacation_block_applies(b.departments, p.id)
       and not exists (select 1 from public.vacation_requests v where v.block_id = b.id and v.user_id = p.id)
  loop
    continue when u.von > u.bis;
    -- freie Kalendertage (ohne schon eingetragene Abwesenheit/Antrag) zu Abschnitten zusammenfassen, je Jahr getrennt
    for s in
      with tage as (
        select g.d::date as d
          from generate_series(u.von, u.bis, interval '1 day') g(d)
         where not exists (
           select 1 from public.vacation_requests v
            where v.user_id = u.user_id and v.state in ('beantragt', 'genehmigt')
              and g.d::date between v.start_date and v.end_date)
      ), gruppen as (
        select d, extract(year from d) as jahr,
               d - (row_number() over (order by d))::int as grp
          from tage
      )
      select min(d) filter (where extract(isodow from d) < 6 and not public.is_holiday_rlp(d)) as von,
             max(d) filter (where extract(isodow from d) < 6 and not public.is_holiday_rlp(d)) as bis
        from gruppen
       group by jahr, grp
    loop
      continue when s.von is null;
      insert into public.vacation_requests
        (user_id, start_date, end_date, days, note, kind, state, decided_by, decided_at, decision_note, block_id)
      values
        (u.user_id, s.von, s.bis, public.vacation_workdays(s.von, s.bis),
         left(coalesce(nullif(trim(b.reason), ''), 'Betriebsferien'), 300),
         'urlaub', 'genehmigt', coalesce(auth.uid(), b.created_by), now(), 'Betriebsferien', b.id);
      v_n := v_n + 1;
    end loop;
  end loop;
  return v_n;
end;
$$;
revoke execute on function public.apply_vacation_block(bigint, uuid) from public, anon, authenticated;

-- Anlegen/Ändern (p_id null = neu). Nur Admin und Personalabteilung.
create or replace function public.save_vacation_block(
  p_id bigint, p_kind text, p_start date, p_end date, p_reason text default '', p_departments text[] default '{}'
)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.vacation_blocks;
  v_id bigint := p_id;
  v_deps text[];
begin
  if not (public.is_admin() or public.has_hr_access()) then
    raise exception 'Urlaubssperren pflegen Admin und Personalabteilung';
  end if;
  if coalesce(p_kind, '') not in ('sperre', 'betriebsferien') then
    raise exception 'Bitte Urlaubssperre oder Betriebsferien wählen';
  end if;
  if p_start is null or p_end is null or p_end < p_start then
    raise exception 'Bitte einen gültigen Zeitraum wählen';
  end if;
  if p_end - p_start > 366 then
    raise exception 'Der Zeitraum darf höchstens ein Jahr lang sein';
  end if;
  select coalesce(array_agg(distinct trim(d)) filter (where trim(d) <> ''), '{}') into v_deps
    from unnest(coalesce(p_departments, '{}')) d;

  if v_id is null then
    insert into public.vacation_blocks (kind, start_date, end_date, reason, departments, created_by)
    values (p_kind, p_start, p_end, left(trim(coalesce(p_reason, '')), 200), v_deps, auth.uid())
    returning id into v_id;
  else
    select * into v_old from public.vacation_blocks where id = v_id for update;
    if not found then
      raise exception 'Eintrag nicht gefunden';
    end if;
    update public.vacation_blocks
       set kind = p_kind, start_date = p_start, end_date = p_end,
           reason = left(trim(coalesce(p_reason, '')), 200), departments = v_deps, updated_at = now()
     where id = v_id;
    -- Zeitraum, Abteilungen oder Art geändert: automatische Buchungen neu aufbauen
    if v_old.kind <> p_kind or v_old.start_date <> p_start or v_old.end_date <> p_end
       or v_old.departments::text <> v_deps::text then
      delete from public.vacation_requests where block_id = v_id;
    else
      update public.vacation_requests
         set note = left(coalesce(nullif(trim(p_reason), ''), 'Betriebsferien'), 300)
       where block_id = v_id;
    end if;
  end if;
  perform public.apply_vacation_block(v_id);
  return v_id;
end;
$$;
revoke execute on function public.save_vacation_block(bigint, text, date, date, text, text[]) from public, anon;
grant execute on function public.save_vacation_block(bigint, text, date, date, text, text[]) to authenticated;

-- Löschen: automatisch gebuchter Urlaub der Betriebsferien wird mit gelöscht (on delete cascade)
create or replace function public.delete_vacation_block(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not (public.is_admin() or public.has_hr_access()) then
    raise exception 'Urlaubssperren pflegen Admin und Personalabteilung';
  end if;
  delete from public.vacation_blocks where id = p_id;
end;
$$;
revoke execute on function public.delete_vacation_block(bigint) from public, anon;
grant execute on function public.delete_vacation_block(bigint) to authenticated;

-- Sperren/Betriebsferien, die für diese Person im Zeitraum gelten (Hinweis im Antrag und beim Genehmigen)
create or replace function public.vacation_block_hits(p_user uuid, p_start date, p_end date)
returns table (id bigint, kind text, start_date date, end_date date, reason text)
language sql
stable
security definer
set search_path = ''
as $$
  select b.id, b.kind, b.start_date, b.end_date, b.reason
    from public.vacation_blocks b
   where (p_user = auth.uid() or public.can_edit_times(p_user))
     and b.start_date <= p_end and b.end_date >= p_start
     and public.vacation_block_applies(b.departments, p_user)
   order by b.start_date;
$$;
revoke execute on function public.vacation_block_hits(uuid, date, date) from public, anon;
grant execute on function public.vacation_block_hits(uuid, date, date) to authenticated;

-- Schon eingetragener Urlaub/Zeitausgleich, der in eine Urlaubssperre fällt (Liste im Reiter Urlaubssperren)
create or replace function public.vacation_block_conflicts(p_id bigint)
returns table (request_id bigint, user_id uuid, start_date date, end_date date, kind text, state text)
language sql
stable
security definer
set search_path = ''
as $$
  select v.id, v.user_id, v.start_date, v.end_date, v.kind, v.state::text
    from public.vacation_blocks b
    join public.vacation_requests v
      on v.start_date <= b.end_date and v.end_date >= b.start_date
     and v.state in ('beantragt', 'genehmigt') and v.kind in ('urlaub', 'ueberstunden')
     and v.block_id is null
   where b.id = p_id and b.kind = 'sperre'
     and (public.is_admin() or public.has_hr_access())
     and public.vacation_block_applies(b.departments, v.user_id)
   order by v.start_date;
$$;
revoke execute on function public.vacation_block_conflicts(bigint) from public, anon;
grant execute on function public.vacation_block_conflicts(bigint) to authenticated;

-- Abteilungen zur Auswahl (aus den Personalakten)
create or replace function public.employee_departments()
returns setof text
language sql
stable
security definer
set search_path = ''
as $$
  select distinct trim(department) from public.employees
   where trim(department) <> '' and employee_type = 'mitarbeiter'
     and (public.is_admin() or public.has_hr_access())
   order by 1;
$$;
revoke execute on function public.employee_departments() from public, anon;
grant execute on function public.employee_departments() to authenticated;

-- Neue Mitarbeiter, Abteilungswechsel, Ein-/Austritt: laufende und künftige Betriebsferien anpassen
create or replace function public.employees_vacation_blocks()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  b record;
begin
  if new.user_id is null then
    return new;
  end if;
  if tg_op = 'UPDATE'
     and new.department is not distinct from old.department and new.user_id is not distinct from old.user_id
     and new.status is not distinct from old.status and new.employee_type is not distinct from old.employee_type
     and new.entry_date is not distinct from old.entry_date and new.exit_date is not distinct from old.exit_date then
    return new;
  end if;
  for b in
    select id, departments from public.vacation_blocks
     where kind = 'betriebsferien' and end_date >= (now() at time zone 'Europe/Berlin')::date
  loop
    if not public.vacation_block_applies(b.departments, new.user_id)
       or new.employee_type <> 'mitarbeiter' or new.status = 'nicht aktiv' then
      -- gehört nicht (mehr) dazu: noch gültige automatische Buchungen entfernen
      delete from public.vacation_requests
       where block_id = b.id and user_id = new.user_id and state = 'genehmigt';
    else
      perform public.apply_vacation_block(b.id, new.user_id);
    end if;
  end loop;
  return new;
end;
$$;
drop trigger if exists employees_vacation_blocks on public.employees;
create trigger employees_vacation_blocks
  after insert or update on public.employees
  for each row execute function public.employees_vacation_blocks();

-- Urlaubsantrag: an gesperrten Tagen nicht möglich
create or replace function public.request_vacation(p_start date, p_end date, p_note text default '', p_kind text default 'urlaub')
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_days int;
  v_id bigint;
  b public.vacation_blocks;
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
  select * into b from public.vacation_blocks
   where kind = 'sperre' and start_date <= p_end and end_date >= p_start
     and public.vacation_block_applies(departments, auth.uid())
   order by start_date limit 1;
  if found then
    raise exception 'Urlaubssperre vom % bis %. Bitte einen anderen Zeitraum wählen oder mit dem Vorgesetzten sprechen.',
      to_char(b.start_date, 'DD.MM.YYYY'),
      to_char(b.end_date, 'DD.MM.YYYY') || case when trim(b.reason) <> '' then ' (' || trim(b.reason) || ')' else '' end;
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
