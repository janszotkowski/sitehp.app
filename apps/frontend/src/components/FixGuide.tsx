import type { Technology } from '@sitehp.app/core/browser';
import { useState, type KeyboardEvent } from 'react';
import { CopyButton } from '@components/CopyButton';
import { guideTabs } from '@lib/fixGuides';
import { findingAsMarkdown } from '@lib/reportMarkdown';
import type { ReportRow } from '@lib/reportModel';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { technologyNames } from '@lib/technologyNames';
import { m } from '@paraglide/messages.js';

type FixGuideProps = {
    row: ReportRow;
    domain: string;
    /** What the scan recognised on the site: the first of these that has a guide is open at first. */
    technologies: readonly Technology[];
    locale: Locale;
};

/** "How to fix it": a tab per platform that has a guide, the detected one first, and the guide for any site. Nothing when the check has no guide. */
export const FixGuide = (props: FixGuideProps) => {
    const { row, technologies, locale } = props;
    const checkId = row.id;
    const tabs = guideTabs(checkId, technologies, locale);
    const [selected, setSelected] = useState(tabs[0]?.id);
    const current = tabs.find((tab) => tab.id === selected) ?? tabs[0];

    const move = (event: KeyboardEvent, index: number) => {
        const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
        if (step === 0) return;
        event.preventDefault();
        const next = tabs[(index + step + tabs.length) % tabs.length];
        if (next !== undefined) {
            setSelected(next.id);
            document.getElementById(`guide-${checkId}-${next.id}`)?.focus();
        }
    };

    return (
        <section className={'flex flex-col gap-3'}>
            <div className={'flex items-center justify-between gap-3'}>
                <h3 className={'text-overline uppercase text-subtle-foreground'}>{m.guide_title({}, { locale })}</h3>
                <CopyButton
                    // The Markdown is for a coding agent and stays English, so it takes the English guide of the open tab.
                    getText={() =>
                        findingAsMarkdown(
                            props.domain,
                            row,
                            locale,
                            guideTabs(checkId, technologies, 'en').find((tab) => tab.id === current?.id),
                        )
                    }
                    label={m.guide_copy_agent({}, { locale })}
                    locale={locale}
                    variant={'default'}
                />
            </div>
            {current === undefined && <p className={'text-callout max-w-prose text-muted-foreground'}>{m.guide_none({}, { locale })}</p>}
            {tabs.length > 1 && (
                <div
                    role={'tablist'}
                    aria-label={m.guide_title({}, { locale })}
                    className={'flex flex-wrap gap-x-4 gap-y-1 border-b'}
                >
                    {tabs.map((tab, index) => (
                        <button
                            key={tab.id}
                            id={`guide-${checkId}-${tab.id}`}
                            type={'button'}
                            role={'tab'}
                            aria-selected={tab.id === current?.id}
                            aria-controls={`guide-panel-${checkId}`}
                            tabIndex={tab.id === current?.id ? 0 : -1}
                            onClick={() => setSelected(tab.id)}
                            onKeyDown={(event) => move(event, index)}
                            className={`text-callout min-h-11 border-b-2 px-1 ${tab.id === current?.id ? 'border-foreground font-medium' : 'border-transparent text-muted-foreground hover:text-foreground'}`}
                        >
                            {tab.id === 'generic' ? m.guide_generic({}, { locale }) : technologyNames[tab.id]}
                        </button>
                    ))}
                </div>
            )}
            {current !== undefined && (
                <div
                    id={`guide-panel-${checkId}`}
                    role={tabs.length > 1 ? 'tabpanel' : undefined}
                    aria-labelledby={tabs.length > 1 ? `guide-${checkId}-${current?.id}` : undefined}
                    className={'flex flex-col gap-3'}
                >
                    <ol className={'text-callout flex max-w-prose list-decimal flex-col gap-1.5 pl-5 text-muted-foreground'}>
                        {current.guide.steps.map((step) => (
                            <li key={step}>{step}</li>
                        ))}
                    </ol>
                    {current.guide.snippet !== undefined && (
                        <div className={'flex flex-col border'}>
                            <div className={'flex items-center justify-between border-b px-3'}>
                                <span className={'text-caption font-mono text-subtle-foreground'}>{current.guide.snippet.language}</span>
                                <CopyButton
                                    getText={() => current.guide.snippet?.code ?? ''}
                                    locale={locale}
                                    className={'-mr-3'}
                                />
                            </div>
                            <pre className={'text-caption overflow-x-auto p-3'}>
                                <code>{current.guide.snippet.code}</code>
                            </pre>
                        </div>
                    )}
                    {current.guide.risk !== undefined && (
                        <p className={'text-callout max-w-prose border-l-2 border-foreground/40 pl-3'}>
                            <span className={'font-medium'}>{m.guide_risk({}, { locale })} </span>
                            {current.guide.risk}
                        </p>
                    )}
                </div>
            )}
        </section>
    );
};
