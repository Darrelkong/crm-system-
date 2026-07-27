import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveCustomerNameLabelModel } from "@/lib/customers/customer-name-label";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Phase 2D-1 authorized views wire CustomerNameLabel", () => {
  it("customer list uses CustomerNameLabel with nameStatus", () => {
    const source = read(
      "src/app/(dashboard)/customers/customers-list-client.tsx",
    );
    assert.match(source, /CustomerNameLabel/);
    assert.match(source, /nameStatus=\{c\.nameStatus\}/);
    assert.match(source, /customers\.namePendingBadge/);
    assert.doesNotMatch(source, /getCustomerDisplayName/);
  });

  it("follow-up list uses CustomerNameLabel for display rows", () => {
    const source = read("src/components/follow-ups/follow-ups-list-client.tsx");
    assert.match(source, /CustomerNameLabel/);
    assert.match(source, /nameStatus=\{item\.nameStatus\}/);
    assert.match(source, /customers\.namePendingBadge/);
    // Filter still uses display helper for search matching.
    assert.match(source, /getCustomerDisplayName/);
  });

  it("approvals query selects nameStatus onto ApprovalListItem", () => {
    const source = read("src/lib/approvals/queries.ts");
    assert.match(source, /nameStatus: string/);
    assert.match(source, /nameStatus: schema\.customers\.nameStatus/);
    assert.match(source, /nameStatus: row\.nameStatus/);
  });

  it("approvals client and on-hold detail use CustomerNameLabel", () => {
    const client = read("src/app/(dashboard)/approvals/approvals-client.tsx");
    const onHold = read(
      "src/components/approvals/create-on-hold-customer-detail.tsx",
    );
    assert.match(client, /CustomerNameLabel/);
    assert.match(client, /item\.nameStatus/);
    assert.match(client, /selected\.nameStatus/);
    assert.match(client, /nameStatus=\{selected\.nameStatus\}/);
    assert.match(onHold, /CustomerNameLabel/);
    assert.match(onHold, /nameStatus=\{nameStatus\}/);
  });

  it("random claim success includes nameStatus only after success path", () => {
    const service = read("src/lib/public-pool/random-claim-service.ts");
    const route = read("src/app/api/public-pool/claim-random/route.ts");
    const dialog = read(
      "src/app/(dashboard)/public-pool/random-claim-result-dialog.tsx",
    );
    const ui = read("src/app/(dashboard)/public-pool/random-claim-ui.ts");

    assert.match(service, /nameStatus: customer\.nameStatus/);
    assert.match(route, /nameStatus: result\.nameStatus/);
    assert.match(ui, /nameStatus: string/);
    assert.match(dialog, /CustomerNameLabel/);
    assert.match(dialog, /result\.nameStatus/);

    // Failure JSON path must not add nameStatus.
    assert.doesNotMatch(
      route,
      /ok:\s*false[\s\S]*nameStatus/,
    );
  });

  it("staff public pool formatter remains unchanged (no nameStatus)", () => {
    const queries = read("src/lib/public-pool/queries.ts");
    const display = read("src/lib/public-pool/display.ts");
    assert.match(queries, /function formatStaffPublicPoolCustomer/);
    assert.doesNotMatch(
      queries.slice(
        queries.indexOf("export function formatStaffPublicPoolCustomer"),
        queries.indexOf("export function formatAdminPublicPoolCustomer"),
      ),
      /nameStatus/,
    );
    assert.match(display, /maskPublicPoolCustomerName/);
  });

  it("reports recent follow-ups DTO and UI include nameStatus + label", () => {
    const types = read("src/lib/reports/types.ts");
    const query = read("src/lib/reports/recent-follow-ups.ts");
    const ui = read("src/components/reports/recent-follow-ups-list.tsx");
    assert.match(types, /nameStatus: string/);
    assert.match(query, /nameStatus: schema\.customers\.nameStatus/);
    assert.match(ui, /CustomerNameLabel/);
    assert.match(ui, /item\.nameStatus/);
  });

  it("pending vs confirmed badge model for wired surfaces", () => {
    assert.equal(
      resolveCustomerNameLabelModel({
        customerName: "X先生",
        nameStatus: "pending",
        locale: "en",
      }).showPendingBadge,
      true,
    );
    assert.equal(
      resolveCustomerNameLabelModel({
        customerName: "王小明",
        nameStatus: "confirmed",
        locale: "zh-Hant",
      }).showPendingBadge,
      false,
    );
  });

  it("does not touch notifications or P3 surfaces in this change", () => {
    // Guard: this test file is the wiring contract; ensure out-of-scope files
    // are not imported by the shared label (no notification coupling).
    const label = read("src/components/customers/customer-name-label.tsx");
    assert.doesNotMatch(label, /notification/i);
    assert.doesNotMatch(label, /collaborative-dry-run/);
    assert.doesNotMatch(label, /recycle-bin/);
  });
});
