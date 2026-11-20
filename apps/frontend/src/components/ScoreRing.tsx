import { useState, type CSSProperties } from 'react';
import { springs } from '@lib/motion';
import { scoreColorStyle } from '@lib/scoreStyle';
import { useHydrated } from '@lib/useHydrated';
import { useSpringValue } from '@lib/useSpringValue';
import { cn } from '@lib/utils';

type ScoreRingProps = {
    /** `null` while no check has finished yet: an empty neutral ring. */
    score: number | null;
    label: string;
    className?: string;
    /** Gives the ring a `view-transition-name`, so it can morph between two pages. */
    transitionName?: string;
    /** Fill the ring from empty when it appears in a live page (an entrance). Server-rendered, it shows its score at once. Otherwise it starts at its score and only animates changes. */
    animateIn?: boolean;
    /** A scan is running: a halo breathes behind the ring, and until the first score a short arc runs round the track. Decoration only. */
    busy?: boolean;
};

const RADIUS = 90;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/** Length of the colored arc for a score on a 0–100 scale. */
export const arcLength = (value: number): number => (CIRCUMFERENCE * Math.min(100, Math.max(0, value))) / 100;

/**
 * The HP score: the numeral inside a ring, both in the score's state color.
 * The numeral is sized in container units, so it always fits inside the ring (three digits get a smaller size than two), keeping the weight, leading and tracking of the score role. The arc and the color follow the score as it changes. The real spring and the
 * counting numeral arrive with Motion; until then a short eased transition does it,
 * and `prefers-reduced-motion` turns it into a plain value change.
 */
export const ScoreRing = (props: ScoreRingProps) => {
    const known = props.score !== null;
    const target = props.score === null ? 0 : Math.min(100, Math.max(0, props.score));
    // Decided once, at mount: in the server HTML (and so while hydrating) the ring shows its real score, never a red 0 that
    // crawlers and visitors without scripts would keep; only a ring mounted in an already live page fills from empty.
    const hydrated = useHydrated();
    const [entrance] = useState(props.animateIn === true && hydrated);
    // The arc, the numeral and the color all follow the same spring, so they stay in step while it moves.
    const shown = useSpringValue(target, entrance ? { from: 0, spring: springs.entrance } : {});
    const clamped = Math.min(100, Math.max(0, shown));
    const rounded = Math.round(clamped);
    const style: CSSProperties = {
        ...scoreColorStyle(props.score === null ? null : clamped),
        ...(props.transitionName === undefined ? {} : { viewTransitionName: props.transitionName }),
    };

    return (
        <div
            role={'img'}
            aria-label={props.label}
            style={style}
            className={cn('score-themed relative isolate grid aspect-square place-items-center [container-type:inline-size]', props.className)}
        >
            {props.busy === true && (
                <span
                    aria-hidden={'true'}
                    className={'scan-halo'}
                />
            )}
            <svg
                viewBox={'0 0 200 200'}
                aria-hidden={'true'}
                className={'absolute inset-0 size-full -rotate-90'}
            >
                <circle
                    cx={100}
                    cy={100}
                    r={RADIUS}
                    fill={'none'}
                    strokeWidth={14}
                    className={'stroke-secondary'}
                />
                <circle
                    cx={100}
                    cy={100}
                    r={RADIUS}
                    fill={'none'}
                    strokeWidth={14}
                    strokeLinecap={'round'}
                    strokeDasharray={`${arcLength(clamped)} ${CIRCUMFERENCE}`}
                    className={
                        // A round line cap draws a dot even for a zero-length arc: hide the arc until it has some length.
                        cn('stroke-hp', (!known || clamped < 0.5) && 'opacity-0')
                    }
                />
                {props.busy === true && !known && (
                    <circle
                        cx={100}
                        cy={100}
                        r={RADIUS}
                        fill={'none'}
                        strokeWidth={14}
                        strokeLinecap={'round'}
                        strokeDasharray={`${CIRCUMFERENCE * 0.18} ${CIRCUMFERENCE}`}
                        className={'scan-orbit stroke-muted-foreground'}
                    />
                )}
            </svg>
            <span
                aria-hidden={'true'}
                className={cn('font-semibold leading-[0.95] tracking-[-0.04em] tabular-nums', rounded >= 100 ? 'text-[27cqw]' : 'text-[36cqw]', !known && 'text-subtle-foreground')}
            >
                {known ? rounded : '–'}
            </span>
        </div>
    );
};
