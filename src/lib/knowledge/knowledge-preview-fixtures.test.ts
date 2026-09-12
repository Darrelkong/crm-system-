import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { join } from "node:path";
import { LOCAL_AUTH_SIMULATION_FLAG } from "@/lib/auth/local-preview-auth-simulation";
import {
  getKnowledgePreviewFixture,
  getKnowledgePreviewFixturePath,
  isKnowledgePreviewFixturesEnabled,
  KNOWLEDGE_PREVIEW_FIXTURES,
} from "@/lib/knowledge/knowledge-preview-fixtures";
import { KNOWLEDGE_ERROR_CODES } from "@/lib/knowledge/constants";
import { KnowledgeServiceError } from "@/lib/knowledge/errors";
import { extractKnowledgeSourceText } from "@/lib/knowledge/source-extraction";
import { buildScannedPdfBytes } from "@/lib/knowledge/test-fixtures/source-documents";

describe("Knowledge preview fixtures", () => {
  it("is only enabled in local preview simulation mode", () => {
    assert.equal(
      isKnowledgePreviewFixturesEnabled({
        NODE_ENV: "development",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      true,
    );
    assert.equal(
      isKnowledgePreviewFixturesEnabled({
        NODE_ENV: "production",
        [LOCAL_AUTH_SIMULATION_FLAG]: "true",
      }),
      false,
    );
  });

  it("uses a fixed allowlist without directory traversal", () => {
    assert.equal(KNOWLEDGE_PREVIEW_FIXTURES.length, 5);
    assert.equal(getKnowledgePreviewFixture("p2c-a1-simple")?.filename, "p2c-a1-simple.docx");
    assert.equal(getKnowledgePreviewFixture("../secrets"), null);
    assert.throws(() =>
      getKnowledgePreviewFixturePath({
        id: "evil",
        filename: "../evil.docx",
        titleKey: "x",
        descriptionKey: "y",
        mimeType: "text/plain",
      }),
    );
  });

  it("contains safe synthetic extraction content", async () => {
    const root = join(process.cwd(), "preview-fixtures/knowledge-ingest");
    const simpleDocx = readFileSync(join(root, "p2c-a1-simple.docx"));
    const simple = await extractKnowledgeSourceText({
      bytes: simpleDocx.buffer.slice(
        simpleDocx.byteOffset,
        simpleDocx.byteOffset + simpleDocx.byteLength,
      ),
      filename: "p2c-a1-simple.docx",
    });
    assert.match(simple.text, /simple DOCX fixture/i);

    const tableDocx = readFileSync(join(root, "p2c-a1-table.docx"));
    const table = await extractKnowledgeSourceText({
      bytes: tableDocx.buffer.slice(
        tableDocx.byteOffset,
        tableDocx.byteOffset + tableDocx.byteLength,
      ),
      filename: "p2c-a1-table.docx",
    });
    assert.match(table.text, /table fixture/i);
    assert.match(table.text, /Product/);

    const textPdf = readFileSync(join(root, "p2c-a1-text.pdf"));
    const pdf = await extractKnowledgeSourceText({
      bytes: textPdf.buffer.slice(
        textPdf.byteOffset,
        textPdf.byteOffset + textPdf.byteLength,
      ),
      filename: "p2c-a1-text.pdf",
    });
    assert.match(pdf.text, /text PDF fixture/i);

    assert.ok(readFileSync(join(root, "p2c-a1-scanned.pdf")).byteLength > 0);
    await assert.rejects(
      () =>
        extractKnowledgeSourceText({
          bytes: buildScannedPdfBytes(),
          filename: "p2c-a1-scanned.pdf",
        }),
      (error: unknown) => {
        assert.ok(error instanceof KnowledgeServiceError);
        assert.equal(error.errorCode, KNOWLEDGE_ERROR_CODES.SCANNED_PDF_UNSUPPORTED);
        return true;
      },
    );
  });

  it("keeps the fixture route behind the local preview gate", () => {
    const routeSource = readFileSync(
      new URL("../../app/local-preview/knowledge-fixtures/[fixtureId]/route.ts", import.meta.url),
      "utf8",
    );
    assert.match(routeSource, /isKnowledgePreviewFixturesEnabled/);
    assert.match(routeSource, /getKnowledgePreviewFixture/);
    assert.doesNotMatch(routeSource, /readdir|glob/i);
  });
});
