import "dotenv/config";
import bcrypt from "bcryptjs";
import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaBetterSqlite3 } from "@prisma/adapter-better-sqlite3";

const adapter = new PrismaBetterSqlite3({
  url: process.env.DATABASE_URL ?? "file:./prisma/dev.db",
});
const prisma = new PrismaClient({ adapter });

async function main() {
  const passwordHash = await bcrypt.hash("password123", 10);

  const user = await prisma.user.upsert({
    where: { email: "demo@crm.com" },
    update: {},
    create: {
      email: "demo@crm.com",
      name: "Demo 使用者",
      passwordHash,
      role: "admin",
    },
  });

  const company = await prisma.company.create({
    data: {
      name: "台灣科技股份有限公司",
      industry: "科技",
      website: "https://example.com",
      phone: "02-1234-5678",
      address: "台北市信義區",
      userId: user.id,
    },
  });

  const contact = await prisma.contact.create({
    data: {
      firstName: "小明",
      lastName: "王",
      email: "ming@example.com",
      phone: "0912-345-678",
      title: "業務經理",
      companyId: company.id,
      userId: user.id,
    },
  });

  await prisma.task.createMany({
    data: [
      {
        title: "安排產品演示",
        description: "與王經理確認下週演示時間",
        status: "todo",
        priority: "high",
        dueDate: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000),
        contactId: contact.id,
        companyId: company.id,
        userId: user.id,
      },
      {
        title: "寄送報價單",
        status: "in_progress",
        priority: "medium",
        companyId: company.id,
        userId: user.id,
      },
    ],
  });

  await prisma.note.create({
    data: {
      content: "初次通話，客戶對企業版方案有興趣，需進一步了解定價。",
      contactId: contact.id,
      companyId: company.id,
      userId: user.id,
    },
  });

  console.log("Seed completed!");
  console.log("Demo login: demo@crm.com / password123");
}

main()
  .catch(console.error)
  .finally(() => prisma.$disconnect());
