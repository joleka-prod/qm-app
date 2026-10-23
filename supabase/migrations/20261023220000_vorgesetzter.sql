-- Verantwortlicher Vorgesetzter je Benutzer. Pflegt nur der Admin in der Benutzerverwaltung.
-- Vorgesetzte sehen die Zeiterfassung ihrer Mitarbeiter (Grundlage für spätere Freigaben, Urlaub usw.).

alter table public.profiles
  add column supervisor_id uuid references public.profiles (id) on delete set null,
  add constraint profiles_supervisor_not_self check (supervisor_id is distinct from id);

create index profiles_supervisor_idx on public.profiles (supervisor_id);

-- Ist der angemeldete Benutzer Vorgesetzter (auch über mehrere Ebenen) von p_user?
create or replace function public.is_supervisor_of(p_user uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  with recursive chain as (
    select supervisor_id, 1 as depth from public.profiles where id = p_user
    union all
    select p.supervisor_id, c.depth + 1 from public.profiles p join chain c on p.id = c.supervisor_id
    where c.depth < 10
  )
  select auth.uid() is not null and exists (select 1 from chain where supervisor_id = auth.uid());
$$;

revoke execute on function public.is_supervisor_of(uuid) from public, anon;
grant execute on function public.is_supervisor_of(uuid) to authenticated;

create or replace function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_up uuid;
  v_depth int := 0;
begin
  -- Keine Kreise: der Vorgesetzte darf nicht selbst (indirekt) unter dieser Person stehen
  if new.supervisor_id is not null and new.supervisor_id is distinct from old.supervisor_id then
    v_up := new.supervisor_id;
    while v_up is not null and v_depth < 20 loop
      if v_up = new.id then
        raise exception 'Diese Person steht bereits unter dem gewählten Vorgesetzten (Kreis)';
      end if;
      select supervisor_id into v_up from public.profiles where id = v_up;
      v_depth := v_depth + 1;
    end loop;
  end if;
  if auth.uid() is null then
    return new;
  end if;
  new.full_name := trim(new.full_name);
  if new.email is distinct from old.email then
    raise exception 'Die E-Mail-Adresse kann nur über die Benutzerverwaltung geändert werden';
  end if;
  if public.is_admin() then
    if new.id = auth.uid() and (new.role is distinct from old.role or not new.active) then
      raise exception 'Die eigene Rolle und den eigenen Zugang kannst du nicht ändern';
    end if;
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active then
    raise exception 'Nur Admins dürfen Rolle oder Status ändern';
  end if;
  if new.supervisor_id is distinct from old.supervisor_id then
    raise exception 'Nur Admins dürfen den Vorgesetzten ändern';
  end if;
  return new;
end;
$$;

-- Vorgesetzte sehen Stempel- und Auftragszeiten ihrer Mitarbeiter
drop policy "Stempelzeiten sehen" on public.attendance;
create policy "Stempelzeiten sehen"
  on public.attendance for select to authenticated
  using (installer_id = auth.uid() or public.my_role() in ('admin', 'teamleiter') or public.is_supervisor_of(installer_id));

drop policy "Zeiten sehen" on public.time_entries;
create policy "Zeiten sehen"
  on public.time_entries for select to authenticated
  using (installer_id = auth.uid() or public.can_view_ticket(ticket_id) or public.is_supervisor_of(installer_id));
