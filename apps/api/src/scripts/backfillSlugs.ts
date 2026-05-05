import { PrismaClient } from "@/generated/prisma";
import { slugify, slugifyWithSuffix } from "@/core/utils/slug.util";

const prisma = new PrismaClient();

async function backfill() {
  const accounts = await prisma.account.findMany({
    where: { slug: null },
    select: { id: true, name: true },
  });

  console.log(`Backfilling ${accounts.length} accounts...`);

  for (const account of accounts) {
    const base = slugify(account.name ?? "workspace");
    const existing = await prisma.account.findUnique({ where: { slug: base } });
    const slug = existing
      ? slugifyWithSuffix(account.name ?? "workspace")
      : base;

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
