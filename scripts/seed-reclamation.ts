import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { SEED_IDS } from "../src/lib/constants/seed-ids";

const MS_PER_DAY = 24 * 60 * 60 * 1000;

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

function sqlValue(value: string | null | undefined): string {
  if (value === null || value === undefined) {
    return "NULL";
  }
  return `'${escapeSql(value)}'`;
}

function daysAgoIso(days: number): string {
  return new Date(Date.now() - days * MS_PER_DAY).toISOString();
}

function buildReclamationSeedSql(): string {
  const now = new Date().toISOString();
  const reclamationIds = [
    SEED_IDS.customerReclaimDay6,
    SEED_IDS.customerReclaimDay7,
    SEED_IDS.customerReclaimDay8,
    SEED_IDS.customerReclaimRecent,
  ];

  const statements: string[] = [
    `DELETE FROM tasks WHERE customer_id IN (${reclamationIds.map((id) => `'${id}'`).join(", ")});`,
    `DELETE FROM reclamation_warning_logs WHERE customer_id IN (${reclamationIds.map((id) => `'${id}'`).join(", ")});`,
    `DELETE FROM notifications WHERE related_entity_id IN (${reclamationIds.map((id) => `'${id}'`).join(", ")});`,
    `DELETE FROM customers WHERE id IN (${reclamationIds.map((id) => `'${id}'`).join(", ")});`,
  ];

  const reclamationCustomers = [
    {
      id: SEED_IDS.customerReclaimDay6,
      customerName: "回收测试-6天未跟进",
      lastValidFollowUpAt: daysAgoIso(6),
      notes: "Phase 7 测试：应触发第 6 天预警",
    },
    {
      id: SEED_IDS.customerReclaimDay7,
      customerName: "回收测试-7天未跟进",
      lastValidFollowUpAt: daysAgoIso(7),
      notes: "Phase 7 测试：应触发第 7 天预警",
    },
    {
      id: SEED_IDS.customerReclaimDay8,
      customerName: "回收测试-8天未跟进",
      lastValidFollowUpAt: daysAgoIso(8),
      notes: "Phase 7 测试：应被自动回收到公共池",
    },
    {
      id: SEED_IDS.customerReclaimRecent,
      customerName: "回收测试-最近已跟进",
      lastValidFollowUpAt: daysAgoIso(1),
      notes: "Phase 7 测试：不应预警或回收",
    },
  ];

  for (const customer of reclamationCustomers) {
    const createdAt = customer.lastValidFollowUpAt;
    statements.push(`
INSERT INTO customers (
  id, customer_name, phone, wechat_id, email, source, source_remark, notes,
  owner_id, status, created_by, updated_by, last_valid_follow_up_at,
  created_at, updated_at
) VALUES (
  '${customer.id}',
  '${escapeSql(customer.customerName)}',
  '1380000${customer.id.slice(-4)}',
  'reclaim_test_${customer.id.slice(-2)}',
  'reclaim-${customer.id.slice(-4)}@example.com',
  'referral',
  NULL,
  '${escapeSql(customer.notes)}',
  '${SEED_IDS.staffA}',
  'active',
  '${SEED_IDS.staffA}',
  '${SEED_IDS.staffA}',
  '${customer.lastValidFollowUpAt}',
  '${createdAt}',
  '${now}'
);
`.trim());
  }

  const day8TaskId = "33333333-3333-3333-3333-333333333301";
  statements.push(`
INSERT INTO tasks (
  id, customer_id, assigned_to, created_by, title, type, status, due_at,
  created_at, updated_at
) VALUES (
  '${day8TaskId}',
  '${SEED_IDS.customerReclaimDay8}',
  '${SEED_IDS.staffA}',
  '${SEED_IDS.staffA}',
  '回收测试待办：8天客户跟进',
  'follow_up',
  'open',
  '${now}',
  '${now}',
  '${now}'
);
`.trim());

  return statements.join("\n\n");
}

async function main() {
  const isRemote = process.argv.includes("--remote");
  const flag = isRemote ? "--remote" : "--local";
  const sql = buildReclamationSeedSql();
  const sqlFile = join(tmpdir(), `crm-seed-reclamation-${Date.now()}.sql`);

  writeFileSync(sqlFile, sql, "utf8");

  try {
    execSync(`npx wrangler d1 execute crm-db ${flag} --file=${sqlFile}`, {
      stdio: "inherit",
      cwd: join(import.meta.dirname, ".."),
    });
    console.log("\nReclamation test seed completed.");
    console.log("Run as Admin: POST /api/admin/reclamation/run");
    console.log("\nTest customer IDs:");
    console.log(`  Day 6 warning:  ${SEED_IDS.customerReclaimDay6}`);
    console.log(`  Day 7 warning:  ${SEED_IDS.customerReclaimDay7}`);
    console.log(`  Day 8 reclaim:  ${SEED_IDS.customerReclaimDay8}`);
    console.log(`  Recent follow:  ${SEED_IDS.customerReclaimRecent}`);
    console.log(`  Public pool:    ${SEED_IDS.customerPublicPool}`);
  } finally {
    unlinkSync(sqlFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
