#!/usr/bin/env node
// CI gate for unit tests: fail on any test failure that isn't already known
// to fail on main. Known failures live in scripts/known-test-failures.json so
// the gate is green today and catches every new break. When a known failure
// starts passing, this prints it so the entry can be removed.
//
// usage: node scripts/check-test-failures.mjs <vitest json report>

import { readFileSync } from "node:fs";
import { resolve, relative, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export function testId(file, fullName) {
  return `${relative(root, resolve(root, file)).split("\\").join("/")} > ${fullName}`;
}

export function failedTestIds(report) {
  const ids = [];
  for (const suite of report.testResults ?? []) {
    const failedAsserts = (suite.assertionResults ?? []).filter((a) => a.status === "failed");
    for (const a of failedAsserts) ids.push(testId(suite.name, a.fullName ?? a.title));
    // A file that fails to load has no assertions; count the file itself.
    if (suite.status === "failed" && failedAsserts.length === 0) ids.push(testId(suite.name, "(file failed to run)"));
  }
  return ids;
}

export function compareFailures(failed, known) {
  const knownSet = new Set(known);
  const failedSet = new Set(failed);
  return {
    unexpected: failed.filter((id) => !knownSet.has(id)),
    nowPassing: known.filter((id) => !failedSet.has(id)),
  };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const reportPath = process.argv[2];
  if (!reportPath) {
    console.error("usage: check-test-failures.mjs <vitest json report>");
    process.exit(2);
  }
  let report;
  try {
    report = JSON.parse(readFileSync(reportPath, "utf8"));
  } catch (e) {
    console.error(`No readable vitest report at ${reportPath}: ${e.message}. Did vitest crash?`);
    process.exit(1);
  }
  const known = JSON.parse(readFileSync(resolve(root, "scripts/known-test-failures.json"), "utf8")).failures ?? [];
  const failed = failedTestIds(report);
  const { unexpected, nowPassing } = compareFailures(failed, known);

  console.log(`${report.numTotalTests ?? "?"} tests, ${failed.length} failing, ${known.length} known failures.`);
  if (nowPassing.length) {
    console.log("\nKnown failures that now pass (remove them from scripts/known-test-failures.json):");
    for (const id of nowPassing) console.log(`  - ${id}`);
  }
  if (unexpected.length) {
    console.error("\nNew test failures:");
    for (const id of unexpected) console.error(`  ✗ ${id}`);
    process.exit(1);
  }
  console.log("No new test failures.");
}
