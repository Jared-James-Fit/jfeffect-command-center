-- A new kind of team login: a specialist (a game day coach, a performance
-- specialist). Its own enum value so nothing that trusts 'coach' or 'admin'
-- (dozens of policies and functions) ever lets one in: a specialist sees only
-- the athletes, and only the categories, they're explicitly given
-- (20270603090100_team_specialists.sql).
--
-- On its own because Postgres can't use a new enum value in the transaction
-- that adds it. Apply this file, then 20270603090100.
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'specialist';
