import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  MAIL_PANE_LIMITS,
  MAILBOX_COLLAPSE_RAIL_WIDTH,
  computeReadingPaneFits,
} from "./use-mail-pane-widths";

describe("computeReadingPaneFits", () => {
  it("returns false for narrow layout mode", () => {
    assert.equal(
      computeReadingPaneFits({
        containerWidth: 900,
        layoutMode: "narrow",
        mailboxSidebarCollapsed: true,
        mailboxesWidth: 240,
        messageListCollapsed: false,
      }),
      false,
    );
  });

  it("uses collapsed rail width instead of full mailbox column", () => {
    const containerWidth = 800;

    const collapsedFits = computeReadingPaneFits({
      containerWidth,
      layoutMode: "medium",
      mailboxSidebarCollapsed: true,
      mailboxesWidth: 240,
      messageListCollapsed: false,
    });
    const expandedFits = computeReadingPaneFits({
      containerWidth,
      layoutMode: "medium",
      mailboxSidebarCollapsed: false,
      mailboxesWidth: 240,
      messageListCollapsed: false,
    });

    assert.equal(collapsedFits, true);
    assert.equal(expandedFits, false);
  });

  it("fits list and reading at typical 1280 viewport mail workspace width", () => {
    assert.equal(
      computeReadingPaneFits({
        containerWidth: 992,
        layoutMode: "medium",
        mailboxSidebarCollapsed: true,
        mailboxesWidth: 240,
        messageListCollapsed: false,
      }),
      true,
    );
  });

  it("fits three columns at wide desktop workspace width", () => {
    assert.equal(
      computeReadingPaneFits({
        containerWidth: 1152,
        layoutMode: "wide",
        mailboxSidebarCollapsed: false,
        mailboxesWidth: 240,
        messageListCollapsed: false,
      }),
      true,
    );
  });

  it("accounts for resizers and minimum reading width", () => {
    const needed =
      MAILBOX_COLLAPSE_RAIL_WIDTH +
      MAIL_PANE_LIMITS.list.minMedium +
      MAIL_PANE_LIMITS.reading.min +
      MAIL_PANE_LIMITS.resizer;

    assert.equal(
      computeReadingPaneFits({
        containerWidth: needed - 1,
        layoutMode: "medium",
        mailboxSidebarCollapsed: true,
        mailboxesWidth: 240,
        messageListCollapsed: false,
      }),
      false,
    );
    assert.equal(
      computeReadingPaneFits({
        containerWidth: needed,
        layoutMode: "medium",
        mailboxSidebarCollapsed: true,
        mailboxesWidth: 240,
        messageListCollapsed: false,
      }),
      true,
    );
  });
});
