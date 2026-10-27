-- TimeTac-Import (Fabian, 2026-10-27): vergangene Stempelzeiten aus TimeTac in die Zeiterfassung übernehmen.
-- Nur Admin. Zeilen, die sich mit vorhandenen Zeiten des Mitarbeiters überschneiden, werden übersprungen,
-- dadurch kann der Import gefahrlos mehrfach laufen. Importierte Zeiten tragen die Notiz "TimeTac".

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

revoke execute on function public.import_attendance(uuid, jsonb) from public, anon;
grant execute on function public.import_attendance(uuid, jsonb) to authenticated;
