-- Renewal idempotency.
--
-- The renewal worker must invoice a subscription exactly once per period. Two
-- workers, a retry after a timeout, or an administrator pressing "Renew" while
-- the sweep runs would otherwise each issue an invoice for the same period —
-- and an issued invoice cannot be deleted, so the only correction is a credit
-- note against a charge that should never have existed.
--
-- The guarantee is this index, not the worker's care. A duplicate fails inside
-- the same transaction that allocates the serial number, so the allocation
-- rolls back with it and the sequence stays gapless (Rule 46(b)).
--
-- Both columns are null on every document that is not a renewal. Postgres
-- treats nulls in a unique index as distinct, so those rows never collide with
-- each other — verified against this server rather than assumed.

-- AlterTable
ALTER TABLE "public"."invoices" ADD COLUMN     "periodStart" TIMESTAMP(3),
ADD COLUMN     "subscriptionId" UUID;

-- CreateIndex
CREATE UNIQUE INDEX "invoices_subscriptionId_periodStart_key" ON "public"."invoices"("subscriptionId", "periodStart");

