-- Ninox-Import abgeschlossen (Fabian, 2026-10-27): Verknüpfungen zu Ninox-Datensätzen entfernen.
-- Die übernommenen Daten bleiben vollständig erhalten.
alter table public.employees drop column if exists ninox_id;
alter table public.employee_entries drop column if exists ninox_id;
