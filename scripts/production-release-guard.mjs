import { readFile } from "node:fs/promises";

const SHA_PATTERN = /^[0-9a-f]{40}$/i;

export class ProductionReleaseGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "ProductionReleaseGuardError";
  }
}

export function assertProductionSource({
  branch,
  head,
  originMain,
  status,
  packageDiff,
}) {
  if (branch !== "main") {
    throw new ProductionReleaseGuardError(
      `Production deploy must run from main; current branch is ${branch || "(detached)"}.`,
    );
  }
  if (!SHA_PATTERN.test(head)) {
    throw new ProductionReleaseGuardError("Unable to resolve a valid current HEAD.");
  }
  if (!SHA_PATTERN.test(originMain)) {
    throw new ProductionReleaseGuardError(
      "Unable to resolve a valid origin/main revision.",
    );
  }
  if (head !== originMain) {
    throw new ProductionReleaseGuardError(
      `HEAD ${head} does not match origin/main ${originMain}.`,
    );
  }
  if (status.trim()) {
    throw new ProductionReleaseGuardError(
      "Production deploy requires a clean worktree.",
    );
  }
  if (packageDiff.trim()) {
    throw new ProductionReleaseGuardError(
      "package.json or package-lock.json differs from HEAD.",
    );
  }
}

export async function readReleaseMetadata(path) {
  let raw;
  try {
    raw = await readFile(path, "utf8");
  } catch {
    throw new ProductionReleaseGuardError(
      `Missing release metadata marker: ${path}`,
    );
  }

  let metadata;
  try {
    metadata = JSON.parse(raw);
  } catch {
    throw new ProductionReleaseGuardError(
      `Invalid release metadata marker: ${path}`,
    );
  }

  return metadata;
}

export function assertReleaseArtifact({ metadata, head, originMain }) {
  if (!metadata || typeof metadata !== "object") {
    throw new ProductionReleaseGuardError("Release metadata is not an object.");
  }
  if (metadata.source !== "production-release") {
    throw new ProductionReleaseGuardError(
      "Release metadata was not produced by the production release workflow.",
    );
  }
  if (metadata.gitSha !== head || metadata.gitSha !== originMain) {
    throw new ProductionReleaseGuardError(
      `Artifact SHA ${metadata.gitSha ?? "(missing)"} does not match HEAD/origin/main.`,
    );
  }
  if (typeof metadata.builtAt !== "string" || !metadata.builtAt) {
    throw new ProductionReleaseGuardError(
      "Release metadata is missing the build timestamp.",
    );
  }
}
