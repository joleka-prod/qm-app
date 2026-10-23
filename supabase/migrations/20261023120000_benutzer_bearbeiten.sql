-- Benutzer bearbeiten: Name, Rolle und Aktiv-Status ändert der Admin direkt.
-- Die E-Mail-Adresse muss zur Login-Adresse passen und wird deshalb nur über die
-- Edge Function admin-users (Service-Schlüssel) geändert.

create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  new.full_name := trim(new.full_name);
  if new.email is distinct from old.email then
    raise exception 'Die E-Mail-Adresse kann nur über die Benutzerverwaltung geändert werden';
  end if;
  if public.is_admin() then
    if new.id = auth.uid() and (new.role is distinct from old.role or not new.active) then
      raise exception 'Die eigene Rolle und den eigenen Zugang kannst du nicht ändern';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active then
    raise exception 'Nur Admins dürfen Rolle oder Status ändern';
  end if;
  return new;
end;
$$;
