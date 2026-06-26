"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/card";
import { PageIntro } from "@/components/ui/page-intro";
import { cn } from "@/lib/cn";
import {
  getReadAnnouncementIds,
  markAnnouncementReadLocally,
} from "@/lib/announcements/read-state";
import { formatHongKongDateTime } from "@/lib/timezone";
import { useTranslation } from "@/i18n/provider";

type AnnouncementItem = {
  id: string;
  title: string;
  content: string;
  audience: string;
  published_at: string;
};

function sortReaderAnnouncements(
  items: AnnouncementItem[],
  readIds: Set<string>,
): AnnouncementItem[] {
  return [...items].sort((a, b) => {
    const aUnread = !readIds.has(a.id);
    const bUnread = !readIds.has(b.id);
    if (aUnread !== bUnread) {
      return aUnread ? -1 : 1;
    }
    return (
      new Date(b.published_at).getTime() - new Date(a.published_at).getTime()
    );
  });
}

export function AnnouncementsClient() {
  const { t } = useTranslation();
  const [items, setItems] = useState<AnnouncementItem[]>([]);
  const [readIds, setReadIds] = useState<Set<string>>(new Set());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    const res = await fetch("/api/announcements");
    const data = (await res.json()) as {
      items?: AnnouncementItem[];
      error?: string;
    };
    if (!res.ok) {
      setError(data.error ?? t("announcements.loadFailed"));
      setLoading(false);
      return;
    }
    setItems(data.items ?? []);
    setReadIds(new Set(getReadAnnouncementIds()));
    setLoading(false);
  }, [t]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- fetch on mount
    void load();
  }, [load]);

  const sortedItems = useMemo(
    () => sortReaderAnnouncements(items, readIds),
    [items, readIds],
  );

  const unreadCount = useMemo(
    () => items.filter((item) => !readIds.has(item.id)).length,
    [items, readIds],
  );

  function handleMarkRead(id: string) {
    markAnnouncementReadLocally(id);
    setReadIds(new Set(getReadAnnouncementIds()));
  }

  return (
    <div>
      <PageIntro
        title={t("announcements.reader.title")}
        description={t("announcements.reader.subtitle")}
      />

      <div className="mt-6 space-y-4">
        {!loading && items.length > 0 && (
          <div className="surface-card p-4 text-sm text-[#6B7890]">
            {t("announcements.reader.unreadCount", {
              count: String(unreadCount),
            })}
          </div>
        )}

        {loading ? (
          <p className="text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : error ? (
          <p className="text-sm text-red-600">{error}</p>
        ) : sortedItems.length === 0 ? (
          <div className="surface-card p-6 text-sm text-[#6B7890]">
            {t("announcements.noAnnouncements")}
          </div>
        ) : (
          <ul className="space-y-4">
            {sortedItems.map((item) => {
              const isRead = readIds.has(item.id);
              return (
                <li
                  key={item.id}
                  className={cn(
                    "surface-card p-5 sm:p-6",
                    isRead
                      ? "border-[#EEF3F8] bg-[#FAFBFD] opacity-90"
                      : "border-[#C5DAF0] bg-[#F7FAFD]",
                  )}
                >
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <h3
                          className={cn(
                            "text-lg font-semibold text-[#172033]",
                            isRead && "font-medium text-[#3D4A5C]",
                          )}
                        >
                          {item.title}
                        </h3>
                        {!isRead && (
                          <Badge variant="accent">{t("announcements.unread")}</Badge>
                        )}
                        {isRead && (
                          <Badge variant="default">{t("announcements.read")}</Badge>
                        )}
                      </div>
                      <p className="mt-1 text-xs text-[#6B7890]">
                        {t("announcements.publishedAt", {
                          time: formatHongKongDateTime(item.published_at),
                        })}
                      </p>
                    </div>
                    {!isRead && (
                      <Button
                        type="button"
                        variant="secondary"
                        className="shrink-0 text-xs"
                        onClick={() => handleMarkRead(item.id)}
                      >
                        {t("announcements.markAsRead")}
                      </Button>
                    )}
                  </div>
                  <div className="mt-4 whitespace-pre-wrap text-sm leading-relaxed text-[#172033]">
                    {item.content}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
