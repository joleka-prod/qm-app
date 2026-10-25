-- Neue Kundengruppe "Generalunternehmer" (Fabian 2026-10-25), getrennt von Bauträger.
alter table public.customers drop constraint if exists customers_customer_group_check;
alter table public.customers add constraint customers_customer_group_check
  check (customer_group in ('privat', 'bautraeger', 'generalunternehmer', 'architekt', 'oeffentlich'));
