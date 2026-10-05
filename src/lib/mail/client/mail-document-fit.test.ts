import assert from "node:assert/strict";
import { test } from "node:test";
import { mailDocumentScale, mailRenderedDocumentWidth } from "./mail-document-fit";

function measuredDocument(right: number, left = 0): Document {
  const body = {
    get scrollWidth(): never { throw new Error("Intrinsic scroll width is not rendered overflow"); },
    getBoundingClientRect: () => ({ left }),
  };
  return {
    body,
    createRange: () => ({
      selectNodeContents: (node: unknown) => assert.equal(node, body),
      getBoundingClientRect: () => ({ right }),
    }),
  } as unknown as Document;
}

test("rendered flexible width wins over an unavailable/inflated intrinsic scroll width", () => {
  const width = mailRenderedDocumentWidth(measuredDocument(358), 358);
  assert.equal(width, 358);
  assert.equal(mailDocumentScale(358, width, true, false), 1);
  assert.equal(width > 359, false);
});

test("rendered fixed layout and long text ranges retain fitting and original-width access", () => {
  for (const extent of [800, 22400]) {
    const width = mailRenderedDocumentWidth(measuredDocument(extent), 358);
    assert.equal(width, extent);
    assert.equal(mailDocumentScale(358, width, true, false), 358 / extent);
    assert.equal(mailDocumentScale(358, width, true, true), 1);
  }
});

test("relative coordinates, empty content and fractional rounding do not cause false fitting", () => {
  assert.equal(mailRenderedDocumentWidth(measuredDocument(366, 8), 358), 358);
  for (const right of [0, 358.5, 359, Number.NaN]) {
    assert.equal(mailRenderedDocumentWidth(measuredDocument(right), 358), 358);
  }
  assert.equal(mailRenderedDocumentWidth(measuredDocument(800.25), 358), 801);
});

test("desktop mail is never scaled by the mobile fitting path", () => {
  assert.equal(mailDocumentScale(832, mailRenderedDocumentWidth(measuredDocument(600), 832), false, false), 1);
});
