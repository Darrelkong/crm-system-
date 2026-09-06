import assert from "node:assert/strict";
import test from "node:test";
import ReactDOMServer from "react-dom/server";
import { MailLargeAttachmentAcknowledgementModal } from "./mail-large-attachment-acknowledgement-modal";

test("renders the mandatory large-attachment declaration with continue disabled", () => {
  const html = ReactDOMServer.renderToStaticMarkup(
    <MailLargeAttachmentAcknowledgementModal
      files={[{ name: "invoice.zip", sizeBytes: 100 * 1024 * 1024 }]}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );

  assert.match(html, /大附件上传声明/);
  assert.match(html, /未启用自动安全扫描/);
  assert.match(html, /当前系统暂未对大附件进行自动安全扫描/);
  assert.match(html, /继续上传/);
  assert.match(html, /disabled=""/);
  assert.match(
    html,
    /bg-\[var\(--color-crm-bg-muted\)\].*shadow-none.*disabled:cursor-not-allowed/,
  );
  assert.match(html, /压缩文件提示/);
  assert.match(html, /系统无法自动检查压缩包内部文件/);
});

test("does not render an upload modal when there is no pending batch", () => {
  const html = ReactDOMServer.renderToStaticMarkup(
    <MailLargeAttachmentAcknowledgementModal
      files={null}
      onCancel={() => {}}
      onConfirm={() => {}}
    />,
  );
  assert.equal(html, "");
});
