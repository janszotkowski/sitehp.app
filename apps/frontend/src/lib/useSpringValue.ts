import type { MotionValue } from 'motion';
import { useEffect, useRef, useState } from 'react';
import { springs, type SpringToken } from '@lib/motion';

const prefersReducedMotion = (): boolean => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches;

type SpringValueOptions = {
    /** Start here and spring to `target` once mounted: an entrance. Without it the first render is already at `target`. */
    from?: number;
    /** The spring to use. Defaults to the `ring` spring. */
    spring?: SpringToken;
};

/**
 * A number that springs toward `target` (the `ring` spring of the design language:
 * critically damped, no overshoot). The animation always starts from the value
 * currently on screen and keeps its velocity, so when `target` changes in the middle
 * of a move (a score event arriving while the ring is still filling) it carries on
 * smoothly instead of jumping or restarting. With `prefers-reduced-motion` the value
 * simply changes.
 *
 * The first render equals the server render (`from`, or `target`), so there is no
 * hydration mismatch; the entrance starts in an effect.
 *
 * It must survive React's development double-run of effects (mount, unmount, mount):
 * the motion value is created once and never destroyed, the subscription is dropped on
 * unmount and taken again by the next animation, so the second run finds everything it needs.
 */
export const useSpringValue = (target: number, options: SpringValueOptions = {}): number => {
    const [value, setValue] = useState(options.from ?? target);
    const motion = useRef<MotionValue<number> | null>(null);
    const unsubscribe = useRef<(() => void) | null>(null);

    useEffect(
        () => () => {
            unsubscribe.current?.();
            unsubscribe.current = null;
        },
        [],
    );

    useEffect(() => {
        let stop: (() => void) | undefined;
        let cancelled = false;
        // Loaded on first use: the spring engine stays out of the bundle every page needs before it can paint.
        void import('motion').then(({ animate, motionValue }) => {
            if (cancelled) return;
            motion.current ??= motionValue(options.from ?? target);
            unsubscribe.current ??= motion.current.on('change', setValue);
            if (prefersReducedMotion()) motion.current.set(target);
            else stop = animate(motion.current, target, options.spring ?? springs.ring).stop;
        });
        return () => {
            cancelled = true;
            stop?.();
        };
    }, [target, options.from, options.spring]);

    return value;
};
