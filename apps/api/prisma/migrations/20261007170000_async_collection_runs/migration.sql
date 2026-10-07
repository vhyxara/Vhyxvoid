-- AlterTable
ALTER TABLE "api_test_runs" ADD COLUMN     "error" TEXT,
ADD COLUMN     "rateLimited" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'done',
ALTER COLUMN "report" DROP NOT NULL;

