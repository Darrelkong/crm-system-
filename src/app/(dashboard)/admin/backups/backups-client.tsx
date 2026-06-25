"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { useTranslation } from "@/i18n/provider";

type BackupJobItem = {
  id: string;
  status: string;
  backupType: string;
  fileName: string | null;
  tableCount: number;
  recordCount: number;
  fileSizeBytes: number;
  errorMessage: string | null;
  startedAt: string;
  completedAt: string | null;
};

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

function formatDate(iso: string | null): string {
  if (!iso) return "—";
  return iso.replace("T", " ").slice(0, 19);
}

export function BackupsClient() {
  const { t } = useTranslation();
  const [items, setItems] = useState<BackupJobItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [running, setRunning] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/admin/backups");
      const data = (await res.json()) as {
        items?: BackupJobItem[];
        error?: string;
      };
      if (!res.ok) {
        setMessage({ type: "error", text: data.error ?? t("common.loadFailed") });
        return;
      }
      setItems(data.items ?? []);
    } catch {
      setMessage({ type: "error", text: t("common.networkError") });
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => {
    void load();
  }, [load]);

  async function runBackup() {
    setRunning(true);
    setMessage(null);
    try {
      const res = await fetch("/api/admin/backups/run", { method: "POST" });
      const data = (await res.json()) as {
        error?: string;
        fileName?: string;
        recordCount?: number;
        tableCount?: number;
      };
      if (!res.ok) {
        setMessage({
          type: "error",
          text: data.error ?? t("backup.backupFailed"),
        });
        await load();
        return;
      }
      setMessage({
        type: "success",
        text: t("backup.successDetail", {
          fileName: data.fileName ?? "—",
          tableCount: String(data.tableCount ?? 0),
          recordCount: String(data.recordCount ?? 0),
        }),
      });
      await load();
    } catch {
      setMessage({ type: "error", text: t("common.networkError") });
    } finally {
      setRunning(false);
    }
  }

  return (
    <div className="space-y-6">
      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Button onClick={runBackup} disabled={running}>
          {running ? t("backup.runningBackup") : t("backup.runNow")}
        </Button>
        {message && (
          <p
            className={`mt-3 text-sm ${
              message.type === "success" ? "text-green-700" : "text-red-600"
            }`}
          >
            {message.text}
          </p>
        )}
      </div>

      <div className="rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-lg font-medium text-slate-900">
          {t("backup.recentJobs")}
        </h3>
        {loading ? (
          <p className="mt-4 text-sm text-slate-500">{t("common.loading")}</p>
        ) : items.length === 0 ? (
          <p className="mt-4 text-sm text-slate-500">{t("backup.noJobs")}</p>
        ) : (
          <div className="mt-4 overflow-x-auto">
            <table className="min-w-full text-left text-sm">
              <thead>
                <tr className="border-b border-slate-200 text-slate-500">
                  <th className="px-3 py-2">{t("common.status")}</th>
                  <th className="px-3 py-2">{t("backup.backupType")}</th>
                  <th className="px-3 py-2">{t("backup.backupFile")}</th>
                  <th className="px-3 py-2">{t("backup.recordCount")}</th>
                  <th className="px-3 py-2">{t("backup.fileSize")}</th>
                  <th className="px-3 py-2">{t("backup.backupTime")}</th>
                  <th className="px-3 py-2">{t("common.updatedAt")}</th>
                </tr>
              </thead>
              <tbody>
                {items.map((job) => (
                  <tr key={job.id} className="border-b border-slate-100">
                    <td className="px-3 py-2">
                      <StatusBadge status={job.status} />
                      {job.status === "failed" && job.errorMessage && (
                        <span className="mt-1 block text-xs text-red-600">
                          {job.errorMessage}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2">
                      <BackupTypeLabel type={job.backupType} />
                    </td>
                    <td className="px-3 py-2 font-mono text-xs">
                      {job.fileName ?? "—"}
                    </td>
                    <td className="px-3 py-2">{job.recordCount}</td>
                    <td className="px-3 py-2">
                      {formatBytes(job.fileSizeBytes)}
                    </td>
                    <td className="px-3 py-2">{formatDate(job.startedAt)}</td>
                    <td className="px-3 py-2">{formatDate(job.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: string }) {
  const { t } = useTranslation();
  const colors: Record<string, string> = {
    running: "bg-blue-100 text-blue-800",
    completed: "bg-green-100 text-green-800",
    failed: "bg-red-100 text-red-800",
  };
  const labels: Record<string, string> = {
    running: t("backup.running"),
    completed: t("backup.completed"),
    failed: t("backup.failed"),
  };

  return (
    <span
      className={`inline-block rounded-full px-2 py-0.5 text-xs font-medium ${
        colors[status] ?? "bg-slate-100 text-slate-700"
      }`}
    >
      {labels[status] ?? status}
    </span>
  );
}

function BackupTypeLabel({ type }: { type: string }) {
  const { t } = useTranslation();
  const labels: Record<string, string> = {
    manual: t("backup.manual"),
    scheduled: t("backup.scheduled"),
  };
  return <>{labels[type] ?? type}</>;
}
