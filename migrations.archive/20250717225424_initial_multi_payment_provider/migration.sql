-- CreateEnum
CREATE TYPE "subscription_status" AS ENUM ('TRIAL', 'ACTIVE', 'PAST_DUE', 'CANCELED', 'SUSPENDED', 'EXPIRED');

-- CreateEnum
CREATE TYPE "subscription_plan" AS ENUM ('BASIC', 'STANDARD', 'PRO', 'PREMIUM');

-- CreateEnum
CREATE TYPE "payment_provider" AS ENUM ('STRIPE', 'PAYPAL', 'SQUARE', 'CLOVER', 'WECHAT', 'ALIPAY', 'UNIONPAY');

-- CreateTable
CREATE TABLE "tenants" (
    "id" UUID NOT NULL,
    "email" VARCHAR(255) NOT NULL,
    "password_hash" VARCHAR(255) NOT NULL,
    "store_name" VARCHAR(100) NOT NULL,
    "subdomain" VARCHAR(50) NOT NULL,
    "phone" VARCHAR(20) NOT NULL,
    "address" VARCHAR(500),
    "email_verified_at" TIMESTAMP(3),
    "password_reset_token" VARCHAR(255),
    "password_reset_expires_at" TIMESTAMP(3),
    "email_verification_token" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscriptions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "status" "subscription_status" NOT NULL DEFAULT 'TRIAL',
    "plan" "subscription_plan" NOT NULL DEFAULT 'BASIC',
    "billing_cycle" VARCHAR(20) NOT NULL DEFAULT 'monthly',
    "current_period_start" TIMESTAMP(3),
    "current_period_end" TIMESTAMP(3),
    "trial_ends_at" TIMESTAMP(3),
    "cancel_at_period_end" BOOLEAN NOT NULL DEFAULT false,
    "canceled_at" TIMESTAMP(3),
    "cancellation_reason" VARCHAR(255),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "amount_cents" INTEGER,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_integrations" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "provider_customer_id" VARCHAR(255) NOT NULL,
    "provider_subscription_id" VARCHAR(255),
    "provider_data" JSONB,
    "provider_status" VARCHAR(50),
    "last_sync_at" TIMESTAMP(3),
    "sync_error" TEXT,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "webhook_endpoint" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_integrations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_methods" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "provider" "payment_provider" NOT NULL,
    "provider_payment_method_id" VARCHAR(255) NOT NULL,
    "type" VARCHAR(20) NOT NULL,
    "brand" VARCHAR(20),
    "last4" VARCHAR(4),
    "exp_month" INTEGER,
    "exp_year" INTEGER,
    "is_default" BOOLEAN NOT NULL DEFAULT false,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "provider_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_methods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payment_events" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID,
    "payment_integration_id" UUID,
    "payment_method_id" UUID,
    "provider" "payment_provider" NOT NULL,
    "provider_event_id" VARCHAR(255) NOT NULL,
    "event_type" VARCHAR(100) NOT NULL,
    "processed" BOOLEAN NOT NULL DEFAULT false,
    "processed_at" TIMESTAMP(3),
    "retry_count" INTEGER NOT NULL DEFAULT 0,
    "max_retries" INTEGER NOT NULL DEFAULT 3,
    "event_data" JSONB,
    "error_message" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payment_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "subscription_history" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "action" VARCHAR(50) NOT NULL,
    "old_status" "subscription_status",
    "new_status" "subscription_status",
    "old_plan" "subscription_plan",
    "new_plan" "subscription_plan",
    "payment_event_id" UUID,
    "changes" JSONB,
    "reason" VARCHAR(255),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "subscription_history_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "subscription_id" UUID NOT NULL,
    "payment_integration_id" UUID,
    "provider" "payment_provider",
    "provider_invoice_id" VARCHAR(255),
    "invoice_number" VARCHAR(100),
    "currency" VARCHAR(3) NOT NULL DEFAULT 'CAD',
    "subtotal_cents" INTEGER NOT NULL,
    "tax_cents" INTEGER NOT NULL DEFAULT 0,
    "total_cents" INTEGER NOT NULL,
    "status" VARCHAR(20) NOT NULL,
    "period_start" TIMESTAMP(3),
    "period_end" TIMESTAMP(3),
    "due_date" TIMESTAMP(3),
    "paid_at" TIMESTAMP(3),
    "invoice_data" JSONB,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "sessions" (
    "id" UUID NOT NULL,
    "tenant_id" UUID NOT NULL,
    "token_hash" VARCHAR(255) NOT NULL,
    "refresh_token" VARCHAR(255),
    "user_agent" TEXT,
    "ip_address" VARCHAR(45),
    "expires_at" TIMESTAMP(3) NOT NULL,
    "deleted_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "sessions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "token_blacklist" (
    "id" TEXT NOT NULL,
    "jti" TEXT NOT NULL,
    "tenant_id" UUID,
    "expires_at" TIMESTAMP(3) NOT NULL,
    "reason" TEXT NOT NULL DEFAULT 'revoked',
    "revoke_all_before" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "token_blacklist_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "tenants_email_key" ON "tenants"("email");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_subdomain_key" ON "tenants"("subdomain");

-- CreateIndex
CREATE UNIQUE INDEX "tenants_phone_key" ON "tenants"("phone");

-- CreateIndex
CREATE INDEX "tenants_email_idx" ON "tenants"("email");

-- CreateIndex
CREATE INDEX "tenants_subdomain_idx" ON "tenants"("subdomain");

-- CreateIndex
CREATE INDEX "tenants_phone_idx" ON "tenants"("phone");

-- CreateIndex
CREATE INDEX "tenants_created_at_idx" ON "tenants"("created_at");

-- CreateIndex
CREATE INDEX "subscriptions_tenant_id_idx" ON "subscriptions"("tenant_id");

-- CreateIndex
CREATE INDEX "subscriptions_status_idx" ON "subscriptions"("status");

-- CreateIndex
CREATE INDEX "subscriptions_current_period_end_idx" ON "subscriptions"("current_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_cancel_at_period_end_idx" ON "subscriptions"("cancel_at_period_end");

-- CreateIndex
CREATE INDEX "subscriptions_trial_ends_at_idx" ON "subscriptions"("trial_ends_at");

-- CreateIndex
CREATE INDEX "payment_integrations_tenant_id_idx" ON "payment_integrations"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_integrations_subscription_id_idx" ON "payment_integrations"("subscription_id");

-- CreateIndex
CREATE INDEX "payment_integrations_provider_idx" ON "payment_integrations"("provider");

-- CreateIndex
CREATE INDEX "payment_integrations_provider_customer_id_idx" ON "payment_integrations"("provider_customer_id");

-- CreateIndex
CREATE INDEX "payment_integrations_provider_subscription_id_idx" ON "payment_integrations"("provider_subscription_id");

-- CreateIndex
CREATE INDEX "payment_integrations_is_active_idx" ON "payment_integrations"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_integrations_provider_provider_customer_id_key" ON "payment_integrations"("provider", "provider_customer_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_integrations_provider_provider_subscription_id_key" ON "payment_integrations"("provider", "provider_subscription_id");

-- CreateIndex
CREATE INDEX "payment_methods_tenant_id_idx" ON "payment_methods"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_methods_provider_idx" ON "payment_methods"("provider");

-- CreateIndex
CREATE INDEX "payment_methods_is_default_idx" ON "payment_methods"("is_default");

-- CreateIndex
CREATE INDEX "payment_methods_is_active_idx" ON "payment_methods"("is_active");

-- CreateIndex
CREATE UNIQUE INDEX "payment_methods_provider_provider_payment_method_id_key" ON "payment_methods"("provider", "provider_payment_method_id");

-- CreateIndex
CREATE UNIQUE INDEX "payment_events_provider_event_id_key" ON "payment_events"("provider_event_id");

-- CreateIndex
CREATE INDEX "payment_events_tenant_id_idx" ON "payment_events"("tenant_id");

-- CreateIndex
CREATE INDEX "payment_events_subscription_id_idx" ON "payment_events"("subscription_id");

-- CreateIndex
CREATE INDEX "payment_events_provider_idx" ON "payment_events"("provider");

-- CreateIndex
CREATE INDEX "payment_events_event_type_idx" ON "payment_events"("event_type");

-- CreateIndex
CREATE INDEX "payment_events_processed_idx" ON "payment_events"("processed");

-- CreateIndex
CREATE INDEX "payment_events_retry_count_idx" ON "payment_events"("retry_count");

-- CreateIndex
CREATE INDEX "payment_events_created_at_idx" ON "payment_events"("created_at");

-- CreateIndex
CREATE INDEX "subscription_history_tenant_id_idx" ON "subscription_history"("tenant_id");

-- CreateIndex
CREATE INDEX "subscription_history_subscription_id_idx" ON "subscription_history"("subscription_id");

-- CreateIndex
CREATE INDEX "subscription_history_action_idx" ON "subscription_history"("action");

-- CreateIndex
CREATE INDEX "subscription_history_created_at_idx" ON "subscription_history"("created_at");

-- CreateIndex
CREATE INDEX "invoices_tenant_id_idx" ON "invoices"("tenant_id");

-- CreateIndex
CREATE INDEX "invoices_subscription_id_idx" ON "invoices"("subscription_id");

-- CreateIndex
CREATE INDEX "invoices_status_idx" ON "invoices"("status");

-- CreateIndex
CREATE INDEX "invoices_due_date_idx" ON "invoices"("due_date");

-- CreateIndex
CREATE INDEX "invoices_created_at_idx" ON "invoices"("created_at");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_provider_provider_invoice_id_key" ON "invoices"("provider", "provider_invoice_id");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_token_hash_key" ON "sessions"("token_hash");

-- CreateIndex
CREATE UNIQUE INDEX "sessions_refresh_token_key" ON "sessions"("refresh_token");

-- CreateIndex
CREATE INDEX "sessions_tenant_id_idx" ON "sessions"("tenant_id");

-- CreateIndex
CREATE INDEX "sessions_token_hash_idx" ON "sessions"("token_hash");

-- CreateIndex
CREATE INDEX "sessions_expires_at_idx" ON "sessions"("expires_at");

-- CreateIndex
CREATE INDEX "sessions_created_at_idx" ON "sessions"("created_at");

-- CreateIndex
CREATE INDEX "sessions_deleted_at_idx" ON "sessions"("deleted_at");

-- CreateIndex
CREATE UNIQUE INDEX "token_blacklist_jti_key" ON "token_blacklist"("jti");

-- CreateIndex
CREATE INDEX "token_blacklist_jti_idx" ON "token_blacklist"("jti");

-- CreateIndex
CREATE INDEX "token_blacklist_tenant_id_idx" ON "token_blacklist"("tenant_id");

-- CreateIndex
CREATE INDEX "token_blacklist_expires_at_idx" ON "token_blacklist"("expires_at");

-- AddForeignKey
ALTER TABLE "subscriptions" ADD CONSTRAINT "subscriptions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_integrations" ADD CONSTRAINT "payment_integrations_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_methods" ADD CONSTRAINT "payment_methods_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_integration_id_fkey" FOREIGN KEY ("payment_integration_id") REFERENCES "payment_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payment_events" ADD CONSTRAINT "payment_events_payment_method_id_fkey" FOREIGN KEY ("payment_method_id") REFERENCES "payment_methods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "subscription_history" ADD CONSTRAINT "subscription_history_payment_event_id_fkey" FOREIGN KEY ("payment_event_id") REFERENCES "payment_events"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_subscription_id_fkey" FOREIGN KEY ("subscription_id") REFERENCES "subscriptions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_payment_integration_id_fkey" FOREIGN KEY ("payment_integration_id") REFERENCES "payment_integrations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_tenant_id_fkey" FOREIGN KEY ("tenant_id") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;
