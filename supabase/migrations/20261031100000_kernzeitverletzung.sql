-- Kernzeitverletzung (Fabian, 2026-10-31): Wer an einem Arbeitstag die Kernarbeitszeit aus der Personalakte
-- (employees.core_start/core_end, Standard 07:00–15:45) nicht vollständig eingestempelt ist, erzeugt eine Meldung.
-- Vorgesetzte (ganze Kette) oder Admin geben sie mit Begründung frei. Muster wie "Über 10 Stunden" (long_day_reviews).
--  * Gezählt werden Minuten der Kernzeit ohne Stempelzeit: zu spät gekommen, zu früh gegangen, Lücken dazwischen.
--    Die festen Pausen 09:00–09:15 und 12:00–12:30 zählen nicht als Lücke.
--  * Eine laufende Stempelzeit gilt bis zum Ende der Kernzeit als anwesend (das Gehen wird erst beim Ausstempeln bewertet).
--  * Keine Prüfung: Tage ohne Stempelzeit, Tage außerhalb der vereinbarten Arbeitstage, Feiertage (RLP), Tage mit
--    genehmigter Abwesenheit (auch halbe Tage, Betriebsferien), Externe, Personen ohne Kernzeit.
--  * Aus TimeTac importierte Zeiten erzeugen keine neuen Meldungen.
--  * Toleranz in core_time_tolerance() (Minuten, die ohne Meldung fehlen dürfen), Start: 0.

create table if not exists public.core_time_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  core_start time not null,
  core_end time not null,
  first_start timestamptz,
  last_end timestamptz,
  late_min int not null default 0,
  early_min int not null default 0,
  missing_min int not null,
  state text not null default 'offen' check (state in ('offen', 'freigegeben')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  decided_missing_min int,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists core_time_reviews_open_idx on public.core_time_reviews (user_id) where state = 'offen';

alter table public.core_time_reviews enable row level security;

drop policy if exists "Kernzeit-Meldungen sehen" on public.core_time_reviews;
create policy "Kernzeit-Meldungen sehen" on public.core_time_reviews
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_supervisor_of(user_id) or public.has_hr_access());

-- Minuten, die ohne Meldung fehlen dürfen
create or replace function public.core_time_tolerance()
returns int
language sql
immutable
set search_path = ''
as $$ select 0 $$;

-- Bewertung eines Tages; keine Zeile = an diesem Tag keine Prüfung
create or replace function public.core_time_eval(p_user uuid, p_day date)
returns table (core_start time, core_end time, first_start timestamptz, last_end timestamptz,
               late_min int, early_min int, missing_min int)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  e public.employees;
  ws timestamptz;
  we timestamptz;
  v_first timestamptz;
  v_last timestamptz;
  v_open boolean;
begin
  select * into e from public.employees x where x.user_id = p_user order by x.id limit 1;
  if not found or e.employee_type <> 'mitarbeiter' or e.core_start is null or e.core_end is null then
    return;
  end if;
  if not (extract(isodow from p_day)::smallint = any(coalesce(nullif(e.work_days, '{}'), '{1,2,3,4,5}')))
     or public.is_holiday_rlp(p_day) then
    return;
  end if;
  if exists (select 1 from public.vacation_requests v
              where v.user_id = p_user and v.state = 'genehmigt' and p_day between v.start_date and v.end_date) then
    return;
  end if;

  select min(a.started_at), max(a.ended_at), bool_or(a.ended_at is null)
    into v_first, v_last, v_open
    from public.attendance a
   where a.installer_id = p_user and (a.started_at at time zone 'Europe/Berlin')::date = p_day;
  if v_first is null then
    return;
  end if;

  ws := (p_day + e.core_start) at time zone 'Europe/Berlin';
  we := (p_day + e.core_end) at time zone 'Europe/Berlin';

  return query
  with m as (
    select g.t
      from generate_series(ws, we - interval '1 minute', interval '1 minute') g(t)
     where not exists (
             select 1 from public.attendance a
              where a.installer_id = p_user
                and (a.started_at at time zone 'Europe/Berlin')::date = p_day
                and a.started_at < g.t + interval '1 minute'
                and coalesce(a.ended_at, 'infinity'::timestamptz) > g.t)
       -- feste Pausen
       and not ((g.t at time zone 'Europe/Berlin')::time >= time '09:00' and (g.t at time zone 'Europe/Berlin')::time < time '09:15')
       and not ((g.t at time zone 'Europe/Berlin')::time >= time '12:00' and (g.t at time zone 'Europe/Berlin')::time < time '12:30')
  )
  select e.core_start, e.core_end, v_first, case when v_open then null else v_last end,
         (count(*) filter (where m.t < v_first))::int,
         (count(*) filter (where not v_open and m.t >= v_last))::int,
         count(*)::int
    from m;
end;
$$;
revoke execute on function public.core_time_eval(uuid, date) from public, anon, authenticated;

-- Meldung eines Tages neu bewerten (nach jeder Änderung an Stempelzeiten oder Abwesenheiten)
create or replace function public.core_time_refresh(p_user uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v record;
  v_found boolean;
  v_bad boolean;
  v_import boolean := coalesce(current_setting('app.import', true), '') = 'timetac';
  r public.core_time_reviews;
begin
  if p_user is null or p_day is null or not exists (select 1 from public.profiles where id = p_user) then
    return;
  end if;
  select * into v from public.core_time_eval(p_user, p_day);
  v_found := found;
  v_bad := v_found and v.missing_min > public.core_time_tolerance();
  select * into r from public.core_time_reviews where user_id = p_user and day = p_day for update;
  if not found then
    if v_bad and not v_import then
      insert into public.core_time_reviews (user_id, day, core_start, core_end, first_start, last_end, late_min, early_min, missing_min)
      values (p_user, p_day, v.core_start, v.core_end, v.first_start, v.last_end, v.late_min, v.early_min, v.missing_min)
      on conflict (user_id, day) do nothing;
    end if;
  elsif r.state = 'offen' then
    if v_bad then
      update public.core_time_reviews
         set core_start = v.core_start, core_end = v.core_end, first_start = v.first_start, last_end = v.last_end,
             late_min = v.late_min, early_min = v.early_min, missing_min = v.missing_min
       where id = r.id;
    else
      -- Kernzeit jetzt eingehalten (oder Tag nicht mehr zu prüfen): Meldung erledigt sich
      delete from public.core_time_reviews where id = r.id;
    end if;
  elsif v_found then
    -- schon freigegeben: nur wenn später noch mehr Kernzeit fehlt, erneut vorlegen
    if v_bad and v.missing_min > coalesce(r.decided_missing_min, 0) and not v_import then
      update public.core_time_reviews
         set core_start = v.core_start, core_end = v.core_end, first_start = v.first_start, last_end = v.last_end,
             late_min = v.late_min, early_min = v.early_min, missing_min = v.missing_min,
             state = 'offen', decided_by = null, decided_at = null, decision_note = '', decided_missing_min = null,
             created_at = now()
       where id = r.id;
    else
      update public.core_time_reviews
         set first_start = v.first_start, last_end = v.last_end,
             late_min = v.late_min, early_min = v.early_min, missing_min = v.missing_min
       where id = r.id;
    end if;
  end if;
end;
$$;
revoke execute on function public.core_time_refresh(uuid, date) from public, anon, authenticated;

create or replace function public.attendance_core_time_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.core_time_refresh(old.installer_id, (old.started_at at time zone 'Europe/Berlin')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or (new.started_at at time zone 'Europe/Berlin')::date
                           <> (old.started_at at time zone 'Europe/Berlin')::date then
      perform public.core_time_refresh(new.installer_id, (new.started_at at time zone 'Europe/Berlin')::date);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists attendance_core_time_check on public.attendance;
create trigger attendance_core_time_check
  after insert or update or delete on public.attendance
  for each row execute function public.attendance_core_time_check();

-- Abwesenheit genehmigt/storniert: betroffene Meldungen neu bewerten
create or replace function public.vacation_core_time_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  d date;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    for d in select c.day from public.core_time_reviews c
              where c.user_id = old.user_id and c.day between old.start_date and old.end_date loop
      perform public.core_time_refresh(old.user_id, d);
    end loop;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    for d in select c.day from public.core_time_reviews c
              where c.user_id = new.user_id and c.day between new.start_date and new.end_date loop
      perform public.core_time_refresh(new.user_id, d);
    end loop;
  end if;
  return null;
end;
$$;
drop trigger if exists vacation_core_time_check on public.vacation_requests;
create trigger vacation_core_time_check
  after insert or update or delete on public.vacation_requests
  for each row execute function public.vacation_core_time_check();

-- Freigeben mit Begründung: Vorgesetzte (Kette) oder Admin, nie die eigenen
create or replace function public.approve_core_time(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.core_time_reviews;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Bitte eine Begründung angeben';
  end if;
  select * into r from public.core_time_reviews where id = p_id for update;
  if not found or r.state <> 'offen' then
    raise exception 'Meldung nicht gefunden oder schon bearbeitet';
  end if;
  if not public.can_decide_vacation(r.user_id) then
    raise exception 'Nur der Vorgesetzte oder ein Admin kann das freigeben';
  end if;
  update public.core_time_reviews
     set state = 'freigegeben', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note), decided_missing_min = r.missing_min
   where id = p_id;
end;
$$;
revoke execute on function public.approve_core_time(bigint, text) from public, anon;
grant execute on function public.approve_core_time(bigint, text) to authenticated;
