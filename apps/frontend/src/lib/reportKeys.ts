/** Where a key was pressed: on the report table, on the drawer's own step and close buttons, or elsewhere in the drawer (its scrolling content). */
export type ReportKeyZone = 'table' | 'drawer-nav' | 'drawer';

export type ReportKeyAction = 'close' | 'next' | 'prev';

export type ReportKeyEvent = {
    key: string;
    metaKey: boolean;
    ctrlKey: boolean;
    altKey: boolean;
    defaultPrevented: boolean;
};

/** Elements that use the keys themselves: a field, or a menu or list Base UI drives with the arrows and Escape. */
export const KEY_OWNERS = 'input, textarea, select, [contenteditable], [role="menu"], [role="listbox"]';

/**
 * What a key does to the open report drawer. Only keys pressed on the table or in the drawer count, never on the rest of the page (WCAG 2.1.4):
 * the arrows and j/k step through the checks from the table or the drawer's buttons, but scroll the drawer's content as usual; Escape closes from either.
 * `owned` is true when the target sits in a `KEY_OWNERS` element.
 */
export const reportKeyAction = (event: ReportKeyEvent, zone: ReportKeyZone, owned: boolean): ReportKeyAction | undefined => {
    if (event.defaultPrevented || event.metaKey || event.ctrlKey || event.altKey || owned) return undefined;
    if (event.key === 'Escape') return 'close';
    if (zone === 'drawer') return undefined;
    if (event.key === 'ArrowDown' || event.key === 'j') return 'next';
    if (event.key === 'ArrowUp' || event.key === 'k') return 'prev';
    return undefined;
};
