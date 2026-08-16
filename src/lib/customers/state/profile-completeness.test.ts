/**
 * TASK 17-C1 — Profile Completeness and text-presence coverage.
 *
 * Weights total exactly 100, group predicates, verdict precedence and
 * reachability (including the production-empty `complete` and `incomplete`
 * verdicts), independence from operational facts, Public Pool identity, and
 * the TASK 16B2 text/whitespace semantics the future SQL mirror must match.
 */

import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import { computeCustomerState } from "./engine";
import {
  evaluateProfileCompleteness,
  evaluateProfileGroups,
} from "./profile-completeness";
import {
  DEFAULT_COMPLETENESS_RULES,
  DEFAULT_CUSTOMER_STATE_RULES,
} from "./rules";
import { anyPresent, countPresent, hasStateText } from "./text";
import { PROFILE_GROUPS, type CustomerProfileFacts } from "./types";
import {
  NOW,
  completeProfile,
  coreProfile,
  emptyProfile,
  hkDaysAgoIso,
  outcome,
  repeatOutcome,
  stateFacts,
} from "./state-fixtures.test-helper";

function evaluate(profile: CustomerProfileFacts) {
  return evaluateProfileCompleteness(profile, DEFAULT_COMPLETENESS_RULES);
}

describe("G — weights and partition", () => {
  it("totals exactly 100", () => {
    const total = Object.values(DEFAULT_COMPLETENESS_RULES.weights).reduce(
      (sum, weight) => sum + weight,
      0,
    );
    assert.equal(total, 100);
  });

  it("matches the locked per-group weights", () => {
    assert.deepEqual(DEFAULT_COMPLETENESS_RULES.weights, {
      REQ_IDENTITY: 25,
      REQ_REACHABLE: 25,
      CORE_PRIMARY_CHANNEL: 12,
      CORE_NEED_CAPTURED: 12,
      CORE_CONTEXT: 11,
      OPT_SECOND_CHANNEL: 3,
      OPT_EMAIL: 3,
      OPT_PREFERRED_CONTACT: 3,
      OPT_DEMOGRAPHICS: 3,
      OPT_PROFESSIONAL: 3,
    });
  });

  it("partitions all ten groups into required / core / optional exactly once", () => {
    const partition = [
      ...DEFAULT_COMPLETENESS_RULES.requiredGroups,
      ...DEFAULT_COMPLETENESS_RULES.coreGroups,
      ...DEFAULT_COMPLETENESS_RULES.optionalGroups,
    ];
    assert.equal(partition.length, PROFILE_GROUPS.length);
    assert.equal(new Set(partition).size, PROFILE_GROUPS.length);
    assert.deepEqual([...partition].sort(), [...PROFILE_GROUPS].sort());
    assert.equal(DEFAULT_COMPLETENESS_RULES.requiredGroups.length, 2);
    assert.equal(DEFAULT_COMPLETENESS_RULES.coreGroups.length, 3);
    assert.equal(DEFAULT_COMPLETENESS_RULES.optionalGroups.length, 5);
  });
});

describe("RULE G-3 — group predicates", () => {
  it("requires both a name and a confirmed nameStatus for REQ_IDENTITY", () => {
    assert.equal(evaluateProfileGroups(completeProfile()).REQ_IDENTITY, true);
    assert.equal(
      evaluateProfileGroups(completeProfile({ nameStatus: "pending" }))
        .REQ_IDENTITY,
      false,
    );
    assert.equal(
      evaluateProfileGroups(completeProfile({ nameStatus: null })).REQ_IDENTITY,
      false,
    );
    assert.equal(
      evaluateProfileGroups(completeProfile({ customerName: "   " }))
        .REQ_IDENTITY,
      false,
    );
  });

  it("satisfies REQ_REACHABLE from phone, wechatId, or email alone", () => {
    for (const field of ["phone", "wechatId", "email"] as const) {
      const groups = evaluateProfileGroups(
        emptyProfile2({ [field]: "value" } as Partial<CustomerProfileFacts>),
      );
      assert.equal(groups.REQ_REACHABLE, true, field);
    }
    assert.equal(evaluateProfileGroups(emptyProfile()).REQ_REACHABLE, false);
  });

  it("excludes email from CORE_PRIMARY_CHANNEL", () => {
    const emailOnly = emptyProfile2({ email: "a@example.com" });
    const groups = evaluateProfileGroups(emailOnly);
    assert.equal(groups.REQ_REACHABLE, true);
    assert.equal(groups.CORE_PRIMARY_CHANNEL, false);
  });

  it("needs two distinct channels for OPT_SECOND_CHANNEL", () => {
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ phone: "1" })).OPT_SECOND_CHANNEL,
      false,
    );
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ phone: "1", email: "a@b.c" }))
        .OPT_SECOND_CHANNEL,
      true,
    );
  });

  it("treats CORE_NEED_CAPTURED and CORE_CONTEXT as either-or groups", () => {
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ primaryConcern: "签证" }))
        .CORE_NEED_CAPTURED,
      true,
    );
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ requestedProjectCode: "P1" }))
        .CORE_NEED_CAPTURED,
      true,
    );
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ targetCountryOrRegion: "加拿大" }))
        .CORE_CONTEXT,
      true,
    );
    assert.equal(
      evaluateProfileGroups(emptyProfile2({ notes: "备注" })).CORE_CONTEXT,
      true,
    );
  });
});

describe("RULE G-4 — verdict precedence and reachability", () => {
  it("reaches complete / 100 with every group satisfied", () => {
    const result = evaluate(completeProfile());
    assert.equal(result.result.verdict, "complete");
    assert.equal(result.result.score, 100);
    assert.deepEqual(result.result.missingGroups, []);
    assert.deepEqual(result.reasons, [], "baseline state carries no reasons");
  });

  it("reaches minor_gaps with exactly one core group missing", () => {
    // Email-only reach: CORE_PRIMARY_CHANNEL missing, other two core met.
    const result = evaluate(
      completeProfile({ phone: null, wechatId: null }),
    );
    assert.equal(result.result.verdict, "minor_gaps");
    assert.deepEqual(result.result.missingGroups, [
      "CORE_PRIMARY_CHANNEL",
      "OPT_SECOND_CHANNEL",
    ]);
    assert.equal(result.result.score, 100 - 12 - 3);
  });

  it("reaches minor_gaps with all core satisfied and optional gaps", () => {
    const result = evaluate(coreProfile());
    assert.equal(result.result.verdict, "minor_gaps");
    assert.equal(result.result.score, 85);
    const optionalReason = result.reasons.find(
      (entry) => entry.code === "PROFILE_OPTIONAL_GAPS",
    );
    assert.deepEqual(optionalReason?.params?.groups, [
      "OPT_SECOND_CHANNEL",
      "OPT_EMAIL",
      "OPT_PREFERRED_CONTACT",
      "OPT_DEMOGRAPHICS",
      "OPT_PROFESSIONAL",
    ]);
  });

  it("reaches incomplete with required satisfied and two core groups missing", () => {
    const result = evaluate(
      emptyProfile2({
        customerName: "李四",
        email: "lisi@example.com",
        notes: "备注",
      }),
    );
    assert.equal(result.result.verdict, "incomplete");
    assert.deepEqual(result.result.missingGroups.slice(0, 3), [
      "CORE_PRIMARY_CHANNEL",
      "CORE_NEED_CAPTURED",
      "OPT_SECOND_CHANNEL",
    ]);
    assert.equal(result.result.score, 25 + 25 + 11 + 3);
    assert.deepEqual(
      result.reasons.map((entry) => entry.code),
      [
        "PROFILE_CORE_PRIMARY_CHANNEL_MISSING",
        "PROFILE_CORE_NEED_NOT_CAPTURED",
        "PROFILE_OPTIONAL_GAPS",
      ],
    );
  });

  it("reaches critical_gaps whenever a required group is missing", () => {
    const noName = evaluate(completeProfile({ customerName: null }));
    assert.equal(noName.result.verdict, "critical_gaps");
    assert.equal(noName.result.score, 75);
    assert.ok(
      noName.reasons.some(
        (entry) => entry.code === "PROFILE_REQUIRED_IDENTITY_MISSING",
      ),
    );

    const noReach = evaluate(
      emptyProfile2({ customerName: "李四", notes: "备注" }),
    );
    assert.equal(noReach.result.verdict, "critical_gaps");
    assert.ok(
      noReach.reasons.some(
        (entry) => entry.code === "PROFILE_REQUIRED_CONTACT_MISSING",
      ),
    );
  });

  it("scores an entirely empty profile at 0 / critical_gaps", () => {
    const result = evaluate(emptyProfile());
    assert.equal(result.result.verdict, "critical_gaps");
    assert.equal(result.result.score, 0);
    assert.equal(result.result.missingGroups.length, PROFILE_GROUPS.length);
  });

  it("reaches all four verdicts across the fixture set", () => {
    const verdicts = new Set(
      [
        completeProfile(),
        coreProfile(),
        emptyProfile2({
          customerName: "李四",
          email: "lisi@example.com",
          notes: "备注",
        }),
        emptyProfile(),
      ].map((profile) => evaluate(profile).result.verdict),
    );
    assert.deepEqual([...verdicts].sort(), [
      "complete",
      "critical_gaps",
      "incomplete",
      "minor_gaps",
    ]);
  });

  it("reports nameStatus as a structured reason parameter (RULE Q-2)", () => {
    const result = evaluate(completeProfile({ nameStatus: "pending" }));
    const identity = result.reasons.find(
      (entry) => entry.code === "PROFILE_REQUIRED_IDENTITY_MISSING",
    );
    assert.equal(identity?.params?.nameStatus, "pending");
  });
});

describe("RULE G-1 / G-5 / G-6 — completeness reads no operational fact", () => {
  const operationalVariants: Parameters<typeof stateFacts>[0][] = [
    { ownerId: null },
    { status: "public_pool", ownerId: null },
    { salesStage: "closed_won" },
    { salesStage: "on_hold" },
    { salesStage: "not_a_stage" },
    { isPinned: 1 },
    { hasCollaborator: true },
    { lastValidFollowUpAt: hkDaysAgoIso(90) },
    { nextFollowUpAt: hkDaysAgoIso(-5) },
    { reclamationCycleStartedAt: hkDaysAgoIso(200) },
    { followUpOutcomes: repeatOutcome("no_contact", 5, 1) },
    { followUpOutcomes: [outcome("lost_contact", hkDaysAgoIso(1))] },
    { automaticReclaimDays: 7 },
  ];

  for (const profile of [emptyProfile(), coreProfile(), completeProfile()]) {
    const expected = evaluate(profile).result;
    for (const variant of operationalVariants) {
      it(`${expected.verdict} is unchanged by ${JSON.stringify(variant)}`, () => {
        const state = computeCustomerState(
          stateFacts({ profile, ...variant }),
          DEFAULT_CUSTOMER_STATE_RULES,
          NOW,
        );
        assert.deepEqual(state.profileCompleteness, expected);
      });
    }
  }

  it("gives Public Pool customers identical completeness rules and no ceiling", () => {
    const state = computeCustomerState(
      stateFacts({
        status: "public_pool",
        ownerId: null,
        profile: completeProfile(),
      }),
      DEFAULT_CUSTOMER_STATE_RULES,
      NOW,
    );
    assert.equal(state.profileCompleteness.verdict, "complete");
    assert.equal(state.profileCompleteness.score, 100);
  });

  it("evaluates completeness normally for an unknown stage (RULE F-4)", () => {
    const state = computeCustomerState(
      stateFacts({ salesStage: "qualified", profile: emptyProfile() }),
      DEFAULT_CUSTOMER_STATE_RULES,
      NOW,
    );
    assert.equal(state.profileCompleteness.verdict, "critical_gaps");
    assert.equal(state.profileCompleteness.score, 0);
  });
});

describe("Text presence semantics (TASK 16B2 parity)", () => {
  const cases: { label: string; value: string | null; present: boolean }[] = [
    { label: "null", value: null, present: false },
    { label: "empty string", value: "", present: false },
    { label: "single space", value: " ", present: false },
    { label: "tab + newline", value: "\t\n", present: false },
    { label: "CR + form feed + vertical tab", value: "\r\f\v", present: false },
    { label: "NBSP U+00A0", value: "\u00a0", present: false },
    { label: "ideographic space U+3000", value: "\u3000", present: false },
    { label: "BOM U+FEFF", value: "\ufeff", present: false },
    { label: "line separator U+2028", value: "\u2028", present: false },
    { label: "en quad U+2000", value: "\u2000", present: false },
    { label: "NUL U+0000", value: "\u0000", present: true },
    { label: "NUL between spaces", value: " \u0000 ", present: true },
    { label: "text with padding", value: "  13800000000  ", present: true },
    { label: "zero", value: "0", present: true },
    { label: "zero-width space U+200B", value: "\u200b", present: true },
  ];

  for (const testCase of cases) {
    it(`hasStateText(${testCase.label}) === ${testCase.present}`, () => {
      assert.equal(hasStateText(testCase.value), testCase.present);
    });
  }

  it("classifies exactly the character set the frozen SQL mirror trims", () => {
    // The TASK 16B2 SQL predicate trims an explicit character set because
    // SQLite has no ECMAScript trim. C2 will mirror V2 completeness on that
    // same predicate, so the two sets must stay identical character for
    // character. Read from source instead of restating it here.
    const source = readFileSync(
      "src/lib/customers/scoring/scoring-sql-primitives.ts",
      "utf8",
    );
    const declaration = /ECMASCRIPT_TRIM_CHARACTERS\s*=([\s\S]*?);/.exec(source);
    assert.ok(declaration, "ECMASCRIPT_TRIM_CHARACTERS not found");
    const sqlTrimSet = new Set(
      [...declaration[1].matchAll(/\\u([0-9a-fA-F]{4})/g)].map((match) =>
        String.fromCharCode(Number.parseInt(match[1], 16)),
      ),
    );
    assert.ok(sqlTrimSet.size >= 20, "trim set parsed too small");

    const jsTrimSet = new Set<string>();
    for (let code = 0; code <= 0xffff; code += 1) {
      const character = String.fromCharCode(code);
      if (character.trim() === "") jsTrimSet.add(character);
    }

    assert.deepEqual([...sqlTrimSet].sort(), [...jsTrimSet].sort());
    for (const character of sqlTrimSet) {
      assert.equal(hasStateText(character), false, toCodePoint(character));
    }
    assert.equal(sqlTrimSet.has("\u0000"), false, "U+0000 is not trimmed");
    assert.equal(hasStateText("\u0000"), true);
  });

  it("counts and any-checks using the same predicate", () => {
    assert.equal(countPresent("a", " ", null, "\u0000"), 2);
    assert.equal(anyPresent(null, "  ", "\u3000"), false);
    assert.equal(anyPresent(null, "  ", "x"), true);
  });

  it("does not credit a whitespace-only field to any group", () => {
    const groups = evaluateProfileGroups(
      emptyProfile2({
        customerName: "\u00a0",
        phone: "\u3000",
        notes: "\t",
        primaryConcern: " ",
      }),
    );
    for (const group of PROFILE_GROUPS) {
      assert.equal(groups[group], false, group);
    }
  });

  it("does credit a U+0000-only field, matching the SQL length() contract", () => {
    const groups = evaluateProfileGroups(
      emptyProfile2({ customerName: "\u0000", phone: "\u0000" }),
    );
    assert.equal(groups.REQ_IDENTITY, true);
    assert.equal(groups.REQ_REACHABLE, true);
    assert.equal(groups.CORE_PRIMARY_CHANNEL, true);
  });
});

/** `emptyProfile` with overrides, keeping `nameStatus: confirmed` by default. */
function emptyProfile2(
  overrides: Partial<CustomerProfileFacts>,
): CustomerProfileFacts {
  return { ...emptyProfile(), ...overrides };
}

function toCodePoint(character: string): string {
  return `U+${character.charCodeAt(0).toString(16).padStart(4, "0").toUpperCase()}`;
}
