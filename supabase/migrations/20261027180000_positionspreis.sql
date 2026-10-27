-- Preis direkt beim Anlegen/Bearbeiten der Positionen eintragen.
-- Bisher setzte die Datenbank Menge, Einheit und Einzelpreis beim Speichern einer Position
-- zurück (nur der Artikelpreis wurde übernommen, alles andere erst in der Berechnung).
-- Jetzt dürfen Planer (Admin, Teamleiter, Disposition) Menge, Einheit und Einzelpreis
-- gleich mit eintragen, solange der Auftrag nicht berechnet ist. Für alle anderen
-- (z. B. Monteure) bleibt es wie bisher.

create or replace function public.positions_zz_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.articles;
  v_billing public.billing_state;
begin
  if current_setting('app.billing', true) = 'on' then
    return new;
  end if;

  select billing_state into v_billing from public.tickets where id = new.ticket_id;

  if public.my_role() in ('admin', 'teamleiter', 'disposition') and v_billing is distinct from 'berechnet' then
    -- Planer: eingetragene Werte übernehmen; ohne Preis kommt er vom neu gewählten Artikel
    new.unit := left(trim(coalesce(new.unit, '')), 20);
    if new.unit = '' then
      new.unit := 'Stk';
    end if;
    new.quantity := round(coalesce(new.quantity, 1), 2);
    new.price := round(new.price, 2);
    if new.article_id is not null
       and (tg_op = 'INSERT' or new.article_id is distinct from old.article_id) then
      select * into a from public.articles where id = new.article_id and active;
      if not found then
        raise exception 'Artikel nicht gefunden oder nicht mehr aktiv';
      end if;
      if new.price is null then
        new.unit := a.unit;
        new.price := a.price;
      end if;
    end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    new.price := null;
    new.quantity := 1;
    new.unit := 'Stk';
  else
    new.price := old.price;
    new.quantity := old.quantity;
    new.unit := old.unit;
  end if;
  if new.article_id is not null
     and (tg_op = 'INSERT' or new.article_id is distinct from old.article_id) then
    select * into a from public.articles where id = new.article_id and active;
    if not found then
      raise exception 'Artikel nicht gefunden oder nicht mehr aktiv';
    end if;
    new.unit := a.unit;
    new.price := a.price;
  end if;
  return new;
end;
$$;
