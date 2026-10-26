-- Offline-Modus für Monteure (Fabian, 2026-10-26): Stempeluhr und Auftragszeiten können ohne
-- Empfang erfasst und später übertragen werden. Die Funktionen nehmen dafür optional die Uhrzeit
-- vom Handy (p_at). Ohne p_at gilt wie bisher die Serverzeit.

-- Uhrzeit vom Handy prüfen: nicht in der Zukunft, höchstens 7 Tage alt
create or replace function public.offline_time(p_at timestamptz)
returns timestamptz
language plpgsql
stable
set search_path = ''
as $$
begin
  if p_at is null or p_at > now() then
    return now();
  end if;
  if p_at < now() - interval '7 days' then
    raise exception 'Die offline erfasste Zeit ist älter als 7 Tage und wurde nicht übernommen';
  end if;
  return p_at;
end;
$$;

drop function if exists public.clock_in();
create function public.clock_in(p_at timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_at timestamptz := public.offline_time(p_at);
begin
  if public.my_role() is null then
    raise exception 'Nicht angemeldet oder Zugang deaktiviert';
  end if;
  select id into v_id from public.attendance where installer_id = auth.uid() and ended_at is null;
  if found then
    return v_id;
  end if;
  -- nachträglich übertragene Zeit darf sich nicht mit späteren Stempelzeiten überschneiden
  if exists (select 1 from public.attendance where installer_id = auth.uid() and ended_at > v_at) then
    v_at := (select max(ended_at) from public.attendance where installer_id = auth.uid());
  end if;
  perform set_config('app.clock', 'on', true);
  insert into public.attendance (installer_id, started_at) values (auth.uid(), v_at) returning id into v_id;
  perform set_config('app.clock', 'off', true);
  return v_id;
end;
$$;

drop function if exists public.clock_out();
create function public.clock_out(p_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := public.offline_time(p_at);
begin
  update public.time_entries set ended_at = greatest(v_at, started_at)
  where installer_id = auth.uid() and ended_at is null;
  perform set_config('app.clock', 'on', true);
  update public.attendance set ended_at = greatest(v_at, started_at)
  where installer_id = auth.uid() and ended_at is null;
  perform set_config('app.clock', 'off', true);
end;
$$;

drop function if exists public.start_time_entry(bigint, public.time_kind);
create function public.start_time_entry(p_ticket_id bigint, p_kind public.time_kind, p_at timestamptz default null)
returns bigint
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_id bigint;
  v_at timestamptz := public.offline_time(p_at);
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
  if not exists (select 1 from public.attendance where installer_id = auth.uid() and ended_at is null) then
    raise exception 'Bitte zuerst oben die Zeiterfassung starten';
  end if;
  update public.time_entries set ended_at = greatest(v_at, started_at)
  where installer_id = auth.uid() and ended_at is null;
  v_at := greatest(v_at, coalesce((select max(ended_at) from public.time_entries where installer_id = auth.uid()), v_at));
  insert into public.time_entries (ticket_id, installer_id, kind, started_at)
  values (p_ticket_id, auth.uid(), p_kind, v_at)
  returning id into v_id;
  return v_id;
end;
$$;

drop function if exists public.stop_time_entry();
create function public.stop_time_entry(p_at timestamptz default null)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_at timestamptz := public.offline_time(p_at);
begin
  update public.time_entries set ended_at = greatest(v_at, started_at)
  where installer_id = auth.uid() and ended_at is null;
end;
$$;

revoke execute on function public.clock_in(timestamptz) from public, anon;
revoke execute on function public.clock_out(timestamptz) from public, anon;
revoke execute on function public.start_time_entry(bigint, public.time_kind, timestamptz) from public, anon;
revoke execute on function public.stop_time_entry(timestamptz) from public, anon;
grant execute on function public.clock_in(timestamptz) to authenticated;
grant execute on function public.clock_out(timestamptz) to authenticated;
grant execute on function public.start_time_entry(bigint, public.time_kind, timestamptz) to authenticated;
grant execute on function public.stop_time_entry(timestamptz) to authenticated;
