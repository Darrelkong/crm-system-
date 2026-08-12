"use client";

import { Users } from "lucide-react";

type Props = {
  label: string;
};

export function CustomerFamilyIcon({ label }: Props) {
  return (
    <span className="inline-flex shrink-0" title={label} aria-label={label}>
      <Users className="h-3.5 w-3.5 crm-text-muted" aria-hidden="true" />
    </span>
  );
}
