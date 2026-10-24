-- Kundenadresse in Feldern wie die Rechnungsadresse: Straße, Hausnummer, PLZ, Ort.
-- site_address (bisher Freitext) wird daraus zusammengesetzt, damit Bericht, Karte und
-- Fahrstrecke unverändert funktionieren. Vorhandene Adressen werden einmalig aufgeteilt.

alter table public.tickets
  add column customer_street text not null default '' check (length(customer_street) <= 150),
  add column customer_house_no text not null default '' check (length(customer_house_no) <= 20),
  add column customer_zip text not null default '' check (length(customer_zip) <= 10),
  add column customer_city text not null default '' check (length(customer_city) <= 100);

-- Einmalig: Freitext aufteilen ("Straße Nr" / "PLZ Ort", getrennt durch Zeilenumbruch oder Komma)
do $$
declare
  r record;
  part text;
  v_street text;
  v_no text;
  v_zip text;
  v_city text;
  m text[];
begin
  for r in select id, site_address from public.tickets where ticket_type <> 'qm' and trim(site_address) <> '' loop
    v_street := ''; v_no := ''; v_zip := ''; v_city := '';
    foreach part in array regexp_split_to_array(trim(r.site_address), '\s*(\n|,)\s*') loop
      continue when part = '';
      m := regexp_match(part, '^(?:D-)?(\d{4,5})\s+(.+)$');
      if m is not null and v_zip = '' then
        v_zip := m[1];
        v_city := m[2];
      elsif v_street = '' then
        m := regexp_match(part, '^(.*\D)\s+(\d+\s*[a-zA-Z]?(?:\s*-\s*\d+\s*[a-zA-Z]?)?)$');
        if m is not null then
          v_street := trim(m[1]);
          v_no := replace(m[2], ' ', '');
        else
          v_street := part;
        end if;
      else
        -- weitere Zeilen hinten an die Straße hängen, damit nichts verloren geht
        v_street := v_street || ', ' || part;
      end if;
    end loop;
    update public.tickets
    set customer_street = left(v_street, 150), customer_house_no = left(v_no, 20),
        customer_zip = left(v_zip, 10), customer_city = left(v_city, 100)
    where id = r.id;
  end loop;
end $$;

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
     and (new.customer_street, new.customer_house_no, new.customer_zip, new.customer_city)
         is distinct from (old.customer_street, old.customer_house_no, old.customer_zip, old.customer_city) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  new.customer_street := trim(new.customer_street);
  new.customer_house_no := trim(new.customer_house_no);
  new.customer_zip := trim(new.customer_zip);
  new.customer_city := trim(new.customer_city);
  -- Ohne Adressfelder (z. B. ältere App-Version) bleibt der Freitext stehen
  if new.customer_street || new.customer_house_no || new.customer_zip || new.customer_city = ''
     and (tg_op = 'INSERT' or old.customer_street || old.customer_house_no || old.customer_zip || old.customer_city = '') then
    return new;
  end if;
  new.site_address := trim(both E'\n' from
    trim(new.customer_street || ' ' || new.customer_house_no) || E'\n' || trim(new.customer_zip || ' ' || new.customer_city));
  return new;
end;
$$;

create trigger tickets_zz_customer_address
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_customer_address();
