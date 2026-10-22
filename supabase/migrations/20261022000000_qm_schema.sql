-- QM-Ticket-App: Schema, Rechte und Abläufe
--
-- Rollen:      mitarbeiter, teamleiter, admin
-- Ticketablauf: neu -> zugewiesen -> in_bearbeitung -> zur_pruefung -> abgeschlossen
--               (zur_pruefung kann vom Admin zurück auf in_bearbeitung gesetzt werden)

create type public.user_role as enum ('mitarbeiter', 'teamleiter', 'admin');
create type public.ticket_status as enum ('neu', 'zugewiesen', 'in_bearbeitung', 'zur_pruefung', 'abgeschlossen');

-- ---------------------------------------------------------------------------
-- Profile
-- ---------------------------------------------------------------------------

create table public.profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  email text not null,
  full_name text not null default '',
  role public.user_role not null default 'mitarbeiter',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

-- Legt für jeden neuen Login ein Profil an. Der allererste Nutzer wird Admin.
create function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, email, full_name, role)
  values (
    new.id,
    coalesce(new.email, ''),
    coalesce(new.raw_user_meta_data ->> 'full_name', ''),
    case when exists (select 1 from public.profiles) then 'mitarbeiter'::public.user_role
         else 'admin'::public.user_role end
  );
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create function public.my_role()
returns public.user_role
language sql
stable
security definer
set search_path = ''
as $$
  select role from public.profiles where id = auth.uid() and active
$$;

create function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select coalesce(public.my_role() = 'admin', false)
$$;

-- Nutzer dürfen nur ihren Namen ändern; Rolle und Aktiv-Status nur Admins.
create function public.profiles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if auth.uid() is null or public.is_admin() then
    return new;
  end if;
  if new.role is distinct from old.role
     or new.active is distinct from old.active
     or new.email is distinct from old.email then
    raise exception 'Nur Admins dürfen Rolle oder Status ändern';
  end if;
  return new;
end;
$$;

create trigger profiles_guard
  before update on public.profiles
  for each row execute function public.profiles_guard();

alter table public.profiles enable row level security;

create policy "Angemeldete sehen alle Profile"
  on public.profiles for select to authenticated
  using (true);

create policy "Eigenes Profil oder Admin ändern"
  on public.profiles for update to authenticated
  using (id = auth.uid() or public.is_admin())
  with check (id = auth.uid() or public.is_admin());

-- ---------------------------------------------------------------------------
-- Tickets
-- ---------------------------------------------------------------------------

create table public.tickets (
  id bigint generated always as identity primary key,
  title text not null check (length(trim(title)) > 0),
  description text not null default '',
  status public.ticket_status not null default 'neu',
  created_by uuid not null default auth.uid() references public.profiles (id),
  assigned_to uuid references public.profiles (id),
  cause text not null default '',
  corrective_action text not null default '',
  review_note text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  closed_at timestamptz
);

create index tickets_status_idx on public.tickets (status);
create index tickets_assigned_to_idx on public.tickets (assigned_to);
create index tickets_created_by_idx on public.tickets (created_by);

create function public.can_view_ticket(p_ticket_id bigint)
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
      )
  )
$$;

-- Prüft bei jeder Änderung, wer was ändern darf, und setzt den Status passend.
create function public.tickets_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  v_role public.user_role := public.my_role();
begin
  if new.assigned_to is not null
     and not exists (select 1 from public.profiles
                     where id = new.assigned_to and role in ('teamleiter', 'admin') and active) then
    raise exception 'Verantwortlicher muss ein aktiver Teamleiter sein';
  end if;

  if tg_op = 'INSERT' then
    if auth.uid() is not null then
      new.created_by := auth.uid();
    end if;
    new.cause := '';
    new.corrective_action := '';
    new.review_note := '';
    new.closed_at := null;
    new.status := case when new.assigned_to is null then 'neu' else 'zugewiesen' end;
    return new;
  end if;

  new.updated_at := now();
  new.id := old.id;
  new.created_by := old.created_by;
  new.created_at := old.created_at;

  if auth.uid() is null or v_role = 'admin' then
    -- Admin: darf alles; Status folgt der Zuweisung, wenn er nicht bewusst gesetzt wird.
    if new.assigned_to is distinct from old.assigned_to and new.status = old.status then
      if new.assigned_to is null then
        new.status := 'neu';
      elsif old.status = 'neu' then
        new.status := 'zugewiesen';
      end if;
    end if;
  elsif old.assigned_to = auth.uid() then
    -- Verantwortlicher Teamleiter: nur Ursache, Maßnahme und Status-Fortschritt.
    if new.title is distinct from old.title
       or new.description is distinct from old.description
       or new.assigned_to is distinct from old.assigned_to
       or new.review_note is distinct from old.review_note then
      raise exception 'Teamleiter dürfen nur Ursache und Maßnahme bearbeiten';
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
    -- Ersteller: darf sein Ticket korrigieren, solange es noch nicht zugewiesen ist.
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

  new.closed_at := case when new.status = 'abgeschlossen' then coalesce(old.closed_at, now()) end;
  return new;
end;
$$;

create trigger tickets_guard
  before insert or update on public.tickets
  for each row execute function public.tickets_guard();

alter table public.tickets enable row level security;

create policy "Tickets sehen"
  on public.tickets for select to authenticated
  using (
    public.my_role() in ('admin', 'teamleiter')
    or created_by = auth.uid()
    or assigned_to = auth.uid()
  );

create policy "Tickets anlegen"
  on public.tickets for insert to authenticated
  with check (public.my_role() is not null);

create policy "Tickets ändern"
  on public.tickets for update to authenticated
  using (public.is_admin() or assigned_to = auth.uid() or (created_by = auth.uid() and status = 'neu'))
  with check (true);

create policy "Tickets löschen (Admin)"
  on public.tickets for delete to authenticated
  using (public.is_admin());

-- ---------------------------------------------------------------------------
-- Verlauf
-- ---------------------------------------------------------------------------

create table public.ticket_events (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  actor uuid references public.profiles (id),
  kind text not null,
  details text not null default '',
  created_at timestamptz not null default now()
);

create index ticket_events_ticket_idx on public.ticket_events (ticket_id, created_at);

create function public.log_ticket_event()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_name text;
begin
  if tg_op = 'INSERT' then
    insert into public.ticket_events (ticket_id, actor, kind) values (new.id, auth.uid(), 'erstellt');
    if new.assigned_to is not null then
      select full_name into v_name from public.profiles where id = new.assigned_to;
      insert into public.ticket_events (ticket_id, actor, kind, details)
      values (new.id, auth.uid(), 'zugewiesen', coalesce(v_name, ''));
    end if;
    return new;
  end if;

  if new.assigned_to is distinct from old.assigned_to then
    select full_name into v_name from public.profiles where id = new.assigned_to;
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'zugewiesen', coalesce(v_name, ''));
  end if;
  if new.cause is distinct from old.cause then
    insert into public.ticket_events (ticket_id, actor, kind) values (new.id, auth.uid(), 'ursache');
  end if;
  if new.corrective_action is distinct from old.corrective_action then
    insert into public.ticket_events (ticket_id, actor, kind) values (new.id, auth.uid(), 'massnahme');
  end if;
  if new.status is distinct from old.status then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'status', new.status::text);
  end if;
  if new.review_note is distinct from old.review_note and length(trim(new.review_note)) > 0 then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'pruefhinweis', new.review_note);
  end if;
  return new;
end;
$$;

create trigger tickets_log
  after insert or update on public.tickets
  for each row execute function public.log_ticket_event();

alter table public.ticket_events enable row level security;

create policy "Verlauf sehen"
  on public.ticket_events for select to authenticated
  using (public.can_view_ticket(ticket_id));

-- ---------------------------------------------------------------------------
-- Fotos
-- ---------------------------------------------------------------------------

create table public.ticket_photos (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  storage_path text not null unique,
  uploaded_by uuid not null default auth.uid() references public.profiles (id),
  created_at timestamptz not null default now()
);

create index ticket_photos_ticket_idx on public.ticket_photos (ticket_id);

alter table public.ticket_photos enable row level security;

create policy "Fotos sehen"
  on public.ticket_photos for select to authenticated
  using (public.can_view_ticket(ticket_id));

create policy "Fotos hinzufügen"
  on public.ticket_photos for insert to authenticated
  with check (uploaded_by = auth.uid() and public.can_view_ticket(ticket_id));

create policy "Fotos löschen"
  on public.ticket_photos for delete to authenticated
  using (uploaded_by = auth.uid() or public.is_admin());

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('ticket-photos', 'ticket-photos', false, 10485760, array['image/jpeg', 'image/png', 'image/webp']);

-- Dateipfad: <ticket_id>/<zufallsname>.jpg
create policy "Fotodateien sehen"
  on storage.objects for select to authenticated
  using (bucket_id = 'ticket-photos'
         and public.can_view_ticket(((storage.foldername(name))[1])::bigint));

create policy "Fotodateien hochladen"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'ticket-photos'
              and public.can_view_ticket(((storage.foldername(name))[1])::bigint));

create policy "Fotodateien löschen"
  on storage.objects for delete to authenticated
  using (bucket_id = 'ticket-photos'
         and (owner_id = auth.uid()::text or public.is_admin()));
