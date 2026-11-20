import type { DefaultTreeAdapterTypes } from 'parse5';
import type { FetchedPage } from './page.ts';

export type HtmlElement = DefaultTreeAdapterTypes.Element;

const HTML_NAMESPACE = 'http://www.w3.org/1999/xhtml';

const parsed = new WeakMap<FetchedPage, Promise<readonly HtmlElement[] | null>>();

/**
 * Chrome's own cap on DOM depth. Tree building costs depth × tags (the spec's scope checks walk the stack of open elements),
 * so a hostile page of 200 000 nested `<div>`s would stall the process for minutes; under this cap a 1 MB page parses in well under a second.
 */
export const MAX_DEPTH = 512;

class TooDeep extends Error {}

/** The default tree, counting how deep each node sits and giving up past `MAX_DEPTH`. */
const depthOf = new WeakMap<DefaultTreeAdapterTypes.Node, number>();
const place = (parent: DefaultTreeAdapterTypes.ParentNode, node: DefaultTreeAdapterTypes.ChildNode): void => {
    const depth = (depthOf.get(parent) ?? 0) + 1;
    if (depth > MAX_DEPTH) throw new TooDeep();
    depthOf.set(node, depth);
};

// Loaded on first use: the frontend imports the check registry for its names, and parse5 has no business in the browser bundle.
const parseGuarded = async (body: string): Promise<DefaultTreeAdapterTypes.Document | null> => {
    const { defaultTreeAdapter, parse } = await import('parse5');
    const treeAdapter: typeof defaultTreeAdapter = {
        ...defaultTreeAdapter,
        appendChild: (parent, node) => {
            place(parent, node);
            defaultTreeAdapter.appendChild(parent, node);
        },
        insertBefore: (parent, node, reference) => {
            place(parent, node);
            defaultTreeAdapter.insertBefore(parent, node, reference);
        },
    };
    try {
        return parse(body, { treeAdapter });
    } catch (error) {
        if (error instanceof TooDeep) return null;
        throw error;
    }
};

/**
 * The HTML elements of the page in document order, parsed by parse5 exactly as a browser would (entities, unclosed tags, a cut-off body).
 * Inline SVG and MathML are left out (an SVG has its own `<title>`), and so is a `<template>`'s inert content; a script, style or noscript is text,
 * so a tag mentioned inside one is never an element. Parsed once per page, since every HTML check reads the same tree.
 * Null for a page nested deeper than `MAX_DEPTH`: no real page is, and reading it would stall the scan.
 */
export const elementsOf = (page: FetchedPage): Promise<readonly HtmlElement[] | null> => {
    const cached = parsed.get(page);
    if (cached !== undefined) return cached;
    const elements = parseGuarded(page.body).then((document) => (document === null ? null : walk(document)));
    parsed.set(page, elements);
    return elements;
};

const walk = (document: DefaultTreeAdapterTypes.Document): HtmlElement[] => {
    const found: HtmlElement[] = [];
    // A stack, not recursion, so the walk never depends on how deep the page is.
    const stack: DefaultTreeAdapterTypes.ChildNode[] = [...document.childNodes].reverse();
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (!('tagName' in node) || node.namespaceURI !== HTML_NAMESPACE) continue;
        found.push(node);
        for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index] as DefaultTreeAdapterTypes.ChildNode);
    }
    return found;
};

/** An attribute's value, decoded and trimmed; undefined when the element does not have it. A repeated attribute keeps its first value, as in a browser. */
export const attribute = (element: HtmlElement, name: string): string | undefined => element.attrs.find((attr) => attr.name === name)?.value.trim();

export const hasAttribute = (element: HtmlElement, name: string): boolean => element.attrs.some((attr) => attr.name === name);

/** The text of an element, whitespace collapsed. An image speaks through its `alt` (a logo as the H1). */
export const textOf = (element: HtmlElement): string => {
    const parts: string[] = [];
    const stack: DefaultTreeAdapterTypes.ChildNode[] = [...element.childNodes].reverse();
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (node.nodeName === '#text' && 'value' in node) parts.push(node.value);
        else if ('tagName' in node && node.tagName === 'img') parts.push(` ${attribute(node, 'alt') ?? ''} `);
        else if ('tagName' in node && node.namespaceURI === HTML_NAMESPACE)
            for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index] as DefaultTreeAdapterTypes.ChildNode);
    }
    return parts.join('').replace(/\s+/g, ' ').trim();
};

const NOT_READ = new Set(['script', 'style', 'noscript', 'template', 'svg', 'head']);

/** The text a visitor reads in an element: like `textOf`, but a script, style, noscript or template is not content, and an image's `alt` is not counted. */
export const visibleTextOf = (element: HtmlElement): string => {
    const parts: string[] = [];
    const stack: DefaultTreeAdapterTypes.ChildNode[] = [...element.childNodes].reverse();
    for (let node = stack.pop(); node !== undefined; node = stack.pop()) {
        if (node.nodeName === '#text' && 'value' in node) parts.push(node.value);
        else if ('tagName' in node && node.namespaceURI === HTML_NAMESPACE && !NOT_READ.has(node.tagName))
            for (let index = node.childNodes.length - 1; index >= 0; index -= 1) stack.push(node.childNodes[index] as DefaultTreeAdapterTypes.ChildNode);
    }
    return parts.join(' ').replace(/\s+/g, ' ').trim();
};

/** The raw text inside an element (a script's source), not collapsed. */
export const rawTextOf = (element: HtmlElement): string => element.childNodes.map((child) => (child.nodeName === '#text' && 'value' in child ? child.value : '')).join('');
