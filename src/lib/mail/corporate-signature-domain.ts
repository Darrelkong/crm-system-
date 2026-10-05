import { z } from "zod";

export const CORPORATE_SIGNATURE_RENDERING_CONTRACT = "echfront-corporate-v1" as const;

// Reject markup/control characters before normalization; escape again at output.
// Literal punctuation/quotes/ampersands remain plain content, never attributes.
const plainText = (max: number) => z.string().max(max)
  .refine((value) => !/[<>\p{Cc}\p{Cf}\u2028\u2029]/u.test(value), "Plain text only")
  .transform((value) => value.normalize("NFC").trim().replace(/ +/g, " "))
  .pipe(z.string().min(1).max(max));
const optionalText = (max: number) => z.union([z.null(), z.literal(""), plainText(max)])
  .transform((value) => value === "" ? null : value);

/** No markup/style extension points. Unknown keys are rejected, not ignored. */
export const corporateSignatureContentSchema = z.object({
  brandLabel: plainText(80),
  serviceLine1: plainText(180),
  serviceLine2: plainText(180),
  website: z.literal("echfronthk.com"),
  tagline: plainText(180),
  confidentialityHeading: plainText(80),
  confidentialityParagraph1: plainText(2000),
  confidentialityParagraph2: plainText(2000),
  legalEntityLine: plainText(180),
}).strict();
export type CorporateSignatureContent = z.infer<typeof corporateSignatureContentSchema>;

/** Canonical V1 fixture, not a database seed or an active-template fallback. */
export const CORPORATE_SIGNATURE_V1: Readonly<CorporateSignatureContent> = Object.freeze({
  brandLabel: "ECHFRONT",
  serviceLine1: "Global Mobility · U.S. Immigration · Private Client",
  serviceLine2: "Corporate & Cross-Border Advisory",
  website: "echfronthk.com",
  tagline: "Clarity Across Borders.",
  confidentialityHeading: "CONFIDENTIALITY NOTICE",
  confidentialityParagraph1: "This email and any attachments are confidential and intended solely for the named recipient(s). They may contain privileged or sensitive business information. If you are not the intended recipient, please notify the sender immediately, delete this email from your system, and do not copy, distribute or disclose its contents.",
  confidentialityParagraph2: "ECHFRONT provides immigration, global mobility and cross-border advisory services. Information contained in this email is provided for general business and informational purposes only and should not be regarded as a guarantee of any immigration, banking, corporate or regulatory outcome. Final approvals, requirements and decisions remain subject to the relevant government authority, financial institution or other competent third party.",
  legalEntityLine: "ECHFRONT HONG KONG LIMITED · Hong Kong",
});

export const corporateSignatureTemplateSchema = z.object({
  id: z.string().min(1).max(128),
  scope: z.literal("echfront"),
  versionNumber: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
  renderingContractVersion: z.literal(CORPORATE_SIGNATURE_RENDERING_CONTRACT),
  content: corporateSignatureContentSchema,
}).strict();
export type CorporateSignatureTemplate = z.infer<typeof corporateSignatureTemplateSchema>;

export const signatureProfileSchema = z.object({
  identityType: z.enum(["personal", "corporate"]),
  jobTitle: optionalText(120),
  phone: optionalText(64),
  revision: z.number().int().positive().max(Number.MAX_SAFE_INTEGER),
}).strict();
export type SignatureProfile = z.infer<typeof signatureProfileSchema>;

// The address comes ONLY from the selected authorized Sender Identity. The
// caller remains responsible for Send-As authorization; this pure domain grants none.
const senderSchema = z.object({
  id: z.string().min(1).max(128),
  displayName: plainText(160),
  address: z.string().max(254).email()
    .refine((value) => !/[<>\p{Cc}\p{Cf}\s]/u.test(value), "Invalid sender address"),
}).strict();
export type CorporateSignatureSender = z.infer<typeof senderSchema>;

export class CorporateSignatureConfigurationError extends Error {
  readonly code = "CONFIGURATION_ERROR";
  constructor() {
    super("Corporate signature template or Sender Identity profile is not configured or valid");
    this.name = "CorporateSignatureConfigurationError";
  }
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}

/** Deterministic historical rendering: explicit immutable version + explicit profile.
 * Does not resolve active versions, consult actor/mailbox/env, or read/write storage.
 */
export function renderCorporateSignature(
  templateInput: CorporateSignatureTemplate,
  senderInput: CorporateSignatureSender,
  profileInput: SignatureProfile,
) {
  const templateResult = corporateSignatureTemplateSchema.safeParse(templateInput);
  const senderResult = senderSchema.safeParse(senderInput);
  const profileResult = signatureProfileSchema.safeParse(profileInput);
  if (!templateResult.success || !senderResult.success || !profileResult.success) {
    throw new CorporateSignatureConfigurationError();
  }
  const template = templateResult.data;
  const sender = senderResult.data;
  const profile = profileResult.data;
  const c = template.content;
  const identity = [sender.displayName, ...(profile.jobTitle ? [profile.jobTitle] : [])];
  const contacts = [`E ${sender.address}`, `W ${c.website}`, ...(profile.phone ? [`M ${profile.phone}`] : [])];
  const bodyText = [identity.join("\n"), [c.brandLabel, c.serviceLine1, c.serviceLine2].join("\n"),
    contacts.join("\n"), c.tagline, c.confidentialityHeading,
    c.confidentialityParagraph1, c.confidentialityParagraph2, c.legalEntityLine].join("\n\n");
  const lines = (values: string[]) => values.map(escapeHtml).join("<br>");
  // Deliberately no href/tel construction or assets in V1. All contact details
  // remain readable plain content; fixed inline styles are the renderer contract.
  const bodyHtmlSanitized = '<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.5;color:#374151">'
    + `<p><strong>${escapeHtml(sender.displayName)}</strong>${profile.jobTitle ? `<br>${escapeHtml(profile.jobTitle)}` : ""}</p>`
    + `<p><strong>${escapeHtml(c.brandLabel)}</strong><br>${lines([c.serviceLine1, c.serviceLine2])}</p>`
    + `<p>${lines(contacts)}</p><p>${escapeHtml(c.tagline)}</p>`
    + '<div style="font-size:11px;line-height:1.5;color:#6b7280">'
    + [c.confidentialityHeading, c.confidentialityParagraph1, c.confidentialityParagraph2, c.legalEntityLine]
      .map((value) => `<p>${escapeHtml(value)}</p>`).join("")
    + "</div></div>";
  return { bodyText, bodyHtmlSanitized, templateVersionId: template.id,
    templateVersionNumber: template.versionNumber, profileRevision: profile.revision };
}

/** Future generation boundary: no active template/profile means a configuration
 * error, never empty/legacy/actor fallback. Not wired into today's runtime.
 */
export function generateCorporateSignature(
  activeTemplate: (CorporateSignatureTemplate & { isActive: boolean }) | null,
  sender: CorporateSignatureSender,
  profile: SignatureProfile | null,
) {
  if (!activeTemplate?.isActive || !profile) throw new CorporateSignatureConfigurationError();
  const { isActive: _active, ...template } = activeTemplate;
  void _active;
  return renderCorporateSignature(template, sender, profile);
}

export type SignatureSnapshotProvenance = {
  sourceSignatureVersionId: string | null;
  sourceCorporateTemplateVersionId: string | null;
  sourceSignatureProfileRevision: number | null;
};

/** Mirrors additive SQL provenance checks; legacy NULL source remains valid. */
export function assertSignatureSnapshotProvenance(value: SignatureSnapshotProvenance): void {
  const corporate = value.sourceCorporateTemplateVersionId;
  const revision = value.sourceSignatureProfileRevision;
  if (corporate === null ? revision !== null : (
    corporate.length === 0 || value.sourceSignatureVersionId !== null ||
    revision === null || !Number.isSafeInteger(revision) || revision < 1
  )) throw new CorporateSignatureConfigurationError();
}

/** Pure concurrency foundation. M2B must persist this with expected-revision CAS. */
export function nextSignatureProfileRevision(current: number): number {
  if (!Number.isSafeInteger(current) || current < 0 || current >= Number.MAX_SAFE_INTEGER) {
    throw new CorporateSignatureConfigurationError();
  }
  return current + 1;
}
