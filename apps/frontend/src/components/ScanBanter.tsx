import { useEffect, useState } from 'react';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

const PHRASES = [
    m.report_banter_1,
    m.report_banter_2,
    m.report_banter_3,
    m.report_banter_4,
    m.report_banter_5,
    m.report_banter_6,
    m.report_banter_7,
    m.report_banter_8,
    m.report_banter_9,
    m.report_banter_10,
    m.report_banter_11,
    m.report_banter_12,
    m.report_banter_13,
    m.report_banter_14,
];

const EVERY_MS = 2200;

type ScanBanterProps = { locale: Locale; className?: string };

/**
 * A line of what the scanner is up to, a new phrase every couple of seconds with a light sweeping across it, so a scan that
 * waits on a slow site still looks alive. The phrases are things the scanner really does, not in step with it. Decoration
 * only: hidden from screen readers, which hear the scan start and end from the report's status line.
 */
export const ScanBanter = (props: ScanBanterProps) => {
    // The first phrase is the same on the server and the client; the rotation starts once the page is live.
    const [index, setIndex] = useState(0);
    useEffect(() => {
        const timer = setInterval(() => setIndex((current) => (current + 1) % PHRASES.length), EVERY_MS);
        return () => clearInterval(timer);
    }, []);
    const phrase = PHRASES[index] ?? PHRASES[0];
    return (
        <p
            aria-hidden={'true'}
            className={cn('text-caption min-h-5', props.className)}
        >
            {/* Keyed by the phrase, so each new one plays its entrance. */}
            <span
                key={index}
                className={'scan-banter inline-block'}
            >
                {phrase?.({}, { locale: props.locale })}
            </span>
        </p>
    );
};
