-- TimeTac-Import (Fabian, 2026-10-27): importierte Stempelzeiten sind keine Korrekturen. Bisher setzte der
-- Wächter edited_by auf den Admin, der importiert, und die Zeiterfassung zeigte "korrigiert von …".

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
  if auth.uid() is not null and new.installer_id <> auth.uid()
     and coalesce(current_setting('app.import', true), '') <> 'timetac' then
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

create or replace function public.import_attendance(p_user uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  s timestamptz;
  e timestamptz;
  v_in int := 0;
  v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'App-Benutzer nicht gefunden';
  end if;
  perform set_config('app.clock', 'on', true);
  perform set_config('app.import', 'timetac', true);
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      s := (r ->> 'start')::timestamptz;
      e := (r ->> 'end')::timestamptz;
    exception when others then
      v_skip := v_skip + 1;
      continue;
    end;
    if s is null or e is null or e <= s or e > now()
       or exists (select 1 from public.attendance a
                   where a.installer_id = p_user
                     and tstzrange(a.started_at, coalesce(a.ended_at, 'infinity')) && tstzrange(s, e)) then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.attendance (installer_id, started_at, ended_at, note)
    values (p_user, s, e, left(trim('TimeTac ' || coalesce(r ->> 'note', '')), 300));
    v_in := v_in + 1;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end;
$$;

-- bereits importierte Zeiten bereinigen
select set_config('app.import', 'timetac', true);
update public.attendance set edited_by = null where note like 'TimeTac%' and edited_by is not null;
