export type MailReadSource = "prototype" | "production";

export const MAIL_READ_SOURCE_ENV = "NEXT_PUBLIC_MAIL_READ_SOURCE";

export function resolveMailReadSourceFromEnv(
  value: string | undefined,
): MailReadSource {
  const normalized = value?.trim().toLowerCase();
  if (normalized === "production") {
    return "production";
  }
  return "prototype";
}

export function resolveMailReadSource(): MailReadSource {
  return resolveMailReadSourceFromEnv(process.env.NEXT_PUBLIC_MAIL_READ_SOURCE);
}

export function usesProductionMailReadSource(
  source: MailReadSource = resolveMailReadSource(),
): boolean {
  return source === "production";
}
