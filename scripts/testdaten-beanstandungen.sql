-- JOLEKA - Einfach besonders!: 10 abgeschlossene Test-Beanstandungen mit gebuchter Arbeitszeit (2026-10-24)
-- Je Beanstandung: Kunde mit Adresse in der Eifel, Team mit 1–2 Monteuren an einem vergangenen Werktag,
-- 2–4 erledigte Positionen (mit Artikelpreis, sofern Artikel angelegt sind), Arbeitsbericht, gebuchte
-- Auftragszeit je Monteur sowie eine plausible Fahrstrecke und Fahrzeit (damit "Selbstkosten berechnen"
-- sofort funktioniert, ohne Kartendienst). Titel beginnen mit "[TEST]"; ein erneuter Aufruf ersetzt sie.
-- Voraussetzung: alle Update-Skripte bis einschließlich update-fahrzeit sind eingespielt.

do $$
declare
  v_admin uuid;
  v_teams smallint[];
  v_fitters uuid[];
  v_articles bigint[];
  v_team smallint;
  v_day date;
  v_id bigint;
  v_crew uuid[];
  v_fit uuid;
  v_start timestamptz;
  v_hours numeric;
  i int;
  k int;
  c int;
  customers text[] := array['Familie Schneider', 'Bäckerei Huber', 'Familie Yilmaz', 'Praxis Dr. Wagner', 'Familie Becker',
                            'Hotel Eifelblick', 'Familie Hoffmann', 'Kita Regenbogen', 'Gasthaus Zur Post', 'Familie Fischer'];
  streets text[] := array['Hauptstraße', 'Bahnhofstraße', 'Kirchstraße', 'Schulstraße', 'Brunnenstraße',
                          'Bergstraße', 'Gartenstraße', 'Mühlenweg', 'Am Sportplatz', 'Lindenstraße'];
  zips text[] := array['54568', '54550', '54576', '54595', '54634', '54516', '54570', '56727', '54558', '54579'];
  cities text[] := array['Gerolstein', 'Daun', 'Hillesheim', 'Prüm', 'Bitburg', 'Wittlich', 'Pelm', 'Mayen', 'Gillenfeld', 'Üxheim'];
  km numeric[] := array[24.6, 18.2, 31.4, 58.8, 74.0, 96.2, 6.4, 112.6, 42.8, 27.2];
  minutes int[] := array[28, 24, 34, 58, 70, 82, 10, 96, 46, 32];
  titles text[] := array['Fenster schließt schwer', 'Haustür zieht', 'Rollladen klemmt', 'Glasbruch Terrassentür',
                         'Undichtigkeit am Wintergarten', 'Griff locker', 'Kondensat zwischen den Scheiben',
                         'Hebeschiebetür läuft schwer', 'Dichtung löst sich', 'Fenster lässt sich nicht kippen'];
  pos_texts text[] := array['Flügel einstellen', 'Dichtung tauschen', 'Griff ersetzen', 'Silikonfuge erneuern',
                            'Rollladenpanzer gangbar machen', 'Glas tauschen', 'Beschlag schmieren und prüfen',
                            'Anschlussfuge nacharbeiten', 'Funktionsprüfung mit Kunde', 'Schließblech versetzen'];
begin
  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Kein aktiver Admin gefunden';
  end if;
  select coalesce(array_agg(id order by sort), '{}') into v_teams from public.teams where area = 'kundendienst' and active;
  if cardinality(v_teams) = 0 then
    select coalesce(array_agg(id order by sort), '{}') into v_teams from public.teams where active;
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into v_fitters from public.profiles where role::text = 'monteur' and active;
  if cardinality(v_teams) = 0 or cardinality(v_fitters) = 0 then
    raise exception 'Es braucht mindestens ein aktives Team und einen aktiven Monteur';
  end if;
  select coalesce(array_agg(id order by id), '{}') into v_articles from public.articles where active and price is not null;

  -- alte Test-Beanstandungen aus diesem Skript entfernen
  delete from public.tickets where ticket_type = 'beanstandung' and title like '[TEST] BE-Kosten%';

  for i in 1..10 loop
    -- vergangener Werktag (1–3 Wochen zurück)
    v_day := current_date - (3 + i * 2);
    while extract(isodow from v_day) > 5 or public.is_holiday_rlp(v_day) loop
      v_day := v_day - 1;
    end loop;
    v_team := v_teams[1 + i % cardinality(v_teams)];

    -- Team besetzen, falls an dem Tag noch niemand drin ist (1–2 freie Monteure)
    if not exists (select 1 from public.team_members m where m.team_id = v_team and m.day = v_day) then
      insert into public.team_members (team_id, day, installer_id)
      select v_team, v_day, f.id
        from unnest(v_fitters) as f(id)
       where not exists (select 1 from public.team_members m where m.day = v_day and m.installer_id = f.id)
       limit 1 + i % 2;
    end if;
    select array_agg(installer_id order by lead desc) into v_crew from public.team_members where team_id = v_team and day = v_day;
    if v_crew is null then
      raise notice 'Am % ist kein Monteur frei, Beanstandung % übersprungen', v_day, i;
      continue;
    end if;

    c := i;
    insert into public.tickets (
      ticket_type, service_area, title, order_number, created_by, team_id, montage_date, montage_time,
      customer_number, customer_name, customer_street, customer_house_no, customer_zip, customer_city, customer_country,
      customer_email
    ) values (
      'beanstandung', 'kundendienst', '[TEST] BE-Kosten: ' || titles[i], 'A-2026-' || lpad((7000 + i)::text, 5, '0'),
      v_admin, v_team, v_day, time '08:00' + ((i % 3) * interval '2 hours'),
      'K-' || (20000 + c)::text, customers[c], streets[c], (1 + (c * 7) % 40)::text, zips[c], cities[c], 'Deutschland',
      'test' || c || '@example.de'
    ) returning id into v_id;

    for k in 1..(2 + i % 3) loop
      insert into public.ticket_positions (ticket_id, sort, position_number, description, article_id)
      values (v_id, k - 1, k::text, pos_texts[1 + (i + k * 3) % 10],
              case when cardinality(v_articles) > 0 and (i + k) % 2 = 0 then v_articles[1 + (i + k) % cardinality(v_articles)] end);
    end loop;
    update public.ticket_positions set state = 'erledigt' where ticket_id = v_id;

    -- gebuchte Arbeitszeit je Monteur: 1,5 bis 4,5 Std.
    v_start := (v_day + time '08:00' + ((i % 3) * interval '2 hours')) at time zone 'Europe/Berlin';
    foreach v_fit in array v_crew loop
      v_hours := 1.5 + ((i * 3 + array_position(v_crew, v_fit) * 5) % 7) * 0.5;
      insert into public.time_entries (ticket_id, installer_id, kind, started_at, ended_at)
      values (v_id, v_fit, 'arbeit', v_start, v_start + v_hours * interval '1 hour');
    end loop;

    update public.tickets
       set work_report = 'Testbericht: Beanstandung behoben, Funktion mit dem Kunden geprüft.',
           status = 'abgeschlossen',
           distance_km = km[i],
           distance_minutes = minutes[i],
           distance_address = site_address
     where id = v_id;
  end loop;
end;
$$;

select t.id, t.title, t.montage_date, t.distance_km as km,
       (select round(sum(extract(epoch from (e.ended_at - e.started_at)) / 3600)::numeric, 2) from public.time_entries e where e.ticket_id = t.id) as stunden,
       (select count(*) from public.ticket_positions p where p.ticket_id = t.id) as positionen
from public.tickets t
where t.title like '[TEST] BE-Kosten%'
order by t.id;
