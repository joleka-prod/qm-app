-- Stempel-Terminal (Fabian, 2026-10-26): Mitarbeiter ohne Handy stempeln an einem fest montierten
-- Android-Gerät mit ihrem Transponder (z. B. SimonsVoss mit MIFARE), ersatzweise mit Name + PIN.
-- Das Terminal meldet sich nicht als Benutzer an, sondern weist sich mit einem geheimen Schlüssel aus,
-- den der Admin beim Einrichten erzeugt (gespeichert wird nur der Hash). Es darf nur stempeln.

create table if not exists public.terminals (
  id smallint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 60),
  token_hash text not null unique,
  active boolean not null default true,
  created_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  last_seen_at timestamptz
);

alter table public.terminals enable row level security;
drop policy if exists "Admin sieht Terminals" on public.terminals;
create policy "Admin sieht Terminals" on public.terminals for select to authenticated using (public.is_admin());

-- Chip und PIN je Mitarbeiter; nur über die Funktionen unten lesbar und änderbar
create table if not exists public.terminal_credentials (
  user_id uuid primary key references public.profiles (id) on delete cascade,
  badge_uid text unique check (badge_uid ~ '^[0-9a-z]{4,40}$'),
  pin_hash text,
  failed smallint not null default 0,
  locked_until timestamptz,
  updated_at timestamptz not null default now()
);

alter table public.terminal_credentials enable row level security;

alter table public.attendance add column if not exists terminal_id smallint references public.terminals (id) on delete set null;
alter table public.attendance add column if not exists end_terminal_id smallint references public.terminals (id) on delete set null;

-- Chipnummer vereinheitlichen: "04:17:67:3E" und "0417673e" sind derselbe Chip
create or replace function public.normalize_badge(p_badge text)
returns text
language sql
immutable
set search_path = ''
as $$
  select nullif(lower(regexp_replace(coalesce(p_badge, ''), '[^0-9a-zA-Z]', '', 'g')), '')
$$;

create or replace function public.terminal_hash(p_token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex')
$$;

-- ---------------------------------------------------------------- Admin

create or replace function public.create_terminal(p_name text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_token text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin kann Terminals einrichten';
  end if;
  insert into public.terminals (name, token_hash, created_by)
  values (trim(p_name), public.terminal_hash(v_token), auth.uid());
  return v_token;
end;
$$;

create or replace function public.update_terminal(p_id smallint, p_name text, p_active boolean)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin kann Terminals ändern';
  end if;
  update public.terminals set name = trim(p_name), active = p_active where id = p_id;
end;
$$;

create or replace function public.delete_terminal(p_id smallint)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin kann Terminals löschen';
  end if;
  delete from public.terminals where id = p_id;
end;
$$;

create or replace function public.terminal_credentials_list()
returns table (user_id uuid, badge_uid text, has_pin boolean, locked_until timestamptz)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    return;
  end if;
  return query
    select c.user_id, c.badge_uid, c.pin_hash is not null, c.locked_until from public.terminal_credentials c;
end;
$$;

create or replace function public.set_terminal_badge(p_user uuid, p_badge text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_badge text := public.normalize_badge(p_badge);
  v_other uuid;
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin kann Chips zuordnen';
  end if;
  if v_badge is not null then
    if v_badge !~ '^[0-9a-z]{4,40}$' then
      raise exception 'Die Chipnummer ist ungültig';
    end if;
    select c.user_id into v_other from public.terminal_credentials c where c.badge_uid = v_badge and c.user_id <> p_user;
    if found then
      raise exception 'Dieser Chip ist schon % zugeordnet',
        (select coalesce(nullif(p.full_name, ''), p.email) from public.profiles p where p.id = v_other);
    end if;
  end if;
  insert into public.terminal_credentials (user_id, badge_uid) values (p_user, v_badge)
  on conflict (user_id) do update set badge_uid = excluded.badge_uid, updated_at = now();
end;
$$;

create or replace function public.set_terminal_pin(p_user uuid, p_pin text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not public.is_admin() then
    raise exception 'Nur der Admin kann PINs vergeben';
  end if;
  if p_pin is not null and p_pin !~ '^[0-9]{4,8}$' then
    raise exception 'Die PIN muss aus 4 bis 8 Ziffern bestehen';
  end if;
  insert into public.terminal_credentials (user_id, pin_hash)
  values (p_user, case when p_pin is not null then extensions.crypt(p_pin, extensions.gen_salt('bf')) end)
  on conflict (user_id) do update
    set pin_hash = excluded.pin_hash, failed = 0, locked_until = null, updated_at = now();
end;
$$;

-- ---------------------------------------------------------------- Terminal

create or replace function public.terminal_auth(p_token text)
returns smallint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id smallint;
begin
  update public.terminals set last_seen_at = now()
  where token_hash = public.terminal_hash(p_token) and active
  returning id into v_id;
  if v_id is null then
    raise exception 'Terminal nicht freigegeben';
  end if;
  return v_id;
end;
$$;

-- Lebenszeichen; liefert den Namen des Terminals
create or replace function public.terminal_ping(p_token text)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id smallint := public.terminal_auth(p_token);
begin
  return (select name from public.terminals where id = v_id);
end;
$$;

-- Namen für das Stempeln mit PIN (nur aktive Mitarbeiter mit PIN, ohne E-Mail)
create or replace function public.terminal_people(p_token text)
returns table (id uuid, name text)
language plpgsql
security definer
set search_path = ''
as $$
begin
  perform public.terminal_auth(p_token);
  return query
    select p.id, coalesce(nullif(trim(p.full_name), ''), split_part(p.email, '@', 1))
    from public.profiles p
    join public.terminal_credentials c on c.user_id = p.id
    where p.active and c.pin_hash is not null
    order by 2;
end;
$$;

-- Stempeln: Kommen, wenn nicht eingestempelt, sonst Gehen. Fehler wie unbekannter Chip oder falsche
-- PIN kommen als ok = false zurück (keine Exception, damit Fehlversuche gezählt bleiben).
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

  -- versehentlich doppelt vorgehalten: innerhalb einer Minute nichts ändern
  select max(greatest(a.started_at, coalesce(a.ended_at, a.started_at))) into v_last
  from public.attendance a where a.installer_id = v_user;
  if v_last is not null and abs(extract(epoch from v_at - v_last)) < 60 then
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

revoke execute on function public.create_terminal(text) from public, anon;
revoke execute on function public.update_terminal(smallint, text, boolean) from public, anon;
revoke execute on function public.delete_terminal(smallint) from public, anon;
revoke execute on function public.terminal_credentials_list() from public, anon;
revoke execute on function public.set_terminal_badge(uuid, text) from public, anon;
revoke execute on function public.set_terminal_pin(uuid, text) from public, anon;
revoke execute on function public.terminal_auth(text) from public, anon, authenticated;
grant execute on function public.create_terminal(text) to authenticated;
grant execute on function public.update_terminal(smallint, text, boolean) to authenticated;
grant execute on function public.delete_terminal(smallint) to authenticated;
grant execute on function public.terminal_credentials_list() to authenticated;
grant execute on function public.set_terminal_badge(uuid, text) to authenticated;
grant execute on function public.set_terminal_pin(uuid, text) to authenticated;
grant execute on function public.terminal_ping(text) to anon, authenticated;
grant execute on function public.terminal_people(text) to anon, authenticated;
grant execute on function public.terminal_clock(text, text, uuid, text, timestamptz) to anon, authenticated;

-- Verlauf der Personalakte (falls 20261027020000 schon eingespielt ist)
do $$
begin
  if to_regprocedure('public.terminal_credentials_employee_log()') is not null then
    drop trigger if exists terminal_credentials_employee_log on public.terminal_credentials;
    create trigger terminal_credentials_employee_log
      after insert or update of badge_uid, pin_hash or delete on public.terminal_credentials
      for each row execute function public.terminal_credentials_employee_log();
  end if;
end;
$$;
