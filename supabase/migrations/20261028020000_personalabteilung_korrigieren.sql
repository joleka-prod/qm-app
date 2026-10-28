-- Personalabteilung darf Stempelzeiten aller Mitarbeiter nachtragen und korrigieren (Fabian, 2026-10-28).
-- Das wird immer ein Antrag: genehmigen darf nur der Vorgesetzte (Teamleiter) oder der Admin (can_decide_vacation).
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

  -- Vorgesetzter oder Admin trägt für einen Mitarbeiter nach: gilt sofort als genehmigt
  if public.can_decide_vacation(p_user) then
    perform public.apply_attendance_request(v_id);
    update public.attendance_requests set state = 'genehmigt', decided_by = auth.uid(), decided_at = now() where id = v_id;
    return 'genehmigt';
  end if;
  return 'beantragt';
end;
$$;
