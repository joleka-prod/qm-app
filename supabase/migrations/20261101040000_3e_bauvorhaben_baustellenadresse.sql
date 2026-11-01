-- Bauvorhaben aus 3E: Adresse = Baustellenadresse aus den Belegen des Projekts (OBE_Adresse Typ 3), sonst wie bisher
-- die Kundenadresse (Fabian, 2026-11-01). projekte.sql liefert dazu site_street, site_zip, site_city, site_country.

create or replace function public.import_3e_projects(p_rows jsonb, p_dry_run boolean default true)
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
  v_site_street text;
  v_site_house text;
  v_site_zip text;
  v_site_city text;
  v_site_country text;
  v_has_addr boolean;
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

    -- Baustellenadresse aus den Belegen (site_*), sonst Adresse des Kunden. Überschreibt nur die Adressfelder in v_cust.
    v_site_street := trim(coalesce(r ->> 'site_street', ''));
    v_site_zip := left(trim(coalesce(r ->> 'site_zip', '')), 20);
    v_site_city := left(trim(coalesce(r ->> 'site_city', '')), 100);
    v_site_country := left(trim(coalesce(r ->> 'site_country', '')), 100);
    if v_site_street <> '' and v_site_city <> '' then
      v_site_house := '';
      if v_site_street ~ '^(.*\D)\s+(\d+\s*[a-zA-Z]?(\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$' then
        v_site_house := trim(substring(v_site_street from '^.*\D\s+(\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?)$'));
        v_site_street := trim(substring(v_site_street from '^(.*\D)\s+\d+\s*[a-zA-Z]?(?:\s*[-/]\s*\d+\s*[a-zA-Z]?)?$'));
      end if;
      v_cust.street := left(v_site_street, 200);
      v_cust.house_no := left(v_site_house, 30);
      v_cust.zip := v_site_zip;
      v_cust.city := v_site_city;
      v_cust.country := coalesce(nullif(v_site_country, ''), 'Deutschland');
    end if;
    v_has_addr := v_cust.city is not null;

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
       and (not v_has_addr or (
         v_old.street = v_cust.street and v_old.house_no = v_cust.house_no and v_old.zip = v_cust.zip
         and v_old.city = v_cust.city and v_old.country = coalesce(nullif(v_cust.country, ''), 'Deutschland')))
       and (v_cust_id is null or exists (select 1 from public.project_customers where project_id = v_id and customer_id = v_cust_id))
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

