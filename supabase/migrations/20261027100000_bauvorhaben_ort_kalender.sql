-- Kalender zeigt den Ort des Bauvorhabens (Fabian, 2026-10-27). Monteure dürfen Bauvorhaben bisher nicht
-- sehen (nur CRM-Rollen). Jetzt sieht jeder die Bauvorhaben der Aufträge, die er selbst sehen darf.
create policy "Bauvorhaben eigener Aufträge sehen" on public.projects for select to authenticated
  using (exists (select 1 from public.tickets t where t.project_id = projects.id));
