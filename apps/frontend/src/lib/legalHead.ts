import { legalDocument, legalPath, type LegalPageId } from '@lib/legal';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { pageHead } from '@lib/pageHead';
import { m } from '@paraglide/messages.js';

/** The head of a legal page: its own title and description, indexable, with a breadcrumb under the product. */
export const legalHead = (id: LegalPageId, localeParam: string) => {
    const locale = asLocale(localeParam);
    const document = legalDocument(locale, id);
    return pageHead({
        locale,
        title: document.title,
        description: document.description,
        path: legalPath(locale, id),
        breadcrumbs: [
            { name: m.footer_product({}, { locale }), path: `/${locale}` },
            { name: document.title, path: legalPath(locale, id) },
        ],
        page: { type: 'WebPage', dateModified: document.updated },
    });
};
