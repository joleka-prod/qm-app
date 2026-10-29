-- Rechte für Fotos, Unterschriften und Berichte im Speicher (Bucket ticket-photos) sicherstellen.
-- Beim Aufbau des Testsystems wurde nur das Schema "public" aus Live kopiert, die Regeln auf
-- storage.objects (Migration 20261022000000) fehlten dort. Hochladen scheiterte mit
-- "new row violates row-level security policy". Gleiche Regeln wie bisher, im Livesystem ändert sich nichts.

drop policy if exists "Fotodateien sehen" on storage.objects;
create policy "Fotodateien sehen"
  on storage.objects for select to authenticated
  using (bucket_id = 'ticket-photos'
         and public.can_view_ticket(((storage.foldername(name))[1])::bigint));

drop policy if exists "Fotodateien hochladen" on storage.objects;
create policy "Fotodateien hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-photos'
              and public.can_view_ticket(((storage.foldername(name))[1])::bigint));

drop policy if exists "Fotodateien löschen" on storage.objects;
create policy "Fotodateien löschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-photos'
         and (owner_id = auth.uid()::text or public.is_admin()));
