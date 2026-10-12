-- Membership status changes no longer need approval: the "approve" action is gone,
-- and "status_request:create" now means "change membership status".
DELETE FROM "Permission" WHERE "resource" = 'status_request' AND "action" = 'approve';

-- Elders could only propose changes before; proposing now changes the status, so
-- they lose it by default (an admin can grant it again under Roles & permissions).
DELETE FROM "Permission" p
USING "Role" r
WHERE p."roleId" = r."id" AND r."key" = 'ELDER' AND p."resource" = 'status_request' AND p."action" = 'create';
