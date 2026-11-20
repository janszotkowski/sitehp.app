/** The id of the scan field in the header, and of the one on the landing page, which stands in for it where the header has none. */
export const NAV_SCAN_FIELD_ID = 'nav-scan-url';
export const HERO_SCAN_FIELD_ID = 'scan-url';

type KeyLike = Pick<KeyboardEvent, 'key' | 'metaKey' | 'ctrlKey' | 'altKey' | 'shiftKey'>;

/** Cmd+K on a Mac, Ctrl+K elsewhere. A chord with another modifier (Shift, Alt) belongs to someone else. */
export const isScanShortcut = (event: KeyLike): boolean => (event.metaKey || event.ctrlKey) && !event.altKey && !event.shiftKey && event.key.toLowerCase() === 'k';

/** Puts the cursor in the scan field with its text selected, so the next thing typed replaces it. False when no page has one. */
export const focusScanField = (doc: Document = document): boolean => {
    const field = doc.getElementById(NAV_SCAN_FIELD_ID) ?? doc.getElementById(HERO_SCAN_FIELD_ID);
    if (!(field instanceof HTMLInputElement)) return false;
    field.focus();
    field.select();
    return true;
};

/** What the shortcut is called on this machine. */
export const shortcutLabel = (platform: string): string => (/mac|iphone|ipad/i.test(platform) ? '⌘K' : 'Ctrl K');
