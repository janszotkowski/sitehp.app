import { describe, expect, it } from 'vitest';
import { reportKeyAction } from '@lib/reportKeys';

const key = (name: string, extra: Partial<{ metaKey: boolean; ctrlKey: boolean; altKey: boolean; defaultPrevented: boolean }> = {}) => ({
    key: name,
    metaKey: false,
    ctrlKey: false,
    altKey: false,
    defaultPrevented: false,
    ...extra,
});

describe('reportKeyAction', () => {
    it('steps with the arrows and j/k from the table and the drawer buttons', () => {
        expect(reportKeyAction(key('ArrowDown'), 'table', false)).toBe('next');
        expect(reportKeyAction(key('k'), 'table', false)).toBe('prev');
        expect(reportKeyAction(key('j'), 'drawer-nav', false)).toBe('next');
        expect(reportKeyAction(key('ArrowUp'), 'drawer-nav', false)).toBe('prev');
    });

    it('leaves the arrows to scroll the drawer content, but closes it on Escape', () => {
        expect(reportKeyAction(key('ArrowDown'), 'drawer', false)).toBeUndefined();
        expect(reportKeyAction(key('j'), 'drawer', false)).toBeUndefined();
        expect(reportKeyAction(key('Escape'), 'drawer', false)).toBe('close');
        expect(reportKeyAction(key('Escape'), 'table', false)).toBe('close');
    });

    it('ignores keys owned by a field or a menu, chords and keys already handled', () => {
        expect(reportKeyAction(key('ArrowDown'), 'table', true)).toBeUndefined();
        expect(reportKeyAction(key('Escape'), 'drawer', true)).toBeUndefined();
        expect(reportKeyAction(key('j', { metaKey: true }), 'table', false)).toBeUndefined();
        expect(reportKeyAction(key('ArrowDown', { altKey: true }), 'table', false)).toBeUndefined();
        expect(reportKeyAction(key('Escape', { defaultPrevented: true }), 'table', false)).toBeUndefined();
        expect(reportKeyAction(key('x'), 'table', false)).toBeUndefined();
    });
});
