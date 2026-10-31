-- Kernarbeitszeit je Mitarbeiter (Fabian, 2026-10-31): Beginn und Ende im Reiter "Zeiterfassung" der
-- Personalakte. Pflegen wie die übrigen Felder dort Admin und Personalabteilung (Policy "Personal ändert
-- Mitarbeiter"), Änderungen landen über employees_log im Verlauf. Vorerst nur Ablage, keine Berechnung.

alter table public.employees
  add column if not exists core_start time,
  add column if not exists core_end time;

alter table public.employees drop constraint if exists employees_core_time_check;
alter table public.employees
  add constraint employees_core_time_check check (core_start is null or core_end is null or core_end > core_start);
