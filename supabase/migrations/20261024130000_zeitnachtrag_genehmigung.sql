-- Nachgetragene oder korrigierte Stempelzeiten (Fabian, 2026-10-24): immer mit Grund, und sie gelten erst,
-- wenn der Vorgesetzte (bzw. Admin) sie genehmigt hat. Trägt der Vorgesetzte oder Admin selbst für einen
-- Mitarbeiter nach, gilt das sofort als genehmigt. Direktes Ändern von attendance ist nicht mehr möglich
-- (Stempeln läuft weiter über clock_in/clock_out, Löschen bleibt beim Admin).

create table if not exists public.attendance_requests (
  id bigint generated always as identity primary key,
  user_id uuid not null references public.profiles (id) on delete cascade,
  attendance_id bigint references public.attendance (id) on delete cascade,
  started_at timestamptz not null,
  ended_at timestamptz not null,
  old_started_at timestamptz,
  old_ended_at timestamptz,
  reason text not null check (length(reason) between 3 and 300),
  state text not null default 'beantragt' check (state in ('beantragt', 'genehmigt', 'abgelehnt', 'storniert')),
  requested_by uuid not null references public.profiles (id),
  decided_by uuid references public.profiles (id),
  decided_at timestamptz,
  decision_note text not null default '',
  created_at timestamptz not null default now(),
  check (ended_at > started_at)
);

create index if not exists attendance_requests_user_idx on public.attendance_requests (user_id, started_at);

alter table public.attendance_requests enable row level security;

drop policy if exists "Zeitnachträge sehen" on public.attendance_requests;
create policy "Zeitnachträge sehen" on public.attendance_requests
  for select to authenticated
  using (user_id = auth.uid() or requested_by = auth.uid()
         or public.my_role()::text in ('admin', 'teamleiter', 'disposition')
         or public.is_supervisor_of(user_id));

-- Stempelzeiten nur noch über Anträge ändern
drop policy if exists "Planer tragen Stempelzeiten nach" on public.attendance;
drop policy if exists "Planer korrigieren Stempelzeiten" on public.attendance;

-- Genehmigten Nachtrag in attendance übernehmen
create or replace function public.apply_attendance_request(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  r public.attendance_requests;
begin
  select * into r from public.attendance_requests where id = p_id;
  if exists (
    select 1 from public.attendance a
    where a.installer_id = r.user_id
      and a.id is distinct from r.attendance_id
      and a.started_at < r.ended_at
      and coalesce(a.ended_at, 'infinity') > r.started_at
  ) then
    raise exception 'Die Zeit überschneidet sich mit einer anderen Stempelzeit';
  end if;
  perform set_config('app.clock', 'on', true);
  if r.attendance_id is null then
    insert into public.attendance (installer_id, started_at, ended_at, note)
    values (r.user_id, r.started_at, r.ended_at, left(r.reason, 300));
  else
    update public.attendance
       set started_at = r.started_at, ended_at = r.ended_at, note = left(r.reason, 300)
     where id = r.attendance_id;
  end if;
  perform set_config('app.clock', '', true);
end;
$$;
revoke execute on function public.apply_attendance_request(bigint) from public, anon, authenticated;

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
          or public.is_supervisor_of(p_user)) then
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

  -- Vorgesetzter oder Admin trägt für einen Mitarbeiter nach: gilt sofort als genehmigt
  if public.can_decide_vacation(p_user) then
    perform public.apply_attendance_request(v_id);
    update public.attendance_requests set state = 'genehmigt', decided_by = auth.uid(), decided_at = now() where id = v_id;
    return 'genehmigt';
  end if;
  return 'beantragt';
end;
$$;

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
end;
$$;

create or replace function public.cancel_attendance_change(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.attendance_requests
     set state = 'storniert', decided_by = auth.uid(), decided_at = now()
   where id = p_id and state = 'beantragt' and (requested_by = auth.uid() or user_id = auth.uid());
  if not found then
    raise exception 'Antrag nicht gefunden oder schon entschieden';
  end if;
end;
$$;

revoke execute on function public.request_attendance_change(uuid, bigint, timestamptz, timestamptz, text) from public, anon;
revoke execute on function public.decide_attendance_change(bigint, boolean, text) from public, anon;
revoke execute on function public.cancel_attendance_change(bigint) from public, anon;
grant execute on function public.request_attendance_change(uuid, bigint, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.decide_attendance_change(bigint, boolean, text) to authenticated;
grant execute on function public.cancel_attendance_change(bigint) to authenticated;
