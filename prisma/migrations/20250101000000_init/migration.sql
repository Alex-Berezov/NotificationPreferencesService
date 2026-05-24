-- CreateTable
CREATE TABLE "default_preferences" (
    "notification_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,

    CONSTRAINT "default_preferences_pkey" PRIMARY KEY ("notification_type", "channel")
);

-- CreateTable
CREATE TABLE "user_preference_overrides" (
    "user_id" TEXT NOT NULL,
    "notification_type" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_preference_overrides_pkey" PRIMARY KEY ("user_id", "notification_type", "channel")
);

-- CreateIndex
CREATE INDEX "user_preference_overrides_user_id_idx" ON "user_preference_overrides" ("user_id");

-- CreateTable
CREATE TABLE "user_quiet_hours" (
    "user_id" TEXT NOT NULL,
    "start_minutes" INTEGER NOT NULL,
    "end_minutes" INTEGER NOT NULL,
    "timezone" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_quiet_hours_pkey" PRIMARY KEY ("user_id")
);

-- CreateTable
CREATE TABLE "global_policies" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "notification_type" TEXT NOT NULL,
    "region" TEXT NOT NULL,
    "channel" TEXT,
    "action" TEXT NOT NULL DEFAULT 'deny',
    "reason_code" TEXT NOT NULL DEFAULT 'blocked_by_global_policy',
    "created_at" TIMESTAMPTZ NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "global_policies_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "global_policies_action_check" CHECK ("action" = 'deny')
);

-- CreateIndex
CREATE INDEX "global_policies_notification_type_region_idx" ON "global_policies" ("notification_type", "region");

-- Sanity: prevent accidental duplicate wildcard or channel-specific policies per region.
CREATE UNIQUE INDEX "global_policies_unique_scope_idx"
    ON "global_policies" ("notification_type", "region", COALESCE("channel", ''));
