-- Fahrzeit (Fabian, 2026-10-24): kalkulierte Fahrzeit hin und zurück in Minuten, berechnet von der
-- Edge Function calc-distance zusammen mit der Fahrstrecke. Wie distance_km nur per Service-Key setzbar.

alter table public.tickets add column if not exists distance_minutes int;

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
     and (new.site_address, new.jobsite_address_different, new.jobsite_street, new.jobsite_house_no, new.jobsite_zip, new.jobsite_city, new.jobsite_country)
         is distinct from
         (old.site_address, old.jobsite_address_different, old.jobsite_street, old.jobsite_house_no, old.jobsite_zip, old.jobsite_city, old.jobsite_country) then
    new.distance_km := null;
    new.distance_minutes := null;
    new.distance_address := '';
    new.distance_error := '';
  end if;
  return new;
end;
$$;
