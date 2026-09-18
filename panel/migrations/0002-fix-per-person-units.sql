-- Migration: repair per_person after an early copy of 0001.
--
-- The first version of 0001 copied the old per_person_l column, which held
-- litres, into per_person, which holds the base unit. Water rows came out a
-- thousand times too large, so the holidays card showed figures like
-- "170 250 litrow per person". Days written since the migration are already
-- correct, and this only touches rows that disagree with usage / persons.
--
-- Run it once if you migrated before 2026-09-18. It is a no-op otherwise.
--
--   wrangler d1 execute <db> --remote --file=migrations/0002-fix-per-person-units.sql
--
-- The same repair happens on its own the next time the panel rebuilds a day,
-- because every day row is derived from the raw readings.

UPDATE days SET per_person = usage / persons
 WHERE ABS(per_person - usage / persons) > 1e-9;
