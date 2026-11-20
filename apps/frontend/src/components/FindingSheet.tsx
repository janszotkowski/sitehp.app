import type { Technology } from '@sitehp.app/core/browser';
import { Dialog } from '@base-ui/react/dialog';
import { animate, motionValue } from 'motion';
import { ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useEffect, useRef, useState, type PointerEvent } from 'react';
import { FindingDetail } from '@components/FindingDetail';
import { StatusPill } from '@components/StatusIcon';
import { Button } from '@components/ui/button';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { projectMomentum, rubberband, springs } from '@lib/motion';
import type { ReportRow } from '@lib/reportModel';
import { m } from '@paraglide/messages.js';

/** Past this projected distance (px) a released sheet closes instead of springing back. */
const CLOSE_PROJECTION_PX = 140;
const VELOCITY_WINDOW = 5;
/** Samples older than this at release do not count: a finger that stopped before lifting has no velocity. */
const VELOCITY_MAX_AGE_MS = 100;

type Sample = { y: number; t: number };
type DragState = { offset: number; samples: Sample[] };

type FindingSheetProps = {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    row: ReportRow | undefined;
    locale: Locale;
    technologies: readonly Technology[];
    domain: string;
    /** 1-based place of the check among those listed, and how many there are. */
    position: number;
    count: number;
    onPrev: () => void;
    onNext: () => void;
    /** Where the focus goes on close: the row of the check last shown, which after stepping is not the one that opened it. */
    finalFocus: () => HTMLElement | null;
};

const prefersReducedMotion = (): boolean => window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/**
 * The detail of one check as a bottom sheet, for phones. It follows the finger 1:1 from the handle, rubber-bands
 * when pulled up, and on release projects the flick's momentum to decide between closing and springing back,
 * handing the release velocity to the spring. Focus, Escape and the scrim come from Base UI's Dialog.
 */
export const FindingSheet = (props: FindingSheetProps) => {
    const popup = useRef<HTMLDivElement>(null);
    const drag = useRef<DragState | null>(null);
    const [y] = useState(() => motionValue(0));

    useEffect(
        () =>
            y.on('change', (value) => {
                if (popup.current !== null) popup.current.style.transform = value === 0 ? '' : `translateY(${value}px)`;
            }),
        [y],
    );

    useEffect(() => {
        if (props.open) y.set(0);
    }, [props.open, y]);

    const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
        event.currentTarget.setPointerCapture(event.pointerId);
        y.stop();
        // A running transition would lag behind the finger.
        if (popup.current !== null) popup.current.style.transition = 'none';
        // Respect where the sheet was grabbed: the offset between the finger and the sheet's current position.
        drag.current = { offset: event.clientY - y.get(), samples: [{ y: event.clientY, t: event.timeStamp }] };
    };

    const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
        const state = drag.current;
        if (state === null) return;
        const raw = event.clientY - state.offset;
        y.set(raw < 0 ? -rubberband(-raw, 300) : raw);
        state.samples = [...state.samples, { y: event.clientY, t: event.timeStamp }].slice(-VELOCITY_WINDOW);
    };

    const release = () => {
        const state = drag.current;
        drag.current = null;
        if (state === null) return;
        if (popup.current !== null) popup.current.style.transition = '';

        // `event.timeStamp` and `performance.now()` share the same time origin.
        const now = performance.now();
        const recent = state.samples.filter((sample) => now - sample.t <= VELOCITY_MAX_AGE_MS);
        const first = recent[0];
        const last = recent.at(-1);
        const elapsed = first === undefined || last === undefined ? 0 : last.t - first.t;
        const velocity = first === undefined || last === undefined || elapsed <= 0 ? 0 : ((last.y - first.y) / elapsed) * 1000;
        const closing = y.get() + projectMomentum(velocity) > CLOSE_PROJECTION_PX;

        if (prefersReducedMotion()) {
            if (closing) props.onOpenChange(false);
            else y.set(0);
            return;
        }
        const target = closing ? (popup.current?.offsetHeight ?? 600) : 0;
        // The flick carried momentum, so the spring may bounce a little (`sheet`); the finger's velocity is its starting speed.
        animate(y, target, { ...springs.sheet, velocity }).then(() => {
            if (closing) props.onOpenChange(false);
        });
    };

    const row = props.row;

    return (
        <Dialog.Root
            open={props.open}
            onOpenChange={props.onOpenChange}
        >
            <Dialog.Portal>
                <Dialog.Backdrop
                    className={'fixed inset-0 z-40 bg-[var(--scrim)] motion-safe:transition-opacity motion-safe:duration-300 data-[ending-style]:opacity-0 data-[starting-style]:opacity-0'}
                />
                <Dialog.Popup
                    ref={popup}
                    finalFocus={props.finalFocus}
                    className={
                        'bg-background border-t border-(--glass-border) shadow-(--glass-shadow) fixed inset-x-0 bottom-0 z-50 flex max-h-[88dvh] flex-col pb-[env(safe-area-inset-bottom)] outline-none motion-safe:transition-transform motion-safe:duration-300 data-[ending-style]:translate-y-full data-[starting-style]:translate-y-full'
                    }
                >
                    <div
                        onPointerDown={onPointerDown}
                        onPointerMove={onPointerMove}
                        onPointerUp={release}
                        onPointerCancel={release}
                        className={'flex shrink-0 touch-none justify-center pt-3 pb-2'}
                    >
                        <span className={'h-1 w-9 rounded-4xl bg-foreground/20'} />
                    </div>
                    {row !== undefined && (
                        <>
                            <div className={'flex shrink-0 items-start gap-3 px-5 pb-3'}>
                                <div className={'flex min-w-0 flex-1 flex-col items-start gap-2'}>
                                    <p className={'text-caption tabular-nums text-subtle-foreground'}>
                                        {m.report_drawer_position({ position: props.position, count: props.count }, { locale: props.locale })}
                                    </p>
                                    <Dialog.Title className={'text-title-2'}>{checkText(row.id, props.locale).title}</Dialog.Title>
                                    <StatusPill
                                        status={row.status}
                                        locale={props.locale}
                                    />
                                </div>
                                <Button
                                    variant={'ghost'}
                                    size={'icon-sm'}
                                    aria-label={m.report_drawer_prev({}, { locale: props.locale })}
                                    onClick={props.onPrev}
                                >
                                    <ChevronLeft aria-hidden={'true'} />
                                </Button>
                                <Button
                                    variant={'ghost'}
                                    size={'icon-sm'}
                                    aria-label={m.report_drawer_next({}, { locale: props.locale })}
                                    onClick={props.onNext}
                                >
                                    <ChevronRight aria-hidden={'true'} />
                                </Button>
                                <Dialog.Close
                                    render={
                                        <Button
                                            variant={'ghost'}
                                            size={'icon-sm'}
                                            aria-label={m.report_detail_close({}, { locale: props.locale })}
                                        />
                                    }
                                >
                                    <X aria-hidden={'true'} />
                                </Dialog.Close>
                            </div>
                            <div className={'overflow-y-auto overscroll-contain px-5 pb-6'}>
                                <FindingDetail
                                    row={row}
                                    locale={props.locale}
                                    technologies={props.technologies}
                                    domain={props.domain}
                                    hideTitle
                                />
                            </div>
                        </>
                    )}
                </Dialog.Popup>
            </Dialog.Portal>
        </Dialog.Root>
    );
};
