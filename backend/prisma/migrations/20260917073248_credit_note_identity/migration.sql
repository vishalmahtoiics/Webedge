-- CreateEnum
CREATE TYPE "public"."InvoiceKind" AS ENUM ('INVOICE', 'CREDIT_NOTE');

-- AlterTable
ALTER TABLE "public"."invoices" ADD COLUMN     "againstInvoiceDate" TIMESTAMP(3),
ADD COLUMN     "againstInvoiceId" UUID,
ADD COLUMN     "againstInvoiceNumber" TEXT,
ADD COLUMN     "kind" "public"."InvoiceKind" NOT NULL DEFAULT 'INVOICE';
