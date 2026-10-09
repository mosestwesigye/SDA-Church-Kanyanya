-- Families are church groups like cells: a leader and members.
UPDATE "HouseholdMember" SET "relation" = 'OTHER' WHERE "relation" IN ('SPOUSE', 'CHILD', 'DEPENDANT');
