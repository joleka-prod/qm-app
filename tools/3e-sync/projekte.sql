-- Liest die Projekte aus 3E (Datenbank JOLEKA_LIVE_STD) für die Bauvorhaben in der App.
-- Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Pflicht: ext_id (ProjektID) und name. customer_ext_id ist die Kundennummer (= ext_id des Kunden in der App).
-- Adresse: Projekte haben in 3E keine eigene Adresse. Genommen wird die Baustellenadresse (OBE_Adresse Typ 3) eines
-- Belegs des Projekts (zuerst Aufträge, dann Angebote, jeweils der neueste); fehlt sie, nimmt die App die Kundenadresse.
-- Alle Projekte, auch abgeschlossene und stornierte (in der App als "abgeschlossen").
WITH baustelle AS (
  SELECT b.ProjektID, d.Strasse, d.PLZ, d.Ort, d.Land,
    ROW_NUMBER() OVER (PARTITION BY b.ProjektID
                       ORDER BY CASE b.BelegTyp WHEN 1 THEN 0 ELSE 1 END, b.ErstelltAm DESC, b.Belegnummer DESC) AS nr
  FROM dbo.OBE_Beleg b
  JOIN dbo.OBE_Adresse a ON a.Mandant = b.Mandant AND a.BelegID = b.BelegID AND a.Typ = 3
  JOIN dbo.OBE_Adressdaten d ON d.Mandant = a.Mandant AND d.AdressID = a.AdressID
  WHERE b.Mandant = '000' AND b.BelegTyp IN (0, 1) AND NULLIF(b.ProjektID, '') IS NOT NULL
    AND NULLIF(LTRIM(RTRIM(COALESCE(d.Ort, ''))), '') IS NOT NULL
    AND NULLIF(LTRIM(RTRIM(COALESCE(d.Strasse, ''))), '') IS NOT NULL
    AND d.Strasse NOT LIKE '%??%'
)
SELECT
  p.ProjektID AS ext_id,
  p.Projektnummer AS project_number,
  -- Bezeichnung: Projektbezeichnung, sonst Feld Bauvorhaben, Kommission, Kunde, zuletzt die Projektnummer
  LEFT(COALESCE(
    NULLIF(LTRIM(RTRIM(p.ProjektBezeichnung)), ''),
    NULLIF(LTRIM(RTRIM(p.Bauvorhaben)), ''),
    NULLIF(LTRIM(RTRIM(p.Kommission)), ''),
    NULLIF(LTRIM(RTRIM(p.KundenBezeichnung)), ''),
    p.Projektnummer
  ), 200) AS name,
  p.Kundennummer AS customer_ext_id,
  CASE WHEN p.AbgeschlossenAm IS NOT NULL OR p.StorniertAm IS NOT NULL THEN 'abgeschlossen' ELSE 'aktiv' END AS status,
  -- Baustellenadresse (leer = Kundenadresse)
  LTRIM(RTRIM(COALESCE(s.Strasse, ''))) AS site_street,
  LTRIM(RTRIM(COALESCE(s.PLZ, ''))) AS site_zip,
  LTRIM(RTRIM(COALESCE(s.Ort, ''))) AS site_city,
  CASE WHEN s.ProjektID IS NULL THEN ''
    ELSE CASE UPPER(LTRIM(RTRIM(ISNULL(s.Land, ''))))
      WHEN '' THEN 'Deutschland' WHEN 'D' THEN 'Deutschland' WHEN 'DE' THEN 'Deutschland' WHEN 'DEU' THEN 'Deutschland'
      WHEN 'L' THEN 'Luxemburg' WHEN 'LU' THEN 'Luxemburg' WHEN 'B' THEN 'Belgien' WHEN 'BE' THEN 'Belgien'
      WHEN 'NL' THEN 'Niederlande' WHEN 'F' THEN 'Frankreich' WHEN 'FR' THEN 'Frankreich'
      WHEN 'A' THEN 'Österreich' WHEN 'AT' THEN 'Österreich' WHEN 'CH' THEN 'Schweiz'
      ELSE s.Land END END AS site_country
FROM dbo.OPR_Projekt p
LEFT JOIN baustelle s ON s.ProjektID = p.ProjektID AND s.nr = 1
WHERE p.Mandant = '000'
ORDER BY p.Projektnummer
