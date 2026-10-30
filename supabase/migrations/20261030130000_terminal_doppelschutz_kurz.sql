-- Stempel-Terminal (Fabian, 2026-10-30): Chip ein zweites Mal vorhalten soll "Gehen" buchen. Der Schutz gegen
-- versehentliches Doppelt-Vorhalten galt 60 Sekunden; wer kurz nach dem Kommen testete, bekam nur "Bereits
-- gestempelt" (als Kommen angezeigt). Jetzt nur noch 10 Sekunden.
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
  elsif p_user is not null then
    select * into v_cred from public.terminal_credentials c where c.user_id = p_user;
    if not found or v_cred.pin_hash is null then
      return query select false, 'Für diese Person ist keine PIN hinterlegt', null::text, null::text, v_at;
      return;
    end if;
    if v_cred.locked_until > now() then
      return query select false, 'Zu viele falsche PINs. Bitte in 15 Minuten erneut versuchen oder den Chip nutzen.',
        null::text, null::text, v_at;
      return;
    end if;
    if v_cred.pin_hash <> extensions.crypt(coalesce(p_pin, ''), v_cred.pin_hash) then
      update public.terminal_credentials c
         set failed = case when c.failed >= 4 then 0 else c.failed + 1 end,
             locked_until = case when c.failed >= 4 then now() + interval '15 minutes' else c.locked_until end
       where c.user_id = v_cred.user_id;
      return query select false, 'PIN falsch', null::text, null::text, v_at;
      return;
    end if;
    update public.terminal_credentials c set failed = 0, locked_until = null where c.user_id = v_cred.user_id;
  else
    return query select false, 'Kein Chip und keine Person angegeben', null::text, null::text, v_at;
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
