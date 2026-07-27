#!/usr/bin/env node
/**
 * check-manifest-drift.js (#936)
 *
 * Detects an uncommitted deployment manifest: if deployment-manifest.json
 * exists, its provenance.sourceInput.sha256 / provenance.registryInput.sha256
 * must match the current on-disk deployed.json / registry.json. A mismatch
 * means the manifest was generated from inputs that have since changed
 * (or were changed after generation) without regenerating the manifest —
 * i.e. the manifest has drifted from its source of truth.
 *
 * Usage:
 *   node contracts/scripts/check-manifest-drift.js \
 *       --manifest contracts/scripts/deployment-manifest.json
 *
 * Exit codes:
 *   0 — manifest absent (nothing to check) or hashes match.
 *   1 — manifest present but drifted from its recorded source inputs.
 */

"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

function parseArgs(argv) {
  const args = {};
  for (let i = 2; i < argv.length; i++) {
    if (argv[i].startsWith("--") && i + 1 < argv.length) {
      args[argv[i].slice(2)] = argv[i + 1];
      i++;
    }
  }
  return args;
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function main() {
  const args = parseArgs(process.argv);
  const manifestPath = args.manifest ?? path.join(__dirname, "deployment-manifest.json");

  if (!fs.existsSync(manifestPath)) {
    console.log("No deployment manifest found — skipping drift check.");
    process.exit(0);
  }

  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const provenance = manifest.provenance ?? {};
  const repoRoot = path.resolve(__dirname, "../..");
  const issues = [];

  const sourceInput = provenance.sourceInput;
  if (sourceInput?.path) {
    const sourcePath = path.join(repoRoot, sourceInput.path);
    if (fs.existsSync(sourcePath)) {
      const currentHash = sha256(sourcePath);
      if (currentHash !== sourceInput.sha256) {
        issues.push(
          `${sourceInput.path} has changed since the manifest was generated (recorded ${sourceInput.sha256}, current ${currentHash}). Regenerate the manifest with generate-manifest.js.`,
        );
      }
    }
  }

  const registryInput = provenance.registryInput;
  if (registryInput?.path && registryInput.sha256) {
    const registryPath = path.join(repoRoot, registryInput.path);
    if (fs.existsSync(registryPath)) {
      const currentHash = sha256(registryPath);
      if (currentHash !== registryInput.sha256) {
        issues.push(
          `${registryInput.path} has changed since the manifest was generated (recorded ${registryInput.sha256}, current ${currentHash}). Regenerate the manifest with generate-manifest.js.`,
        );
      }
    }
  }

  if (issues.length > 0) {
    console.error("ERROR: Deployment manifest has drifted from its source inputs:");
    for (const issue of issues) console.error(`  - ${issue}`);
    process.exit(1);
  }

  console.log("Result: PASSED — deployment manifest matches its recorded source inputs (no drift).");
  process.exit(0);
}

main();
