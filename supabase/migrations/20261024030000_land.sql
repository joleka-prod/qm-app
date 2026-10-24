-- Land zu Kunden-, Baustellen- und Rechnungsadresse (Standard Deutschland).
-- Ein anderes Land wird an die zusammengesetzte Kundenadresse (site_address) angehängt.

alter table public.tickets
  add column customer_country text not null default 'Deutschland' check (length(customer_country) <= 60),
  add column jobsite_country text not null default 'Deutschland' check (length(jobsite_country) <= 60),
  add column billing_country text not null default 'Deutschland' check (length(billing_country) <= 60);

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
  new.jobsite_country := coalesce(nullif(trim(new.jobsite_country), ''), 'Deutschland');
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

-- Monteure dürfen auch das Land der Baustelle bzw. Rechnung nicht ändern
create or replace function public.tickets_zz_country_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and (new.jobsite_country, new.billing_country) is distinct from (old.jobsite_country, old.billing_country) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  return new;
end;
$$;

create trigger tickets_zz_country_guard
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_country_guard();

-- Fahrstrecke auch neu berechnen, wenn sich das Land der Baustelle ändert
create or replace function public.tickets_zz_distance()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is not null then
    if tg_op = 'INSERT' then
      new.distance_km := null;
      new.distance_address := '';
      new.distance_error := '';
    else
      new.distance_km := old.distance_km;
      new.distance_address := old.distance_address;
      new.distance_error := old.distance_error;
    end if;
  end if;
  if tg_op = 'UPDATE'
     and (new.site_address, new.jobsite_address_different, new.jobsite_street, new.jobsite_house_no, new.jobsite_zip, new.jobsite_city, new.jobsite_country)
         is distinct from
         (old.site_address, old.jobsite_address_different, old.jobsite_street, old.jobsite_house_no, old.jobsite_zip, old.jobsite_city, old.jobsite_country) then
    new.distance_km := null;
    new.distance_address := '';
    new.distance_error := '';
  end if;
  return new;
end;
$$;
