"use client";

import Link from "next/link";
import { Card } from "@/components/ui/card";
import { useTranslation } from "@/i18n/provider";
import { formatHongKongDateTime } from "@/lib/timezone";

export type RecentAnnouncementItem = {
  id: string;
  title: string;
  content: string;
  published_at: string;
};

export function RecentAnnouncementsCardClient({
  items,
}: {
  items: RecentAnnouncementItem[];
}) {
  const { t } = useTranslation();

  return (
    <Card>
      <h3 className="section-title mb-3">
        {t("announcements.recentTitle")}
      </h3>
      {items.length === 0 ? (
        <p className="text-sm crm-text-secondary">{t("announcements.noAnnouncements")}</p>
      ) : (
        <ul className="space-y-2">
          {items.map((item) => (
            <li
              key={item.id}
              className="dashboard-notification-item"
            >
              <p className="text-sm font-medium crm-text">{item.title}</p>
              <p className="mt-0.5 line-clamp-2 text-xs crm-text-secondary">
                {item.content}
              </p>
              <p className="mt-1 text-xs crm-text-muted">
                {formatHongKongDateTime(item.published_at)}
              </p>
            </li>
          ))}
        </ul>
      )}
      <Link
        href="/announcements"
        className="mt-4 inline-block text-sm link-primary hover:underline"
      >
        {t("announcements.viewAll")}
      </Link>
    </Card>
  );
}
