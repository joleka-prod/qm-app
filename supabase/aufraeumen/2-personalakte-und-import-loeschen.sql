-- Schritt 2: löscht die per Ninox importierten Benutzer und die komplette Personalakte (Fabian, 2026-10-26).
-- ACHTUNG: nicht umkehrbar. Vorher Schritt 1 ausführen und die Liste prüfen.
-- Benutzer, die schon Daten erzeugt haben (z. B. Stempelungen), werden nicht gelöscht, sondern deaktiviert.
-- Ein einziger Block: läuft komplett oder gar nicht.

do $$
declare
  v_ids uuid[];
  v_id uuid;
  v_deleted int := 0;
  v_deactivated int := 0;
begin
  -- gleiche Erkennung wie in Schritt 1 (Anlagezeit-Block am 26.10.2026 oder ohne App-Login)
  with heute as (
    select p.id, p.created_at,
      case when p.created_at - lag(p.created_at) over (order by p.created_at) <= interval '2 minutes' then 0 else 1 end as neu
    from public.profiles p
    where (p.created_at at time zone 'Europe/Berlin')::date = date '2026-10-26' and p.role <> 'admin'
  ), bloecke as (
    select id, sum(neu) over (order by created_at) as block from heute
  ), gross as (
    select block from bloecke group by block having count(*) >= 3
  )
  select coalesce(array_agg(p.id), '{}') into v_ids
  from public.profiles p
  where p.role <> 'admin'
    and (p.email like '%@kein-login.invalid'
         or p.id in (select id from bloecke where block in (select block from gross)));

  -- Personalakte: Daten und Tabellen
  drop table if exists public.personnel_documents cascade;
  drop table if exists public.personnel_log cascade;
  drop table if exists public.personnel_files cascade;
  drop function if exists public.personnel_documents_log();
  drop function if exists public.personnel_files_track();

  drop policy if exists "Personal liest Personaldokumente" on storage.objects;
  drop policy if exists "Personal lädt Personaldokumente hoch" on storage.objects;
  drop policy if exists "Personal löscht Personaldokumente" on storage.objects;

  drop trigger if exists profiles_zz_hr_guard on public.profiles;
  drop function if exists public.profiles_zz_hr_guard();
  drop function if exists public.has_hr_access();
  alter table public.profiles drop column if exists hr_access;

  -- importierte Benutzer löschen (Profil, Chip und PIN werden mitgelöscht)
  foreach v_id in array v_ids loop
    begin
      delete from auth.users where id = v_id;
      v_deleted := v_deleted + 1;
    exception when foreign_key_violation then
      update public.profiles set active = false where id = v_id;
      v_deactivated := v_deactivated + 1;
    end;
  end loop;
  raise notice 'Gelöscht: %, deaktiviert (hatten schon Daten): %', v_deleted, v_deactivated;
end;
$$;

-- Danach im Supabase-Dashboard von Hand:
--   Storage: Bucket "personnel-docs" leeren und löschen (falls dort Dateien liegen).
--   Edge Functions: "ninox-import" löschen, Secret NINOX_API_KEY entfernen.
