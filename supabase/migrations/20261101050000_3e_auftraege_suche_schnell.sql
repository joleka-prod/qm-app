-- Suche "Aufträge aus 3E" lief mit über 57.000 Aufträgen in den Statement-Timeout (Fabian, 2026-11-01).
-- Neuer Trigramm-Index auf einem Suchtext je Beleg (wie bei Kunden/Bauvorhaben); Kunden und Bauvorhaben werden
-- vorab über ihre eigenen Suchindizes gesucht und per ID verknüpft.

create or replace function public.erp_document_search_text(d public.erp_documents)
returns text
language sql
immutable
set search_path = ''
as $$
  select lower(concat_ws(' ', d.doc_number, d.doc_extension, d.doc_number || d.doc_extension, d.title, d.notes,
                         d.customer_ext_id, (select string_agg(v, ' ') from jsonb_each_text(d.staff) s(k, v))))
$$;

create index if not exists erp_documents_search_trgm_idx on public.erp_documents
  using gin (public.erp_document_search_text(erp_documents) extensions.gin_trgm_ops);

create or replace function public.search_erp_documents(p_query text default '', p_kind text default '', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_q text := lower(trim(coalesce(p_query, '')));
  v_like text;
  v_kind text := trim(coalesce(p_kind, ''));
  v_result jsonb;
  v_cust_ids bigint[] := '{}';
  v_proj_ids bigint[] := '{}';
begin
  if not public.can_use_crm() then
    raise exception 'Keine Berechtigung';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q <> '' then
    -- passende Kunden und Bauvorhaben vorab über ihre Suchindizes holen
    select coalesce(array_agg(id), '{}') into v_cust_ids
    from (select c.id from public.customers c where public.customer_search_text(c) like v_like limit 5000) x;
    select coalesce(array_agg(id), '{}') into v_proj_ids
    from (select p.id from public.projects p where public.project_search_text(p) like v_like limit 5000) x;
  end if;

  -- erst nur Treffer zählen und die Seite bestimmen (ohne Joins), dann Kunde/Bauvorhaben dazuholen
  with hits as materialized (
    select d.id, d.doc_date
    from public.erp_documents d
    where d.doc_type = 'auftrag'
      and (v_kind = '' or d.doc_kind ilike v_kind || '%')
      and (v_q = '' or public.erp_document_search_text(d) like v_like
           or d.customer_id = any (v_cust_ids) or d.project_id = any (v_proj_ids))
  ),
  page as (
    select d.*, c.name as customer_name, c.customer_number, p.project_number, p.name as project_name
    from (select id from hits order by doc_date desc nulls last, id desc
          limit greatest(1, least(coalesce(p_limit, 100), 500))) h
    join public.erp_documents d on d.id = h.id
    left join public.customers c on c.id = d.customer_id
    left join public.projects p on p.id = d.project_id
  )
  select jsonb_build_object(
    'total', (select count(*) from hits),
    'rows', coalesce((
      select jsonb_agg(to_jsonb(x) - 'customer_name' - 'customer_number' - 'project_number' - 'project_name'
        || jsonb_build_object(
          'customers', case when x.customer_id is null then null else jsonb_build_object('name', x.customer_name, 'customer_number', x.customer_number) end,
          'projects', case when x.project_id is null then null else jsonb_build_object('project_number', x.project_number, 'name', x.project_name) end)
        order by x.doc_date desc nulls last, x.id desc)
      from page x
    ), '[]'::jsonb)
  ) into v_result;
  return v_result;
end;
$$;
