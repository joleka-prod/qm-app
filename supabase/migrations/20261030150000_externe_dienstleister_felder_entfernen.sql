-- Externe Dienstleister sind durch externe Mitarbeiter ersetzt (Fabian, 2026-10-30). Die alten
-- Dienstleister-Felder werden nicht mehr angezeigt und auf Fabians Wunsch endgültig gelöscht.
-- Firma (company) bleibt, sie gehört zur Akte der externen Mitarbeiter.

alter table public.employees
  drop column if exists trade,
  drop column if exists phone,
  drop column if exists mobile,
  drop column if exists email,
  drop column if exists vat_id,
  drop column if exists tax_number,
  drop column if exists note;
