-- Review flags ("send to clean-up queue").
-- NOTE: Prisma's diff tries to drop member_no_seq and the trigram index it
-- doesn't model; those statements were removed by hand. Always review.

-- Restore the ID search index dropped by the first (failed) attempt.
CREATE INDEX IF NOT EXISTS member_memberid_trgm ON "Member" USING gin ("memberId" gin_trgm_ops);

-- CreateTable
CREATE TABLE "ReviewFlag" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "flaggedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,

    CONSTRAINT "ReviewFlag_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ReviewFlag_resolvedAt_createdAt_idx" ON "ReviewFlag"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "ReviewFlag_memberId_idx" ON "ReviewFlag"("memberId");

-- AddForeignKey
ALTER TABLE "ReviewFlag" ADD CONSTRAINT "ReviewFlag_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;
