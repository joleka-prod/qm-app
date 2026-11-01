# Abgleich 3E Look → JOLEKA 360° (Kunden, Bauvorhaben und Aufträge)

3E bleibt führend. Dieses Programm läuft auf dem 3E-Server (Windows), liest die Kunden aus `JOLEKA_LIVE_STD`
(nur lesend) und schickt sie an die App. In der App sind die Stammdaten dieser Kunden dann schreibgeschützt
(Name, Adresse, Telefon, E-Mail, Webseite, Kundennummer). Kundengruppe, Bemerkung, Ansprechpartner,
Kommunikation und Bauvorhaben bleiben in der App pflegbar.

Danach liest es die Projekte (`OPR_Projekt`, alle, auch abgeschlossene) und legt sie als **Bauvorhaben** an
(`projekte.sql`). Jedes Bauvorhaben wird mit seinem 3E-Kunden (Kundennummer) verknüpft und bekommt dessen Adresse,
weil Projekte in 3E keine eigene Adresse haben. Nummer, Bezeichnung, Status und Adresse sind in der App
schreibgeschützt; Bemerkung, weitere Beteiligte, Aufträge und Kommunikation bleiben pflegbar.

## Einmalig in Supabase

1. Migrationen `supabase/migrations/20261028000000_3e_kundenabgleich.sql` und (für die Bauvorhaben)
   `20261028130000_3e_bauvorhaben.sql` im SQL Editor ausführen.
2. Edge Function `sync-3e` anlegen (Inhalt aus `supabase/functions/sync-3e/index.ts`) und dabei
   **„Verify JWT“ ausschalten** (das Programm meldet sich mit eigenem Schlüssel an).
3. Unter *Edge Functions → Secrets* `SYNC_3E_KEY` mit einem langen Zufallswert (mind. 20 Zeichen) anlegen.

## Auf dem 3E-Server

1. Ordner `C:\JOLEKA\3e-sync` anlegen und `sync-3e.ps1`, `kunden.sql`, `projekte.sql`, `einstellungen.beispiel.json` hineinkopieren.
   Fehlt `projekte.sql`, gleicht das Programm nur die Kunden ab.
2. `einstellungen.beispiel.json` nach `einstellungen.json` kopieren und ausfüllen:
   Lese-Benutzer + Passwort (nicht `sa`), `SyncSchluessel` = Wert von `SYNC_3E_KEY`.
3. Probelauf in PowerShell:
   `powershell -ExecutionPolicy Bypass -File C:\JOLEKA\3e-sync\sync-3e.ps1 -Probe`
   Ändert nichts. `vorschau.csv` zeigt, welche App-Kunden mit welchem 3E-Kunden verknüpft bzw. neu angelegt würden,
   `vorschau-bauvorhaben.csv` dasselbe für die Bauvorhaben. Nur einen Teil prüfen: `-Nur Kunden` bzw. `-Nur Bauvorhaben`.
4. Passt die Vorschau: einmal ohne `-Probe` ausführen.
5. Geplante Aufgabe (Aufgabenplanung) anlegen, z. B. stündlich:
   Programm `powershell.exe`, Argumente `-ExecutionPolicy Bypass -File C:\JOLEKA\3e-sync\sync-3e.ps1`,
   „Unabhängig von der Benutzeranmeldung ausführen“.

Protokoll: `sync-3e.log` im selben Ordner.

## Zuordnung beim ersten Lauf

1. gleiche 3E-ID (`ext_id`) → aktualisieren
2. sonst App-Kunde mit gleicher Kundennummer → verknüpfen
3. sonst App-Kunde mit gleichem Namen + PLZ → verknüpfen
4. sonst neu anlegen

Kunden, die in 3E gelöscht werden, bleiben in der App erhalten (Aufträge und Verlauf hängen daran).

Bauvorhaben: 1. gleiche 3E-ID (`ProjektID`) → aktualisieren, 2. sonst App-Bauvorhaben mit gleicher Nummer → verknüpfen,
3. sonst neu anlegen. Abgeschlossene oder stornierte Projekte werden als „abgeschlossen“ übernommen. Ändert sich in 3E
die Adresse des Kunden, ziehen seine Bauvorhaben beim nächsten Lauf mit.

## Aufträge

Danach liest es alle Belege vom Typ **Auftrag** (`auftraege.sql`, `OBE_Beleg` mit BelegTyp 1 in `JOLEKA_LIVE_STD`:
Service-, Produktions-, Zukaufaufträge und Restarbeiten aller Firmen; Auftragsbestätigungen sind nur Druckfassungen). Sie landen schreibgeschützt in `erp_documents`
(Migration `20261028140000_3e_auftraege.sql`) und erscheinen im Bauvorhaben und beim Kunden unter „Aufträge aus 3E“.
Zuordnung über die 3E-ProjektID (Bauvorhaben) und die Kundennummer; fehlt die Kundennummer, gilt der Kunde des Bauvorhabens.
Über „+ Montageauftrag anlegen“ entsteht daraus ein normaler Auftrag mit der 3E-Auftragsnummer. Nur diesen Teil prüfen:
`-Nur Auftraege -Probe` (Vorschau in `vorschau-auftraege.csv`).
Mit übernommen werden die **Zuständigen** aus dem Beleg (Kürzel aus 3E): Vertreter 1/2 (in der App „Fachberater“), Techniker,
Sachbearbeiter 1/2, Projektleiter, Montageplaner und Sachbearbeiter MaWi (Migration `20261101010000_3e_zustaendige.sql`,
Spalte `erp_documents.staff`). Gilt auch für die Angebote. Rechnungen folgen später in derselben Tabelle.

## Angebote

Zum Schluss liest es die **Angebote** (`angebote.sql`, `OBE_Beleg` mit BelegTyp 0, Nummern ANG…; Angebotsdokumente
sind nur Druckfassungen). Sie landen ebenfalls schreibgeschützt in `erp_documents` (Belegart `angebot`) und erscheinen im
Bauvorhaben und beim Kunden unter „Angebote aus 3E“. Nur diesen Teil prüfen: `-Nur Angebote -Probe`
(Vorschau in `vorschau-angebote.csv`). Fehlt `angebote.sql` im Ordner, werden keine Angebote abgeglichen.
