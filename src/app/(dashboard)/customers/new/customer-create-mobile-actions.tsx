"use client";

import { MOBILE_FLOATING_SAVE_BOTTOM } from "@/lib/customers/incomplete-contact";
import { useTranslation } from "@/i18n/provider";
import { Button } from "@/components/ui/button";

/**
 * Flip to true to restore the mobile Cancel button without redesigning the FAB.
 * Desktop Cancel remains in the form footer regardless of this flag.
 */
const SHOW_MOBILE_CANCEL_BUTTON = false;

/**
 * Mobile-only floating Save control, stacked above MobileBottomNav (z-40).
 * Shell is visually transparent and does not intercept clicks outside the button.
 * Uses the same form submit via the `form` attribute.
 *
 * When the soft keyboard is open (`hidden`), unmount entirely so the FAB cannot
 * remain hit-testable under a pointer-events-auto child.
 */
export function CustomerCreateMobileActions({
  formId,
  submitting,
  hidden,
  onCancel,
}: {
  formId: string;
  submitting: boolean;
  /** When soft keyboard is open, unmount to avoid covering / intercepting inputs. */
  hidden: boolean;
  onCancel: () => void;
}) {
  const { t } = useTranslation();

  if (hidden) {
    return null;
  }

  return (
    <div
      className="customer-create-mobile-actions pointer-events-none fixed inset-x-0 z-[45] flex justify-end px-4 md:hidden"
      style={{ bottom: MOBILE_FLOATING_SAVE_BOTTOM }}
      role="region"
      aria-label={t("customers.mobileCreateActionsLabel")}
    >
      {SHOW_MOBILE_CANCEL_BUTTON ? (
        <Button
          type="button"
          variant="secondary"
          className="pointer-events-auto mr-3 min-h-10 px-4 py-2"
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
        className="customer-create-mobile-save pointer-events-auto h-10 min-h-10 min-w-[7.5rem] px-5 py-2 text-sm"
        disabled={submitting}
      >
        {submitting ? t("customers.saving") : t("customers.saveClient")}
      </Button>
    </div>
  );
}
