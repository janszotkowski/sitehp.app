import { Link, createFileRoute, notFound } from '@tanstack/react-router';
import { useMemo } from 'react';
import { ArticleBody, ArticleOutline } from '@components/Article';
import { blogAlternates, blogPath, blogPost, blogPosts } from '@lib/blog';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { blogPostingNode } from '@lib/seoSchema';
import { m } from '@paraglide/messages.js';

const BlogPostPage = () => {
    const { locale: rawLocale, slug } = Route.useParams();
    const locale = asLocale(rawLocale);
    // The loader has made sure the post exists; it is parsed here, not shipped in the page's data.
    const post = useMemo(() => blogPost(locale, slug), [locale, slug]);
    if (post === undefined) return null;
    const hasOutline = post.outline.length > 1;

    return (
        <main
            id={'main'}
            className={'mx-auto flex w-full max-w-5xl flex-1 flex-col gap-14 px-4 py-16 sm:py-24'}
        >
            <header className={'flex flex-col gap-4'}>
                <Link
                    to={'/$locale/blog'}
                    params={{ locale }}
                    className={'inline-flex min-h-11 items-center self-start text-callout text-link underline-offset-4 hover:underline'}
                >
                    {m.blog_all_posts({}, { locale })}
                </Link>
                <h1 className={'text-display text-fade'}>{post.title}</h1>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{post.description}</p>
                <p className={'text-caption tabular-nums text-subtle-foreground'}>
                    {m.blog_published({}, { locale })} <time dateTime={post.published}>{post.published}</time>
                    {post.updated !== undefined && (
                        <>
                            {' · '}
                            {m.blog_updated({}, { locale })} <time dateTime={post.updated}>{post.updated}</time>
                        </>
                    )}
                </p>
            </header>

            <div className={'grid gap-10 border-t pt-10 lg:grid-cols-[minmax(0,1fr)_15rem] lg:gap-16'}>
                {hasOutline && (
                    <ArticleOutline
                        headings={post.outline}
                        label={m.blog_outline({}, { locale })}
                        className={'lg:sticky lg:top-[calc(var(--site-header-height)+2rem)] lg:order-last lg:max-h-[calc(100dvh-var(--site-header-height)-4rem)] lg:self-start lg:overflow-y-auto'}
                    />
                )}
                <ArticleBody document={post.document} />
            </div>
        </main>
    );
};

export const Route = createFileRoute('/$locale/blog/$slug')({
    loader: ({ params }) => {
        if (!blogPosts(asLocale(params.locale)).some((post) => post.slug === params.slug)) throw notFound();
    },
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        const post = blogPosts(locale).find((item) => item.slug === params.slug);
        if (post === undefined) return {};
        const path = blogPath(locale, post.slug);
        return pageHead({
            locale,
            title: post.title,
            description: post.description,
            path,
            ogType: 'article',
            alternates: blogAlternates(post),
            breadcrumbs: [
                { name: m.footer_product({}, { locale }), path: `/${locale}` },
                { name: m.nav_blog({}, { locale }), path: blogPath(locale) },
                { name: post.title, path },
            ],
            nodes: [blogPostingNode({ headline: post.title, description: post.description, path, locale, published: post.published, updated: post.updated })],
            page: { dateModified: post.updated ?? post.published },
        });
    },
    component: BlogPostPage,
});
