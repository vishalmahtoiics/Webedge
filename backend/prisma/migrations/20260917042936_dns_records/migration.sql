-- CreateEnum
CREATE TYPE "public"."DnsRecordType" AS ENUM ('A', 'AAAA', 'CNAME', 'MX', 'TXT', 'SRV', 'NS', 'CAA');

-- CreateTable
CREATE TABLE "public"."dns_records" (
    "id" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "type" "public"."DnsRecordType" NOT NULL,
    "name" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "ttl" INTEGER NOT NULL DEFAULT 3600,
    "priority" INTEGER,
    "weight" INTEGER,
    "port" INTEGER,
    "managedByWebEdge" BOOLEAN NOT NULL DEFAULT false,
    "providerRecordId" TEXT,
    "providerSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dns_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "dns_records_domainId_idx" ON "public"."dns_records"("domainId");

-- CreateIndex
CREATE INDEX "dns_records_domainId_name_idx" ON "public"."dns_records"("domainId", "name");

-- AddForeignKey
ALTER TABLE "public"."dns_records" ADD CONSTRAINT "dns_records_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "public"."domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
