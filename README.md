# QM-Tickets

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
2. Im SQL-Editor den Inhalt von `supabase/migrations/20261022000000_qm_schema.sql` ausführen
   (oder mit der CLI: `npx supabase link` und `npx supabase db push`).
3. Unter *Authentication → Sign In / Providers* die Option **Allow new users to sign up** ausschalten,
   damit nur eingeladene Personen Zugang bekommen.
4. Unter *Authentication → URL Configuration* die **Site URL** auf die Adresse der App setzen.
5. Für den Live-Betrieb einen eigenen SMTP-Server unter *Authentication → Emails* eintragen,
   da der eingebaute Mailversand nur wenige E-Mails pro Stunde erlaubt.

### 2. Erster Admin

Die erste Person, die eingeladen wird, wird automatisch **QM / Admin**.
Einladen: *Authentication → Users → Invite user*. Alle weiteren Personen starten als Mitarbeiter;
die Rolle wird dann in der App unter **Benutzer** geändert.

### 3. App veröffentlichen

Die App ist eine statische Seite und kann z. B. auf Cloudflare Pages kostenlos gehostet werden:

- Build-Befehl: `npm run build`
- Ausgabeordner: `dist`
- Umgebungsvariablen: `VITE_SUPABASE_URL` und `VITE_SUPABASE_ANON_KEY` (aus *Project Settings → API*)

Damit Links wie `/ticket/12` direkt funktionieren, ist in `wrangler.jsonc` die Single-Page-Weiterleitung eingestellt
(für Cloudflare Workers mit Deploy-Befehl `npx wrangler deploy`). Bei Cloudflare Pages greift sie automatisch.

## Lokale Entwicklung

```bash
npm install
npx supabase start              # lokale Supabase in Docker
cp .env.example .env            # URL und anon key aus `npx supabase status` eintragen
npm run dev
```

Rechte und Ablauf testen (lokale Supabase muss laufen):

```bash
SUPABASE_ANON_KEY=... SUPABASE_SERVICE_KEY=... node scripts/test-rules.mjs
```
