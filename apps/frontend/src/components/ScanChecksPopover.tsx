import { CHECKS } from '@sitehp.app/core/browser';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Suspense, lazy, type ReactNode } from 'react';
import { Button } from '@components/ui/button';
import { Popover, PopoverClose, PopoverContent, PopoverTitle, PopoverTrigger } from '@components/ui/popover';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

// Only fetched when the person opens "Customize scan": the picker names every check, so it stays out of the bundle the page paints with.
// A deploy removes the old chunks: a failed load reloads the page onto the new build instead of failing the whole page.
const ScanChecksPicker = lazy(() =>
    import('@components/ScanChecksPicker').then(
        (module) => ({ default: module.ScanChecksPicker }),
        () => {
            window.location.reload();
            return new Promise<never>(() => undefined);
        },
    ),
);

type ScanChecksPopoverProps = {
    selected: ReadonlySet<string>;
    onChange: (next: Set<string>) => void;
    open: boolean;
    onOpenChange: (open: boolean) => void;
    locale: Locale;
    /** The id of a message about the choice (nothing chosen), read with the trigger. */
    describedBy?: string | undefined;
    /** More actions beside "Done", such as starting the scan with this choice. */
    actions?: ReactNode;
    align?: 'start' | 'end';
    className?: string;
};

/** "Customize scan": the choice of checks floats over the page in a popover, so opening it never pushes the content below it down. */
export const ScanChecksPopover = (props: ScanChecksPopoverProps) => {
    const { locale } = props;
    const all = props.selected.size === CHECKS.length;
    return (
        <Popover
            open={props.open}
            onOpenChange={props.onOpenChange}
        >
            <PopoverTrigger
                aria-describedby={props.describedBy}
                className={cn('text-callout flex min-h-11 items-center gap-2 text-muted-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring', props.className)}
            >
                <SlidersHorizontal
                    aria-hidden={'true'}
                    className={'size-4'}
                />
                {m.scan_customize({}, { locale })}
                <span className={'text-caption text-subtle-foreground'}>
                    {all ? m.scan_customize_summary_all({ total: CHECKS.length }, { locale }) : m.scan_customize_summary_some({ count: props.selected.size, total: CHECKS.length }, { locale })}
                </span>
                <ChevronDown
                    aria-hidden={'true'}
                    className={cn('size-4 transition-transform', props.open && 'rotate-180')}
                />
            </PopoverTrigger>
            <PopoverContent
                align={props.align ?? 'start'}
                // Always under the trigger: flipped above it, the list would cover the address field it belongs to. With little room, the page scrolls to the rest.
                collisionAvoidance={{ side: 'none' }}
                className={'max-h-[min(36rem,max(20rem,var(--available-height)))] w-[40rem]'}
            >
                <PopoverTitle>{m.scan_customize({}, { locale })}</PopoverTitle>
                <div className={'min-h-0 flex-1 overflow-y-auto px-4 py-2'}>
                    <Suspense fallback={null}>
                        <ScanChecksPicker
                            selected={props.selected}
                            onChange={props.onChange}
                            locale={locale}
                        />
                    </Suspense>
                </div>
                <div className={'flex flex-col gap-3 border-t px-4 py-3'}>
                    {!all && <p className={'text-caption text-subtle-foreground'}>{m.scan_customize_note({}, { locale })}</p>}
                    <div className={'flex flex-wrap justify-end gap-2'}>
                        <PopoverClose
                            render={
                                <Button
                                    type={'button'}
                                    variant={'secondary'}
                                />
                            }
                        >
                            {m.scan_customize_done({}, { locale })}
                        </PopoverClose>
                        {props.actions}
                    </div>
                </div>
            </PopoverContent>
        </Popover>
    );
};
