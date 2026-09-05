"use client";

import { useCallback, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useCustomerLabels } from "@/i18n/use-customer-labels";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { ui } from "@/lib/ui/classes";

const cd = ui.customerDetail;

type CollaboratorSummary = {
  id: string;
  displayName: string;
};

type VerifiedCollaborator = CollaboratorSummary & {
  email: string;
};

type CollaboratorsResponse = {
  ok?: boolean;
  collaborators?: CollaboratorSummary[];
  user?: VerifiedCollaborator;
  error?: string;
  errorCode?: string;
};

export function ManageAssigneesButton({ customerId }: { customerId: string }) {
  const router = useRouter();
  const { t } = useCustomerLabels();
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [adding, setAdding] = useState(false);
  const [removingId, setRemovingId] = useState<string | null>(null);
  const [confirmRemove, setConfirmRemove] =
    useState<CollaboratorSummary | null>(null);
  const [collaborators, setCollaborators] = useState<CollaboratorSummary[]>([]);
  const [email, setEmail] = useState("");
  const [verified, setVerified] = useState<VerifiedCollaborator | null>(null);
  const [error, setError] = useState<string | null>(null);

  const loadCollaborators = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/collaborators`,
      );
      const data = (await response.json()) as CollaboratorsResponse;
      if (!response.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setCollaborators(data.collaborators ?? []);
    } catch {
      setError(t("common.networkError"));
    } finally {
      setLoading(false);
    }
  }, [customerId, t]);

  function close() {
    if (verifying || adding || removingId) return;
    setOpen(false);
    setConfirmRemove(null);
    setEmail("");
    setVerified(null);
    setError(null);
  }

  async function verify() {
    setVerifying(true);
    setVerified(null);
    setError(null);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/collaborators/verify`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ email }),
        },
      );
      const data = (await response.json()) as CollaboratorsResponse;
      if (!response.ok || !data.ok || !data.user) {
        setError(t("customers.collaboratorVerifyFailed"));
        return;
      }
      setVerified(data.user);
    } catch {
      setError(t("customers.collaboratorVerifyFailed"));
    } finally {
      setVerifying(false);
    }
  }

  async function addVerified() {
    if (!verified || adding) return;
    setAdding(true);
    setError(null);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/collaborators`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: verified.id }),
        },
      );
      const data = (await response.json()) as CollaboratorsResponse;
      if (!response.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setEmail("");
      setVerified(null);
      await loadCollaborators();
      router.refresh();
    } catch {
      setError(t("customers.unableToUpdateCollaborators"));
    } finally {
      setAdding(false);
    }
  }

  async function removeCollaborator(collaborator: CollaboratorSummary) {
    if (removingId) return;
    setRemovingId(collaborator.id);
    setError(null);
    try {
      const response = await fetch(
        `/api/customers/${customerId}/collaborators`,
        {
          method: "DELETE",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ userId: collaborator.id }),
        },
      );
      const data = (await response.json()) as CollaboratorsResponse;
      if (!response.ok) {
        setError(resolveApiError(t, data));
        return;
      }
      setConfirmRemove(null);
      await loadCollaborators();
      router.refresh();
    } catch {
      setError(t("customers.unableToUpdateCollaborators"));
    } finally {
      setRemovingId(null);
    }
  }

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => {
          setOpen(true);
          void loadCollaborators();
        }}
        className="customer-detail-action-btn px-2.5 py-1 text-xs"
      >
        {t("customers.manageCollaborators")}
      </button>
    );
  }

  return (
    <ModalOverlay onClose={close}>
      <ModalPanel className="max-h-[90vh] w-full max-w-lg overflow-y-auto">
        <div className="flex items-start justify-between gap-4">
          <h3 className={cd.subsectionTitle}>
            {t("customers.manageCollaborators")}
          </h3>
          <button
            type="button"
            className="min-h-9 min-w-9 rounded-lg text-xl text-[#6B7890] hover:bg-slate-100"
            onClick={close}
            aria-label={t("common.close")}
          >
            ×
          </button>
        </div>

        {error ? (
          <p
            className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
            role="alert"
          >
            {error}
          </p>
        ) : null}

        <div className="mt-5">
          <p className={cd.sectionTitle}>
            {t("customers.currentCollaborators")}
          </p>
          {loading ? (
            <p className={`mt-2 text-sm ${cd.muted}`}>{t("common.loading")}</p>
          ) : collaborators.length === 0 ? (
            <p className={`mt-2 text-sm ${cd.muted}`}>
              {t("customers.noCollaboratorsYet")}
            </p>
          ) : (
            <ul className="mt-2 space-y-2">
              {collaborators.map((collaborator) => (
                <li
                  key={collaborator.id}
                  className="flex items-center justify-between gap-3 rounded-xl border crm-border px-3 py-2"
                >
                  <span className={`min-w-0 truncate text-sm ${cd.value}`}>
                    {collaborator.displayName}
                  </span>
                  <Button
                    type="button"
                    size="sm"
                    variant="secondary"
                    disabled={Boolean(removingId)}
                    onClick={() => setConfirmRemove(collaborator)}
                  >
                    {removingId === collaborator.id
                      ? t("common.loading")
                      : t("customers.removeCollaborator")}
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </div>

        <div className="mt-6 border-t crm-border pt-5">
          <p className={cd.sectionTitle}>{t("customers.addCollaborator")}</p>
          <p className={`mt-1 text-sm ${cd.muted}`}>
            {t("customers.collaboratorEmailGuidance")}
          </p>
          <div className="mt-3">
            <Label htmlFor="customer-collaborator-email">
              {t("customers.collaboratorEmail")}
            </Label>
            <Input
              id="customer-collaborator-email"
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              disabled={Boolean(verifying || adding)}
              onChange={(event) => {
                setEmail(event.target.value);
                setVerified(null);
                setError(null);
              }}
              onKeyDown={(event) => {
                if (event.key === "Enter") {
                  event.preventDefault();
                  void verify();
                }
              }}
            />
          </div>
          {verified ? (
            <div className="mt-3 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
              <p className="text-sm font-medium text-emerald-900">
                ✓ {verified.displayName}
              </p>
              <p className="mt-1 break-all text-xs text-emerald-800">
                {verified.email}
              </p>
              <Button
                type="button"
                size="sm"
                className="mt-3"
                disabled={adding}
                onClick={() => void addVerified()}
              >
                {adding ? t("common.loading") : t("customers.addCollaborator")}
              </Button>
            </div>
          ) : (
            <Button
              type="button"
              className="mt-4 w-full sm:w-auto"
              disabled={verifying || adding || email.trim().length === 0}
              onClick={() => void verify()}
            >
              {verifying
                ? t("customers.verifyingCollaborator")
                : t("customers.verifyCollaborator")}
            </Button>
          )}
        </div>
      </ModalPanel>

      {confirmRemove ? (
        <ModalOverlay
          onClose={() => {
            if (!removingId) setConfirmRemove(null);
          }}
        >
          <ModalPanel className="w-[min(calc(100vw-2rem),28rem)]">
            <h3 className={cd.subsectionTitle}>
              {t("customers.removeCollaboratorConfirmTitle")}
            </h3>
            <p className={`mt-3 text-sm ${cd.value}`}>
              {t("customers.removeCollaboratorConfirmBody")}
            </p>
            <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="secondary"
                disabled={Boolean(removingId)}
                onClick={() => setConfirmRemove(null)}
              >
                {t("common.cancel")}
              </Button>
              <Button
                type="button"
                disabled={Boolean(removingId)}
                onClick={() => void removeCollaborator(confirmRemove)}
              >
                {removingId ? t("common.loading") : t("common.confirm")}
              </Button>
            </div>
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </ModalOverlay>
  );
}
