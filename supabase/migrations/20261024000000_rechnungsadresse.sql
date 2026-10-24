-- Kundennummer und abweichende Rechnungsadresse bei Service-Aufträgen (Haken + Name, Straße, Hausnummer, PLZ, Ort).
-- Ohne Haken werden die Felder geleert; mit Haken sind Name, Straße, PLZ und Ort Pflicht.

alter table public.tickets
  add column customer_number text not null default '' check (length(customer_number) <= 30),
  add column billing_address_different boolean not null default false,
  add column billing_name text not null default '' check (length(billing_name) <= 150),
  add column billing_street text not null default '' check (length(billing_street) <= 150),
  add column billing_house_no text not null default '' check (length(billing_house_no) <= 20),
  add column billing_zip text not null default '' check (length(billing_zip) <= 10),
  add column billing_city text not null default '' check (length(billing_city) <= 100);

create or replace function public.tickets_zz_billing_address()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.customer_number := trim(new.customer_number);
  -- Monteure ändern Kundennummer und Rechnungsadresse nicht
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and (new.customer_number, new.billing_address_different, new.billing_name, new.billing_street, new.billing_house_no, new.billing_zip, new.billing_city)
         is distinct from
         (old.customer_number, old.billing_address_different, old.billing_name, old.billing_street, old.billing_house_no, old.billing_zip, old.billing_city) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  if new.ticket_type = 'qm' then
    new.customer_number := '';
  end if;
  if new.ticket_type = 'qm' or not new.billing_address_different then
    new.billing_address_different := false;
    new.billing_name := '';
    new.billing_street := '';
    new.billing_house_no := '';
    new.billing_zip := '';
    new.billing_city := '';
    return new;
  end if;
  new.billing_name := trim(new.billing_name);
  new.billing_street := trim(new.billing_street);
  new.billing_house_no := trim(new.billing_house_no);
  new.billing_zip := trim(new.billing_zip);
  new.billing_city := trim(new.billing_city);
  if new.billing_name = '' or new.billing_street = '' or new.billing_zip = '' or new.billing_city = '' then
    raise exception 'Bitte bei der Rechnungsadresse Name, Straße, PLZ und Ort angeben';
  end if;
  return new;
end;
$$;

create trigger tickets_zz_billing_address
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_billing_address();
