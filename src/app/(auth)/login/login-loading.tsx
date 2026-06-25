"use client";

import { T } from "@/components/i18n/t";

export function LoginLoadingFallback() {
  return (
    <div className="flex min-h-full items-center justify-center text-slate-500">
      <T k="common.loading" />
    </div>
  );
}
