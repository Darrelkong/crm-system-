import { Card } from "@/components/ui/card";
import { getDb } from "@/lib/db";
import { getCustomerTimeline } from "@/lib/customers/timeline/service";
import {
  TIMELINE_TYPE_UI_LABELS,
} from "@/lib/customers/timeline/constants";
import type { TimelineItem } from "@/lib/customers/timeline/types";
import type { Customer } from "../../../drizzle/schema/customers";
import type { User } from "../../../drizzle/schema/users";

function typeBadge(item: TimelineItem): string {
  if (item.metadata.category === "system") {
    return "系统";
  }
  return TIMELINE_TYPE_UI_LABELS[item.type] ?? item.type;
}

function badgeClass(item: TimelineItem): string {
  if (item.metadata.category === "system") {
    return "bg-slate-200 text-slate-700";
  }
  switch (item.type) {
    case "field_change":
      return "bg-amber-100 text-amber-800";
    case "follow_up":
      return "bg-green-100 text-green-800";
    case "task":
      return "bg-blue-100 text-blue-800";
    case "approval":
      return "bg-purple-100 text-purple-800";
    default:
      return "bg-indigo-100 text-indigo-800";
  }
}

export async function CustomerTimeline({
  user,
  customer,
}: {
  user: User;
  customer: Customer;
}) {
  const db = getDb();
  const { items, accessLevel } = await getCustomerTimeline(db, user, customer);

  return (
    <Card className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">时间线</h3>
        {accessLevel !== "full" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {accessLevel === "archived_basic" ? "归档基础视图" : "脱敏视图"}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">暂无操作记录</p>
      ) : (
        <div className="max-h-[32rem] space-y-3 overflow-y-auto pr-1">
          {items.map((item) => (
            <div
              key={item.id}
              className={
                item.sensitive
                  ? "rounded-lg border border-amber-100 bg-amber-50/40 p-4"
                  : "rounded-lg border border-slate-200 bg-slate-50/50 p-4"
              }
            >
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="font-medium text-slate-600">
                  {item.occurredAt.slice(0, 16).replace("T", " ")}
                </span>
                <span
                  className={`rounded-full px-2 py-0.5 font-medium ${badgeClass(item)}`}
                >
                  {typeBadge(item)}
                </span>
                {item.sensitive && (
                  <span className="rounded-full bg-amber-200 px-2 py-0.5 text-amber-900">
                    已脱敏
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {item.title}
              </p>
              <p className="mt-1 text-sm text-slate-700">{item.description}</p>
              <p className="mt-2 text-xs text-slate-500">
                操作人：{item.actorName}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
