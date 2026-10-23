-- Positionsnummern werden ab jetzt automatisch fortlaufend vergeben (1, 2, 3 …).
-- Bestehende Positionen einmalig in ihrer Reihenfolge durchnummerieren.

with numbered as (
  select id,
         row_number() over (partition by ticket_id order by sort, id) as n
  from public.ticket_positions
)
update public.ticket_positions p
set position_number = numbered.n::text,
    sort = numbered.n - 1
from numbered
where p.id = numbered.id
  and (p.position_number is distinct from numbered.n::text or p.sort <> numbered.n - 1);
