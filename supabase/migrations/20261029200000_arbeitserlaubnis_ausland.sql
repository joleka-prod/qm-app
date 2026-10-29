-- Arbeitserlaubnis in Luxemburg, Belgien und Holland zum Anhaken
-- (Personal → Stammdaten → Arbeits- und Aufenthaltsgenehmigungen, Fabian 2026-10-29).
alter table public.employees
  add column if not exists work_permit_lu boolean not null default false,
  add column if not exists work_permit_be boolean not null default false,
  add column if not exists work_permit_nl boolean not null default false;
