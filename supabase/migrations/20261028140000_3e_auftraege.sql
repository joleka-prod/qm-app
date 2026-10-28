-- Aufträge aus 3E (Fabian 2026-10-28): Alle Belege vom Typ "Auftrag" kommen aus 3E in die App, schreibgeschützt.
-- Sie hängen in 3E an einem Kunden und einem Projekt (= Bauvorhaben in der App) und werden im Bauvorhaben und
-- beim Kunden als Liste "Aufträge aus 3E" gezeigt. Muss ein Auftrag montiert werden, legt man daraus einen
-- Montageauftrag an (normaler Auftrag in tickets mit der 3E-Auftragsnummer). Angebote und Rechnungen folgen später
-- in derselben Tabelle (doc_type).

create table public.erp_documents (
  id bigint generated always as identity primary key,
  doc_type text not null default 'auftrag' check (doc_type in ('auftrag', 'angebot', 'rechnung')),
  ext_id text not null,
  doc_number text not null default '',
  -- Belegart in 3E im Klartext, z. B. "Serviceauftrag JOLEKA", "Restarbeiten KALVERKAMP"
  doc_kind text not null default '',
  title text not null default '',
  doc_date date,
  delivery_date date, -- Wunschtermin
  status text not null default '',
  amount_net numeric(14, 2),
  notes text not null default '',
  customer_ext_id text,
  project_ext_id text,
  customer_id bigint references public.customers (id) on delete set null,
  project_id bigint references public.projects (id) on delete set null,
  synced_at timestamptz not null default now(),
  unique (doc_type, ext_id)
);

create index erp_documents_project_idx on public.erp_documents (project_id, doc_date desc);
create index erp_documents_customer_idx on public.erp_documents (customer_id, doc_date desc);
create index erp_documents_number_idx on public.erp_documents (doc_number);

alter table public.erp_documents enable row level security;
-- nur lesen; geschrieben wird ausschließlich vom Abgleich (Service-Key)
create policy "3E-Belege sehen" on public.erp_documents for select to authenticated using (public.can_use_crm());
revoke insert, update, delete, truncate on public.erp_documents from anon, authenticated;

-- Abgleich: p_rows ist ein JSON-Array mit ext_id (Pflicht), number, kind, title, doc_date, delivery_date (JJJJ-MM-TT),
-- status, amount_net, notes, customer_ext_id (Kundennummer = customers.ext_id), project_ext_id (ProjektID = projects.ext_id).
-- Fehlt die Kundennummer, gilt der Kunde des Bauvorhabens. p_dry_run = true ändert nichts.
create function public.import_3e_documents(p_rows jsonb, p_doc_type text default 'auftrag', p_dry_run boolean default true)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  r jsonb;
  v_ext text;
  v_number text;
  v_kind text;
  v_title text;
  v_date date;
  v_delivery date;
  v_status text;
  v_amount numeric(14, 2);
  v_notes text;
  v_cust_ext text;
  v_proj_ext text;
  v_cust_id bigint;
  v_proj public.projects;
  v_old public.erp_documents;
  v_new int := 0;
  v_updated int := 0;
  v_same int := 0;
  v_skipped int := 0;
  v_no_customer int := 0;
  v_no_project int := 0;
  v_preview jsonb := '[]'::jsonb;
  v_errors jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_rows) <> 'array' then
    raise exception 'p_rows muss ein JSON-Array sein';
  end if;
  if p_doc_type not in ('auftrag', 'angebot', 'rechnung') then
    raise exception 'Unbekannte Belegart %', p_doc_type;
  end if;

  for r in select * from jsonb_array_elements(p_rows) loop
    begin
      v_ext := nullif(trim(r ->> 'ext_id'), '');
      if v_ext is null then
        raise exception 'ext_id fehlt';
      end if;
      v_number := left(coalesce(trim(r ->> 'number'), ''), 50);
      v_kind := left(coalesce(trim(r ->> 'kind'), ''), 100);
      v_title := left(coalesce(trim(r ->> 'title'), ''), 300);
      v_date := nullif(left(trim(coalesce(r ->> 'doc_date', '')), 10), '')::date;
      v_delivery := nullif(left(trim(coalesce(r ->> 'delivery_date', '')), 10), '')::date;
      v_status := left(coalesce(trim(r ->> 'status'), ''), 100);
      v_amount := nullif(replace(trim(coalesce(r ->> 'amount_net', '')), ',', '.'), '')::numeric;
      v_notes := coalesce(trim(r ->> 'notes'), '');
      v_cust_ext := nullif(trim(r ->> 'customer_ext_id'), '');
      v_proj_ext := nullif(trim(r ->> 'project_ext_id'), '');

      v_proj := null;
      if v_proj_ext is not null then
        select * into v_proj from public.projects where ext_id = v_proj_ext;
      end if;
      v_cust_id := null;
      if v_cust_ext is not null then
        select id into v_cust_id from public.customers where ext_id = v_cust_ext;
      end if;
      v_cust_id := coalesce(v_cust_id, v_proj.ext_customer_id);
      if v_proj.id is null then v_no_project := v_no_project + 1; end if;
      if v_cust_id is null then v_no_customer := v_no_customer + 1; end if;

      select * into v_old from public.erp_documents where doc_type = p_doc_type and ext_id = v_ext;
      if found then
        if v_old.doc_number = v_number and v_old.doc_kind = v_kind and v_old.title = v_title and v_old.doc_date is not distinct from v_date
           and v_old.delivery_date is not distinct from v_delivery and v_old.status = v_status
           and v_old.amount_net is not distinct from v_amount and v_old.notes = v_notes
           and v_old.customer_ext_id is not distinct from v_cust_ext and v_old.project_ext_id is not distinct from v_proj_ext
           and v_old.customer_id is not distinct from v_cust_id and v_old.project_id is not distinct from v_proj.id then
          v_same := v_same + 1;
          continue;
        end if;
        v_updated := v_updated + 1;
      else
        v_new := v_new + 1;
        if jsonb_array_length(v_preview) < 2000 then
          v_preview := v_preview || jsonb_build_object(
            'nummer_3e', v_number, 'art', v_kind, 'bezeichnung_3e', v_title, 'datum', v_date, 'status', v_status, 'netto', v_amount,
            'kundennummer_3e', v_cust_ext,
            'kunde', coalesce((select name from public.customers where id = v_cust_id), '(Kunde nicht in der App)'),
            'projekt_3e', v_proj_ext, 'bauvorhaben', coalesce(v_proj.project_number || ' ' || v_proj.name, '(Bauvorhaben nicht in der App)'));
        end if;
      end if;

      if p_dry_run then
        continue;
      end if;

      insert into public.erp_documents as d (doc_type, ext_id, doc_number, doc_kind, title, doc_date, delivery_date, status, amount_net,
                                             notes, customer_ext_id, project_ext_id, customer_id, project_id, synced_at)
      values (p_doc_type, v_ext, v_number, v_kind, v_title, v_date, v_delivery, v_status, v_amount,
              v_notes, v_cust_ext, v_proj_ext, v_cust_id, v_proj.id, now())
      on conflict (doc_type, ext_id) do update set
        doc_number = excluded.doc_number, doc_kind = excluded.doc_kind, title = excluded.title, doc_date = excluded.doc_date,
        delivery_date = excluded.delivery_date, status = excluded.status, amount_net = excluded.amount_net,
        notes = excluded.notes, customer_ext_id = excluded.customer_ext_id, project_ext_id = excluded.project_ext_id,
        customer_id = excluded.customer_id, project_id = excluded.project_id, synced_at = now();
    exception when others then
      v_skipped := v_skipped + 1;
      if jsonb_array_length(v_errors) < 50 then
        v_errors := v_errors || jsonb_build_object('ext_id', v_ext, 'nummer', v_number, 'error', sqlerrm);
      end if;
    end;
  end loop;

  return jsonb_build_object(
    'probelauf', p_dry_run, 'neu', v_new, 'verknuepft', 0, 'aktualisiert', v_updated,
    'unveraendert', v_same, 'uebersprungen', v_skipped, 'ohne_kunde', v_no_customer, 'ohne_bauvorhaben', v_no_project,
    'vorschau', v_preview, 'fehler', v_errors);
end;
$$;

revoke all on function public.import_3e_documents(jsonb, text, boolean) from public, anon, authenticated;
grant execute on function public.import_3e_documents(jsonb, text, boolean) to service_role;
