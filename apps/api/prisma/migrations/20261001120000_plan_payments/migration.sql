-- CreateEnum
CREATE TYPE "PlanPaymentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "PlanPayment" (
    "id" UUID NOT NULL,
    "tenantId" UUID NOT NULL,
    "plan" "SubscriptionPlan" NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "currency" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "reference" TEXT NOT NULL,
    "note" TEXT,
    "status" "PlanPaymentStatus" NOT NULL DEFAULT 'PENDING',
    "reviewNote" TEXT,
    "reviewedById" UUID,
    "reviewedAt" TIMESTAMP(3),
    "submittedById" UUID,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PlanPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PlanPayment_status_createdAt_idx" ON "PlanPayment"("status", "createdAt");

-- CreateIndex
CREATE INDEX "PlanPayment_tenantId_createdAt_idx" ON "PlanPayment"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "PlanPayment_reference_idx" ON "PlanPayment"("reference");

-- AddForeignKey
ALTER TABLE "PlanPayment" ADD CONSTRAINT "PlanPayment_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;
