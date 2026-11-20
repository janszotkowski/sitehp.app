/**
 * Spring tokens of the design language (docs/DESIGN.md, section 7).
 *
 * Apple thinks in damping ratio and response; Motion's `bounce` + `duration`
 * API maps closely: damping 1.0 = `bounce: 0`, damping 0.8 = `bounce: 0.2`,
 * response = `duration`. Springs are critically damped by default; bounce is
 * reserved for motion that carries momentum (a flick, a throw).
 */
export type SpringToken = {
    readonly type: 'spring';
    readonly bounce: number;
    readonly duration: number;
};

export const springs = {
    /** Most UI: expansions, reorders, rows appearing. */
    default: { type: 'spring', bounce: 0, duration: 0.35 },
    /** Press feedback, toggles, small state changes. */
    quick: { type: 'spring', bounce: 0, duration: 0.25 },
    /** Score and category ring fills, number counting. */
    ring: { type: 'spring', bounce: 0, duration: 0.6 },
    /** Entrances: the ring filling from empty when a page opens, slower so it can be watched. */
    entrance: { type: 'spring', bounce: 0, duration: 1.2 },
    /** Repositioning and reflow. */
    move: { type: 'spring', bounce: 0, duration: 0.4 },
    /** Bottom sheet and drawer after a flick: the gesture carried momentum. */
    sheet: { type: 'spring', bounce: 0.2, duration: 0.3 },
} as const satisfies Record<string, SpringToken>;

/** Deceleration rate for momentum projection: `current + (v / 1000) * d / (1 - d)`. */
const DECELERATION_RATE = 0.998;

export const projectMomentum = (velocityPxPerSecond: number, decelerationRate: number = DECELERATION_RATE): number => {
    return ((velocityPxPerSecond / 1000) * decelerationRate) / (1 - decelerationRate);
};

/** Soft boundary: the further past the bound, the less the element follows. */
export const rubberband = (overshoot: number, dimension: number, constant = 0.55): number => {
    return (overshoot * dimension * constant) / (dimension + constant * Math.abs(overshoot));
};
