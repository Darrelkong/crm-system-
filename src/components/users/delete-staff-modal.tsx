"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import type { AdminUserView } from "@/lib/users-admin/types";

type PreviewResponse = {
  ok?: boolean;
  user?: {
    id: string;
    name: string;
    email: string;
    role: string;
  };
  transferTo?: {
    id: string;
    name: string;
    email: string;
  };
  impact?: {
    ownedCustomersCount: number;
    collaboratorCustomersCount: number;
    openTasksCount: number;
    pendingApprovalsCount: number;
  };
  error?: string;
};

type Props = {
  user: AdminUserView;
  onClose: () => void;
  onDeleted: (transferredCustomerCount: number) => void;
};

export function DeleteStaffModal({ user, onClose, onDeleted }: Props) {
  const { t } = useTranslation();
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PreviewResponse | null>(null);

  const loadPreview = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/delete-preview`);
      const data = (await res.json()) as PreviewResponse;
      if (!res.ok) {
        setError(data.error ?? t("employees.deleteStaffModalPreviewFailed"));
        setPreview(null);
        return;
      }
      setPreview(data);
    } catch {
      setError(t("employees.deleteStaffModalPreviewFailed"));
      setPreview(null);
    } finally {
      setLoading(false);
    }
  }, [t, user.id]);

  useEffect(() => {
    void loadPreview();
  }, [loadPreview]);

  async function handleConfirmDelete() {
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch(`/api/admin/users/${user.id}/delete`, {
        method: "POST",
      });
      const data = (await res.json()) as {
        error?: string;
        transferredCustomerCount?: number;
      };
      if (!res.ok) {
        setError(data.error ?? t("employees.operationFailed"));
        return;
      }
      onDeleted(data.transferredCustomerCount ?? 0);
      onClose();
    } catch {
      setError(t("common.networkError"));
    } finally {
      setSubmitting(false);
    }
  }

  function roleLabel(role: string) {
    return role === "admin" ? t("employees.adminRole") : t("employees.staffRole");
  }

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
        <h3 className="text-lg font-medium text-[#172033]">
          {t("employees.deleteStaffModalTitle")}
        </h3>

        {loading ? (
          <p className="mt-4 text-sm text-[#6B7890]">{t("common.loading")}</p>
        ) : error && !preview ? (
          <div className="mt-4 space-y-4">
            <p className="text-sm text-red-700">{error}</p>
            <div className="flex justify-end">
              <Button variant="secondary" onClick={onClose}>
                {t("common.cancel")}
              </Button>
            </div>
          </div>
        ) : preview ? (
          <div className="mt-4 space-y-5 text-sm text-[#172033]">
            <p className="text-[#6B7890]">
              {t("employees.deleteStaffModalIntro")}
            </p>

            <dl className="grid gap-2 rounded-xl bg-[#F7FAFD] p-4">
              <PreviewRow
                label={t("common.name")}
                value={preview.user?.name ?? user.name}
              />
              <PreviewRow
                label={t("common.email")}
                value={preview.user?.email ?? user.email}
              />
              <PreviewRow
                label={t("common.role")}
                value={roleLabel(preview.user?.role ?? user.role)}
              />
            </dl>

            <div>
              <p className="font-medium">{t("employees.deleteStaffModalAfterDeleteTitle")}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5 text-[#6B7890]">
                <li>{t("employees.deleteStaffModalCannotLogin")}</li>
                <li>
                  {t("employees.deleteStaffModalTransferTo")}{" "}
                  <span className="font-medium text-[#172033]">
                    {preview.transferTo?.name}
                  </span>
                </li>
                <li>{t("employees.deleteStaffModalRemoveCollaborators")}</li>
                <li>{t("employees.deleteStaffModalHistoryPreserved")}</li>
              </ul>
            </div>

            <div>
              <p className="font-medium">
                {t("employees.deleteStaffModalImpactTitle")}
              </p>
              <dl className="mt-2 grid gap-2 sm:grid-cols-2">
                <ImpactRow
                  label={t("employees.deleteStaffModalOwnedCustomers")}
                  value={preview.impact?.ownedCustomersCount ?? 0}
                />
                <ImpactRow
                  label={t("employees.deleteStaffModalCollaboratorCustomers")}
                  value={preview.impact?.collaboratorCustomersCount ?? 0}
                />
                <ImpactRow
                  label={t("employees.deleteStaffModalOpenTasks")}
                  value={preview.impact?.openTasksCount ?? 0}
                />
                <ImpactRow
                  label={t("employees.deleteStaffModalPendingApprovals")}
                  value={preview.impact?.pendingApprovalsCount ?? 0}
                />
              </dl>
            </div>

            <p className="text-[#6B7890]">
              {t("employees.deleteStaffModalIrreversible")}
            </p>

            {error && <p className="text-sm text-red-700">{error}</p>}

            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button variant="secondary" onClick={onClose} disabled={submitting}>
                {t("common.cancel")}
              </Button>
              <Button
                variant="danger"
                onClick={() => void handleConfirmDelete()}
                disabled={submitting}
              >
                {submitting
                  ? t("common.loading")
                  : t("employees.deleteStaffModalConfirm")}
              </Button>
            </div>
          </div>
        ) : null}
      </ModalPanel>
    </ModalOverlay>
  );
}

function PreviewRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid gap-1 sm:grid-cols-[7rem_1fr] sm:gap-3">
      <dt className="text-[#6B7890]">{label}</dt>
      <dd className="font-medium">{value}</dd>
    </div>
  );
}

function ImpactRow({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-[#E3E8F0] bg-white px-3 py-2">
      <dt className="text-xs text-[#6B7890]">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-[#172033]">{value}</dd>
    </div>
  );
}
