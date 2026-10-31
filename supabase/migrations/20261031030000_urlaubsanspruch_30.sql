-- Urlaubsanspruch für alle Mitarbeiter auf 30 Tage (Fabian, 2026-10-31), auch als Vorgabe für neue.
-- Externe Dienstleister bleiben außen vor. Der Trigger employees_sync_user überträgt den Wert in den
-- App-Benutzer (profiles.vacation_days, Grundlage der Urlaubsanträge).

alter table public.employees alter column vacation_days set default 30;

update public.employees
   set vacation_days = 30
 where employee_type is distinct from 'extern'
   and vacation_days is distinct from 30;
