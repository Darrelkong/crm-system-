"use client";

import { useCallback, useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { Input, Label, Field } from "@/components/ui/form";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError, resolveFieldError } from "@/i18n/resolve-api-error";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

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
  fieldErrors?: { field: string; message: string; code?: string }[];
};

function joinStaffNames(staff: StaffSummary[]): string {
  if (staff.length === 0) {
    return "";
  }
  return staff.map((row) => row.name).join("、");
}

export function RequestAssigneesButton({ customerId }: { customerId: string }) {
  const { t } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [owner, setOwner] = useState<StaffSummary | null>(null);
  const [currentCollaborators, setCurrentCollaborators] = useState<StaffSummary[]>(
    [],
  );
  const [availableStaff, setAvailableStaff] = useState<StaffSummary[]>([]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [reason, setReason] = useState("");

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
      setCurrentCollaborators(data.collaborators ?? []);
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

  async function handleSubmit() {
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch(
        `/api/customers/${customerId}/assignees/approval-request`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            requestedCollaboratorIds: selectedIds,
            reason,
          }),
        },
      );
      const data = (await res.json()) as AssigneesResponse;

      if (res.ok) {
        setSuccess(true);
        return;
      }

      if (data.fieldErrors?.length) {
        setError(
          data.fieldErrors.map((field) => resolveFieldError(t, field)).join(" · "),
        );
        return;
      }

      setError(resolveApiError(t, data));
    } catch {
      setError(t("customers.unableToSubmitAssigneeApproval"));
    } finally {
      setSubmitting(false);
    }
  }

  function closeModal() {
    setOpen(false);
    setError(null);
    setSuccess(false);
    setReason("");
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="customer-detail-action-btn px-2.5 py-1 text-xs"
      >
        {t("customers.requestAssigneeUpdate")}
      </button>
    );
  }

  const requestedStaff = availableStaff.filter((staff) =>
    selectedIds.includes(staff.id),
  );

  return (
    <ModalOverlay onClose={closeModal}>
      <ModalPanel className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <h3 className={cd.subsectionTitle}>
          {t("customers.requestAssigneeUpdate")}
        </h3>

        {success ? (
          <div className="mt-4 space-y-4">
            <p className="rounded-lg bg-green-50 px-3 py-2 text-sm text-green-800">
              {t("customers.assigneeApprovalSubmitted")}
            </p>
            <div className="flex justify-end">
              <Button type="button" onClick={closeModal}>
                {t("common.confirm")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            {error && (
              <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
                {error}
              </p>
            )}

            <div className="mt-4 space-y-4">
              <div>
                <p className={cd.sectionTitle}>
                  {t("customers.primaryOwner")}
                </p>
                <p className={`mt-1 text-sm ${cd.value}`}>
                  {owner?.name ?? t("customers.unknownStaff")}
                </p>
              </div>

              <div>
                <p className={cd.sectionTitle}>
                  {t("customers.currentCollaborators")}
                </p>
                <p className={`mt-1 text-sm ${cd.value}`}>
                  {currentCollaborators.length > 0
                    ? joinStaffNames(currentCollaborators)
                    : t("customers.noCollaboratorsYet")}
                </p>
              </div>

              <div>
                <p className={cd.sectionTitle}>
                  {t("customers.requestedCollaborators")}
                </p>
                <p className={`mt-1 text-sm ${cd.muted}`}>
                  {t("customers.selectCollaborators")}
                </p>

                {loading ? (
                  <p className={`mt-3 text-sm ${cd.muted}`}>
                    {t("common.loading")}
                  </p>
                ) : availableStaff.length === 0 ? (
                  <p className={`mt-3 text-sm ${cd.muted}`}>
                    {t("customers.noCollaboratorsYet")}
                  </p>
                ) : (
                  <ul className="mt-3 max-h-48 space-y-2 overflow-y-auto rounded-lg border crm-border p-3">
                    {availableStaff.map((staff) => (
                      <li key={staff.id}>
                        <label className={`flex cursor-pointer items-start gap-2 text-sm ${cd.value}`}>
                          <input
                            type="checkbox"
                            className="mt-1"
                            checked={selectedIds.includes(staff.id)}
                            onChange={() => toggleStaff(staff.id)}
                          />
                          <span>
                            {staff.name}
                            <span className={`mt-0.5 block text-xs ${cd.muted}`}>
                              {staff.email}
                            </span>
                          </span>
                        </label>
                      </li>
                    ))}
                  </ul>
                )}

                {!loading && requestedStaff.length > 0 ? (
                  <p className={`mt-2 text-xs ${cd.muted}`}>
                    {joinStaffNames(requestedStaff)}
                  </p>
                ) : null}
              </div>

              <Field>
                <Label htmlFor="assignee-reason">
                  {t("customers.assigneeUpdateReason")}{" "}
                  <span className="text-red-500">*</span>
                </Label>
                <Input
                  id="assignee-reason"
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  placeholder={t("customers.assigneeUpdateReasonPlaceholder")}
                />
              </Field>
            </div>

            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end sm:gap-3">
              <Button type="button" variant="secondary" onClick={closeModal}>
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={loading || submitting || !reason.trim()}
                onClick={handleSubmit}
              >
                {submitting
                  ? t("common.loading")
                  : t("customers.submitAssigneeApproval")}
              </Button>
            </div>
          </>
        )}
      </ModalPanel>
    </ModalOverlay>
  );
}
