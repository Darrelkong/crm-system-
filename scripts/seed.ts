import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashPassword } from "../src/lib/auth/password";
import { SEED_IDS } from "../src/lib/constants/seed-ids";

type SeedUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
  password: string;
};

const SEED_USERS: SeedUser[] = [
  {
    id: SEED_IDS.admin,
    email: "admin@crm.local",
    displayName: "系统管理员",
    role: "admin",
    password: process.env.SEED_ADMIN_PASSWORD ?? "Admin123!",
  },
  {
    id: SEED_IDS.staffA,
    email: "staff-a@crm.local",
    displayName: "员工 A",
    role: "staff",
    password: process.env.SEED_STAFF_A_PASSWORD ?? "StaffA123!",
  },
  {
    id: SEED_IDS.staffB,
    email: "staff-b@crm.local",
    displayName: "员工 B",
    role: "staff",
    password: process.env.SEED_STAFF_B_PASSWORD ?? "StaffB123!",
  },
];

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${escapeSql(value)}'`;
}

async function buildSeedSql(): Promise<string> {
  const now = new Date().toISOString();
  const statements: string[] = [
    "DELETE FROM sessions;",
    `DELETE FROM tasks WHERE customer_id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
    `DELETE FROM follow_ups WHERE customer_id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
    `DELETE FROM field_change_logs WHERE customer_id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
    `DELETE FROM reclamation_warning_logs WHERE customer_id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
    `DELETE FROM notifications WHERE related_entity_id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
    `DELETE FROM customers WHERE id IN (
      '${SEED_IDS.customerStaffA}',
      '${SEED_IDS.customerStaffB}',
      '${SEED_IDS.customerPublicPool}'
    );`,
  ];

  for (const user of SEED_USERS) {
    const passwordHash = await hashPassword(user.password);

    statements.push(`
INSERT OR REPLACE INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES (
  '${user.id}',
  '${escapeSql(user.email)}',
  '${escapeSql(user.displayName)}',
  '${escapeSql(passwordHash)}',
  '${user.role}',
  1,
  0,
  NULL,
  '${now}',
  '${now}'
);
`.trim());
  }

  const testCustomers = [
    {
      id: SEED_IDS.customerStaffA,
      customerName: "Staff A 测试客户",
      phone: "13800000001",
      wechatId: "staff_a_wechat",
      email: "staff-a-customer@example.com",
      source: "referral",
      sourceRemark: null,
      notes: "Staff A 私有备注",
      ownerId: SEED_IDS.staffA,
      status: "active",
      releaserUserId: null,
      createdBy: SEED_IDS.staffA,
    },
    {
      id: SEED_IDS.customerStaffB,
      customerName: "Staff B 测试客户",
      phone: "13800000002",
      wechatId: "staff_b_wechat",
      email: "staff-b-customer@example.com",
      source: "douyin",
      sourceRemark: null,
      notes: "Staff B 私有备注",
      ownerId: SEED_IDS.staffB,
      status: "active",
      releaserUserId: null,
      createdBy: SEED_IDS.staffB,
    },
    {
      id: SEED_IDS.customerPublicPool,
      customerName: "公共池测试客户",
      phone: "13800000003",
      wechatId: "pool_wechat",
      email: "pool-customer@example.com",
      source: "other",
      sourceRemark: "公共池来源备注",
      notes: "公共池敏感备注",
      ownerId: null,
      status: "public_pool",
      releaserUserId: SEED_IDS.staffA,
      releasedBy: SEED_IDS.staffA,
      poolEnteredAt: now,
      poolReason: "测试种子数据：员工 A 释放",
      createdBy: SEED_IDS.staffA,
    },
  ];

  for (const customer of testCustomers) {
    statements.push(`
INSERT INTO customers (
  id, customer_name, phone, wechat_id, email, source, source_remark, notes,
  owner_id, status, releaser_user_id, released_by, pool_entered_at, pool_reason,
  created_by, updated_by, created_at, updated_at
) VALUES (
  '${customer.id}',
  '${escapeSql(customer.customerName)}',
  ${sqlValue(customer.phone)},
  ${sqlValue(customer.wechatId)},
  ${sqlValue(customer.email)},
  '${customer.source}',
  ${sqlValue(customer.sourceRemark)},
  ${sqlValue(customer.notes)},
  ${sqlValue(customer.ownerId)},
  '${customer.status}',
  ${sqlValue(customer.releaserUserId)},
  ${sqlValue((customer as { releasedBy?: string | null }).releasedBy ?? customer.releaserUserId)},
  ${sqlValue((customer as { poolEnteredAt?: string | null }).poolEnteredAt ?? null)},
  ${sqlValue((customer as { poolReason?: string | null }).poolReason ?? null)},
  '${customer.createdBy}',
  '${customer.createdBy}',
  '${now}',
  '${now}'
);
`.trim());
  }

  return statements.join("\n\n");
}

async function main() {
  const isRemote = process.argv.includes("--remote");
  const flag = isRemote ? "--remote" : "--local";
  const sql = await buildSeedSql();
  const sqlFile = join(tmpdir(), `crm-seed-${Date.now()}.sql`);

  writeFileSync(sqlFile, sql, "utf8");

  try {
    execSync(`npx wrangler d1 execute crm-db ${flag} --file=${sqlFile}`, {
      stdio: "inherit",
      cwd: join(import.meta.dirname, ".."),
    });
    console.log("\nSeed completed.");
    console.log("Admin:  admin@crm.local  / Admin123!");
    console.log("Staff A: staff-a@crm.local / StaffA123!");
    console.log("Staff B: staff-b@crm.local / StaffB123!");
    console.log("\nTest customer IDs:");
    console.log(`  Staff A customer:    ${SEED_IDS.customerStaffA}`);
    console.log(`  Staff B customer:    ${SEED_IDS.customerStaffB}`);
    console.log(`  Public pool customer: ${SEED_IDS.customerPublicPool}`);
  } finally {
    unlinkSync(sqlFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
