import type { MarkdownDocument, MarkdownHeading } from '@tanstack/markdown';
import { Markdown, type MarkdownComponentProps } from '@tanstack/markdown/react';
import { Link } from '@tanstack/react-router';
import { highlightCode } from '@lib/article';
import { cn } from '@lib/utils';

type ArticleBodyProps = { document: MarkdownDocument };

type ArticleOutlineProps = { headings: readonly MarkdownHeading[]; label: string; className?: string };

/** A page of the site moves in place; an anchor, a file (`/llms.txt`), an email or another site is a plain link. */
const ArticleLink = (props: MarkdownComponentProps<'a'>) => {
    const { href = '', children, ...rest } = props;
    // Markdown gives a link only its address and title.
    if (href.startsWith('/') && !href.includes('.')) return <Link to={href}>{children}</Link>;
    return (
        <a
            href={href}
            {...rest}
        >
            {children}
        </a>
    );
};

const COMPONENTS = { a: ArticleLink };

/** The Markdown of a blog post or a legal page, styled by `.article-prose` (app.css); code is highlighted on render, server and client alike. */
export const ArticleBody = (props: ArticleBodyProps) => (
    <div className={'article-prose max-w-prose'}>
        <Markdown
            components={COMPONENTS}
            highlighter={highlightCode}
        >
            {props.document}
        </Markdown>
    </div>
);

/** "On this page": every `##` and `###` of the text as a link to its heading. Sticky beside the text on a wide screen. */
export const ArticleOutline = (props: ArticleOutlineProps) => (
    <nav
        aria-label={props.label}
        className={cn('flex flex-col gap-3', props.className)}
    >
        <p className={'text-overline uppercase text-subtle-foreground'}>{props.label}</p>
        <ol className={'flex flex-col border-l'}>
            {props.headings.map((heading) => (
                <li key={heading.id}>
                    <a
                        href={`#${heading.id}`}
                        className={cn(
                            '-ml-px flex min-h-9 items-center border-l border-transparent py-1 pr-2 text-callout text-muted-foreground outline-none hover:border-foreground hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring',
                            heading.level === 3 ? 'pl-7' : 'pl-4',
                        )}
                    >
                        {heading.text}
                    </a>
                </li>
            ))}
        </ol>
    </nav>
);
