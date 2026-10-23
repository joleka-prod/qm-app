-- Ticketarten, Monteure und Einsatzplanung.
--
-- Ticketarten: qm (bisheriger Ablauf mit Teamleiter, Ursache, Maßnahme)
--              restarbeit, beanstandung, reparatur ("Einsätze")
-- Einsatz-Ablauf: neu (ungeplant) -> zugewiesen (geplant: Monteur + Datum) -> abgeschlossen (erledigt)
-- Planen dürfen QM/Admin und Teamleiter; der Monteur schreibt den Arbeitsbericht und meldet erledigt.
--
-- Hinweis: Die neue Rolle 'monteur' wird hier nur als Text verglichen (role::text),
-- damit das Skript in einer einzigen Transaktion laufen kann.

alter type public.user_role add value if not exists 'monteur';

create type public.ticket_type as enum ('qm', 'restarbeit', 'beanstandung', 'reparatur');

alter table public.tickets
  add column ticket_type public.ticket_type not null default 'qm',
  add column installer_id uuid references public.profiles (id),
  add column montage_date date,
  add column montage_time time,
  add column customer_name text not null default '',
  add column site_address text not null default '',
  add column work_report text not null default '';

create index tickets_installer_date_idx on public.tickets (installer_id, montage_date);
create index tickets_montage_date_idx on public.tickets (montage_date);
create index tickets_type_idx on public.tickets (ticket_type);

-- Wer darf ein Ticket sehen?
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
        or t.installer_id = auth.uid()
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
    or installer_id = auth.uid()
  );

drop policy "Tickets ändern" on public.tickets;
create policy "Tickets ändern"
  on public.tickets for update to authenticated
  using (
    public.is_admin()
    or assigned_to = auth.uid()
    or installer_id = auth.uid()
    or (public.my_role() = 'teamleiter' and ticket_type <> 'qm')
    or (created_by = auth.uid() and status = 'neu')
  )
  with check (true);

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
  if new.installer_id is not null
     and not exists (select 1 from public.profiles
                     where id = new.installer_id and role::text = 'monteur' and active) then
    raise exception 'Bitte einen aktiven Monteur auswählen';
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
        new.installer_id := null;
        new.montage_date := null;
        new.montage_time := null;
      end if;
      new.status := case when new.installer_id is not null and new.montage_date is not null
                         then 'zugewiesen' else 'neu' end;
    else
      new.installer_id := null;
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
    elsif old.installer_id = auth.uid() then
      -- Monteur: Arbeitsbericht schreiben und erledigt melden
      if old.status = 'abgeschlossen' then
        raise exception 'Einsatz ist bereits erledigt';
      end if;
      if new.installer_id is distinct from old.installer_id
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
         or new.installer_id is distinct from old.installer_id
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
      new.status := case when new.installer_id is not null and new.montage_date is not null
                         then 'zugewiesen' else 'neu' end;
    end if;
  else
    -- QM-Tickets: bisheriger Ablauf
    new.installer_id := null;
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

-- Planung und Arbeitsbericht im Verlauf festhalten.
create function public.log_ticket_planning()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    if new.installer_id is not null then
      select full_name into v_name from public.profiles where id = new.installer_id;
      insert into public.ticket_events (ticket_id, actor, kind, details)
      values (new.id, auth.uid(), 'eingeplant',
              concat_ws(', ', v_name, to_char(new.montage_date, 'DD.MM.YYYY'), to_char(new.montage_time, 'HH24:MI')));
    end if;
    return new;
  end if;
  if new.installer_id is distinct from old.installer_id
     or new.montage_date is distinct from old.montage_date
     or new.montage_time is distinct from old.montage_time then
    select full_name into v_name from public.profiles where id = new.installer_id;
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

create trigger tickets_log_planning
  after insert or update on public.tickets
  for each row execute function public.log_ticket_planning();
