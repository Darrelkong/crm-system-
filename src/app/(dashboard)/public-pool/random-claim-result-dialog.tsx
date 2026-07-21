"use client";

import Link from "next/link";
import { Button } from "@/components/ui/button";
import { ModalOverlay, ModalPanel } from "@/components/ui/modal";
import { useTranslation } from "@/i18n/provider";
import {
  customerDetailHref,
  type RandomClaimSuccessPayload,
} from "./random-claim-ui";

type Props = {
  result: RandomClaimSuccessPayload;
  onClose: () => void;
};

export function RandomClaimResultDialog({ result, onClose }: Props) {
  const { t } = useTranslation();

  return (
    <ModalOverlay onClose={onClose}>
      <ModalPanel className="max-h-[90vh] w-full max-w-md overflow-y-auto">
        <div
          role="dialog"
          aria-labelledby="random-claim-success-title"
          aria-describedby="random-claim-success-desc"
        >
        <h2
          id="random-claim-success-title"
          className="text-lg font-semibold text-[#172033]"
        >
          {t("publicPool.randomClaimSuccessTitle")}
        </h2>
        <p
          id="random-claim-success-desc"
          className="mt-2 text-sm text-[#6B7890]"
        >
          {t("publicPool.randomClaimSuccessBody")}
        </p>
        <p className="mt-3 text-sm font-medium text-[#172033]">
          {t("publicPool.randomClaimSuccessAssigned")}
        </p>
        <dl className="mt-4 space-y-2 text-sm">
          <div>
            <dt className="text-xs text-[#6B7890]">
              {t("publicPool.randomClaimCustomerLabel")}
            </dt>
            <dd className="font-medium text-[#172033]">{result.customerName}</dd>
          </div>
          {result.customerCode ? (
            <div>
              <dt className="text-xs text-[#6B7890]">
                {t("publicPool.randomClaimCustomerCodeLabel")}
              </dt>
              <dd className="font-medium text-[#172033]">
                {result.customerCode}
              </dd>
            </div>
          ) : null}
        </dl>
        <div className="mt-6 flex flex-col gap-2 sm:flex-row sm:justify-end">
          <Link
            href={customerDetailHref(result.customerId)}
            className="w-full sm:w-auto"
          >
            <Button type="button" className="w-full">
              {t("publicPool.randomClaimViewCustomer")}
            </Button>
          </Link>
          <Button
            type="button"
            variant="secondary"
            className="w-full sm:w-auto"
            onClick={onClose}
          >
            {t("publicPool.randomClaimReturnToPool")}
          </Button>
        </div>
        </div>
      </ModalPanel>
    </ModalOverlay>
  );
}
