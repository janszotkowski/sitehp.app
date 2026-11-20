import type { Technology } from '@sitehp.app/core/browser';
import { Dialog } from '@base-ui/react/dialog';
import { ChevronDown, ChevronUp, X } from 'lucide-react';
import { FindingDetail } from '@components/FindingDetail';
import { StatusPill } from '@components/StatusIcon';
import { Button } from '@components/ui/button';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import type { ReportRow } from '@lib/reportModel';
import { m } from '@paraglide/messages.js';

type FindingModalProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** The check to show. Kept while the modal fades out, so it does not empty before it has gone. */
    row: ReportRow | undefined;
    /** 1-based place of the check among those listed, and how many there are. */
    position: number;
    count: number;
    locale: Locale;
    technologies: readonly Technology[];
    domain: string;
    onPrev: () => void;
    onNext: () => void;
    /** Where the focus goes on close: the row of the check last shown, which after stepping is not the one that opened it. */
    finalFocus: () => HTMLElement | null;
};

/**
 * The detail of one check as a large modal, for a wide screen: the problem on the left, the fix on the right (`FindingDetail`'s two columns),
 * stepped through with the arrow buttons or keys without closing it. Focus, Escape and the scrim come from Base UI's Dialog. Below `lg` the
 * same detail is a bottom sheet (`FindingSheet`), so this is not rendered there.
 */
export const FindingModal = (props: FindingModalProps) => {
    const { locale, row } = props;

    return (
        <Dialog.Root
            open={props.open}
            onOpenChange={props.onOpenChange}
        >
            <Dialog.Portal>
                <Dialog.Backdrop
                    className={'fixed inset-0 z-40 bg-[var(--scrim)] motion-safe:transition-opacity motion-safe:duration-200 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0'}
                />
                <div className={'pointer-events-none fixed inset-0 z-50 grid place-items-center p-6'}>
                    <Dialog.Popup
                        data-report-drawer
                        finalFocus={props.finalFocus}
                        // The dialog stops the arrow keys before the page-wide handler sees them, so the arrows step from here, when pressed on the step buttons (the j and k keys still arrive there).
                        onKeyDown={(event) => {
                            if (event.defaultPrevented || (event.key !== 'ArrowDown' && event.key !== 'ArrowUp')) return;
                            if (!(event.target instanceof Element) || event.target.closest('[data-drawer-nav]') === null) return;
                            event.preventDefault();
                            if (event.key === 'ArrowDown') props.onNext();
                            else props.onPrev();
                        }}
                        className={
                            'bg-background border-(--glass-border) shadow-(--glass-shadow) pointer-events-auto flex max-h-full w-full max-w-5xl flex-col border outline-none motion-safe:transition-[opacity,scale] motion-safe:duration-200 data-[ending-style]:scale-[0.98] data-[ending-style]:opacity-0 data-[starting-style]:scale-[0.98] data-[starting-style]:opacity-0'
                        }
                    >
                        <div
                            data-drawer-nav
                            className={'flex shrink-0 items-center gap-1 border-b px-6 py-3'}
                        >
                            <p className={'text-caption flex-1 tabular-nums text-subtle-foreground'}>{m.report_drawer_position({ position: props.position, count: props.count }, { locale })}</p>
                            <Button
                                variant={'ghost'}
                                size={'icon-sm'}
                                aria-label={m.report_drawer_prev({}, { locale })}
                                onClick={props.onPrev}
                            >
                                <ChevronUp aria-hidden={'true'} />
                            </Button>
                            <Button
                                variant={'ghost'}
                                size={'icon-sm'}
                                aria-label={m.report_drawer_next({}, { locale })}
                                onClick={props.onNext}
                            >
                                <ChevronDown aria-hidden={'true'} />
                            </Button>
                            <Dialog.Close
                                render={
                                    <Button
                                        variant={'ghost'}
                                        size={'icon-sm'}
                                        aria-label={m.report_detail_close({}, { locale })}
                                    />
                                }
                            >
                                <X aria-hidden={'true'} />
                            </Dialog.Close>
                        </div>
                        {row !== undefined && (
                            <div className={'min-h-0 flex-1 overflow-y-auto overscroll-contain px-6 pt-6 pb-8'}>
                                <div className={'mb-6 flex flex-wrap items-center gap-x-4 gap-y-2'}>
                                    <Dialog.Title className={'text-title-1 min-w-0'}>{checkText(row.id, locale).title}</Dialog.Title>
                                    <StatusPill
                                        status={row.status}
                                        locale={locale}
                                    />
                                </div>
                                <FindingDetail
                                    key={row.id}
                                    row={row}
                                    locale={locale}
                                    technologies={props.technologies}
                                    domain={props.domain}
                                    hideTitle
                                />
                            </div>
                        )}
                    </Dialog.Popup>
                </div>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
