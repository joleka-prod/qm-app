-- Stempeluhr für alle Mitarbeiter (nicht nur Monteure). Teamleiter dürfen die Zeiten
-- anderer korrigieren, ihre eigenen aber nur über Start/Stopp; das kann nur der Admin.

create or replace function public.attendance_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.note := trim(new.note);
  if tg_op = 'UPDATE' then
    new.installer_id := old.installer_id;
    new.created_at := old.created_at;
  end if;
  -- Änderungen durch andere (Planer) werden vermerkt
  if auth.uid() is not null and new.installer_id <> auth.uid() then
    new.edited_by := auth.uid();
  end if;
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Das Ende muss nach dem Beginn liegen';
  end if;
  if not exists (select 1 from public.profiles where id = new.installer_id) then
    raise exception 'Mitarbeiter nicht gefunden';
  end if;
  if auth.uid() is not null and new.installer_id = auth.uid()
     and coalesce(current_setting('app.clock', true), '') <> 'on' and not public.is_admin() then
    raise exception 'Eigene Zeiten kann nur der Admin korrigieren';
  end if;
  return new;
end;
$$;

create or replace function public.clock_in()
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if public.my_role() is null then
    raise exception 'Nicht angemeldet oder Zugang deaktiviert';
  end if;
  select id into v_id from public.attendance where installer_id = auth.uid() and ended_at is null;
  if found then
    return v_id;
  end if;
  perform set_config('app.clock', 'on', true);
  insert into public.attendance (installer_id) values (auth.uid()) returning id into v_id;
  perform set_config('app.clock', 'off', true);
  return v_id;
end;
$$;

create or replace function public.clock_out()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_entries set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
  perform set_config('app.clock', 'on', true);
  update public.attendance set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
  perform set_config('app.clock', 'off', true);
end;
$$;
