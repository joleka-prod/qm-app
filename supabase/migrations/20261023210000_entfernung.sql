-- Fahrstrecke bei Beanstandungen: km vom Hauptstandort zur Kundenadresse, Hin- und Rückweg.
-- Wird nur von der Edge Function calc-distance (Service-Schlüssel) gesetzt. Ändert sich die
-- Adresse, wird der alte Wert gelöscht und neu berechnet.

alter table public.tickets
  add column distance_km numeric(7,1),
  add column distance_address text not null default '',
  add column distance_error text not null default '';

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
  if tg_op = 'UPDATE' and new.site_address is distinct from old.site_address then
    new.distance_km := null;
    new.distance_address := '';
    new.distance_error := '';
  end if;
  return new;
end;
$$;

create trigger tickets_zz_distance
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_distance();
