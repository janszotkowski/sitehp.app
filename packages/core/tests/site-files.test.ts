import { describe, expect, it } from 'vitest';
import { AI_RETRIEVAL_AGENTS, hostVariantOf, parseRobots, robotsBlockedAgents, robotsRefusingSignals, robotsVerdict, parseSitemap, sitemapLocation, sitemapSampleUrls } from '@src/index.ts';

describe('parseRobots', () => {
    it('sees a whole-site block for every crawler', () => {
        expect(parseRobots('User-agent: *\nDisallow: /\n').blocksAll).toBe(true);
        expect(parseRobots('user-agent: *   # everyone\nDISALLOW: /  # staging\n').blocksAll).toBe(true);
    });

    it('does not call a partial or crawler-specific rule a block', () => {
        expect(parseRobots('User-agent: *\nDisallow: /admin\n').blocksAll).toBe(false);
        expect(parseRobots('User-agent: *\nDisallow:\n').blocksAll).toBe(false);
        expect(parseRobots('User-agent: BadBot\nDisallow: /\n').blocksAll).toBe(false);
        expect(parseRobots('User-agent: *\nDisallow: /\nAllow: /\n').blocksAll).toBe(false);
    });

    it('takes /* for the whole site and lets only a site-wide Allow lift the block', () => {
        expect(parseRobots('User-agent: *\nDisallow: /*\n').blocksAll).toBe(true);
        expect(parseRobots('User-agent: *\nDisallow: /\nAllow: /wp-admin/admin-ajax.php\n').blocksAll).toBe(true);
        // `Allow: /$` lets in the home page only: the rest of the site stays blocked.
        expect(parseRobots('User-agent: *\nDisallow: /\nAllow: /$\n').blocksAll).toBe(true);
    });

    it('judges the Googlebot group when there is one, else the * group', () => {
        expect(parseRobots('User-agent: Googlebot\nDisallow: /\n').blocksAll).toBe(true);
        expect(parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nAllow: /\n').blocksAll).toBe(false);
        expect(parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private\n').blocksAll).toBe(false);
    });

    it('reads only the product token of a User-agent line, as Google does', () => {
        expect(parseRobots('User-agent: Googlebot/2.1\nDisallow: /\n').blocksAll).toBe(true);
        expect(parseRobots('User-agent: *\nDisallow: /\n\nUser-agent: googlebot/2.1 (+http://www.google.com/bot.html)\nAllow: /\n').blocksAll).toBe(false);
        expect(robotsBlockedAgents('User-agent: GPTBot/1.0\nDisallow: /', ['GPTBot', 'ClaudeBot'])).toEqual(['GPTBot']);
    });

    it('lets consecutive User-agent lines share their rules', () => {
        expect(parseRobots('User-agent: Googlebot\nUser-agent: *\nDisallow: /\n').blocksAll).toBe(true);
        expect(parseRobots('User-agent: *\nDisallow: /a\n\nUser-agent: Bingbot\nDisallow: /\n').blocksAll).toBe(false);
    });

    it('collects every Sitemap line, wherever it is', () => {
        expect(parseRobots('Sitemap: https://a.com/s1.xml\nUser-agent: *\nDisallow:\nsitemap: https://a.com/s2.xml').sitemaps).toEqual(['https://a.com/s1.xml', 'https://a.com/s2.xml']);
        expect(parseRobots('').sitemaps).toEqual([]);
    });
});

describe('robotsVerdict', () => {
    it('lets the longest matching rule decide, Allow on a tie, as Google does', () => {
        expect(robotsVerdict('User-agent: *\nDisallow: /', '/')).toEqual({ allowed: false, rule: 'Disallow: /' });
        expect(robotsVerdict('User-agent: *\nDisallow: /\nAllow: /blog', '/blog/post')).toEqual({ allowed: true, rule: 'Allow: /blog' });
        expect(robotsVerdict('User-agent: *\nAllow: /a\nDisallow: /a', '/a').allowed).toBe(true);
        expect(robotsVerdict('User-agent: *\nDisallow:', '/')).toEqual({ allowed: true, rule: null });
    });

    it('reads * as any run of characters and a final $ as the end', () => {
        expect(robotsVerdict('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /*.pdf$', '/files/a.pdf?x=1').allowed).toBe(true);
        expect(robotsVerdict('User-agent: *\nDisallow: /a.b', '/axb').allowed).toBe(true);
    });

    it('matches the pieces between stars in order, and a final $ against the end only', () => {
        expect(robotsVerdict('User-agent: *\nDisallow: /a*b*c', '/a-x-b-y-c-z').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /a*c*b', '/a-b-c').allowed).toBe(true);
        expect(robotsVerdict('User-agent: *\nDisallow: /ab*b$', '/ab').allowed).toBe(true);
        expect(robotsVerdict('User-agent: *\nDisallow: /ab*b$', '/abb').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /$', '/').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /$', '/x').allowed).toBe(true);
    });

    it('stays fast on a rule written to make a backtracking matcher hang', () => {
        const rule = `/${'*a'.repeat(40)}*b`;
        const started = performance.now();
        expect(robotsVerdict(`User-agent: *\nDisallow: ${rule}\n`.repeat(200), `/${'a'.repeat(2000)}`).allowed).toBe(true);
        expect(performance.now() - started).toBeLessThan(500);
    });

    it('compares rule and path percent-encoded, whichever way each was written', () => {
        expect(robotsVerdict('User-agent: *\nDisallow: /kontakt-ů', '/kontakt-%C5%AF')).toEqual({ allowed: false, rule: 'Disallow: /kontakt-ů' });
        expect(robotsVerdict('User-agent: *\nDisallow: /kontakt-%c5%af', '/kontakt-%C5%AF').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /a%20b', '/a%20b').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /a b*$', '/a%20bc').allowed).toBe(false);
        expect(robotsVerdict('User-agent: *\nDisallow: /kontakt-ů', '/kontakt-u').allowed).toBe(true);
    });

    it('judges the Googlebot group when there is one', () => {
        expect(robotsVerdict('User-agent: *\nDisallow: /\n\nUser-agent: Googlebot\nDisallow: /private', '/').allowed).toBe(true);
    });
});

describe('robotsRefusingSignals', () => {
    it('reads Content-Signal per crawler: its own groups, else *', () => {
        const text = 'User-agent: *\nContent-Signal: search=no\nAllow: /\n\nUser-agent: ChatGPT-User\nContent-Signal: search=yes, ai-input=yes\nAllow: /';
        expect(robotsRefusingSignals(text, ['ChatGPT-User', 'Claude-User'])).toEqual(['Claude-User']);
        expect(robotsRefusingSignals('User-agent: *\nContent-Signal: ai-train=no\nAllow: /', AI_RETRIEVAL_AGENTS)).toEqual([]);
    });
});

describe('parseSitemap', () => {
    it('reads a urlset with decoded and CDATA addresses', () => {
        const xml =
            '<?xml version="1.0"?><urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"><url><loc>https://a.com/?x=1&amp;y=2</loc></url><url><loc><![CDATA[https://a.com/b]]></loc></url></urlset>';
        expect(parseSitemap(xml)).toEqual({ kind: 'urlset', locations: ['https://a.com/?x=1&y=2', 'https://a.com/b'] });
    });

    it('tells an index from a list of pages, and rejects what is neither', () => {
        expect(parseSitemap('<sitemapindex><sitemap><loc>https://a.com/s.xml</loc></sitemap></sitemapindex>').kind).toBe('index');
        expect(parseSitemap('<html><body>not found</body></html>')).toEqual({ kind: 'invalid', locations: [] });
    });

    it('reads a namespace-prefixed sitemap', () => {
        expect(parseSitemap('<sm:urlset xmlns:sm="http://www.sitemaps.org/schemas/sitemap/0.9"><sm:url><sm:loc>https://a.com/</sm:loc></sm:url></sm:urlset>', true)).toEqual({
            kind: 'urlset',
            locations: ['https://a.com/'],
        });
        expect(parseSitemap('<sm:sitemapindex><sm:sitemap><sm:loc>https://a.com/s.xml</sm:loc></sm:sitemap></sm:sitemapindex>', true).kind).toBe('index');
    });

    it('rejects malformed XML: a bare ampersand, or a missing root end in a file read whole', () => {
        expect(parseSitemap('<urlset><url><loc>https://a.com/?x=1&y=2</loc></url></urlset>').kind).toBe('invalid');
        expect(parseSitemap('<urlset><url><loc><![CDATA[https://a.com/?x=1&y=2]]></loc></url></urlset>').kind).toBe('urlset');
        expect(parseSitemap('<urlset><url><loc>https://a.com/</loc></url>', true).kind).toBe('invalid');
        // Cut off by the size cap: what was read still counts, even a reference cut mid-way.
        expect(parseSitemap('<urlset><url><loc>https://a.com/</loc></url><url><loc>https://a.com/?x=1&am').locations).toEqual(['https://a.com/']);
    });

    it('stays fast on a huge file of unclosed <loc> tags', () => {
        const started = performance.now();
        expect(parseSitemap(`<urlset>${'<loc>x'.repeat(200_000)}`).locations).toEqual([]);
        expect(performance.now() - started).toBeLessThan(500);
    });
});

describe('sitemap helpers', () => {
    it('uses the sitemap robots.txt names on the same host, else /sitemap.xml', () => {
        expect(sitemapLocation({ blocksAll: false, sitemaps: ['https://a.com/map.xml'] }, 'https', 'a.com')).toBe('https://a.com/map.xml');
        expect(sitemapLocation({ blocksAll: false, sitemaps: ['https://other.com/map.xml'] }, 'https', 'a.com')).toBe('https://a.com/sitemap.xml');
        expect(sitemapLocation({ blocksAll: false, sitemaps: ['not a url'] }, 'https', 'a.com')).toBe('https://a.com/sitemap.xml');
        expect(sitemapLocation(null, 'https', 'a.com')).toBe('https://a.com/sitemap.xml');
        // The site names its sitemap on `www` while the scan went to the bare name, or the other way round.
        expect(sitemapLocation({ blocksAll: false, sitemaps: ['https://www.a.com/map.xml'] }, 'https', 'a.com')).toBe('https://www.a.com/map.xml');
        expect(sitemapLocation({ blocksAll: false, sitemaps: ['https://a.com/map.xml'] }, 'https', 'www.a.com')).toBe('https://a.com/map.xml');
    });

    it('samples own-host addresses spread over the list', () => {
        const locations = Array.from({ length: 10 }, (_unused, index) => `https://a.com/p${index}`);
        expect(sitemapSampleUrls(['https://other.com/x', ...locations], 'a.com', 3)).toEqual(['https://a.com/p0', 'https://a.com/p5', 'https://a.com/p9']);
        expect(sitemapSampleUrls(['https://a.com/one'], 'a.com', 3)).toEqual(['https://a.com/one']);
        expect(sitemapSampleUrls(locations, 'a.com', 1)).toEqual(['https://a.com/p0']);
        expect(sitemapSampleUrls(['https://www.a.com/p'], 'a.com', 3)).toEqual(['https://www.a.com/p']);
    });

    it('finds the other host name only where it is clear', () => {
        expect(hostVariantOf('example.com')).toBe('www.example.com');
        expect(hostVariantOf('www.example.com')).toBe('example.com');
        expect(hostVariantOf('shop.example.com')).toBeNull();
    });
});

describe('robotsBlockedAgents', () => {
    it('judges each crawler by its own group, else by *, and ignores partial rules', () => {
        expect(robotsBlockedAgents('User-agent: *\nDisallow: /', ['GPTBot', 'ClaudeBot'])).toEqual(['GPTBot', 'ClaudeBot']);
        expect(robotsBlockedAgents('User-agent: GPTBot\nDisallow: /', ['GPTBot', 'ClaudeBot'])).toEqual(['GPTBot']);
        expect(robotsBlockedAgents('User-agent: *\nDisallow: /\n\nUser-agent: claudebot\nAllow: /', ['GPTBot', 'ClaudeBot'])).toEqual(['GPTBot']);
        expect(robotsBlockedAgents('User-agent: *\nDisallow: /private', AI_RETRIEVAL_AGENTS)).toEqual([]);
    });
});
