-- Ablehnen nur mit Grund (Fabian, 2026-10-30): gilt für Urlaubs-/Abwesenheitsanträge und Zeitnachträge.

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
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Bitte einen Grund für die Ablehnung angeben';
  end if;
  update public.vacation_requests
  set state = case when p_approve then 'genehmigt'::public.vacation_state else 'abgelehnt'::public.vacation_state end,
      decided_by = auth.uid(), decided_at = now(), decision_note = trim(coalesce(p_note, ''))
  where id = p_id;
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
  if not p_approve and length(trim(coalesce(p_note, ''))) < 3 then
    raise exception 'Bitte einen Grund für die Ablehnung angeben';
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
