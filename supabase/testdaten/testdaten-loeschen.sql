-- Entfernt alle Testaufträge aus testdaten-anlegen.sql (Titel beginnt mit "[TEST]").
-- Positionen, Verlauf und Löschanträge werden automatisch mit entfernt.
delete from public.tickets where title like '[TEST]%';
