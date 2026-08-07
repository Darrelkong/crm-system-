"use client";

import { Badge } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import type { ReclamationCountdownDisplay } from "@/lib/reclamation/countdown-display";
import {
  getReclamationCountdownBadgeClassName,
  getReclamationCountdownBadgeVariant,
} from "@/lib/reclamation/countdown-display";
import {
  formatHongKongDate,
  formatHongKongDateTime,
} from "@/lib/timezone";

type Props = {
  countdown: ReclamationCountdownDisplay | null | undefined;
};

function buildLabel(
  countdown: ReclamationCountdownDisplay,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  switch (countdown.state) {
    case "urgent":
      return t("customers.reclaimCountdownTomorrow");
    case "due":
      return t("customers.reclaimCountdownDue");
    case "grace":
      return t("customers.reclaimCountdownGrace");
    default:
      if (countdown.daysRemaining == null || countdown.daysRemaining <= 0) {
        return "";
      }
      return t("customers.reclaimCountdownDays", {
        days: String(countdown.daysRemaining),
      });
  }
}

function buildTitle(
  countdown: ReclamationCountdownDisplay,
  t: (key: string, params?: Record<string, string>) => string,
): string {
  if (countdown.state === "grace") {
    const lines = [
      t("customers.reclaimCountdownTooltipGrace", {
        dateTime: formatHongKongDateTime(countdown.graceUntil),
      }),
    ];
    if (countdown.graceHoursRemaining != null) {
      lines.push(
        t("customers.reclaimCountdownGraceHours", {
          hours: String(countdown.graceHoursRemaining),
        }),
      );
    }
    return lines.join("\n");
  }

  return [
    t("customers.reclaimCountdownTooltipLastValid", {
      date: formatHongKongDate(countdown.lastValidFollowUpAt),
    }),
    t("customers.reclaimCountdownTooltipExpected", {
      date: formatHongKongDate(countdown.reclaimAt),
    }),
    t("customers.reclaimCountdownTooltipRule", {
      days: String(countdown.reclaimDays),
    }),
  ].join("\n");
}

export function ReclamationCountdownBadge({ countdown }: Props) {
  const { t } = useTranslation();
  if (!countdown) return null;

  const label = buildLabel(countdown, t);
  if (!label) return null;

  const variant = getReclamationCountdownBadgeVariant(countdown.state);
  const className = getReclamationCountdownBadgeClassName(
    countdown.state,
    countdown.daysRemaining,
  );
  const title = buildTitle(countdown, t);

  return (
    <span title={title} className="inline-flex max-w-full">
      <Badge variant={variant} className={className}>
        {countdown.state === "grace" && countdown.graceHoursRemaining != null ? (
          <span className="inline-flex max-w-full flex-col leading-tight">
            <span>{label}</span>
            <span className="text-[0.65rem] font-normal opacity-90">
              {t("customers.reclaimCountdownGraceHours", {
                hours: String(countdown.graceHoursRemaining),
              })}
            </span>
          </span>
        ) : (
          label
        )}
      </Badge>
    </span>
  );
}
