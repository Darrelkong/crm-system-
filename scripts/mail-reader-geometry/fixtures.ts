/** Synthetic MIME inputs. No real addresses, image fetches, or sender assets. */
export const FIXTURE_PREFIX = "M1B";
export const FIXTURE_MAILBOX_ID = "m1b-synthetic-mailbox";
export const FIXTURE_USER_ID = "11111111-1111-4111-8111-11111111b001";

function paragraphs(count: number, prefix: string) {
  return Array.from({ length: count }, (_, i) => `<p>${prefix} ${i}</p>`).join("");
}

export function readerFixtures() {
  return [
    { name: "LONG_HTML", end: "ACTUAL_END_LONG", html: `<p>BEGIN_LONG</p>${paragraphs(5000, "Synthetic paragraph")}<p>MID_LONG</p>${paragraphs(5000, "Synthetic paragraph")}<p>ACTUAL_END_LONG</p>` },
    { name: "TABLE_NEWSLETTER", end: "ACTUAL_END_TABLE", html: `<table width="600" cellpadding="24" style="width:600px"><tbody><tr><td><h1>Synthetic newsletter</h1><table width="560"><tr><td>${paragraphs(200, "Newsletter section")}</td><td>${paragraphs(200, "Second column")}</td></tr></table><p>ACTUAL_END_TABLE</p></td></tr></tbody></table>` },
    { name: "IMAGE_ONLY_CURRENT_POLICY", end: null, html: '<table><tr><td><img src="https://images.example.invalid/never-load.png" alt="Synthetic image-only offer"><img src="cid:synthetic-banner" alt="Synthetic inline banner"></td></tr></table>' },
    { name: "QUOTED_LONG", end: "ACTUAL_END_QUOTED", html: `<p>BEGIN_QUOTED</p>${paragraphs(160, "Current synthetic body")}<blockquote>${paragraphs(160, "Earlier reply")}<blockquote>${paragraphs(160, "Oldest reply")}<p>ACTUAL_END_QUOTED</p></blockquote></blockquote>` },
    { name: "SAFE_WIDE_CONTENT", end: "ACTUAL_END_WIDE", html: `<p>BEGIN_WIDE</p><pre>${"SYNTHETIC_UNBROKEN_".repeat(120)}\n${Array.from({ length: 160 }, (_, i) => `Preformatted line ${i}`).join("\n")}</pre><table width="1800"><tr><td>${"UNBROKEN".repeat(100)}</td><td>${paragraphs(160, "Wide table row")}</td></tr></table><p>ACTUAL_END_WIDE</p>` },
    { name: "MALICIOUS_HTML", end: "ACTUAL_END_SAFE", html: '<script>document.body.setAttribute("data-m1b-executed","script")</script><img src="https://attack.example.invalid/pixel" onerror="document.body.setAttribute(\'data-m1b-executed\',\'event\')"><iframe src="https://attack.example.invalid/frame"></iframe><form action="https://attack.example.invalid/submit"><input name="secret"></form><svg onload="alert(1)"></svg><p onclick="document.body.setAttribute(\'data-m1b-executed\',\'click\')">SAFE_CLICK_TARGET</p><a href="javascript:document.body.setAttribute(\'data-m1b-executed\',\'link\')">UNSAFE_LINK_LABEL</a><p>ACTUAL_END_SAFE</p>' },
  ];
}

export function fixtureMime(name: string, html: string) {
  return new TextEncoder().encode([
    "From: Synthetic Sender <sender@example.invalid>",
    "To: reader@example.invalid",
    `Subject: M1B ${name}`,
    `Message-ID: <m1b-${name.toLowerCase()}@example.invalid>`,
    "MIME-Version: 1.0", "Content-Type: text/html; charset=utf-8", "", html,
  ].join("\r\n"));
}
