-- Neue Benutzerrolle "Disposition" (eigene Datei, weil ein neuer Enum-Wert erst nach dem
-- Abschluss der Transaktion verwendet werden darf)
alter type public.user_role add value if not exists 'disposition';
