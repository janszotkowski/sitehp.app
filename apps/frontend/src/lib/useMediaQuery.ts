import { useSyncExternalStore } from 'react';

/**
 * Whether a CSS media query matches, kept live. The server and the first client render say `false` (there is no
 * window yet), so hydration never mismatches; it settles on the real answer right after.
 */
export const useMediaQuery = (query: string): boolean =>
    useSyncExternalStore(
        (notify) => {
            const list = window.matchMedia(query);
            list.addEventListener('change', notify);
            return () => list.removeEventListener('change', notify);
        },
        () => window.matchMedia(query).matches,
        () => false,
    );
