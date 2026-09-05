"use client";

import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Input, Label } from "@/components/ui/form";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";

export type SelectedCustomerCollaborator = {
  id: string;
  displayName: string;
  email: string;
};

export function CustomerCreateCollaborators({
  selected,
  primaryOwnerId,
  onChange,
}: {
  selected: SelectedCustomerCollaborator[];
  primaryOwnerId?: string;
  onChange: (next: SelectedCustomerCollaborator[]) => void;
}) {
  const { t } = useTranslation();
  const [open, setOpen] = useState(false);
  const [email, setEmail] = useState("");
  const [verifying, setVerifying] = useState(false);
  const [verified, setVerified] =
    useState<SelectedCustomerCollaborator | null>(null);
  const [error, setError] = useState<string | null>(null);

  function close() {
    if (verifying) return;
    setOpen(false);
    setEmail("");
    setVerified(null);
    setError(null);
  }

  async function verify() {
    const normalizedEmail = email.trim().toLowerCase();
    if (
      selected.some((collaborator) => collaborator.email === normalizedEmail)
    ) {
      setError(t("customers.collaboratorAlreadyAdded"));
      return;
    }

    setVerifying(true);
    setVerified(null);
    setError(null);
    try {
      const response = await fetch("/api/customers/collaborators/verify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          ...(primaryOwnerId ? { primaryOwnerId } : {}),
          selectedCollaboratorIds: selected.map((collaborator) => collaborator.id),
        }),
      });
      const data = (await response.json()) as {
        ok?: boolean;
        user?: SelectedCustomerCollaborator;
      };
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

  function addVerified() {
    if (!verified) return;
    if (selected.some((collaborator) => collaborator.id === verified.id)) {
      setError(t("customers.collaboratorAlreadyAdded"));
      return;
    }
    onChange([...selected, verified]);
    close();
  }

  return (
    <>
      <section className="surface-card mb-4 p-4 sm:p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h3 className="text-base font-semibold text-[#172033]">
              {t("customers.collaboratorsOptional")}
            </h3>
            <p className="mt-1 text-xs leading-5 text-[#6B7890]">
              {t("customers.collaboratorsOptionalDescription")}
            </p>
          </div>
          <Button
            type="button"
            size="sm"
            className="shrink-0"
            onClick={() => setOpen(true)}
          >
            + {t("customers.addCollaborator")}
          </Button>
        </div>
        {selected.length > 0 ? (
          <ul className="mt-4 grid gap-2 sm:grid-cols-2" aria-label={t("customers.collaboratorsOptional")}>
            {selected.map((collaborator) => (
              <li
                key={collaborator.id}
                className="flex min-w-0 items-center justify-between gap-2 rounded-xl border border-[var(--color-crm-border)] bg-white px-3 py-2"
              >
                <span className="min-w-0">
                  <span className="block truncate text-sm font-medium text-[#172033]">
                    {collaborator.displayName}
                  </span>
                  <span className="block truncate text-xs text-[#6B7890]">
                    {collaborator.email}
                  </span>
                </span>
                <button
                  type="button"
                  className="min-h-9 min-w-9 shrink-0 rounded-lg text-lg text-[#6B7890] hover:bg-slate-100"
                  aria-label={`${t("customers.removeCollaborator")} ${collaborator.displayName}`}
                  onClick={() =>
                    onChange(
                      selected.filter((item) => item.id !== collaborator.id),
                    )
                  }
                >
                  ×
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </section>

      {open ? (
        <ModalOverlay onClose={close}>
          <ModalPanel className="max-h-[min(88vh,38rem)] w-[min(calc(100vw-2rem),28rem)] overflow-y-auto">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h2 className="text-lg font-semibold text-[#172033]">
                  {t("customers.addCollaborator")}
                </h2>
                <p className="mt-1 text-sm leading-5 text-[#6B7890]">
                  {t("customers.collaboratorEmailGuidance")}
                </p>
              </div>
              <button
                type="button"
                className="min-h-9 min-w-9 rounded-lg text-xl text-[#6B7890] hover:bg-slate-100"
                aria-label={t("common.close")}
                onClick={close}
              >
                ×
              </button>
            </div>

            <div className="mt-5">
              <Label htmlFor="new-customer-collaborator-email">
                {t("customers.collaboratorEmail")}
              </Label>
              <Input
                id="new-customer-collaborator-email"
                type="email"
                inputMode="email"
                autoComplete="email"
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  setVerified(null);
                  setError(null);
                }}
                placeholder="name@example.com"
                onKeyDown={(event) => {
                  if (event.key === "Enter") {
                    event.preventDefault();
                    void verify();
                  }
                }}
              />
            </div>

            {error ? (
              <p className="mt-2 text-sm text-red-600" role="alert">
                {error}
              </p>
            ) : null}

            {verified ? (
              <div className="mt-4 rounded-xl border border-emerald-200 bg-emerald-50 p-3">
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
                  onClick={addVerified}
                >
                  {t("customers.addCollaborator")}
                </Button>
              </div>
            ) : null}

            {!verified ? (
              <Button
                type="button"
                className="mt-5 w-full sm:w-auto"
                disabled={verifying || email.trim().length === 0}
                onClick={() => void verify()}
              >
                {verifying
                  ? t("customers.verifyingCollaborator")
                  : t("customers.verifyCollaborator")}
              </Button>
            ) : null}
          </ModalPanel>
        </ModalOverlay>
      ) : null}
    </>
  );
}
