import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import path from "node:path";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";
import {
  assertMailCrmContextSafeShape,
  formatMailCrmAssociationType,
  hasMailCrmContextAssociation,
  MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS,
  pickMailCrmContextSafeFields,
  resolveMailCrmContextDefaultExpanded,
} from "@/lib/mail/crm/mail-crm-context-model";
import { resolveMailMessageCustomerAssociation } from "@/lib/mail/prototype/mail-crm-context-prototype";
import type { MailMessage } from "@/lib/mail/prototype/types";

const root = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../..",
);

function readSrc(rel: string): string {
  return readFileSync(path.join(root, rel), "utf8");
}

function collectStringKeys(
  value: unknown,
  prefix = "",
  out: string[] = [],
): string[] {
  if (typeof value === "string") {
    out.push(prefix);
    return out;
  }
  if (value && typeof value === "object") {
    for (const [key, child] of Object.entries(
      value as Record<string, unknown>,
    )) {
      const next = prefix ? `${prefix}.${key}` : key;
      collectStringKeys(child, next, out);
    }
  }
  return out;
}

function baseMessage(overrides: Partial<MailMessage> = {}): MailMessage {
  return {
    id: "msg-test",
    folder: "inbox",
    mailbox: "a@echfronthk.com",
    fromName: "John Smith",
    fromEmail: "john@gmail.com",
    to: ["a@echfronthk.com"],
    subject: "Test",
    preview: "Preview",
    body: "Body",
    sentAt: "2026-08-18T10:32:00+08:00",
    isUnread: false,
    hasAttachment: false,
    attachments: [],
    customerMatch: null,
    assignment: "none",
    ...overrides,
  };
}

describe("mail CRM context model", () => {
  it("detects when association data is present", () => {
    assert.equal(hasMailCrmContextAssociation(null), false);
    assert.equal(
      hasMailCrmContextAssociation({
        customerId: "cust-1",
        customerCode: "EF000123",
        name: "John Smith",
        salesStage: "interested",
        ownerName: "Employee A",
        associationType: "auto_match",
      }),
      true,
    );
  });

  it("formats association type labels", () => {
    assert.equal(
      formatMailCrmAssociationType("manual", {
        manual: "Manual",
        autoMatch: "Auto matched",
      }),
      "Manual",
    );
    assert.equal(
      formatMailCrmAssociationType("auto_match", {
        manual: "Manual",
        autoMatch: "Auto matched",
      }),
      "Auto matched",
    );
  });

  it("keeps only safe CRM context fields", () => {
    const safe = pickMailCrmContextSafeFields({
      customerId: "cust-1",
      customerCode: "EF000123",
      name: "John Smith",
      salesStage: "interested",
      ownerName: "Employee A",
      associationType: "manual",
    });
    assert.deepEqual(Object.keys(safe).sort(), [
      ...MAIL_CRM_CONTEXT_SAFE_FIELD_KEYS,
    ].sort());
    assert.doesNotThrow(() =>
      assertMailCrmContextSafeShape(safe as unknown as Record<string, unknown>),
    );
  });

  it("defaults desktop expanded and mobile collapsed", () => {
    assert.equal(resolveMailCrmContextDefaultExpanded("desktop"), true);
    assert.equal(resolveMailCrmContextDefaultExpanded("mobile"), false);
  });
});

describe("resolveMailMessageCustomerAssociation", () => {
  it("returns safe summary for visible prototype customer match", () => {
    const association = resolveMailMessageCustomerAssociation(
      baseMessage({
        customerMatch: { id: "cust-1", name: "John Smith" },
      }),
      "staff_single",
    );

    assert.ok(association);
    assert.equal(association.customerId, "cust-1");
    assert.equal(association.customerCode, "EF000123");
    assert.equal(association.name, "John Smith");
    assert.equal(association.associationType, "auto_match");
    assert.ok(association.salesStage);
    assert.ok(association.ownerName);
  });

  it("returns null when no association exists", () => {
    assert.equal(
      resolveMailMessageCustomerAssociation(
        baseMessage({ customerMatch: null }),
        "staff_single",
      ),
      null,
    );
  });

  it("hides inaccessible customers from non-owner staff", () => {
    assert.equal(
      resolveMailMessageCustomerAssociation(
        baseMessage({
          customerMatch: { id: "cust-robert", name: "Robert Lee" },
        }),
        "staff_single",
      ),
      null,
    );
  });

  it("prefers explicit customerAssociation payload when provided", () => {
    const association = resolveMailMessageCustomerAssociation(
      baseMessage({
        customerAssociation: {
          customerId: "cust-2",
          customerCode: "EF000100",
          name: "Lisa Park",
          salesStage: "proposal",
          ownerName: "Employee A",
          associationType: "manual",
        },
      }),
      "staff_single",
    );

    assert.equal(association?.customerId, "cust-2");
    assert.equal(association?.associationType, "manual");
  });
});

describe("MailCrmContextPanel UI contract", () => {
  it("keeps mail.crmContext i18n key parity across locales", () => {
    const enKeys = collectStringKeys(en.mail.crmContext, "mail.crmContext").sort();
    const hansKeys = collectStringKeys(
      zhHans.mail.crmContext,
      "mail.crmContext",
    ).sort();
    const hantKeys = collectStringKeys(
      zhHant.mail.crmContext,
      "mail.crmContext",
    ).sort();
    assert.deepEqual(hansKeys, enKeys);
    assert.deepEqual(hantKeys, enKeys);
  });

  it("does not render forbidden CRM fields in panel source", () => {
    const source = readSrc("src/components/mail/crm/mail-crm-context-panel.tsx");
    assert.doesNotMatch(source, /\bphone\b/i);
    assert.doesNotMatch(source, /\bwechatId\b/i);
    assert.doesNotMatch(source, /\bnotes\b/i);
    assert.doesNotMatch(source, /sourceRemark/);
    assert.match(source, /mail-crm-context-panel--mobile/);
    assert.match(source, /mail\.crmContext\.empty/);
  });

  it("mounts panel below reading content in message detail", () => {
    const source = readSrc("src/components/mail/prototype/mail-message-detail.tsx");
    assert.match(source, /MailCrmContextPanel/);
    assert.match(source, /resolveMailMessageCustomerAssociation/);
    const panelIndex = source.indexOf("<MailCrmContextPanel");
    const footerIndex = source.indexOf("mail-reading-footer");
    assert.ok(panelIndex > 0);
    assert.ok(footerIndex > panelIndex);
  });

  it("mounts production CRM panel from selectedMessage.customerAssociation only", () => {
    const source = readSrc(
      "src/components/mail/prototype/mail-production-reading-pane.tsx",
    );
    assert.match(source, /MailCrmContextPanel/);
    assert.match(source, /adaptProductionCustomerAssociation/);
    assert.match(source, /shouldRenderProductionCrmContextPanel/);
    assert.doesNotMatch(source, /resolveMailMessageCustomerAssociation/);
    assert.doesNotMatch(source, /lookupMailCustomerByEmail/);
    const panelIndex = source.indexOf("<MailCrmContextPanel");
    const footerIndex = source.indexOf("mail-reading-footer");
    assert.ok(panelIndex > 0);
    assert.ok(footerIndex > panelIndex);
  });

  it("omits production CRM panel when customerAssociation is null", () => {
    const source = readSrc(
      "src/components/mail/prototype/mail-production-reading-pane.tsx",
    );
    assert.match(source, /shouldRenderProductionCrmContextPanel/);
    assert.match(source, /customerAssociation \?/);
    assert.doesNotMatch(source, /hidden customer/i);
    assert.doesNotMatch(source, /no permission/i);
    assert.doesNotMatch(source, /mail\.crmContext\.empty/);
  });
});
