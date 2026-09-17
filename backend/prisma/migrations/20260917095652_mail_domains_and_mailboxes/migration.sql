-- CreateEnum
CREATE TYPE "public"."MailDomainStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED');

-- CreateTable
CREATE TABLE "public"."mail_domains" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."MailDomainStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verificationToken" TEXT NOT NULL,
    "verifiedAt" TIMESTAMP(3),
    "quotaMib" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mailboxes" (
    "id" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "localPart" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "displayName" TEXT,
    "quotaMib" INTEGER,
    "usedMib" INTEGER,
    "usageSyncedAt" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mailboxes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."mail_aliases" (
    "id" UUID NOT NULL,
    "domainId" UUID NOT NULL,
    "localPart" TEXT NOT NULL,
    "destinations" TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mail_aliases_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "mail_domains_name_key" ON "public"."mail_domains"("name");

-- CreateIndex
CREATE INDEX "mail_domains_customerId_idx" ON "public"."mail_domains"("customerId");

-- CreateIndex
CREATE INDEX "mailboxes_domainId_idx" ON "public"."mailboxes"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "mailboxes_domainId_localPart_key" ON "public"."mailboxes"("domainId", "localPart");

-- CreateIndex
CREATE INDEX "mail_aliases_domainId_idx" ON "public"."mail_aliases"("domainId");

-- CreateIndex
CREATE UNIQUE INDEX "mail_aliases_domainId_localPart_key" ON "public"."mail_aliases"("domainId", "localPart");

-- AddForeignKey
ALTER TABLE "public"."mail_domains" ADD CONSTRAINT "mail_domains_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mailboxes" ADD CONSTRAINT "mailboxes_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "public"."mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."mail_aliases" ADD CONSTRAINT "mail_aliases_domainId_fkey" FOREIGN KEY ("domainId") REFERENCES "public"."mail_domains"("id") ON DELETE CASCADE ON UPDATE CASCADE;
