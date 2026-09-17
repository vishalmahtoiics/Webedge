-- CreateTable
CREATE TABLE "public"."website_sftp_credentials" (
    "id" UUID NOT NULL,
    "websiteId" UUID NOT NULL,
    "host" TEXT NOT NULL,
    "port" INTEGER NOT NULL DEFAULT 22,
    "username" TEXT NOT NULL,
    "root" TEXT NOT NULL,
    "ciphertext" TEXT NOT NULL,
    "iv" TEXT NOT NULL,
    "authTag" TEXT NOT NULL,
    "keyVersion" TEXT NOT NULL,
    "lastVerifiedAt" TIMESTAMP(3),
    "lastError" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "website_sftp_credentials_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "website_sftp_credentials_websiteId_key" ON "public"."website_sftp_credentials"("websiteId");

-- AddForeignKey
ALTER TABLE "public"."website_sftp_credentials" ADD CONSTRAINT "website_sftp_credentials_websiteId_fkey" FOREIGN KEY ("websiteId") REFERENCES "public"."websites"("id") ON DELETE CASCADE ON UPDATE CASCADE;
