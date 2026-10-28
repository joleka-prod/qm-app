# E-Mails den Kunden zuordnen (Microsoft 365)

JOLEKA 360° liest die Postfächer **info@joleka.de** und **kontakt@joleka.de** über Microsoft Graph mit.
Die Mails kommen weiterhin ganz normal in Outlook an, die App hängt nicht dazwischen.

Alle 5 Minuten holt die Edge Function `sync-mail` neue Mails aus *Posteingang* und *Gesendete Elemente*:

- **Eingang:** Steht der Absender im Kundenstamm (E-Mail des Kunden oder eines Ansprechpartners), wird die Mail
  beim Kunden unter *Kommunikation* als „E-Mail“ gespeichert.
- **Ausgang:** Dasselbe für die Empfänger (An/Cc).
- Alle anderen Mails werden **nicht** gespeichert. Adressen @joleka.de werden nie zugeordnet.
- Gespeichert werden Betreff, Text, Absender/Empfänger und die **Namen** der Anhänge. Die Anhänge selbst bleiben in Outlook.
- Beim ersten Abruf werden die Mails der letzten 90 Tage übernommen.

## Einrichtung (einmalig, ca. 30 Minuten)

### 1. App in Microsoft Entra registrieren (Microsoft-365-Admin)

1. https://entra.microsoft.com → *Identität* → *Anwendungen* → *App-Registrierungen* → **Neue Registrierung**
2. Name `JOLEKA 360 Mailabruf`, Kontotyp *Nur Konten in diesem Organisationsverzeichnis*, keine Umleitungs-URI → **Registrieren**
3. Auf der Übersichtsseite notieren: **Anwendungs-ID (Client)** und **Verzeichnis-ID (Mandant)**
4. *Zertifikate & Geheimnisse* → **Neuer geheimer Clientschlüssel**, Ablauf 24 Monate → den **Wert** sofort kopieren
   (wird nur einmal angezeigt). Vor Ablauf einen neuen anlegen und in Supabase tauschen.
5. **Keine** API-Berechtigung „Mail.Read“ unter *API-Berechtigungen* vergeben. Sie würde für *alle* Postfächer gelten.
   Das Recht wird in Schritt 2 nur für die beiden Postfächer erteilt.
6. *Unternehmensanwendungen* → `JOLEKA 360 Mailabruf` öffnen → **Objekt-ID** notieren
   (das ist die Objekt-ID der Unternehmensanwendung, nicht die der App-Registrierung).

### 2. Zugriff auf info@ und kontakt@ beschränken (Exchange Online PowerShell)

PowerShell als Admin öffnen:

```powershell
Install-Module ExchangeOnlineManagement   # nur beim ersten Mal
Connect-ExchangeOnline

# Postfächer markieren, die die App lesen darf
Set-Mailbox info@joleka.de -CustomAttribute10 joleka360
Set-Mailbox kontakt@joleka.de -CustomAttribute10 joleka360
New-ManagementScope -Name "JOLEKA 360 Postfaecher" -RecipientRestrictionFilter "CustomAttribute10 -eq 'joleka360'"

# App bekannt machen und Leserecht nur für diese Postfächer geben
New-ServicePrincipal -AppId <Anwendungs-ID> -ObjectId <Objekt-ID der Unternehmensanwendung> -DisplayName "JOLEKA 360 Mailabruf"
New-ManagementRoleAssignment -App <Anwendungs-ID> -Role "Application Mail.Read" -CustomResourceScope "JOLEKA 360 Postfaecher"

# Prüfen: info@ muss InScope = True zeigen, ein beliebiges Mitarbeiterpostfach False
Test-ServicePrincipalAuthorization -Identity <Anwendungs-ID> -Resource info@joleka.de
```

Weiteres Postfach später: `Set-Mailbox <adresse> -CustomAttribute10 joleka360` und die Adresse in der Tabelle
`mail_mailboxes` eintragen. Die Rechte greifen manchmal erst nach 30 bis 60 Minuten.

Hinweis: info@ und kontakt@ müssen echte Postfächer sein (persönlich oder freigegeben). Ist eine davon nur ein
Alias eines anderen Postfachs, reicht das Hauptpostfach. Microsoft-365-Gruppen gehen nicht.

### 3. Supabase

1. Migration `supabase/migrations/20261028160000_mail_zuordnung.sql` im SQL-Editor ausführen.
2. *Edge Functions* → *Secrets*:
   - `MS_TENANT_ID` = Verzeichnis-ID (Mandant)
   - `MS_CLIENT_ID` = Anwendungs-ID (Client)
   - `MS_CLIENT_SECRET` = Wert des geheimen Clientschlüssels
   - `MAIL_SYNC_KEY` = langes Zufallspasswort (mind. 20 Zeichen)
3. Edge Function `sync-mail` anlegen (Code aus `supabase/functions/sync-mail/index.ts`), **Verify JWT aus**.
4. Abruf alle 5 Minuten einrichten: `abruf-einrichten.sql` im SQL-Editor ausführen
   (vorher `HIER_MAIL_SYNC_KEY` durch denselben Wert wie in Schritt 2 ersetzen).

### Prüfen

```sql
select address, last_sync_at, last_error from mail_mailboxes;
```

`last_sync_at` sollte alle 5 Minuten weiterspringen, `last_error` leer sein.
