"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import { markWelcomeSeenThisSession } from "@/lib/announcements/welcome-state";
import type { PublishedAnnouncementView } from "@/lib/announcements/service";

const ENTER_HREF = "/admin";

type Props = {
  userName: string;
  announcement: PublishedAnnouncementView | null;
};

export function AdminWelcomeClient({ userName, announcement }: Props) {
  const router = useRouter();
  const { t } = useTranslation();
  const [pendingCount, setPendingCount] = useState<number | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/approvals/pending-count");
        if (!res.ok || cancelled) return;
        const data = (await res.json()) as { pendingCount?: number };
        if (!cancelled) {
          setPendingCount(data.pendingCount ?? 0);
        }
      } catch {
        // Graceful degradation — pending count is optional
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleEnterCrm = useCallback(() => {
    markWelcomeSeenThisSession();
    router.push(ENTER_HREF);
  }, [router]);

  const pendingLabel =
    pendingCount === null
      ? null
      : pendingCount === 0
        ? t("welcome.pendingApprovalsNone")
        : t("welcome.pendingApprovals", { count: String(pendingCount) });

  return (
    <div className="welcome-page">
      <div className="welcome-page__container">
        <div className="welcome-page__card surface-card p-8">
          {/* Greeting */}
          <div className="welcome-page__greeting mb-6">
            <h1 className="welcome-page__title">
              {t("welcome.adminGreeting")}
              {userName ? `, ${userName}` : ""}！
            </h1>
            <p className="welcome-page__subtitle text-secondary">
              {t("welcome.adminSubtitle")}
            </p>
          </div>

          {/* Latest Announcement */}
          <div className="welcome-page__section mb-6">
            <h2 className="welcome-page__section-title text-sm font-semibold uppercase tracking-wide text-secondary mb-2">
              {t("welcome.latestAnnouncementTitle")}
            </h2>
            {announcement ? (
              <div className="welcome-page__announcement-preview surface-card p-4">
                <p className="font-medium mb-1">{announcement.title}</p>
                <p className="text-sm text-secondary">
                  {t("announcements.publishedAt", {
                    time: announcement.published_at
                      ? new Date(announcement.published_at).toLocaleDateString()
                      : "",
                  })}
                </p>
              </div>
            ) : (
              <p className="text-sm text-secondary">
                {t("welcome.noAnnouncement")}
              </p>
            )}
          </div>

          {/* Pending Approvals */}
          {pendingLabel !== null && (
            <div className="welcome-page__section mb-6">
              <h2 className="welcome-page__section-title text-sm font-semibold uppercase tracking-wide text-secondary mb-2">
                {t("nav.approvals")}
              </h2>
              <p className="text-sm text-secondary">{pendingLabel}</p>
            </div>
          )}

          {/* System Risk Reminder */}
          <div className="welcome-page__section mb-8">
            <h2 className="welcome-page__section-title text-sm font-semibold uppercase tracking-wide text-secondary mb-2">
              {t("nav.followUps")}
            </h2>
            <p className="text-sm text-secondary leading-relaxed">
              {t("welcome.adminRiskReminder")}
            </p>
          </div>

          {/* CTA — always enabled for admin */}
          <Button onClick={handleEnterCrm} className="w-full">
            {t("welcome.enterCrm")}
          </Button>
        </div>
      </div>
    </div>
  );
}
