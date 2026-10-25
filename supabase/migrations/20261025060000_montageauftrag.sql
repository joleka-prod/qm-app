-- Neue Auftragsart "Montageauftrag" (Fabian, 2026-10-25), Nummer MA-xxxx, Bereich standardmäßig Montage.
alter type public.ticket_type add value if not exists 'montageauftrag';

CREATE OR REPLACE FUNCTION public.tickets_area_signature()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.ticket_type = 'qm' then
    new.service_area := null;
    new.signature_path := null;
    new.signer_name := '';
    new.signed_at := null;
    return new;
  end if;
  if new.service_area is null then
    new.service_area := case when new.ticket_type::text in ('restarbeit', 'montageauftrag') then 'montage'::public.service_area
                             else 'kundendienst'::public.service_area end;
  end if;
  new.signer_name := trim(new.signer_name);
  -- Bereich ändern nur QM/Admin und Teamleiter (beim Anlegen darf jeder wählen)
  if tg_op = 'UPDATE' and auth.uid() is not null
     and coalesce(public.my_role()::text, '') not in ('admin', 'teamleiter', 'disposition') then
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
$function$;
