-- Liest die Kunden aus 3E (Datenbank JOLEKA_LIVE_STD). Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Pflicht: ext_id (eindeutiger Schlüssel des Kunden in 3E) und name. Alles andere darf fehlen.
-- S_Kunde = Kunde (Mandant 000), Adresse über KundenAdrCode in S_Adressen (Kennung 1000 = Kundenadresse).
-- Straße und Hausnummer stehen in 3E in einem Feld, das Sync-Programm trennt sie.
SELECT
  k.KundenNr AS ext_id,
  k.KundenNr AS customer_number,
  COALESCE(
    NULLIF(LTRIM(RTRIM(a.Firma)), ''),
    NULLIF(LTRIM(RTRIM(CONCAT_WS(' ', CASE WHEN a.Anrede1 IN ('Fam.', 'Familie') THEN 'Familie' END,
                                      NULLIF(LTRIM(RTRIM(a.Vorname)), ''), NULLIF(LTRIM(RTRIM(a.Name)), '')))), ''),
    NULLIF(LTRIM(RTRIM(k.KundenBez)), ''),
    k.KundenNr
  ) AS name,
  -- bei Firmen steht die Person im Zusatz
  CASE WHEN NULLIF(LTRIM(RTRIM(a.Firma)), '') IS NOT NULL
       THEN LTRIM(RTRIM(CONCAT_WS(' ', NULLIF(LTRIM(RTRIM(a.Vorname)), ''), NULLIF(LTRIM(RTRIM(a.Name)), ''))))
       ELSE '' END AS name2,
  a.Strasse AS street,
  '' AS house_no,
  a.PLZ AS zip,
  a.Ort AS city,
  CASE UPPER(LTRIM(RTRIM(ISNULL(a.Land, ''))))
    WHEN '' THEN 'Deutschland' WHEN 'D' THEN 'Deutschland' WHEN 'DE' THEN 'Deutschland' WHEN 'DEU' THEN 'Deutschland'
    WHEN 'L' THEN 'Luxemburg' WHEN 'LU' THEN 'Luxemburg' WHEN 'B' THEN 'Belgien' WHEN 'BE' THEN 'Belgien'
    WHEN 'NL' THEN 'Niederlande' WHEN 'F' THEN 'Frankreich' WHEN 'FR' THEN 'Frankreich'
    WHEN 'A' THEN 'Österreich' WHEN 'AT' THEN 'Österreich' WHEN 'CH' THEN 'Schweiz'
    ELSE a.Land END AS country,
  COALESCE(NULLIF(LTRIM(RTRIM(a.Telefon)), ''), a.TelefonPriv) AS phone,
  COALESCE(NULLIF(LTRIM(RTRIM(a.Mobil)), ''), a.MobilPriv) AS mobile,
  a.Email AS email,
  a.Internet AS website,
  CASE k.Klassifikation1
    WHEN '001' THEN 'Bestandskunde' WHEN '002' THEN 'wiederkehrender Kunde' WHEN '003' THEN 'Empfehlung'
    WHEN '004' THEN 'Google Internetseite' WHEN '005' THEN 'Social Media' WHEN '006' THEN 'Printmedien'
    WHEN '007' THEN 'Fahrzeugwerbung / Bauschild / Plakatwerbung' WHEN '008' THEN 'über Mitarbeiter'
    WHEN '009' THEN 'über Kundendienst' WHEN '010' THEN 'Messen / Inhouseveranstaltung' WHEN '011' THEN 'Profine Website'
    ELSE ISNULL(k.Klassifikation1, '') END AS origin,
  CASE WHEN ISNULL(k.Gesperrt, 0) = 0 THEN 1 ELSE 0 END AS active
FROM dbo.S_Kunde k
LEFT JOIN dbo.S_Adressen a ON a.Mandant = k.Mandant AND a.Kennung = 1000 AND a.Code = k.KundenAdrCode
WHERE k.Mandant = '000'
ORDER BY k.KundenNr
