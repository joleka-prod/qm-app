-- Genehmiger aus TimeTac (Fabian, 2026-10-27): Bisher stand bei allen übernommenen Abwesenheiten der Admin, der
-- importiert hat, als Genehmiger. Jetzt kommt der Genehmiger aus dem TimeTac-Antrag (granted_user_id). Ist er ein
-- App-Benutzer, steht er in decided_by, sonst nur sein Name in decided_by_name. Bereits übernommene Abwesenheiten
-- werden beim nächsten Import der Abwesenheiten neu geschrieben.

alter table public.vacation_requests add column if not exists decided_by_name text not null default '';

create or replace function public.import_absences(p_user uuid, p_rows jsonb)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  s date;
  e date;
  d numeric;
  k text;
  v_by uuid;
  v_at timestamptz;
  v_in int := 0;
  v_skip int := 0;
begin
  if not public.is_admin() then
    raise exception 'Nur für Admins';
  end if;
  if not exists (select 1 from public.profiles where id = p_user) then
    raise exception 'App-Benutzer nicht gefunden';
  end if;
  for r in select * from jsonb_array_elements(coalesce(p_rows, '[]'::jsonb)) loop
    begin
      s := (r ->> 'start')::date;
      e := (r ->> 'end')::date;
      d := round((r ->> 'days')::numeric * 2) / 2;
      k := r ->> 'kind';
    exception when others then
      v_skip := v_skip + 1;
      continue;
    end;
    -- Genehmiger und Zeitpunkt sind freiwillig; Unbrauchbares wird ignoriert
    begin
      v_by := nullif(r ->> 'decided_by', '')::uuid;
    exception when others then
      v_by := null;
    end;
    if v_by is not null and not exists (select 1 from public.profiles where id = v_by) then
      v_by := null;
    end if;
    begin
      v_at := coalesce(nullif(r ->> 'decided_at', '')::timestamptz, now());
    exception when others then
      v_at := now();
    end;
    if s is null or e is null or e < s or extract(year from s) <> extract(year from e)
       or d is null or d <= 0 or k not in ('urlaub', 'ueberstunden', 'krank', 'sonderurlaub')
       or exists (select 1 from public.vacation_requests v
                   where v.user_id = p_user and v.state in ('beantragt', 'genehmigt')
                     and v.start_date <= e and v.end_date >= s) then
      v_skip := v_skip + 1;
      continue;
    end if;
    insert into public.vacation_requests (user_id, start_date, end_date, days, note, kind, state,
                                          decided_by, decided_by_name, decided_at, decision_note)
    values (p_user, s, e, d, left(trim('TimeTac ' || coalesce(r ->> 'note', '')), 300), k, 'genehmigt',
            v_by, case when v_by is null then left(trim(coalesce(r ->> 'decided_by_name', '')), 120) else '' end,
            v_at, 'aus TimeTac übernommen');
    v_in := v_in + 1;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end;
$$;

revoke execute on function public.import_absences(uuid, jsonb) from public, anon;
grant execute on function public.import_absences(uuid, jsonb) to authenticated;
