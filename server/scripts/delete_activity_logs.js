import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const args = process.argv.slice(2);
  let year, month, olderThanMonths;

  // Simple argument parsing
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--year' || args[i] === '-y') {
      year = parseInt(args[i + 1]);
    }
    if (args[i] === '--month' || args[i] === '-m') {
      month = parseInt(args[i + 1]);
    }
    if (args[i] === '--older-than-months' || args[i] === '-o') {
      olderThanMonths = parseInt(args[i + 1]);
    }
    if (args[i] === '--help' || args[i] === '-h') {
      printUsage();
      process.exit(0);
    }
  }

  if (olderThanMonths !== undefined && !isNaN(olderThanMonths)) {
      const date = new Date();
      date.setMonth(date.getMonth() - olderThanMonths);
      console.log(`Deleting activity logs older than ${olderThanMonths} months (before ${date.toISOString()})...`);
      try {
        const result = await prisma.activityLog.deleteMany({
          where: {
            createdAt: {
              lt: date,
            },
          },
        });
        console.log(`Successfully deleted ${result.count} activity logs.`);
      } catch (error) {
        console.error("Error deleting activity logs:", error);
      } finally {
        await prisma.$disconnect();
      }
      return;
  }

  if (!year || !month || isNaN(year) || isNaN(month)) {
    printUsage();
    process.exit(1);
  }

  if (month < 1 || month > 12) {
    console.error("Invalid month. Please provide a month between 1 and 12.");
    process.exit(1);
  }

  // Calculate start and end dates for the specified month
  const startDate = new Date(Date.UTC(year, month - 1, 1));
  const endDate = new Date(Date.UTC(year, month, 1)); // First day of the next month

  console.log(`Deleting activity logs for ${year}-${month.toString().padStart(2, '0')} (from ${startDate.toISOString()} to ${endDate.toISOString()})...`);

  try {
    const result = await prisma.activityLog.deleteMany({
      where: {
        createdAt: {
          gte: startDate,
          lt: endDate,
        },
      },
    });
    console.log(`Successfully deleted ${result.count} activity logs for ${month}/${year}.`);
  } catch (error) {
    console.error("Error deleting activity logs:", error);
  } finally {
    await prisma.$disconnect();
  }
}

function printUsage() {
  console.log("Usage for specific month: node server/scripts/delete_activity_logs.js --year <YYYY> --month <M or MM>");
  console.log("Usage for older logs:     node server/scripts/delete_activity_logs.js --older-than-months <number>");
  console.log("");
  console.log("Example 1: node server/scripts/delete_activity_logs.js --year 2023 --month 5");
  console.log("Example 2: node server/scripts/delete_activity_logs.js --older-than-months 3");
}

main();
