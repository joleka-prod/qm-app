-- Zeiterfassung pro Auftrag: Monteure starten und stoppen Fahrt- und Arbeitszeit im
-- Einsatz. Pro Monteur läuft höchstens eine Zeit; ein neuer Start beendet die laufende.
-- QM und Teamleiter können Zeiten korrigieren, löschen kann nur der Admin.

create type public.time_kind as enum ('fahrt', 'arbeit');

create table public.time_entries (
  id bigint generated always as identity primary key,
  ticket_id bigint not null references public.tickets (id) on delete cascade,
  installer_id uuid not null references public.profiles (id),
  kind public.time_kind not null,
  started_at timestamptz not null default now(),
  ended_at timestamptz,
  note text not null default '' check (length(note) <= 300),
  edited_by uuid references public.profiles (id) on delete set null,
  created_at timestamptz not null default now(),
  check (ended_at is null or ended_at >= started_at)
);

create index time_entries_ticket_idx on public.time_entries (ticket_id, started_at);
create unique index time_entries_one_running on public.time_entries (installer_id) where ended_at is null;

alter table public.time_entries enable row level security;

create policy "Zeiten sehen"
  on public.time_entries for select to authenticated
  using (installer_id = auth.uid() or public.can_view_ticket(ticket_id));

-- Korrekturen nur durch Planer; Monteure arbeiten über start_time_entry / stop_time_entry
create policy "Planer korrigieren Zeiten"
  on public.time_entries for update to authenticated
  using (public.my_role() in ('admin', 'teamleiter'))
  with check (public.my_role() in ('admin', 'teamleiter'));

create policy "Admin löscht Zeiten"
  on public.time_entries for delete to authenticated
  using (public.is_admin());

create or replace function public.time_entries_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.note := trim(new.note);
  if tg_op = 'UPDATE' then
    new.ticket_id := old.ticket_id;
    new.installer_id := old.installer_id;
    new.created_at := old.created_at;
    if auth.uid() is not null
       and (new.started_at is distinct from old.started_at
            or new.ended_at is distinct from old.ended_at
            or new.kind is distinct from old.kind
            or new.note is distinct from old.note)
       and old.installer_id <> auth.uid() then
      new.edited_by := auth.uid();
    end if;
  end if;
  if new.ended_at is not null and new.ended_at < new.started_at then
    raise exception 'Das Ende muss nach dem Beginn liegen';
  end if;
  return new;
end;
$$;

create trigger time_entries_guard
  before insert or update on public.time_entries
  for each row execute function public.time_entries_guard();

-- Startet Fahrt oder Arbeit für den angemeldeten Monteur; beendet eine laufende Zeit
create or replace function public.start_time_entry(p_ticket_id bigint, p_kind public.time_kind)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
begin
  if auth.uid() is null then
    raise exception 'Nicht angemeldet';
  end if;
  if not exists (
    select 1 from public.tickets t
    where t.id = p_ticket_id and t.ticket_type <> 'qm' and t.status <> 'abgeschlossen'
      and public.is_on_team(t.team_id, t.montage_date)
  ) then
    raise exception 'Zeiten können nur Monteure des eingeplanten Teams erfassen, solange der Einsatz offen ist';
  end if;
  update public.time_entries set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
  insert into public.time_entries (ticket_id, installer_id, kind)
  values (p_ticket_id, auth.uid(), p_kind)
  returning id into v_id;
  return v_id;
end;
$$;

create or replace function public.stop_time_entry()
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  update public.time_entries set ended_at = greatest(now(), started_at)
  where installer_id = auth.uid() and ended_at is null;
end;
$$;

-- Wird der Einsatz erledigt gemeldet, laufen seine Zeiten nicht weiter
create or replace function public.stop_times_on_close()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.status = 'abgeschlossen' and old.status <> 'abgeschlossen' then
    update public.time_entries set ended_at = greatest(now(), started_at)
    where ticket_id = new.id and ended_at is null;
  end if;
  return new;
end;
$$;

create trigger tickets_stop_times_on_close
  after update of status on public.tickets
  for each row execute function public.stop_times_on_close();

revoke execute on function public.start_time_entry(bigint, public.time_kind) from public, anon;
revoke execute on function public.stop_time_entry() from public, anon;
grant execute on function public.start_time_entry(bigint, public.time_kind) to authenticated;
grant execute on function public.stop_time_entry() to authenticated;
