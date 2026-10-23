-- Artikel / wiederkehrende Positionen mit Preis. Pflegen kann nur der Admin,
-- auswählen kann sie jeder, der Positionen anlegt. Beim Auswählen übernimmt die
-- Position Beschreibung (App), Einheit und Einzelpreis des Artikels.

create table public.articles (
  id bigint generated always as identity primary key,
  article_number text not null default '' check (length(article_number) <= 30),
  description text not null check (length(trim(description)) > 0),
  unit text not null default 'Stk' check (length(trim(unit)) between 1 and 20),
  price numeric(10, 2) check (price >= 0),
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create unique index articles_number_unique on public.articles (lower(article_number)) where article_number <> '';

create or replace function public.articles_guard()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.article_number := trim(new.article_number);
  new.description := trim(new.description);
  new.unit := trim(new.unit);
  new.updated_at := now();
  return new;
end;
$$;

create trigger articles_guard
  before insert or update on public.articles
  for each row execute function public.articles_guard();

alter table public.articles enable row level security;

create policy "Angemeldete sehen Artikel"
  on public.articles for select to authenticated
  using (true);

create policy "Admin legt Artikel an"
  on public.articles for insert to authenticated
  with check (public.is_admin());

create policy "Admin ändert Artikel"
  on public.articles for update to authenticated
  using (public.is_admin())
  with check (public.is_admin());

create policy "Admin löscht Artikel"
  on public.articles for delete to authenticated
  using (public.is_admin());

alter table public.ticket_positions
  add column article_id bigint references public.articles (id) on delete set null;

-- Menge, Einheit und Preis nur über die Berechnung; bei Artikelwahl vom Artikel übernehmen
create or replace function public.positions_zz_price()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  a public.articles;
begin
  if current_setting('app.billing', true) = 'on' then
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
