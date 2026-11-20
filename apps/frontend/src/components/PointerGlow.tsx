import { useEffect } from 'react';

/** Feeds the pointer position (relative to the card under it) to the `glow-hover` spotlight. Decoration only; renders nothing. */
export const PointerGlow = () => {
    useEffect(() => {
        const onMove = (event: PointerEvent) => {
            const card = event.target instanceof Element ? event.target.closest<HTMLElement>('.glow-hover') : null;
            if (card === null) return;
            const box = card.getBoundingClientRect();
            card.style.setProperty('--mx', `${event.clientX - box.left}px`);
            card.style.setProperty('--my', `${event.clientY - box.top}px`);
        };
        document.addEventListener('pointermove', onMove, { passive: true });
        return () => document.removeEventListener('pointermove', onMove);
    }, []);

    return null;
};
