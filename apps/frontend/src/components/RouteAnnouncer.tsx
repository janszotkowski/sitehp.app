import { useRouterState } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';

/** How long the router gets to update the page title before it is read out. */
const SETTLE_MS = 100;

/**
 * A page change inside the app does not reload the document, so nothing tells a screen reader that it happened
 * and keyboard focus is left on an element that is gone. After each navigation to another path this says the new
 * page's title in a polite live region and moves focus to the page's `main`. Changing only the query string (the
 * report's view switch) is not a new page and leaves focus alone.
 */
export const RouteAnnouncer = () => {
    const pathname = useRouterState({ select: (state) => state.location.pathname });
    // The path of the page already announced: a re-run of the effect for the same path (React's development double run) does nothing.
    const announced = useRef(pathname);
    const [message, setMessage] = useState('');

    useEffect(() => {
        // The page load itself is not a navigation: the browser already announces and focuses it.
        if (announced.current === pathname) return undefined;
        announced.current = pathname;
        const timer = setTimeout(() => {
            setMessage(document.title);
            const main = document.getElementById('main');
            if (main !== null) {
                main.tabIndex = -1;
                main.focus({ preventScroll: true });
            }
        }, SETTLE_MS);
        return () => clearTimeout(timer);
    }, [pathname]);

    return (
        <div
            role={'status'}
            aria-live={'polite'}
            aria-atomic={'true'}
            className={'sr-only'}
        >
            {message}
        </div>
    );
};
