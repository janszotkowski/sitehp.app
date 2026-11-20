import { existsSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { OPERATOR } from '@config/operator';
import { SITE_ORIGIN } from '@config/site';
import { pageHead } from '@lib/pageHead';
import { faqItems } from '@components/HomeSections';
import { APPLICATION_ID, OPERATOR_ID, WEBSITE_ID, applicationNode, breadcrumbNode, faqPageNode, graph, operatorNode, webPageNode, websiteNode } from '@lib/seoSchema';

describe('schema nodes', () => {
    it('link to each other by @id, never by copy', () => {
        expect(websiteNode('en')['publisher']).toEqual({ '@id': OPERATOR_ID });
        expect(webPageNode({ name: 'Home', description: 'x', path: '/en', locale: 'en' })['isPartOf']).toEqual({ '@id': WEBSITE_ID });
        expect(applicationNode('en')['publisher']).toEqual({ '@id': OPERATOR_ID });
    });

    it('describe the product as a free web application for developers', () => {
        const node = applicationNode('en');
        expect(node['@type']).toBe('WebApplication');
        expect(node['applicationCategory']).toBe('DeveloperApplication');
        expect(node['@id']).toBe(APPLICATION_ID);
        expect(node['offers']).toMatchObject({ price: '0' });
    });

    it('give the site and the application their own image, which exists in public/', () => {
        for (const node of [websiteNode('en'), applicationNode('en')]) {
            const image = String(node['image']);
            expect(image).toBe(`${SITE_ORIGIN}/apple-touch-icon.png`);
            expect(existsSync(`public${image.slice(SITE_ORIGIN.length)}`)).toBe(true);
        }
    });

    it('describe the operator as a person, without the product’s icon', () => {
        const node = operatorNode('en');
        expect(node['@type']).toBe('Person');
        expect(node['url']).toBe(OPERATOR.url);
        expect(node).not.toHaveProperty('logo');
    });

    it('mark up the home FAQ from the same messages as the visible list', () => {
        const items = faqItems('en');
        const node = faqPageNode('/en', items);
        expect(node['@type']).toBe('FAQPage');
        expect(node['mainEntity']).toEqual(items.map((item) => ({ '@type': 'Question', name: item.q, acceptedAnswer: { '@type': 'Answer', text: item.a } })));
        expect(items.length).toBeGreaterThan(0);
    });

    it('date a page and name its version only when they are given', () => {
        expect(webPageNode({ name: 'x', description: 'x', path: '/en/methodology', locale: 'en', dateModified: '2026-10-10', version: 2 })).toMatchObject({ dateModified: '2026-10-10', version: 2 });
        expect(webPageNode({ name: 'x', description: 'x', path: '/en', locale: 'en' })).not.toHaveProperty('dateModified');
    });

    it('link the operator’s real profiles with sameAs', () => {
        expect(operatorNode('en')['sameAs']).toEqual([OPERATOR.x]);
    });

    it('number breadcrumbs from one and use absolute URLs', () => {
        const node = breadcrumbNode([
            { name: 'sitehp.app', path: '/en' },
            { name: 'Pricing', path: '/en/pricing' },
        ]);
        expect(node['itemListElement']).toEqual([
            { '@type': 'ListItem', position: 1, name: 'sitehp.app', item: `${SITE_ORIGIN}/en` },
            { '@type': 'ListItem', position: 2, name: 'Pricing', item: `${SITE_ORIGIN}/en/pricing` },
        ]);
    });

    it('put @context once on the graph', () => {
        expect(graph([])).toEqual({ '@context': 'https://schema.org', '@graph': [] });
    });
});

describe('pageHead', () => {
    it('builds one graph per page from the same nodes', () => {
        const head = pageHead({
            locale: 'en',
            title: 'Pricing',
            description: 'x',
            path: '/en/pricing',
            breadcrumbs: [
                { name: 'sitehp.app', path: '/en' },
                { name: 'Pricing', path: '/en/pricing' },
            ],
        });
        const payload = JSON.parse(head.scripts[0]?.children ?? '{}') as { '@graph': Array<{ '@type': string }> };
        expect(payload['@graph'].map((node) => node['@type'])).toEqual(['Person', 'WebSite', 'WebPage', 'BreadcrumbList']);
    });

    it('omits breadcrumbs when none are given', () => {
        const head = pageHead({ locale: 'en', title: 'Home', description: 'x', path: '/en' });
        expect(head.scripts[0]?.children).not.toContain('BreadcrumbList');
    });

    it('describes nothing in JSON-LD about a page kept out of the index', () => {
        const head = pageHead({ locale: 'en', title: 'Report for example.com', description: 'x', path: '/en/r/abc', noindex: true });
        expect(head.scripts).toEqual([]);
        expect(head.meta).toContainEqual({ name: 'robots', content: 'noindex, nofollow' });
    });
});
