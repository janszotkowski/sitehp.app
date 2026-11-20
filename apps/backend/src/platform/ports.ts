/** Time is a dependency, so tests control it. */
export type Clock = {
    now(): Date;
};

export const systemClock: Clock = {
    now: () => new Date(),
};

/** Unguessable identifiers, so tests can use predictable ones. */
export type IdGenerator = {
    next(): string;
};
