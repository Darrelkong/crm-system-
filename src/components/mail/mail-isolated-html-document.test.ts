import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MailIsolatedHtmlDocument } from "./mail-isolated-html-document";
// The repository's node/tsx test runner uses classic JSX for component tests.
Object.assign(globalThis, { React });

test("real isolated component emits only script-disabled measurement permission", () => {
  const output = renderToStaticMarkup(createElement(MailIsolatedHtmlDocument, {html:'<p>Canonical safe text</p>'}));
  assert.match(output, /sandbox="allow-same-origin"/);
  assert.match(output, /referrerPolicy="no-referrer"/i);
  assert.match(output, /scrolling="no"/);
  assert.doesNotMatch(output, /allow-scripts|allow-forms|allow-top-navigation|allow-popups/);
  assert.match(output, /Canonical safe text/);
  assert.match(output, /script-src &#x27;none&#x27;/);
});
