// scripts/seed-super-admin.ts

// import { prisma } from "@/core/config/prisma.config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient();

/**
 * Super Admin Account (First Admin)
 * ⚠️ CHANGE THESE CREDENTIALS BEFORE DEPLOYING TO PRODUCTION
 */
const SUPER_ADMIN = {
  email: "admin@company.local",
  password: "Admin@12345678", // ⚠️ Change this!
  firstName: "Super",
  lastName: "Admin",
};

async function seedSuperAdmin() {
  try {
    console.log("🌱 Creating super admin account...\n");

    // Check if super admin already exists
    const existing = await prisma.adminUser.findFirst({
      where: { isSuperAdmin: true },
    });

    if (existing) {
      console.log(`⏭️  Super admin already exists: ${existing.email}`);
      console.log(`⏭️  Skipping creation\n`);
      console.log(
        "📝 If you need to reset password, run: npm run reset-admin-password",
      );
      return;
    }

    // Check if email already taken
    const emailTaken = await prisma.adminUser.findUnique({
      where: { email: SUPER_ADMIN.email },
    });

    if (emailTaken) {
      console.error(`❌ Email already exists: ${SUPER_ADMIN.email}`);
      console.error(
        "⚠️  Please use a different email or delete the existing admin",
      );
      process.exit(1);
    }

    // Hash password
    console.log("🔐 Hashing password...");
    const passwordHash = await bcrypt.hash(SUPER_ADMIN.password, 12);

    // Create super admin
    const superAdmin = await prisma.adminUser.create({
      data: {
        id: crypto.randomUUID(),
        email: SUPER_ADMIN.email,
        passwordHash,
        firstName: SUPER_ADMIN.firstName,
        lastName: SUPER_ADMIN.lastName,
        isSuperAdmin: true, // ← Super admin flag
        status: true,
        createdAt: new Date(),
        updatedAt: new Date(),
        deletedAt: null,
      },
    });

    console.log(`✅ Super admin created successfully!\n`);
    console.log("📋 Super Admin Credentials:");
    console.log(`   Email:    ${SUPER_ADMIN.email}`);
    console.log(`   Password: ${SUPER_ADMIN.password}`);
    console.log(`   ID:       ${superAdmin.id}`);
    console.log(`\n⚠️  IMPORTANT:`);
    console.log(`   1. Change password immediately after first login`);
    console.log(`   2. Do NOT commit this script with real credentials`);
    console.log(`   3. Use environment variables for production`);
    console.log(`\n🔐 Create additional admins via the API:`);
    console.log(`   POST /admin/users (requires admin.create ability)`);
  } catch (error) {
    console.error("❌ Error creating super admin:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedSuperAdmin();
