-- Kundenabgleich aus 3E Look (Fabian 2026-10-28): 3E bleibt vorerst führend. Ein Sync-Programm auf dem 3E-Server
-- liest die Kunden (nur lesend) und schickt sie über die Edge Function sync-3e an import_3e_customers.
-- Kunden aus 3E (source = '3e') haben ihre Stammdaten schreibgeschützt; Kundengruppe, Bemerkung, Aktiv,
-- Ansprechpartner, Kommunikation und Bauvorhaben bleiben in der App pflegbar.

alter table public.customers
  add column source text not null default 'app' check (source in ('app', '3e')),
  add column ext_id text,
  add column synced_at timestamptz,
  -- Kundenherkunft (in 3E: Klassifikation 1), z. B. Empfehlung, Google Internetseite
  add column origin text not null default '';

create unique index customers_ext_id_unique on public.customers (ext_id) where ext_id is not null;

-- Schreibschutz: Benutzer der App (auth.uid() gesetzt) dürfen Felder aus 3E nicht ändern;
-- der Abgleich läuft mit dem Service-Key (auth.uid() ist dann leer).
create function public.customers_3e_guard()
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
    return new;
  end if;
  if new.source is distinct from old.source or new.ext_id is distinct from old.ext_id or new.synced_at is distinct from old.synced_at then
    raise exception 'Die Verknüpfung mit 3E kann nicht in der App geändert werden.';
  end if;
  if old.source = '3e' and (
    new.customer_number is distinct from old.customer_number or new.name is distinct from old.name
    or new.name2 is distinct from old.name2 or new.street is distinct from old.street
    or new.house_no is distinct from old.house_no or new.zip is distinct from old.zip
    or new.city is distinct from old.city or new.country is distinct from old.country
    or new.phone is distinct from old.phone or new.mobile is distinct from old.mobile
    or new.email is distinct from old.email or new.website is distinct from old.website
    or new.origin is distinct from old.origin
  ) then
    raise exception 'Stammdaten aus 3E können nur in 3E geändert werden.';
  end if;
  return new;
end;
$$;

-- läuft nach customers_guard (Trimmen), damit getrimmte Werte verglichen werden
create trigger customers_zz_3e_guard
  before insert or update on public.customers
  for each row execute function public.customers_3e_guard();

-- Kunden aus 3E lassen sich nicht löschen (kämen beim nächsten Abgleich wieder); stattdessen in 3E löschen.
create function public.customers_3e_no_delete()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.source = '3e' and auth.uid() is not null then
    raise exception 'Kunden aus 3E können nur in 3E gelöscht werden.';
  end if;
  return old;
end;
$$;

create trigger customers_3e_no_delete
  before delete on public.customers
  for each row execute function public.customers_3e_no_delete();

-- Abgleich: p_rows ist ein JSON-Array mit ext_id (Pflicht, eindeutiger Schlüssel in 3E), customer_number, name,
-- name2, street, house_no, zip, city, country, phone, mobile, email, website, origin, active, customer_group (optional).
-- Zuordnung: 1. ext_id, 2. gleiche Kundennummer bei einem App-Kunden, 3. gleicher Name + PLZ bei einem App-Kunden.
-- Sonst neu anlegen. p_dry_run = true ändert nichts und liefert nur die Vorschau.
create function public.import_3e_customers(p_rows jsonb, p_dry_run boolean default true)
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
  v_zip text;
  v_group text;
  v_active boolean;
  v_id bigint;
  v_how text;
  v_old public.customers;
  v_new int := 0;
  v_linked int := 0;
  v_updated int := 0;
  v_same int := 0;
  v_skipped int := 0;
  v_preview jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows muss ein JSON-Array sein';
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    v_ext := nullif(trim(r ->> 'ext_id'), '');
    v_number := coalesce(trim(r ->> 'customer_number'), '');
    v_name := coalesce(trim(r ->> 'name'), '');
    v_zip := coalesce(trim(r ->> 'zip'), '');
    v_active := coalesce(lower(trim(r ->> 'active')), '') not in ('false', '0', 'nein', 'n', 'f');
    v_group := nullif(trim(r ->> 'customer_group'), '');
    if v_group is not null and v_group not in ('privat', 'bautraeger', 'generalunternehmer', 'architekt', 'oeffentlich') then
      v_group := null;
    end if;

    if v_ext is null or v_name = '' then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('row', r, 'error', 'ext_id oder Name fehlt');
      end if;
      continue;
    end if;

    v_id := null;
    v_how := 'neu';
    select * into v_old from public.customers where ext_id = v_ext;
    if found then
      v_id := v_old.id;
      v_how := 'vorhanden';
    else
      if v_number <> '' then
        select * into v_old from public.customers where customer_number = v_number and source = 'app';
        if found then
          v_id := v_old.id;
          v_how := 'verknuepft_nummer';
        end if;
      end if;
      if v_id is null then
        select * into v_old from public.customers
          where source = 'app' and lower(name) = lower(v_name) and zip = v_zip
          order by id limit 1;
        if found then
          v_id := v_old.id;
          v_how := 'verknuepft_name';
        end if;
      end if;
    end if;

    if v_how = 'vorhanden' and
       (v_number = '' or v_old.customer_number = v_number) and v_old.name = v_name
       and v_old.name2 = coalesce(trim(r ->> 'name2'), '') and v_old.street = coalesce(trim(r ->> 'street'), '')
       and v_old.house_no = coalesce(trim(r ->> 'house_no'), '') and v_old.zip = v_zip
       and v_old.city = coalesce(trim(r ->> 'city'), '')
       and v_old.country = coalesce(nullif(trim(r ->> 'country'), ''), 'Deutschland')
       and v_old.phone = coalesce(trim(r ->> 'phone'), '') and v_old.mobile = coalesce(trim(r ->> 'mobile'), '')
       and v_old.email = coalesce(trim(r ->> 'email'), '') and v_old.website = coalesce(trim(r ->> 'website'), '')
       and v_old.origin = coalesce(trim(r ->> 'origin'), '')
       and v_old.active = v_active
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
        'aktion', v_how, 'ext_id', v_ext, 'kundennummer_3e', v_number, 'name_3e', v_name, 'plz', v_zip,
        'app_kunde_id', v_id, 'app_kundennummer', v_old.customer_number, 'app_name', v_old.name);
    end if;

    if p_dry_run then
      continue;
    end if;

    begin
      if v_id is null then
        insert into public.customers (source, ext_id, synced_at, customer_number, customer_group, name, name2, street, house_no,
                                      zip, city, country, phone, mobile, email, website, origin, active, created_by)
        values ('3e', v_ext, now(), v_number, coalesce(v_group, 'privat'), v_name, coalesce(trim(r ->> 'name2'), ''),
                coalesce(trim(r ->> 'street'), ''), coalesce(trim(r ->> 'house_no'), ''), v_zip,
                coalesce(trim(r ->> 'city'), ''), coalesce(trim(r ->> 'country'), ''), coalesce(trim(r ->> 'phone'), ''),
                coalesce(trim(r ->> 'mobile'), ''), coalesce(trim(r ->> 'email'), ''), coalesce(trim(r ->> 'website'), ''),
                coalesce(trim(r ->> 'origin'), ''), v_active, null);
      else
        update public.customers set
          source = '3e', ext_id = v_ext, synced_at = now(),
          -- ohne Nummer aus 3E bleibt die vorhandene (bzw. automatisch vergebene K-Nummer)
          customer_number = case when v_number = '' then customer_number else v_number end, name = v_name, name2 = coalesce(trim(r ->> 'name2'), ''),
          street = coalesce(trim(r ->> 'street'), ''), house_no = coalesce(trim(r ->> 'house_no'), ''), zip = v_zip,
          city = coalesce(trim(r ->> 'city'), ''), country = coalesce(trim(r ->> 'country'), ''),
          phone = coalesce(trim(r ->> 'phone'), ''), mobile = coalesce(trim(r ->> 'mobile'), ''),
          email = coalesce(trim(r ->> 'email'), ''), website = coalesce(trim(r ->> 'website'), ''),
          origin = coalesce(trim(r ->> 'origin'), ''),
          active = v_active,
          -- Kundengruppe nur beim ersten Verknüpfen aus 3E übernehmen, danach pflegt sie die App
          customer_group = case when v_how <> 'vorhanden' and v_group is not null then v_group else customer_group end
        where id = v_id;
      end if;
    exception when others then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('ext_id', v_ext, 'name', v_name, 'error', sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'probelauf', p_dry_run, 'neu', v_new, 'verknuepft', v_linked, 'aktualisiert', v_updated,
    'unveraendert', v_same, 'uebersprungen', v_skipped, 'vorschau', v_preview, 'fehler', v_errors);
end;
$$;

revoke all on function public.import_3e_customers(jsonb, boolean) from public, anon, authenticated;
grant execute on function public.import_3e_customers(jsonb, boolean) to service_role;

-- Zuordnung über Name + PLZ beim ersten Abgleich (über 20.000 Kunden)
create index customers_name_zip_idx on public.customers (lower(name), zip);
