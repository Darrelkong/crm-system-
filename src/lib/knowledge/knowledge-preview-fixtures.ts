import { join } from "node:path";
import { isLocalAuthSimulationEnabled } from "@/lib/auth/local-preview-auth-simulation";

export const KNOWLEDGE_PREVIEW_FIXTURES_DIR = join(
  process.cwd(),
  "preview-fixtures/knowledge-ingest",
);

export type KnowledgePreviewFixture = {
  id: string;
  filename: string;
  titleKey: string;
  descriptionKey: string;
  mimeType: string;
};

export const KNOWLEDGE_PREVIEW_FIXTURES: readonly KnowledgePreviewFixture[] = [
  {
    id: "p2c-a1-simple",
    filename: "p2c-a1-simple.docx",
    titleKey: "knowledge.previewFixtures.simpleDocx",
    descriptionKey: "knowledge.previewFixtures.simpleDocxDescription",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    id: "p2c-a1-table",
    filename: "p2c-a1-table.docx",
    titleKey: "knowledge.previewFixtures.tableDocx",
    descriptionKey: "knowledge.previewFixtures.tableDocxDescription",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
  {
    id: "p2c-a1-text",
    filename: "p2c-a1-text.pdf",
    titleKey: "knowledge.previewFixtures.textPdf",
    descriptionKey: "knowledge.previewFixtures.textPdfDescription",
    mimeType: "application/pdf",
  },
  {
    id: "p2c-a1-scanned",
    filename: "p2c-a1-scanned.pdf",
    titleKey: "knowledge.previewFixtures.scannedPdf",
    descriptionKey: "knowledge.previewFixtures.scannedPdfDescription",
    mimeType: "application/pdf",
  },
  {
    id: "p2c-a1-duplicate",
    filename: "p2c-a1-duplicate.docx",
    titleKey: "knowledge.previewFixtures.duplicateDocx",
    descriptionKey: "knowledge.previewFixtures.duplicateDocxDescription",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  },
] as const;

const fixtureById = new Map(
  KNOWLEDGE_PREVIEW_FIXTURES.map((fixture) => [fixture.id, fixture]),
);

export function isKnowledgePreviewFixturesEnabled(
  env: Record<string, string | undefined> = process.env,
): boolean {
  return isLocalAuthSimulationEnabled(env);
}

export function getKnowledgePreviewFixture(
  fixtureId: string,
): KnowledgePreviewFixture | null {
  return fixtureById.get(fixtureId) ?? null;
}

export function getKnowledgePreviewFixturePath(fixture: KnowledgePreviewFixture): string {
  const resolved = join(KNOWLEDGE_PREVIEW_FIXTURES_DIR, fixture.filename);
  if (!resolved.startsWith(KNOWLEDGE_PREVIEW_FIXTURES_DIR)) {
    throw new Error("Invalid Knowledge preview fixture path");
  }
  return resolved;
}
