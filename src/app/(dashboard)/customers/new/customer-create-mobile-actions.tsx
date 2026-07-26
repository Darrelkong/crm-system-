"use client";

import { cn } from "@/lib/cn";
import { MOBILE_BOTTOM_NAV_STACK_OFFSET } from "@/lib/customers/incomplete-contact";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";

/**
 * Flip to true to restore the mobile Cancel button without redesigning the bar.
 * Desktop Cancel remains in the form footer regardless of this flag.
 */
const SHOW_MOBILE_CANCEL_BUTTON = false;

/**
 * Mobile-only fixed Save bar, stacked above MobileBottomNav (z-40).
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
        "customer-create-mobile-actions fixed inset-x-0 z-[45] px-4 py-2 md:hidden",
        hidden && "pointer-events-none invisible",
      )}
      style={{ bottom: MOBILE_BOTTOM_NAV_STACK_OFFSET }}
      role="region"
      aria-label={t("customers.mobileCreateActionsLabel")}
      aria-hidden={hidden}
    >
      <div className="mx-auto flex max-w-2xl justify-start gap-3">
        {SHOW_MOBILE_CANCEL_BUTTON ? (
          <Button
            type="button"
            variant="secondary"
            className="min-h-10 px-4 py-2"
            disabled={submitting}
            onClick={onCancel}
          >
            {t("common.cancel")}
          </Button>
        ) : null}
        <Button
          type="submit"
          form={formId}
          size="sm"
          className="customer-create-mobile-save h-10 min-h-10 min-w-[7.5rem] px-5 py-2 text-sm"
          disabled={submitting}
        >
          {submitting ? t("customers.saving") : t("customers.saveClient")}
        </Button>
      </div>
    </div>
  );
}
