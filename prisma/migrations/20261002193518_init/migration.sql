-- Extensions and the permanent member-number sequence (must exist before "Member").
CREATE EXTENSION IF NOT EXISTS pg_trgm;
CREATE SEQUENCE IF NOT EXISTS member_no_seq START 1;

-- CreateEnum
CREATE TYPE "Gender" AS ENUM ('MALE', 'FEMALE');

-- CreateEnum
CREATE TYPE "DobPrecision" AS ENUM ('FULL', 'YEAR', 'UNKNOWN');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'IRREGULAR', 'SELF_TRANSFERRED', 'UNDER_DISCIPLINE', 'DECEASED', 'LEFT_THE_FAITH');

-- CreateEnum
CREATE TYPE "MaritalStatus" AS ENUM ('SINGLE', 'MARRIED', 'SEPARATED', 'COHABITING', 'WIDOWED');

-- CreateEnum
CREATE TYPE "ListType" AS ENUM ('ZONE', 'MINISTRY', 'MINISTRY_ROLE', 'PROFESSION');

-- CreateEnum
CREATE TYPE "PermissionScope" AS ENUM ('ALL', 'MINISTRY', 'SELF');

-- CreateEnum
CREATE TYPE "AuditSource" AS ENUM ('UI', 'IMPORT', 'SELF_SERVICE', 'MERGE', 'WORKFLOW', 'SYSTEM');

-- CreateEnum
CREATE TYPE "AuditAction" AS ENUM ('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'PURGE', 'MERGE', 'UNMERGE', 'APPROVE', 'REJECT', 'LOGIN', 'LOGIN_FAILED', 'LOGOUT', 'EXPORT', 'SECURITY');

-- CreateEnum
CREATE TYPE "RequestState" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "StatusChangeType" AS ENUM ('TRANSFER_IN', 'TRANSFER_OUT', 'DEATH', 'DISCIPLINE', 'RESTORATION', 'STATUS_UPDATE');

-- CreateEnum
CREATE TYPE "TransferDirection" AS ENUM ('IN', 'OUT');

-- CreateEnum
CREATE TYPE "TransferStage" AS ENUM ('REQUESTED', 'LETTER_SENT', 'LETTER_RECEIVED', 'BOARD_APPROVED', 'COMPLETED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipEventType" AS ENUM ('JOINED', 'BAPTISM', 'PROFESSION_OF_FAITH', 'TRANSFER_IN', 'TRANSFER_OUT', 'STATUS_CHANGE', 'DEATH', 'DISCIPLINE', 'RESTORATION', 'MERGE', 'NOTE');

-- CreateEnum
CREATE TYPE "HouseholdRelation" AS ENUM ('HEAD', 'SPOUSE', 'CHILD', 'DEPENDANT', 'OTHER');

-- CreateEnum
CREATE TYPE "DocumentKind" AS ENUM ('PHOTO', 'CONSENT_FORM', 'TRANSFER_LETTER', 'DEATH_CERTIFICATE', 'BOARD_MINUTE', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentMethod" AS ENUM ('PAPER_FORM', 'SELF_SERVICE', 'VERBAL_RECORDED');

-- CreateEnum
CREATE TYPE "RawValueField" AS ENUM ('GENDER', 'DOB', 'YEAR_JOINED', 'ZONE', 'PHONE', 'EMAIL', 'STATUS', 'MARITAL', 'SPOUSE', 'NEXT_OF_KIN', 'PROFESSION', 'MINISTRY', 'MINISTRY_ROLE');

-- CreateEnum
CREATE TYPE "ImportBatchStatus" AS ENUM ('UPLOADED', 'VALIDATED', 'COMMITTED', 'FAILED');

-- CreateEnum
CREATE TYPE "ImportRowAction" AS ENUM ('CREATE', 'UPDATE', 'UNCHANGED', 'SKIP', 'ERROR');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "emailVerified" BOOLEAN NOT NULL DEFAULT false,
    "image" TEXT,
    "phoneNumber" TEXT,
    "phoneNumberVerified" BOOLEAN,
    "twoFactorEnabled" BOOLEAN DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "lastLoginAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "memberId" TEXT,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "token" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "userId" TEXT NOT NULL,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Account" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "accessToken" TEXT,
    "refreshToken" TEXT,
    "idToken" TEXT,
    "accessTokenExpiresAt" TIMESTAMP(3),
    "refreshTokenExpiresAt" TIMESTAMP(3),
    "scope" TEXT,
    "password" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Account_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Verification" (
    "id" TEXT NOT NULL,
    "identifier" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Verification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TwoFactor" (
    "id" TEXT NOT NULL,
    "secret" TEXT NOT NULL,
    "backupCodes" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "verified" BOOLEAN DEFAULT true,
    "failedVerificationCount" INTEGER DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),

    CONSTRAINT "TwoFactor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "lastRequest" BIGINT NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Role" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT true,
    "require2fa" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Role_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Permission" (
    "id" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "scope" "PermissionScope" NOT NULL DEFAULT 'ALL',

    CONSTRAINT "Permission_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserRole" (
    "userId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,

    CONSTRAINT "UserRole_pkey" PRIMARY KEY ("userId","roleId")
);

-- CreateTable
CREATE TABLE "UserMinistryScope" (
    "userId" TEXT NOT NULL,
    "ministryId" TEXT NOT NULL,

    CONSTRAINT "UserMinistryScope_pkey" PRIMARY KEY ("userId","ministryId")
);

-- CreateTable
CREATE TABLE "AppSetting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AppSetting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "ListItem" (
    "id" TEXT NOT NULL,
    "type" "ListType" NOT NULL,
    "label" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "mergedIntoId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ListItem_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Member" (
    "id" TEXT NOT NULL,
    "memberNo" INTEGER NOT NULL DEFAULT nextval('member_no_seq'),
    "memberId" TEXT NOT NULL DEFAULT '',
    "lastName" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "gender" "Gender",
    "dobDate" DATE,
    "dobYear" INTEGER,
    "dobPrecision" "DobPrecision" NOT NULL DEFAULT 'UNKNOWN',
    "yearJoined" INTEGER,
    "photoKey" TEXT,
    "zoneId" TEXT,
    "phoneRaw" TEXT,
    "phoneE164" TEXT,
    "email" TEXT,
    "status" "MembershipStatus",
    "maritalStatus" "MaritalStatus",
    "spouseMemberId" TEXT,
    "spouseName" TEXT,
    "nextOfKinName" TEXT,
    "nextOfKinPhoneRaw" TEXT,
    "nextOfKinPhoneE164" TEXT,
    "professionId" TEXT,
    "completeness" INTEGER NOT NULL DEFAULT 0,
    "missingFields" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),
    "deletedById" TEXT,
    "mergedIntoId" TEXT,
    "purgedAt" TIMESTAMP(3),

    CONSTRAINT "Member_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MemberMinistry" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "ministryId" TEXT NOT NULL,
    "roleId" TEXT NOT NULL,
    "since" DATE,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MemberMinistry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RawValue" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "field" "RawValueField" NOT NULL,
    "rawValue" TEXT NOT NULL,
    "normalized" TEXT NOT NULL,
    "importRowId" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "RawValue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ValueMapping" (
    "id" TEXT NOT NULL,
    "field" "RawValueField" NOT NULL,
    "normalized" TEXT NOT NULL,
    "listItemId" TEXT,
    "meansBlank" BOOLEAN NOT NULL DEFAULT false,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ValueMapping_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Household" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Household_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "HouseholdMember" (
    "householdId" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "relation" "HouseholdRelation" NOT NULL,

    CONSTRAINT "HouseholdMember_pkey" PRIMARY KEY ("householdId","memberId")
);

-- CreateTable
CREATE TABLE "Document" (
    "id" TEXT NOT NULL,
    "memberId" TEXT,
    "kind" "DocumentKind" NOT NULL,
    "fileName" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "sizeBytes" INTEGER NOT NULL,
    "uploadedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "Document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Consent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "consentedAt" TIMESTAMP(3) NOT NULL,
    "version" TEXT NOT NULL,
    "method" "ConsentMethod" NOT NULL,
    "documentId" TEXT,
    "recordedById" TEXT,
    "withdrawnAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Consent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StatusChangeRequest" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "StatusChangeType" NOT NULL,
    "fromStatus" "MembershipStatus",
    "toStatus" "MembershipStatus" NOT NULL,
    "reason" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "documentId" TEXT,
    "requestedById" TEXT NOT NULL,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "RequestState" NOT NULL DEFAULT 'PENDING',
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "decisionNote" TEXT,
    "transferId" TEXT,

    CONSTRAINT "StatusChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Transfer" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "direction" "TransferDirection" NOT NULL,
    "otherChurch" TEXT NOT NULL,
    "stage" "TransferStage" NOT NULL DEFAULT 'REQUESTED',
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "letterSentAt" TIMESTAMP(3),
    "letterReceivedAt" TIMESTAMP(3),
    "boardApprovedAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "notes" TEXT,
    "createdById" TEXT NOT NULL,

    CONSTRAINT "Transfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipEvent" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "type" "MembershipEventType" NOT NULL,
    "occurredOn" DATE,
    "occurredYear" INTEGER,
    "title" TEXT NOT NULL,
    "detail" TEXT,
    "fromStatus" "MembershipStatus",
    "toStatus" "MembershipStatus",
    "requestId" TEXT,
    "approvedById" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CorrectionRequest" (
    "id" TEXT NOT NULL,
    "memberId" TEXT NOT NULL,
    "submittedById" TEXT NOT NULL,
    "changes" JSONB NOT NULL,
    "note" TEXT,
    "state" "RequestState" NOT NULL DEFAULT 'PENDING',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CorrectionRequest_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Merge" (
    "id" TEXT NOT NULL,
    "survivorId" TEXT NOT NULL,
    "retiredId" TEXT NOT NULL,
    "fieldChoices" JSONB NOT NULL,
    "snapshot" JSONB NOT NULL,
    "mergedById" TEXT NOT NULL,
    "mergedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "undoableUntil" TIMESTAMP(3) NOT NULL,
    "undoneAt" TIMESTAMP(3),
    "undoneById" TEXT,

    CONSTRAINT "Merge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DuplicateDismissal" (
    "memberAId" TEXT NOT NULL,
    "memberBId" TEXT NOT NULL,
    "dismissedById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DuplicateDismissal_pkey" PRIMARY KEY ("memberAId","memberBId")
);

-- CreateTable
CREATE TABLE "CleanupTarget" (
    "id" TEXT NOT NULL,
    "targetPercent" INTEGER NOT NULL,
    "dueDate" DATE NOT NULL,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CleanupTarget_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SavedView" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "columns" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "shared" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SavedView_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportBatch" (
    "id" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "sheetName" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL,
    "columnMap" JSONB NOT NULL,
    "status" "ImportBatchStatus" NOT NULL DEFAULT 'UPLOADED',
    "totals" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "committedAt" TIMESTAMP(3),

    CONSTRAINT "ImportBatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ImportRow" (
    "id" TEXT NOT NULL,
    "batchId" TEXT NOT NULL,
    "rowNumber" INTEGER NOT NULL,
    "raw" JSONB NOT NULL,
    "normalized" JSONB,
    "issues" JSONB NOT NULL DEFAULT '[]',
    "action" "ImportRowAction",
    "memberId" TEXT,

    CONSTRAINT "ImportRow_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" BIGSERIAL NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorUserId" TEXT,
    "actorLabel" TEXT NOT NULL,
    "source" "AuditSource" NOT NULL,
    "action" "AuditAction" NOT NULL,
    "entity" TEXT NOT NULL,
    "entityId" TEXT,
    "memberId" TEXT,
    "field" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "ipAddress" TEXT,
    "sessionId" TEXT,
    "correlationId" TEXT,
    "note" TEXT,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExportLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "format" TEXT NOT NULL,
    "filters" JSONB NOT NULL,
    "fields" TEXT[],
    "rowCount" INTEGER NOT NULL,
    "noticeShown" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ExportLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "User_phoneNumber_key" ON "User"("phoneNumber");

-- CreateIndex
CREATE UNIQUE INDEX "User_memberId_key" ON "User"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "Session_token_key" ON "Session"("token");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE INDEX "Account_userId_idx" ON "Account"("userId");

-- CreateIndex
CREATE INDEX "Verification_identifier_idx" ON "Verification"("identifier");

-- CreateIndex
CREATE INDEX "TwoFactor_userId_idx" ON "TwoFactor"("userId");

-- CreateIndex
CREATE INDEX "TwoFactor_secret_idx" ON "TwoFactor"("secret");

-- CreateIndex
CREATE UNIQUE INDEX "RateLimit_key_key" ON "RateLimit"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Role_key_key" ON "Role"("key");

-- CreateIndex
CREATE UNIQUE INDEX "Permission_roleId_resource_action_key" ON "Permission"("roleId", "resource", "action");

-- CreateIndex
CREATE INDEX "ListItem_type_active_sortOrder_idx" ON "ListItem"("type", "active", "sortOrder");

-- CreateIndex
CREATE UNIQUE INDEX "ListItem_type_label_key" ON "ListItem"("type", "label");

-- CreateIndex
CREATE UNIQUE INDEX "Member_memberNo_key" ON "Member"("memberNo");

-- CreateIndex
CREATE UNIQUE INDEX "Member_memberId_key" ON "Member"("memberId");

-- CreateIndex
CREATE INDEX "Member_lastName_firstName_idx" ON "Member"("lastName", "firstName");

-- CreateIndex
CREATE INDEX "Member_status_idx" ON "Member"("status");

-- CreateIndex
CREATE INDEX "Member_zoneId_idx" ON "Member"("zoneId");

-- CreateIndex
CREATE INDEX "Member_completeness_idx" ON "Member"("completeness");

-- CreateIndex
CREATE INDEX "Member_phoneE164_idx" ON "Member"("phoneE164");

-- CreateIndex
CREATE INDEX "Member_deletedAt_idx" ON "Member"("deletedAt");

-- CreateIndex
CREATE INDEX "MemberMinistry_ministryId_idx" ON "MemberMinistry"("ministryId");

-- CreateIndex
CREATE UNIQUE INDEX "MemberMinistry_memberId_ministryId_roleId_key" ON "MemberMinistry"("memberId", "ministryId", "roleId");

-- CreateIndex
CREATE INDEX "RawValue_field_normalized_idx" ON "RawValue"("field", "normalized");

-- CreateIndex
CREATE INDEX "RawValue_resolvedAt_idx" ON "RawValue"("resolvedAt");

-- CreateIndex
CREATE UNIQUE INDEX "RawValue_memberId_field_rawValue_key" ON "RawValue"("memberId", "field", "rawValue");

-- CreateIndex
CREATE UNIQUE INDEX "ValueMapping_field_normalized_key" ON "ValueMapping"("field", "normalized");

-- CreateIndex
CREATE INDEX "HouseholdMember_memberId_idx" ON "HouseholdMember"("memberId");

-- CreateIndex
CREATE INDEX "Document_memberId_idx" ON "Document"("memberId");

-- CreateIndex
CREATE INDEX "Consent_memberId_idx" ON "Consent"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "StatusChangeRequest_transferId_key" ON "StatusChangeRequest"("transferId");

-- CreateIndex
CREATE INDEX "StatusChangeRequest_state_requestedAt_idx" ON "StatusChangeRequest"("state", "requestedAt");

-- CreateIndex
CREATE INDEX "StatusChangeRequest_memberId_idx" ON "StatusChangeRequest"("memberId");

-- CreateIndex
CREATE INDEX "Transfer_memberId_idx" ON "Transfer"("memberId");

-- CreateIndex
CREATE INDEX "Transfer_stage_idx" ON "Transfer"("stage");

-- CreateIndex
CREATE INDEX "MembershipEvent_memberId_occurredOn_idx" ON "MembershipEvent"("memberId", "occurredOn");

-- CreateIndex
CREATE INDEX "CorrectionRequest_state_createdAt_idx" ON "CorrectionRequest"("state", "createdAt");

-- CreateIndex
CREATE INDEX "Merge_survivorId_idx" ON "Merge"("survivorId");

-- CreateIndex
CREATE INDEX "Merge_retiredId_idx" ON "Merge"("retiredId");

-- CreateIndex
CREATE INDEX "ImportBatch_fileHash_idx" ON "ImportBatch"("fileHash");

-- CreateIndex
CREATE INDEX "ImportRow_memberId_idx" ON "ImportRow"("memberId");

-- CreateIndex
CREATE UNIQUE INDEX "ImportRow_batchId_rowNumber_key" ON "ImportRow"("batchId", "rowNumber");

-- CreateIndex
CREATE INDEX "AuditLog_memberId_at_idx" ON "AuditLog"("memberId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_entity_entityId_at_idx" ON "AuditLog"("entity", "entityId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_actorUserId_at_idx" ON "AuditLog"("actorUserId", "at");

-- CreateIndex
CREATE INDEX "AuditLog_at_idx" ON "AuditLog"("at");

-- CreateIndex
CREATE INDEX "ExportLog_userId_createdAt_idx" ON "ExportLog"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "User" ADD CONSTRAINT "User_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Account" ADD CONSTRAINT "Account_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TwoFactor" ADD CONSTRAINT "TwoFactor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Permission" ADD CONSTRAINT "Permission_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserRole" ADD CONSTRAINT "UserRole_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "Role"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMinistryScope" ADD CONSTRAINT "UserMinistryScope_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserMinistryScope" ADD CONSTRAINT "UserMinistryScope_ministryId_fkey" FOREIGN KEY ("ministryId") REFERENCES "ListItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_zoneId_fkey" FOREIGN KEY ("zoneId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_spouseMemberId_fkey" FOREIGN KEY ("spouseMemberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_professionId_fkey" FOREIGN KEY ("professionId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Member" ADD CONSTRAINT "Member_mergedIntoId_fkey" FOREIGN KEY ("mergedIntoId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMinistry" ADD CONSTRAINT "MemberMinistry_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMinistry" ADD CONSTRAINT "MemberMinistry_ministryId_fkey" FOREIGN KEY ("ministryId") REFERENCES "ListItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MemberMinistry" ADD CONSTRAINT "MemberMinistry_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "ListItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RawValue" ADD CONSTRAINT "RawValue_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ValueMapping" ADD CONSTRAINT "ValueMapping_listItemId_fkey" FOREIGN KEY ("listItemId") REFERENCES "ListItem"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_householdId_fkey" FOREIGN KEY ("householdId") REFERENCES "Household"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "HouseholdMember" ADD CONSTRAINT "HouseholdMember_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Document" ADD CONSTRAINT "Document_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Consent" ADD CONSTRAINT "Consent_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChangeRequest" ADD CONSTRAINT "StatusChangeRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChangeRequest" ADD CONSTRAINT "StatusChangeRequest_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "Document"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StatusChangeRequest" ADD CONSTRAINT "StatusChangeRequest_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "Transfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Transfer" ADD CONSTRAINT "Transfer_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipEvent" ADD CONSTRAINT "MembershipEvent_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CorrectionRequest" ADD CONSTRAINT "CorrectionRequest_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SavedView" ADD CONSTRAINT "SavedView_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_batchId_fkey" FOREIGN KEY ("batchId") REFERENCES "ImportBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ImportRow" ADD CONSTRAINT "ImportRow_memberId_fkey" FOREIGN KEY ("memberId") REFERENCES "Member"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- ─────────────── Member ID: permanent, derived, never reused ───────────────
CREATE OR REPLACE FUNCTION member_assign_id() RETURNS trigger AS $$
BEGIN
  NEW."memberId" := 'SDAK/M' || lpad(NEW."memberNo"::text, 4, '0');
  -- Keep the sequence ahead of explicitly imported numbers so they are never reissued.
  PERFORM setval('member_no_seq', GREATEST(NEW."memberNo", (SELECT last_value FROM member_no_seq)), true);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_assign_id
  BEFORE INSERT ON "Member"
  FOR EACH ROW EXECUTE FUNCTION member_assign_id();

CREATE OR REPLACE FUNCTION member_id_immutable() RETURNS trigger AS $$
BEGIN
  IF NEW."memberNo" IS DISTINCT FROM OLD."memberNo" OR NEW."memberId" IS DISTINCT FROM OLD."memberId" THEN
    RAISE EXCEPTION 'Member ID is permanent and cannot be changed (%).', OLD."memberId"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_id_immutable
  BEFORE UPDATE ON "Member"
  FOR EACH ROW EXECUTE FUNCTION member_id_immutable();

-- Members are never hard-deleted; purge wipes PII and keeps a tombstone.
CREATE OR REPLACE FUNCTION member_no_delete() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'Members cannot be deleted; use soft delete or purge.'
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER member_no_delete
  BEFORE DELETE ON "Member"
  FOR EACH ROW EXECUTE FUNCTION member_no_delete();

-- ─────────────── Audit log: append-only ───────────────
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only (% rejected).', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_no_update_delete
  BEFORE UPDATE OR DELETE ON "AuditLog"
  FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();

CREATE TRIGGER audit_log_no_truncate
  BEFORE TRUNCATE ON "AuditLog"
  FOR EACH STATEMENT EXECUTE FUNCTION audit_log_append_only();

-- ─────────────── Search & duplicate detection ───────────────
CREATE INDEX member_name_trgm ON "Member"
  USING gin ((lower("lastName" || ' ' || "firstName")) gin_trgm_ops);
CREATE INDEX member_memberid_trgm ON "Member" USING gin ("memberId" gin_trgm_ops);
