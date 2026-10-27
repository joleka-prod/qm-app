-- Abweichende Baustellenadresse komplett entfernen (Fabian, 2026-10-27): Der Einsatzort ist immer das
-- Bauvorhaben. Die Spalten jobsite_* werden mitsamt Inhalt gelöscht; Funktionen, die sie noch lesen,
-- werden ohne sie neu angelegt.

drop trigger if exists tickets_zz_jobsite_address on public.tickets;
drop function if exists public.tickets_zz_jobsite_address();

create or replace function public.tickets_zz_customer_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticket_type = 'qm' then
    return new;
  end if;
  -- Monteure ändern die Kundenadresse nicht
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and (new.customer_street, new.customer_house_no, new.customer_zip, new.customer_city, new.customer_country)
         is distinct from (old.customer_street, old.customer_house_no, old.customer_zip, old.customer_city, old.customer_country) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  new.customer_street := trim(new.customer_street);
  new.customer_house_no := trim(new.customer_house_no);
  new.customer_zip := trim(new.customer_zip);
  new.customer_city := trim(new.customer_city);
  new.customer_country := coalesce(nullif(trim(new.customer_country), ''), 'Deutschland');
  new.billing_country := coalesce(nullif(trim(new.billing_country), ''), 'Deutschland');
  -- Ohne Adressfelder (z. B. ältere App-Version) bleibt der Freitext stehen
  if new.customer_street || new.customer_house_no || new.customer_zip || new.customer_city = ''
     and (tg_op = 'INSERT' or old.customer_street || old.customer_house_no || old.customer_zip || old.customer_city = '') then
    return new;
  end if;
  new.site_address := trim(both E'\n' from
    trim(new.customer_street || ' ' || new.customer_house_no) || E'\n' || trim(new.customer_zip || ' ' || new.customer_city)
    || case when new.customer_country = 'Deutschland' then '' else E'\n' || new.customer_country end);
  return new;
end;
$$;

-- Monteure dürfen das Land der Rechnungsadresse nicht ändern
create or replace function public.tickets_zz_country_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and new.billing_country is distinct from old.billing_country then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  return new;
end;
$$;

-- Fahrstrecke neu berechnen, wenn sich Kundenadresse oder Bauvorhaben ändern
create or replace function public.tickets_zz_distance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.distance_km := null;
      new.distance_minutes := null;
      new.distance_address := '';
      new.distance_error := '';
    else
      new.distance_km := old.distance_km;
      new.distance_minutes := old.distance_minutes;
      new.distance_address := old.distance_address;
      new.distance_error := old.distance_error;
    end if;
  end if;
  if tg_op = 'UPDATE'
     and (new.site_address, new.project_id) is distinct from (old.site_address, old.project_id) then
    new.distance_km := null;
    new.distance_minutes := null;
    new.distance_address := '';
    new.distance_error := '';
  end if;
  return new;
end;
$$;

create or replace function public.create_followup(p_ticket_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.tickets;
  v_id bigint;
  v_pos int;
begin
  if coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter', 'disposition') then
    raise exception 'Folgeaufträge erstellt die Disposition';
  end if;
  select * into v_src from public.tickets where id = p_ticket_id;
  if not found or v_src.ticket_type = 'qm' then
    raise exception 'Auftrag nicht gefunden';
  end if;

  perform set_config('app.followup', '1', true);
  insert into public.tickets (
    ticket_type, service_area, title, description, order_number, parent_id,
    customer_number, customer_name, customer_street, customer_house_no, customer_zip, customer_city,
    customer_country, customer_email, site_address,
    billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city, billing_country
  ) values (
    v_src.ticket_type, v_src.service_area, v_src.title, v_src.description, v_src.order_number, v_src.id,
    v_src.customer_number, v_src.customer_name, v_src.customer_street, v_src.customer_house_no, v_src.customer_zip,
    v_src.customer_city, v_src.customer_country, v_src.customer_email, v_src.site_address,
    v_src.billing_address_different, v_src.billing_name, v_src.billing_street, v_src.billing_house_no,
    v_src.billing_zip, v_src.billing_city, v_src.billing_country
  ) returning id into v_id;
  perform set_config('app.followup', '', true);

  insert into public.ticket_positions (ticket_id, sort, position_number, description, quantity, unit, article_id)
  select v_id, row_number() over (order by p.sort, p.id) - 1, (row_number() over (order by p.sort, p.id))::text,
         p.description, p.quantity, p.unit, p.article_id
  from public.ticket_positions p
  where p.ticket_id = v_src.id and p.state <> 'erledigt';
  get diagnostics v_pos = row_count;

  insert into public.ticket_events (ticket_id, actor, kind, details) values
    (v_src.id, auth.uid(), 'folgeauftrag', v_id::text),
    (v_id, auth.uid(), 'aus_auftrag', v_src.id::text || ':' || v_pos);
  return v_id;
end;
$$;

-- Bauvorhaben für einen Auftrag finden oder anlegen: an der Kundenadresse;
-- vorhandenes Bauvorhaben desselben Kunden an derselben Adresse wird wiederverwendet
create or replace function public.project_for_ticket(t public.tickets)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_street text := t.customer_street;
  v_no text := t.customer_house_no;
  v_zip text := t.customer_zip;
  v_city text := t.customer_city;
  v_country text := t.customer_country;
  v_name text;
  v_id bigint;
begin
  if t.customer_id is not null and trim(v_street || v_zip || v_city) <> '' then
    select p.id into v_id
    from public.projects p
    join public.project_customers pc on pc.project_id = p.id and pc.customer_id = t.customer_id
    where lower(trim(p.street)) = lower(trim(v_street)) and lower(trim(p.house_no)) = lower(trim(v_no))
      and trim(p.zip) = trim(v_zip) and p.status = 'aktiv'
    order by p.id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_name := coalesce(nullif(trim(t.customer_name), ''), trim(t.title));
  if trim(v_city) <> '' then
    v_name := v_name || ', ' || trim(v_city);
  end if;
  insert into public.projects (name, street, house_no, zip, city, country, created_by)
  values (left(coalesce(nullif(v_name, ''), 'Bauvorhaben'), 200), trim(v_street), trim(v_no), trim(v_zip), trim(v_city),
          coalesce(nullif(trim(v_country), ''), 'Deutschland'), coalesce(auth.uid(), t.created_by))
  returning id into v_id;
  return v_id;
end;
$$;

alter table public.tickets
  drop column jobsite_address_different,
  drop column jobsite_name,
  drop column jobsite_street,
  drop column jobsite_house_no,
  drop column jobsite_zip,
  drop column jobsite_city,
  drop column jobsite_country;
