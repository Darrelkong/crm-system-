#!/usr/bin/env node

import { execSync } from "node:child_process";

const INTERVAL_MS = 10 * 60 * 1000;

function run(cmd) {
  return execSync(cmd, {
    stdio: "pipe",
    encoding: "utf8",
  }).trim();
}

function stream(cmd) {
  execSync(cmd, {
    stdio: "inherit",
  });
}

function getBranch() {
  return run("git rev-parse --abbrev-ref HEAD");
}

function hasChanges() {
  return run("git status --porcelain").length > 0;
}

function hasUpstream() {
  try {
    run("git rev-parse --abbrev-ref --symbolic-full-name @{u}");
    return true;
  } catch {
    return false;
  }
}

function getTimestamp() {
  const d = new Date();
  const pad = (n) => String(n).padStart(2, "0");

  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

function backupOnce() {
  try {
    const branch = getBranch();

    console.log("");
    console.log("====================================");
    console.log(`[Auto Backup] Checking branch: ${branch}`);
    console.log(`[Auto Backup] Time: ${getTimestamp()}`);

    if (branch === "main" || branch === "master") {
      console.log("[Auto Backup] Refused: auto backup is disabled on main/master branch.");
      return;
    }

    if (!hasChanges()) {
      console.log("[Auto Backup] No changes.");
      return;
    }

    console.log("[Auto Backup] Changes detected.");
    console.log("[Auto Backup] Running build...");

    stream("npm run build");

    console.log("[Auto Backup] Build successful.");
    console.log("[Auto Backup] Committing changes...");

    stream("git add -A");

    const stagedFiles = run("git diff --cached --name-only");

    if (!stagedFiles) {
      console.log("[Auto Backup] No staged files after git add.");
      return;
    }

    stream(`git commit -m "Auto backup: ${getTimestamp()}"`);

    console.log("[Auto Backup] Pushing to GitHub...");

    if (hasUpstream()) {
      stream("git push");
    } else {
      stream(`git push -u origin ${branch}`);
    }

    console.log("[Auto Backup] Backup completed.");
  } catch (error) {
    console.error("[Auto Backup] Backup failed.");
    console.error(error.message || error);
  }
}

console.log("[Auto Backup] Started.");
console.log("[Auto Backup] It will check changes every 10 minutes.");
console.log("[Auto Backup] Keep this terminal open.");
console.log("[Auto Backup] Press Control + C to stop.");

backupOnce();

setInterval(backupOnce, INTERVAL_MS);
