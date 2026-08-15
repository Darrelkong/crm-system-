import { and, asc, count, desc, eq, gte, inArray, isNotNull, isNull, lt, or, sql } from "drizzle-orm";
import type { SQL } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { getCustomerAccessLevel } from "@/lib/permissions/customers";
import { getBusinessTodayRange } from "@/lib/reports/dates";
import { getEffectiveSettings, type EffectiveSettings } from "@/lib/settings/effective";
import { HONG_KONG_TIMEZONE } from "@/lib/timezone";
import type { TasksView } from "@/lib/work-items/url-state";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";
import {
  recordWorkItemOpenBadgePhysicalLoad,
  recordWorkItemSettingsPhysicalLoad,
  recordWorkItemTaskCountPhysicalLoad,
} from "./work-items-instrumentation";

export type EffectiveSettingsInput =
  | EffectiveSettings
  | Promise<EffectiveSettings>;

export type WorkItemsQueryOptions = {
  staffId?: string | null;
  now?: Date;
  settings?: EffectiveSettingsInput;
};

/** Load effective settings once per Work Items SSR request (Tasks tab). */
export function loadWorkItemSettings(
  db: Parameters<typeof getEffectiveSettings>[0],
): Promise<EffectiveSettings> {
  recordWorkItemSettingsPhysicalLoad();
  return getEffectiveSettings(db);
}

async function resolveWorkItemsSettings(
  db: Parameters<typeof getEffectiveSettings>[0],
  settings?: EffectiveSettingsInput,
): Promise<EffectiveSettings> {
  if (settings !== undefined) {
    return Promise.resolve(settings);
  }
  recordWorkItemSettingsPhysicalLoad();
  return getEffectiveSettings(db);
}

/** Mutual-exclusive today/overdue bounds (HKT calendar + server now). */
export function getTaskDueBounds(
  now: Date = new Date(),
  timezone: string = HONG_KONG_TIMEZONE,
): { nowIso: string; tomorrowStart: string } {
  const nowIso = now.toISOString();
  const { end: todayEnd } = getBusinessTodayRange(
    now,
    timezone === "UTC" ? "UTC" : HONG_KONG_TIMEZONE,
  );
  const tomorrowStart = new Date(new Date(todayEnd).getTime() + 1).toISOString();
  return { nowIso, tomorrowStart };
}

export type WorkItemTaskCounts = {
  open: number;
  today: number;
  overdue: number;
  completed: number;
};

export type WorkItemStaffOption = {
  userId: string;
  displayName: string;
  isFormer: boolean;
};

export type WorkItemTaskRow = {
  id: string;
  title: string;
  type: string;
  status: string;
  dueAt: string | null;
  completedAt: string | null;
  createdAt: string;
  overdue: boolean;
  customerId: string | null;
  customerName: string | null;
  customerAccessible: boolean;
  assigneeId: string;
  assigneeName: string | null;
  assigneeIsFormer: boolean;
};

const COMPLETED_LIMIT = 100;

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

function viewWhere(
  view: TasksView,
  nowIso: string,
  tomorrowStart: string,
): SQL {
  if (view === "completed") {
    return eq(schema.tasks.status, "completed");
  }
  if (view === "today") {
    return and(
      eq(schema.tasks.status, "open"),
      isNotNull(schema.tasks.dueAt),
      gte(schema.tasks.dueAt, nowIso),
      lt(schema.tasks.dueAt, tomorrowStart),
    )!;
  }
  if (view === "overdue") {
    return and(
      eq(schema.tasks.status, "open"),
      isNotNull(schema.tasks.dueAt),
      lt(schema.tasks.dueAt, nowIso),
    )!;
  }
  // open = all open (includes null dueAt, today, overdue)
  return eq(schema.tasks.status, "open");
}

export function combineWhere(...parts: Array<SQL | undefined>): SQL | undefined {
  const present = parts.filter((p): p is SQL => p != null);
  if (present.length === 0) return undefined;
  if (present.length === 1) return present[0];
  return and(...present);
}

export async function countOpenWorkItemTasks(
  user: User,
  options: { staffId?: string | null } = {},
): Promise<number> {
  const db = getDb();
  recordWorkItemOpenBadgePhysicalLoad();
  const scope = assigneeScope(user, options.staffId ?? null);
  const row = await db
    .select({ value: count() })
    .from(schema.tasks)
    .where(combineWhere(eq(schema.tasks.status, "open"), scope));
  return row[0]?.value ?? 0;
}

export async function countWorkItemTasks(
  user: User,
  options: WorkItemsQueryOptions = {},
): Promise<WorkItemTaskCounts> {
  const db = getDb();
  const settings = await resolveWorkItemsSettings(db, options.settings);
  const now = options.now ?? new Date();
  const { nowIso, tomorrowStart } = getTaskDueBounds(
    now,
    settings.businessTimezone,
  );
  const scope = assigneeScope(user, options.staffId ?? null);

  recordWorkItemTaskCountPhysicalLoad();

  let countQuery = db
    .select({
      open:
        sql<number>`sum(case when ${schema.tasks.status} = 'open' then 1 else 0 end)`.mapWith(
          Number,
        ),
      today:
        sql<number>`sum(case when ${schema.tasks.status} = 'open' and ${schema.tasks.dueAt} is not null and ${schema.tasks.dueAt} >= ${nowIso} and ${schema.tasks.dueAt} < ${tomorrowStart} then 1 else 0 end)`.mapWith(
          Number,
        ),
      overdue:
        sql<number>`sum(case when ${schema.tasks.status} = 'open' and ${schema.tasks.dueAt} is not null and ${schema.tasks.dueAt} < ${nowIso} then 1 else 0 end)`.mapWith(
          Number,
        ),
      completed:
        sql<number>`sum(case when ${schema.tasks.status} = 'completed' then 1 else 0 end)`.mapWith(
          Number,
        ),
    })
    .from(schema.tasks)
    .$dynamic();

  if (scope) {
    countQuery = countQuery.where(scope);
  }

  const [row] = await countQuery;

  return {
    open: Number(row?.open ?? 0),
    today: Number(row?.today ?? 0),
    overdue: Number(row?.overdue ?? 0),
    completed: Number(row?.completed ?? 0),
  };
}

export async function listWorkItemTasks(
  user: User,
  options: {
    view: TasksView;
    staffId?: string | null;
    now?: Date;
    settings?: EffectiveSettingsInput;
  },
): Promise<WorkItemTaskRow[]> {
  const db = getDb();
  const settings = await resolveWorkItemsSettings(db, options.settings);
  const now = options.now ?? new Date();
  const { nowIso, tomorrowStart } = getTaskDueBounds(
    now,
    settings.businessTimezone,
  );
  // Staff must never honor staff filter.
  const staffId = user.role === "admin" ? (options.staffId ?? null) : null;
  const scope = assigneeScope(user, staffId);
  const whereClause = combineWhere(
    viewWhere(options.view, nowIso, tomorrowStart),
    scope,
  );

  const orderBy =
    options.view === "completed"
      ? [
          sql`case when ${schema.tasks.completedAt} is null then 1 else 0 end`,
          desc(schema.tasks.completedAt),
          desc(schema.tasks.createdAt),
          asc(schema.tasks.id),
        ]
      : options.view === "overdue"
        ? [
            asc(schema.tasks.dueAt),
            asc(schema.tasks.createdAt),
            asc(schema.tasks.id),
          ]
        : [
            sql`case when ${schema.tasks.dueAt} is null then 1 else 0 end`,
            asc(schema.tasks.dueAt),
            asc(schema.tasks.createdAt),
            asc(schema.tasks.id),
          ];

  let query = db
    .select({
      id: schema.tasks.id,
      title: schema.tasks.title,
      type: schema.tasks.type,
      status: schema.tasks.status,
      dueAt: schema.tasks.dueAt,
      completedAt: schema.tasks.completedAt,
      createdAt: schema.tasks.createdAt,
      customerId: schema.tasks.customerId,
      customerName: schema.customers.customerName,
      customerStatus: schema.customers.status,
      customerOwnerId: schema.customers.ownerId,
      customerDeletedAt: schema.customers.deletedAt,
      assigneeId: schema.tasks.assignedTo,
      assigneeName: schema.users.displayName,
      assigneeDeletedAt: schema.users.deletedAt,
    })
    .from(schema.tasks)
    .leftJoin(
      schema.customers,
      eq(schema.tasks.customerId, schema.customers.id),
    )
    .innerJoin(schema.users, eq(schema.tasks.assignedTo, schema.users.id))
    .where(whereClause)
    .orderBy(...orderBy)
    .$dynamic();

  if (options.view === "completed") {
    query = query.limit(COMPLETED_LIMIT);
  }

  const rows = await query;

  const customerIds = [
    ...new Set(
      rows
        .map((r) => r.customerId)
        .filter((id): id is string => typeof id === "string"),
    ),
  ];

  const collaboratorCustomerIds = new Set<string>();
  if (user.role === "staff" && customerIds.length > 0) {
    const assigneeRows = await db
      .select({ customerId: schema.customerAssignees.customerId })
      .from(schema.customerAssignees)
      .where(
        and(
          eq(schema.customerAssignees.userId, user.id),
          inArray(schema.customerAssignees.customerId, customerIds),
        ),
      );
    for (const row of assigneeRows) {
      collaboratorCustomerIds.add(row.customerId);
    }
  }

  return rows.map((row) => {
    let customerAccessible = false;
    let customerName: string | null = null;

    if (row.customerId && row.customerName != null) {
      const customerStub = {
        id: row.customerId,
        ownerId: row.customerOwnerId,
        status: row.customerStatus ?? "active",
        deletedAt: row.customerDeletedAt,
      } as Customer;

      const level = getCustomerAccessLevel(user, customerStub, {
        isAssignee: collaboratorCustomerIds.has(row.customerId),
      });

      if (level === "full" || level === "archived_basic") {
        customerAccessible = true;
        customerName = row.customerName;
      } else if (level === "masked") {
        // Public pool: do not expose name on work-items deep link.
        customerAccessible = false;
        customerName = null;
      } else {
        customerAccessible = false;
        customerName = null;
      }
    }

    const overdue =
      row.status === "open" && !!row.dueAt && row.dueAt < nowIso;

    return {
      id: row.id,
      title: row.title,
      type: row.type,
      status: row.status,
      dueAt: row.dueAt,
      completedAt: row.completedAt,
      createdAt: row.createdAt,
      overdue,
      customerId: row.customerId,
      customerName,
      customerAccessible,
      assigneeId: row.assigneeId,
      assigneeName: user.role === "admin" ? row.assigneeName : null,
      assigneeIsFormer: user.role === "admin" ? row.assigneeDeletedAt != null : false,
    };
  });
}

export async function listWorkItemStaffOptions(): Promise<WorkItemStaffOption[]> {
  const db = getDb();

  const activeUsers = await db
    .select({
      userId: schema.users.id,
      displayName: schema.users.displayName,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .where(
      and(
        or(eq(schema.users.role, "admin"), eq(schema.users.role, "staff")),
        isNull(schema.users.deletedAt),
      ),
    )
    .orderBy(asc(schema.users.displayName));

  const formerWithTasks = await db
    .selectDistinct({
      userId: schema.users.id,
      displayName: schema.users.displayName,
      deletedAt: schema.users.deletedAt,
    })
    .from(schema.users)
    .innerJoin(schema.tasks, eq(schema.tasks.assignedTo, schema.users.id))
    .where(
      and(
        or(eq(schema.users.role, "admin"), eq(schema.users.role, "staff")),
        isNotNull(schema.users.deletedAt),
      ),
    )
    .orderBy(asc(schema.users.displayName));

  const map = new Map<string, WorkItemStaffOption>();
  for (const row of [...activeUsers, ...formerWithTasks]) {
    map.set(row.userId, {
      userId: row.userId,
      displayName: row.displayName,
      isFormer: row.deletedAt != null,
    });
  }

  return [...map.values()].sort((a, b) => {
    if (a.isFormer !== b.isFormer) return a.isFormer ? 1 : -1;
    return a.displayName.localeCompare(b.displayName, "zh-Hant");
  });
}
