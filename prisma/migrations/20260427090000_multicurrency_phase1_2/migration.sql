-- Multi-currency and provider metadata for subscription plans/history
ALTER TABLE "PlanHistory"
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
ADD COLUMN "providerSubscriptionId" TEXT,
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'INR',
ADD COLUMN "amountMinor" INTEGER,
ADD COLUMN "billingCountry" TEXT,
ADD COLUMN "paymentMethodType" TEXT;

UPDATE "PlanHistory"
SET "providerSubscriptionId" = "subscriptionId"
WHERE "providerSubscriptionId" IS NULL;

CREATE INDEX "PlanHistory_providerSubscriptionId_idx" ON "PlanHistory"("providerSubscriptionId");

ALTER TABLE "AdminPlan"
ADD COLUMN "amountMinor" INTEGER,
ADD COLUMN "provider" TEXT NOT NULL DEFAULT 'RAZORPAY',
ADD COLUMN "providerPlanId" TEXT,
ADD COLUMN "countryScope" TEXT;

UPDATE "AdminPlan"
SET "amountMinor" = GREATEST("priceInr", 1) * 100
WHERE "amountMinor" IS NULL;
