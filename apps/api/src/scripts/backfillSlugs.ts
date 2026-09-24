import { PrismaClient } from "@/generated/prisma";
import { generateAccountSlug } from "@/core/utils/slug.util";

const prisma = new PrismaClient();

async function backfill() {
  const accounts = await prisma.account.findMany({
    where: { slug: null },
    select: { id: true, name: true },
  });

  console.log(`Backfilling ${accounts.length} accounts...`);

  for (const account of accounts) {
    // Same non-guessable form as new accounts (audit H11).
    let slug = generateAccountSlug(account.name);
    while (await prisma.account.findUnique({ where: { slug } })) {
      slug = generateAccountSlug(account.name);
    }

    await prisma.account.update({
      where: { id: account.id },
      data: { slug },
    });

    console.log(`  ${account.name} → ${slug}`);
  }

  console.log("Done.");
  await prisma.$disconnect();
}

backfill().catch(console.error);
