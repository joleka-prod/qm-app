-- Liest die Angebote aus 3E (Datenbank JOLEKA_LIVE_STD, Tabelle OBE_Beleg) für die Liste "Angebote aus 3E" in der App.
-- Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Angebote = BelegTyp 0 (neue Auftragsverwaltung seit 2021, Nummern ANG…). Angebotsdokumente (BelegTyp 13) sind nur
-- gedruckte Fassungen davon und kommen nicht mit.
-- project_ext_id = ProjektID (= ext_id des Bauvorhabens), customer_ext_id = Kundennummer (= ext_id des Kunden).
-- Datum und Betrag als Text (JJJJ-MM-TT bzw. mit Punkt), damit die Ländereinstellung des Servers keine Rolle spielt.
SELECT
  b.BelegID AS ext_id,
  b.Belegnummer AS number,
  LTRIM(RTRIM(COALESCE(b.Auftragserweiterung, ''))) AS extension,
  COALESCE(a.Bezeichnung, b.BelegArt) AS kind,
  LEFT(COALESCE(NULLIF(LTRIM(RTRIM(b.Kommission)), ''), NULLIF(LTRIM(RTRIM(b.Bauvorhaben)), ''), ''), 300) AS title,
  CONVERT(char(10), COALESCE(b.Datum, b.Eingangsdatum, b.ErstelltAm), 23) AS doc_date,
  CONVERT(char(10), b.WunschTermin, 23) AS delivery_date,
  CASE WHEN NULLIF(LTRIM(RTRIM(b.Stornogrund)), '') IS NOT NULL THEN 'storniert' ELSE COALESCE(b.StatusAuftragskopf, '') END AS status,
  CONVERT(varchar(30), CAST(ROUND(b.NettoGesamt, 2) AS decimal(14, 2))) AS amount_net,
  -- Zusätze untereinander: Feld "Bauvorhaben" (wenn nicht schon Bezeichnung), abweichende manuelle Belegnummer
  COALESCE(STUFF(
    COALESCE(CHAR(10) + CASE WHEN NULLIF(LTRIM(RTRIM(b.Kommission)), '') IS NOT NULL THEN NULLIF(LTRIM(RTRIM(b.Bauvorhaben)), '') END, '') +
    COALESCE(CHAR(10) + CASE WHEN LTRIM(RTRIM(COALESCE(b.ManuelleBelegnummer, ''))) NOT IN ('', b.Belegnummer)
                             THEN 'Manuelle Belegnummer: ' + LTRIM(RTRIM(b.ManuelleBelegnummer)) END, ''),
    1, 1, ''), '') AS notes,
  b.KundenNr AS customer_ext_id,
  NULLIF(b.ProjektID, '') AS project_ext_id
FROM dbo.OBE_Beleg b
LEFT JOIN dbo.OST_Belegsart a ON a.Mandant = b.Mandant AND a.Code = b.BelegArt
WHERE b.Mandant = '000' AND b.BelegTyp = 0
ORDER BY b.Belegnummer
