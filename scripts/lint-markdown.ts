#!/usr/bin/env -S npx tsx
/**
 * CLI wrapper for lintMarkdown.ts (issue #1087).
 *
 * Usage:
 *   npx tsx scripts/lint-markdown.ts docs/*.md
 *   npx tsx scripts/lint-markdown.ts GRANTFOX_ISSUE_CANVAS.md
 *
 * Exits 1 if any file has structural issues (malformed headings, skipped
 * heading levels, malformed links, empty list items), 0 otherwise.
 */
import fs from 'fs';
import path from 'path';
import { lintMarkdownContent } from './lintMarkdown';

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error('Usage: npx tsx scripts/lint-markdown.ts <file.md> [file2.md ...]');
  process.exit(1);
}

let hadIssues = false;

for (const file of files) {
  const fullPath = path.resolve(file);
  if (!fs.existsSync(fullPath)) {
    console.error(`✗ ${file}: file not found`);
    hadIssues = true;
    continue;
  }
  const content = fs.readFileSync(fullPath, 'utf-8');
  const issues = lintMarkdownContent(content);

  if (issues.length === 0) {
    console.log(`✓ ${file}`);
  } else {
    hadIssues = true;
    console.log(`✗ ${file}`);
    for (const issue of issues) {
      console.log(`    line ${issue.line} [${issue.rule}] ${issue.message}`);
    }
  }
}

process.exit(hadIssues ? 1 : 0);
