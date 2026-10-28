# Kundenabgleich 3E Look → JOLEKA 360°

3E bleibt führend. Dieses Programm läuft auf dem 3E-Server (Windows), liest die Kunden aus `JOLEKA_LIVE_STD`
(nur lesend) und schickt sie an die App. In der App sind die Stammdaten dieser Kunden dann schreibgeschützt
(Name, Adresse, Telefon, E-Mail, Webseite, Kundennummer). Kundengruppe, Bemerkung, Ansprechpartner,
Kommunikation und Bauvorhaben bleiben in der App pflegbar.

## Einmalig in Supabase

1. Migration `supabase/migrations/20261028000000_3e_kundenabgleich.sql` im SQL Editor ausführen.
2. Edge Function `sync-3e` anlegen (Inhalt aus `supabase/functions/sync-3e/index.ts`) und dabei
   **„Verify JWT“ ausschalten** (das Programm meldet sich mit eigenem Schlüssel an).
3. Unter *Edge Functions → Secrets* `SYNC_3E_KEY` mit einem langen Zufallswert (mind. 20 Zeichen) anlegen.

## Auf dem 3E-Server

1. Ordner `C:\JOLEKA\3e-sync` anlegen und `sync-3e.ps1`, `kunden.sql`, `einstellungen.beispiel.json` hineinkopieren.
2. `einstellungen.beispiel.json` nach `einstellungen.json` kopieren und ausfüllen:
   Lese-Benutzer + Passwort (nicht `sa`), `SyncSchluessel` = Wert von `SYNC_3E_KEY`.
3. Probelauf in PowerShell:
   `powershell -ExecutionPolicy Bypass -File C:\JOLEKA\3e-sync\sync-3e.ps1 -Probe`
   Ändert nichts. `vorschau.csv` zeigt, welche App-Kunden mit welchem 3E-Kunden verknüpft bzw. neu angelegt würden.
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
