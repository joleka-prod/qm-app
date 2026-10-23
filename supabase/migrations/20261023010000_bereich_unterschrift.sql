-- Bereich (Kundendienst / Montage) und Kundenunterschrift für Einsätze.
-- Die Unterschrift liegt als PNG im Bucket ticket-photos unter <ticket_id>/unterschrift-*.png,
-- erscheint aber nicht in der Fotoliste (die kommt aus ticket_photos).

create type public.service_area as enum ('kundendienst', 'montage');

alter table public.tickets
  add column service_area public.service_area,
  add column signature_path text,
  add column signer_name text not null default '',
  add column signed_at timestamptz;

-- Vorbelegung für bestehende Einsätze: Restarbeit = Montage, sonst Kundendienst
update public.tickets
set service_area = case when ticket_type = 'restarbeit' then 'montage'::public.service_area
                        else 'kundendienst'::public.service_area end
where ticket_type <> 'qm';

create function public.tickets_area_signature()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.ticket_type = 'qm' then
    new.service_area := null;
    new.signature_path := null;
    new.signer_name := '';
    new.signed_at := null;
    return new;
  end if;

  if new.service_area is null then
    new.service_area := case when new.ticket_type = 'restarbeit' then 'montage'::public.service_area
                             else 'kundendienst'::public.service_area end;
  end if;
  new.signer_name := trim(new.signer_name);

  -- Bereich ändern nur QM/Admin und Teamleiter (beim Anlegen darf jeder wählen)
  if tg_op = 'UPDATE' and auth.uid() is not null
     and coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter') then
    new.service_area := coalesce(old.service_area, new.service_area);
  end if;

  if tg_op = 'INSERT' then
    new.signature_path := null;
    new.signer_name := '';
    new.signed_at := null;
    return new;
  end if;

  if new.signature_path is distinct from old.signature_path then
    if old.status = 'abgeschlossen' and auth.uid() is not null and public.my_role() <> 'admin' then
      raise exception 'Der Einsatz ist erledigt, die Unterschrift kann nicht mehr geändert werden';
    end if;
    if new.signature_path is not null then
      if new.signature_path not like new.id || '/unterschrift-%' then
        raise exception 'Ungültiger Ablageort der Unterschrift';
      end if;
      if length(new.signer_name) = 0 then
        raise exception 'Bitte den Namen der unterschreibenden Person angeben';
      end if;
      new.signed_at := now();
    else
      new.signer_name := '';
      new.signed_at := null;
    end if;
  else
    new.signed_at := old.signed_at;
    if new.signer_name is distinct from old.signer_name then
      new.signer_name := old.signer_name;
    end if;
  end if;
  return new;
end;
$$;

-- Läuft nach tickets_guard (Trigger feuern alphabetisch)
create trigger tickets_zz_area_signature
  before insert or update on public.tickets
  for each row execute function public.tickets_area_signature();

create function public.log_ticket_signature()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if new.signature_path is distinct from old.signature_path then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(),
            case when new.signature_path is null then 'unterschrift_entfernt' else 'unterschrift' end,
            new.signer_name);
  end if;
  if new.service_area is distinct from old.service_area and old.service_area is not null then
    insert into public.ticket_events (ticket_id, actor, kind, details)
    values (new.id, auth.uid(), 'bereich', new.service_area::text);
  end if;
  return new;
end;
$$;

create trigger tickets_log_signature
  after update on public.tickets
  for each row execute function public.log_ticket_signature();
