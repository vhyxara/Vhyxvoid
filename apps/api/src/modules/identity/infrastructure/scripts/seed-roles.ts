// scripts/seed-roles.ts

// import { prisma } from "@/core/config/prisma.config";
import { SYSTEM_ABILITIES } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";
import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient();
/**
 * System roles with their assigned abilities
 */
const SYSTEM_ROLES = [
  {
    name: "Super Admin",
    description: "Full system access (immutable)",
    abilities: [
      // All abilities assigned
      "user.create",
      "user.read",
      "user.update",
      "user.delete",
      "role.create",
      "role.read",
      "role.update",
      "role.delete",
      "role.assign",
      "ability.create",
      "ability.read",
      "ability.update",
      "ability.delete",
      "admin.create",
      "admin.read",
      "admin.update",
      "admin.delete",
      "admin.enable",
      "admin.disable",
      "audit.read",
      "audit.export",
      "settings.read",
      "settings.update",
    ],
  },
  {
    name: "Admin",
    description: "Can manage users and roles",
    abilities: [
      "user.create",
      "user.read",
      "user.update",
      "user.delete",
      "role.create",
      "role.read",
      "role.update",
      "role.delete",
      "role.assign",
      "admin.create",
      "admin.read",
      "admin.update",
      "admin.delete",
      "admin.enable",
      "admin.disable",
      "audit.read",
      "settings.read",
    ],
  },
  {
    name: "Moderator",
    description: "Can moderate users and view logs",
    abilities: ["user.read", "user.update", "admin.read", "audit.read"],
  },
  {
    name: "Operator",
    description: "Can view data and perform basic operations",
    abilities: ["user.read", "role.read", "admin.read", "audit.read"],
  },
];

async function seedRoles() {
  try {
    console.log("🌱 Seeding system roles...\n");

    for (const roleData of SYSTEM_ROLES) {
      const existing = await prisma.adminRole.findUnique({
        where: { name: roleData.name },
      });

      if (existing) {
        console.log(`⏭️  Skipped (exists): ${roleData.name}`);
        continue;
      }

      // Create role
      const role = await prisma.adminRole.create({
        data: {
          id: crypto.randomUUID(),
          name: roleData.name,
          description: roleData.description,
          isSystem: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(`✅ Created role: ${roleData.name}`);

      // Assign abilities to role
      for (const abilityAction of roleData.abilities) {
        const abilityDef = Object.values(SYSTEM_ABILITIES).find(
          (a) => a.action === abilityAction,
        );

        if (!abilityDef) {
          console.warn(
            `⚠️ Ability not found in SYSTEM_ABILITIES: ${abilityAction}`,
          );
          continue;
        }

        const ability = await prisma.adminAbility.findUnique({
          where: {
            category_action: {
              category: abilityDef.category,
              action: abilityDef.action,
            },
          },
        });

        if (!ability) {
          console.warn(`   ⚠️  Ability not found: ${abilityAction}`);
          continue;
        }

        await prisma.adminRoleAbility.upsert({
          where: {
            roleId_abilityId: {
              roleId: role.id,
              abilityId: ability.id,
            },
          },
          update: {},
          create: {
            roleId: role.id,
            abilityId: ability.id,
          },
        });
      }

      console.log(`   ├─ Assigned ${roleData.abilities.length} abilities`);
    }

    console.log(
      `\n✨ Successfully seeded ${SYSTEM_ROLES.length} system roles!`,
    );
  } catch (error) {
    console.error("❌ Error seeding roles:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedRoles();
