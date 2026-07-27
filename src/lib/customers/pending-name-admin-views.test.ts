import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "node:test";
import { resolveCustomerNameLabelModel } from "@/lib/customers/customer-name-label";
import en from "@/i18n/locales/en";
import zhHans from "@/i18n/locales/zh-Hans";
import zhHant from "@/i18n/locales/zh-Hant";

const root = process.cwd();

function read(rel: string): string {
  return readFileSync(join(root, rel), "utf8");
}

describe("Phase 2D-3A admin views wire CustomerNameLabel", () => {
  it("collaborative dry-run DTO selects and returns nameStatus", () => {
    const source = read("src/lib/reclamation/collaborative-dry-run.ts");
    assert.match(source, /nameStatus: string/);
    assert.match(source, /nameStatus: schema\.customers\.nameStatus/);
    assert.match(source, /nameStatus: customer\.nameStatus/);
  });

  it("collaborative dry-run UI uses CustomerNameLabel", () => {
    const source = read(
      "src/app/(dashboard)/admin/reclamation/collaborative-dry-run/collaborative-dry-run-client.tsx",
    );
    assert.match(source, /CustomerNameLabel/);
    assert.match(source, /nameStatus=\{row\.nameStatus\}/);
    assert.match(source, /customers\.namePendingBadge/);
    assert.doesNotMatch(source, />\{\s*row\.customerName\s*\}</);
  });

  it("collaborative dry-run remains Admin-only via API wrapper", () => {
    const api = read("src/lib/reclamation/collaborative-dry-run-api.ts");
    const route = read(
      "src/app/api/admin/reclamation/collaborative-dry-run/route.ts",
    );
    assert.match(api, /actor\.role !== "admin"/);
    assert.match(route, /requireAdmin/);
  });

  it("AI feedback recent row DTO includes nameStatus; aggregates unchanged", () => {
    const source = read("src/lib/ai/customer-insights/feedback-stats.ts");
    assert.match(source, /nameStatus: string \| null/);
    assert.match(source, /nameStatus: schema\.customers\.nameStatus/);
    assert.match(source, /nameStatus: row\.nameStatus/);

    // Pure aggregate helpers remain name-free.
    assert.match(source, /export function buildSummaryFromRatings/);
    assert.match(source, /export function aggregateReasonTagRankings/);
    const summaryFn = source.slice(
      source.indexOf("export function buildSummaryFromRatings"),
      source.indexOf("export function aggregateReasonTagRankings"),
    );
    assert.doesNotMatch(summaryFn, /customerName|nameStatus/);
  });

  it("AI feedback recent rows UI uses CustomerNameLabel with link sibling", () => {
    const source = read(
      "src/components/admin/ai-insight-feedback-stats-panel.tsx",
    );
    assert.match(source, /CustomerNameLabel/);
    assert.match(source, /nameStatus=\{row\.nameStatus\}/);
    assert.match(source, /customers\.namePendingBadge/);
    assert.match(source, /renderName=/);
    assert.match(source, /href=\{`\/customers\/\$\{row\.customerId\}`\}/);
  });

  it("AI effect stats still forbid customerName in aggregate response", () => {
    const source = read(
      "src/lib/ai/customer-insights/ai-effect-stats-response.ts",
    );
    assert.match(source, /AI_EFFECT_STATS_FORBIDDEN_RESPONSE_KEYS/);
    assert.match(source, /"customerName"/);
    assert.doesNotMatch(source, /nameStatus/);
  });

  it("Admin public pool DTO includes nameStatus; staff formatter does not", () => {
    const queries = read("src/lib/public-pool/queries.ts");
    const adminSlice = queries.slice(
      queries.indexOf("export type AdminPublicPoolCustomerView"),
      queries.indexOf("export type PublicPoolCustomerView"),
    );
    const staffFn = queries.slice(
      queries.indexOf("export function formatStaffPublicPoolCustomer"),
      queries.indexOf("export function formatAdminPublicPoolCustomer"),
    );
    const adminFn = queries.slice(
      queries.indexOf("export function formatAdminPublicPoolCustomer"),
      queries.indexOf("export function formatPublicPoolCustomer"),
    );

    assert.match(adminSlice, /nameStatus: string/);
    assert.match(adminFn, /nameStatus: customer\.nameStatus/);
    assert.doesNotMatch(staffFn, /nameStatus/);
    assert.doesNotMatch(staffFn, /customerName/);
  });

  it("Admin public pool UI uses CustomerNameLabel; staff keeps maskedName", () => {
    const source = read(
      "src/app/(dashboard)/public-pool/public-pool-client.tsx",
    );
    assert.match(source, /CustomerNameLabel/);
    assert.match(source, /nameStatus=\{c\.nameStatus\}/);
    assert.match(source, /customers\.namePendingBadge/);
    assert.match(source, /c\.maskedName/);
    assert.match(source, /publicPool\.masked/);
  });

  it("recycle-bin DTO maps name_status and UI uses CustomerNameLabel", () => {
    const types = read("src/lib/recycle-bin/types.ts");
    const queries = read("src/lib/recycle-bin/queries.ts");
    const client = read(
      "src/app/(dashboard)/admin/recycle-bin/recycle-bin-client.tsx",
    );
    const modal = read(
      "src/app/(dashboard)/admin/recycle-bin/restore-customer-modal.tsx",
    );

    assert.match(types, /name_status: string/);
    assert.match(queries, /name_status: row\.nameStatus/);
    assert.match(client, /CustomerNameLabel/);
    assert.match(client, /nameStatus=\{row\.name_status\}/);
    assert.match(modal, /CustomerNameLabel/);
    assert.match(modal, /nameStatus=\{customer\.name_status\}/);
  });

  it("pending vs confirmed badge model for admin surfaces", () => {
    assert.equal(
      resolveCustomerNameLabelModel({
        customerName: "X女士",
        nameStatus: "pending",
        locale: "zh-Hant",
      }).showPendingBadge,
      true,
    );
    assert.equal(
      resolveCustomerNameLabelModel({
        customerName: "王小明",
        nameStatus: "confirmed",
        locale: "en",
      }).showPendingBadge,
      false,
    );
  });

  it("namePendingBadge i18n parity for admin views", () => {
    assert.equal(zhHant.customers.namePendingBadge, "姓名待確認");
    assert.equal(zhHans.customers.namePendingBadge, "姓名待确认");
    assert.equal(en.customers.namePendingBadge, "Name pending confirmation");
  });

  it("does not touch notifications or out-of-scope writers", () => {
    const notif = read("src/lib/notifications/customer-name.ts");
    assert.match(notif, /getCustomerNotificationDisplayName/);
    // Shared label stays presentational — no admin-surface coupling.
    const label = read("src/components/customers/customer-name-label.tsx");
    assert.doesNotMatch(label, /collaborative-dry-run/);
    assert.doesNotMatch(label, /recycle-bin/);
    assert.doesNotMatch(label, /feedback-stats/);
  });
});
