-- Teams: 10 Montageteams und 3 Kundendienstteams. Jedes Team wird pro Tag mit 1 bis 3 Monteuren besetzt.
-- Einsätze werden einem Team und einem Tag zugeordnet; die Monteure, die an dem Tag im Team sind, sehen
-- und bearbeiten den Einsatz. Bisher direkt eingeplante Monteure werden automatisch in Teams übernommen.

create table public.teams (
  id smallint generated always as identity primary key,
  name text not null unique,
  area public.service_area not null,
  sort integer not null default 0,
  active boolean not null default true
);

insert into public.teams (name, area, sort)
select 'Montage ' || n, 'montage'::public.service_area, n from generate_series(1, 10) n
union all
select 'Kundendienst ' || n, 'kundendienst'::public.service_area, 100 + n from generate_series(1, 3) n;

create table public.team_members (
  team_id smallint not null references public.teams (id) on delete cascade,
  day date not null,
  installer_id uuid not null references public.profiles (id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (team_id, day, installer_id),
  -- ein Monteur ist an einem Tag nur in einem Team
  unique (day, installer_id)
);

create index team_members_installer_idx on public.team_members (installer_id, day);

alter table public.tickets add column team_id smallint references public.teams (id);
create index tickets_team_date_idx on public.tickets (team_id, montage_date);

-- Ist der angemeldete Monteur an diesem Tag in diesem Team?
create function public.is_on_team(p_team_id smallint, p_day date)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_members m
    where m.team_id = p_team_id and m.day = p_day and m.installer_id = auth.uid()
  )
$$;

create function public.team_members_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not exists (select 1 from public.profiles where id = new.installer_id and role::text = 'monteur' and active) then
    raise exception 'Bitte einen aktiven Monteur auswählen';
  end if;
  if (select count(*) from public.team_members
      where team_id = new.team_id and day = new.day and installer_id <> new.installer_id) >= 3 then
    raise exception 'Ein Team hat höchstens 3 Monteure pro Tag';
  end if;
  return new;
end;
$$;

create trigger team_members_guard
  before insert or update on public.team_members
  for each row execute function public.team_members_guard();

alter table public.teams enable row level security;
alter table public.team_members enable row level security;

create policy "Teams sehen" on public.teams for select to authenticated using (true);
create policy "Teams verwalten" on public.teams for all to authenticated
  using (public.is_admin()) with check (public.is_admin());

create policy "Besetzung sehen" on public.team_members for select to authenticated using (true);
create policy "Besetzung planen" on public.team_members for all to authenticated
  using (public.my_role() in ('admin', 'teamleiter'))
  with check (public.my_role() in ('admin', 'teamleiter'));

-- ---------------------------------------------------------------- Bestehende Planung übernehmen
-- Jeder bisher eingeplante Monteur kommt an seinem Tag in ein freies Team des passenden Bereichs.
do $$
declare
  r record;
  v_team smallint;
begin
  for r in
    select distinct t.installer_id, t.montage_date, coalesce(t.service_area, 'montage') as area
    from public.tickets t
    where t.installer_id is not null and t.montage_date is not null
    order by t.montage_date, t.installer_id
  loop
    select m.team_id into v_team from public.team_members m
     where m.installer_id = r.installer_id and m.day = r.montage_date;
    if v_team is null then
      select tm.id into v_team from public.teams tm
       where tm.area = r.area
         and not exists (select 1 from public.team_members m where m.team_id = tm.id and m.day = r.montage_date)
       order by tm.sort limit 1;
      if v_team is null then
        select tm.id into v_team from public.teams tm
         where not exists (select 1 from public.team_members m where m.team_id = tm.id and m.day = r.montage_date)
         order by tm.sort limit 1;
      end if;
      if v_team is null then
        continue;
      end if;
      insert into public.team_members (team_id, day, installer_id) values (v_team, r.montage_date, r.installer_id);
    end if;
    update public.tickets set team_id = v_team
     where installer_id = r.installer_id and montage_date = r.montage_date;
  end loop;
end;
$$;

-- ---------------------------------------------------------------- Sichtbarkeit und Rechte
create or replace function public.can_view_ticket(p_ticket_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id
      and (
        public.my_role() in ('admin', 'teamleiter')
        or t.created_by = auth.uid()
        or t.assigned_to = auth.uid()
        or public.is_on_team(t.team_id, t.montage_date)
      )
  )
$$;

drop policy "Tickets sehen" on public.tickets;
create policy "Tickets sehen"
  on public.tickets for select to authenticated
  using (
    public.my_role() in ('admin', 'teamleiter')
    or created_by = auth.uid()
    or assigned_to = auth.uid()
    or public.is_on_team(team_id, montage_date)
  );

drop policy "Tickets ändern" on public.tickets;
create policy "Tickets ändern"
  on public.tickets for update to authenticated
  using (
    public.is_admin()
    or assigned_to = auth.uid()
    or public.is_on_team(team_id, montage_date)
    or (public.my_role() = 'teamleiter' and ticket_type <> 'qm')
    or (created_by = auth.uid() and status = 'neu')
  )
  with check (true);

create or replace function public.is_installer_of(p_ticket_id bigint)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id and t.status <> 'abgeschlossen' and public.is_on_team(t.team_id, t.montage_date)
  )
$$;

-- ---------------------------------------------------------------- Feldschutz
create or replace function public.tickets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.user_role := public.my_role();
  v_is_admin boolean := auth.uid() is null or v_role = 'admin';
  v_is_planner boolean := auth.uid() is null or v_role in ('admin', 'teamleiter');
  v_einsatz boolean := new.ticket_type <> 'qm';
begin
  new.order_number := trim(new.order_number);
  new.position_number := trim(new.position_number);
  new.customer_name := trim(new.customer_name);
  new.site_address := trim(new.site_address);

  if new.assigned_to is not null
     and not exists (select 1 from public.profiles
                     where id = new.assigned_to and role in ('teamleiter', 'admin') and active) then
    raise exception 'Verantwortlicher muss ein aktiver Teamleiter sein';
  end if;
  -- Eingeplant wird ein Team, nicht mehr ein einzelner Monteur
  new.installer_id := null;
  if new.team_id is not null and (tg_op = 'INSERT' or new.team_id is distinct from old.team_id)
     and not exists (select 1 from public.teams where id = new.team_id and active) then
    raise exception 'Bitte ein aktives Team auswählen';
  end if;

  -- ---------------------------------------------------------------- Anlegen
  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.cause := '';
    new.corrective_action := '';
    new.review_note := '';
    new.work_report := '';
    new.closed_at := null;
    if v_einsatz then
      new.assigned_to := null;
      if not v_is_planner then
        new.team_id := null;
        new.montage_date := null;
        new.montage_time := null;
      end if;
      new.status := case when new.team_id is not null and new.montage_date is not null
                         then 'zugewiesen' else 'neu' end;
    else
      new.team_id := null;
      new.montage_date := null;
      new.montage_time := null;
      new.status := case when new.assigned_to is null then 'neu' else 'zugewiesen' end;
    end if;
    return new;
  end if;

  -- ---------------------------------------------------------------- Ändern
  new.updated_at := now();
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;
  if not v_is_admin then
    new.ticket_type := old.ticket_type;
    v_einsatz := new.ticket_type <> 'qm';
  end if;

  if v_einsatz then
    -- Einsätze (Restarbeit, Beanstandung, Reparatur)
    if v_is_admin then
      null;
    elsif v_role = 'teamleiter' then
      -- Teamleiter planen: Monteur, Termin, Kunde, Ort, Auftrag, Beschreibung
      if new.status is distinct from old.status
         or new.work_report is distinct from old.work_report then
        raise exception 'Teamleiter dürfen Einsätze planen, aber nicht als erledigt melden';
      end if;
    elsif public.is_on_team(old.team_id, old.montage_date) then
      -- Monteur: Arbeitsbericht schreiben und erledigt melden
      if old.status = 'abgeschlossen' then
        raise exception 'Einsatz ist bereits erledigt';
      end if;
      if new.team_id is distinct from old.team_id
         or new.montage_date is distinct from old.montage_date
         or new.montage_time is distinct from old.montage_time
         or new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.customer_name is distinct from old.customer_name
         or new.site_address is distinct from old.site_address
         or new.order_number is distinct from old.order_number
         or new.position_number is distinct from old.position_number then
        raise exception 'Monteure dürfen nur den Arbeitsbericht bearbeiten';
      end if;
      if new.status is distinct from old.status and new.status <> 'abgeschlossen' then
        raise exception 'Statuswechsel nicht erlaubt';
      end if;
    elsif old.created_by = auth.uid() and old.status = 'neu' then
      if new.status is distinct from old.status
         or new.team_id is distinct from old.team_id
         or new.montage_date is distinct from old.montage_date
         or new.montage_time is distinct from old.montage_time
         or new.work_report is distinct from old.work_report then
        raise exception 'Keine Berechtigung';
      end if;
    else
      raise exception 'Keine Berechtigung';
    end if;

    new.assigned_to := null;
    new.cause := old.cause;
    new.corrective_action := old.corrective_action;
    if new.status = 'abgeschlossen' and old.status <> 'abgeschlossen'
       and length(trim(new.work_report)) = 0 then
      raise exception 'Bitte zuerst den Arbeitsbericht ausfüllen';
    end if;
    -- Status folgt der Planung, solange der Einsatz nicht erledigt ist
    if new.status <> 'abgeschlossen' then
      new.status := case when new.team_id is not null and new.montage_date is not null
                         then 'zugewiesen' else 'neu' end;
    end if;
  else
    -- QM-Tickets: bisheriger Ablauf
    new.team_id := null;
    new.montage_date := null;
    new.montage_time := null;
    if v_is_admin then
      if new.assigned_to is distinct from old.assigned_to and new.status = old.status then
        if new.assigned_to is null then
          new.status := 'neu';
        elsif old.status = 'neu' then
          new.status := 'zugewiesen';
        end if;
      end if;
    elsif old.assigned_to = auth.uid() then
      if new.title is distinct from old.title
         or new.description is distinct from old.description
         or new.assigned_to is distinct from old.assigned_to
         or new.review_note is distinct from old.review_note then
        raise exception 'Teamleiter dürfen nur Ursache, Maßnahme, Auftrags- und Positionsnummer bearbeiten';
      end if;
      if old.status = 'abgeschlossen' then
        raise exception 'Ticket ist bereits abgeschlossen';
      end if;
      if new.status is distinct from old.status
         and not (new.status = 'in_bearbeitung' and old.status in ('zugewiesen', 'zur_pruefung'))
         and not (new.status = 'zur_pruefung' and old.status in ('zugewiesen', 'in_bearbeitung')) then
        raise exception 'Statuswechsel nicht erlaubt';
      end if;
      if new.status = old.status and old.status = 'zugewiesen'
         and (new.cause is distinct from old.cause or new.corrective_action is distinct from old.corrective_action) then
        new.status := 'in_bearbeitung';
      end if;
    elsif old.created_by = auth.uid() and old.status = 'neu' then
      if new.status is distinct from old.status
         or new.assigned_to is distinct from old.assigned_to
         or new.cause is distinct from old.cause
         or new.corrective_action is distinct from old.corrective_action
         or new.review_note is distinct from old.review_note then
        raise exception 'Keine Berechtigung';
      end if;
    else
      raise exception 'Keine Berechtigung';
    end if;

    if new.status = 'zur_pruefung' and old.status <> 'zur_pruefung'
       and (length(trim(new.cause)) = 0 or length(trim(new.corrective_action)) = 0) then
      raise exception 'Ursache und Maßnahme müssen ausgefüllt sein';
    end if;
    if new.status in ('zugewiesen', 'in_bearbeitung', 'zur_pruefung') and new.assigned_to is null then
      raise exception 'Ticket braucht einen verantwortlichen Teamleiter';
    end if;
  end if;

  new.closed_at := case when new.status = 'abgeschlossen' then coalesce(old.closed_at, now()) end;
  return new;
end;
$$;


-- Planung im Verlauf: Team statt Monteur
create or replace function public.log_ticket_planning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    if new.team_id is not null then
      select name into v_name from public.teams where id = new.team_id;
      insert into public.ticket_events (ticket_id, actor, kind, details)
      values (new.id, auth.uid(), 'eingeplant',
              concat_ws(', ', v_name, to_char(new.montage_date, 'DD.MM.YYYY'), to_char(new.montage_time, 'HH24:MI')));
    end if;
    return new;
  end if;
  if new.team_id is distinct from old.team_id
     or new.montage_date is distinct from old.montage_date
     or new.montage_time is distinct from old.montage_time then
    select name into v_name from public.teams where id = new.team_id;
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'eingeplant',
            coalesce(nullif(concat_ws(', ', v_name, to_char(new.montage_date, 'DD.MM.YYYY'),
                                      to_char(new.montage_time, 'HH24:MI')), ''), 'Planung entfernt'));
  end if;
  if new.work_report is distinct from old.work_report then
    insert into public.ticket_events (ticket_id, actor, kind) values (new.id, auth.uid(), 'bericht');
  end if;
  return new;
end;
$$;

-- Bisherige Einzelzuordnung ist übernommen
update public.tickets set installer_id = null where installer_id is not null;
