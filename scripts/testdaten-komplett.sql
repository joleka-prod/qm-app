-- JOLEKA - Einfach besonders!: Bewegungsdaten leeren und vollständige Testdaten anlegen (2026-10-25)
--
-- 1. Löscht ALLE Kunden, Bauvorhaben, Aufträge (mit Positionen, Fotos-Einträgen, Verlauf, Kosten, Löschanträgen,
--    Auftragszeiten), Kommunikation, Stempelzeiten, Zeitnachträge, Urlaubsanträge und Team-Besetzungen.
--    Nummern beginnen wieder von vorn. Erhalten bleiben: Benutzer (mit Vorgesetzten, Urlaubsanspruch,
--    Wochenstunden), Teams und Artikel.
--    ACHTUNG: Das lässt sich nicht rückgängig machen.
-- 2. Legt an: 24 Kunden aller Gruppen mit Ansprechpartnern, 14 Bauvorhaben mit Beteiligten (Bauträger-,
--    GU- und Privatprojekte), je 14 Restarbeiten, Beanstandungen und Reparaturaufträge in allen Zuständen
--    (ungeplant, geplant, Termin angemeldet/bestätigt, erledigt, nicht erledigt mit Folgeauftrag, zur Berechnung,
--    berechnet, Selbstkosten berechnet, Löschantrag), Kommunikation mit Wiedervorlagen, Stempelzeiten der
--    letzten 4 Wochen, Urlaub, Freizeit über Überstunden und offene Zeitnachträge.
--    Testdaten sind mit "[TEST]" markiert.
-- Voraussetzung: alle Update-Skripte bis einschließlich update-bauvorhaben sind eingespielt,
-- mindestens ein aktiver Admin, ein Team und ein Monteur sind vorhanden.
--
-- Fotodateien im Speicher (Bucket ticket-photos) lassen sich per SQL nicht löschen und bleiben liegen.

truncate table
  public.ticket_events,
  public.ticket_photos,
  public.ticket_positions,
  public.time_entries,
  public.deletion_requests,
  public.ticket_costs,
  public.tickets,
  public.attendance_requests,
  public.attendance,
  public.vacation_requests,
  public.team_members,
  public.customer_notes,
  public.customer_contacts,
  public.project_customers,
  public.projects,
  public.customers
restart identity cascade;

do $$
declare
  v_admin uuid;
  v_planners uuid[];
  v_office uuid[];
  v_fitters uuid[];
  v_mteams smallint[];
  v_kteams smallint[];
  v_articles bigint[];
  v_cust bigint[] := '{}';
  v_proj bigint[] := '{}';
  v_proj_owner bigint[] := '{}';   -- Kunde des Auftrags je Bauvorhaben
  v_id bigint;
  v_pid bigint;
  v_cid bigint;
  v_team smallint;
  v_area public.service_area;
  v_type public.ticket_type;
  v_day date;
  v_shift int;
  v_crew uuid[];
  v_fit uuid;
  v_start timestamptz;
  v_tickets bigint[] := '{}';
  v_pos bigint;
  i int;
  k int;
  t int;
  d int;
  n int := 0;
  types public.ticket_type[] := array['restarbeit', 'beanstandung', 'reparatur']::public.ticket_type[];

  -- Kunden: Name, Zusatz, Gruppe, Straße, Nr., PLZ, Ort, Telefon, Mobil, E-Mail
  c_name text[] := array[
    'Familie Schneider', 'Familie Yilmaz', 'Familie Becker', 'Familie Hoffmann', 'Familie Schulz', 'Familie Weber',
    'Familie Klein', 'Familie Fischer', 'Familie Wagner', 'Familie Neumann', 'Familie Braun', 'Familie Zimmermann',
    'Eifel Wohnbau GmbH', 'Vulkaneifel Immobilien GmbH & Co. KG', 'Mosel Bauträger AG',
    'Hochbau Krämer GmbH', 'Bauunternehmung Thelen GmbH',
    'Architekturbüro Schmitz', 'Planungsgruppe Eifel', 'Architektin Petra Lenz',
    'Verbandsgemeinde Gerolstein', 'Stadt Daun', 'Kreisverwaltung Vulkaneifel', 'Ortsgemeinde Pelm'];
  c_name2 text[] := array['', '', '', '', '', '', '', '', '', '', '', '',
    'Niederlassung Daun', '', '', '', '', 'Freie Architekten BDA', '', '', 'Bauamt', 'Gebäudemanagement', 'Hochbau', ''];
  c_group text[] := array['privat', 'privat', 'privat', 'privat', 'privat', 'privat', 'privat', 'privat', 'privat', 'privat',
    'privat', 'privat', 'bautraeger', 'bautraeger', 'bautraeger', 'generalunternehmer', 'generalunternehmer',
    'architekt', 'architekt', 'architekt', 'oeffentlich', 'oeffentlich', 'oeffentlich', 'oeffentlich'];
  c_street text[] := array['Hauptstraße', 'Bahnhofstraße', 'Kirchstraße', 'Schulstraße', 'Brunnenstraße', 'Bergstraße',
    'Gartenstraße', 'Mühlenweg', 'Am Sportplatz', 'Lindenstraße', 'Eichenweg', 'Am Kalvarienberg',
    'Industriestraße', 'Mainzer Straße', 'Moselweinstraße', 'Gewerbegebiet Süd', 'Raiffeisenstraße',
    'Burgstraße', 'Leopoldstraße', 'Wehrbüschstraße', 'Kasselburger Weg', 'Leopoldstraße', 'Mainzer Straße', 'Dorfstraße'];
  c_no text[] := array['12', '3a', '27', '8', '44', '15', '2', '19', '5', '31', '7', '11',
    '4', '21', '102', '9', '14', '6', '30', '2', '2', '28', '20', '1'];
  c_zip text[] := array['54568', '54550', '54576', '54595', '54634', '54516', '54570', '56727', '54558', '54579', '54568', '54550',
    '54550', '54550', '54470', '54568', '54595', '54550', '54550', '54550', '54568', '54550', '54550', '54570'];
  c_city text[] := array['Gerolstein', 'Daun', 'Hillesheim', 'Prüm', 'Bitburg', 'Wittlich', 'Pelm', 'Mayen', 'Gillenfeld', 'Üxheim',
    'Gerolstein', 'Daun', 'Daun', 'Daun', 'Bernkastel-Kues', 'Gerolstein', 'Prüm', 'Daun', 'Daun', 'Daun',
    'Gerolstein', 'Daun', 'Daun', 'Pelm'];
  -- Ansprechpartner für Firmen und Behörden (Kunde 13–24): Name, Funktion
  p_name text[] := array['Thomas Müller', 'Sabine Krause', 'Jörg Weiler', 'Andreas Klein', 'Monika Thelen', 'Stefan Schmitz',
    'Laura Pütz', 'Petra Lenz', 'Michael Hens', 'Karin Esch', 'Dr. Frank Hahn', 'Ortsbürgermeister Peter Roth'];
  p_pos text[] := array['Projektleiter', 'Kaufmännische Leitung', 'Bauleiter', 'Bauleiter', 'Einkauf', 'Inhaber',
    'Projektarchitektin', 'Inhaberin', 'Bauamt, Sachbearbeiter Hochbau', 'Hausmeisterkoordination', 'Abteilungsleiter Hochbau', 'Ortsbürgermeister'];

  -- Bauvorhaben: Bezeichnung, Straße, Nr., PLZ, Ort, Bauherr (Kunde-Nr. im Array), Partner (0 = keiner), Architekt (0 = keiner)
  b_name text[] := array['Wohnpark Am Weinberg, Haus 1', 'Wohnpark Am Weinberg, Haus 2', 'Stadtvillen Daun-Süd',
    'Seniorenwohnen Bernkastel', 'Grundschule Gerolstein, Erweiterung', 'Rathaus Daun, Fenstersanierung',
    'Kita Pelm, Neubau', 'Einfamilienhaus Schneider', 'Altbausanierung Becker', 'Haus Hoffmann',
    'Doppelhaushälfte Weber', 'Bungalow Klein', 'Sanierung Fischer', 'Haus Wagner'];
  b_street text[] := array['Am Weinberg', 'Am Weinberg', 'Lindenallee', 'Moselufer', 'Raderstraße', 'Leopoldstraße',
    'Kirchweg', 'Hauptstraße', 'Kirchstraße', 'Schulstraße', 'Bergstraße', 'Gartenstraße', 'Mühlenweg', 'Am Sportplatz'];
  b_no text[] := array['1', '3', '10–16', '5', '20', '28', '4', '12', '27', '8', '15', '2', '19', '5'];
  b_zip text[] := array['54550', '54550', '54550', '54470', '54568', '54550', '54570', '54568', '54576', '54595', '54516', '54570', '56727', '54558'];
  b_city text[] := array['Daun', 'Daun', 'Daun', 'Bernkastel-Kues', 'Gerolstein', 'Daun', 'Pelm', 'Gerolstein', 'Hillesheim',
    'Prüm', 'Wittlich', 'Pelm', 'Mayen', 'Gillenfeld'];
  b_owner int[] := array[2, 10, 11, 12, 21, 22, 24, 1, 3, 4, 6, 7, 8, 9];
  b_partner int[] := array[13, 13, 14, 15, 16, 16, 17, 0, 0, 0, 0, 0, 0, 0];
  b_arch int[] := array[18, 18, 19, 0, 20, 19, 18, 0, 20, 0, 0, 0, 0, 0];

  job_titles text[] := array['Fenster schließt schwer', 'Haustür zieht', 'Rollladen klemmt', 'Insektenschutz fehlt',
    'Glasbruch Terrassentür', 'Undichtigkeit am Wintergarten', 'Griff locker', 'Abschlussleisten fehlen',
    'Fensterbank innen beschädigt', 'Kondensat zwischen den Scheiben', 'Hebeschiebetür läuft schwer',
    'Dichtung löst sich', 'Rollladengurt gerissen', 'Haustürschloss defekt'];
  pos_texts text[] := array['Flügel einstellen', 'Dichtung tauschen', 'Griff ersetzen', 'Silikonfuge erneuern',
    'Rollladenpanzer prüfen und gangbar machen', 'Abdeckkappen montieren', 'Glas tauschen' || chr(10) || 'Maße vor Ort prüfen',
    'Anschlussfuge außen nacharbeiten', 'Fensterbank austauschen', 'Funktionsprüfung mit Kunde'];
  km numeric[] := array[24.6, 18.2, 31.4, 58.8, 74.0, 96.2, 6.4, 112.6, 42.8, 27.2, 12.0, 36.6, 64.4, 20.8];
  minutes int[] := array[28, 24, 34, 58, 70, 82, 10, 96, 46, 32, 16, 40, 62, 26];
begin
  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Kein aktiver Admin gefunden';
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into v_planners
    from public.profiles where role::text in ('admin', 'teamleiter', 'disposition') and active;
  select coalesce(array_agg(id order by created_at), '{}') into v_office
    from public.profiles where role::text <> 'monteur' and active;
  select coalesce(array_agg(id order by created_at), '{}') into v_fitters from public.profiles where role::text = 'monteur' and active;
  select coalesce(array_agg(id order by sort), '{}') into v_mteams from public.teams where area = 'montage' and active;
  select coalesce(array_agg(id order by sort), '{}') into v_kteams from public.teams where area = 'kundendienst' and active;
  select coalesce(array_agg(id order by id), '{}') into v_articles from public.articles where active and price is not null;

  -- Als Admin handeln, damit Prüfungen in den Funktionen (Termine, Berechnung, Folgeauftrag) greifen
  perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

  -- --- Kunden mit Ansprechpartnern ---
  for i in 1..24 loop
    insert into public.customers (customer_group, name, name2, street, house_no, zip, city, phone, mobile, email, notes, created_by)
    values (c_group[i], c_name[i], c_name2[i], c_street[i], c_no[i], c_zip[i], c_city[i],
            '0659' || (1 + i % 9) || ' ' || (1000 + i * 37)::text,
            case when i % 3 <> 0 then '0170 ' || (4000000 + i * 1371)::text else '' end,
            case when i % 4 <> 3 then 'test' || i || '@example.de' else '' end,
            case when i = 13 then '[TEST] Rahmenvertrag 2026, Zahlungsziel 30 Tage'
                 when i = 21 then '[TEST] Rechnungen nur über das Bauamt, VOB/B'
                 when i = 4 then '[TEST] Hund im Garten, bitte vorher klingeln' else '' end,
            v_admin)
    returning id into v_cid;
    v_cust := v_cust || v_cid;
    if i > 12 then
      insert into public.customer_contacts (customer_id, name, position, phone, mobile, email)
      values (v_cid, p_name[i - 12], p_pos[i - 12], '0659' || (1 + i % 9) || ' ' || (1000 + i * 37)::text || '-' || (10 + i),
              '0171 ' || (5000000 + i * 913)::text, 'kontakt' || i || '@example.de');
      if i in (13, 16, 21) then
        insert into public.customer_contacts (customer_id, name, position, phone, email)
        values (v_cid, case i when 13 then 'Nina Becker' when 16 then 'Heinz Lorenz' else 'Ute Molitor' end,
                case i when 13 then 'Vertrieb / Käuferbetreuung' when 16 then 'Polier' else 'Vergabestelle' end,
                '0659' || (1 + i % 9) || ' ' || (1000 + i * 37)::text || '-20', 'info' || i || '@example.de');
      end if;
    end if;
  end loop;

  -- --- Bauvorhaben mit Beteiligten ---
  for i in 1..14 loop
    insert into public.projects (name, street, house_no, zip, city, status, notes, created_by)
    values (b_name[i], b_street[i], b_no[i], b_zip[i], b_city[i], case when i = 13 then 'abgeschlossen' else 'aktiv' end,
            case when i = 5 then '[TEST] Bauabschnitt 2, Fertigstellung Sommerferien' else '' end, v_admin)
    returning id into v_pid;
    v_proj := v_proj || v_pid;
    insert into public.project_customers (project_id, customer_id, role)
    values (v_pid, v_cust[b_owner[i]], 'bauherr');
    if b_partner[i] > 0 then
      insert into public.project_customers (project_id, customer_id, role)
      values (v_pid, v_cust[b_partner[i]], c_group[b_partner[i]]);
    end if;
    if b_arch[i] > 0 then
      insert into public.project_customers (project_id, customer_id, role)
      values (v_pid, v_cust[b_arch[i]], 'architekt');
    end if;
    -- Restarbeiten in Bauträger-/GU-Projekten gehen an den Partner, sonst an den Bauherrn
    v_proj_owner := v_proj_owner || v_cust[case when b_partner[i] > 0 then b_partner[i] else b_owner[i] end];
  end loop;
  -- zweiter Endkunde im Wohnpark Haus 1, Bauherr Kita Pelm zusätzlich als Sonstige (Träger)
  insert into public.project_customers (project_id, customer_id, role, note)
  values (v_proj[1], v_cust[5], 'bauherr', '[TEST] Wohnung 2 OG links'),
         (v_proj[7], v_cust[23], 'sonstige', '[TEST] Fördermittelgeber');

  -- --- Aufträge ---
  foreach v_type in array types loop
    t := array_position(types, v_type);
    for i in 1..14 loop
      n := n + 1;
      v_pid := v_proj[1 + (i * 3 + t * 5) % 14];
      k := array_position(v_proj, v_pid);
      v_cid := case when v_type = 'restarbeit' then v_proj_owner[k] else v_cust[b_owner[k]] end;

      -- Werktag: Nr. 4–9 in den letzten gut eineinhalb Wochen, ab Nr. 10 heute und in den nächsten Tagen
      v_shift := (i - 10) + (t - 2);
      v_day := current_date;
      while extract(isodow from v_day) > 5 or public.is_holiday_rlp(v_day) loop
        v_day := v_day + 1;
      end loop;
      for d in 1..abs(v_shift) loop
        v_day := v_day + sign(v_shift)::int;
        while extract(isodow from v_day) > 5 or public.is_holiday_rlp(v_day) loop
          v_day := v_day + sign(v_shift)::int;
        end loop;
      end loop;
      v_area := case when v_type = 'restarbeit' or i % 4 = 0 then 'montage'::public.service_area
                     else 'kundendienst'::public.service_area end;

      -- die ersten 3 je Art bleiben ungeplant
      v_team := null;
      if i > 3 then
        if v_area = 'montage' and cardinality(v_mteams) > 0 then
          v_team := v_mteams[1 + (i + t) % least(cardinality(v_mteams), 4)];
        elsif cardinality(v_kteams) > 0 then
          v_team := v_kteams[1 + (i + t) % cardinality(v_kteams)];
        end if;
        if v_team is not null and not exists (select 1 from public.team_members m where m.team_id = v_team and m.day = v_day) then
          insert into public.team_members (team_id, day, installer_id)
          select v_team, v_day, f.id
            from unnest(v_fitters) as f(id)
           where not exists (select 1 from public.team_members m where m.day = v_day and m.installer_id = f.id)
           limit 1 + i % 2;
        end if;
        if v_team is not null and not exists (select 1 from public.team_members m where m.team_id = v_team and m.day = v_day) then
          v_team := null;
        end if;
      end if;

      insert into public.tickets (
        ticket_type, service_area, title, order_number, created_by, team_id, montage_date, montage_time, project_id,
        customer_id, customer_number, customer_name, customer_street, customer_house_no, customer_zip, customer_city,
        customer_country, customer_email, customer_phone, customer_mobile,
        jobsite_address_different, jobsite_name, jobsite_street, jobsite_house_no, jobsite_zip, jobsite_city, jobsite_country,
        billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city, billing_country
      )
      select v_type, v_area, '[TEST] ' || job_titles[1 + (i + t * 4) % 14],
             'A-2026-' || lpad((5000 + n)::text, 5, '0'), v_office[1 + n % cardinality(v_office)],
             v_team, case when v_team is not null then v_day end,
             case when v_team is not null then time '07:30' + ((i % 4) * interval '2 hours') end,
             v_pid,
             c.id, c.customer_number, trim(c.name || ' ' || c.name2), c.street, c.house_no, c.zip, c.city, c.country, c.email, c.phone, c.mobile,
             -- Baustelle = Bauvorhaben, wenn es nicht die Kundenadresse ist
             (p.street, p.zip) is distinct from (c.street, c.zip), p.name, p.street, p.house_no, p.zip, p.city, p.country,
             i % 6 = 0, case when i % 6 = 0 then 'Hausverwaltung Eifel GmbH' else '' end,
             case when i % 6 = 0 then 'Bahnhofstraße' else '' end, case when i % 6 = 0 then '10' else '' end,
             case when i % 6 = 0 then '54568' else '' end, case when i % 6 = 0 then 'Gerolstein' else '' end, 'Deutschland'
        from public.customers c, public.projects p
       where c.id = v_cid and p.id = v_pid
      returning id into v_id;
      v_tickets := v_tickets || v_id;

      for k in 1..(2 + (i + t) % 3) loop
        insert into public.ticket_positions (ticket_id, sort, position_number, description, article_id)
        values (v_id, k - 1, k::text, pos_texts[1 + (i + k * 3 + t) % 10],
                case when cardinality(v_articles) > 0 and (i + k) % 2 = 0 then v_articles[1 + (i + k) % cardinality(v_articles)] end);
      end loop;

      -- Termin mit dem Kunden: angemeldet bzw. bestätigt (künftige Einsätze)
      if v_team is not null and v_day >= current_date and i % 3 <> 0 then
        perform public.announce_appointment(v_id, v_day, time '07:30' + ((i % 4) * interval '2 hours'),
                                            v_planners[1 + i % cardinality(v_planners)], '[TEST] telefonisch');
        if i % 3 = 1 then
          perform public.confirm_appointment(v_id, '[TEST] per E-Mail bestätigt');
        end if;
      end if;

      -- vergangene Einsätze erledigen (als verantwortlicher Monteur), einer je Art mit nicht erledigter Position
      if v_team is not null and v_day < current_date then
        select array_agg(installer_id order by lead desc) into v_crew from public.team_members where team_id = v_team and day = v_day;
        perform set_config('request.jwt.claims', json_build_object('sub', v_crew[1], 'role', 'authenticated')::text, true);
        update public.ticket_positions set state = 'erledigt' where ticket_id = v_id;
        if i = 5 then
          update public.ticket_positions set state = 'nicht_erledigt', reason = 'Ersatzteil muss bestellt werden'
           where ticket_id = v_id and sort = 0;
        end if;
        v_start := (v_day + time '07:30' + ((i % 4) * interval '2 hours')) at time zone 'Europe/Berlin';
        foreach v_fit in array v_crew loop
          insert into public.time_entries (ticket_id, installer_id, kind, started_at, ended_at)
          values (v_id, v_fit, 'arbeit', v_start, v_start + (1.5 + ((i * 3 + array_position(v_crew, v_fit) * 5) % 6) * 0.5) * interval '1 hour');
        end loop;
        update public.tickets
           set work_report = case when i = 5 then '[TEST] Ersatzteil fehlt, Folgetermin nötig.'
                                  else '[TEST] Alle Positionen erledigt, Funktion mit dem Kunden geprüft.' end,
               signer_name = case when i % 2 = 0 then customer_name else '' end,
               signed_at = case when i % 2 = 0 then v_start + interval '3 hours' end,
               status = 'abgeschlossen'
         where id = v_id;
        -- Fahrstrecke schreibt sonst nur der Kartendienst (ohne angemeldeten Benutzer)
        perform set_config('request.jwt.claims', '', true);
        update public.tickets set distance_km = km[i], distance_minutes = minutes[i], distance_address = site_address where id = v_id;
        perform set_config('request.jwt.claims', json_build_object('sub', v_admin, 'role', 'authenticated')::text, true);

        -- Folgeauftrag zum nicht ganz erledigten Einsatz
        if i = 5 then
          perform public.create_followup(v_id);
        end if;
        -- Beanstandungen: Selbstkosten berechnen
        if v_type = 'beanstandung' and i <> 5 then
          perform public.calc_self_cost(v_id);
        end if;
        -- Reparaturen: Preise eintragen, jede zweite abrechnen
        if v_type = 'reparatur' then
          for v_pos in select id from public.ticket_positions where ticket_id = v_id order by sort loop
            perform public.set_position_billing(v_pos, 1 + v_pos % 3, 'Stk', 35 + (v_pos * 17) % 120);
          end loop;
          if i % 2 = 0 then
            perform public.finish_billing(v_id);
          end if;
        end if;
      end if;
    end loop;
  end loop;

  -- Löschantrag für einen ungeplanten Auftrag
  insert into public.deletion_requests (ticket_id, requested_by, reason)
  values (v_tickets[2], v_office[cardinality(v_office)], '[TEST] Doppelt angelegt');

  -- --- Kommunikation mit Wiedervorlagen ---
  for i in 1..24 loop
    for k in 1..(1 + i % 3) loop
      insert into public.customer_notes (customer_id, project_id, ticket_id, kind, subject, body, follow_up_date, follow_up_user, created_by, created_at)
      select v_cust[i],
             (select pc.project_id from public.project_customers pc where pc.customer_id = v_cust[i] order by pc.project_id limit 1),
             case when k = 2 then (select t.id from public.tickets t where t.customer_id = v_cust[i] order by t.id limit 1) end,
             (array['telefon', 'email', 'termin', 'brief', 'notiz'])[1 + (i + k) % 5],
             (array['[TEST] Rückfrage zum Termin', '[TEST] Angebot nachgefragt', '[TEST] Bemusterung vor Ort',
                    '[TEST] Reklamation gemeldet', '[TEST] Rechnung besprochen', '[TEST] Zufriedenheit nach Montage'])[1 + (i * 2 + k) % 6],
             (array['Kunde bittet um Rückruf am Vormittag.', 'Angebot für 6 weitere Fenster gewünscht, Maße folgen.',
                    'Farbe und Griffe ausgewählt, Muster bleiben beim Kunden.', 'Fenster im Bad schließt nicht mehr richtig.',
                    'Skonto gewährt, Zahlung bis Monatsende zugesagt.', 'Alles in Ordnung, Kunde empfiehlt uns weiter.'])[1 + (i + k * 2) % 6],
             case when (i + k) % 4 = 0 then current_date + ((i + k) % 9) - 3 end,
             case when (i + k) % 4 = 0 then v_office[1 + (i + k) % cardinality(v_office)] end,
             v_office[1 + (i * k) % cardinality(v_office)],
             now() - ((30 - i) || ' days')::interval - (k || ' hours')::interval;
    end loop;
  end loop;
  -- einige Wiedervorlagen schon erledigt
  update public.customer_notes set follow_up_done_at = now() - interval '1 day', follow_up_done_by = follow_up_user
   where follow_up_date < current_date - 1;

  perform set_config('request.jwt.claims', '', true);
  raise notice '% Kunden, % Bauvorhaben, % Aufträge angelegt', cardinality(v_cust), cardinality(v_proj), n;
end;
$$;

-- --- Zeiterfassung: Stempelzeiten der letzten 4 Wochen, Urlaub, Überstunden-Freizeit, Zeitnachträge ---
do $$
declare
  v_from date := current_date - 28;
  v_to date := current_date - 1;
  u record;
  d date;
  h int;
  v_start timestamptz;
  v_end timestamptz;
  v_tag text := '[TEST]';
begin
  for u in select id, row_number() over (order by created_at) as nr from public.profiles where active loop
    update public.profiles set overtime_start = v_from where id = u.id;
    for d in select g::date from generate_series(v_from, v_to, interval '1 day') g loop
      continue when extract(isodow from d) > 5 or public.is_holiday_rlp(d);
      h := abs(hashtext(u.id::text || d::text));
      continue when h % 23 = 0;
      continue when u.nr % 5 = 3 and d between v_from + 7 and v_from + 11;
      v_start := (d + time '06:30' + ((h % 5) * interval '15 minutes')) at time zone 'Europe/Berlin';
      v_end := (d + time '15:00' + (((h / 7) % 12) * interval '15 minutes')) at time zone 'Europe/Berlin';
      if h % 4 = 0 then
        insert into public.attendance (installer_id, started_at, ended_at, note) values
          (u.id, v_start, (d + time '12:00') at time zone 'Europe/Berlin', v_tag),
          (u.id, (d + time '12:45') at time zone 'Europe/Berlin', v_end, v_tag);
      else
        insert into public.attendance (installer_id, started_at, ended_at, note) values (u.id, v_start, v_end, v_tag);
      end if;
    end loop;

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
    if u.nr % 3 = 0 then
      d := v_to - 7;
      while extract(isodow from d) > 5 or public.is_holiday_rlp(d) loop
        d := d - 1;
      end loop;
      delete from public.attendance a where a.installer_id = u.id and (a.started_at at time zone 'Europe/Berlin')::date = d;
      insert into public.attendance_requests (user_id, started_at, ended_at, reason, requested_by)
      values (u.id, (d + time '07:00') at time zone 'Europe/Berlin', (d + time '16:00') at time zone 'Europe/Berlin',
              v_tag || ' Stempeln vergessen', u.id);
    end if;
  end loop;
end;
$$;

-- Übersicht
select 'Kunden' as was, count(*) as anzahl from public.customers
union all select 'Ansprechpartner', count(*) from public.customer_contacts
union all select 'Bauvorhaben', count(*) from public.projects
union all select 'Beteiligte', count(*) from public.project_customers
union all select 'Aufträge', count(*) from public.tickets
union all select '  davon ungeplant', count(*) from public.tickets where status = 'neu'
union all select '  davon geplant', count(*) from public.tickets where status = 'zugewiesen'
union all select '  davon erledigt', count(*) from public.tickets where status = 'abgeschlossen'
union all select '  davon Folgeaufträge', count(*) from public.tickets where parent_id is not null
union all select '  Termin angemeldet/bestätigt', count(*) from public.tickets where appointment_state <> 'offen'
union all select '  zur Berechnung / berechnet', count(*) from public.tickets where billing_state <> 'keine'
union all select 'Selbstkosten berechnet', count(*) from public.ticket_costs
union all select 'Kommunikation', count(*) from public.customer_notes
union all select '  offene Wiedervorlagen', count(*) from public.customer_notes where follow_up_date is not null and follow_up_done_at is null
union all select 'Stempelzeiten', count(*) from public.attendance
union all select 'Urlaubsanträge', count(*) from public.vacation_requests
union all select 'Zeitnachträge offen', count(*) from public.attendance_requests where state = 'beantragt';
