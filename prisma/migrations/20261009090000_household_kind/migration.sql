-- Families and cells become separate modules.
CREATE TYPE "HouseholdKind" AS ENUM ('FAMILY', 'CELL');
ALTER TABLE "Household" ADD COLUMN "kind" "HouseholdKind" NOT NULL DEFAULT 'FAMILY';
-- Existing groups named like a cell are cells; everything else stays a family.
UPDATE "Household" SET "kind" = 'CELL' WHERE "name" ILIKE '%cell%';
CREATE INDEX "Household_kind_name_idx" ON "Household"("kind", "name");
