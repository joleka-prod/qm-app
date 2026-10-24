-- JOLEKA Service Dashboard: Testdaten für die Zeiterfassung (2026-10-24)
-- Für alle aktiven Benutzer: Stempelzeiten der letzten 4 Wochen (Mo–Fr, ohne Feiertage RLP), etwas Urlaub,
-- Freizeit über Überstunden und offene Zeitnachträge zum Genehmigen. Das Stundenkonto beginnt bei allen am
-- ersten Testtag, damit die Überstunden sinnvoll aussehen.
-- Alles ist mit "[TEST]" markiert. Ein erneuter Aufruf löscht die alten Testdaten zuerst.
-- Voraussetzung: alle Update-Skripte bis einschließlich update-feste-pausen sind eingespielt.

do $$
declare
  v_from date := current_date - 28;
  v_to date := current_date - 1;
  u record;
  d date;
  n int := 0;
  h int;
  v_start timestamptz;
  v_end timestamptz;
  v_tag text := '[TEST]';
begin
  -- alte Testdaten entfernen
  delete from public.attendance_requests where reason like v_tag || '%';
  delete from public.vacation_requests where note like v_tag || '%';
  delete from public.attendance where note like v_tag || '%';

  for u in select id, row_number() over (order by created_at) as nr from public.profiles where active loop
    update public.profiles set overtime_start = v_from where id = u.id;

    for d in select g::date from generate_series(v_from, v_to, interval '1 day') g loop
      continue when extract(isodow from d) > 5 or public.is_holiday_rlp(d);
      -- schon echte Zeiten an dem Tag? dann nichts anlegen
      continue when exists (
        select 1 from public.attendance a
        where a.installer_id = u.id and (a.started_at at time zone 'Europe/Berlin')::date = d
      );
      h := abs(hashtext(u.id::text || d::text));
      -- ab und zu ein Tag ohne Stempelzeit (z. B. krank), bei Person 3 eine Urlaubswoche (siehe unten)
      continue when h % 23 = 0;
      continue when u.nr % 5 = 3 and d between v_from + 7 and v_from + 11;
      -- Beginn 06:30–07:30, Ende 15:00–17:45
      v_start := (d + time '06:30' + ((h % 5) * interval '15 minutes')) at time zone 'Europe/Berlin';
      v_end := (d + time '15:00' + (((h / 7) % 12) * interval '15 minutes')) at time zone 'Europe/Berlin';
      if h % 4 = 0 then
        -- an manchen Tagen über Mittag ausgestempelt
        insert into public.attendance (installer_id, started_at, ended_at, note) values
          (u.id, v_start, (d + time '12:00') at time zone 'Europe/Berlin', v_tag),
          (u.id, (d + time '12:45') at time zone 'Europe/Berlin', v_end, v_tag);
      else
        insert into public.attendance (installer_id, started_at, ended_at, note) values (u.id, v_start, v_end, v_tag);
      end if;
      n := n + 1;
    end loop;

    -- Urlaub und Freizeit über Überstunden
    if u.nr % 5 = 3 then
      insert into public.vacation_requests (user_id, start_date, end_date, days, note, state, kind, decided_at)
      values (u.id, v_from + 7, v_from + 11, public.vacation_workdays(v_from + 7, v_from + 11), v_tag || ' Herbsturlaub',
              'genehmigt', 'urlaub', now());
    end if;
    if u.nr % 4 = 1 then
      insert into public.vacation_requests (user_id, start_date, end_date, days, note, state, kind)
      values (u.id, current_date + 14, current_date + 16, public.vacation_workdays(current_date + 14, current_date + 16),
              v_tag || ' Brückentage', 'beantragt', 'urlaub');
    end if;
    if u.nr % 3 = 2 then
      insert into public.vacation_requests (user_id, start_date, end_date, days, note, state, kind, decided_at)
      values (u.id, current_date + 21, current_date + 21, public.vacation_workdays(current_date + 21, current_date + 21),
              v_tag || ' Überstunden abbauen', 'genehmigt', 'ueberstunden', now());
    end if;

    -- offener Zeitnachtrag zum Genehmigen (bei jeder 3. Person)
    if u.nr % 3 = 0 then
      d := v_to;
      while extract(isodow from d) > 5 or public.is_holiday_rlp(d) loop
        d := d - 1;
      end loop;
      if not exists (select 1 from public.attendance a where a.installer_id = u.id
                     and (a.started_at at time zone 'Europe/Berlin')::date = d - 7) then
        insert into public.attendance_requests (user_id, started_at, ended_at, reason, requested_by)
        values (u.id, (d - 7 + time '07:00') at time zone 'Europe/Berlin', (d - 7 + time '16:00') at time zone 'Europe/Berlin',
                v_tag || ' Stempeln vergessen', u.id);
      end if;
    end if;
  end loop;

  raise notice '% Testtage Stempelzeiten angelegt', n;
end;
$$;

select p.full_name, p.email,
       (select count(*) from public.attendance a where a.installer_id = p.id and a.note like '[TEST]%') as stempelzeiten,
       (select count(*) from public.vacation_requests v where v.user_id = p.id and v.note like '[TEST]%') as urlaub,
       (select count(*) from public.attendance_requests r where r.user_id = p.id and r.reason like '[TEST]%') as nachtraege
from public.profiles p where p.active order by p.created_at;
