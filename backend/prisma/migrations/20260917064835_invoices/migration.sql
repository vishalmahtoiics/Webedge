-- CreateEnum
CREATE TYPE "public"."InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PAID', 'VOID');

-- CreateTable
CREATE TABLE "public"."invoice_sequences" (
    "financialYear" TEXT NOT NULL,
    "lastNumber" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoice_sequences_pkey" PRIMARY KEY ("financialYear")
);

-- CreateTable
CREATE TABLE "public"."invoices" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "invoiceNumber" TEXT,
    "financialYear" TEXT,
    "serialNumber" INTEGER,
    "status" "public"."InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "supplierStateCode" TEXT NOT NULL,
    "supplierGstin" TEXT,
    "customerName" TEXT NOT NULL,
    "customerGstin" TEXT,
    "customerStateCode" TEXT NOT NULL,
    "placeOfSupply" TEXT NOT NULL,
    "taxKind" TEXT NOT NULL,
    "subtotalInPaise" INTEGER NOT NULL,
    "discountInPaise" INTEGER NOT NULL DEFAULT 0,
    "cgstInPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstInPaise" INTEGER NOT NULL DEFAULT 0,
    "igstInPaise" INTEGER NOT NULL DEFAULT 0,
    "roundOffInPaise" INTEGER NOT NULL DEFAULT 0,
    "totalInPaise" INTEGER NOT NULL,
    "issuedAt" TIMESTAMP(3),
    "dueAt" TIMESTAMP(3),
    "paidAt" TIMESTAMP(3),
    "voidedAt" TIMESTAMP(3),
    "voidReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."invoice_lines" (
    "id" UUID NOT NULL,
    "invoiceId" UUID NOT NULL,
    "description" TEXT NOT NULL,
    "sacCode" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPriceInPaise" INTEGER NOT NULL,
    "gstRateBps" INTEGER NOT NULL,
    "taxableValueInPaise" INTEGER NOT NULL,
    "cgstInPaise" INTEGER NOT NULL DEFAULT 0,
    "sgstInPaise" INTEGER NOT NULL DEFAULT 0,
    "igstInPaise" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "invoice_lines_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "invoices_invoiceNumber_key" ON "public"."invoices"("invoiceNumber");

-- CreateIndex
CREATE INDEX "invoices_customerId_createdAt_idx" ON "public"."invoices"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "public"."invoices"("status");

-- CreateIndex
CREATE INDEX "invoice_lines_invoiceId_idx" ON "public"."invoice_lines"("invoiceId");

-- AddForeignKey
ALTER TABLE "public"."invoices" ADD CONSTRAINT "invoices_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."invoice_lines" ADD CONSTRAINT "invoice_lines_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "public"."invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;
