import { ArticleBody, ArticleOutline } from '@components/Article';
import type { LegalDocument } from '@lib/legal';

type LegalPageProps = { document: LegalDocument; updatedLabel: string; outlineLabel: string };

/**
 * A legal or policy page (privacy, terms, cookies, accessibility, website owners): the title, the date of the last change,
 * then the text and its outline laid out like a blog post. One component for all of them, drawn from `lib/legal.ts`.
 */
export const LegalPage = (props: LegalPageProps) => (
    <main
        id={'main'}
        className={'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 py-16 sm:py-24'}
    >
        <header className={'flex flex-col gap-4'}>
            <h1 className={'text-display text-fade'}>{props.document.title}</h1>
            <p className={'max-w-prose text-callout text-muted-foreground'}>{props.document.description}</p>
            <p className={'text-caption tabular-nums text-subtle-foreground'}>
                {props.updatedLabel} <time dateTime={props.document.updated}>{props.document.updated}</time>
            </p>
        </header>
        <div className={'grid gap-10 border-t pt-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16'}>
            {props.document.outline.length > 1 && (
                <ArticleOutline
                    headings={props.document.outline}
                    label={props.outlineLabel}
                    className={'lg:sticky lg:top-[calc(var(--site-header-height)+2rem)] lg:order-last lg:max-h-[calc(100dvh-var(--site-header-height)-4rem)] lg:self-start lg:overflow-y-auto'}
                />
            )}
            <ArticleBody document={props.document.document} />
        </div>
    </main>
);
