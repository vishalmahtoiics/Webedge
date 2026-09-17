-- CreateEnum
CREATE TYPE "public"."Realm" AS ENUM ('ADMIN', 'CUSTOMER');

-- CreateEnum
CREATE TYPE "public"."AdminRoleName" AS ENUM ('SUPER_ADMIN', 'ADMIN', 'SUPPORT_STAFF');

-- CreateEnum
CREATE TYPE "public"."AccountStatus" AS ENUM ('PENDING_VERIFICATION', 'ACTIVE', 'SUSPENDED', 'TERMINATED');

-- CreateEnum
CREATE TYPE "public"."ProviderKind" AS ENUM ('HOSTINGER');

-- CreateEnum
CREATE TYPE "public"."ProviderAccountStatus" AS ENUM ('ACTIVE', 'DISABLED', 'DEGRADED');

-- CreateEnum
CREATE TYPE "public"."WebsiteStatus" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'FAILED', 'ORPHANED');

-- CreateEnum
CREATE TYPE "public"."DomainStatus" AS ENUM ('ACTIVE', 'EXPIRING_SOON', 'EXPIRED', 'PENDING_TRANSFER', 'PENDING_VERIFICATION');

-- CreateEnum
CREATE TYPE "public"."SubscriptionStatus" AS ENUM ('ACTIVE', 'PAST_DUE', 'CANCELLED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "public"."BillingCycle" AS ENUM ('MONTHLY', 'QUARTERLY', 'YEARLY', 'BIENNIAL', 'TRIENNIAL');

-- CreateEnum
CREATE TYPE "public"."LogVisibility" AS ENUM ('CUSTOMER', 'INTERNAL');

-- CreateTable
CREATE TABLE "public"."admin_users" (
    "id" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "public"."AccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "roleId" UUID NOT NULL,
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "recoveryCodeHashes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admin_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customers" (
    "id" UUID NOT NULL,
    "companyName" TEXT,
    "fullName" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "status" "public"."AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "billingState" TEXT,
    "gstin" TEXT,
    "internalNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."customer_users" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "email" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "status" "public"."AccountStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "roleId" UUID NOT NULL,
    "emailVerifiedAt" TIMESTAMP(3),
    "totpSecret" TEXT,
    "totpEnabledAt" TIMESTAMP(3),
    "lastLoginAt" TIMESTAMP(3),
    "failedLoginCount" INTEGER NOT NULL DEFAULT 0,
    "lockedUntil" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "customer_users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."roles" (
    "id" UUID NOT NULL,
    "realm" "public"."Realm" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isSystem" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "roles_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."permissions" (
    "id" UUID NOT NULL,
    "key" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "realm" "public"."Realm" NOT NULL,
    "description" TEXT NOT NULL,

    CONSTRAINT "permissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."role_permissions" (
    "roleId" UUID NOT NULL,
    "permissionId" UUID NOT NULL,

    CONSTRAINT "role_permissions_pkey" PRIMARY KEY ("roleId","permissionId")
);

-- CreateTable
CREATE TABLE "public"."refresh_tokens" (
    "id" UUID NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "realm" "public"."Realm" NOT NULL,
    "adminUserId" UUID,
    "customerUserId" UUID,
    "replacedById" UUID,
    "revokedAt" TIMESTAMP(3),
    "userAgent" TEXT,
    "ipAddress" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "refresh_tokens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hosting_accounts" (
    "id" UUID NOT NULL,
    "provider" "public"."ProviderKind" NOT NULL DEFAULT 'HOSTINGER',
    "accountName" TEXT NOT NULL,
    "status" "public"."ProviderAccountStatus" NOT NULL DEFAULT 'ACTIVE',
    "productFamily" TEXT,
    "websiteSlotsTotal" INTEGER,
    "websiteSlotsUsed" INTEGER NOT NULL DEFAULT 0,
    "lastSyncedAt" TIMESTAMP(3),
    "lastErrorAt" TIMESTAMP(3),
    "lastError" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."api_credentials" (
    "id" UUID NOT NULL,
    "hostingAccountId" UUID NOT NULL,
    "label" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "lastFour" TEXT,
    "expiresAt" TIMESTAMP(3),
    "lastVerifiedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "api_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."websites" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "hostingAccountId" UUID,
    "domain" TEXT NOT NULL,
    "status" "public"."WebsiteStatus" NOT NULL DEFAULT 'PROVISIONING',
    "providerResourceId" TEXT,
    "providerUsername" TEXT,
    "documentRoot" TEXT,
    "phpVersion" TEXT,
    "diskUsedBytes" BIGINT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "websites_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."domains" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "status" "public"."DomainStatus" NOT NULL DEFAULT 'ACTIVE',
    "registrar" TEXT,
    "expiresAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "registrarLock" BOOLEAN NOT NULL DEFAULT true,
    "privacyEnabled" BOOLEAN NOT NULL DEFAULT false,
    "nameservers" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dnsManaged" BOOLEAN NOT NULL DEFAULT false,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "domains_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."hosting_plans" (
    "id" UUID NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "description" TEXT,
    "isPublic" BOOLEAN NOT NULL DEFAULT true,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "maxWebsites" INTEGER,
    "maxDomains" INTEGER,
    "maxDatabases" INTEGER,
    "maxMailboxes" INTEGER,
    "storageGb" INTEGER,
    "mailboxQuotaGb" INTEGER,
    "priceInPaise" INTEGER NOT NULL,
    "billingCycle" "public"."BillingCycle" NOT NULL DEFAULT 'YEARLY',
    "providerProduct" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "hosting_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."subscriptions" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "planId" UUID NOT NULL,
    "status" "public"."SubscriptionStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "renewsAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "autoRenew" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."activity_logs" (
    "id" UUID NOT NULL,
    "adminUserId" UUID,
    "customerUserId" UUID,
    "impersonatorAdminId" UUID,
    "customerId" UUID,
    "action" TEXT NOT NULL,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "oldValue" JSONB,
    "newValue" JSONB,
    "visibility" "public"."LogVisibility" NOT NULL DEFAULT 'INTERNAL',
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "activity_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public"."notifications" (
    "id" UUID NOT NULL,
    "customerId" UUID NOT NULL,
    "category" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actionUrl" TEXT,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "admin_users_email_key" ON "public"."admin_users"("email");

-- CreateIndex
CREATE INDEX "admin_users_status_idx" ON "public"."admin_users"("status");

-- CreateIndex
CREATE UNIQUE INDEX "customers_email_key" ON "public"."customers"("email");

-- CreateIndex
CREATE INDEX "customers_status_idx" ON "public"."customers"("status");

-- CreateIndex
CREATE UNIQUE INDEX "customer_users_email_key" ON "public"."customer_users"("email");

-- CreateIndex
CREATE INDEX "customer_users_customerId_idx" ON "public"."customer_users"("customerId");

-- CreateIndex
CREATE UNIQUE INDEX "roles_realm_name_key" ON "public"."roles"("realm", "name");

-- CreateIndex
CREATE UNIQUE INDEX "permissions_key_key" ON "public"."permissions"("key");

-- CreateIndex
CREATE INDEX "permissions_module_idx" ON "public"."permissions"("module");

-- CreateIndex
CREATE UNIQUE INDEX "refresh_tokens_tokenHash_key" ON "public"."refresh_tokens"("tokenHash");

-- CreateIndex
CREATE INDEX "refresh_tokens_adminUserId_idx" ON "public"."refresh_tokens"("adminUserId");

-- CreateIndex
CREATE INDEX "refresh_tokens_customerUserId_idx" ON "public"."refresh_tokens"("customerUserId");

-- CreateIndex
CREATE INDEX "refresh_tokens_expiresAt_idx" ON "public"."refresh_tokens"("expiresAt");

-- CreateIndex
CREATE INDEX "hosting_accounts_status_idx" ON "public"."hosting_accounts"("status");

-- CreateIndex
CREATE INDEX "api_credentials_hostingAccountId_idx" ON "public"."api_credentials"("hostingAccountId");

-- CreateIndex
CREATE UNIQUE INDEX "websites_domain_key" ON "public"."websites"("domain");

-- CreateIndex
CREATE INDEX "websites_customerId_idx" ON "public"."websites"("customerId");

-- CreateIndex
CREATE INDEX "websites_hostingAccountId_idx" ON "public"."websites"("hostingAccountId");

-- CreateIndex
CREATE INDEX "websites_status_idx" ON "public"."websites"("status");

-- CreateIndex
CREATE UNIQUE INDEX "domains_name_key" ON "public"."domains"("name");

-- CreateIndex
CREATE INDEX "domains_customerId_idx" ON "public"."domains"("customerId");

-- CreateIndex
CREATE INDEX "domains_expiresAt_idx" ON "public"."domains"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "hosting_plans_slug_key" ON "public"."hosting_plans"("slug");

-- CreateIndex
CREATE INDEX "hosting_plans_isPublic_isActive_idx" ON "public"."hosting_plans"("isPublic", "isActive");

-- CreateIndex
CREATE INDEX "subscriptions_customerId_idx" ON "public"."subscriptions"("customerId");

-- CreateIndex
CREATE INDEX "subscriptions_renewsAt_idx" ON "public"."subscriptions"("renewsAt");

-- CreateIndex
CREATE INDEX "activity_logs_customerId_createdAt_idx" ON "public"."activity_logs"("customerId", "createdAt");

-- CreateIndex
CREATE INDEX "activity_logs_action_idx" ON "public"."activity_logs"("action");

-- CreateIndex
CREATE INDEX "activity_logs_createdAt_idx" ON "public"."activity_logs"("createdAt");

-- CreateIndex
CREATE INDEX "notifications_customerId_readAt_idx" ON "public"."notifications"("customerId", "readAt");

-- AddForeignKey
ALTER TABLE "public"."admin_users" ADD CONSTRAINT "admin_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_users" ADD CONSTRAINT "customer_users_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."customer_users" ADD CONSTRAINT "customer_users_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_roleId_fkey" FOREIGN KEY ("roleId") REFERENCES "public"."roles"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."role_permissions" ADD CONSTRAINT "role_permissions_permissionId_fkey" FOREIGN KEY ("permissionId") REFERENCES "public"."permissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "public"."admin_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."refresh_tokens" ADD CONSTRAINT "refresh_tokens_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "public"."customer_users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."api_credentials" ADD CONSTRAINT "api_credentials_hostingAccountId_fkey" FOREIGN KEY ("hostingAccountId") REFERENCES "public"."hosting_accounts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."websites" ADD CONSTRAINT "websites_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."websites" ADD CONSTRAINT "websites_hostingAccountId_fkey" FOREIGN KEY ("hostingAccountId") REFERENCES "public"."hosting_accounts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."domains" ADD CONSTRAINT "domains_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."subscriptions" ADD CONSTRAINT "subscriptions_planId_fkey" FOREIGN KEY ("planId") REFERENCES "public"."hosting_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_adminUserId_fkey" FOREIGN KEY ("adminUserId") REFERENCES "public"."admin_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_customerUserId_fkey" FOREIGN KEY ("customerUserId") REFERENCES "public"."customer_users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."activity_logs" ADD CONSTRAINT "activity_logs_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."customers"("id") ON DELETE CASCADE ON UPDATE CASCADE;
