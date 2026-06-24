import { execSync } from "node:child_process";
import { writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { hashPassword } from "../src/lib/auth/password";

type SeedUser = {
  email: string;
  displayName: string;
  role: "admin" | "staff";
  password: string;
};

const SEED_USERS: SeedUser[] = [
  {
    email: "admin@crm.local",
    displayName: "系统管理员",
    role: "admin",
    password: process.env.SEED_ADMIN_PASSWORD ?? "Admin123!",
  },
  {
    email: "staff@crm.local",
    displayName: "测试员工",
    role: "staff",
    password: process.env.SEED_STAFF_PASSWORD ?? "Staff123!",
  },
];

function escapeSql(value: string): string {
  return value.replace(/'/g, "''");
}

async function buildSeedSql(): Promise<string> {
  const now = new Date().toISOString();
  const statements: string[] = [];

  for (const user of SEED_USERS) {
    const id = crypto.randomUUID();
    const passwordHash = await hashPassword(user.password);

    statements.push(`
INSERT INTO users (
  id, email, display_name, password_hash, role, is_active,
  failed_login_attempts, locked_until, created_at, updated_at
) VALUES (
  '${id}',
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
ON CONFLICT(email) DO UPDATE SET
  display_name = excluded.display_name,
  password_hash = excluded.password_hash,
  role = excluded.role,
  is_active = 1,
  failed_login_attempts = 0,
  locked_until = NULL,
  updated_at = excluded.updated_at;
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
    console.log("Admin: admin@crm.local");
    console.log("Staff: staff@crm.local");
    console.log(
      "Default passwords are Admin123! / Staff123! unless overridden by env.",
    );
  } finally {
    unlinkSync(sqlFile);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
