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
  CAST(NULL AS varchar(64)) AS project_ext_id
FROM JOLEKA_LIVE_BWG.dbo.A_Kopf k
WHERE k.AuftragsTyp = 0
ORDER BY k.AuNummer, k.AuAlpha
