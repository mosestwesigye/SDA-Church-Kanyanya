-- Two-step verification is for System Administrators only.
UPDATE "Role" SET "require2fa" = ("key" = 'SYSTEM_ADMIN');

-- Remove authenticator set-ups from everyone who isn't a System Administrator.
DELETE FROM "TwoFactor" WHERE "userId" NOT IN (
  SELECT ur."userId" FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE r."key" = 'SYSTEM_ADMIN'
);
UPDATE "User" SET "twoFactorEnabled" = false WHERE "twoFactorEnabled" = true AND "id" NOT IN (
  SELECT ur."userId" FROM "UserRole" ur JOIN "Role" r ON r."id" = ur."roleId" WHERE r."key" = 'SYSTEM_ADMIN'
);
