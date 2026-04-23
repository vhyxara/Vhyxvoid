// scripts/seed.ts

import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);

/**
 * Master seed script
 * Runs all seed files in correct order:
 * 1. Create system abilities (required for roles)
 * 2. Create system roles with abilities (required for admins)
 * 3. Create super admin (first admin user)
 */
async function runSeeds() {
  try {
    console.log('🌱 Starting seed process...\n');
    console.log('═══════════════════════════════════════════════════════════════\n');

    // Step 1: Seed abilities
    console.log('📍 Step 1/3: Seeding system abilities');
    console.log('───────────────────────────────────────────────────────────────\n');
    try {
      await execAsync('npx ts-node scripts/seed-abilities.ts');
    } catch (error: any) {
      console.error('Error running seed-abilities.ts:', error.message);
      process.exit(1);
    }

    console.log('\n───────────────────────────────────────────────────────────────\n');

    // Step 2: Seed roles
    console.log('📍 Step 2/3: Seeding system roles');
    console.log('───────────────────────────────────────────────────────────────\n');
    try {
      await execAsync('npx ts-node scripts/seed-roles.ts');
    } catch (error: any) {
      console.error('Error running seed-roles.ts:', error.message);
      process.exit(1);
    }

    console.log('\n───────────────────────────────────────────────────────────────\n');

    // Step 3: Create super admin
    console.log('📍 Step 3/3: Creating super admin account');
    console.log('───────────────────────────────────────────────────────────────\n');
    try {
      await execAsync('npx ts-node scripts/seed-super-admin.ts');
    } catch (error: any) {
      console.error('Error running seed-super-admin.ts:', error.message);
      process.exit(1);
    }

    console.log('\n═══════════════════════════════════════════════════════════════\n');
    console.log('✨ All seeds completed successfully!\n');
    console.log('🎉 Admin system is ready for testing!\n');
    console.log('📝 Next steps:');
    console.log('   1. Start the server: npm run dev');
    console.log('   2. Login with super admin credentials');
    console.log('   3. Create additional admins with different roles');
    console.log('   4. Test the audit logs\n');
  } catch (error) {
    console.error('❌ Seed process failed:', error);
    process.exit(1);
  }
}

runSeeds();
