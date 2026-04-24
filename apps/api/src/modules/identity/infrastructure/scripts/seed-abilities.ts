// scripts/seed-abilities.ts

// import { prisma } from "@/core/config/prisma.config";
import { SYSTEM_ABILITIES } from "@/modules/identity/domain/entities/admin/AdminAbility.entities";
import { PrismaClient } from "@/generated/prisma";

const prisma = new PrismaClient();

async function seedAbilities() {
  try {
    console.log("🌱 Seeding system abilities...");

    const abilities = Object.values(SYSTEM_ABILITIES);

    for (const ability of abilities) {
      const existing = await prisma.adminAbility.findUnique({
        where: {
          category_action: {
            category: ability.category,
            action: ability.action,
          },
        },
      });

      if (existing) {
        console.log(`⏭️  Skipped (exists): ${ability.action}`);
        continue;
      }

      await prisma.adminAbility.create({
        data: {
          id: crypto.randomUUID(),
          action: ability.action,
          category: ability.category,
          description: ability.description,
          isSystem: true,
          isActive: true,
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      });

      console.log(`✅ Created: ${ability.action}`);
    }

    console.log(
      `\n✨ Successfully seeded ${abilities.length} system abilities!`,
    );
  } catch (error) {
    console.error("❌ Error seeding abilities:", error);
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

seedAbilities();
