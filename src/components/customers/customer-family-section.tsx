"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { ChevronRight, LockKeyhole, MoreHorizontal, Plus } from "lucide-react";
import { useTranslation } from "@/i18n/provider";
import type { CustomerFamilyDetailSummary } from "@/lib/customers/households/detail-summary";
import { Button } from "@/components/ui/button";
import { CustomerFamilyEditRelationshipModal } from "@/components/customers/customer-family-edit-relationship-modal";
import { CustomerFamilyUnlinkModal } from "@/components/customers/customer-family-unlink-modal";

type Props = {
  customerId: string;
  currentCustomerName: string;
  summary: CustomerFamilyDetailSummary | null;
  canManage: boolean;
  canManageExistingFamily: boolean;
  onAddFamilyMember?: () => void;
};

type ActiveMember = CustomerFamilyDetailSummary["members"][number];

function relationshipLabelKey(
  relationshipType: NonNullable<ActiveMember["relationshipType"]>,
): string {
  return `householdRelationships.${relationshipType}`;
}

export function CustomerFamilySection({
  customerId,
  currentCustomerName,
  summary,
  canManage,
  canManageExistingFamily,
  onAddFamilyMember,
}: Props) {
  const { t } = useTranslation();
  const hasMembers = summary != null;
  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [editMember, setEditMember] = useState<ActiveMember | null>(null);
  const [unlinkMember, setUnlinkMember] = useState<ActiveMember | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    function handlePointerDown(event: MouseEvent) {
      if (!menuRef.current?.contains(event.target as Node)) {
        setOpenMenuId(null);
      }
    }

    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, []);

  return (
    <div>
      <div className="flex items-center justify-between gap-3">
        <h4 className="text-sm font-medium crm-text">{t("customers.familyMembers")}</h4>
        {canManage && onAddFamilyMember && (
          <Button
            type="button"
            variant="ghost"
            className="h-8 px-2 text-sm"
            onClick={onAddFamilyMember}
          >
            <Plus className="mr-1 h-3.5 w-3.5" aria-hidden="true" />
            {t("customers.addFamilyMember")}
          </Button>
        )}
      </div>

      {!hasMembers && canManage ? (
        <div className="mt-3 space-y-2">
          <p className="text-sm crm-text-secondary">{t("customers.familyEmptyState")}</p>
          <p className="text-xs crm-text-muted">{t("customers.familyEmptyStateHint")}</p>
        </div>
      ) : null}

      {hasMembers ? (
        <ul className="mt-3 divide-y divide-[var(--crm-border)]">
          <li className="flex min-w-0 items-start justify-between gap-3 py-3 first:pt-0">
            <div className="min-w-0">
              <p className="truncate text-sm crm-text">{currentCustomerName}</p>
              <p className="mt-0.5 text-xs crm-text-secondary">
                {t("customers.familySelf")}
              </p>
            </div>
          </li>

          {summary.members.map((member) => (
            <li key={member.customerId} className="py-3">
              <div className="flex min-w-0 items-center justify-between gap-3">
                <Link
                  href={`/customers/${member.customerId}`}
                  className="group min-w-0 flex-1 rounded-md -mx-1 px-1 py-0.5 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#2563EB]"
                >
                  <p className="truncate text-sm crm-text group-hover:underline">
                    {member.customerName}
                  </p>
                  <p className="mt-0.5 text-xs crm-text-secondary">
                    {member.relationshipType
                      ? member.relationshipType === "parent"
                        ? t("customers.familyRelationshipParentDisplay")
                        : t(relationshipLabelKey(member.relationshipType))
                      : t("customers.familyMember")}
                  </p>
                </Link>

                <div className="flex shrink-0 items-center gap-1">
                  {canManageExistingFamily ? (
                    <div className="relative" ref={openMenuId === member.customerId ? menuRef : undefined}>
                      <button
                        type="button"
                        className="inline-flex h-8 w-8 items-center justify-center rounded-md text-[var(--crm-text-muted)] hover:bg-[var(--crm-surface-muted)] hover:text-[var(--crm-text)]"
                        aria-label={t("customers.familyMemberActions")}
                        aria-haspopup="menu"
                        aria-expanded={openMenuId === member.customerId}
                        onClick={() =>
                          setOpenMenuId((current) =>
                            current === member.customerId ? null : member.customerId,
                          )
                        }
                      >
                        <MoreHorizontal className="h-4 w-4" aria-hidden="true" />
                      </button>

                      {openMenuId === member.customerId ? (
                        <div
                          role="menu"
                          className="absolute right-0 top-full z-20 mt-1 min-w-[11rem] rounded-lg border border-[var(--crm-border)] bg-[var(--crm-surface)] py-1 shadow-lg"
                        >
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-sm crm-text hover:bg-[var(--crm-surface-muted)]"
                            onClick={() => {
                              setOpenMenuId(null);
                              setEditMember(member);
                            }}
                          >
                            {member.relationshipType
                              ? t("customers.familyEditRelationship")
                              : t("customers.familySetRelationship")}
                          </button>
                          <button
                            type="button"
                            role="menuitem"
                            className="block w-full px-3 py-2 text-left text-sm crm-text hover:bg-[var(--crm-surface-muted)]"
                            onClick={() => {
                              setOpenMenuId(null);
                              setUnlinkMember(member);
                            }}
                          >
                            {t("customers.familyUnlinkAction")}
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                  <ChevronRight
                    className="h-3.5 w-3.5 crm-text-muted"
                    aria-hidden="true"
                  />
                </div>
              </div>
            </li>
          ))}

          {summary.hasProtectedMembers && (
            <li className="flex min-w-0 items-start gap-2.5 py-3">
              <LockKeyhole
                className="mt-0.5 h-3.5 w-3.5 shrink-0 crm-text-muted"
                aria-hidden="true"
              />
              <div className="min-w-0">
                <p className="text-sm crm-text-secondary">
                  {t("customers.familyProtectedMember")}
                </p>
                <p className="mt-0.5 text-xs crm-text-muted">
                  {t("customers.familyProtectedAccess")}
                </p>
              </div>
            </li>
          )}
        </ul>
      ) : null}

      {editMember ? (
        <CustomerFamilyEditRelationshipModal
          customerId={customerId}
          currentCustomerName={currentCustomerName}
          targetCustomerId={editMember.customerId}
          targetCustomerName={editMember.customerName}
          currentRelationship={editMember.relationshipType}
          open={editMember != null}
          onClose={() => setEditMember(null)}
        />
      ) : null}

      {unlinkMember ? (
        <CustomerFamilyUnlinkModal
          customerId={customerId}
          targetCustomerId={unlinkMember.customerId}
          targetCustomerName={unlinkMember.customerName}
          open={unlinkMember != null}
          onClose={() => setUnlinkMember(null)}
        />
      ) : null}
    </div>
  );
}
