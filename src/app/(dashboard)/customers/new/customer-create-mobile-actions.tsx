"use client";

import { cn } from "@/lib/cn";
import { MOBILE_BOTTOM_NAV_STACK_OFFSET } from "@/lib/customers/incomplete-contact";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";

/**
 * Mobile-only fixed Cancel / Save bar, stacked above MobileBottomNav (z-40).
 * Uses the same form submit via the `form` attribute.
 */
export function CustomerCreateMobileActions({
  formId,
  submitting,
  hidden,
  onCancel,
}: {
  formId: string;
  submitting: boolean;
  /** When soft keyboard is open, hide to avoid covering inputs. */
  hidden: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  return (
    <div
      className={cn(
        "customer-create-mobile-actions fixed inset-x-0 z-[45] px-4 py-3 md:hidden",
        hidden && "pointer-events-none invisible",
      )}
      style={{ bottom: MOBILE_BOTTOM_NAV_STACK_OFFSET }}
      role="region"
      aria-label={t("customers.mobileCreateActionsLabel")}
      aria-hidden={hidden}
    >
      <div className="mx-auto flex max-w-2xl gap-3">
        <Button
          type="button"
          variant="secondary"
          className="min-w-0 flex-1"
          disabled={submitting}
          onClick={onCancel}
        >
          {t("common.cancel")}
        </Button>
        <Button
          type="submit"
          form={formId}
          className="min-w-0 flex-1"
          disabled={submitting}
        >
          {submitting ? t("customers.saving") : t("customers.saveClient")}
        </Button>
      </div>
    </div>
  );
}
