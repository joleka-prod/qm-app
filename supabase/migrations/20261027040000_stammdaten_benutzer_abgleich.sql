-- Personalakte ist die einzige Stelle für Name, Urlaubsanspruch und Status (Fabian, 2026-10-27).
-- Der verknüpfte App-Benutzer wird automatisch angeglichen: Name = Vorname + Nachname,
-- Urlaubsanspruch aus den Stammdaten, Status "nicht aktiv" sperrt den Zugang (Langzeitkrank nicht).

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
  -- Abgleich aus der Personalakte (Name, Urlaubsanspruch, Zugang) darf auch die Personalabteilung auslösen
  if auth.uid() is null or current_setting('app.employee_sync', true) = '1' then
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
  if new.vacation_days is distinct from old.vacation_days then
    raise exception 'Nur Admins dürfen den Urlaubsanspruch ändern';
  end if;
  return new;
end;
$$;

create or replace function public.employees_sync_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text := trim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
begin
  if new.user_id is null then
    return new;
  end if;
  perform set_config('app.employee_sync', '1', true);
  update public.profiles p set
    full_name = case when v_name <> '' then v_name else p.full_name end,
    vacation_days = coalesce(new.vacation_days, p.vacation_days),
    -- den eigenen Zugang sperrt man sich nicht selbst
    active = case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end
  where p.id = new.user_id
    and (p.full_name is distinct from case when v_name <> '' then v_name else p.full_name end
         or p.vacation_days is distinct from coalesce(new.vacation_days, p.vacation_days)
         or p.active is distinct from case when p.id = auth.uid() then p.active else new.status <> 'nicht aktiv' end);
  perform set_config('app.employee_sync', '', true);
  return new;
end;
$$;

drop trigger if exists employees_sync_user on public.employees;
create trigger employees_sync_user
  after insert or update of first_name, last_name, vacation_days, status, user_id on public.employees
  for each row execute function public.employees_sync_user();

-- einmal alle vorhandenen Verknüpfungen angleichen
update public.employees set user_id = user_id where user_id is not null;
