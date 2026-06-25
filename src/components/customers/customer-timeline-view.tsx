"use client";

import { Card } from "@/components/ui/card";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import type { TimelineItem } from "@/lib/customers/timeline/types";

const EMPTY_MARKER = "__empty__";

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

export function CustomerTimelineView({
  items,
  accessLevel,
}: {
  items: TimelineItem[];
  accessLevel: "full" | "masked" | "archived_basic";
}) {
  const {
    t,
    timelineType,
    followUpChannel,
    followUpOutcome,
    approvalType,
    completenessField,
  } = useCustomerLabels();

  function translateValue(key: string, value: string): string {
    if (value === EMPTY_MARKER) return t("timelineMessages.emptyValue");
    switch (key) {
      case "channel":
        return followUpChannel(value);
      case "outcome":
        return followUpOutcome(value);
      case "type":
        return approvalType(value);
      case "status":
        return t(`approvalStatuses.${value}`) === `approvalStatuses.${value}`
          ? value
          : t(`approvalStatuses.${value}`);
      case "field":
        return completenessField(value);
      case "validity":
        return value === "valid"
          ? t("timelineMessages.followUpValid")
          : t("timelineMessages.followUpInvalid");
      default:
        return value;
    }
  }

  function translateTaskValue(key: string, value: string): string {
    if (key === "type") {
      return t(`taskTypes.${value}`) === `taskTypes.${value}` ? value : t(`taskTypes.${value}`);
    }
    if (key === "status") {
      return t(`taskStatuses.${value}`) === `taskStatuses.${value}`
        ? value
        : t(`taskStatuses.${value}`);
    }
    return value;
  }

  function renderMessage(
    messageKey: string,
    params?: Record<string, string>,
    mode: "default" | "task" = "default",
  ): string {
    if (!params) return t(messageKey);
    const resolved = Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        mode === "task" && (key === "type" || key === "status")
          ? translateTaskValue(key, value)
          : translateValue(key, value),
      ]),
    );
    const text = t(messageKey, resolved);
    return text === messageKey ? messageKey : text;
  }

  function typeBadge(item: TimelineItem): string {
    if (item.metadata.category === "system") {
      return t("customers.timelineSystem");
    }
    return timelineType(item.type);
  }

  function actorLabel(item: TimelineItem): string {
    if (item.actorIsSystem) return t("customers.timelineSystem");
    if (!item.actorName) return t("timelineMessages.unknownActor");
    return item.actorName;
  }

  return (
    <Card className="mt-6">
      <div className="mb-4 flex items-center justify-between">
        <h3 className="text-base font-semibold text-slate-900">{t("customers.timeline")}</h3>
        {accessLevel !== "full" && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-800">
            {accessLevel === "archived_basic"
              ? t("customers.timelineArchivedView")
              : t("customers.timelineMaskedView")}
          </span>
        )}
      </div>

      {items.length === 0 ? (
        <p className="text-sm text-slate-500">{t("customers.timelineNoRecords")}</p>
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
                    {t("customers.timelineMaskedBadge")}
                  </span>
                )}
              </div>
              <p className="mt-2 text-sm font-medium text-slate-900">
                {renderMessage(
                  item.titleKey,
                  item.titleKey === "timelineMessages.approvalTitle" && item.titleParams?.type
                    ? { type: item.titleParams.type }
                    : item.titleKey === "timelineMessages.followUpRecord" && item.titleParams?.channel
                      ? { channel: item.titleParams.channel }
                      : item.titleParams,
                )}
              </p>
              {item.descriptionKey && (
                <p className="mt-1 text-sm text-slate-700">
                  {renderMessage(
                    item.descriptionKey,
                    item.descriptionParams,
                    item.descriptionKey === "timelineMessages.taskDescription" ? "task" : "default",
                  )}
                </p>
              )}
              <p className="mt-2 text-xs text-slate-500">
                {t("customers.timelineActor", { name: actorLabel(item) })}
              </p>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}
