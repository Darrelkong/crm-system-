import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  KNOWLEDGE_SQL_MAX_CANDIDATE_TOKENS,
  KNOWLEDGE_SQL_MAX_LIKE_CONDITIONS,
  KNOWLEDGE_SQL_MAX_LIKE_PATTERN_CHARS,
  KNOWLEDGE_SQL_MAX_TOKEN_LENGTH,
  KNOWLEDGE_SQL_MAX_VARIANTS_PER_TOKEN,
  KNOWLEDGE_SEARCH_QUERY_MAX_CHARS,
  sqlCandidateTokens,
} from "@/lib/knowledge/published-retrieval";
import { expandHanSearchToken } from "@/lib/knowledge/han-search-normalization";

const LONG_SIMPLIFIED_QUERY = "海外银行账户服务开始前需要确认什么？";
const LONG_TRADITIONAL_QUERY = "海外銀行賬戶服務開始前需要確認什麼？";

describe("sqlCandidateTokens", () => {
  it("keeps short Han tokens for SQL retrieval", () => {
    assert.deepEqual(sqlCandidateTokens("开户目的"), ["开户目的"]);
    assert.deepEqual(sqlCandidateTokens("開戶目的"), ["開戶目的"]);
  });

  it("never includes full long Han phrases in SQL candidate tokens", () => {
    const simplified = sqlCandidateTokens(LONG_SIMPLIFIED_QUERY);
    const traditional = sqlCandidateTokens(LONG_TRADITIONAL_QUERY);
    const fullPhrase = "海外银行账户服务开始前需要确认什么";
    assert.equal(simplified.includes(fullPhrase), false);
    assert.equal(traditional.includes("海外銀行賬戶服務開始前需要確認什麼"), false);
    assert.ok(simplified.length > 0);
    assert.ok(simplified.every((token) => token.length <= KNOWLEDGE_SQL_MAX_TOKEN_LENGTH));
    assert.ok(traditional.every((token) => token.length <= KNOWLEDGE_SQL_MAX_TOKEN_LENGTH));
  });

  it("derives short Han segments from long natural-language queries", () => {
    const tokens = sqlCandidateTokens(LONG_SIMPLIFIED_QUERY);
    assert.ok(tokens.includes("海外银行"));
    assert.ok(tokens.includes("账户服务"));
    assert.ok(tokens.includes("确认什么"));
  });

  it("caps SQL candidate token count for long and near-max queries", () => {
    const longMixed = sqlCandidateTokens(
      "海外银行账户开户目的与資料準備確認流程",
    );
    assert.ok(longMixed.length <= KNOWLEDGE_SQL_MAX_CANDIDATE_TOKENS);

    const nearMax = "海".repeat(KNOWLEDGE_SEARCH_QUERY_MAX_CHARS);
    const nearMaxTokens = sqlCandidateTokens(nearMax);
    assert.ok(nearMaxTokens.length <= KNOWLEDGE_SQL_MAX_CANDIDATE_TOKENS);
    assert.ok(
      nearMaxTokens.every((token) => token.length <= KNOWLEDGE_SQL_MAX_TOKEN_LENGTH),
    );
  });

  it("bounds SQL variant and LIKE predicate generation", () => {
    const tokens = sqlCandidateTokens(LONG_SIMPLIFIED_QUERY);
    let likeConditions = 0;
    for (const token of tokens) {
      const variants = expandHanSearchToken(token).slice(
        0,
        KNOWLEDGE_SQL_MAX_VARIANTS_PER_TOKEN,
      );
      assert.ok(variants.length <= KNOWLEDGE_SQL_MAX_VARIANTS_PER_TOKEN);
      for (const variant of variants) {
        assert.ok(variant.length <= KNOWLEDGE_SQL_MAX_LIKE_PATTERN_CHARS);
      }
      likeConditions += variants.length * 4;
    }
    assert.ok(likeConditions <= KNOWLEDGE_SQL_MAX_LIKE_CONDITIONS);
  });

  it("preserves Latin and numeric tokens within bounds", () => {
    const tokens = sqlCandidateTokens("alpha123 beta456");
    assert.ok(tokens.includes("alpha123"));
    assert.ok(tokens.includes("beta456"));
  });
});
