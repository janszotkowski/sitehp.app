import { Link, createFileRoute } from '@tanstack/react-router';
import { RuledList } from '@components/RuledList';
import { blogPath, blogPosts } from '@lib/blog';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { m } from '@paraglide/messages.js';

const BlogPage = () => {
    const locale = asLocale(Route.useParams().locale);

    return (
        <main
            id={'main'}
            // A full screen even with few posts, so the footer starts below the fold.
            className={'mx-auto flex min-h-dvh w-full max-w-5xl flex-1 flex-col gap-14 px-4 py-16 sm:py-24'}
        >
            <header className={'flex flex-col gap-4'}>
                <h1 className={'text-display text-fade'}>{m.blog_title({}, { locale })}</h1>
                <p className={'max-w-prose text-callout text-muted-foreground'}>{m.blog_lead({}, { locale })}</p>
            </header>

            <RuledList
                items={blogPosts(locale).map((post) => ({
                    key: post.slug,
                    title: (
                        <Link
                            to={'/$locale/blog/$slug'}
                            params={{ locale, slug: post.slug }}
                            className={'underline-offset-4 hover:underline'}
                        >
                            {post.title}
                        </Link>
                    ),
                    meta: <time dateTime={post.published}>{post.published}</time>,
                    body: post.description,
                }))}
            />
        </main>
    );
};

export const Route = createFileRoute('/$locale/blog/')({
    head: ({ params }) => {
        const locale = asLocale(params.locale);
        return pageHead({
            locale,
            title: m.seo_blog_title({}, { locale }),
            description: m.seo_blog_description({}, { locale }),
            path: blogPath(locale),
            breadcrumbs: [
                { name: m.footer_product({}, { locale }), path: `/${locale}` },
                { name: m.nav_blog({}, { locale }), path: blogPath(locale) },
            ],
            page: { type: 'CollectionPage' },
        });
    },
    component: BlogPage,
});
