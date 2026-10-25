-- Kundengruppe "Großprojekt" entfällt (Fabian 2026-10-25); vorhandene Kunden werden Privatkunden.
update public.customers set customer_group = 'privat' where customer_group = 'grossprojekt';

alter table public.customers drop constraint if exists customers_customer_group_check;
alter table public.customers add constraint customers_customer_group_check
  check (customer_group in ('privat', 'bautraeger', 'architekt', 'oeffentlich'));
