-- Schritt 1 (nur lesen): zeigt, welche Benutzer der Ninox-Import angelegt hat.
-- Erkennung: Benutzer mit Personalakte aus Ninox, deren Konto höchstens 10 Minuten vor der Akte entstanden ist,
-- sowie alle Benutzer ohne App-Login (…@kein-login.invalid). Admins werden nie erfasst.
-- Vorhandene Benutzer, bei denen der Import nur die Akte ergänzt hat, bleiben erhalten.
select p.full_name, p.email, p.role, p.created_at
from public.profiles p
where p.role <> 'admin'
  and (
    p.email like '%@kein-login.invalid'
    or exists (
      select 1 from public.personnel_files f
      where f.user_id = p.id and f.source is not null
        and p.created_at >= coalesce(
          (select min(l.at) from public.personnel_log l where l.user_id = p.id and l.kind = 'angelegt'),
          f.updated_at) - interval '10 minutes'
    )
  )
order by p.full_name;
