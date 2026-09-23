import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  materializeDeterministicSegments,
  segmentKnowledgePasteTextDeterministic,
} from "@/lib/knowledge/smart-ingest-deterministic-segmentation";

const CHASE_SINGLE = `Chase Private Client
大通私人银行账户

一、资料要求
1. 身份证
2. 护照
3. 地址证明

二、资产要求
激活款 15W 美金

三、资金流动限制
ACH 日额度 10 万美元
Zelle 每日 15,000 美元`;

const THREE_TOPICS = `香港汇丰

开户要求
资料
注意事项

---

香港中银

开户要求
资料

---

Chase Private Client

开户要求
ACH
Zelle`;

describe("smart ingest deterministic segmentation", () => {
  it("A: one business with numbered requirements stays one segment", () => {
    const drafts = segmentKnowledgePasteTextDeterministic(CHASE_SINGLE);
    assert.equal(drafts.length, 1);
    const segments = materializeDeterministicSegments(CHASE_SINGLE, drafts);
    assert.equal(segments[0]!.evidenceText, CHASE_SINGLE);
    assert.match(segments[0]!.titleHint, /Chase Private Client/);
  });

  it("B/E: three topics separated by --- become three segments", () => {
    const drafts = segmentKnowledgePasteTextDeterministic(THREE_TOPICS);
    assert.equal(drafts.length, 3);
    const segments = materializeDeterministicSegments(THREE_TOPICS, drafts);
    assert.match(segments[0]!.evidenceText, /香港汇丰/);
    assert.match(segments[1]!.evidenceText, /香港中银/);
    assert.match(segments[2]!.evidenceText, /Chase Private Client/);
    assert.doesNotMatch(segments[0]!.evidenceText, /香港中银/);
  });

  it("C: numbered list lines inside one block do not split businesses", () => {
    const text = `香港汇丰银行开户

一、资料要求
1. 身份证
2. 护照
3. 地址证明

二、资产要求
最低 50 万`;
    const drafts = segmentKnowledgePasteTextDeterministic(text);
    assert.equal(drafts.length, 1);
  });

  it("D: markdown headings start a segment when separated by blank lines", () => {
    const text = `## 香港银行账户

要求一
要求二

## 新加坡银行账户

要求 A`;
    const drafts = segmentKnowledgePasteTextDeterministic(text);
    assert.equal(drafts.length, 2);
    const segments = materializeDeterministicSegments(text, drafts);
    assert.match(segments[0]!.titleHint, /香港银行/);
    assert.match(segments[1]!.titleHint, /新加坡银行/);
  });

  it("F/G: evidence_text matches source offsets and ordering", () => {
    const drafts = segmentKnowledgePasteTextDeterministic(THREE_TOPICS);
    const segments = materializeDeterministicSegments(THREE_TOPICS, drafts);
    for (const segment of segments) {
      assert.equal(
        THREE_TOPICS.slice(segment.evidenceStart, segment.evidenceEnd),
        segment.evidenceText,
      );
    }
    assert.deepEqual(
      segments.map((s) => s.segmentIndex),
      [0, 1, 2],
    );
  });

  it("I: empty paste yields no segments", () => {
    assert.equal(segmentKnowledgePasteTextDeterministic("   ").length, 0);
  });
});
