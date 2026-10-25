-- JOLEKA Service Dashboard: Datenbank leeren und neue Testdaten anlegen (2026-10-24)
--
-- 1. Löscht ALLE Aufträge mit Positionen, Fotos-Einträgen, Verlauf, Löschanträgen und Auftragszeiten,
--    außerdem alle Stempelzeiten, Urlaubsanträge, Team-Besetzungen, Kunden und Bauvorhaben. Auftragsnummern beginnen wieder bei 1.
--    Erhalten bleiben: Benutzer (inkl. Vorgesetzte und Urlaubsanspruch), Teams und Artikel.
--    ACHTUNG: Das lässt sich nicht rückgängig machen.
-- 2. Legt je 15 Restarbeiten, Beanstandungen und Reparaturaufträge an (Titel beginnen mit "[TEST]").
--    Einsätze werden auf Werktage um heute verteilt und – soweit Teams und Monteure vorhanden – eingeplant.
--
-- Fotodateien im Speicher (Bucket ticket-photos) lassen sich per SQL nicht löschen und bleiben liegen.

truncate table
  public.ticket_events,
  public.ticket_photos,
  public.ticket_positions,
  public.time_entries,
  public.deletion_requests,
  public.tickets,
  public.attendance,
  public.vacation_requests,
  public.team_members,
  public.ticket_costs,
  public.attendance_requests,
  public.customer_notes,
  public.customer_contacts,
  public.project_customers,
  public.projects,
  public.customers
restart identity cascade;

do $$
declare
  v_admin uuid;
  v_fitters uuid[];
  v_mteams smallint[];
  v_kteams smallint[];
  v_area public.service_area;
  v_team smallint;
  v_id bigint;
  v_type public.ticket_type;
  v_day date;
  v_shift int;
  i int;
  d int;
  t int;
  c int;
  n int := 0;
  types public.ticket_type[] := array['restarbeit', 'beanstandung', 'reparatur']::public.ticket_type[];
  customers text[] := array['Familie Schneider', 'Bäckerei Huber', 'Autohaus Maier GmbH', 'Familie Yilmaz', 'Praxis Dr. Wagner',
                            'Familie Becker', 'Hotel Eifelblick', 'Familie Hoffmann', 'Kita Regenbogen', 'Familie Schulz',
                            'Familie Weber', 'Gasthaus Zur Post', 'Familie Klein', 'Steuerbüro Lang', 'Familie Fischer'];
  streets text[] := array['Hauptstraße', 'Bahnhofstraße', 'Kirchstraße', 'Schulstraße', 'Brunnenstraße',
                          'Bergstraße', 'Gartenstraße', 'Mühlenweg', 'Am Sportplatz', 'Lindenstraße'];
  zips text[] := array['54568', '54550', '54576', '54595', '54634', '54516', '54570', '56727'];
  cities text[] := array['Gerolstein', 'Daun', 'Hillesheim', 'Prüm', 'Bitburg', 'Wittlich', 'Pelm', 'Mayen'];
  job_titles text[] := array['Fenster schließt schwer', 'Haustür zieht', 'Rollladen klemmt', 'Insektenschutz fehlt',
                             'Glasbruch Terrassentür', 'Undichtigkeit am Wintergarten', 'Griff locker', 'Abschlussleisten fehlen',
                             'Fensterbank innen beschädigt', 'Kondensat zwischen den Scheiben', 'Hebeschiebetür läuft schwer',
                             'Dichtung löst sich', 'Rollladengurt gerissen', 'Haustürschloss defekt', 'Fenster lässt sich nicht kippen'];
  pos_texts text[] := array['Flügel einstellen', 'Dichtung tauschen', 'Griff ersetzen', 'Silikonfuge erneuern',
                            'Rollladenpanzer prüfen und gangbar machen', 'Abdeckkappen montieren', 'Glas tauschen' || chr(10) || 'Maße vor Ort prüfen',
                            'Anschlussfuge außen nacharbeiten', 'Fensterbank austauschen', 'Funktionsprüfung mit Kunde'];
begin
  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Kein aktiver Admin gefunden';
  end if;
  select coalesce(array_agg(id order by sort), '{}') into v_mteams from public.teams where area = 'montage' and active;
  select coalesce(array_agg(id order by sort), '{}') into v_kteams from public.teams where area = 'kundendienst' and active;
  select coalesce(array_agg(id order by created_at), '{}') into v_fitters
    from public.profiles where role::text = 'monteur' and active;

  foreach v_type in array types loop
    t := array_position(types, v_type);
    for i in 1..15 loop
      n := n + 1;
      c := 1 + (i + t * 5) % 15;   -- Kunde
      -- Werktag: von gut einer Woche zurück bis knapp zwei Wochen voraus (i = 5, 6 immer in der Vergangenheit)
      v_shift := (i - 8) + (t - 2);
      v_day := current_date;
      while extract(isodow from v_day) > 5 loop
        v_day := v_day + 1;
      end loop;
      for d in 1..abs(v_shift) loop
        v_day := v_day + sign(v_shift)::int;
        while extract(isodow from v_day) > 5 loop
          v_day := v_day + sign(v_shift)::int;
        end loop;
      end loop;
      v_area := case when v_type = 'restarbeit' or i % 3 = 0 then 'montage'::public.service_area
                     else 'kundendienst'::public.service_area end;

      -- Die ersten 4 je Art bleiben ungeplant, der Rest wird eingeplant (sofern Team + Monteur verfügbar)
      v_team := null;
      if i > 4 then
        if v_area = 'montage' and cardinality(v_mteams) > 0 then
          v_team := v_mteams[1 + (i + t) % cardinality(v_mteams)];
        elsif v_area = 'kundendienst' and cardinality(v_kteams) > 0 then
          v_team := v_kteams[1 + (i + t) % cardinality(v_kteams)];
        end if;
        if v_team is not null and not exists (select 1 from public.team_members m where m.team_id = v_team and m.day = v_day) then
          insert into public.team_members (team_id, day, installer_id)
          select v_team, v_day, f.id
            from unnest(v_fitters) as f(id)
           where not exists (select 1 from public.team_members m where m.day = v_day and m.installer_id = f.id)
           limit 2;
        end if;
        if v_team is not null and not exists (select 1 from public.team_members m where m.team_id = v_team and m.day = v_day) then
          v_team := null;
        end if;
      end if;

      insert into public.tickets (
        ticket_type, service_area, title, order_number, created_by, team_id, montage_date, montage_time,
        customer_number, customer_name, customer_street, customer_house_no, customer_zip, customer_city, customer_country,
        customer_email,
        jobsite_address_different, jobsite_name, jobsite_street, jobsite_house_no, jobsite_zip, jobsite_city, jobsite_country,
        billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city, billing_country
      ) values (
        v_type,
        v_area,
        '[TEST] ' || job_titles[1 + (i + t * 4) % 15],
        'A-2026-' || lpad((5000 + n)::text, 5, '0'),
        v_admin,
        v_team,
        case when v_team is not null then v_day end,
        case when v_team is not null then (time '07:30' + ((i % 4) * interval '2 hours')) end,
        'K-' || (10000 + c)::text,
        customers[c],
        streets[1 + c % 10],
        (1 + (c * 7) % 40)::text,
        zips[1 + c % 8],
        cities[1 + c % 8],
        'Deutschland',
        case when i % 3 <> 1 then 'test' || c || '@example.de' else '' end,
        -- Jeder 5. Auftrag mit abweichender Baustelle, jeder 7. mit abweichender Rechnungsadresse
        i % 5 = 0,
        case when i % 5 = 0 then 'Neubau ' || customers[c] else '' end,
        case when i % 5 = 0 then streets[1 + (c + 3) % 10] else '' end,
        case when i % 5 = 0 then (2 + c % 20)::text else '' end,
        case when i % 5 = 0 then zips[1 + (c + 2) % 8] else '' end,
        case when i % 5 = 0 then cities[1 + (c + 2) % 8] else '' end,
        'Deutschland',
        i % 7 = 0,
        case when i % 7 = 0 then 'Hausverwaltung Eifel GmbH' else '' end,
        case when i % 7 = 0 then 'Bahnhofstraße' else '' end,
        case when i % 7 = 0 then '10' else '' end,
        case when i % 7 = 0 then '54568' else '' end,
        case when i % 7 = 0 then 'Gerolstein' else '' end,
        'Deutschland'
      )
      returning id into v_id;

      insert into public.ticket_positions (ticket_id, sort, position_number, description)
      select v_id, k - 1, k::text, pos_texts[1 + (i + k * 3 + t) % 10]
        from generate_series(1, 2 + (i + t) % 3) k;

      -- Je Art zwei erledigte Einsätze in der Vergangenheit, einer davon mit einer nicht erledigten Position
      if i in (5, 6) and v_team is not null and v_day < current_date then
        update public.ticket_positions set state = 'erledigt' where ticket_id = v_id;
        if i = 6 then
          update public.ticket_positions
             set state = 'nicht_erledigt', reason = 'Ersatzteil muss bestellt werden'
           where ticket_id = v_id and sort = 0;
        end if;
        update public.tickets
           set work_report = case when i = 5 then 'Testbericht: Alle Positionen erledigt, Kunde zufrieden.'
                                  else 'Testbericht: Ersatzteil fehlt, Folgetermin nötig.' end,
               status = 'abgeschlossen'
         where id = v_id;
      end if;
    end loop;
  end loop;

  raise notice '% Testaufträge angelegt (Teams Montage: %, Kundendienst: %, Monteure: %)',
    n, cardinality(v_mteams), cardinality(v_kteams), cardinality(v_fitters);
end;
$$;

select ticket_type, count(*) as anzahl,
       count(*) filter (where status = 'neu') as ungeplant,
       count(*) filter (where status = 'zugewiesen') as geplant,
       count(*) filter (where status = 'abgeschlossen') as erledigt
from public.tickets group by ticket_type order by ticket_type;
