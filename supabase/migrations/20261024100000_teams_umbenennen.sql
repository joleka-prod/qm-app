-- Montage-Teams heißen jetzt "Team 1", "Team 2" … (Fabian, 2026-10-24); Kundendienst-Teams bleiben
update public.teams
   set name = regexp_replace(name, '^Montage (\d+)$', 'Team \1')
 where name ~ '^Montage \d+$';

select name, area, active from public.teams order by sort;
