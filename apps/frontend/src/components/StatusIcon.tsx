import { Check, LoaderCircle, Minus, TriangleAlert, X } from 'lucide-react';
import type { Locale } from '@lib/i18n/switchLocalePath';
import type { RowStatus } from '@lib/reportModel';
import { statusLabel } from '@lib/statusLabel';
import { cn } from '@lib/utils';

/** The pill washes are 8 % of the state color: stronger and the colored text falls under 4.5 : 1 in the light theme (`tests/design/contrast.test.ts` keeps this honest). Every state pairs a color with an icon and a text label elsewhere: color is never the only signal. A check that could not run is neutral gray, never red. */
const STATUS_STYLE = {
    pass: { icon: Check, tone: 'text-score-good', wash: 'bg-score-good/8' },
    warn: { icon: TriangleAlert, tone: 'text-score-fair', wash: 'bg-score-fair/8' },
    fail: { icon: X, tone: 'text-score-critical', wash: 'bg-score-critical/8' },
    skipped: { icon: Minus, tone: 'text-subtle-foreground', wash: 'bg-muted' },
    running: { icon: LoaderCircle, tone: 'text-subtle-foreground', wash: 'bg-muted' },
} as const satisfies Record<RowStatus, unknown>;

type StatusIconProps = { status: RowStatus; className?: string };

export const StatusIcon = (props: StatusIconProps) => {
    const style = STATUS_STYLE[props.status];
    const Icon = style.icon;
    return (
        <Icon
            aria-hidden={'true'}
            className={cn('size-5 shrink-0', style.tone, props.status === 'running' && 'animate-spin', props.className)}
        />
    );
};

/** The status as a pill: color, and always the word as well. Kept here, not with the finding detail, so the home page's sample takes it without the report's code. */
type StatusPillProps = { status: RowStatus; locale: Locale; className?: string };

export const StatusPill = (props: StatusPillProps) => (
    <span className={cn('text-caption inline-flex items-center rounded-4xl px-2.5 py-1 whitespace-nowrap', STATUS_STYLE[props.status].wash, STATUS_STYLE[props.status].tone, props.className)}>
        {statusLabel(props.status, props.locale)}
    </span>
);
