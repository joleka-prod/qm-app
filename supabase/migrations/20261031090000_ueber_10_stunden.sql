-- Arbeitstage über 10 Stunden müssen vom Vorgesetzten freigegeben werden (Fabian, 2026-10-31).
-- Maßgeblich ist die Arbeitszeit eines Tages wie überall in der Zeiterfassung: alle abgeschlossenen
-- Stempelzeiten des Tages (deutsche Zeit, Tag des Beginns) abzüglich der festen Pausen.
-- Liegt sie über 10 Stunden, entsteht eine Meldung. Vorgesetzte (ganze Kette) oder Admin geben
-- mit Begründung frei oder korrigieren die Stempelzeiten mit Begründung; eine Korrektur erzeugt wie
-- jede fremde Änderung eine Info beim Mitarbeiter.
-- Aus TimeTac importierte Zeiten erzeugen keine neuen Meldungen (TimeTac ist bis 30.11. führend).

create table if not exists public.long_day_reviews (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  day date not null,
  work_min int not null,
  state text not null default 'offen' check (state in ('offen', 'freigegeben', 'korrigiert')),
  decided_by uuid references public.profiles (id) on delete set null,
  decided_at timestamptz,
  decision_note text not null default '',
  decided_work_min int,
  created_at timestamptz not null default now(),
  unique (user_id, day)
);
create index if not exists long_day_reviews_open_idx on public.long_day_reviews (user_id) where state = 'offen';

alter table public.long_day_reviews enable row level security;

drop policy if exists "Über-10-Stunden-Meldungen sehen" on public.long_day_reviews;
create policy "Über-10-Stunden-Meldungen sehen" on public.long_day_reviews
  for select to authenticated
  using (user_id = auth.uid() or public.is_admin() or public.is_supervisor_of(user_id) or public.has_hr_access());

-- Grenze in Minuten
create or replace function public.long_day_limit()
returns int
language sql
immutable
set search_path = ''
as $$ select 600 $$;

-- Arbeitszeit eines Tages (ohne feste Pausen, nur abgeschlossene Stempelzeiten)
create or replace function public.day_work_minutes(p_user uuid, p_day date)
returns int
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(sum(extract(epoch from (a.ended_at - a.started_at)) / 60
                      - public.fixed_break_minutes(a.started_at, a.ended_at)), 0)::int
  from public.attendance a
  where a.installer_id = p_user
    and a.ended_at is not null
    and (a.started_at at time zone 'Europe/Berlin')::date = p_day;
$$;
revoke execute on function public.day_work_minutes(uuid, date) from public, anon, authenticated;

-- Meldung eines Tages neu bewerten (nach jeder Änderung an den Stempelzeiten)
create or replace function public.long_day_refresh(p_user uuid, p_day date)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_min int;
  v_import boolean := coalesce(current_setting('app.import', true), '') = 'timetac';
  r public.long_day_reviews;
begin
  if p_user is null or p_day is null or not exists (select 1 from public.profiles where id = p_user) then
    return;
  end if;
  v_min := public.day_work_minutes(p_user, p_day);
  select * into r from public.long_day_reviews where user_id = p_user and day = p_day for update;
  if not found then
    if v_min > public.long_day_limit() and not v_import then
      insert into public.long_day_reviews (user_id, day, work_min) values (p_user, p_day, v_min)
      on conflict (user_id, day) do nothing;
    end if;
  elsif r.state = 'offen' then
    if v_min > public.long_day_limit() then
      update public.long_day_reviews set work_min = v_min where id = r.id;
    else
      -- nicht mehr über 10 Stunden: Meldung erledigt sich
      delete from public.long_day_reviews where id = r.id;
    end if;
  else
    -- schon entschieden: nur wenn später noch mehr Zeit dazukommt, erneut vorlegen
    if v_min > greatest(public.long_day_limit(), coalesce(r.decided_work_min, 0)) and not v_import then
      update public.long_day_reviews
         set work_min = v_min, state = 'offen', decided_by = null, decided_at = null,
             decision_note = '', decided_work_min = null, created_at = now()
       where id = r.id;
    else
      update public.long_day_reviews set work_min = v_min where id = r.id;
    end if;
  end if;
end;
$$;
revoke execute on function public.long_day_refresh(uuid, date) from public, anon, authenticated;

create or replace function public.attendance_long_day_check()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') then
    perform public.long_day_refresh(old.installer_id, (old.started_at at time zone 'Europe/Berlin')::date);
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    if tg_op = 'INSERT' or (new.started_at at time zone 'Europe/Berlin')::date
                           <> (old.started_at at time zone 'Europe/Berlin')::date then
      perform public.long_day_refresh(new.installer_id, (new.started_at at time zone 'Europe/Berlin')::date);
    end if;
  end if;
  return null;
end;
$$;
drop trigger if exists attendance_long_day_check on public.attendance;
create trigger attendance_long_day_check
  after insert or update or delete on public.attendance
  for each row execute function public.attendance_long_day_check();

-- Freigeben mit Begründung: Vorgesetzte (Kette) oder Admin, nie die eigenen
create or replace function public.approve_long_day(p_id bigint, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.long_day_reviews;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Bitte eine Begründung angeben';
  end if;
  select * into r from public.long_day_reviews where id = p_id for update;
  if not found or r.state <> 'offen' then
    raise exception 'Meldung nicht gefunden oder schon bearbeitet';
  end if;
  if not public.can_decide_vacation(r.user_id) then
    raise exception 'Nur der Vorgesetzte oder ein Admin kann das freigeben';
  end if;
  update public.long_day_reviews
     set state = 'freigegeben', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note), decided_work_min = r.work_min
   where id = p_id;
end;
$$;
revoke execute on function public.approve_long_day(bigint, text) from public, anon;
grant execute on function public.approve_long_day(bigint, text) to authenticated;

-- Korrigieren mit Begründung: geänderte Stempelzeiten des Tages [{id, start, end}] gelten sofort,
-- der Mitarbeiter bekommt dazu wie bisher eine Änderungsinfo.
create or replace function public.correct_long_day(p_id bigint, p_changes jsonb, p_note text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.long_day_reviews;
  c jsonb;
  a public.attendance;
  s timestamptz;
  e timestamptz;
  v_n int := 0;
  v_min int;
begin
  if length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Bitte eine Begründung angeben';
  end if;
  select * into r from public.long_day_reviews where id = p_id for update;
  if not found or r.state <> 'offen' then
    raise exception 'Meldung nicht gefunden oder schon bearbeitet';
  end if;
  if not public.can_decide_vacation(r.user_id) then
    raise exception 'Nur der Vorgesetzte oder ein Admin kann das korrigieren';
  end if;
  -- vorab als korrigiert markieren, damit die Neubewertung während der Änderungen die Meldung nicht löscht
  update public.long_day_reviews
     set state = 'korrigiert', decided_by = auth.uid(), decided_at = now(),
         decision_note = trim(p_note), decided_work_min = 2147483647
   where id = p_id;

  for c in select * from jsonb_array_elements(coalesce(p_changes, '[]'::jsonb)) loop
    select * into a from public.attendance where id = (c ->> 'id')::bigint and installer_id = r.user_id;
    if not found or (a.started_at at time zone 'Europe/Berlin')::date <> r.day then
      raise exception 'Stempelzeit gehört nicht zu diesem Tag';
    end if;
    s := (c ->> 'start')::timestamptz;
    e := (c ->> 'end')::timestamptz;
    if s is distinct from a.started_at or e is distinct from a.ended_at then
      perform public.request_attendance_change(r.user_id, a.id, s, e, 'Über 10 Stunden: ' || trim(p_note));
      v_n := v_n + 1;
    end if;
  end loop;
  if v_n = 0 then
    raise exception 'Keine Stempelzeit geändert. Zum Bestätigen ohne Änderung bitte „Freigeben“ wählen.';
  end if;

  v_min := public.day_work_minutes(r.user_id, r.day);
  update public.long_day_reviews set work_min = v_min, decided_work_min = v_min where id = p_id;
end;
$$;
revoke execute on function public.correct_long_day(bigint, jsonb, text) from public, anon;
grant execute on function public.correct_long_day(bigint, jsonb, text) to authenticated;
