import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashPassword } from "../src/lib/auth/password";
import { validatePasswordPolicy } from "../src/lib/auth/password-policy";
import { SEED_IDS } from "../src/lib/constants/seed-ids";

type SeedUser = {
  id: string;
  email: string;
  displayName: string;
  role: "admin" | "staff";
  password: string;
};

const LOCAL_TEST_EMAILS = [
  "admin@crm.local",
  "staff-a@crm.local",
  "staff-b@crm.local",
] as const;

const LOCAL_SEED_USERS: SeedUser[] = [
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

function assertProductionSeedEnv(): { email: string; password: string } {
  const email = process.env.SEED_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.SEED_ADMIN_PASSWORD;

  if (!email || !password) {
    console.error(
      "生产 seed 必须设置 SEED_ADMIN_EMAIL 与 SEED_ADMIN_PASSWORD 环境变量。",
    );
    console.error("示例：");
    console.error(
      '  SEED_ADMIN_EMAIL=ops@yourcompany.com SEED_ADMIN_PASSWORD="YourStr0ngPass!" npm run db:seed:remote',
    );
    process.exit(1);
  }

  if (
    email.endsWith("@crm.local") ||
    (LOCAL_TEST_EMAILS as readonly string[]).includes(email)
  ) {
    console.error(
      "生产环境禁止使用 @crm.local 或本地测试邮箱。请使用真实企业邮箱。",
    );
    process.exit(1);
  }

  const policy = validatePasswordPolicy(password);
  if (!policy.valid) {
    console.error(`生产 Admin 密码不符合策略：${policy.message}`);
    process.exit(1);
  }

  return { email, password };
}

const LOCAL_SEED_CUSTOMER_IDS = [
  SEED_IDS.customerStaffA,
  SEED_IDS.customerStaffB,
  SEED_IDS.customerPublicPool,
] as const;

function seedCustomerIdSqlList(): string {
  return LOCAL_SEED_CUSTOMER_IDS.map((id) => `'${id}'`).join(", ");
}

async function buildUserInsertSql(users: SeedUser[], now: string): Promise<string[]> {
  const statements: string[] = [];
  for (const user of users) {
    const passwordHash = await hashPassword(user.password);
    statements.push(`
INSERT INTO users (
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
)
ON CONFLICT(id) DO UPDATE SET
  email = excluded.email,
  display_name = excluded.display_name,
  password_hash = excluded.password_hash,
  role = excluded.role,
  is_active = excluded.is_active,
  failed_login_attempts = excluded.failed_login_attempts,
  locked_until = excluded.locked_until,
  updated_at = excluded.updated_at;
`.trim());
  }
  return statements;
}

async function buildLocalDevSeedSql(): Promise<string> {
  const now = new Date().toISOString();
  const customerIds = seedCustomerIdSqlList();
  const statements: string[] = [
    "DELETE FROM sessions;",
    `DELETE FROM approvals WHERE customer_id IN (${customerIds});`,
    `DELETE FROM tasks WHERE customer_id IN (${customerIds});`,
    `DELETE FROM follow_ups WHERE customer_id IN (${customerIds});`,
    `DELETE FROM field_change_logs WHERE customer_id IN (${customerIds});`,
    `DELETE FROM reclamation_warning_logs WHERE customer_id IN (${customerIds});`,
    `DELETE FROM notifications WHERE related_entity_id IN (${customerIds});`,
    `DELETE FROM customers WHERE id IN (${customerIds});`,
  ];

  statements.push(...(await buildUserInsertSql(LOCAL_SEED_USERS, now)));

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
  ${sqlValue(customer.releasedBy)},
  ${sqlValue(customer.poolEnteredAt)},
  ${sqlValue(customer.poolReason)},
  '${customer.createdBy}',
  '${customer.createdBy}',
  '${now}',
  '${now}'
)
ON CONFLICT(id) DO UPDATE SET
  customer_name = excluded.customer_name,
  phone = excluded.phone,
  wechat_id = excluded.wechat_id,
  email = excluded.email,
  source = excluded.source,
  source_remark = excluded.source_remark,
  notes = excluded.notes,
  owner_id = excluded.owner_id,
  status = excluded.status,
  releaser_user_id = excluded.releaser_user_id,
  released_by = excluded.released_by,
  pool_entered_at = excluded.pool_entered_at,
  pool_reason = excluded.pool_reason,
  updated_by = excluded.updated_by,
  updated_at = excluded.updated_at;
`.trim());
  }

  return statements.join("\n\n");
}

async function buildProductionAdminSeedSql(): Promise<string> {
  const { email, password } = assertProductionSeedEnv();
  const now = new Date().toISOString();

  const adminUser: SeedUser = {
    id: SEED_IDS.admin,
    email,
    displayName: process.env.SEED_ADMIN_NAME?.trim() || "系统管理员",
    role: "admin",
    password,
  };

  const statements = await buildUserInsertSql([adminUser], now);
  return statements.join("\n\n");
}

async function main() {
  const isRemote = process.argv.includes("--remote");
  const flag = isRemote ? "--remote" : "--local";

  if (isRemote) {
    console.log("生产 seed 模式：仅创建 Admin 账号，不创建测试 Staff 或测试客户。");
  } else {
    console.log("本地开发 seed 模式：创建测试账号与示例客户。");
  }

  const sql = isRemote
    ? await buildProductionAdminSeedSql()
    : await buildLocalDevSeedSql();
  const sqlFile = join(tmpdir(), `crm-seed-${Date.now()}.sql`);

  writeFileSync(sqlFile, sql, "utf8");

  try {
    execSync(`npx wrangler d1 execute crm-db ${flag} --file=${sqlFile}`, {
      stdio: "inherit",
      cwd: join(import.meta.dirname, ".."),
    });
    console.log("\nSeed completed.");
    if (isRemote) {
      console.log("生产 Admin 已写入（邮箱来自 SEED_ADMIN_EMAIL）。");
      console.log("请立即登录并确认密码策略；勿在日志中打印密码。");
    } else {
      console.log("Admin:  admin@crm.local  / Admin123!");
      console.log("Staff A: staff-a@crm.local / StaffA123!");
      console.log("Staff B: staff-b@crm.local / StaffB123!");
      console.log("\nTest customer IDs:");
      console.log(`  Staff A customer:    ${SEED_IDS.customerStaffA}`);
      console.log(`  Staff B customer:    ${SEED_IDS.customerStaffB}`);
      console.log(`  Public pool customer: ${SEED_IDS.customerPublicPool}`);
    }
  } finally {
    unlinkSync(sqlFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
