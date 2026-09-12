import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import JSZip from "jszip";

const outDir = join(process.cwd(), "preview-fixtures/knowledge-ingest");

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>`;

const RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

async function buildDocx(paragraphs, table) {
  const body = [
    ...paragraphs.map(
      (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`,
    ),
    table
      ? `<w:tbl>${table
          .map(
            (row) =>
              `<w:tr>${row
                .map(
                  (cell) =>
                    `<w:tc><w:p><w:r><w:t>${cell}</w:t></w:r></w:p></w:tc>`,
                )
                .join("")}</w:tr>`,
          )
          .join("")}</w:tbl>`
      : "",
  ].join("");
  const zip = new JSZip();
  zip.file("[Content_Types].xml", CONTENT_TYPES);
  zip.file("_rels/.rels", RELS);
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${body}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE" });
}

function buildTextPdf(lines) {
  const stream = [
    "BT",
    "/F1 12 Tf",
    "72 720 Td",
    ...lines.flatMap((line, index) =>
      index === 0 ? [`(${line}) Tj`] : [`0 -16 Td`, `(${line}) Tj`],
    ),
    "ET",
  ].join("\n");
  const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>endobj
4 0 obj<< /Length ${stream.length} >>stream
${stream}
endstream
endobj
5 0 obj<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>endobj
xref
0 6
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000266 00000 n 
0000000400 00000 n 
trailer<< /Size 6 /Root 1 0 R >>
startxref
480
%%EOF`;
  return Buffer.from(pdf, "utf8");
}

function buildScannedPdf() {
  const pdf = `%PDF-1.4
1 0 obj<< /Type /Catalog /Pages 2 0 R >>endobj
2 0 obj<< /Type /Pages /Kids [3 0 R] /Count 1 >>endobj
3 0 obj<< /Type /Page /Parent 2 0 R /MediaBox [0 0 200 200] /Contents 4 0 R >>endobj
4 0 obj<< /Length 0 >>stream
endstream
endobj
xref
0 5
0000000000 65535 f 
0000000009 00000 n 
0000000058 00000 n 
0000000115 00000 n 
0000000200 00000 n 
trailer<< /Size 5 /Root 1 0 R >>
startxref
280
%%EOF`;
  return Buffer.from(pdf, "utf8");
}

await mkdir(outDir, { recursive: true });
await writeFile(
  join(outDir, "p2c-a1-simple.docx"),
  await buildDocx(["P2C-A1 simple DOCX fixture for human preview."], null),
);
await writeFile(
  join(outDir, "p2c-a1-table.docx"),
  await buildDocx(
    ["P2C-A1 DOCX with table fixture."],
    [["Product", "Limit"], ["Alpha", "100"]],
  ),
);
await writeFile(
  join(outDir, "p2c-a1-text.pdf"),
  buildTextPdf(["P2C-A1 text PDF fixture", "Second line for preview"]),
);
await writeFile(join(outDir, "p2c-a1-scanned.pdf"), buildScannedPdf());
await writeFile(
  join(outDir, "p2c-a1-duplicate.docx"),
  await buildDocx(["P2C-A1 duplicate detection fixture."], null),
);
console.log(`Wrote preview fixtures to ${outDir}`);
