-- Stempel-Terminal (Fabian, 2026-10-30): Stempeln ohne Chip (Name + PIN) komplett entfernt.
-- Terminal stempelt nur noch mit Chip; vergebene PINs werden gelöscht, PIN-Funktionen entfallen.

drop function if exists public.terminal_people(text);
drop function if exists public.set_terminal_pin(uuid, text);

update public.terminal_credentials set pin_hash = null, failed = 0, locked_until = null
where pin_hash is not null or failed <> 0 or locked_until is not null;

create or replace function public.terminal_clock(
  p_token text, p_badge text default null, p_user uuid default null, p_pin text default null, p_at timestamptz default null
)
returns table (ok boolean, message text, name text, action text, at timestamptz)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_terminal smallint := public.terminal_auth(p_token);
  v_at timestamptz := public.offline_time(p_at);
  v_badge text := public.normalize_badge(p_badge);
  v_cred public.terminal_credentials;
  v_user uuid;
  v_name text;
  v_open public.attendance;
  v_last timestamptz;
begin
  if v_badge is not null then
    select * into v_cred from public.terminal_credentials c where c.badge_uid = v_badge;
    if not found then
      return query select false, 'Unbekannter Chip (' || v_badge || ')', null::text, null::text, v_at;
      return;
    end if;
  else
    return query select false, 'Stempeln nur mit Chip', null::text, null::text, v_at;
    return;
  end if;

  v_user := v_cred.user_id;
  select coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1)) into v_name
  from public.profiles p where p.id = v_user and p.active;
  if v_name is null then
    return query select false, 'Zugang deaktiviert', null::text, null::text, v_at;
    return;
  end if;

  select * into v_open from public.attendance a where a.installer_id = v_user and a.ended_at is null;

  -- versehentlich doppelt vorgehalten: innerhalb von 10 Sekunden nichts ändern
  select max(greatest(a.started_at, coalesce(a.ended_at, a.started_at))) into v_last
  from public.attendance a where a.installer_id = v_user;
  if v_last is not null and abs(extract(epoch from v_at - v_last)) < 10 then
    return query select true, 'Bereits gestempelt', v_name,
      case when v_open.id is not null then 'kommen' else 'gehen' end, v_last;
    return;
  end if;

  perform set_config('app.clock', 'on', true);
  if v_open.id is not null then
    update public.time_entries te set ended_at = greatest(v_at, te.started_at)
    where te.installer_id = v_user and te.ended_at is null;
    update public.attendance a set ended_at = greatest(v_at, a.started_at), end_terminal_id = v_terminal
    where a.id = v_open.id;
    perform set_config('app.clock', 'off', true);
    return query select true, null::text, v_name, 'gehen', greatest(v_at, v_open.started_at);
  else
    if v_last is not null and v_last > v_at then
      v_at := v_last;
    end if;
    insert into public.attendance (installer_id, started_at, terminal_id) values (v_user, v_at, v_terminal);
    perform set_config('app.clock', 'off', true);
    return query select true, null::text, v_name, 'kommen', v_at;
  end if;
end;
$$;
