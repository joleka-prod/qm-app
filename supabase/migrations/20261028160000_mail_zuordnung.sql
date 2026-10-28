-- E-Mails den Kunden zuordnen (Fabian, 2026-10-28): Die Edge Function sync-mail liest über Microsoft Graph die
-- freigegebenen Postfächer (Start: info@ und kontakt@) mit. Die Zustellung läuft unverändert über Microsoft 365.
-- Gespeichert werden nur Mails, deren Absender (Posteingang) bzw. Empfänger (Gesendet) im Kundenstamm oder bei einem
-- Ansprechpartner hinterlegt ist, als Eintrag „E-Mail“ im Kommunikationsverlauf. Alles andere wird verworfen.
-- Anhänge bleiben in Outlook, gespeichert werden nur ihre Namen.

-- --- Postfächer, die abgerufen werden ---
create table public.mail_mailboxes (
  address text primary key check (address = lower(trim(address)) and address like '%@%'),
  active boolean not null default true,
  -- Erster Abruf holt Mails ab diesem Zeitpunkt, danach nur noch Neues
  import_from timestamptz not null default (now() - interval '90 days'),
  -- Microsoft-Graph-Delta-Links (Fortsetzung bzw. Stand) je Ordner
  inbox_link text,
  sent_link text,
  last_sync_at timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);

alter table public.mail_mailboxes enable row level security;

create policy "Postfächer sehen" on public.mail_mailboxes for select to authenticated using (public.my_role() = 'admin');
create policy "Postfächer pflegen" on public.mail_mailboxes for all to authenticated
  using (public.my_role() = 'admin') with check (public.my_role() = 'admin');

insert into public.mail_mailboxes (address) values ('info@joleka.de'), ('kontakt@joleka.de');

-- --- Mailangaben am Kommunikationseintrag ---
alter table public.customer_notes
  add column mail_direction text check (mail_direction in ('eingang', 'ausgang')),
  add column mail_mailbox text,
  add column mail_from text,
  add column mail_to text,
  add column mail_attachments text[] not null default '{}',
  add column mail_message_id text,
  -- Dieselbe Mail (z. B. an info@ und kontakt@ zugleich) nur einmal je Kunde
  add constraint customer_notes_mail_unique unique (customer_id, mail_message_id);

-- --- Zuordnung: E-Mail-Adressen → Kunden / Ansprechpartner ---
-- Im Kundenstamm (auch aus 3E) stehen teils mehrere Adressen in einem Feld, getrennt durch ; , oder Leerzeichen.
create function public.customer_email_list(p_email text)
returns text[]
language sql
immutable
set search_path = ''
as $$
  select coalesce(array_agg(e), '{}')
  from regexp_split_to_table(lower(coalesce(p_email, '')), '[;,[:space:]]+') e
  where e like '%_@_%'
$$;

create index customers_email_list_idx on public.customers using gin (public.customer_email_list(email));
create index customer_contacts_email_list_idx on public.customer_contacts using gin (public.customer_email_list(email));

-- Nur für die Edge Function (Service-Rolle)
create function public.match_mail_addresses(p_addresses text[])
returns table (address text, customer_id bigint, contact_id bigint)
language sql
stable
set search_path = ''
as $$
  with a as (select distinct lower(trim(x)) as address from unnest(p_addresses) x)
  select a.address, c.id, null::bigint
  from a join public.customers c on public.customer_email_list(c.email) @> array[a.address]
  union
  select a.address, cc.customer_id, cc.id
  from a join public.customer_contacts cc on public.customer_email_list(cc.email) @> array[a.address]
$$;

revoke execute on function public.match_mail_addresses(text[]) from public, anon, authenticated;
grant execute on function public.match_mail_addresses(text[]) to service_role;
