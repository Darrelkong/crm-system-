import { sql } from "drizzle-orm";
import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const users = sqliteTable(
  "users",
  {
    id: text("id").primaryKey(),
    email: text("email").notNull().unique(),
    /** Staff-only permanent Cloudflare Access identity binding. */
    cloudflareAccessEmail: text("cloudflare_access_email"),
    displayName: text("display_name").notNull(),
    passwordHash: text("password_hash").notNull(),
    role: text("role", { enum: ["admin", "staff"] }).notNull(),
    isActive: integer("is_active").notNull().default(1),
    /** Immutable timestamp of the first successful CRM application login. */
    firstLoginAt: text("first_login_at"),
    /** Admin pause for new public-pool claims only. */
    poolClaimPaused: integer("pool_claim_paused").notNull().default(0),
    /** Optional per-member public-pool policy overrides. */
    poolClaimQuotaOverride: integer("pool_claim_quota_override"),
    poolClaimCooldownHoursOverride: integer("pool_claim_cooldown_hours_override"),
    failedLoginAttempts: integer("failed_login_attempts").notNull().default(0),
    lockedUntil: text("locked_until"),
    mustChangePassword: integer("must_change_password").notNull().default(0),
    passwordChangedAt: text("password_changed_at"),
    passwordResetAt: text("password_reset_at"),
    /** Staff-only one-time first-device auto-approval eligibility (0|1). Never expose to clients. */
    initialDeviceAutoApprovalEligible: integer(
      "initial_device_auto_approval_eligible",
    )
      .notNull()
      .default(0),
    deletedAt: text("deleted_at"),
    createdAt: text("created_at").notNull(),
    updatedAt: text("updated_at").notNull(),
  },
  (table) => [
    index("idx_users_email").on(table.email),
    index("idx_users_role").on(table.role),
    index("idx_users_deleted_at").on(table.deletedAt),
    uniqueIndex("uq_users_cloudflare_access_email").on(
      sql`lower(${table.cloudflareAccessEmail})`,
    ),
  ],
);

type UserRow = typeof users.$inferSelect;
type GovernanceUserFields = Pick<
  UserRow,
  | "firstLoginAt"
  | "poolClaimPaused"
  | "poolClaimQuotaOverride"
  | "poolClaimCooldownHoursOverride"
>;

/**
 * Governance fields were added after the existing User fixtures and callers.
 * Keep them optional at the application boundary while migrations roll out;
 * persisted rows still expose the concrete values at runtime.
 */
export type User = Omit<UserRow, keyof GovernanceUserFields> &
  Partial<GovernanceUserFields>;
export type NewUser = typeof users.$inferInsert;
