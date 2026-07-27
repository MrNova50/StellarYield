#!/usr/bin/env node
/**
 * Refreshes the saved-search links embedded in maintainer_saved_searches.sh
 * from the single source of truth in scripts/saved-searches.json (issue #1086).
 *
 * Usage:
 *   node scripts/refresh-saved-searches.js            # writes the refreshed block
 *   node scripts/refresh-saved-searches.js --dry-run   # prints the diff, writes nothing
 *
 * To add a new saved search: add an entry to scripts/saved-searches.json,
 * then run this script (see docs/maintainer-saved-searches.md).
 */
const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const CONFIG_PATH = path.join(REPO_ROOT, 'scripts', 'saved-searches.json');
const TARGET_PATH = path.join(REPO_ROOT, 'scripts', 'maintainer_saved_searches.sh');

const START_MARKER = '# --- BEGIN GENERATED SAVED SEARCHES (scripts/refresh-saved-searches.js) ---';
const END_MARKER = '# --- END GENERATED SAVED SEARCHES ---';

function loadConfig() {
  return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf-8'));
}

/** Deterministically renders the generated block from the saved-search config. */
function renderBlock(config) {
  const baseUrl = `https://github.com/${config.repo}/issues`;
  const lines = [START_MARKER];
  config.searches.forEach((search, i) => {
    const url = `${baseUrl}?q=${encodeURIComponent(search.query)}`;
    lines.push(`echo "${i + 1}. ${search.label}:"`);
    lines.push(`echo "    ${url}"`);
    lines.push(`echo`);
  });
  lines.push(END_MARKER);
  return lines.join('\n');
}

function replaceOrAppendBlock(existingContent, block) {
  const startIdx = existingContent.indexOf(START_MARKER);
  const endIdx = existingContent.indexOf(END_MARKER);
  if (startIdx !== -1 && endIdx !== -1) {
    const before = existingContent.slice(0, startIdx);
    const after = existingContent.slice(endIdx + END_MARKER.length);
    return `${before}${block}${after}`;
  }
  const trimmed = existingContent.replace(/\n+$/, '\n');
  return `${trimmed}\n${block}\n`;
}

function main() {
  const dryRun = process.argv.includes('--dry-run');
  const config = loadConfig();
  const block = renderBlock(config);

  const existing = fs.existsSync(TARGET_PATH) ? fs.readFileSync(TARGET_PATH, 'utf-8') : '';
  const updated = replaceOrAppendBlock(existing, block);

  if (updated === existing) {
    console.log('Saved searches are already up to date — no changes.');
    return;
  }

  if (dryRun) {
    console.log(`Dry run — ${TARGET_PATH} would change to:\n`);
    console.log(block);
    console.log('\n(no file was written; re-run without --dry-run to apply)');
    return;
  }

  fs.writeFileSync(TARGET_PATH, updated);
  console.log(`Refreshed saved searches in ${path.relative(REPO_ROOT, TARGET_PATH)}`);
}

main();

module.exports = { renderBlock, replaceOrAppendBlock, loadConfig };
