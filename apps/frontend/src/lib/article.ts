import type { MarkdownDocument, MarkdownHeading } from '@tanstack/markdown';
import { collectMarkdownHeadings, headingCollectionExtension } from '@tanstack/markdown/extensions/headings';
import { parseMarkdown } from '@tanstack/markdown/parser';
import { createHighlighter } from '@tanstack/highlight/core';
import { css } from '@tanstack/highlight/languages/css';
import { diff } from '@tanstack/highlight/languages/diff';
import { html } from '@tanstack/highlight/languages/html';
import { http } from '@tanstack/highlight/languages/http';
import { js } from '@tanstack/highlight/languages/js';
import { json } from '@tanstack/highlight/languages/json';
import { nginx } from '@tanstack/highlight/languages/nginx';
import { plaintext } from '@tanstack/highlight/languages/plaintext';
import { shell } from '@tanstack/highlight/languages/shell';
import { ts } from '@tanstack/highlight/languages/ts';
import { tsx } from '@tanstack/highlight/languages/tsx';
import { yaml } from '@tanstack/highlight/languages/yaml';
import { createTanStackMarkdownHighlighter } from '@tanstack/highlight/markdown';

/** Only the languages a text about websites uses; an unknown fence language is shown as plain text. */
export const highlightCode = createTanStackMarkdownHighlighter(createHighlighter({ languages: [plaintext, shell, http, html, css, js, ts, tsx, json, yaml, nginx, diff] }));

export type Article = {
    document: MarkdownDocument;
    /** The outline: every `##` and `###` with the id of its anchor. */
    outline: MarkdownHeading[];
};

/** `## Heading {#anchor}`: a heading that keeps its anchor whatever its text says (and in every language). */
const ANCHOR = /\s*\{#([a-z0-9-]+)\}\s*$/;

/** A Markdown text (blog post, legal page), parsed. The content is ours; raw HTML is shown as text all the same. */
export const parseArticle = (source: string): Article => {
    // The extension gives every heading an id from its text; an explicit anchor then replaces it.
    const document = parseMarkdown(source, { extensions: [headingCollectionExtension()] });
    for (const node of document.children) {
        if (node.type !== 'heading') continue;
        const last = node.children.at(-1);
        if (last?.type !== 'text') continue;
        const anchor = ANCHOR.exec(last.value);
        const id = anchor?.[1];
        if (anchor === null || id === undefined) continue;
        last.value = last.value.slice(0, anchor.index);
        node.id = id;
    }
    const outline = collectMarkdownHeadings(document).filter((heading) => heading.level === 2 || heading.level === 3);
    return { document, outline };
};
