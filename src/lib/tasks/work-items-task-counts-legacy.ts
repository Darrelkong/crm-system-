import { and, count, eq, gte, isNotNull, lt } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import type { EffectiveSettings } from "@/lib/settings/effective";
import { getEffectiveSettings } from "@/lib/settings/effective";
import type { User } from "../../../drizzle/schema/users";
import {
  combineWhere,
  getTaskDueBounds,
  type WorkItemTaskCounts,
} from "./work-items-query";

function assigneeScope(
  user: User,
  staffId: string | null,
): SQL | undefined {
  if (user.role === "staff") {
    return eq(schema.tasks.assignedTo, user.id);
  }
  if (staffId) {
    return eq(schema.tasks.assignedTo, staffId);
  }
  return undefined;
}

/** Legacy reference: four independent task COUNT queries. */
export async function countWorkItemTasksLegacy(
  user: User,
  options: {
    staffId?: string | null;
    now?: Date;
    settings?: EffectiveSettings;
  } = {},
): Promise<WorkItemTaskCounts> {
  const db = getDb();
  const settings =
    options.settings ?? (await getEffectiveSettings(db));
  const now = options.now ?? new Date();
  const { nowIso, tomorrowStart } = getTaskDueBounds(
    now,
    settings.businessTimezone,
  );
  const scope = assigneeScope(user, options.staffId ?? null);

  const [openRow, todayRow, overdueRow, completedRow] = await Promise.all([
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(combineWhere(eq(schema.tasks.status, "open"), scope)),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        combineWhere(
          and(
            eq(schema.tasks.status, "open"),
            isNotNull(schema.tasks.dueAt),
            gte(schema.tasks.dueAt, nowIso),
            lt(schema.tasks.dueAt, tomorrowStart),
          ),
          scope,
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(
        combineWhere(
          and(
            eq(schema.tasks.status, "open"),
            isNotNull(schema.tasks.dueAt),
            lt(schema.tasks.dueAt, nowIso),
          ),
          scope,
        ),
      ),
    db
      .select({ value: count() })
      .from(schema.tasks)
      .where(combineWhere(eq(schema.tasks.status, "completed"), scope)),
  ]);

  return {
    open: openRow[0]?.value ?? 0,
    today: todayRow[0]?.value ?? 0,
    overdue: overdueRow[0]?.value ?? 0,
    completed: completedRow[0]?.value ?? 0,
  };
}
