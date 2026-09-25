-- Admin access tokens become revocable (logout): see AdminUser.tokenVersion.
ALTER TABLE "AdminUser" ADD COLUMN "tokenVersion" INTEGER NOT NULL DEFAULT 0;
