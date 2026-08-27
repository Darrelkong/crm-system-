import type { CloudflareEmailSendBinding } from "@/lib/mail/cloudflare-email-notification-transport-adapter";
import {
  isCloudflareOutboundProductionMode,
  type MailOutboundTransportMode,
} from "@/lib/mail/outbound-transport-constants";

export const MAIL_BUSINESS_EMAIL_BINDING_NAME = "BUSINESS_EMAIL" as const;

export const BUSINESS_EMAIL_BINDING_UNAVAILABLE =
  "BUSINESS_EMAIL_BINDING_UNAVAILABLE" as const;

export type OutboundBusinessEmailBindingEnv = {
  [MAIL_BUSINESS_EMAIL_BINDING_NAME]?: CloudflareEmailSendBinding;
};

export function resolveBusinessEmailBinding(
  env: OutboundBusinessEmailBindingEnv,
): CloudflareEmailSendBinding | undefined {
  return env[MAIL_BUSINESS_EMAIL_BINDING_NAME];
}

export function assertBusinessEmailBindingForProductionMode(input: {
  transportMode: MailOutboundTransportMode;
  businessEmailBinding?: CloudflareEmailSendBinding;
}): void {
  if (!isCloudflareOutboundProductionMode(input.transportMode)) {
    return;
  }
  if (!input.businessEmailBinding) {
    throw new Error(BUSINESS_EMAIL_BINDING_UNAVAILABLE);
  }
}

export function isBusinessEmailBindingRequired(
  transportMode: MailOutboundTransportMode,
): boolean {
  return isCloudflareOutboundProductionMode(transportMode);
}
