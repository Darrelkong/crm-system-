import assert from "node:assert/strict";
import { describe, it } from "node:test";
import sanitizeHtml from "sanitize-html";
import {
  CORPORATE_SIGNATURE_V1 as V1, CORPORATE_SIGNATURE_RENDERING_CONTRACT,
  CorporateSignatureConfigurationError, assertSignatureSnapshotProvenance,
  corporateSignatureContentSchema, generateCorporateSignature,
  nextSignatureProfileRevision, renderCorporateSignature, signatureProfileSchema,
  type CorporateSignatureTemplate, type SignatureProfile,
} from "./corporate-signature-domain";

const template: CorporateSignatureTemplate = { id: "v1", scope: "echfront", versionNumber: 1,
  renderingContractVersion: CORPORATE_SIGNATURE_RENDERING_CONTRACT, content: { ...V1 } };
const sender = { id: "sender", displayName: "Daniel", address: "daniel@example.invalid" };
const profile: SignatureProfile = { identityType: "personal", jobTitle: "Adviser", phone: "+852 5555 0100", revision: 7 };
const render = (p = profile) => renderCorporateSignature(template, sender, p);

describe("M2A corporate signature contract", () => {
  it("preserves the exact approved V1 copy independently of UI locale", () => {
    assert.deepEqual(V1, {
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
  });
  it("renders exact text line ordering with no duplicate optional whitespace", () => {
    assert.equal(render().bodyText, `Daniel\nAdviser\n\nECHFRONT\nGlobal Mobility · U.S. Immigration · Private Client\nCorporate & Cross-Border Advisory\n\nE daniel@example.invalid\nW echfronthk.com\nM +852 5555 0100\n\nClarity Across Borders.\n\nCONFIDENTIALITY NOTICE\n\n${V1.confidentialityParagraph1}\n\n${V1.confidentialityParagraph2}\n\nECHFRONT HONG KONG LIMITED · Hong Kong`);
  });
  it("is deterministic for cloned inputs, including HTML and provenance", () => {
    assert.deepEqual(render(), renderCorporateSignature(structuredClone(template), { ...sender }, { ...profile }));
    assert.equal(render().templateVersionId, "v1");
    assert.equal(render().templateVersionNumber, 1);
    assert.equal(render().profileRevision, 7);
  });
  it("accepts explicitly personal and corporate identities without actor inference", () => {
    assert.equal(signatureProfileSchema.parse(profile).identityType, "personal");
    const result = renderCorporateSignature(template, { ...sender, displayName: "ECHFRONT Client Services" }, { ...profile, identityType: "corporate" });
    assert.ok(result.bodyText.startsWith("ECHFRONT Client Services\n"));
  });
  it("omits absent job title cleanly", () => {
    assert.ok(render({ ...profile, jobTitle: null }).bodyText.startsWith("Daniel\n\nECHFRONT\n"));
    assert.doesNotMatch(render({ ...profile, jobTitle: null }).bodyHtmlSanitized, /Daniel<\/strong><br>/);
  });
  it("omits absent phone without placeholder line", () => {
    assert.match(render({ ...profile, phone: null }).bodyText, /W echfronthk.com\n\nClarity/);
    assert.doesNotMatch(render({ ...profile, phone: null }).bodyHtmlSanitized, /<br>M /);
  });
  it("normalizes names and optional empty fields without inventing data", () => {
    const result = renderCorporateSignature(template, { ...sender, displayName: "  Daniel  Example  " }, { ...profile, jobTitle: "", phone: "" });
    assert.ok(result.bodyText.startsWith("Daniel Example\n\nECHFRONT"));
    assert.doesNotMatch(result.bodyText, /Adviser|5555/);
  });
  it("keeps the legal name only inside the lighter footer", () => {
    const html = render().bodyHtmlSanitized;
    const footer = html.indexOf('<div style="font-size:11px');
    assert.ok(footer > 0);
    assert.doesNotMatch(html.slice(0, footer), /HONG KONG LIMITED/);
    assert.match(html.slice(footer), /HONG KONG LIMITED/);
    assert.match(html, /font-size:14px/);
  });
  it("does not depend on theme classes, links, scripts, resources or UI lock labels", () => {
    const html = render().bodyHtmlSanitized;
    assert.doesNotMatch(html, /class=|href=|src=|<script|<style|<img|<iframe|on\w+=|🔒|系统|系統|url\(/i);
    const cleaned = sanitizeHtml(html, { allowedTags: ["div", "p", "br", "strong"], allowedAttributes: { "*": ["style"] } });
    assert.equal(cleaned.replace(/<br \/>/g, "<br>"), html);
  });
  for (const field of ["displayName", "jobTitle", "phone"] as const) {
    it(`rejects hostile markup/control in ${field} before rendering`, () => {
      for (const value of ['<script>alert(1)</script>', '<img onerror="evil()">', '<b>x</b>', "x\nBcc: injected", "x\u202Ey"]) {
        assert.throws(() => renderCorporateSignature(template,
          field === "displayName" ? { ...sender, displayName: value } : sender,
          field === "displayName" ? profile : { ...profile, [field]: value }), CorporateSignatureConfigurationError);
      }
    });
    it(`escapes quotes/ampersands and treats javascript: as inert ${field} text`, () => {
      const value = `javascript:alert('x') & "value"`;
      const result = renderCorporateSignature(template,
        field === "displayName" ? { ...sender, displayName: value } : sender,
        field === "displayName" ? profile : { ...profile, [field]: value });
      assert.ok(result.bodyHtmlSanitized.includes("javascript:alert(&#39;x&#39;) &amp; &quot;value&quot;"));
      assert.doesNotMatch(result.bodyHtmlSanitized, /href=|src=/);
    });
  }
  it("rejects template HTML, CSS extensions and unsafe website", () => {
    for (const content of [{ ...V1, html: "<p>extra</p>" }, { ...V1, css: "color:red" },
      { ...V1, brandLabel: "<img src=x>" }, { ...V1, website: "javascript:alert(1)" }]) {
      assert.equal(corporateSignatureContentSchema.safeParse(content).success, false);
    }
  });
  it("rejects oversized identity/profile/template text", () => {
    assert.throws(() => renderCorporateSignature(template, { ...sender, displayName: "x".repeat(161) }, profile));
    assert.equal(signatureProfileSchema.safeParse({ ...profile, jobTitle: "x".repeat(121) }).success, false);
    assert.equal(signatureProfileSchema.safeParse({ ...profile, phone: "x".repeat(65) }).success, false);
    assert.equal(corporateSignatureContentSchema.safeParse({ ...V1, tagline: "x".repeat(181) }).success, false);
  });
  it("rejects unknown type, unconfigured profile and nonpositive revision", () => {
    for (const patch of [{ identityType: null }, { identityType: "shared" }, { revision: 0 }, { revision: 1.5 }]) {
      assert.equal(signatureProfileSchema.safeParse({ ...profile, ...patch }).success, false);
    }
  });
  it("fails closed with no active template or profile; never empty/legacy fallback", () => {
    assert.throws(() => generateCorporateSignature(null, sender, profile), CorporateSignatureConfigurationError);
    assert.throws(() => generateCorporateSignature({ ...template, isActive: false }, sender, profile), CorporateSignatureConfigurationError);
    assert.throws(() => generateCorporateSignature({ ...template, isActive: true }, sender, null), CorporateSignatureConfigurationError);
    assert.deepEqual(generateCorporateSignature({ ...template, isActive: true }, sender, profile), render());
  });
  it("does not use actor, mailbox or profile email as a fallback", () => {
    assert.throws(() => renderCorporateSignature(template, { ...sender, displayName: "" }, profile));
    assert.throws(() => renderCorporateSignature(template, { ...sender, address: "" }, profile));
    assert.equal(signatureProfileSchema.safeParse({ ...profile, email: "actor@example.invalid" }).success, false);
  });
  it("rejects unsafe email/header data", () => {
    for (const address of ["javascript:alert(1)", 'x\" onmouseover=\"x@example.invalid', "a@example.invalid\r\nBcc:x"]) {
      assert.throws(() => renderCorporateSignature(template, { ...sender, address }, profile));
    }
  });
  it("allows historical rendering and identifies later template/profile revisions", () => {
    const original = render();
    const later = renderCorporateSignature({ ...template, id: "v2", versionNumber: 2, content: { ...V1, tagline: "Later approved text." } }, sender, { ...profile, revision: 8 });
    assert.equal(original.templateVersionId, "v1");
    assert.equal(later.templateVersionNumber, 2);
    assert.equal(later.profileRevision, 8);
    assert.notEqual(later.bodyText, original.bodyText);
    assert.deepEqual(render(), original);
  });
  it("defines monotonic profile revision and rejects invalid/overflow revisions", () => {
    assert.equal(nextSignatureProfileRevision(0), 1);
    assert.equal(nextSignatureProfileRevision(7), 8);
    for (const n of [-1, 0.5, NaN, Number.MAX_SAFE_INTEGER]) assert.throws(() => nextSignatureProfileRevision(n));
  });
  it("accepts legacy/no-source and complete corporate provenance only", () => {
    const legacy = { sourceSignatureVersionId: "old", sourceCorporateTemplateVersionId: null, sourceSignatureProfileRevision: null };
    assert.doesNotThrow(() => assertSignatureSnapshotProvenance(legacy));
    assert.doesNotThrow(() => assertSignatureSnapshotProvenance({ ...legacy, sourceSignatureVersionId: null }));
    const corporate = { sourceSignatureVersionId: null, sourceCorporateTemplateVersionId: "v1", sourceSignatureProfileRevision: 7 };
    assert.doesNotThrow(() => assertSignatureSnapshotProvenance(corporate));
    for (const patch of [{ sourceSignatureVersionId: "old" }, { sourceCorporateTemplateVersionId: null },
      { sourceSignatureProfileRevision: null }, { sourceSignatureProfileRevision: 0 }]) {
      assert.throws(() => assertSignatureSnapshotProvenance({ ...corporate, ...patch }));
    }
  });
});
