-- A "Dormant" membership status for members who have stopped attending.
ALTER TYPE "MembershipStatus" ADD VALUE IF NOT EXISTS 'DORMANT';
