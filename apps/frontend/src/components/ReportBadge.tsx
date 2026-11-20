import { useState } from 'react';
import { CopyButton } from '@components/CopyButton';
import { SegmentedControl } from '@components/SegmentedControl';
import { SITE_ORIGIN } from '@config/site';
import { badgePathOf, badgeSnippets, type BadgeTheme } from '@lib/badge';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { useHydrated } from '@lib/useHydrated';
import { m } from '@paraglide/messages.js';

type ReportBadgeProps = { publicId: string; score: number; locale: Locale };

/** "Add a badge": a preview of the badge and the Markdown and HTML that put it on a page. Shown only for a finished report with a score. */
export const ReportBadge = (props: ReportBadgeProps) => {
    const { locale } = props;
    const [theme, setTheme] = useState<BadgeTheme>('dark');
    // The address the visitor is on, so a snippet copied from a dev or staging build points at that build; the canonical one before the page is live.
    const hydrated = useHydrated();
    const origin = hydrated ? window.location.origin : SITE_ORIGIN;
    const snippets = badgeSnippets({ origin, locale, publicId: props.publicId, score: props.score, theme });
    const rows = [
        { label: m.report_badge_markdown({}, { locale }), text: snippets.markdown },
        { label: m.report_badge_html({}, { locale }), text: snippets.html },
    ];

    return (
        <section
            aria-labelledby={'report-badge-title'}
            className={'flex flex-col gap-6 border-t pt-8'}
        >
            <div className={'flex flex-col gap-1'}>
                <h2
                    id={'report-badge-title'}
                    className={'text-title-2'}
                >
                    {m.report_badge_title({}, { locale })}
                </h2>
                <p className={'text-callout max-w-prose text-muted-foreground'}>{m.report_badge_intro({}, { locale })}</p>
            </div>
            <div className={'flex flex-wrap items-center gap-4'}>
                <SegmentedControl
                    label={m.report_badge_style({}, { locale })}
                    value={theme}
                    onChange={setTheme}
                    options={[
                        { value: 'dark', label: m.report_badge_dark({}, { locale }) },
                        { value: 'light', label: m.report_badge_light({}, { locale }) },
                    ]}
                />
                {/* Each badge on the surface it is made for, so both can be seen whatever the page's own theme. */}
                <div className={theme === 'light' ? 'grid min-h-14 place-items-center border bg-white px-4' : 'grid min-h-14 place-items-center border bg-[#0E0E11] px-4'}>
                    <img
                        src={`${badgePathOf(props.publicId)}${theme === 'light' ? '?theme=light' : ''}`}
                        alt={m.report_badge_preview_alt({ score: props.score }, { locale })}
                        height={32}
                        className={'h-8 w-auto'}
                    />
                </div>
            </div>
            <dl className={'flex flex-col gap-3'}>
                {rows.map((row) => (
                    <div
                        key={row.label}
                        className={'flex flex-col gap-1'}
                    >
                        <div className={'flex items-center justify-between gap-2'}>
                            <dt className={'text-caption font-medium'}>{row.label}</dt>
                            <dd>
                                <CopyButton
                                    getText={() => row.text}
                                    label={m.report_badge_copy({ format: row.label }, { locale })}
                                    locale={locale}
                                    className={'-mr-3'}
                                />
                            </dd>
                        </div>
                        <code className={'text-code border-y bg-muted/50 px-3 py-3 font-mono break-all select-all'}>{row.text}</code>
                    </div>
                ))}
            </dl>
        </section>
    );
};
