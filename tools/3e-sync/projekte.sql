-- Liest die Projekte aus 3E (Datenbank JOLEKA_LIVE_STD) für die Bauvorhaben in der App.
-- Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Pflicht: ext_id (ProjektID) und name. customer_ext_id ist die Kundennummer (= ext_id des Kunden in der App);
-- die Adresse des Bauvorhabens kommt vom Kunden, Projekte haben in 3E keine eigene Adresse.
-- Alle Projekte, auch abgeschlossene und stornierte (in der App als "abgeschlossen").
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
  CASE WHEN p.AbgeschlossenAm IS NOT NULL OR p.StorniertAm IS NOT NULL THEN 'abgeschlossen' ELSE 'aktiv' END AS status
FROM dbo.OPR_Projekt p
WHERE p.Mandant = '000'
ORDER BY p.Projektnummer
