# Markdown Linting for Generated Documents

Generated issue canvases (e.g. `GRANTFOX_ISSUE_CANVAS.md`-style documents)
and maintainer handoff notes get copied into GitHub issues and GrantFox, so
a structural mistake — a skipped heading level, an empty list item, a link
whose parentheses never closed — is easy to introduce when generating or
hand-editing them, and easy to miss until it renders badly somewhere else.

## Running the check

```bash
npx tsx scripts/lint-markdown.ts path/to/file.md [more-files.md ...]
```

Exits non-zero if any file has issues, so it's safe to wire into a
pre-publish step or CI job:

```bash
npx tsx scripts/lint-markdown.ts docs/*.md GRANTFOX_*.md STELLARYIELD_EPIC_ISSUE_CANVAS.md
```

(Glob patterns that don't match any file are simply skipped by the shell —
run it against whichever generated canvases exist at the time.)

## What it catches

- **Empty headings** — a `#`/`##`/etc. line with no text after it.
- **Skipped heading levels** — jumping from `#` straight to `###` with no
  `##` in between. Stepping back down (e.g. `###` to `#` for a new
  top-level section) is always valid and not flagged.
- **Malformed links** — `[text]()` (empty URL), `[]("url")` (empty text),
  and an unclosed `[text](` with no matching `)`.
- **Empty list items** — a `-`/`*`/`+` bullet with nothing after it.

## Extending the check

The checker lives in `scripts/lintMarkdown.ts` as a single pure function,
`lintMarkdownContent(content: string): MarkdownLintIssue[]`, covered by
`scripts/lintMarkdown.test.ts`. Add a new rule by extending that function
and adding a case to the test file — the CLI wrapper
(`scripts/lint-markdown.ts`) needs no changes.
