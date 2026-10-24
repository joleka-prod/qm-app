-- Disposition: plant Service-Aufträge wie ein Teamleiter (anlegen, bearbeiten, Teams, Termine, Kalender,
-- Zeiterfassung, Berechnung), meldet aber keine Einsätze als erledigt und ist kein Verantwortlicher
-- für QM-Tickets.
--
-- Statt jede Regel einzeln neu zu schreiben, werden alle aktuellen Funktionen und RLS-Regeln, die
-- Admin + Teamleiter als Planer prüfen, um 'disposition' ergänzt. Die Prüfung auf den Verantwortlichen
-- eines QM-Tickets (role in ('teamleiter', 'admin')) bleibt unverändert.

do $$
declare
  f record;
  p record;
  def text;
  q text;
  c text;
  stmt text;
begin
  -- Funktionen
  for f in
    select pr.oid
    from pg_proc pr
    join pg_namespace n on n.oid = pr.pronamespace
    where n.nspname = 'public'
      and pr.prokind = 'f'
      and pr.prosrc like '%''teamleiter''%'
      and pr.prosrc not like '%''disposition''%'
  loop
    def := pg_get_functiondef(f.oid);
    def := replace(def, '''admin'', ''teamleiter'')', '''admin'', ''teamleiter'', ''disposition'')');
    def := replace(def, 'v_role = ''teamleiter''', 'v_role in (''teamleiter'', ''disposition'')');
    def := replace(def, 'my_role() = ''teamleiter''', 'my_role() in (''teamleiter'', ''disposition'')');
    execute def;
  end loop;

  -- RLS-Regeln
  for p in
    select schemaname, tablename, policyname, qual, with_check
    from pg_policies
    where schemaname in ('public', 'storage')
      and (coalesce(qual, '') like '%teamleiter%' or coalesce(with_check, '') like '%teamleiter%')
      and coalesce(qual, '') || coalesce(with_check, '') not like '%disposition%'
  loop
    q := p.qual;
    c := p.with_check;
    -- ARRAY['admin'::user_role, 'teamleiter'::user_role] und  = 'teamleiter'::user_role
    q := regexp_replace(q, '''teamleiter''::([a-z_."]*user_role)\]', '''teamleiter''::\1, ''disposition''::\1]', 'g');
    q := regexp_replace(q, '= ''teamleiter''::([a-z_."]*user_role)', '= ANY (ARRAY[''teamleiter''::\1, ''disposition''::\1])', 'g');
    c := regexp_replace(c, '''teamleiter''::([a-z_."]*user_role)\]', '''teamleiter''::\1, ''disposition''::\1]', 'g');
    c := regexp_replace(c, '= ''teamleiter''::([a-z_."]*user_role)', '= ANY (ARRAY[''teamleiter''::\1, ''disposition''::\1])', 'g');
    -- Löschantrag: ARRAY['teamleiter'::user_role, 'admin'::user_role]
    q := regexp_replace(q, '\[''teamleiter''::([a-z_."]*user_role), ''admin''', '[''teamleiter''::\1, ''disposition''::\1, ''admin''', 'g');
    c := regexp_replace(c, '\[''teamleiter''::([a-z_."]*user_role), ''admin''', '[''teamleiter''::\1, ''disposition''::\1, ''admin''', 'g');
    if q is not distinct from p.qual and c is not distinct from p.with_check then
      continue;
    end if;
    stmt := format('alter policy %I on %I.%I', p.policyname, p.schemaname, p.tablename);
    if q is not null then stmt := stmt || format(' using (%s)', q); end if;
    if c is not null then stmt := stmt || format(' with check (%s)', c); end if;
    execute stmt;
  end loop;
end $$;
