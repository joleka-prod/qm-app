-- Bauvorhaben als zentrale Struktur (Fabian 2026-10-25): Einem Bauvorhaben werden Kunden (mit Rolle),
-- Aufträge (Restarbeit, Beanstandung, Reparatur), Kommunikation und später Angebote zugeordnet.
-- Jeder Auftrag gehört zu einem Bauvorhaben; fehlt es, legt der Server es aus der Einsatzadresse an
-- (bzw. nimmt ein vorhandenes Bauvorhaben desselben Kunden an derselben Adresse).
-- Ersetzt die Endkunden-Zuordnung customer_end_customers (wird übernommen und entfernt).

create table public.projects (
  id bigint generated always as identity primary key,
  project_number text not null default '',
  name text not null check (length(trim(name)) > 0 and length(name) <= 200),
  street text not null default '',
  house_no text not null default '',
  zip text not null default '',
  city text not null default '',
  country text not null default 'Deutschland',
  status text not null default 'aktiv' check (status in ('aktiv', 'abgeschlossen')),
  notes text not null default '',
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint projects_number_unique unique (project_number)
);

create index projects_name_idx on public.projects (lower(name));

create function public.projects_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_next bigint;
begin
  new.project_number := coalesce(trim(new.project_number), '');
  new.name := trim(new.name);
  new.country := coalesce(nullif(trim(new.country), ''), 'Deutschland');
  if new.project_number = '' then
    perform pg_advisory_xact_lock(hashtext('projects_number'));
    select coalesce(max(substring(project_number from '^BV-(\d+)$')::bigint), 10000) + 1
      into v_next from public.projects;
    new.project_number := 'BV-' || v_next;
  end if;
  if tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
    new.updated_at := now();
  end if;
  return new;
end;
$$;

create trigger projects_guard
  before insert or update on public.projects
  for each row execute function public.projects_guard();

alter table public.projects enable row level security;

create policy "Bauvorhaben sehen" on public.projects for select to authenticated using (public.can_use_crm());
create policy "Bauvorhaben anlegen" on public.projects for insert to authenticated with check (public.can_use_crm());
create policy "Bauvorhaben ändern" on public.projects for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Bauvorhaben löschen" on public.projects for delete to authenticated using (public.my_role() = 'admin');

-- --- Beteiligte Kunden mit Rolle ---
create table public.project_customers (
  id bigint generated always as identity primary key,
  project_id bigint not null references public.projects (id) on delete cascade,
  customer_id bigint not null references public.customers (id) on delete cascade,
  role text not null default 'bauherr'
    check (role in ('bauherr', 'bautraeger', 'generalunternehmer', 'architekt', 'sonstige')),
  note text not null default '' check (length(note) <= 1000),
  created_at timestamptz not null default now(),
  constraint project_customers_unique unique (project_id, customer_id, role)
);

create index project_customers_customer_idx on public.project_customers (customer_id);

alter table public.project_customers enable row level security;

create policy "Beteiligte sehen" on public.project_customers for select to authenticated using (public.can_use_crm());
create policy "Beteiligte zuordnen" on public.project_customers for insert to authenticated with check (public.can_use_crm());
create policy "Beteiligte ändern" on public.project_customers for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Beteiligte entfernen" on public.project_customers for delete to authenticated using (public.can_use_crm());

-- Standardrolle eines Kunden aus seiner Kundengruppe
create function public.project_role_for(p_customer_id bigint)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select case when c.customer_group in ('bautraeger', 'generalunternehmer', 'architekt') then c.customer_group else 'bauherr' end
  from public.customers c where c.id = p_customer_id
$$;

-- --- Verknüpfungen ---
alter table public.tickets add column project_id bigint references public.projects (id) on delete restrict;
create index tickets_project_idx on public.tickets (project_id);

alter table public.customer_notes add column project_id bigint references public.projects (id) on delete set null;
create index customer_notes_project_idx on public.customer_notes (project_id);

-- Bauvorhaben für einen Auftrag finden oder anlegen: Einsatzadresse (Baustelle, sonst Kunde);
-- vorhandenes Bauvorhaben desselben Kunden an derselben Adresse wird wiederverwendet
create function public.project_for_ticket(t public.tickets)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_job boolean := t.jobsite_address_different;
  v_street text := case when v_job then t.jobsite_street else t.customer_street end;
  v_no text := case when v_job then t.jobsite_house_no else t.customer_house_no end;
  v_zip text := case when v_job then t.jobsite_zip else t.customer_zip end;
  v_city text := case when v_job then t.jobsite_city else t.customer_city end;
  v_country text := case when v_job then t.jobsite_country else t.customer_country end;
  v_name text;
  v_id bigint;
begin
  if t.customer_id is not null and trim(v_street || v_zip || v_city) <> '' then
    select p.id into v_id
    from public.projects p
    join public.project_customers pc on pc.project_id = p.id and pc.customer_id = t.customer_id
    where lower(trim(p.street)) = lower(trim(v_street)) and lower(trim(p.house_no)) = lower(trim(v_no))
      and trim(p.zip) = trim(v_zip) and p.status = 'aktiv'
    order by p.id
    limit 1;
    if v_id is not null then
      return v_id;
    end if;
  end if;

  v_name := coalesce(nullif(trim(case when v_job then t.jobsite_name end), ''), nullif(trim(t.customer_name), ''), trim(t.title));
  if trim(v_city) <> '' then
    v_name := v_name || ', ' || trim(v_city);
  end if;
  insert into public.projects (name, street, house_no, zip, city, country, created_by)
  values (left(coalesce(nullif(v_name, ''), 'Bauvorhaben'), 200), trim(v_street), trim(v_no), trim(v_zip), trim(v_city),
          coalesce(nullif(trim(v_country), ''), 'Deutschland'), coalesce(auth.uid(), t.created_by))
  returning id into v_id;
  return v_id;
end;
$$;

-- Vor dem Speichern: Bauvorhaben ist Pflicht (Folgeauftrag erbt es, sonst automatisch); Monteure ändern es nicht
create function public.tickets_zz_project()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.ticket_type = 'qm' then
    return new;
  end if;
  if tg_op = 'UPDATE' and auth.uid() is not null and public.my_role() = 'monteur'
     and new.project_id is distinct from old.project_id then
    raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
  end if;
  if new.project_id is null and tg_op = 'INSERT' and new.parent_id is not null then
    select project_id into new.project_id from public.tickets where id = new.parent_id;
  end if;
  if new.project_id is null then
    if tg_op = 'UPDATE' then
      raise exception 'Jeder Auftrag gehört zu einem Bauvorhaben';
    end if;
    new.project_id := public.project_for_ticket(new);
  end if;
  return new;
end;
$$;

create trigger tickets_zz_project
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_project();

-- Nach dem Speichern: Kunde des Auftrags ist am Bauvorhaben beteiligt
create function public.tickets_zz_project_customer()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.project_id is not null and new.customer_id is not null then
    insert into public.project_customers (project_id, customer_id, role)
    select new.project_id, new.customer_id, public.project_role_for(new.customer_id)
    where not exists (
      select 1 from public.project_customers where project_id = new.project_id and customer_id = new.customer_id
    );
  end if;
  return new;
end;
$$;

create trigger tickets_zz_project_customer
  after insert or update of project_id, customer_id on public.tickets
  for each row execute function public.tickets_zz_project_customer();

-- --- Übernahme der Endkunden-Zuordnungen (falls 20261025030000 schon ausgeführt wurde) ---
do $$
declare
  r record;
  v_project bigint;
begin
  if to_regclass('public.customer_end_customers') is null then
    return;
  end if;
  for r in
    select e.*, c.street, c.house_no, c.zip, c.city, c.country, c.name as end_name, c.created_by as c_by
    from public.customer_end_customers e
    join public.customers c on c.id = e.end_customer_id
    order by e.id
  loop
    v_project := null;
    if r.ticket_id is not null then
      select project_id into v_project from public.tickets where id = r.ticket_id;
    end if;
    if v_project is null and r.project <> '' then
      select p.id into v_project
      from public.projects p join public.project_customers pc on pc.project_id = p.id
      where pc.customer_id = r.partner_id and lower(p.name) = lower(r.project)
      limit 1;
    end if;
    if v_project is null then
      insert into public.projects (name, street, house_no, zip, city, country, notes, created_by, created_at)
      values (coalesce(nullif(r.project, ''), r.end_name), r.street, r.house_no, r.zip, r.city, r.country, r.note,
              coalesce(r.created_by, r.c_by), r.created_at)
      returning id into v_project;
    end if;
    insert into public.project_customers (project_id, customer_id, role)
    values (v_project, r.partner_id, public.project_role_for(r.partner_id)),
           (v_project, r.end_customer_id, 'bauherr')
    on conflict do nothing;
    if r.ticket_id is not null then
      update public.tickets set project_id = v_project where id = r.ticket_id and project_id is null;
    end if;
  end loop;
  drop table public.customer_end_customers;
  drop function if exists public.customer_end_customers_guard();
end;
$$;

-- --- Bestehende Aufträge: Bauvorhaben automatisch zuordnen (Folgeaufträge erben vom Ursprung) ---
do $$
declare
  t public.tickets;
begin
  for t in select * from public.tickets where ticket_type <> 'qm' and project_id is null order by parent_id nulls first, id loop
    update public.tickets
    set project_id = coalesce((select project_id from public.tickets where id = t.parent_id), public.project_for_ticket(t))
    where id = t.id;
  end loop;
end;
$$;
