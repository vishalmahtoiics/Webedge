-- DropForeignKey
ALTER TABLE "public"."activity_logs" DROP CONSTRAINT "activity_logs_adminUserId_fkey";

-- DropForeignKey
ALTER TABLE "public"."activity_logs" DROP CONSTRAINT "activity_logs_customerId_fkey";

-- DropForeignKey
ALTER TABLE "public"."activity_logs" DROP CONSTRAINT "activity_logs_customerUserId_fkey";

-- AlterTable
ALTER TABLE "public"."activity_logs" ADD COLUMN     "actorEmail" TEXT;
