-- Conference statistical return: Missing status, baptism / profession of faith, Sabbath attendance, quarterly returns.

-- CreateEnum
CREATE TYPE "ConferenceReturnState" AS ENUM ('DRAFT', 'SENT');

-- AlterEnum
ALTER TYPE "MembershipStatus" ADD VALUE 'MISSING';

-- AlterEnum


ALTER TYPE "StatusChangeType" ADD VALUE 'BAPTISM';
ALTER TYPE "StatusChangeType" ADD VALUE 'PROFESSION_OF_FAITH';

-- CreateTable
CREATE TABLE "SabbathAttendance" (
    "id" TEXT NOT NULL,
    "sabbath" DATE NOT NULL,
    "count" INTEGER NOT NULL,
    "recordedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SabbathAttendance_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ConferenceReturn" (
    "id" TEXT NOT NULL,
    "year" INTEGER NOT NULL,
    "quarter" INTEGER NOT NULL,
    "state" "ConferenceReturnState" NOT NULL DEFAULT 'DRAFT',
    "overrides" JSONB NOT NULL DEFAULT '{}',
    "figures" JSONB,
    "pastorName" TEXT,
    "dateSent" DATE,
    "dateReceived" DATE,
    "sentById" TEXT,
    "updatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ConferenceReturn_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SabbathAttendance_sabbath_key" ON "SabbathAttendance"("sabbath");

-- CreateIndex
CREATE UNIQUE INDEX "ConferenceReturn_year_quarter_key" ON "ConferenceReturn"("year", "quarter");


-- Default access for existing databases (new databases get it from the seeded matrix).
INSERT INTO "Permission" ("id", "roleId", "resource", "action", "scope")
SELECT gen_random_uuid()::text, r."id", g.resource, g.action, 'ALL'
FROM "Role" r
JOIN (VALUES
  ('SYSTEM_ADMIN', 'conference_return', 'read'), ('SYSTEM_ADMIN', 'conference_return', 'manage'),
  ('CHURCH_CLERK', 'conference_return', 'read'), ('CHURCH_CLERK', 'conference_return', 'manage'),
  ('ASSISTANT_CLERK', 'conference_return', 'read'), ('ASSISTANT_CLERK', 'conference_return', 'manage'),
  ('PASTOR', 'conference_return', 'read'),
  ('ELDER', 'conference_return', 'read')
) AS g(role_key, resource, action) ON g.role_key = r."key"
ON CONFLICT ("roleId", "resource", "action") DO NOTHING;
