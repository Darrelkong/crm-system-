"use client";

import { useCallback, useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";

type StaffSummary = {
  id: string;
  name: string;
  email: string;
};

type AssigneesResponse = {
  ok?: boolean;
  owner?: StaffSummary | null;
  collaborators?: StaffSummary[];
  availableStaff?: StaffSummary[];
  error?: string;
  errorCode?: string;
};

export function ManageAssigneesButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [owner, setOwner] = useState<StaffSummary | null>(null);
  const [availableStaff, setAvailableStaff] = useState<StaffSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);

  const loadAssignees = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/customers/${customerId}/assignees`);
      const data = (await res.json()) as AssigneesResponse;
      if (!res.ok) {
        setError(resolveApiError(t, data));
        return;
      }

      setOwner(data.owner ?? null);
      setAvailableStaff(data.availableStaff ?? []);
      setSelectedIds((data.collaborators ?? []).map((row) => row.id));
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [customerId, t]);

  useEffect(() => {
    if (open) {
      void loadAssignees();
    }
  }, [open, loadAssignees]);

  function toggleStaff(staffId: string) {
    setSelectedIds((current) =>
      current.includes(staffId)
        ? current.filter((id) => id !== staffId)
        : [...current, staffId],
    );
  }

  async function handleSave() {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(`/api/customers/${customerId}/assignees`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ collaboratorUserIds: selectedIds }),
      });
      const data = (await res.json()) as AssigneesResponse;

      if (res.ok) {
        setOpen(false);
        router.refresh();
        return;
      }

      setError(resolveApiError(t, data));
    } catch {
      setError(t("customers.unableToUpdateCollaborators"));
    } finally {
      setSubmitting(false);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-md border border-[#D5DCE8] px-2.5 py-1 text-xs font-medium text-[#2563EB] hover:bg-[#F4F7FB]"
      >
        {t("customers.manageCollaborators")}
      </button>
    );
  }

  return (
    <ModalOverlay
      onClose={() => {
        setOpen(false);
        setError(null);
      }}
    >
      <ModalPanel className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h3 className="text-lg font-semibold text-[#172033]">
          {t("customers.manageCollaborators")}
        </h3>

        {error && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </p>
        )}

        <div className="mt-4 space-y-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
              {t("customers.primaryOwner")}
            </p>
            <p className="mt-1 text-sm text-[#172033]">
              {owner?.name ?? t("customers.unknownStaff")}
              {owner?.email ? (
                <span className="mt-0.5 block text-xs text-[#6B7890]">
                  {owner.email}
                </span>
              ) : null}
            </p>
          </div>

          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-[#6B7890]">
              {t("customers.collaborators")}
            </p>
            <p className="mt-1 text-sm text-[#6B7890]">
              {t("customers.selectCollaborators")}
            </p>

            {loading ? (
              <p className="mt-3 text-sm text-[#6B7890]">{t("common.loading")}</p>
            ) : availableStaff.length === 0 ? (
              <p className="mt-3 text-sm text-[#6B7890]">
                {t("customers.noCollaboratorsYet")}
              </p>
            ) : (
              <ul className="mt-3 max-h-56 space-y-2 overflow-y-auto rounded-lg border border-[#E8EDF5] p-3">
                {availableStaff.map((staff) => (
                  <li key={staff.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-sm text-[#172033]">
                      <input
                        type="checkbox"
                        className="mt-1"
                        checked={selectedIds.includes(staff.id)}
                        onChange={() => toggleStaff(staff.id)}
                      />
                      <span>
                        {staff.name}
                        <span className="mt-0.5 block text-xs text-[#6B7890]">
                          {staff.email}
                        </span>
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </div>

        <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
          <Button
            type="button"
            variant="secondary"
            onClick={() => {
              setOpen(false);
              setError(null);
            }}
          >
            {t("common.cancel")}
          </Button>
          <Button
            type="button"
            disabled={loading || submitting}
            onClick={handleSave}
          >
            {submitting ? t("common.loading") : t("common.save")}
          </Button>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
