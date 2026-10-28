-- Kundensuche für über 20.000 Kunden aus 3E (Fabian 2026-10-28): Die Liste filterte bisher per PostgREST mit acht
-- ilike-Bedingungen und Rechteprüfung je Zeile und lief damit in den Abbruch. Jetzt eine Funktion, die Rechte einmal prüft
-- und über einen Trigramm-Index auf einem Suchtext sucht.

create extension if not exists pg_trgm with schema extensions;

create function public.customer_search_text(c public.customers)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(concat_ws(' ', c.customer_number, c.name, c.name2, c.street, c.house_no, c.zip, c.city, c.email, c.phone, c.mobile))
$$;

create index customers_search_trgm_idx on public.customers
  using gin (public.customer_search_text(customers) extensions.gin_trgm_ops);

-- Liefert { rows: [...], total, counts: { privat: n, ... } }; rows wie die Kundenliste sie braucht
create function public.search_customers(p_query text default '', p_group text default '', p_inactive boolean default false, p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_like text;
  v_contact_ids bigint[];
  v_result jsonb;
begin
  if not public.can_use_crm() then
    raise exception 'Keine Berechtigung';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q <> '' then
    select array_agg(distinct customer_id) into v_contact_ids
      from public.customer_contacts where lower(name) like v_like;
  end if;

  with hits as (
    select c.*
    from public.customers c
    where (p_inactive or c.active)
      and (v_q = '' or public.customer_search_text(c) like v_like or c.id = any (coalesce(v_contact_ids, '{}')))
  ),
  in_group as (
    select * from hits where coalesce(p_group, '') = '' or customer_group = p_group
  ),
  page as (
    select * from in_group order by lower(name), id limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  select jsonb_build_object(
    'total', (select count(*) from in_group),
    'counts', coalesce((select jsonb_object_agg(customer_group, n) from (select customer_group, count(*) n from hits group by customer_group) g), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'tickets', jsonb_build_array(jsonb_build_object('count', (select count(*) from public.tickets t where t.customer_id = p.id))),
        'customer_notes', jsonb_build_array(jsonb_build_object('count', (select count(*) from public.customer_notes n where n.customer_id = p.id))),
        'customer_contacts', coalesce((select jsonb_agg(jsonb_build_object('name', k.name)) from public.customer_contacts k where k.customer_id = p.id), '[]'::jsonb)
      ) order by lower(p.name), p.id)
      from page p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;

revoke all on function public.search_customers(text, text, boolean, int) from public, anon;
grant execute on function public.search_customers(text, text, boolean, int) to authenticated;
