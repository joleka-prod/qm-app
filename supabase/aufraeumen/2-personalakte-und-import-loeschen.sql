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
  if to_regclass('public.personnel_files') is not null then
    execute $q$
      select coalesce(array_agg(p.id), '{}')
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
    $q$ into v_ids;
  else
    -- Personalakte schon entfernt: dann nur noch die Benutzer ohne App-Login erkennbar
    select coalesce(array_agg(id), '{}') into v_ids
    from public.profiles where role <> 'admin' and email like '%@kein-login.invalid';
    raise notice 'Personalakte war schon entfernt, erkannt werden nur Benutzer ohne App-Login.';
  end if;

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
