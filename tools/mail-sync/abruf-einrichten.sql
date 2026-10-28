-- Mailabruf alle 5 Minuten (sync-mail). Vorher HIER_MAIL_SYNC_KEY durch den Wert des Secrets MAIL_SYNC_KEY ersetzen.
-- Der Schlüssel liegt verschlüsselt im Supabase Vault, nicht im Code.
create extension if not exists pg_cron;
create extension if not exists pg_net;

select vault.create_secret('HIER_MAIL_SYNC_KEY', 'mail_sync_key');

select cron.schedule('mail-abruf', '*/5 * * * *', $$
  select net.http_post(
    url := 'https://zcsinntrwaqmidyenuee.supabase.co/functions/v1/sync-mail',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-key', (select decrypted_secret from vault.decrypted_secrets where name = 'mail_sync_key')
    ),
    body := '{}'::jsonb
  )
$$);

-- Abruf stoppen: select cron.unschedule('mail-abruf');
