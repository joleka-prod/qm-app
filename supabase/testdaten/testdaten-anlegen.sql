-- JOLEKA Service Dashboard: Testdaten
-- Legt je 10 QM-Tickets, Restarbeiten, Beanstandungen und Reparaturaufträge an.
-- Alle Testaufträge beginnen mit "[TEST]" und lassen sich mit testdaten-loeschen.sql wieder entfernen.
-- Voraussetzung: Mindestens ein Admin existiert. Einsätze werden auf die Teams verteilt; vorhandene Monteure
-- werden an den Einsatztagen in diese Teams eingeteilt (höchstens 2 pro Team, jeder Monteur nur in einem Team pro Tag).

do $$
declare
  v_admin uuid;
  v_leads uuid[];
  v_fitters uuid[];
  v_mteams smallint[];
  v_kteams smallint[];
  v_area public.service_area;
  r record;
  v_id bigint;
  v_type public.ticket_type;
  v_day date;
  i int;
  d int;
  t int;
  n int := 0;
  types public.ticket_type[] := array['qm', 'restarbeit', 'beanstandung', 'reparatur']::public.ticket_type[];
  customers text[] := array['Familie Schneider', 'Bäckerei Huber', 'Autohaus Maier GmbH', 'Familie Yilmaz', 'Praxis Dr. Wagner',
                            'Familie Becker', 'Hotel Sonne', 'Familie Hoffmann', 'Kita Regenbogen', 'Familie Schulz'];
  streets text[] := array['Lindenweg 12', 'Marktplatz 3', 'Industriestr. 45', 'Rosenstr. 7', 'Bahnhofstr. 21',
                          'Am Hang 5', 'Seestr. 88', 'Gartenweg 2', 'Schulstr. 14', 'Birkenallee 9'];
  places text[] := array['88400 Biberach', '88471 Laupheim', '89584 Ehingen', '88416 Ochsenhausen', '88427 Bad Schussenried'];
  qm_titles text[] := array['Kratzer am Fensterrahmen bei Anlieferung', 'Falsche Glasstärke geliefert', 'Beschlag fehlt bei Auslieferung',
                            'Maßabweichung Haustür 5 mm', 'Farbabweichung RAL 7016', 'Dichtung nicht vollständig eingezogen',
                            'Silikonfuge unsauber', 'Etikett auf Glas nicht entfernt', 'Verpackung beschädigt, Rahmen verkratzt',
                            'Griffolive falsch montiert'];
  job_titles text[] := array['Fenster schließt schwer', 'Haustür zieht', 'Rollladen klemmt', 'Insektenschutz fehlt',
                             'Glasbruch Terrassentür', 'Undichtigkeit am Wintergarten', 'Griff locker', 'Abschlussleisten fehlen',
                             'Fensterbank innen beschädigt', 'Kondensat zwischen den Scheiben'];
  pos_texts text[] := array['Flügel einstellen', 'Dichtung tauschen', 'Griff ersetzen', 'Silikonfuge erneuern',
                            'Rollladenpanzer prüfen und gangbar machen', 'Abdeckkappen montieren', 'Glas tauschen' || chr(10) || 'Maße vor Ort prüfen',
                            'Anschlussfuge außen nacharbeiten', 'Fensterbank austauschen', 'Funktionsprüfung mit Kunde'];
begin
  select id into v_admin from public.profiles where role = 'admin' and active order by created_at limit 1;
  if v_admin is null then
    raise exception 'Kein aktiver Admin gefunden';
  end if;
  select coalesce(array_agg(id order by created_at), '{}') into v_leads
    from public.profiles where role = 'teamleiter' and active;
  select array_agg(id order by sort) into v_mteams from public.teams where area = 'montage' and active;
  select array_agg(id order by sort) into v_kteams from public.teams where area = 'kundendienst' and active;
  select coalesce(array_agg(id order by created_at), '{}') into v_fitters
    from public.profiles where role::text = 'monteur' and active;

  foreach v_type in array types loop
    t := array_position(types, v_type);
    for i in 1..10 loop
      n := n + 1;
      if v_type = 'qm' then
        insert into public.tickets (ticket_type, title, description, order_number, position_number, created_by, assigned_to)
        values (
          'qm',
          '[TEST] ' || qm_titles[i],
          'Testauftrag: Mangel bei Wareneingang bzw. Montage festgestellt.',
          'A-2026-' || lpad((4000 + n)::text, 5, '0'),
          (i * 10)::text,
          v_admin,
          case when i > 4 and cardinality(v_leads) > 0 then v_leads[1 + i % cardinality(v_leads)] end
        )
        returning id into v_id;
        -- Ein paar Tickets mit Ursache und Maßnahme, eins abgeschlossen
        if i >= 8 and cardinality(v_leads) > 0 then
          update public.tickets
             set cause = 'Testursache: Arbeitsanweisung wurde nicht eingehalten.',
                 corrective_action = case when i = 10 then 'Testmaßnahme: Mitarbeiter geschult, Prüfschritt ergänzt.' else '' end,
                 status = case when i = 10 then 'abgeschlossen'::public.ticket_status else 'in_bearbeitung'::public.ticket_status end
           where id = v_id;
        end if;
      else
        -- Werktage ab heute verteilen (Mo–Fr)
        v_day := current_date;
        while extract(isodow from v_day) > 5 loop
          v_day := v_day + 1;
        end loop;
        for d in 1..abs((i - 5) + (t - 2)) loop
          v_day := v_day + sign((i - 5) + (t - 2))::int;
          while extract(isodow from v_day) > 5 loop
            v_day := v_day + sign((i - 5) + (t - 2))::int;
          end loop;
        end loop;
        v_area := case when v_type = 'restarbeit' or i % 3 = 0 then 'montage'::public.service_area else 'kundendienst'::public.service_area end;
        insert into public.tickets (ticket_type, service_area, title, description, order_number, customer_name, site_address,
                                    created_by, team_id, montage_date, montage_time)
        values (
          v_type,
          v_area,
          '[TEST] ' || job_titles[1 + (i + t) % 10],
          'Testauftrag für ' || customers[i] || '.',
          'A-2026-' || lpad((4000 + n)::text, 5, '0'),
          customers[i],
          streets[1 + (i + t) % 10] || chr(10) || places[1 + i % 5],
          v_admin,
          case when i > 3 then (case when v_area = 'montage' then v_mteams[1 + (i + t) % cardinality(v_mteams)]
                                     else v_kteams[1 + (i + t) % cardinality(v_kteams)] end) end,
          case when i > 3 then v_day end,
          case when i > 3 then (time '07:30' + ((i % 4) * interval '2 hours')) end
        )
        returning id into v_id;

        insert into public.ticket_positions (ticket_id, sort, position_number, description)
        select v_id, k - 1, (k * 10)::text, pos_texts[1 + (i + k * 3 + t) % 10]
          from generate_series(1, 2 + (i + t) % 3) k;

        -- Ein Einsatz pro Art ist bereits erledigt
        if i = 4 then
          update public.ticket_positions set state = 'erledigt' where ticket_id = v_id;
          update public.tickets
             set work_report = 'Testbericht: Alle Positionen erledigt, Kunde zufrieden.',
                 status = 'abgeschlossen'
           where id = v_id;
        end if;
      end if;
    end loop;
  end loop;

  -- Monteure an den Einsatztagen in die Teams einteilen
  for r in
    select distinct t.team_id, t.montage_date from public.tickets t
    where t.title like '[TEST]%' and t.team_id is not null
    order by t.montage_date, t.team_id
  loop
    insert into public.team_members (team_id, day, installer_id)
    select r.team_id, r.montage_date, f.id
      from unnest(v_fitters) as f(id)
     where not exists (select 1 from public.team_members m where m.day = r.montage_date and m.installer_id = f.id)
       and (select count(*) from public.team_members m where m.team_id = r.team_id and m.day = r.montage_date) = 0
     limit 2;
  end loop;

  raise notice '% Testaufträge angelegt (Teamleiter: %, Monteure: %)', n, cardinality(v_leads), cardinality(v_fitters);
end;
$$;
