# JOLEKA Service Dashboard

Web-App für das Qualitätsmanagement. Läuft im Browser auf PC und Handy und lässt sich auf dem Handy wie eine App auf den Startbildschirm legen.

## Ablauf eines Tickets

1. **Mitarbeiter** erstellt ein Ticket mit Kurzbeschreibung, Beschreibung und Fotos und wählt optional den verantwortlichen Teamleiter.
2. **QM/Admin** weist einen Teamleiter zu, falls das noch nicht passiert ist.
3. **Teamleiter** trägt die Ursache und die Maßnahme gegen Wiederholung ein und meldet das Ticket als erledigt.
4. **QM/Admin** prüft das Ticket und schließt es ab oder gibt es mit einem Hinweis zurück.

Jeder Schritt wird im Verlauf des Tickets protokolliert.

| Rolle | Darf |
| --- | --- |
| Mitarbeiter | Tickets anlegen, eigene Tickets sehen, Fotos ergänzen |
| Teamleiter | Alle Tickets sehen, bei eigenen Tickets Ursache und Maßnahme eintragen |
| QM / Admin | Alles: zuweisen, prüfen, abschließen, Benutzerrollen verwalten |

Die Rechte werden in der Datenbank durchgesetzt (Row Level Security), nicht nur in der Oberfläche.

## Einrichtung

### 1. Supabase-Projekt

1. Auf [supabase.com](https://supabase.com) ein Projekt anlegen, Region **Central EU (Frankfurt)**.
2. Im SQL-Editor nacheinander alle Dateien aus `supabase/migrations/` ausführen (in der Reihenfolge der Dateinamen)
   (oder mit der CLI: `npx supabase link` und `npx supabase db push`).
3. Unter *Authentication → Sign In / Providers* die Option **Allow new users to sign up** ausschalten,
   damit nur eingeladene Personen Zugang bekommen.
4. Unter *Authentication → URL Configuration* die **Site URL** auf die Adresse der App setzen.
5. Für den Live-Betrieb einen eigenen SMTP-Server unter *Authentication → Emails* eintragen,
   da der eingebaute Mailversand nur wenige E-Mails pro Stunde erlaubt.

### 2. Benutzerverwaltung (Edge Function)

Damit QM/Admin in der App Benutzer anlegen und Passwörter zurücksetzen kann, wird die Funktion
`supabase/functions/admin-users/index.ts` benötigt: im Dashboard unter *Edge Functions → Deploy a new function →
Via Editor* mit dem Namen `admin-users` anlegen und den Inhalt der Datei einfügen
(oder `npx supabase functions deploy admin-users`).

### 2b. Servicebericht per E-Mail (Edge Function + Resend)

Wünscht der Kunde bei der Unterschrift den Bericht per E-Mail, verschickt die Funktion
`supabase/functions/send-report/index.ts` nach „Erledigt melden“ ein PDF über [Resend](https://resend.com).

1. Bei Resend ein Konto anlegen, unter *Domains* die eigene Domain hinzufügen (Region EU) und die angezeigten
   DNS-Einträge beim Domain-Anbieter eintragen, bis die Domain als *Verified* gilt.
2. Unter *API Keys* einen Schlüssel mit *Sending access* erstellen.
3. In Supabase unter *Edge Functions → Secrets* eintragen: `RESEND_API_KEY` (der Schlüssel) und
   `MAIL_FROM` (z. B. `JOLEKA Service <service@joleka.de>`), optional `MAIL_REPLY_TO` und `COMPANY_NAME`.
4. Die Funktion wie `admin-users` mit dem Namen `send-report` anlegen.

Lokal testen: `scripts/test-report.mjs` (mit einem Test-Mailserver über `RESEND_API_URL`).

### 3. Erster Admin

Die erste Person, die angelegt wird, wird automatisch **QM / Admin**
(*Authentication → Users → Add user → Create new user*, „Auto Confirm User“ aktiviert).
Alle weiteren Benutzer legt QM/Admin direkt in der App unter **Benutzer** an.

### Ticketarten und Monteure

Neben QM-Tickets gibt es Restarbeiten, Beanstandungen und Reparaturaufträge („Einsätze“).
QM/Admin und Teamleiter planen Einsätze (Monteur, Montagedatum, optional Uhrzeit) im Ticket oder im
**Kalender** (Wochenansicht aller Monteure, Einplanen per Ziehen). Monteure (Rolle „Monteur“) sehen nach
dem Login ihren persönlichen Kalender, schreiben den Arbeitsbericht und melden den Einsatz erledigt.

### Tickets löschen

Nur QM/Admin löscht Tickets. Alle anderen können die Löschung mit Begründung beantragen;
QM/Admin gibt den Antrag frei (Ticket wird gelöscht) oder lehnt ihn ab. Anträge stehen in der Ticketliste
unter dem Filter „Löschung beantragt“.

### 4. App veröffentlichen

Die App läuft auf Cloudflare Pages (Projekt `qm-app`, Adresse https://360.joleka.de über einen CNAME bei Host Europe
auf `qm-app-cq4.pages.dev`):

- Build-Befehl: `npm run build`
- Ausgabeordner: `dist`
- Umgebungsvariablen: `NODE_VERSION` (22), `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` (aus *Project Settings → API*)

Links wie `/ticket/12` funktionieren bei Pages automatisch (Single-Page-Weiterleitung).

Die Verbindungsdaten stehen nur in den Pages-Einstellungen, nicht im Repository. Fehlen sie, zeigt die App einen
Hinweis statt sich mit einem falschen Projekt zu verbinden.

**Testsystem:** zweites Pages-Projekt `qm-app-test` (Branch `test`, Adresse 360-test.joleka.de) mit den Daten des
Test-Supabase-Projekts und zusätzlich `VITE_APP_ENV=test`. Dann zeigt die App oben einen gelben Balken „TESTSYSTEM“.
Im Test-Supabase-Projekt muss das Secret `TEST_MAIL_TO` gesetzt sein: `send-report` schickt Berichte dann nur an diese
Adresse und verweigert den Versand ganz, wenn es fehlt.

Der frühere Cloudflare Worker unter `qm-app.fabian-rieder.workers.dev` leitet nur noch auf die neue Adresse weiter
(`wrangler.jsonc`, `worker/umleitung.js`) und meldet den alten Service Worker auf den Geräten ab.

### 5. Datenbank-Änderungen und Testsystem (GitHub Actions)

- **Supabase einspielen** (`.github/workflows/supabase-deploy.yml`): Bei jedem Push auf `test` bzw. `main`, der
  `supabase/` ändert, werden neue Migrationen per `supabase db push` und alle Edge Functions ins Test- bzw.
  Livesystem eingespielt. Bricht ab, solange die Datenbank keine Migrationsliste hat.
- **Live: Migrationen als gelaufen markieren**: einmalig von Hand, trägt die bisher per Hand ausgeführten
  Migrationen im Livesystem ein.
- **Live nach Test kopieren**: von Hand; `erstmalig` in das leere Testprojekt, danach `daten` zum Auffrischen.
  Fotos werden nicht kopiert.

GitHub-Secrets: `SUPABASE_ACCESS_TOKEN`, `LIVE_DB_URL`, `TEST_DB_URL` (jeweils die „Session pooler“-Adresse aus
Supabase → Connect, Passwort eingesetzt).

## Lokale Entwicklung

```bash
npm install
npx supabase start              # lokale Supabase in Docker
cp .env.example .env            # URL und anon key aus `npx supabase status` eintragen
npm run dev
```

Rechte und Ablauf testen (lokale Supabase muss laufen; die Benutzerverwaltung braucht die Edge Function,
lokal z. B. per `deno run --allow-net --allow-env supabase/functions/admin-users/index.ts` und `FUNCTIONS_URL=http://127.0.0.1:8000`):

```bash
SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... node scripts/test-rules.mjs
```
