-- Abweichende Baustellenadresse bei Service-Aufträgen (Haken + Name, Straße, Hausnummer, PLZ, Ort).
-- Ist sie gesetzt, gilt sie als Einsatzort: Fahrstrecke, Karte und Servicebericht nutzen sie.

alter table public.tickets
  add column jobsite_address_different boolean not null default false,
  add column jobsite_name text not null default '' check (length(jobsite_name) <= 150),
  add column jobsite_street text not null default '' check (length(jobsite_street) <= 150),
  add column jobsite_house_no text not null default '' check (length(jobsite_house_no) <= 20),
  add column jobsite_zip text not null default '' check (length(jobsite_zip) <= 10),
  add column jobsite_city text not null default '' check (length(jobsite_city) <= 100);

create or replace function public.tickets_zz_jobsite_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  -- Monteure ändern die Baustellenadresse nicht
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and (new.jobsite_address_different, new.jobsite_name, new.jobsite_street, new.jobsite_house_no, new.jobsite_zip, new.jobsite_city)
         is distinct from
         (old.jobsite_address_different, old.jobsite_name, old.jobsite_street, old.jobsite_house_no, old.jobsite_zip, old.jobsite_city) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  if new.ticket_type = 'qm' or not new.jobsite_address_different then
    new.jobsite_address_different := false;
    new.jobsite_name := '';
    new.jobsite_street := '';
    new.jobsite_house_no := '';
    new.jobsite_zip := '';
    new.jobsite_city := '';
    return new;
  end if;
  new.jobsite_name := trim(new.jobsite_name);
  new.jobsite_street := trim(new.jobsite_street);
  new.jobsite_house_no := trim(new.jobsite_house_no);
  new.jobsite_zip := trim(new.jobsite_zip);
  new.jobsite_city := trim(new.jobsite_city);
  if new.jobsite_street = '' or new.jobsite_zip = '' or new.jobsite_city = '' then
    raise exception 'Bitte bei der Baustellenadresse Straße, PLZ und Ort angeben';
  end if;
  return new;
end;
$$;

create trigger tickets_zz_jobsite_address
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_jobsite_address();

-- Fahrstrecke auch neu berechnen, wenn sich die Baustellenadresse ändert
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
     and (new.site_address, new.jobsite_address_different, new.jobsite_street, new.jobsite_house_no, new.jobsite_zip, new.jobsite_city)
         is distinct from
         (old.site_address, old.jobsite_address_different, old.jobsite_street, old.jobsite_house_no, old.jobsite_zip, old.jobsite_city) then
    new.distance_km := null;
    new.distance_address := '';
    new.distance_error := '';
  end if;
  return new;
end;
$$;
