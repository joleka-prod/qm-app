-- Bauvorhaben aus 3E (Fabian 2026-10-28): Die Projekte aus 3E (OPR_Projekt) kommen als Bauvorhaben in die App,
-- alle, auch abgeschlossene. 3E bleibt führend, Abgleich wie bei den Kunden über die Edge Function sync-3e.
-- Projekte haben in 3E nur eine Kundennummer: Das Bauvorhaben wird mit diesem 3E-Kunden verknüpft und
-- bekommt dessen Adresse. Bemerkung, weitere Beteiligte, Aufträge und Kommunikation bleiben in der App pflegbar.

alter table public.projects
  add column source text not null default 'app' check (source in ('app', '3e')),
  add column ext_id text,
  add column synced_at timestamptz,
  -- Kunde laut 3E (wird als Beteiligter eingetragen; Adresse des Bauvorhabens = Adresse dieses Kunden)
  add column ext_customer_id bigint references public.customers (id) on delete set null;

create unique index projects_ext_id_unique on public.projects (ext_id) where ext_id is not null;

-- Schreibschutz wie bei den Kunden: Benutzer der App dürfen Felder aus 3E nicht ändern,
-- der Abgleich läuft mit dem Service-Key (auth.uid() ist dann leer).
create function public.projects_3e_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    new.source := 'app';
    new.ext_id := null;
    new.synced_at := null;
    new.ext_customer_id := null;
    return new;
  end if;
  if new.source is distinct from old.source or new.ext_id is distinct from old.ext_id
     or new.synced_at is distinct from old.synced_at or new.ext_customer_id is distinct from old.ext_customer_id then
    raise exception 'Die Verknüpfung mit 3E kann nicht in der App geändert werden.';
  end if;
  if old.source = '3e' and (
    new.project_number is distinct from old.project_number or new.name is distinct from old.name
    or new.street is distinct from old.street or new.house_no is distinct from old.house_no
    or new.zip is distinct from old.zip or new.city is distinct from old.city
    or new.country is distinct from old.country or new.status is distinct from old.status
  ) then
    raise exception 'Bauvorhaben aus 3E können nur in 3E geändert werden (außer der Bemerkung).';
  end if;
  return new;
end;
$$;

-- läuft nach projects_guard (Trimmen), damit getrimmte Werte verglichen werden
create trigger projects_zz_3e_guard
  before insert or update on public.projects
  for each row execute function public.projects_3e_guard();

create function public.projects_3e_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = '3e' and auth.uid() is not null then
    raise exception 'Bauvorhaben aus 3E können nur in 3E gelöscht werden.';
  end if;
  return old;
end;
$$;

create trigger projects_3e_no_delete
  before delete on public.projects
  for each row execute function public.projects_3e_no_delete();

-- Abgleich: p_rows ist ein JSON-Array mit ext_id (Pflicht, ProjektID in 3E), project_number, name,
-- customer_ext_id (Kundennummer in 3E = customers.ext_id) und status (aktiv/abgeschlossen).
-- Zuordnung: 1. ext_id, 2. App-Bauvorhaben mit gleicher Nummer. Sonst neu anlegen.
-- Adresse kommt immer vom verknüpften Kunden. p_dry_run = true ändert nichts und liefert nur die Vorschau.
create function public.import_3e_projects(p_rows jsonb, p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_ext text;
  v_number text;
  v_name text;
  v_status text;
  v_cust_ext text;
  v_cust public.customers;
  v_cust_id bigint;
  v_id bigint;
  v_how text;
  v_old public.projects;
  v_new int := 0;
  v_linked int := 0;
  v_updated int := 0;
  v_same int := 0;
  v_skipped int := 0;
  v_no_customer int := 0;
  v_preview jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows muss ein JSON-Array sein';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_ext := nullif(trim(r ->> 'ext_id'), '');
    v_number := coalesce(trim(r ->> 'project_number'), '');
    v_name := left(coalesce(trim(r ->> 'name'), ''), 200);
    v_status := case when lower(trim(coalesce(r ->> 'status', ''))) = 'abgeschlossen' then 'abgeschlossen' else 'aktiv' end;
    v_cust_ext := nullif(trim(r ->> 'customer_ext_id'), '');

    if v_ext is null or v_name = '' then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('row', r, 'error', 'ext_id oder Bezeichnung fehlt');
      end if;
      continue;
    end if;

    v_cust := null;
    v_cust_id := null;
    if v_cust_ext is not null then
      select * into v_cust from public.customers where ext_id = v_cust_ext;
      v_cust_id := v_cust.id;
    end if;
    if v_cust_id is null then
      v_no_customer := v_no_customer + 1;
    end if;

    v_id := null;
    v_how := 'neu';
    select * into v_old from public.projects where ext_id = v_ext;
    if found then
      v_id := v_old.id;
      v_how := 'vorhanden';
    elsif v_number <> '' then
      select * into v_old from public.projects where project_number = v_number and source = 'app';
      if found then
        v_id := v_old.id;
        v_how := 'verknuepft_nummer';
      end if;
    end if;

    if v_how = 'vorhanden'
       and (v_number = '' or v_old.project_number = v_number) and v_old.name = v_name and v_old.status = v_status
       and v_old.ext_customer_id is not distinct from v_cust_id
       and (v_cust_id is null or (
         v_old.street = v_cust.street and v_old.house_no = v_cust.house_no and v_old.zip = v_cust.zip
         and v_old.city = v_cust.city and v_old.country = coalesce(nullif(v_cust.country, ''), 'Deutschland')
         and exists (select 1 from public.project_customers where project_id = v_id and customer_id = v_cust_id)))
    then
      v_same := v_same + 1;
      continue;
    end if;

    if v_how = 'neu' then v_new := v_new + 1;
    elsif v_how = 'vorhanden' then v_updated := v_updated + 1;
    else v_linked := v_linked + 1;
    end if;

    if v_how <> 'vorhanden' and jsonb_array_length(v_preview) < 2000 then
      v_preview := v_preview || jsonb_build_object(
        'aktion', v_how, 'ext_id', v_ext, 'nummer_3e', v_number, 'bezeichnung_3e', v_name, 'status', v_status,
        'kundennummer_3e', v_cust_ext, 'kunde', coalesce(v_cust.name, '(Kunde nicht in der App)'),
        'ort', coalesce(trim(v_cust.zip || ' ' || v_cust.city), ''),
        'app_bauvorhaben_id', v_id, 'app_name', v_old.name);
    end if;

    if p_dry_run then
      continue;
    end if;

    begin
      if v_id is null then
        insert into public.projects (source, ext_id, synced_at, ext_customer_id, project_number, name, status,
                                     street, house_no, zip, city, country, created_by)
        values ('3e', v_ext, now(), v_cust_id, v_number, v_name, v_status,
                coalesce(v_cust.street, ''), coalesce(v_cust.house_no, ''), coalesce(v_cust.zip, ''),
                coalesce(v_cust.city, ''), coalesce(v_cust.country, ''), null)
        returning id into v_id;
      else
        -- Kunde in 3E gewechselt: alten 3E-Kunden als Beteiligten entfernen (nur wenn keine Aufträge dieses Kunden dranhängen)
        if v_old.ext_customer_id is not null and v_old.ext_customer_id is distinct from v_cust_id then
          delete from public.project_customers pc
          where pc.project_id = v_id and pc.customer_id = v_old.ext_customer_id
            and not exists (select 1 from public.tickets t where t.project_id = v_id and t.customer_id = v_old.ext_customer_id);
        end if;
        update public.projects set
          source = '3e', ext_id = v_ext, synced_at = now(), ext_customer_id = v_cust_id,
          project_number = case when v_number = '' then project_number else v_number end,
          name = v_name, status = v_status,
          -- ohne Kunde in der App bleibt die bisherige Adresse
          street = coalesce(v_cust.street, street), house_no = coalesce(v_cust.house_no, house_no),
          zip = coalesce(v_cust.zip, zip), city = coalesce(v_cust.city, city), country = coalesce(v_cust.country, country)
        where id = v_id;
      end if;
      if v_cust_id is not null then
        insert into public.project_customers (project_id, customer_id, role)
        select v_id, v_cust_id, public.project_role_for(v_cust_id)
        where not exists (select 1 from public.project_customers where project_id = v_id and customer_id = v_cust_id);
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('ext_id', v_ext, 'nummer', v_number, 'name', v_name, 'error', sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'probelauf', p_dry_run, 'neu', v_new, 'verknuepft', v_linked, 'aktualisiert', v_updated,
    'unveraendert', v_same, 'uebersprungen', v_skipped, 'ohne_kunde', v_no_customer,
    'vorschau', v_preview, 'fehler', v_errors);
end;
$$;

revoke all on function public.import_3e_projects(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_3e_projects(jsonb, boolean) to service_role;

-- --- Suche für über 18.000 Bauvorhaben (wie search_customers): Rechte einmal prüfen, Trigramm-Index auf einem Suchtext ---
create function public.project_search_text(p public.projects)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(concat_ws(' ', p.project_number, p.name, p.street, p.house_no, p.zip, p.city))
$$;

create index projects_search_trgm_idx on public.projects
  using gin (public.project_search_text(projects) extensions.gin_trgm_ops);
create index projects_status_name_idx on public.projects (status, lower(name));

-- Liefert { rows: [...], total, counts: { aktiv: n, abgeschlossen: n } }. Gefunden wird auch über den Namen
-- oder die Nummer eines beteiligten Kunden. rows enthalten project_customers (Rolle, Kunde) und die Zahl der Aufträge.
create function public.search_projects(p_query text default '', p_status text default '', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_like text;
  v_project_ids bigint[];
  v_result jsonb;
begin
  if not public.can_use_crm() then
    raise exception 'Keine Berechtigung';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if length(v_q) >= 2 then
    select array_agg(distinct pc.project_id) into v_project_ids
      from public.customers c
      join public.project_customers pc on pc.customer_id = c.id
      where public.customer_search_text(c) like v_like;
  end if;

  with hits as (
    select p.*
    from public.projects p
    where v_q = '' or public.project_search_text(p) like v_like or p.id = any (coalesce(v_project_ids, '{}'))
  ),
  in_status as (
    select * from hits where coalesce(p_status, '') = '' or status = p_status
  ),
  page as (
    select * from in_status
    -- ohne Suche die neuesten zuerst, mit Suche alphabetisch
    order by case when v_q = '' then -id end, lower(name), id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  select jsonb_build_object(
    'total', (select count(*) from in_status),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from hits group by status) g), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'tickets', jsonb_build_array(jsonb_build_object('count', (select count(*) from public.tickets t where t.project_id = p.id))),
        'project_customers', coalesce((
          select jsonb_agg(jsonb_build_object('role', pc.role, 'customers', jsonb_build_object('name', c.name, 'customer_number', c.customer_number)) order by pc.id)
          from public.project_customers pc join public.customers c on c.id = pc.customer_id
          where pc.project_id = p.id), '[]'::jsonb)
      ) order by case when v_q = '' then -p.id end, lower(p.name), p.id)
      from page p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.search_projects(text, text, int) from public, anon;
grant execute on function public.search_projects(text, text, int) to authenticated;
