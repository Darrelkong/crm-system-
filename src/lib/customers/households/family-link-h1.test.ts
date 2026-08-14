import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { translate } from "@/i18n/translate";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("H1 family modal visibility", () => {
  it("returns null when open=false so ModalOverlay is not rendered", () => {
    const modal = read("src/components/customers/customer-family-link-existing-modal.tsx");
    const guardIdx = modal.indexOf("if (!open)");
    const returnIdx = modal.indexOf("return (", guardIdx);
    const overlayIdx = modal.indexOf("<ModalOverlay", guardIdx);
    assert.ok(guardIdx >= 0, "expected open guard");
    assert.ok(returnIdx >= 0 && returnIdx < overlayIdx, "guard must precede ModalOverlay");
    assert.match(modal.slice(guardIdx, overlayIdx), /return null/);
  });

  it("renders ModalOverlay only after the open guard", () => {
    const modal = read("src/components/customers/customer-family-link-existing-modal.tsx");
    assert.match(modal, /<ModalPanel/);
    const hooksEnd = modal.lastIndexOf("useEffect");
    const guardIdx = modal.indexOf("if (!open)", hooksEnd);
    assert.ok(guardIdx > hooksEnd, "open guard must follow hook declarations");
  });

  it("cancel button calls onClose", () => {
    const modal = read("src/components/customers/customer-family-link-existing-modal.tsx");
    assert.match(modal, /onClick=\{onClose\}/);
    assert.match(modal, /t\("common\.cancel"\)/);
  });
});

describe("H1 customer detail family modal wiring", () => {
  it("initializes family modal and chooser closed", () => {
    const client = read("src/app/(dashboard)/customers/[id]/customer-detail-client.tsx");
    assert.match(client, /useState\(false\)/);
    assert.match(client, /familyModalOpen/);
    assert.match(client, /familyChooserOpen/);
  });

  it("opens chooser from Add Family Member and link-existing modal from chooser", () => {
    const client = read("src/app/(dashboard)/customers/[id]/customer-detail-client.tsx");
    assert.match(client, /onAddFamilyMember=\{\(\) => setFamilyChooserOpen\(true\)\}/);
    assert.match(client, /open=\{familyModalOpen\}/);
    assert.match(client, /open=\{familyChooserOpen\}/);
    assert.match(client, /onClose=\{\(\) => setFamilyModalOpen\(false\)\}/);
    assert.match(client, /CustomerFamilyMemberChooserModal/);
    const modalOpenCalls = client.match(/setFamilyModalOpen\(true\)/g) ?? [];
    assert.equal(modalOpenCalls.length, 1, "link-existing modal opens only from chooser");
  });
});

describe("H1 family wizard i18n", () => {
  it("interpolates wizard step in zh-Hans without raw braces", () => {
    const rendered = translate(zhHans, "customers.familyWizardStep", {
      step: "1",
      total: "3",
    });
    assert.equal(rendered, "第 1 / 3 步");
    assert.doesNotMatch(rendered, /\{step\}|\{total\}|\{\{step\}\}|\{\{total\}\}/);
  });

  it("interpolates wizard step in zh-Hant without raw braces", () => {
    const rendered = translate(zhHant, "customers.familyWizardStep", {
      step: "1",
      total: "3",
    });
    assert.equal(rendered, "第 1 / 3 步");
    assert.doesNotMatch(rendered, /\{step\}|\{total\}|\{\{step\}\}|\{\{total\}\}/);
  });

  it("interpolates wizard step in en without raw braces", () => {
    const rendered = translate(en, "customers.familyWizardStep", {
      step: "1",
      total: "3",
    });
    assert.equal(rendered, "Step 1 / 3");
    assert.doesNotMatch(rendered, /\{step\}|\{total\}|\{\{step\}\}|\{\{total\}\}/);
  });

  it("defines common.next in all locales", () => {
    assert.equal(translate(zhHans, "common.next"), "下一步");
    assert.equal(translate(zhHant, "common.next"), "下一步");
    assert.equal(translate(en, "common.next"), "Next");
    assert.notEqual(translate(zhHans, "common.next"), "common.next");
    assert.notEqual(translate(en, "common.next"), "common.next");
  });

  it("modal uses common.next for step-one advance button", () => {
    const modal = read("src/components/customers/customer-family-link-existing-modal.tsx");
    assert.match(modal, /t\("common\.next"\)/);
  });
});
