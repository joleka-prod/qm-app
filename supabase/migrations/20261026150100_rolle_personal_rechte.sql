-- Rolle "Personalabteilung": sieht und pflegt alle Personalakten wie der Admin (ohne Haken hr_access).
-- Sonst Rechte wie Mitarbeiter; App-Benutzer verwaltet weiter nur der Admin.
create or replace function public.has_hr_access()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid() and active and (role in ('admin', 'personal') or hr_access)
  )
$$;
