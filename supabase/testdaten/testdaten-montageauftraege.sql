-- JOLEKA 360°: 10 Test-Montageaufträge für die Vorplanung (2026-10-26)
-- Alle Aufträge sind ungeplant (Status "Ungeplant"), haben eine kalkulierte Montagezeit (Mann × Tage)
-- und sind größtenteils einer Kalenderwoche vorgemerkt:
--   1 ohne Woche, 1 mit vergangener Woche, 8 verteilt auf diese und die nächsten 4 Wochen.
-- Titel beginnen mit "[TEST]" und lassen sich mit testdaten-loeschen.sql wieder entfernen.
-- Voraussetzung: SQL-Updates bis 20261025090000 sind ausgeführt.

do $$
declare
  v_admin uuid;
  v_id bigint;
  v_monday date := date_trunc('week', current_date)::date;
  i int;
  p int;
  customers text[] := array['Familie Schneider', 'Wohnbau Oberschwaben GmbH', 'Familie Yilmaz', 'Architekturbüro Kern',
                            'Gemeinde Laupheim', 'Familie Becker', 'Hausbau Riedlinger GmbH', 'Familie Hoffmann',
                            'Stadt Biberach – Hochbauamt', 'Familie Schulz'];
  titles text[] := array['Neubau EFH: 14 Fenster und Haustür', 'MFH Lindenpark: Fenster Haus A', 'Fenstertausch Altbau',
                         'Bürogebäude: Pfosten-Riegel-Fassade', 'Grundschule: Fenster 1. OG', 'Hebe-Schiebe-Tür Wohnzimmer',
                         'Reihenhäuser Sonnenhalde: Fenster und Rollläden', 'Wintergarten-Anschluss und 6 Fenster',
                         'Rathaus: Austausch Fenster Nordseite', 'Haustür und Seitenteil'];
  places text[] := array['Lindenweg 12' || chr(10) || '88400 Biberach', 'Lindenpark 4' || chr(10) || '88471 Laupheim',
                         'Rosenstr. 7' || chr(10) || '89584 Ehingen', 'Industriestr. 45' || chr(10) || '88400 Biberach',
                         'Schulstr. 14' || chr(10) || '88471 Laupheim', 'Am Hang 5' || chr(10) || '88416 Ochsenhausen',
                         'Sonnenhalde 1–6' || chr(10) || '88427 Bad Schussenried', 'Gartenweg 2' || chr(10) || '88400 Biberach',
                         'Marktplatz 1' || chr(10) || '88400 Biberach', 'Birkenallee 9' || chr(10) || '89584 Ehingen'];
  men int[] := array[2, 3, 2, 4, 3, 2, 3, 2, 3, 2];
  days numeric[] := array[3, 5, 1.5, 8, 4, 1, 6, 2.5, 3, 0.5];
  -- Woche relativ zu dieser Woche (null = noch nicht vorgemerkt)
  weeks int[] := array[0, 0, 1, 1, 2, 2, 3, 4, null, -1];
  pos text[] := array['Fenster liefern und montieren', 'Anschlussfugen innen und außen abdichten',
                      'Fensterbänke innen und außen montieren', 'Funktionsprüfung und Einweisung Kunde'];
begin
  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Kein aktiver Admin gefunden';
  end if;

  for i in 1..10 loop
    insert into public.tickets (ticket_type, service_area, title, description, order_number, customer_name, site_address,
                                created_by, calc_men, calc_days, planned_week)
    values (
      'montageauftrag',
      'montage',
      '[TEST] ' || titles[i],
      'Testauftrag für die Vorplanung.',
      'MA-2026-' || lpad((5000 + i)::text, 5, '0'),
      customers[i],
      places[i],
      v_admin,
      men[i],
      days[i],
      case when weeks[i] is not null then v_monday + weeks[i] * 7 end
    )
    returning id into v_id;

    for p in 1..case when i % 2 = 0 then 4 else 2 end loop
      insert into public.ticket_positions (ticket_id, sort, position_number, description)
      values (v_id, p, (p * 10)::text, pos[p]);
    end loop;
  end loop;
end;
$$;
