import { sql } from "drizzle-orm";
import { integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";
import { users } from "./users";

/** One corporate lineage. SQL 0093 makes content append-only, retains history,
 * constrains scope/contract/lifecycle, and leaves the table empty initially.
 * All content is plain text validated by the corporate-signature domain.
 * No raw HTML/CSS, assets, or identity/profile values belong here.
 */
export const mailCorporateSignatureTemplateVersions = sqliteTable(
  "mail_corporate_signature_template_versions",
  {
    id: text("id").primaryKey(),
    scope: text("scope", { enum: ["echfront"] }).notNull().default("echfront"),
    versionNumber: integer("version_number").notNull(),
    renderingContractVersion: text("rendering_contract_version").notNull(),
    brandLabel: text("brand_label").notNull(),
    serviceLine1: text("service_line_1").notNull(),
    serviceLine2: text("service_line_2").notNull(),
    website: text("website").notNull(),
    tagline: text("tagline").notNull(),
    confidentialityHeading: text("confidentiality_heading").notNull(),
    confidentialityParagraph1: text("confidentiality_paragraph_1").notNull(),
    confidentialityParagraph2: text("confidentiality_paragraph_2").notNull(),
    legalEntityLine: text("legal_entity_line").notNull(),
    isActive: integer("is_active").notNull().default(0),
    createdByUserId: text("created_by_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: text("created_at").notNull(),
    activatedAt: text("activated_at"),
    retiredAt: text("retired_at"),
    retiredByUserId: text("retired_by_user_id").references(() => users.id, { onDelete: "set null" }),
  },
  (table) => [
    uniqueIndex("uq_mail_corporate_signature_template_version").on(table.scope, table.versionNumber),
    uniqueIndex("uq_mail_corporate_signature_template_active").on(table.scope).where(sql`${table.isActive} = 1`),
  ],
);
export type MailCorporateSignatureTemplateVersion = typeof mailCorporateSignatureTemplateVersions.$inferSelect;
export type NewMailCorporateSignatureTemplateVersion = typeof mailCorporateSignatureTemplateVersions.$inferInsert;
