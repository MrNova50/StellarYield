import { describe, it, expect } from 'vitest';
import { lintMarkdownContent } from './lintMarkdown';

describe('lintMarkdownContent', () => {
  it('returns no issues for a well-formed document', () => {
    const content = [
      '# Title',
      '',
      '## Section',
      '',
      '- one',
      '- two',
      '',
      'See [the docs](https://example.com/docs) for details.',
    ].join('\n');

    expect(lintMarkdownContent(content)).toEqual([]);
  });

  it('flags an empty heading', () => {
    const issues = lintMarkdownContent('# Title\n\n##\n');
    expect(issues).toEqual([expect.objectContaining({ rule: 'empty-heading', line: 3 })]);
  });

  it('flags a heading level that skips a level', () => {
    const issues = lintMarkdownContent('# Title\n\n### Subsection\n');
    expect(issues).toEqual([expect.objectContaining({ rule: 'heading-level-skip', line: 3 })]);
  });

  it('does not flag a heading level that steps down by more than one (that is always valid)', () => {
    const issues = lintMarkdownContent('# Title\n\n## Section\n\n### Sub\n\n# New top-level\n');
    expect(issues.filter((i) => i.rule === 'heading-level-skip')).toEqual([]);
  });

  it('flags a link with empty text', () => {
    const issues = lintMarkdownContent('See []( https://example.com ) here.');
    expect(issues.some((i) => i.rule === 'malformed-link')).toBe(true);
  });

  it('flags a link with an empty URL', () => {
    const issues = lintMarkdownContent('See [the docs]() here.');
    expect(issues.some((i) => i.rule === 'malformed-link')).toBe(true);
  });

  it('flags an unclosed link', () => {
    const issues = lintMarkdownContent('See [the docs](https://example.com/docs for details.');
    expect(issues.some((i) => i.rule === 'malformed-link')).toBe(true);
  });

  it('flags an empty list item', () => {
    const issues = lintMarkdownContent('# Title\n\n- one\n-\n- two\n');
    expect(issues).toEqual([expect.objectContaining({ rule: 'empty-list-item', line: 4 })]);
  });

  it('reports the correct line number for issues later in the document', () => {
    const content = ['# Title', '', 'Some text.', '', 'Another line.', '', '[broken]()'].join('\n');
    const issues = lintMarkdownContent(content);
    expect(issues).toEqual([expect.objectContaining({ line: 7 })]);
  });
});
