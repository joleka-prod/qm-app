-- Kernarbeitszeit Standard 07:00 bis 15:45 für alle Mitarbeiter (Fabian, 2026-10-31): bestehende ohne Angabe
-- befüllen und als Vorgabe für neu angelegte. Einzelne Mitarbeiter bleiben in der Personalakte änderbar.

alter table public.employees
  alter column core_start set default '07:00',
  alter column core_end set default '15:45';

update public.employees
   set core_start = coalesce(core_start, '07:00'), core_end = coalesce(core_end, '15:45')
 where core_start is null or core_end is null;
