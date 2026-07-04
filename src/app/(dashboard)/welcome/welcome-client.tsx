"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";
import {
  isAnnouncementReadLocally,
  markAnnouncementReadLocally,
} from "@/lib/announcements/read-state";
import { markWelcomeSeenThisSession } from "@/lib/announcements/welcome-state";
import type { PublishedAnnouncementView } from "@/lib/announcements/service";

const COUNTDOWN_SECONDS = 5;
const ENTER_HREF = "/staff";

type Props = {
  userName: string;
  announcement: PublishedAnnouncementView | null;
};

type ViewState = "welcome" | "announcement";

export function WelcomeClient({ userName, announcement }: Props) {
  const router = useRouter();
  const { t } = useTranslation();

  const [view, setView] = useState<ViewState>("welcome");
  const [isRead, setIsRead] = useState(false);
  const [countdown, setCountdown] = useState(COUNTDOWN_SECONDS);
  const [countdownDone, setCountdownDone] = useState(false);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Check localStorage read state on mount (client-only)
  useEffect(() => {
    if (announcement) {
      setIsRead(isAnnouncementReadLocally(announcement.id));
    }
  }, [announcement]);

  // Start countdown when viewing the announcement
  useEffect(() => {
    if (view !== "announcement") {
      return;
    }
    setCountdown(COUNTDOWN_SECONDS);
    setCountdownDone(false);

    timerRef.current = setInterval(() => {
      setCountdown((prev) => {
        if (prev <= 1) {
          if (timerRef.current) {
            clearInterval(timerRef.current);
            timerRef.current = null;
          }
          setCountdownDone(true);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => {
      if (timerRef.current) {
        clearInterval(timerRef.current);
        timerRef.current = null;
      }
    };
  }, [view]);

  const handleViewAnnouncement = useCallback(() => {
    setView("announcement");
  }, []);

  const handleConfirmRead = useCallback(() => {
    if (!announcement) return;
    markAnnouncementReadLocally(announcement.id);
    markWelcomeSeenThisSession();
    setIsRead(true);
    setView("welcome");
  }, [announcement]);

  const handleEnterCrm = useCallback(() => {
    markWelcomeSeenThisSession();
    router.push(ENTER_HREF);
  }, [router]);

  const hasUnreadAnnouncement =
    announcement !== null && !isRead;

  if (view === "announcement" && announcement) {
    const confirmDisabled = !countdownDone;
    const countdownText = confirmDisabled
      ? t("welcome.countdownPrompt", { seconds: String(countdown) })
      : t("welcome.countdownPromptReady");

    return (
      <div className="welcome-page">
        <div className="welcome-page__container">
          <div className="welcome-page__card surface-card p-8">
            <div className="welcome-page__announcement-header">
              <button
                type="button"
                className="welcome-page__back-link ghost-button text-sm"
                onClick={() => setView("welcome")}
                disabled={!countdownDone}
              >
                ← {t("welcome.backToWelcome")}
              </button>
              <h1 className="welcome-page__announcement-title">
                {announcement.title}
              </h1>
            </div>

            <div className="welcome-page__announcement-meta text-sm text-secondary mb-4">
              {t("announcements.publishedAt", {
                time: announcement.published_at
                  ? new Date(announcement.published_at).toLocaleDateString()
                  : "",
              })}
            </div>

            <div className="welcome-page__announcement-content prose-like mb-6 whitespace-pre-wrap">
              {announcement.content}
            </div>

            <div className="welcome-page__countdown-hint text-sm text-secondary mb-4">
              {countdownText}
            </div>

            <Button
              onClick={handleConfirmRead}
              disabled={confirmDisabled}
              className="w-full"
            >
              {t("welcome.confirmRead")}
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="welcome-page">
      <div className="welcome-page__container">
        <div className="welcome-page__card surface-card p-8">
          {/* Greeting */}
          <div className="welcome-page__greeting mb-6">
            <h1 className="welcome-page__title">
              {t("welcome.staffGreeting")}
              {userName ? `, ${userName}` : ""}！
            </h1>
            <p className="welcome-page__subtitle text-secondary">
              {t("welcome.staffSubtitle")}
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
                {!hasUnreadAnnouncement && (
                  <p className="text-sm text-secondary mt-1">
                    {t("welcome.announcementAlreadyRead")}
                  </p>
                )}
              </div>
            ) : (
              <p className="text-sm text-secondary">
                {t("welcome.noAnnouncement")}
              </p>
            )}
          </div>

          {/* Risk Reminder */}
          <div className="welcome-page__section mb-8">
            <h2 className="welcome-page__section-title text-sm font-semibold uppercase tracking-wide text-secondary mb-2">
              {t("nav.followUps")}
            </h2>
            <p className="text-sm text-secondary leading-relaxed">
              {t("welcome.riskReminder")}
            </p>
          </div>

          {/* CTA */}
          {hasUnreadAnnouncement ? (
            <Button onClick={handleViewAnnouncement} className="w-full">
              {t("welcome.viewAnnouncement")}
            </Button>
          ) : (
            <Button onClick={handleEnterCrm} className="w-full">
              {t("welcome.enterCrm")}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
