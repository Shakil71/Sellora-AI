-- CreateEnum
CREATE TYPE "ChannelConnectionStatus" AS ENUM ('CONNECTED', 'ERROR', 'DISABLED');

-- CreateEnum
CREATE TYPE "WebhookDeliveryStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "ChannelType" ADD VALUE 'WEB_CHAT';
ALTER TYPE "ChannelType" ADD VALUE 'MESSENGER';
ALTER TYPE "ChannelType" ADD VALUE 'INSTAGRAM';

-- AlterTable
ALTER TABLE "Conversation" ADD COLUMN     "channelConnectionId" UUID,
ADD COLUMN     "channelContactId" UUID;

-- CreateTable
CREATE TABLE "ChannelConnection" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "type" "ChannelType" NOT NULL,
    "name" TEXT NOT NULL,
    "externalId" TEXT NOT NULL,
    "pageId" TEXT,
    "accessTokenEnc" TEXT,
    "appSecretEnc" TEXT,
    "verifyToken" TEXT,
    "settings" JSONB NOT NULL DEFAULT '{}',
    "status" "ChannelConnectionStatus" NOT NULL DEFAULT 'CONNECTED',
    "lastError" TEXT,
    "lastVerifiedAt" TIMESTAMP(3),
    "defaultAgentId" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ChannelContact" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "connectionId" UUID NOT NULL,
    "externalUserId" TEXT NOT NULL,
    "profileName" TEXT,
    "customerId" UUID,
    "lastMessageAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ChannelContact_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookEndpoint" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "url" TEXT NOT NULL,
    "description" TEXT,
    "events" TEXT[],
    "secretEnc" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "lastStatus" INTEGER,
    "lastError" TEXT,
    "lastDeliveryAt" TIMESTAMP(3),
    "consecutiveFailures" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "WebhookEndpoint_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "WebhookDelivery" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "endpointId" UUID NOT NULL,
    "event" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "status" "WebhookDeliveryStatus" NOT NULL DEFAULT 'PENDING',
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "responseStatus" INTEGER,
    "responseBody" TEXT,
    "error" TEXT,
    "durationMs" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),

    CONSTRAINT "WebhookDelivery_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChannelConnection_tenantId_type_idx" ON "ChannelConnection"("tenantId", "type");

-- CreateIndex
CREATE INDEX "ChannelConnection_verifyToken_idx" ON "ChannelConnection"("verifyToken");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelConnection_type_externalId_key" ON "ChannelConnection"("type", "externalId");

-- CreateIndex
CREATE INDEX "ChannelContact_tenantId_idx" ON "ChannelContact"("tenantId");

-- CreateIndex
CREATE UNIQUE INDEX "ChannelContact_connectionId_externalUserId_key" ON "ChannelContact"("connectionId", "externalUserId");

-- CreateIndex
CREATE INDEX "WebhookEndpoint_tenantId_idx" ON "WebhookEndpoint"("tenantId");

-- CreateIndex
CREATE INDEX "WebhookDelivery_endpointId_createdAt_idx" ON "WebhookDelivery"("endpointId", "createdAt");

-- CreateIndex
CREATE INDEX "WebhookDelivery_tenantId_createdAt_idx" ON "WebhookDelivery"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "Conversation_channelConnectionId_channelContactId_idx" ON "Conversation"("channelConnectionId", "channelContactId");

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelConnectionId_fkey" FOREIGN KEY ("channelConnectionId") REFERENCES "ChannelConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_channelContactId_fkey" FOREIGN KEY ("channelContactId") REFERENCES "ChannelContact"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelConnection" ADD CONSTRAINT "ChannelConnection_defaultAgentId_fkey" FOREIGN KEY ("defaultAgentId") REFERENCES "AIAgent"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContact" ADD CONSTRAINT "ChannelContact_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContact" ADD CONSTRAINT "ChannelContact_connectionId_fkey" FOREIGN KEY ("connectionId") REFERENCES "ChannelConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ChannelContact" ADD CONSTRAINT "ChannelContact_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "Customer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookEndpoint" ADD CONSTRAINT "WebhookEndpoint_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "WebhookDelivery" ADD CONSTRAINT "WebhookDelivery_endpointId_fkey" FOREIGN KEY ("endpointId") REFERENCES "WebhookEndpoint"("id") ON DELETE CASCADE ON UPDATE CASCADE;
