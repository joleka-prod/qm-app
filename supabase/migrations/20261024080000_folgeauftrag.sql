-- Folgeauftrag: Aus einem Service-Auftrag, bei dem nicht alles erledigt werden konnte, erstellt die
-- Disposition (bzw. Admin/Teamleiter) einen neuen Auftrag. parent_id verknüpft die Aufträge, damit die
-- ganze Auftragskette in jedem Auftrag sichtbar ist.

alter table public.tickets
  add column if not exists parent_id bigint references public.tickets (id) on delete set null;

create index if not exists tickets_parent_idx on public.tickets (parent_id);

-- parent_id setzt nur create_followup (oder der Service-Key)
create or replace function public.tickets_zz_parent()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null then
    return new;
  end if;
  if tg_op = 'INSERT' then
    if coalesce(current_setting('app.followup', true), '') <> '1' then
      new.parent_id := null;
    end if;
  else
    new.parent_id := old.parent_id;
  end if;
  return new;
end;
$$;

drop trigger if exists tickets_zz_parent on public.tickets;
create trigger tickets_zz_parent
  before insert or update on public.tickets
  for each row execute function public.tickets_zz_parent();

-- Folgeauftrag anlegen: Kunde, Adressen, Auftragsdaten und alle nicht erledigten Positionen übernehmen
create or replace function public.create_followup(p_ticket_id bigint)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_src public.tickets;
  v_id bigint;
  v_pos int;
begin
  if coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter', 'disposition') then
    raise exception 'Folgeaufträge erstellt die Disposition';
  end if;
  select * into v_src from public.tickets where id = p_ticket_id;
  if not found or v_src.ticket_type = 'qm' then
    raise exception 'Auftrag nicht gefunden';
  end if;

  perform set_config('app.followup', '1', true);
  insert into public.tickets (
    ticket_type, service_area, title, description, order_number, parent_id,
    customer_number, customer_name, customer_street, customer_house_no, customer_zip, customer_city,
    customer_country, customer_email, site_address,
    billing_address_different, billing_name, billing_street, billing_house_no, billing_zip, billing_city, billing_country,
    jobsite_address_different, jobsite_name, jobsite_street, jobsite_house_no, jobsite_zip, jobsite_city, jobsite_country
  ) values (
    v_src.ticket_type, v_src.service_area, v_src.title, v_src.description, v_src.order_number, v_src.id,
    v_src.customer_number, v_src.customer_name, v_src.customer_street, v_src.customer_house_no, v_src.customer_zip,
    v_src.customer_city, v_src.customer_country, v_src.customer_email, v_src.site_address,
    v_src.billing_address_different, v_src.billing_name, v_src.billing_street, v_src.billing_house_no,
    v_src.billing_zip, v_src.billing_city, v_src.billing_country,
    v_src.jobsite_address_different, v_src.jobsite_name, v_src.jobsite_street, v_src.jobsite_house_no,
    v_src.jobsite_zip, v_src.jobsite_city, v_src.jobsite_country
  ) returning id into v_id;
  perform set_config('app.followup', '', true);

  insert into public.ticket_positions (ticket_id, sort, position_number, description, quantity, unit, article_id)
  select v_id, row_number() over (order by p.sort, p.id) - 1, (row_number() over (order by p.sort, p.id))::text,
         p.description, p.quantity, p.unit, p.article_id
  from public.ticket_positions p
  where p.ticket_id = v_src.id and p.state <> 'erledigt';
  get diagnostics v_pos = row_count;

  insert into public.ticket_events (ticket_id, actor, kind, details) values
    (v_src.id, auth.uid(), 'folgeauftrag', v_id::text),
    (v_id, auth.uid(), 'aus_auftrag', v_src.id::text || ':' || v_pos);
  return v_id;
end;
$$;

revoke execute on function public.create_followup(bigint) from public, anon;
grant execute on function public.create_followup(bigint) to authenticated;

-- Ganze Auftragskette (Ursprung, alle Folgeaufträge) zu einem Auftrag, den man sehen darf
drop function if exists public.ticket_chain(bigint);
create function public.ticket_chain(p_ticket_id bigint)
returns table (
  id bigint, parent_id bigint, ticket_type public.ticket_type, title text, status public.ticket_status,
  montage_date date, created_at timestamptz, closed_at timestamptz, not_done int, not_done_items text, depth int
)
language sql
stable
security definer
set search_path = ''
as $$
  with recursive up as (
    select t.id, t.parent_id, 0 as n from public.tickets t where t.id = p_ticket_id
    union all
    select t.id, t.parent_id, up.n + 1 from public.tickets t join up on t.id = up.parent_id where up.n < 50
  ),
  root as (select up.id from up order by up.n desc limit 1),
  down as (
    select t.id, 0 as depth from public.tickets t where t.id = (select root.id from root)
    union all
    select t.id, down.depth + 1 from public.tickets t join down on t.parent_id = down.id where down.depth < 50
  )
  select t.id, t.parent_id, t.ticket_type, t.title, t.status, t.montage_date, t.created_at, t.closed_at,
         (select count(*)::int from public.ticket_positions p where p.ticket_id = t.id and p.state = 'nicht_erledigt'),
         (select coalesce(string_agg(p.description || ' – ' || p.reason, E'\n' order by p.sort, p.id), '')
          from public.ticket_positions p where p.ticket_id = t.id and p.state = 'nicht_erledigt'),
         down.depth
  from down join public.tickets t on t.id = down.id
  where public.can_view_ticket(p_ticket_id)
  order by t.created_at, t.id
$$;

revoke execute on function public.ticket_chain(bigint) from public, anon;
grant execute on function public.ticket_chain(bigint) to authenticated;
