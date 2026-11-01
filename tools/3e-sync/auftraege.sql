-- Liest die Aufträge aus 3E (Datenbank JOLEKA_LIVE_STD, Tabelle OBE_Beleg) für die Liste "Aufträge aus 3E" in der App.
-- Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
-- Aufträge = BelegTyp 1 (Serviceauftrag, Produktionsauftrag, Restarbeiten, Zukaufauftrag, je Firma J/K/U/F).
-- Auftragsbestätigungen (BelegTyp 3) sind nur gedruckte Fassungen davon und kommen nicht mit.
-- project_ext_id = ProjektID (= ext_id des Bauvorhabens), customer_ext_id = Kundennummer (= ext_id des Kunden).
-- Datum und Betrag als Text (JJJJ-MM-TT bzw. mit Punkt), damit die Ländereinstellung des Servers keine Rolle spielt.
SELECT
  b.BelegID AS ext_id,
  -- Belegnummer ist eindeutig; die manuelle Belegnummer teilen sich oft mehrere Aufträge (Nachträge), sie steht in notes
  b.Belegnummer AS number,
  -- Auftragserweiterung zur Auftragsnummer (in der App direkt hinter der Nummer)
  LTRIM(RTRIM(COALESCE(b.Auftragserweiterung, ''))) AS extension,
  COALESCE(a.Bezeichnung, b.BelegArt) AS kind,
  LEFT(COALESCE(NULLIF(LTRIM(RTRIM(b.Kommission)), ''), NULLIF(LTRIM(RTRIM(b.Bauvorhaben)), ''), ''), 300) AS title,
  CONVERT(char(10), COALESCE(b.Eingangsdatum, b.ErstelltAm, b.Datum), 23) AS doc_date,
  CONVERT(char(10), b.WunschTermin, 23) AS delivery_date,
  CASE WHEN NULLIF(LTRIM(RTRIM(b.Stornogrund)), '') IS NOT NULL THEN 'storniert' ELSE COALESCE(b.StatusAuftragskopf, '') END AS status,
  CONVERT(varchar(30), CAST(ROUND(b.NettoGesamt, 2) AS decimal(14, 2))) AS amount_net,
  -- Feld "Bauvorhaben" im Beleg (oft Adresse oder Zusatz), nur wenn es nicht schon die Bezeichnung ist,
  -- dazu die manuelle Belegnummer, wenn sie abweicht
  CASE WHEN n.bv <> '' AND n.mn <> '' THEN n.bv + CHAR(10) + 'Manuelle Belegnummer: ' + n.mn
       WHEN n.mn <> '' THEN 'Manuelle Belegnummer: ' + n.mn
       ELSE n.bv END AS notes,
  -- Zuständige laut 3E (Kürzel), in der App unter dem Beleg; Vertreter = Fachberater
  LTRIM(RTRIM(COALESCE(b.Projektleiter, ''))) AS projektleiter,
  LTRIM(RTRIM(COALESCE(b.Sachbearbeiter1, ''))) AS sachbearbeiter1,
  LTRIM(RTRIM(COALESCE(b.Sachbearbeiter2, ''))) AS sachbearbeiter2,
  LTRIM(RTRIM(COALESCE(b.Vertreter1, ''))) AS vertreter1,
  LTRIM(RTRIM(COALESCE(b.Vertreter2, ''))) AS vertreter2,
  LTRIM(RTRIM(COALESCE(b.Techniker, ''))) AS techniker,
  LTRIM(RTRIM(COALESCE(b.SachbearbeiterMaWi, ''))) AS sachbearbeiter_mawi,
  LTRIM(RTRIM(COALESCE(b.Montageplaner, ''))) AS montageplaner,
  b.KundenNr AS customer_ext_id,
  NULLIF(b.ProjektID, '') AS project_ext_id
FROM dbo.OBE_Beleg b
LEFT JOIN dbo.OST_Belegsart a ON a.Mandant = b.Mandant AND a.Code = b.BelegArt
CROSS APPLY (SELECT
  CASE WHEN NULLIF(LTRIM(RTRIM(b.Kommission)), '') IS NOT NULL THEN COALESCE(LTRIM(RTRIM(b.Bauvorhaben)), '') ELSE '' END AS bv,
  CASE WHEN LTRIM(RTRIM(COALESCE(b.ManuelleBelegnummer, ''))) <> b.Belegnummer THEN LTRIM(RTRIM(COALESCE(b.ManuelleBelegnummer, ''))) ELSE '' END AS mn
) n
WHERE b.Mandant = '000' AND b.BelegTyp = 1
ORDER BY b.Belegnummer
