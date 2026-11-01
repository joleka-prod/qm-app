-- Bauvorhaben-Liste: Auftragsanzahl zählt auch die Aufträge aus 3E (erp_documents, doc_type 'auftrag').
-- Neues Feld erp_orders je Zeile; tickets bleibt die Anzahl der eigenen Aufträge.

create or replace function public.search_projects(p_query text default '', p_status text default '', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_like text;
  v_project_ids bigint[];
  v_result jsonb;
begin
  if not public.can_use_crm() then
    raise exception 'Keine Berechtigung';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if length(v_q) >= 2 then
    select array_agg(distinct pc.project_id) into v_project_ids
      from public.customers c
      join public.project_customers pc on pc.customer_id = c.id
      where public.customer_search_text(c) like v_like;
  end if;

  with hits as (
    select p.*
    from public.projects p
    where v_q = '' or public.project_search_text(p) like v_like or p.id = any (coalesce(v_project_ids, '{}'))
  ),
  in_status as (
    select * from hits where coalesce(p_status, '') = '' or status = p_status
  ),
  page as (
    select * from in_status
    -- ohne Suche die neuesten zuerst, mit Suche alphabetisch
    order by case when v_q = '' then -id end, lower(name), id
    limit greatest(1, least(coalesce(p_limit, 100), 500))
  )
  select jsonb_build_object(
    'total', (select count(*) from in_status),
    'counts', coalesce((select jsonb_object_agg(status, n) from (select status, count(*) n from hits group by status) g), '{}'::jsonb),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(p) || jsonb_build_object(
        'tickets', jsonb_build_array(jsonb_build_object('count', (select count(*) from public.tickets t where t.project_id = p.id))),
        'erp_orders', (select count(*) from public.erp_documents e where e.project_id = p.id and e.doc_type = 'auftrag'),
        'project_customers', coalesce((
          select jsonb_agg(jsonb_build_object('role', pc.role, 'customers', jsonb_build_object('name', c.name, 'customer_number', c.customer_number)) order by pc.id)
          from public.project_customers pc join public.customers c on c.id = pc.customer_id
          where pc.project_id = p.id), '[]'::jsonb)
      ) order by case when v_q = '' then -p.id end, lower(p.name), p.id)
      from page p
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
