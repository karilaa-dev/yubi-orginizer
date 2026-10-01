import { describe, expect, it } from 'vitest';
import { aboutVersionMarkup } from '../src/ui/app-help';

const sha = '40e26271a2b3c4d5e6f708192a3b4c5d6e7f8091';
const base = { version: '1.0.0', time: '2026-09-30 17:40' };

describe('About version line', () => {
  it('links the short commit hash to GitHub when the URL is known', () => {
    const html = aboutVersionMarkup({ ...base, commit: sha, commitUrl: `https://github.com/o/r/commit/${sha}` });
    expect(html).toContain('Version 1.0.0 · built 2026-09-30 17:40 · commit ');
    expect(html).toContain(`<a href="https://github.com/o/r/commit/${sha}"`);
    expect(html).toContain('>40e2627</a>');
  });

  it('shows the hash without a link for local builds', () => {
    const html = aboutVersionMarkup({ ...base, commit: sha, commitUrl: '' });
    expect(html).toContain('commit <span');
    expect(html).not.toContain('<a ');
  });

  it('omits the commit when it is unknown', () => {
    expect(aboutVersionMarkup({ ...base, commit: '', commitUrl: '' })).not.toContain('commit');
  });

  it('is defined at build time from git', () => {
    expect(__COMMIT_SHA__).toMatch(/^[0-9a-f]{40}$/);
  });
});
