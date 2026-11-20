import { createFileRoute } from '@tanstack/react-router';
import { LegalPage } from '@components/LegalPage';
import { asLocale } from '@lib/i18n/switchLocalePath';
import { legalDocument } from '@lib/legal';
import { legalHead } from '@lib/legalHead';
import { m } from '@paraglide/messages.js';

const Page = () => {
    const locale = asLocale(Route.useParams().locale);
    return (
        <LegalPage
            document={legalDocument(locale, 'accessibility')}
            updatedLabel={m.legal_updated({}, { locale })}
            outlineLabel={m.blog_outline({}, { locale })}
        />
    );
};

export const Route = createFileRoute('/$locale/accessibility')({
    head: ({ params }) => legalHead('accessibility', params.locale),
    component: Page,
});
