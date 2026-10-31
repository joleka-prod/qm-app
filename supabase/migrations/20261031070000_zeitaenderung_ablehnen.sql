-- Änderungsinfos zu den eigenen Zeiten bestätigen ODER mit Grund ablehnen (Fabian, 2026-10-31).
-- Eine Ablehnung erscheint als Info bei der Person, die geändert hat, und wird dort
-- nur zur Kenntnis genommen. Die Änderung selbst bleibt bestehen; die ändernde Person
-- korrigiert bei Bedarf von Hand.

alter table public.time_change_notices
  add column if not exists rejected_at timestamptz,
  add column if not exists reject_reason text,
  add column if not exists reply_confirmed_at timestamptz;

create index if not exists time_change_notices_rejected_idx
  on public.time_change_notices (changed_by)
  where rejected_at is not null and reply_confirmed_at is null;

-- Ablehnen: nur die betroffene Person, Grund Pflicht
create or replace function public.reject_time_change_notice(p_id bigint, p_reason text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if length(trim(coalesce(p_reason, ''))) < 3 then
    raise exception 'Bitte einen Grund für die Ablehnung angeben';
  end if;
  update public.time_change_notices
     set confirmed_at = now(), rejected_at = now(), reject_reason = trim(p_reason)
   where id = p_id and user_id = auth.uid() and confirmed_at is null;
  if not found then
    raise exception 'Info nicht gefunden oder schon bearbeitet';
  end if;
end;
$$;
revoke execute on function public.reject_time_change_notice(bigint, text) from public, anon;
grant execute on function public.reject_time_change_notice(bigint, text) to authenticated;

-- Ablehnung zur Kenntnis nehmen: nur die Person, die geändert hat
create or replace function public.confirm_time_change_rejection(p_id bigint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_change_notices
     set reply_confirmed_at = now()
   where id = p_id and changed_by = auth.uid() and rejected_at is not null and reply_confirmed_at is null;
  if not found then
    raise exception 'Info nicht gefunden oder schon bestätigt';
  end if;
end;
$$;
revoke execute on function public.confirm_time_change_rejection(bigint) from public, anon;
grant execute on function public.confirm_time_change_rejection(bigint) to authenticated;
