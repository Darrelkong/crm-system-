/**
 * TASK 17-C1 — Y-9 reclamation immutability guard, Y-10 On Hold / pin
 * regression guard, and the C1 isolation guard.
 *
 * The guard compares the working tree against the APPROVED BASELINE COMMIT
 * rather than against hand-written expected strings, so any edit to a protected
 * reclamation-ownership, pin-coupling, or legacy-scoring file fails the suite
 * even if the edit looks harmless.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  isReclamationEligibleCustomer,
  isReclamationExcludedSalesStage,
} from "@/lib/reclamation/constants";
import {
  canRemovePriorityForStage,
  resolveSalesStagePriorityTransition,
  shouldSkipUnsetPriorityMutation,
} from "@/lib/customers/priority-customer";

/** TASK 17-C1 §1 approved baseline. */
const BASELINE_SHA = "a274722b5b16ea595b3513c4b85d19ba51988f57";

const STATE_DIR = "src/lib/customers/state";

/** The one existing file C1 touches, purely to register its own test files. */
const TEST_REGISTRATION_FILE = "package.json";

function git(...args: string[]): string {
  return execFileSync("git", args, {
    encoding: "utf8",
    maxBuffer: 64 * 1024 * 1024,
  });
}

/** `git grep` exits 1 with no output when nothing matches, which is a pass here. */
function gitGrep(...args: string[]): string {
  try {
    return git("grep", ...args);
  } catch (error) {
    const status = (error as { status?: number }).status;
    if (status === 1) return "";
    throw error;
  }
}

function sha256(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

function baselineBlob(path: string): string {
  return git("show", `${BASELINE_SHA}:${path}`);
}

function lines(output: string): string[] {
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);
}

/**
 * Every path C1 adds or edits, whether or not it is committed yet, so the guard
 * behaves identically before the commit and when re-run from the commit itself.
 */
function pathsChangedSinceBaseline(): string[] {
  const tracked = lines(git("diff", "--name-only", BASELINE_SHA));
  const untracked = lines(
    git("ls-files", "--others", "--exclude-standard", "--", "."),
  );
  return [...new Set([...tracked, ...untracked])].sort();
}

/**
 * Authoritative files owning the behaviour TASK 17-C1 §27 requires protecting.
 * `owns` records which named behaviour each file is here for, and is asserted
 * against the baseline blob so the list cannot silently stop covering it.
 */
const PROTECTED_RECLAMATION_FILES: { path: string; owns: string[] }[] = [
  {
    // auto-reclamation eligibility, pinned exemption, excluded-stage logic
    path: "src/lib/reclamation/constants.ts",
    owns: [
      "RECLAMATION_EXCLUDED_SALES_STAGES",
      "isReclamationExcludedSalesStage",
      "isReclamationEligibleCustomer",
    ],
  },
  {
    // auto-reclamation execution path: eligibility query, threshold, grace
    path: "src/lib/reclamation/engine.ts",
    owns: [
      "RECLAMATION_EXCLUDED_SALES_STAGES",
      "isPinned",
      "automaticReclaimDays",
      "getDaysWithoutValidFollowUp",
    ],
  },
  {
    // ownership transfer CAS
    path: "src/lib/reclamation/auto-reclaim-cas.ts",
    owns: ["isPinned"],
  },
  {
    // collaborator exemption
    path: "src/lib/reclamation/collaborative.ts",
    owns: ["collaborator"],
  },
  {
    // cycle anchor + grace exemption
    path: "src/lib/reclamation/cycle.ts",
    owns: [
      "getReclamationCycleStartedAt",
      "buildReclamationCycleResetFields",
      "isReclaimGraceActive",
    ],
  },
  {
    // idle-day arithmetic
    path: "src/lib/reclamation/days.ts",
    owns: ["getDaysWithoutValidFollowUp", "getReclamationAnchorAt"],
  },
  { path: "src/lib/reclamation/grace-period.ts", owns: [] },
  { path: "src/lib/reclamation/reclaim-rule-version.ts", owns: [] },
  { path: "src/lib/reclamation/milestones.ts", owns: [] },
  { path: "src/lib/reclamation/risk-snapshot.ts", owns: [] },
  { path: "src/lib/reclamation/run.ts", owns: [] },
  { path: "src/lib/reclamation/warning-log-unique.ts", owns: [] },
  { path: "src/lib/reclamation/work-items-sync.ts", owns: [] },
  { path: "src/lib/reclamation/countdown-display.ts", owns: [] },
  { path: "src/lib/reclamation/collaborative-dry-run.ts", owns: [] },
  {
    // automatic reclaim threshold resolution
    path: "src/lib/settings/effective.ts",
    owns: ["automatic_reclaim_days"],
  },
  {
    // On Hold pin coupling
    path: "src/lib/customers/priority-customer.ts",
    owns: [
      "resolveSalesStagePriorityTransition",
      "canRemovePriorityForStage",
      "on_hold_auto",
    ],
  },
  { path: "src/lib/customers/priority-customer-cas.ts", owns: [] },
  { path: "src/lib/customers/priority-customer-approval.ts", owns: [] },
  { path: "src/lib/customers/priority-stage-update.ts", owns: [] },
  { path: "src/lib/customers/on-hold-create-pending.ts", owns: [] },
  { path: "src/lib/customers/pending-on-hold-access.ts", owns: [] },
];

/** TASK 17-C1 §31 — legacy Heat and legacy scoring SQL stay frozen. */
const PROTECTED_LEGACY_SCORING_FILES = [
  "src/lib/customers/scoring/heat.ts",
  "src/lib/customers/scoring/completeness.ts",
  "src/lib/customers/scoring/constants.ts",
  "src/lib/customers/scoring/scoring-sql-primitives.ts",
  "src/lib/customers/scoring/scoring-list-sql.ts",
  "src/lib/customers/scoring/scoring-list-runtime.ts",
];

/** TASK 17-C3 — bounded shadow may touch only these paths outside the state module. */
const C3_ALLOWED_OUTSIDE_STATE = [
  "package.json",
  "src/lib/customers/scoring/service.ts",
  "src/lib/customers/scoring/state-v2-shadow-hook.ts",
  "src/app/(dashboard)/customers/[id]/page.tsx",
];

const C3_STATE_IMPORTERS = [
  "src/lib/customers/scoring/state-v2-shadow-hook.ts",
  "src/lib/customers/scoring/service.ts",
];

/** Existing suites that own the On Hold / pin behaviour C1 must not disturb. */
const PROTECTED_EXISTING_TESTS = [
  "src/lib/customers/priority-customer.test.ts",
  "src/lib/customers/priority-customer-f1.test.ts",
  "src/lib/customers/priority-customer-approval.test.ts",
  "src/lib/customers/priority-on-hold-exit.test.ts",
  "src/lib/customers/pending-on-hold-access.test.ts",
  "src/lib/reclamation/reclamation.test.ts",
  "src/lib/reclamation/cycle.test.ts",
  "src/lib/reclamation/days.test.ts",
  "src/lib/reclamation/grace-period.test.ts",
];

describe("Y-9 — reclamation immutability guard against the approved baseline", () => {
  it("resolves the approved baseline commit", () => {
    assert.equal(git("rev-parse", BASELINE_SHA).trim(), BASELINE_SHA);
  });

  const allProtected = [
    ...PROTECTED_RECLAMATION_FILES.map((entry) => entry.path),
    ...PROTECTED_LEGACY_SCORING_FILES,
    ...PROTECTED_EXISTING_TESTS,
  ];

  for (const path of allProtected) {
    it(`${path} is byte-identical to the baseline`, () => {
      const baseline = baselineBlob(path);
      const current = readFileSync(path, "utf8");
      assert.equal(
        sha256(current),
        sha256(baseline),
        `${path} differs from ${BASELINE_SHA}`,
      );
    });
  }

  for (const entry of PROTECTED_RECLAMATION_FILES) {
    if (entry.owns.length === 0) continue;
    it(`${entry.path} still owns ${entry.owns.join(", ")}`, () => {
      const baseline = baselineBlob(entry.path);
      for (const symbol of entry.owns) {
        assert.ok(
          baseline.includes(symbol),
          `${entry.path} no longer contains ${symbol}; the protected file list is stale`,
        );
      }
    });
  }

  it("touches nothing outside the C1/C3 scope boundary", () => {
    const outOfScope = pathsChangedSinceBaseline().filter(
      (path) =>
        !path.startsWith(`${STATE_DIR}/`) &&
        path !== TEST_REGISTRATION_FILE &&
        !C3_ALLOWED_OUTSIDE_STATE.includes(path),
    );
    assert.deepEqual(outOfScope, [], `out-of-scope paths: ${outOfScope.join(", ")}`);
  });

  it("changes package.json only to register the C1 test files", () => {
    const baseline = JSON.parse(baselineBlob(TEST_REGISTRATION_FILE)) as {
      scripts: Record<string, string>;
    };
    const current = JSON.parse(readFileSync(TEST_REGISTRATION_FILE, "utf8")) as {
      scripts: Record<string, string>;
    };

    const { scripts: baselineScripts, ...baselineRest } = baseline;
    const { scripts: currentScripts, ...currentRest } = current;
    assert.deepEqual(
      currentRest,
      baselineRest,
      "package.json changed outside `scripts`",
    );

    const changedScripts = Object.keys({ ...baselineScripts, ...currentScripts })
      .filter((key) => baselineScripts[key] !== currentScripts[key])
      .sort();
    assert.deepEqual(changedScripts, [
      "test:state-v2",
      "test:state-v2-shadow",
      "test:state-v2-sql",
      "test:unit",
    ]);
    assert.equal(baselineScripts["test:state-v2"], undefined);
    assert.equal(baselineScripts["test:state-v2-sql"], undefined);
    assert.equal(baselineScripts["test:state-v2-shadow"], undefined);
    assert.equal(
      currentScripts["test:unit"],
      `${baselineScripts["test:unit"]} && npm run test:state-v2`,
      "test:unit must only append the C1 suite",
    );
    for (const path of [
      ...currentScripts["test:state-v2"].split(" "),
      ...currentScripts["test:state-v2-sql"].split(" "),
      ...currentScripts["test:state-v2-shadow"].split(" "),
    ]) {
      if (!path.endsWith(".test.ts")) continue;
      assert.ok(path.startsWith(`${STATE_DIR}/`), path);
    }
  });

  it("adds no D1 migration and no schema change", () => {
    const baselineMigrations = git("ls-tree", "-r", "--name-only", `${BASELINE_SHA}:drizzle`);
    const currentMigrations = git("ls-tree", "-r", "--name-only", "HEAD:drizzle");
    assert.equal(currentMigrations, baselineMigrations);
    assert.equal(
      git("diff", "--name-only", BASELINE_SHA, "--", "drizzle").trim(),
      "",
    );
  });
});

describe("C1 isolation — production shadow imports stay bounded (C3)", () => {
  it("adds only TypeScript files under the state module", () => {
    const stateFiles = pathsChangedSinceBaseline().filter((path) =>
      path.startsWith(`${STATE_DIR}/`),
    );
    assert.ok(stateFiles.length > 0, "expected the new engine files");
    for (const path of stateFiles) {
      assert.ok(path.endsWith(".ts"), path);
      assert.equal(path.endsWith(".tsx"), false, path);
    }
  });

  it("allows only the scoring shadow bridge to import the state engine", () => {
    const importers = gitGrep(
      "-l",
      "--untracked",
      "-E",
      "customers/state|from \"\\./state|from \"\\.\\./state",
      "--",
      "src",
      "drizzle",
    );
    const outsiders = lines(importers).filter(
      (path) =>
        !path.startsWith(`${STATE_DIR}/`) &&
        !C3_STATE_IMPORTERS.includes(path),
    );
    assert.deepEqual(outsiders, [], `unexpected importers: ${outsiders.join(", ")}`);
  });

  it("touches no UI, route, or migration file outside the C3 allowlist", () => {
    const forbiddenPrefixes = [
      "src/app/",
      "src/components/",
      "src/i18n/",
      "drizzle/",
      "migrations/",
    ];
    for (const path of pathsChangedSinceBaseline()) {
      if (C3_ALLOWED_OUTSIDE_STATE.includes(path)) continue;
      for (const prefix of forbiddenPrefixes) {
        assert.equal(path.startsWith(prefix), false, path);
      }
    }
  });
});

describe("Y-10 — On Hold / pin behaviour is unchanged", () => {
  const now = "2026-08-16T04:00:00.000Z";
  const unpinned = { isPinned: 0, pinnedAt: null, pinnedSource: null };

  it("auto-pins on entering on_hold", () => {
    assert.deepEqual(
      resolveSalesStagePriorityTransition("contacted", "on_hold", unpinned, now),
      { isPinned: 1, pinnedAt: now, pinnedSource: "on_hold_auto" },
    );
  });

  it("auto-clears only an on_hold_auto pin when leaving on_hold", () => {
    assert.deepEqual(
      resolveSalesStagePriorityTransition(
        "on_hold",
        "contacted",
        { isPinned: 1, pinnedAt: now, pinnedSource: "on_hold_auto" },
        now,
      ),
      { isPinned: 0, pinnedAt: null, pinnedSource: null },
    );
    assert.equal(
      resolveSalesStagePriorityTransition(
        "on_hold",
        "contacted",
        { isPinned: 1, pinnedAt: now, pinnedSource: "admin_direct" },
        now,
      ),
      null,
    );
  });

  it("keeps an existing manual pin when entering on_hold", () => {
    assert.equal(
      resolveSalesStagePriorityTransition(
        "contacted",
        "on_hold",
        { isPinned: 1, pinnedAt: now, pinnedSource: "admin_direct" },
        now,
      ),
      null,
    );
  });

  it("forbids unpinning while On Hold", () => {
    assert.equal(canRemovePriorityForStage("on_hold"), false);
    assert.equal(canRemovePriorityForStage("contacted"), true);
    assert.equal(
      shouldSkipUnsetPriorityMutation({ isPinned: 1, salesStage: "on_hold" }),
      true,
    );
    assert.equal(
      shouldSkipUnsetPriorityMutation({ isPinned: 1, salesStage: "contacted" }),
      false,
    );
  });

  it("keeps On Hold, closed_won, paid, and converted reclamation-exempt", () => {
    for (const stage of ["on_hold", "closed_won", "paid", "converted"]) {
      assert.equal(isReclamationExcludedSalesStage(stage), true, stage);
      assert.equal(
        isReclamationEligibleCustomer({ salesStage: stage, isPinned: 0 }),
        false,
        stage,
      );
    }
    for (const stage of ["new_lead", "contacted", "interested", "proposal", "negotiation", "closed_lost"]) {
      assert.equal(isReclamationExcludedSalesStage(stage), false, stage);
      assert.equal(
        isReclamationEligibleCustomer({ salesStage: stage, isPinned: 0 }),
        true,
        stage,
      );
    }
  });

  it("keeps a pinned customer reclamation-exempt in any stage", () => {
    for (const stage of ["new_lead", "contacted", "negotiation"]) {
      assert.equal(
        isReclamationEligibleCustomer({ salesStage: stage, isPinned: 1 }),
        false,
        stage,
      );
    }
  });
});
