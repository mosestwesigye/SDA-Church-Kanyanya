-- CreateEnum
CREATE TYPE "MeetingType" AS ENUM ('CHURCH_BOARD', 'BUSINESS_MEETING', 'ELDERS_COUNCIL', 'NOMINATING_COMMITTEE', 'OTHER');

-- CreateEnum
CREATE TYPE "MinutesStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateTable
CREATE TABLE "MeetingMinutes" (
    "id" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "type" "MeetingType" NOT NULL DEFAULT 'CHURCH_BOARD',
    "title" TEXT NOT NULL,
    "heldOn" DATE NOT NULL,
    "startTime" TEXT,
    "venue" TEXT,
    "chairperson" TEXT,
    "secretary" TEXT,
    "attendance" INTEGER,
    "summary" TEXT,
    "status" "MinutesStatus" NOT NULL DEFAULT 'DRAFT',
    "approvedOn" DATE,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MeetingMinutes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MinutesFile" (
    "id" TEXT NOT NULL,
    "minutesId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "sha256" TEXT NOT NULL,
    "uploadedById" TEXT NOT NULL,
    "uploadedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "MinutesFile_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MeetingMinutes_reference_key" ON "MeetingMinutes"("reference");

-- CreateIndex
CREATE INDEX "MeetingMinutes_heldOn_idx" ON "MeetingMinutes"("heldOn");

-- CreateIndex
CREATE INDEX "MeetingMinutes_deletedAt_idx" ON "MeetingMinutes"("deletedAt");

-- CreateIndex
CREATE INDEX "MinutesFile_minutesId_idx" ON "MinutesFile"("minutesId");

-- AddForeignKey
ALTER TABLE "MinutesFile" ADD CONSTRAINT "MinutesFile_minutesId_fkey" FOREIGN KEY ("minutesId") REFERENCES "MeetingMinutes"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- Default access for existing databases (new databases get it from the seeded matrix).
INSERT INTO "Permission" ("id", "roleId", "resource", "action", "scope")
SELECT gen_random_uuid()::text, r."id", g.resource, g.action, 'ALL'
FROM "Role" r
JOIN (VALUES
  ('SYSTEM_ADMIN', 'minutes', 'read'), ('SYSTEM_ADMIN', 'minutes', 'manage'),
  ('CHURCH_CLERK', 'minutes', 'read'), ('CHURCH_CLERK', 'minutes', 'manage'),
  ('ASSISTANT_CLERK', 'minutes', 'read'), ('ASSISTANT_CLERK', 'minutes', 'manage'),
  ('PASTOR', 'minutes', 'read'),
  ('ELDER', 'minutes', 'read')
) AS g(role_key, resource, action) ON g.role_key = r."key"
ON CONFLICT ("roleId", "resource", "action") DO NOTHING;
