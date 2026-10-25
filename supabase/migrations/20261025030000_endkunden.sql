-- Endkunden zuordnen (Fabian 2026-10-25): Bauträger, Generalunternehmer und Architekten können
-- Kunden als Endkunden zugeordnet bekommen. Jede Zuordnung nennt das Projekt und/oder den Auftrag.

create table public.customer_end_customers (
  id bigint generated always as identity primary key,
  partner_id bigint not null references public.customers (id) on delete cascade,
  end_customer_id bigint not null references public.customers (id) on delete cascade,
  project text not null default '' check (length(project) <= 200),
  ticket_id bigint references public.tickets (id) on delete set null,
  note text not null default '' check (length(note) <= 1000),
  created_by uuid references public.profiles (id) default auth.uid(),
  created_at timestamptz not null default now(),
  check (partner_id <> end_customer_id)
);

create index customer_end_customers_partner_idx on public.customer_end_customers (partner_id);
create index customer_end_customers_end_idx on public.customer_end_customers (end_customer_id);
create unique index customer_end_customers_unique
  on public.customer_end_customers (partner_id, end_customer_id, lower(project), coalesce(ticket_id, 0));

create function public.customer_end_customers_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.project := trim(new.project);
  new.note := trim(new.note);
  if new.project = '' and new.ticket_id is null then
    raise exception 'Bitte Projekt oder Auftrag angeben';
  end if;
  if not exists (
    select 1 from public.customers
    where id = new.partner_id and customer_group in ('bautraeger', 'generalunternehmer', 'architekt')
  ) then
    raise exception 'Endkunden lassen sich nur Bauträgern, Generalunternehmern und Architekten zuordnen';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null then
    new.created_by := auth.uid();
    new.created_at := now();
  elsif tg_op = 'UPDATE' then
    new.created_by := old.created_by;
    new.created_at := old.created_at;
  end if;
  return new;
end;
$$;

create trigger customer_end_customers_guard
  before insert or update on public.customer_end_customers
  for each row execute function public.customer_end_customers_guard();

alter table public.customer_end_customers enable row level security;

create policy "Endkunden sehen" on public.customer_end_customers for select to authenticated using (public.can_use_crm());
create policy "Endkunden zuordnen" on public.customer_end_customers for insert to authenticated with check (public.can_use_crm());
create policy "Endkunden-Zuordnung ändern" on public.customer_end_customers for update to authenticated using (public.can_use_crm()) with check (public.can_use_crm());
create policy "Endkunden-Zuordnung lösen" on public.customer_end_customers for delete to authenticated using (public.can_use_crm());
