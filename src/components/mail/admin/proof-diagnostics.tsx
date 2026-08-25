"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Badge, Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { PageIntro } from "@/components/ui/page-intro";
import {
  DataTable,
  TableBody,
  TableHead,
  TableShell,
  Td,
  Th,
  Tr,
} from "@/components/ui/table";
import { useTranslation } from "@/i18n/provider";
import { fetchNotificationProofRuns } from "@/lib/mail/client/api";
import { useMailSession } from "@/lib/mail/client/mail-session-provider";
import {
  canViewProofDiagnostics,
  type NotificationProofRunApiItem,
} from "@/lib/mail/client/proof-diagnostics";
import { formatHongKongDateTime } from "@/lib/timezone";
import {
  MailAdminEmptyState,
  MailAdminErrorState,
  MailAdminLoadingState,
  MAIL_ADMIN_CARD_STACK_CLASS,
  MAIL_ADMIN_SECTION_CLASS,
} from "./mail-admin-states";

function outboxStatusVariant(
  status: NotificationProofRunApiItem["outboxStatus"],
): "default" | "success" | "warning" | "danger" {
  if (status === "sent") return "success";
  if (status === "pending" || status === "processing") return "warning";
  return "danger";
}

function transportStatusVariant(
  status: NotificationProofRunApiItem["attemptStatus"],
): "default" | "success" | "warning" | "danger" {
  if (!status) return "default";
  if (status === "accepted") return "success";
  if (status === "started") return "warning";
  return "danger";
}

function formatTimestamp(value: string | null, fallback: string): string {
  return value ? formatHongKongDateTime(value) : fallback;
}

function ProofRunMobileCard({ run }: { run: NotificationProofRunApiItem }) {
  const { t } = useTranslation();

  return (
    <Card padding className="space-y-3 p-4 md:p-6">
      <div className="break-all font-mono text-xs crm-text">{run.sourceEntityId}</div>
      <dl className="grid gap-2 text-sm">
        <div className="flex flex-wrap items-center gap-2">
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.outboxStatus")}
          </dt>
          <dd>
            <Badge variant={outboxStatusVariant(run.outboxStatus)}>
              {t(`mail.adminCenter.proofDiagnostics.outboxStatus.${run.outboxStatus}`)}
            </Badge>
          </dd>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.transportStatus")}
          </dt>
          <dd>
            <Badge variant={transportStatusVariant(run.attemptStatus)}>
              {run.attemptStatus
                ? t(
                    `mail.adminCenter.proofDiagnostics.transportStatus.${run.attemptStatus}`,
                  )
                : t("mail.adminCenter.proofDiagnostics.transportStatus.none")}
            </Badge>
          </dd>
        </div>
        <div>
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.notificationType")}
          </dt>
          <dd className="crm-text">{run.notificationType}</dd>
        </div>
        <div>
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.providerId")}
          </dt>
          <dd className="crm-text">
            {run.providerId ?? t("mail.adminCenter.proofDiagnostics.notApplicable")}
          </dd>
        </div>
        <div>
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.createdAt")}
          </dt>
          <dd className="crm-text">
            {formatTimestamp(
              run.createdAt,
              t("mail.adminCenter.proofDiagnostics.notApplicable"),
            )}
          </dd>
        </div>
        <div>
          <dt className="crm-text-secondary">
            {t("mail.adminCenter.proofDiagnostics.columns.completedAt")}
          </dt>
          <dd className="crm-text">
            {formatTimestamp(
              run.completedAt,
              t("mail.adminCenter.proofDiagnostics.notApplicable"),
            )}
          </dd>
        </div>
      </dl>
    </Card>
  );
}

export function ProofDiagnostics() {
  const { t } = useTranslation();
  const { capabilities } = useMailSession();
  const canView = canViewProofDiagnostics(capabilities);

  const [runs, setRuns] = useState<NotificationProofRunApiItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!canView) {
      setRuns([]);
      setLoading(false);
      setError(null);
      return;
    }

    setLoading(true);
    setError(null);
    try {
      const result = await fetchNotificationProofRuns();
      if (!result.ok) {
        setRuns([]);
        setError(result.error);
        return;
      }
      setRuns(result.items);
    } catch {
      setRuns([]);
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [canView, t]);

  useEffect(() => {
    void load();
  }, [load]);

  const emptyMessage = useMemo(
    () =>
      canView
        ? t("mail.adminCenter.proofDiagnostics.empty")
        : t("mail.adminCenter.proofDiagnostics.noPermission"),
    [canView, t],
  );

  return (
    <div className={MAIL_ADMIN_SECTION_CLASS}>
      <PageIntro
        compact
        title={t("mail.adminCenter.sections.proofDiagnostics")}
        description={t("mail.adminCenter.descriptions.proofDiagnostics")}
        action={
          canView ? (
            <Button
              type="button"
              variant="secondary"
              size="sm"
              disabled={loading}
              onClick={() => void load()}
            >
              {t("mail.adminCenter.proofDiagnostics.refresh")}
            </Button>
          ) : null
        }
      />

      {!canView ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : loading ? (
        <MailAdminLoadingState />
      ) : error ? (
        <MailAdminErrorState message={error} onRetry={() => void load()} />
      ) : runs.length === 0 ? (
        <MailAdminEmptyState message={emptyMessage} />
      ) : (
        <>
          <div className={`${MAIL_ADMIN_CARD_STACK_CLASS} md:hidden`}>
            {runs.map((run) => (
              <ProofRunMobileCard key={run.sourceEntityId} run={run} />
            ))}
          </div>

          <TableShell className="hidden md:block">
            <DataTable>
              <TableHead>
                <Tr>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.sourceEntityId")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.notificationType")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.outboxStatus")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.transportStatus")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.providerId")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.createdAt")}</Th>
                  <Th>{t("mail.adminCenter.proofDiagnostics.columns.completedAt")}</Th>
                </Tr>
              </TableHead>
              <TableBody>
                {runs.map((run) => (
                  <Tr key={run.sourceEntityId}>
                    <Td>
                      <span className="font-mono text-xs">{run.sourceEntityId}</span>
                    </Td>
                    <Td>{run.notificationType}</Td>
                    <Td>
                      <Badge variant={outboxStatusVariant(run.outboxStatus)}>
                        {t(
                          `mail.adminCenter.proofDiagnostics.outboxStatus.${run.outboxStatus}`,
                        )}
                      </Badge>
                    </Td>
                    <Td>
                      <Badge variant={transportStatusVariant(run.attemptStatus)}>
                        {run.attemptStatus
                          ? t(
                              `mail.adminCenter.proofDiagnostics.transportStatus.${run.attemptStatus}`,
                            )
                          : t("mail.adminCenter.proofDiagnostics.transportStatus.none")}
                      </Badge>
                    </Td>
                    <Td>
                      {run.providerId ??
                        t("mail.adminCenter.proofDiagnostics.notApplicable")}
                    </Td>
                    <Td>
                      {formatTimestamp(
                        run.createdAt,
                        t("mail.adminCenter.proofDiagnostics.notApplicable"),
                      )}
                    </Td>
                    <Td>
                      {formatTimestamp(
                        run.completedAt,
                        t("mail.adminCenter.proofDiagnostics.notApplicable"),
                      )}
                    </Td>
                  </Tr>
                ))}
              </TableBody>
            </DataTable>
          </TableShell>
        </>
      )}
    </div>
  );
}
