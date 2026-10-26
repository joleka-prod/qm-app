-- Personalakte: verknüpfte Ninox-Tabellen (Fabian, 2026-10-26). Je Mitarbeiter die Einträge der
-- Untertabellen (Lohn, Kinder, Schulungen, Krankheitstage, …) als { "Tabelle": [ {Feld: Wert}, … ] }.

alter table public.personnel_files add column if not exists related jsonb not null default '{}'::jsonb;

-- Verlauf: die übernommenen Untertabellen nicht Feld für Feld protokollieren
create or replace function public.personnel_files_track()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_new jsonb := to_jsonb(new) - 'updated_at' - 'updated_by' - 'source' - 'related';
  v_old jsonb := case when tg_op = 'UPDATE' then to_jsonb(old) - 'updated_at' - 'updated_by' - 'source' - 'related' else '{}'::jsonb end;
  v_changes jsonb := '{}'::jsonb;
  k text;
begin
  new.updated_at := now();
  new.updated_by := auth.uid();
  -- upsert auf eine vorhandene Akte: protokolliert wird erst das folgende UPDATE
  if tg_op = 'INSERT' and exists (select 1 from public.personnel_files f where f.user_id = new.user_id) then
    return new;
  end if;
  for k in select jsonb_object_keys(v_new) loop
    if k <> 'user_id' and (v_new -> k) is distinct from (v_old -> k)
       and not (tg_op = 'INSERT' and (v_new -> k) in ('""'::jsonb, 'null'::jsonb, '{}'::jsonb)) then
      v_changes := v_changes || jsonb_build_object(k, jsonb_build_object('alt', v_old -> k, 'neu', v_new -> k));
    end if;
  end loop;
  if tg_op = 'UPDATE' and new.related is distinct from old.related then
    v_changes := v_changes || jsonb_build_object('related', jsonb_build_object('alt', null, 'neu', 'aus Ninox übernommen'));
  end if;
  if v_changes <> '{}'::jsonb then
    insert into public.personnel_log (user_id, actor, kind, changes)
    values (new.user_id, auth.uid(), case when tg_op = 'INSERT' then 'angelegt' else 'geändert' end, v_changes);
  end if;
  return new;
end;
$$;
