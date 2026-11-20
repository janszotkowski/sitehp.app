import { Tooltip } from '@base-ui/react/tooltip';
import { ALWAYS_CHECKED, CHECKS } from '@sitehp.app/core/browser';
import { useNavigate } from '@tanstack/react-router';
import { RotateCw } from 'lucide-react';
import { useRef, useState } from 'react';
import { ScanChecksPopover } from '@components/ScanChecksPopover';
import { Button } from '@components/ui/button';
import { createApi } from '@lib/api';
import { failureCodeOf, failureMessage } from '@lib/apiErrors';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { rememberSnapshot } from '@lib/scanCache';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

type ScanAgainProps = { url: string; locale: Locale; className?: string; /** The checks of the report that is scanned again, when it was a customized scan. */ checks?: readonly string[] | undefined };

/** The stored address had its query values hidden (`?token=…`): it is not the address that was scanned, so it cannot be scanned again from here. */
export const canScanAgain = (url: string): boolean => !url.includes('=…');

/** The stored choice with checks that no longer exist dropped (the server refuses them); nothing left to choose, or every check, is a full scan. */
export const checksToScanAgain = (checks: Iterable<string> | undefined): string[] | undefined => {
    const known = [...(checks ?? [])].filter((id) => CHECKS.some((check) => check.id === id));
    return known.some((id) => !ALWAYS_CHECKED.includes(id)) && known.length < CHECKS.length ? known : undefined;
};

/** The choice a report starts its "Customize scan" with: the checks it ran, or every check after a full scan. */
const initialChoice = (checks: readonly string[] | undefined): Set<string> => new Set(checksToScanAgain(checks) ?? CHECKS.map((check) => check.id));

/**
 * Starts a new scan of the same address, with the report's choice of checks or a new one picked in "Customize scan", past the few minutes in which the same address is answered with the scan already made:
 * the button for "I fixed it, check again". An icon with a tooltip; its name for assistive technology is the same text.
 * It counts against the rate limit like any scan.
 */
export const ScanAgain = (props: ScanAgainProps) => {
    const { locale } = props;
    const navigate = useNavigate();
    const busy = useRef(false);
    const [pending, setPending] = useState(false);
    const [error, setError] = useState<string | undefined>(undefined);
    const label = m.report_scan_again({}, { locale });
    const [selected, setSelected] = useState(() => initialChoice(props.checks));
    const [customizing, setCustomizing] = useState(false);

    const start = async () => {
        if (busy.current) return;
        // A choice with nothing in it but the check that always runs would scan for nothing.
        if (![...selected].some((id) => !ALWAYS_CHECKED.includes(id))) {
            setError(m.scan_customize_none({}, { locale }));
            setCustomizing(true);
            return;
        }
        setCustomizing(false);
        busy.current = true;
        setPending(true);
        setError(undefined);
        try {
            const checks = checksToScanAgain(selected);
            const { publicId, snapshot } = await createApi().createScan(props.url, { fresh: true, ...(checks === undefined ? {} : { checks }) });
            rememberSnapshot(snapshot);
            await navigate({ to: '/$locale/r/$publicId', params: { locale, publicId }, viewTransition: true });
        } catch (failure) {
            setError(failureMessage(failureCodeOf(failure), locale));
            busy.current = false;
            setPending(false);
        }
    };

    return (
        <div className={cn('flex flex-col items-center gap-1 md:items-end', props.className)}>
            <div className={'flex items-center gap-3'}>
                <ScanChecksPopover
                    selected={selected}
                    onChange={(next) => {
                        setSelected(next);
                        setError(undefined);
                    }}
                    open={customizing}
                    onOpenChange={setCustomizing}
                    describedBy={error === undefined ? undefined : 'scan-again-error'}
                    align={'end'}
                    locale={locale}
                    actions={
                        <Button
                            type={'button'}
                            disabled={pending}
                            onClick={() => void start()}
                        >
                            {label}
                        </Button>
                    }
                />
                <Tooltip.Root>
                    <Tooltip.Trigger
                        render={
                            <Button
                                type={'button'}
                                variant={'secondary'}
                                size={'icon-lg'}
                                aria-label={label}
                                // Focusable while disabled (`aria-disabled`), so the focus stays on the button while the scan starts.
                                disabled={pending}
                                focusableWhenDisabled
                                className={'rounded-full aria-disabled:opacity-50'}
                                onClick={() => void start()}
                            />
                        }
                    >
                        <RotateCw
                            aria-hidden={'true'}
                            className={cn('size-5', pending && 'motion-safe:animate-spin')}
                        />
                    </Tooltip.Trigger>
                    <Tooltip.Portal>
                        <Tooltip.Positioner
                            side={'bottom'}
                            sideOffset={8}
                            className={'z-50'}
                        >
                            <Tooltip.Popup className={'text-caption rounded-md border bg-popover px-2.5 py-1.5 text-popover-foreground shadow-lg'}>{label}</Tooltip.Popup>
                        </Tooltip.Positioner>
                    </Tooltip.Portal>
                </Tooltip.Root>
            </div>
            <p
                id={'scan-again-error'}
                role={'alert'}
                className={'text-caption max-w-56 text-center text-destructive md:text-right'}
            >
                {error}
            </p>
        </div>
    );
};
