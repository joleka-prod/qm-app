-- Auftragsübersicht "Aufträge aus 3E" (Fabian 2026-10-28): Suche über alle 3E-Aufträge (über 23.000) serverseitig,
-- wie search_projects. Gesucht wird in Nummer, Bezeichnung, Bemerkung sowie Name/Nummer von Kunde und Bauvorhaben.
-- p_kind filtert nach dem Anfang der Belegart (z. B. "Serviceauftrag", "Restarbeiten").

create index erp_documents_doc_date_idx on public.erp_documents (doc_type, doc_date desc nulls last, id desc);

create function public.search_erp_documents(p_query text default '', p_kind text default '', p_limit int default 100)
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
begin
  if not public.can_use_crm() then
    raise exception 'Keine Berechtigung';
  end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';

  with hits as (
    select d.*, c.name as customer_name, c.customer_number, p.project_number, p.name as project_name
    from public.erp_documents d
    left join public.customers c on c.id = d.customer_id
    left join public.projects p on p.id = d.project_id
    where d.doc_type = 'auftrag'
      and (v_kind = '' or d.doc_kind ilike v_kind || '%')
      and (v_q = '' or lower(concat_ws(' ', d.doc_number, d.title, d.notes, d.customer_ext_id, c.name, c.customer_number,
                                        p.project_number, p.name)) like v_like)
  ),
  page as (
    select * from hits
    order by doc_date desc nulls last, id desc
    limit greatest(1, least(coalesce(p_limit, 100), 500))
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

revoke all on function public.search_erp_documents(text, text, int) from public, anon;
grant execute on function public.search_erp_documents(text, text, int) to authenticated;
