/**
 * Structural markdown linter (issue #1087) for generated issue canvases and
 * maintainer handoff notes. A pure, dependency-free checker — no
 * `generated issue canvas` files exist in this repo yet (the suggested
 * `GRANTFOX_*_CANVAS.md` / `STELLARYIELD_EPIC_ISSUE_CANVAS.md` files aren't
 * present), so this validates any markdown file, ready for canvases as soon
 * as they're generated, and useful today against `docs/**`.
 *
 * Catches: malformed/empty headings, a heading level that skips one or more
 * levels (h1 -> h3), malformed link syntax (`[text]()`  / `[text](` with no
 * closing paren / empty link text), and list-item lines with no content.
 */

export interface MarkdownLintIssue {
  line: number;
  rule: 'empty-heading' | 'heading-level-skip' | 'malformed-link' | 'empty-list-item';
  message: string;
}

const HEADING_RE = /^(#{1,6})\s*(.*)$/;
const LIST_ITEM_RE = /^\s*[-*+]\s*(.*)$/;
// A reasonably strict "well-formed markdown link" shape: [text](url) with
// non-empty text and non-empty url. Used to spot the malformed neighbors.
const WELL_FORMED_LINK_RE = /\[[^\]]+\]\([^)\s][^)]*\)/;

function findMalformedLinksInLine(line: string, lineNumber: number): MarkdownLintIssue[] {
  const issues: MarkdownLintIssue[] = [];

  // Empty link text: []("url") or empty url: [text]()
  const emptyPartsRe = /\[([^\]]*)\]\(([^)]*)\)/g;
  let match: RegExpExecArray | null;
  while ((match = emptyPartsRe.exec(line)) !== null) {
    const [, text, url] = match;
    if (text.trim().length === 0) {
      issues.push({
        line: lineNumber,
        rule: 'malformed-link',
        message: `Link has empty text: "${match[0]}"`,
      });
    } else if (url.trim().length === 0) {
      issues.push({
        line: lineNumber,
        rule: 'malformed-link',
        message: `Link "${text}" has an empty URL`,
      });
    }
  }

  // Unclosed link: "[text](" with no matching ")" anywhere later on the line.
  const openParenRe = /\[[^\]]+\]\([^)]*$/;
  if (openParenRe.test(line) && !WELL_FORMED_LINK_RE.test(line)) {
    issues.push({
      line: lineNumber,
      rule: 'malformed-link',
      message: `Link opening "(" is never closed: "${line.trim()}"`,
    });
  }

  return issues;
}

/**
 * Lints a markdown document's structure. Returns one issue per problem
 * found; an empty array means the document is structurally well-formed.
 */
export function lintMarkdownContent(content: string): MarkdownLintIssue[] {
  const issues: MarkdownLintIssue[] = [];
  const lines = content.split('\n');
  let lastHeadingLevel = 0;

  lines.forEach((line, index) => {
    const lineNumber = index + 1;

    const headingMatch = line.match(HEADING_RE);
    if (headingMatch) {
      const level = headingMatch[1].length;
      const text = headingMatch[2].trim();

      if (text.length === 0) {
        issues.push({
          line: lineNumber,
          rule: 'empty-heading',
          message: `Heading has no text: "${line.trim()}"`,
        });
      }

      if (lastHeadingLevel > 0 && level > lastHeadingLevel + 1) {
        issues.push({
          line: lineNumber,
          rule: 'heading-level-skip',
          message: `Heading level jumps from h${lastHeadingLevel} to h${level} — skips h${lastHeadingLevel + 1}.`,
        });
      }
      lastHeadingLevel = level;
      return;
    }

    const listMatch = line.match(LIST_ITEM_RE);
    if (listMatch && listMatch[1].trim().length === 0) {
      issues.push({
        line: lineNumber,
        rule: 'empty-list-item',
        message: 'List item has no content.',
      });
    }

    issues.push(...findMalformedLinksInLine(line, lineNumber));
  });

  return issues;
}
