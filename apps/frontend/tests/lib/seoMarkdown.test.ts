import { describe, expect, it } from 'vitest';
import { SITE_ORIGIN } from '@config/site';
import { seoHead } from '@lib/seo';
import { htmlToMarkdown, markdownSourceOf, markdownTokens, markdownTwinOf, notFoundMarkdown, wantsMarkdown } from '@lib/seoMarkdown';

const page = `<!DOCTYPE html><html><head><title>x</title><script>alert(1)</script></head><body>
<nav><a href="/en">Home</a></nav>
<main id="main"><h1>How we score</h1><p>Read the <a href="/en/about">about page</a> &amp; <strong>more</strong>.<!-- --> It&#x27;s fine.</p>
<div role="img" aria-label="HP score 84"><svg><circle/></svg><span aria-hidden="true">84</span></div>
<section><h2 id="steps">Steps</h2><ul><li><h3>One</h3><p>First</p></li><li>Two</li></ul></section>
<table><caption>Weights</caption><thead><tr><th>Severity</th><th>Weight</th></tr></thead><tbody><tr><th>Critical</th><td>8</td></tr></tbody></table>
<form><input id="scan-url"/><button>Scan</button></form>
<details><summary>Is it free?<svg></svg></summary><p>Yes.</p></details>
<address><span>Acme</span><span>Springfield</span></address><div><a href="/en/contact">Contact</a><a href="/en/about">About</a></div>
<a href="#main">Back up</a> <a href="https://acme.example">Acme</a>
</main><footer>Footer</footer></body></html>`;

describe('htmlToMarkdown', () => {
    const markdown = htmlToMarkdown(page);

    it('keeps only the main content, without scripts, forms or decoration', () => {
        expect(markdown.startsWith('# How we score\n')).toBe(true);
        expect(markdown).not.toMatch(/Footer|Home|alert|Scan|scan-url|84<|<\w/);
        expect(markdown).toContain('HP score 84');
    });

    it('turns headings, paragraphs, lists, links and tables into Markdown', () => {
        expect(markdown).toContain(`Read the [about page](${SITE_ORIGIN}/en/about) & **more**. It's fine.`);
        expect(markdown).toContain('## Steps');
        expect(markdown).toContain('### One');
        expect(markdown).toContain('- Two');
        expect(markdown).toContain('| Severity | Weight |\n| --- | --- |\n| Critical | 8 |');
        expect(markdown).toContain('**Is it free?**\n\nYes.');
        expect(markdown).toContain('Back up [Acme](https://acme.example)');
        expect(markdown).toContain('Acme\nSpringfield');
        expect(markdown).toContain(`[Contact](${SITE_ORIGIN}/en/contact) [About](${SITE_ORIGIN}/en/about)`);
    });

    it('drops the bullet of a list item made of blocks', () => {
        expect(markdown).not.toMatch(/^- $|^-\n/m);
        expect(markdown).toContain('### One\n\nFirst');
    });

    it('leaves no run of blank lines', () => {
        expect(markdown).not.toMatch(/\n{3,}/);
    });
});

describe('Markdown twins', () => {
    it('exist for public pages only', () => {
        expect(markdownSourceOf('/en/about.md')).toBe('/en/about');
        expect(markdownSourceOf('/en.md')).toBe('/en');
        expect(markdownSourceOf('/en/r/abc.md')).toBeUndefined();
        expect(markdownTwinOf('/en/methodology')).toBe('/en/methodology.md');
        expect(markdownTwinOf('/en/r/abc')).toBeUndefined();
    });

    it('are announced in the head of a public page, and only there', () => {
        const markdownLink = (path: string) => seoHead({ title: 'x', description: 'x', path }).links.find((link) => 'type' in link && link.type === 'text/markdown');
        expect(markdownLink('/en/about')).toEqual({ rel: 'alternate', type: 'text/markdown', href: `${SITE_ORIGIN}/en/about.md` });
        expect(markdownLink('/en/r/abc')).toBeUndefined();
    });
});

describe('wantsMarkdown', () => {
    it('answers Markdown to an agent that names it', () => {
        expect(wantsMarkdown('text/markdown')).toBe(true);
        expect(wantsMarkdown('text/markdown, text/html;q=0.9')).toBe(true);
        expect(wantsMarkdown('text/html;q=0.5, text/markdown;q=0.5')).toBe(true);
        expect(wantsMarkdown('text/markdown;q=0.9, */*;q=0.8')).toBe(true);
    });

    it('answers HTML to browsers and to anything that ranks HTML higher', () => {
        expect(wantsMarkdown('text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8')).toBe(false);
        expect(wantsMarkdown('text/html, text/markdown;q=0.9')).toBe(false);
        expect(wantsMarkdown('text/markdown;q=0.5, */*')).toBe(false);
    });

    it('is never triggered by a bare wildcard, a refusal or no header', () => {
        expect(wantsMarkdown('*/*')).toBe(false);
        expect(wantsMarkdown('text/*')).toBe(false);
        expect(wantsMarkdown('text/markdown;q=0')).toBe(false);
        expect(wantsMarkdown('')).toBe(false);
        expect(wantsMarkdown(null)).toBe(false);
    });
});

describe('Markdown responses', () => {
    it('estimate tokens at about four characters each', () => {
        expect(markdownTokens('')).toBe(0);
        expect(markdownTokens('abcde')).toBe(2);
    });

    it('say in Markdown that a page does not exist, with a way home', () => {
        const markdown = notFoundMarkdown();
        expect(markdown.startsWith('# ')).toBe(true);
        expect(markdown).toContain(`](${SITE_ORIGIN}/en)`);
        expect(markdown).not.toContain('<');
    });
});
