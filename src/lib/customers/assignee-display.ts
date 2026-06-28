export type AssigneeDisplayLocale = "zh" | "en";

function normalizeAssigneeNames(names: string[]): string[] {
  return names.map((name) => name.trim()).filter(Boolean);
}

function assigneeSeparator(locale: AssigneeDisplayLocale): string {
  return locale === "en" ? ", " : "、";
}

export function joinAssigneeNames(
  names: string[],
  locale: AssigneeDisplayLocale = "zh",
): string {
  const trimmed = normalizeAssigneeNames(names);
  if (trimmed.length === 0) {
    return "";
  }
  return trimmed.join(assigneeSeparator(locale));
}

export function formatAssigneeNamesForList(
  names: string[],
  locale: AssigneeDisplayLocale = "zh",
): { display: string; title?: string } {
  const trimmed = normalizeAssigneeNames(names);
  if (trimmed.length === 0) {
    return { display: "" };
  }

  const sep = assigneeSeparator(locale);
  const full = trimmed.join(sep);

  if (trimmed.length <= 2) {
    return { display: full };
  }

  const overflow = trimmed.length - 2;
  return {
    display: `${trimmed.slice(0, 2).join(sep)} +${overflow}`,
    title: full,
  };
}

export type AssigneeStaffListInput = {
  status: string;
  ownerId: string | null;
  ownerName: string | null;
  assigneeNames: string[];
};

export type AssigneeStaffListLabels = {
  publicPool: string;
  unknownStaff: string;
};

export function resolveAssigneeStaffForList(
  customer: AssigneeStaffListInput,
  labels: AssigneeStaffListLabels,
  locale: AssigneeDisplayLocale = "zh",
): { display: string; title?: string } {
  if (!customer.ownerId || customer.status === "public_pool") {
    return { display: labels.publicPool };
  }

  if (customer.assigneeNames.length > 0) {
    return formatAssigneeNamesForList(customer.assigneeNames, locale);
  }

  if (customer.ownerName?.trim()) {
    return { display: customer.ownerName };
  }

  return { display: labels.unknownStaff };
}

export function resolveAssigneeStaffForDetail(
  customer: AssigneeStaffListInput,
  labels: AssigneeStaffListLabels,
  locale: AssigneeDisplayLocale = "zh",
): string {
  if (!customer.ownerId || customer.status === "public_pool") {
    return labels.publicPool;
  }

  if (customer.assigneeNames.length > 0) {
    return joinAssigneeNames(customer.assigneeNames, locale);
  }

  if (customer.ownerName?.trim()) {
    return customer.ownerName;
  }

  return labels.unknownStaff;
}
