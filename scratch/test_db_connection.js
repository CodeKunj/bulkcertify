import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

async function main() {
  try {
    await prisma.$connect();
    console.log("Successfully connected to the database.");
    const userCount = await prisma.user.count();
    console.log("Current user count:", userCount);
  } catch (error) {
    console.error("Failed to connect to the database:", error);
    process.exit(1);
  } finally {
    await prisma.$disconnect();
  }
}

main();
