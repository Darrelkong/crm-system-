export type StaffCustomerRefEntry = {
  customerId: string;
  displayLabel: string;
  href: string;
};

export class StaffCustomerRefMap {
  private readonly refToEntry = new Map<string, StaffCustomerRefEntry>();
  private readonly customerIdToRef = new Map<string, string>();

  constructor(customerIds: string[]) {
    customerIds.forEach((customerId, index) => {
      const ref = `C${index + 1}`;
      this.refToEntry.set(ref, {
        customerId,
        displayLabel: `客户 ${index + 1}`,
        href: `/customers/${customerId}`,
      });
      this.customerIdToRef.set(customerId, ref);
    });
  }

  getRefForCustomerId(customerId: string): string | undefined {
    return this.customerIdToRef.get(customerId);
  }

  isAuthorizedRef(ref: string | undefined): boolean {
    if (!ref) return true;
    return this.refToEntry.has(ref);
  }

  resolveRef(ref: string | undefined):
    | { authorized: true; entry?: StaffCustomerRefEntry }
    | { authorized: false } {
    if (!ref) {
      return { authorized: true };
    }
    const entry = this.refToEntry.get(ref);
    if (!entry) {
      return { authorized: false };
    }
    return { authorized: true, entry };
  }

  toProviderList(): Array<{
    ref: string;
    stage: string | null;
    followUpStatus: "due_today" | "overdue" | "scheduled" | "none";
    overdueHours?: number;
    reclamationDaysRemaining?: number;
    pendingActions: string[];
  }> {
    return [...this.refToEntry.entries()].map(([ref, entry]) => {
      const meta = entry as StaffCustomerRefEntry & {
        stage?: string | null;
        followUpStatus?: "due_today" | "overdue" | "scheduled" | "none";
        overdueHours?: number;
        reclamationDaysRemaining?: number;
        pendingActions?: string[];
      };
      return {
        ref,
        stage: meta.stage ?? null,
        followUpStatus: meta.followUpStatus ?? "none",
        overdueHours: meta.overdueHours,
        reclamationDaysRemaining: meta.reclamationDaysRemaining,
        pendingActions: meta.pendingActions ?? [],
      };
    });
  }

  attachProviderMetadata(
    customerId: string,
    metadata: Omit<
      ReturnType<StaffCustomerRefMap["toProviderList"]>[number],
      "ref"
    >,
  ): void {
    const ref = this.customerIdToRef.get(customerId);
    if (!ref) return;
    const entry = this.refToEntry.get(ref);
    if (!entry) return;
    Object.assign(entry, metadata);
  }
}
