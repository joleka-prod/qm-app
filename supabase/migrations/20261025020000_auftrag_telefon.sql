-- Telefon und Mobil des Kunden am Auftrag (Fabian 2026-10-25), aus dem Kundenstamm übernommen.
alter table public.tickets
  add column customer_phone text not null default '' check (length(customer_phone) <= 50),
  add column customer_mobile text not null default '' check (length(customer_mobile) <= 50);

-- Bestehende verknüpfte Aufträge aus dem Kundenstamm füllen
update public.tickets t
set customer_phone = left(c.phone, 50), customer_mobile = left(c.mobile, 50)
from public.customers c
where t.customer_id = c.id;

-- Monteure ändern auch Telefon/Mobil nicht; Folgeaufträge übernehmen Kunde und Telefonnummern
create or replace function public.tickets_zz_customer_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.customer_phone := trim(new.customer_phone);
  new.customer_mobile := trim(new.customer_mobile);
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and (new.customer_id, new.customer_phone, new.customer_mobile)
         is distinct from (old.customer_id, old.customer_phone, old.customer_mobile) then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  if tg_op = 'INSERT' and new.parent_id is not null then
    select coalesce(new.customer_id, p.customer_id),
           coalesce(nullif(new.customer_phone, ''), p.customer_phone),
           coalesce(nullif(new.customer_mobile, ''), p.customer_mobile)
      into new.customer_id, new.customer_phone, new.customer_mobile
      from public.tickets p where p.id = new.parent_id;
  end if;
  if new.ticket_type = 'qm' then
    new.customer_id := null;
  end if;
  return new;
end;
$$;
