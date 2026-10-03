import assert from "node:assert/strict";
import { test } from "node:test";
import React, { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MailDebugControls } from "./mail-debug-controls";

Object.assign(globalThis, { React });

for (const flag of [undefined, "false", "true"]) {
  test(`production renders no Mail prototype controls with debug flag ${flag}`, () => {
    const env = process.env as Record<string, string | undefined>;
    const previousMode = env.NODE_ENV;
    const previousFlag = env.NEXT_PUBLIC_DEBUG_MAIL;
    try {
      env.NODE_ENV = "production";
      if (flag === undefined) delete env.NEXT_PUBLIC_DEBUG_MAIL;
      else env.NEXT_PUBLIC_DEBUG_MAIL = flag;
      // Render the actual component. The release gate must not even enter the
      // interactive prototype context or require its providers.
      assert.equal(renderToStaticMarkup(createElement(MailDebugControls)), "");
    } finally {
      if (previousMode === undefined) delete env.NODE_ENV;
      else env.NODE_ENV = previousMode;
      if (previousFlag === undefined) delete env.NEXT_PUBLIC_DEBUG_MAIL;
      else env.NEXT_PUBLIC_DEBUG_MAIL = previousFlag;
    }
  });
}
