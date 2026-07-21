"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { LoadingSpinner } from "@/components/ui/loading";
import { useTranslation } from "@/i18n/provider";
import { resolveApiError } from "@/i18n/resolve-api-error";
import { resolveClaimBlockReason } from "@/i18n/resolve-claim-block-reason";
import type { StaffClaimStatus } from "@/lib/public-pool/constants";
import { RandomClaimResultDialog } from "./random-claim-result-dialog";
import {
  CLAIM_STATUS_API_PATH,
  createRandomClaimFetchInit,
  isStaffRandomClaimDisabled,
  isUncertainRandomClaimFailure,
  parseRandomClaimSuccessBody,
  RANDOM_CLAIM_API_PATH,
  staffRandomClaimDisabledReason,
  type RandomClaimSuccessPayload,
} from "./random-claim-ui";

type Props = {
  claimStatus: StaffClaimStatus;
  onClaimStatusChange: (status: StaffClaimStatus) => void;
  onClaimedCustomer: (customerId: string) => void;
};

export function StaffRandomClaimPanel({
  claimStatus,
  onClaimStatusChange,
  onClaimedCustomer,
}: Props) {
  const { t } = useTranslation();
  const router = useRouter();
  const [claimingRandom, setClaimingRandom] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusHint, setStatusHint] = useState<string | null>(null);
  const [success, setSuccess] = useState<RandomClaimSuccessPayload | null>(
    null,
  );
  const inFlightRef = useRef(false);

  const disabled = isStaffRandomClaimDisabled(claimStatus, claimingRandom);
  const disabledReason = staffRandomClaimDisabledReason(
    claimStatus,
    claimingRandom,
  );

  async function refreshClaimStatus(): Promise<boolean> {
    try {
      const res = await fetch(CLAIM_STATUS_API_PATH, {
        method: "GET",
        headers: { Accept: "application/json" },
      });
      if (!res.ok) return false;
      const data = (await res.json()) as StaffClaimStatus;
      if (
        typeof data.canClaimNow !== "boolean" ||
        typeof data.remainingQuota !== "number"
      ) {
        return false;
      }
      onClaimStatusChange(data);
      return true;
    } catch {
      return false;
    }
  }

  async function handleRandomClaim() {
    if (inFlightRef.current || disabled) return;
    inFlightRef.current = true;
    setClaimingRandom(true);
    setError(null);
    setStatusHint(null);

    try {
      const res = await fetch(
        RANDOM_CLAIM_API_PATH,
        createRandomClaimFetchInit(),
      );

      let data: unknown = null;
      let jsonParseFailed = false;
      try {
        data = await res.json();
      } catch {
        jsonParseFailed = true;
      }

      if (res.ok) {
        const parsed = parseRandomClaimSuccessBody(data);
        if (!parsed) {
          setError(t("publicPool.randomClaimUncertain"));
          return;
        }
        setSuccess(parsed);
        onClaimedCustomer(parsed.customerId);
        const statusOk = await refreshClaimStatus();
        if (!statusOk) {
          setStatusHint(t("publicPool.randomClaimStatusRefreshHint"));
        }
        router.refresh();
        return;
      }

      const body = (data ?? {}) as {
        error?: string;
        errorCode?: string;
        code?: string;
      };
      const errorCode = body.errorCode ?? body.code ?? null;
      if (
        isUncertainRandomClaimFailure({
          httpStatus: res.status,
          errorCode,
          jsonParseFailed,
        })
      ) {
        setError(t("publicPool.randomClaimUncertain"));
        return;
      }

      setError(resolveApiError(t, body));
      await refreshClaimStatus();
      router.refresh();
    } catch {
      setError(t("publicPool.randomClaimUncertain"));
    } finally {
      inFlightRef.current = false;
      setClaimingRandom(false);
    }
  }

  const blockReason = !claimStatus.canClaimNow
    ? resolveClaimBlockReason(
        t,
        claimStatus.blockedReasonKey,
        claimStatus.blockedReasonParams,
      )
    : null;

  return (
    <div className="mb-6 rounded-xl border border-[#E4E9F2] bg-[var(--surface-card,white)] p-4 dark:border-[#2A3344]">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <p className="text-sm font-medium text-[#172033]">
            {t("publicPool.randomClaimButton")}
          </p>
          {disabledReason === "quota" && (
            <p className="mt-1 text-xs text-[#6B7890]">
              {t("publicPool.randomClaimNoQuota")}
            </p>
          )}
          {disabledReason === "blocked" && blockReason && (
            <p className="mt-1 text-xs text-[#6B7890]">{blockReason}</p>
          )}
        </div>
        <Button
          type="button"
          disabled={disabled}
          aria-busy={claimingRandom}
          aria-label={
            claimingRandom
              ? t("publicPool.randomClaimAssigning")
              : t("publicPool.randomClaimButton")
          }
          onClick={() => {
            void handleRandomClaim();
          }}
          className="inline-flex w-full items-center justify-center gap-2 sm:w-auto"
        >
          {claimingRandom ? (
            <>
              <LoadingSpinner size="sm" />
              <span>{t("publicPool.randomClaimAssigning")}</span>
            </>
          ) : (
            t("publicPool.randomClaimButton")
          )}
        </Button>
      </div>

      {error && (
        <div className="alert-error mt-3 px-4 py-3 text-sm" role="alert">
          {error}
        </div>
      )}
      {statusHint && !error && (
        <p className="mt-3 text-xs text-[#6B7890]">{statusHint}</p>
      )}

      {success && (
        <RandomClaimResultDialog
          result={success}
          onClose={() => setSuccess(null)}
        />
      )}
    </div>
  );
}
