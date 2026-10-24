-- Kunden & CRM (Fabian 2026-10-24): Kundenstamm mit Kundengruppen, Ansprechpartnern und
-- Kommunikationsverlauf. Aufträge verweisen über tickets.customer_id auf den Kunden.
-- Sehen und pflegen: alle Rollen außer Monteur. Löschen nur Admin.
-- Einträge im Kommunikationsverlauf bleiben unverändert (nur Wiedervorlage abhaken).

create function public.can_use_crm()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() in ('admin', 'teamleiter', 'disposition', 'mitarbeiter'), false)
$$;

-- --- Kunden ---
create table public.customers (
  id bigint generated always as identity primary key,
  customer_number text not null default '',
  customer_group text not null default 'privat'
    check (customer_group in ('privat', 'bautraeger', 'architekt', 'oeffentlich', 'grossprojekt')),
  name text not null check (length(trim(name)) > 0),
  name2 text not null default '',
  street text not null default '',
  house_no text not null default '',
  zip text not null default '',
  city text not null default '',
  country text not null default 'Deutschland',
  phone text not null default '',
  mobile text not null default '',
  email text not null default '',
  website text not null default '',
  notes text not null default '',
  active boolean not null default true,
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint customers_number_unique unique (customer_number)
);

create index customers_name_idx on public.customers (lower(name));

-- Kundennummer automatisch vergeben (K-<höchste Nummer + 1>), Texte trimmen
create function public.customers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_next bigint;
begin
  new.customer_number := coalesce(trim(new.customer_number), '');
  new.name := trim(new.name);
  new.name2 := trim(new.name2);
  new.email := trim(new.email);
  new.country := coalesce(nullif(trim(new.country), ''), 'Deutschland');
  if new.customer_number = '' then
    perform pg_advisory_xact_lock(hashtext('customers_number'));
    select coalesce(max(substring(customer_number from '^K-(\d+)$')::bigint), 10000) + 1
      into v_next from public.customers;
    new.customer_number := 'K-' || v_next;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger customers_guard
  before insert or update on public.customers
  for each row execute function public.customers_guard();

alter table public.customers enable row level security;

create policy "Kunden sehen" on public.customers for select to authenticated using (public.can_use_crm());
create policy "Kunden anlegen" on public.customers for insert to authenticated with check (public.can_use_crm());
create policy "Kunden ändern" on public.customers for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Kunden löschen" on public.customers for delete to authenticated using (public.my_role() = 'admin');

-- --- Ansprechpartner ---
create table public.customer_contacts (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  name text not null check (length(trim(name)) > 0),
  position text not null default '',
  phone text not null default '',
  mobile text not null default '',
  email text not null default '',
  notes text not null default '',
  created_at timestamptz not null default now()
);

create index customer_contacts_customer_idx on public.customer_contacts (customer_id);

alter table public.customer_contacts enable row level security;

create policy "Ansprechpartner sehen" on public.customer_contacts for select to authenticated using (public.can_use_crm());
create policy "Ansprechpartner anlegen" on public.customer_contacts for insert to authenticated with check (public.can_use_crm());
create policy "Ansprechpartner ändern" on public.customer_contacts for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Ansprechpartner löschen" on public.customer_contacts for delete to authenticated using (public.can_use_crm());

-- --- Kommunikation ---
create table public.customer_notes (
  id bigint generated always as identity primary key,
  customer_id bigint not null references public.customers (id) on delete cascade,
  contact_id bigint references public.customer_contacts (id) on delete set null,
  ticket_id bigint references public.tickets (id) on delete set null,
  kind text not null default 'notiz' check (kind in ('telefon', 'email', 'termin', 'brief', 'notiz')),
  subject text not null default '',
  body text not null default '',
  follow_up_date date,
  follow_up_user uuid references public.profiles (id),
  follow_up_done_at timestamptz,
  follow_up_done_by uuid references public.profiles (id),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (length(trim(subject)) > 0 or length(trim(body)) > 0)
);

create index customer_notes_customer_idx on public.customer_notes (customer_id, created_at desc);
create index customer_notes_follow_up_idx on public.customer_notes (follow_up_date) where follow_up_date is not null and follow_up_done_at is null;

-- Verfasser und Zeit setzt der Server; danach lässt sich nur die Wiedervorlage abhaken
create function public.customer_notes_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    new.subject := trim(new.subject);
    new.body := trim(new.body);
    if auth.uid() is not null then
      new.created_by := auth.uid();
      new.created_at := now();
    end if;
    if new.follow_up_date is not null then
      new.follow_up_user := coalesce(new.follow_up_user, new.created_by);
    else
      new.follow_up_user := null;
    end if;
    new.follow_up_done_at := null;
    new.follow_up_done_by := null;
    return new;
  end if;
  if (new.customer_id, new.contact_id, new.ticket_id, new.kind, new.subject, new.body,
      new.follow_up_date, new.follow_up_user, new.created_by, new.created_at)
     is distinct from
     (old.customer_id, old.contact_id, old.ticket_id, old.kind, old.subject, old.body,
      old.follow_up_date, old.follow_up_user, old.created_by, old.created_at) then
    raise exception 'Einträge im Kommunikationsverlauf können nicht geändert werden';
  end if;
  if new.follow_up_done_at is not null and old.follow_up_done_at is null then
    new.follow_up_done_at := now();
    new.follow_up_done_by := auth.uid();
  elsif new.follow_up_done_at is null then
    new.follow_up_done_by := null;
  else
    new.follow_up_done_at := old.follow_up_done_at;
    new.follow_up_done_by := old.follow_up_done_by;
  end if;
  return new;
end;
$$;

create trigger customer_notes_guard
  before insert or update on public.customer_notes
  for each row execute function public.customer_notes_guard();

alter table public.customer_notes enable row level security;

create policy "Kommunikation sehen" on public.customer_notes for select to authenticated using (public.can_use_crm());
create policy "Kommunikation erfassen" on public.customer_notes for insert to authenticated with check (public.can_use_crm());
create policy "Wiedervorlage abhaken" on public.customer_notes for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Kommunikation löschen" on public.customer_notes for delete to authenticated using (public.my_role() = 'admin');

-- --- Verknüpfung Auftrag → Kunde ---
alter table public.tickets add column customer_id bigint references public.customers (id) on delete set null;
create index tickets_customer_idx on public.tickets (customer_id);

-- Bestehende Kunden aus den Aufträgen übernehmen: je Kundennummer, sonst je Name + PLZ;
-- Daten vom jüngsten Auftrag. Erst die mit Nummer, damit neu vergebene Nummern nicht kollidieren.
insert into public.customers (customer_number, name, street, house_no, zip, city, country, email, created_by, created_at)
select distinct on (trim(t.customer_number))
  trim(t.customer_number), t.customer_name, t.customer_street, t.customer_house_no, t.customer_zip, t.customer_city,
  coalesce(nullif(t.customer_country, ''), 'Deutschland'), t.customer_email, t.created_by, t.created_at
from public.tickets t
where trim(t.customer_name) <> '' and trim(t.customer_number) <> ''
order by trim(t.customer_number), t.created_at desc;

insert into public.customers (customer_number, name, street, house_no, zip, city, country, email, created_by, created_at)
select distinct on (lower(trim(t.customer_name)), trim(t.customer_zip))
  '', t.customer_name, t.customer_street, t.customer_house_no, t.customer_zip, t.customer_city,
  coalesce(nullif(t.customer_country, ''), 'Deutschland'), t.customer_email, t.created_by, t.created_at
from public.tickets t
where trim(t.customer_name) <> '' and trim(t.customer_number) = ''
order by lower(trim(t.customer_name)), trim(t.customer_zip), t.created_at desc;

update public.tickets t
set customer_id = c.id
from public.customers c
where t.customer_id is null
  and trim(t.customer_name) <> ''
  and (
    (trim(t.customer_number) <> '' and c.customer_number = trim(t.customer_number))
    or (trim(t.customer_number) = '' and lower(c.name) = lower(trim(t.customer_name)) and c.zip = trim(t.customer_zip)
        and c.customer_number like 'K-%')
  );

-- Aufträge ohne Kundennummer bekommen die neu vergebene Nummer
update public.tickets t
set customer_number = c.customer_number
from public.customers c
where t.customer_id = c.id and trim(t.customer_number) = '';

-- Monteure ändern die Kundenzuordnung nicht; Folgeaufträge übernehmen den Kunden
create function public.tickets_zz_customer_link()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and new.customer_id is distinct from old.customer_id then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  if tg_op = 'INSERT' and new.customer_id is null and new.parent_id is not null then
    select customer_id into new.customer_id from public.tickets where id = new.parent_id;
  end if;
  if new.ticket_type = 'qm' then
    new.customer_id := null;
  end if;
  return new;
end;
$$;

create trigger tickets_zz_customer_link
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_customer_link();
