type NotificationBadgeInstrumentation = {
  notificationBadgeAggregatePhysicalLoads: number;
};

const instrumentation: NotificationBadgeInstrumentation = {
  notificationBadgeAggregatePhysicalLoads: 0,
};

/** Test-only: reset notification badge aggregate counters. */
export function resetNotificationBadgeInstrumentation(): void {
  instrumentation.notificationBadgeAggregatePhysicalLoads = 0;
}

/** Test-only: read notification badge aggregate counters. */
export function getNotificationBadgeInstrumentation(): Readonly<NotificationBadgeInstrumentation> {
  return instrumentation;
}

export function recordNotificationBadgeAggregatePhysicalLoad(): void {
  if (process.env.CRM_ALLOW_TEST_DB_BIND === "1") {
    instrumentation.notificationBadgeAggregatePhysicalLoads += 1;
  }
}
