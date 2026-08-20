import { Suspense } from "react";
import { MailPrototypeProvider } from "@/lib/mail/prototype/state";
import { MailPrototypeShell } from "@/components/mail/prototype/mail-prototype-shell";

export default function MailPage() {
  return (
    <MailPrototypeProvider>
      <Suspense fallback={null}>
        <MailPrototypeShell role="admin" />
      </Suspense>
    </MailPrototypeProvider>
  );
}
