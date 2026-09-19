-- CreateEnum
CREATE TYPE "public"."DiscoveredKind" AS ENUM ('DOMAIN', 'WEBSITE', 'VPS', 'SUBSCRIPTION');

-- CreateTable
CREATE TABLE "public"."discovered_resources" (
    "id" UUID NOT NULL,
    "hostingAccountId" UUID NOT NULL,
    "kind" "public"."DiscoveredKind" NOT NULL,
    "providerKey" TEXT NOT NULL,
    "name" TEXT,
    "status" TEXT,
    "expiresAt" TIMESTAMP(3),
    "raw" JSONB NOT NULL,
    "mapped" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "claimedByCustomerId" UUID,
    "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discovered_resources_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "discovered_resources_hostingAccountId_kind_idx" ON "public"."discovered_resources"("hostingAccountId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "discovered_resources_hostingAccountId_kind_providerKey_key" ON "public"."discovered_resources"("hostingAccountId", "kind", "providerKey");

-- AddForeignKey
ALTER TABLE "public"."discovered_resources" ADD CONSTRAINT "discovered_resources_hostingAccountId_fkey" FOREIGN KEY ("hostingAccountId") REFERENCES "public"."hosting_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

