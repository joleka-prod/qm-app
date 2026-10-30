-- Personalabteilung darf die Zeiterfassung aller Mitarbeiter direkt ändern (Fabian, 2026-10-30):
-- Stempelzeiten nachtragen/korrigieren, Abwesenheiten eintragen und stornieren gelten sofort, ohne Genehmigung.
-- Eigene Zeiten bleiben ein Antrag an den Vorgesetzten.
-- Ändert jemand anderes die Zeiten einer Person, bekommt diese Person eine Info in ihrer Zeiterfassung
-- (zwischen Überstunden und Urlaub), die sie bestätigen muss.

-- Wer darf die Zeiten dieser Person direkt ändern? Vorgesetzte, Admin und Personalabteilung, nie die eigenen.
create or replace function public.can_edit_times(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select auth.uid() is not null and p_user <> auth.uid()
     and (public.can_decide_vacation(p_user) or public.has_hr_access());
$$;
revoke execute on function public.can_edit_times(uuid) from public, anon;
grant execute on function public.can_edit_times(uuid) to authenticated;

-- Infos über Änderungen an den eigenen Zeiten
create table if not exists public.time_change_notices (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  changed_by uuid references public.profiles (id) on delete set null,
  message text not null,
  created_at timestamptz not null default now(),
  confirmed_at timestamptz
);
create index if not exists time_change_notices_open_idx on public.time_change_notices (user_id) where confirmed_at is null;

alter table public.time_change_notices enable row level security;

drop policy if exists "Zeitänderungs-Infos sehen" on public.time_change_notices;
create policy "Zeitänderungs-Infos sehen" on public.time_change_notices
  for select to authenticated
  using (user_id = auth.uid() or changed_by = auth.uid() or public.is_admin());

-- Info anlegen, wenn jemand anderes die Zeiten einer Person ändert (nur aus den Funktionen heraus)
create or replace function public.notify_time_change(p_user uuid, p_message text)
returns void
language sql
security definer
set search_path = ''
as $$
  insert into public.time_change_notices (user_id, changed_by, message)
  select p_user, auth.uid(), p_message
  where auth.uid() is not null and p_user <> auth.uid()
    and coalesce(current_setting('app.import', true), '') <> 'timetac'
    and exists (select 1 from public.profiles where id = p_user);
$$;
revoke execute on function public.notify_time_change(uuid, text) from public, anon, authenticated;

-- Info bestätigen: verschwindet danach aus der Zeiterfassung
create or replace function public.confirm_time_change_notice(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_change_notices
     set confirmed_at = now()
   where id = p_id and user_id = auth.uid() and confirmed_at is null;
  if not found then
    raise exception 'Info nicht gefunden oder schon bestätigt';
  end if;
end;
$$;
revoke execute on function public.confirm_time_change_notice(bigint) from public, anon;
grant execute on function public.confirm_time_change_notice(bigint) to authenticated;

-- Texthilfen: "Di., 28.10.2026" und "07:00–16:00 Uhr" in deutscher Zeit
create or replace function public.notice_day(p_ts timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select (array['Mo.', 'Di.', 'Mi.', 'Do.', 'Fr.', 'Sa.', 'So.'])[extract(isodow from p_ts at time zone 'Europe/Berlin')::int]
         || ', ' || to_char(p_ts at time zone 'Europe/Berlin', 'DD.MM.YYYY');
$$;

create or replace function public.notice_span(p_start timestamptz, p_end timestamptz)
returns text
language sql
stable
set search_path = ''
as $$
  select to_char(p_start at time zone 'Europe/Berlin', 'HH24:MI') || '–'
         || coalesce(to_char(p_end at time zone 'Europe/Berlin', 'HH24:MI'), '…') || ' Uhr';
$$;

create or replace function public.notice_absence(p_kind text, p_start date, p_end date, p_days numeric)
returns text
language sql
stable
set search_path = ''
as $$
  select case p_kind when 'urlaub' then 'Urlaub' when 'ueberstunden' then 'Zeitausgleich'
                     when 'krank' then 'Krank' when 'sonderurlaub' then 'Sonderurlaub' else p_kind end
         || ' ' || to_char(p_start, 'DD.MM.YYYY')
         || case when p_end > p_start then ' bis ' || to_char(p_end, 'DD.MM.YYYY') else '' end
         || ' (' || replace(trim_scale(p_days)::text, '.', ',')
         || case when p_days = 1 then ' Tag)' else ' Tage)' end;
$$;

-- Stempelzeit nachtragen/korrigieren: Vorgesetzte, Admin und Personalabteilung ändern sofort
create or replace function public.request_attendance_change(
  p_user uuid, p_attendance_id bigint, p_start timestamptz, p_end timestamptz, p_reason text
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_old public.attendance;
  v_id bigint;
begin
  if auth.uid() is null or public.my_role() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not (p_user = auth.uid()
          or public.my_role()::text in ('admin', 'teamleiter', 'disposition')
          or public.is_supervisor_of(p_user)
          or public.has_hr_access()) then
    raise exception 'Keine Berechtigung';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Bitte einen Grund angeben';
  end if;
  if p_start is null or p_end is null or p_end <= p_start then
    raise exception 'Das Ende muss nach dem Beginn liegen';
  end if;
  if p_start > now() or p_end > now() + interval '5 minutes' then
    raise exception 'Zeiten in der Zukunft können nicht nachgetragen werden';
  end if;
  if p_attendance_id is not null then
    select * into v_old from public.attendance where id = p_attendance_id and installer_id = p_user;
    if not found then
      raise exception 'Stempelzeit nicht gefunden';
    end if;
    if exists (select 1 from public.attendance_requests where attendance_id = p_attendance_id and state = 'beantragt') then
      raise exception 'Für diese Stempelzeit gibt es schon eine offene Korrektur';
    end if;
  end if;

  insert into public.attendance_requests (user_id, attendance_id, started_at, ended_at, old_started_at, old_ended_at, reason, requested_by)
  values (p_user, p_attendance_id, p_start, p_end, v_old.started_at, v_old.ended_at, trim(p_reason), auth.uid())
  returning id into v_id;

  if public.can_edit_times(p_user) then
    perform public.apply_attendance_request(v_id);
    update public.attendance_requests set state = 'genehmigt', decided_by = auth.uid(), decided_at = now() where id = v_id;
    perform public.notify_time_change(p_user,
      case when p_attendance_id is null
        then 'Zeit nachgetragen am ' || public.notice_day(p_start) || ': ' || public.notice_span(p_start, p_end)
        else 'Stempelzeit korrigiert am ' || public.notice_day(p_start) || ': jetzt ' || public.notice_span(p_start, p_end)
             || ', vorher ' || public.notice_span(v_old.started_at, v_old.ended_at)
      end || '. Grund: ' || trim(p_reason));
    return 'genehmigt';
  end if;
  return 'beantragt';
end;
$$;

-- Genehmigter Antrag, den jemand anderes für die Person gestellt hat: Person bekommt ebenfalls eine Info
create or replace function public.decide_attendance_change(p_id bigint, p_approve boolean, p_note text default '')
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.attendance_requests;
begin
  select * into r from public.attendance_requests where id = p_id for update;
  if not found or r.state <> 'beantragt' then
    raise exception 'Antrag nicht gefunden oder schon entschieden';
  end if;
  if not public.can_decide_vacation(r.user_id) then
    raise exception 'Nur der Vorgesetzte oder ein Admin kann das genehmigen';
  end if;
  if p_approve then
    perform public.apply_attendance_request(p_id);
  end if;
  update public.attendance_requests
     set state = case when p_approve then 'genehmigt' else 'abgelehnt' end,
         decided_by = auth.uid(), decided_at = now(), decision_note = trim(coalesce(p_note, ''))
   where id = p_id;
  if p_approve and r.requested_by <> r.user_id then
    perform public.notify_time_change(r.user_id,
      case when r.attendance_id is null
        then 'Zeit nachgetragen am ' || public.notice_day(r.started_at) || ': ' || public.notice_span(r.started_at, r.ended_at)
        else 'Stempelzeit korrigiert am ' || public.notice_day(r.started_at) || ': jetzt ' || public.notice_span(r.started_at, r.ended_at)
             || ', vorher ' || public.notice_span(r.old_started_at, r.old_ended_at)
      end || '. Grund: ' || r.reason);
  end if;
end;
$$;

-- Admin löscht eine Stempelzeit eines anderen: Info an die Person
create or replace function public.attendance_deleted_notice()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.notify_time_change(old.installer_id,
    'Stempelzeit gelöscht am ' || public.notice_day(old.started_at) || ': ' || public.notice_span(old.started_at, old.ended_at) || '.');
  return old;
end;
$$;
drop trigger if exists attendance_deleted_notice on public.attendance;
create trigger attendance_deleted_notice
  after delete on public.attendance
  for each row execute function public.attendance_deleted_notice();

-- Abwesenheit eintragen: auch die Personalabteilung
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
  if not public.can_edit_times(p_user) then
    raise exception 'Abwesenheiten für andere tragen Vorgesetzte, Personalabteilung oder Admin ein (nicht für sich selbst)';
  end if;
  if coalesce(p_kind, '') not in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub') then
    raise exception 'Bitte Urlaub, Zeitausgleich, Krank oder Sonderurlaub wählen';
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
    if p_kind = 'ueberstunden' then
      raise exception 'Zeitausgleich bitte als ganzen Tag eintragen';
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
  perform public.notify_time_change(p_user,
    public.notice_absence(p_kind, p_start, p_end, v_days) || ' eingetragen'
    || case when trim(coalesce(p_note, '')) <> '' then '. Notiz: ' || left(trim(p_note), 300) else '' end || '.');
  return v_id;
end;
$$;

-- Stornieren: auch die Personalabteilung; die Person bekommt eine Info
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
  elsif r.state = 'beantragt' and public.can_decide_vacation(r.user_id) then
    null;
  elsif r.state = 'genehmigt' and public.can_edit_times(r.user_id) then
    null;
  else
    raise exception 'Diesen Antrag kannst du nicht zurückziehen';
  end if;
  update public.vacation_requests
  set state = 'storniert', decided_by = auth.uid(), decided_at = now()
  where id = p_id;
  perform public.notify_time_change(r.user_id,
    public.notice_absence(r.kind, r.start_date, r.end_date, r.days)
    || case when r.state = 'genehmigt' then ' storniert.' else ': Antrag storniert.' end);
end;
$$;
