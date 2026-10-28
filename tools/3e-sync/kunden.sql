-- Liest die Kunden aus 3E (JOLEKA_LIVE_STD). Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Pflicht: ext_id (eindeutiger Schlüssel des Kunden in 3E) und name. Alles andere darf fehlen.
-- PLATZHALTER: Tabellen- und Spaltennamen werden eingetragen, sobald die Struktur der 3E-Datenbank bekannt ist.
SELECT
  CAST(k.KundenID AS varchar(50)) AS ext_id,
  k.Kundennummer                  AS customer_number,
  k.Name1                         AS name,
  k.Name2                         AS name2,
  k.Strasse                       AS street,
  ''                              AS house_no,
  k.PLZ                           AS zip,
  k.Ort                           AS city,
  k.Land                          AS country,
  k.Telefon                       AS phone,
  k.Mobil                         AS mobile,
  k.Email                         AS email,
  k.Internet                      AS website,
  1                               AS active
FROM dbo.Kunden k
