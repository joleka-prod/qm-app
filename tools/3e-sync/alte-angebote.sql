-- Liest die Angebote der ALTEN Auftragsverwaltung (2011 bis ca. 2021, ohne Projekte) aus 3E für die App.
-- Datenbank JOLEKA_LIVE_BWG, Tabelle A_Kopf (die Verbindung zeigt auf JOLEKA_LIVE_STD, daher der volle Name).
-- AuftragsTyp: 0 = Angebot, 1 = Auftrag, 2 = Anfrage (nicht übernommen), 2001 = neue Belege (kommen aus OBE_Beleg).
-- Nummer = AuNummer, Endung (AuAlpha, z. B. KD, REP, REKL, 1) als Erweiterung; "-" heißt keine Endung.
-- Die alten Vorgänge haben kein Projekt, sie hängen nur am Kunden (KundenNr = ext_id des Kunden).
-- Die Spaltennamen nach AS darf man nicht ändern, die App erwartet genau diese.
SELECT
  'BWG-' + k.ID AS ext_id,
  CAST(k.AuNummer AS varchar(20)) AS number,
  CASE WHEN LTRIM(RTRIM(COALESCE(k.AuAlpha, ''))) IN ('', '-') THEN '' ELSE LTRIM(RTRIM(k.AuAlpha)) END AS extension,
  'Angebot (alte Auftragsverwaltung)' AS kind,
  LEFT(COALESCE(NULLIF(LTRIM(RTRIM(k.Kommission)), ''), NULLIF(LTRIM(RTRIM(k.Bauvorhaben)), ''), ''), 300) AS title,
  CONVERT(char(10), k.AufEingDatum, 23) AS doc_date,
  CONVERT(char(10), k.Anlieferdatum, 23) AS delivery_date,
  COALESCE(LTRIM(RTRIM(k.AufStatus)), '') AS status,
  CONVERT(varchar(30), CAST(ROUND(k.A_Summe, 2) AS decimal(14, 2))) AS amount_net,
  CASE WHEN NULLIF(LTRIM(RTRIM(k.Kommission)), '') IS NOT NULL THEN COALESCE(LTRIM(RTRIM(k.Bauvorhaben)), '') ELSE '' END AS notes,
  NULLIF(LTRIM(RTRIM(k.KundenNr)), '') AS customer_ext_id,
  CAST(NULL AS varchar(64)) AS project_ext_id,
  -- Bauvorhaben für die App (je Kunde + Baustelle): Baustellenadresse (A_Adresse Nummer 1), sonst Belegadresse (Nummer 0).
  -- site_key = Text "Bauvorhaben"/"Kommission" (Entscheidung Fabian 2026-11-01), sonst Baustellenadresse, sonst Belegadresse.
  CASE WHEN s.bv <> '' THEN 'T|' + s.bv
       WHEN s.hat_baustelle = 1 THEN 'A|' + COALESCE(a1.Strasse, '') + '|' + COALESCE(a1.PLZ, '')
       ELSE 'B|' + COALESCE(a0.Strasse, '') + '|' + COALESCE(a0.PLZ, '') END AS site_key,
  COALESCE(NULLIF(s.bv, ''), CASE WHEN s.hat_baustelle = 1 THEN LTRIM(RTRIM(a1.Strasse)) + ', ' + LTRIM(RTRIM(a1.Ort)) END, '') AS site_name,
  CASE WHEN s.hat_baustelle = 1 THEN a1.Strasse ELSE a0.Strasse END AS site_street,
  CASE WHEN s.hat_baustelle = 1 THEN a1.PLZ ELSE a0.PLZ END AS site_zip,
  CASE WHEN s.hat_baustelle = 1 THEN a1.Ort ELSE a0.Ort END AS site_city,
  CASE WHEN s.hat_baustelle = 1 THEN a1.Land ELSE a0.Land END AS site_country
FROM JOLEKA_LIVE_BWG.dbo.A_Kopf k
LEFT JOIN JOLEKA_LIVE_BWG.dbo.A_Adresse a0 ON a0.ID_A_Kopf = k.ID AND a0.Nummer = 0
LEFT JOIN JOLEKA_LIVE_BWG.dbo.A_Adresse a1 ON a1.ID_A_Kopf = k.ID AND a1.Nummer = 1
CROSS APPLY (SELECT
  CASE WHEN NULLIF(LTRIM(RTRIM(COALESCE(a1.Strasse, ''))), '') IS NOT NULL AND NULLIF(LTRIM(RTRIM(COALESCE(a1.Ort, ''))), '') IS NOT NULL
       THEN 1 ELSE 0 END AS hat_baustelle,
  LEFT(COALESCE(NULLIF(LTRIM(RTRIM(k.Bauvorhaben)), ''), NULLIF(LTRIM(RTRIM(k.Kommission)), ''), ''), 200) AS bv
) s
WHERE k.AuftragsTyp = 0
ORDER BY k.AuNummer, k.AuAlpha
