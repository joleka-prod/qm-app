-- Schritt 1 (nur lesen): zeigt die Benutzer, die der Ninox-Import angelegt hat.
-- Erkennung über die Anlagezeit: Der Import legt alle Benutzer innerhalb weniger Sekunden an.
-- Gezeigt werden Benutzer vom 26.10.2026, die in einem Block von mindestens 3 Konten angelegt wurden
-- (höchstens 2 Minuten Abstand zum vorigen Konto), dazu alle ohne App-Login. Admins nie.
with heute as (
  select p.*, case when p.created_at - lag(p.created_at) over (order by p.created_at) <= interval '2 minutes' then 0 else 1 end as neu
  from public.profiles p
  where (p.created_at at time zone 'Europe/Berlin')::date = date '2026-10-26' and p.role <> 'admin'
), bloecke as (
  select *, sum(neu) over (order by created_at) as block from heute
), gross as (
  select block from bloecke group by block having count(*) >= 3
)
select p.full_name, p.email, p.role, to_char(p.created_at at time zone 'Europe/Berlin', 'DD.MM. HH24:MI:SS') as angelegt
from public.profiles p
where p.role <> 'admin'
  and (p.email like '%@kein-login.invalid'
       or p.id in (select id from bloecke where block in (select block from gross)))
order by p.created_at;
