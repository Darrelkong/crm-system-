"use client";

import { createContext, useContext, type ReactNode } from "react";
import {
  resolveMailReadSource,
  usesProductionMailReadSource,
  type MailReadSource,
} from "@/lib/mail/client/mail-read-source";

const MailReadSourceContext = createContext<MailReadSource>("prototype");

export type MailReadSourceProviderProps = {
  children: ReactNode;
  source?: MailReadSource;
};

export function MailReadSourceProvider({
  children,
  source = resolveMailReadSource(),
}: MailReadSourceProviderProps) {
  return (
    <MailReadSourceContext.Provider value={source}>
      {children}
    </MailReadSourceContext.Provider>
  );
}

export function useMailReadSource(): MailReadSource {
  return useContext(MailReadSourceContext);
}

export function useIsProductionMailReadSource(): boolean {
  return usesProductionMailReadSource(useMailReadSource());
}
