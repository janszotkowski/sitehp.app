import { describe, expect, it } from 'vitest';
import { evidenceLabel, evidenceValue } from '@lib/evidenceFormat';

describe('evidence labels', () => {
    it('turns a key into words, with the acronyms in capitals', () => {
        expect(evidenceLabel('htmlTransferredBytes')).toBe('HTML transferred bytes');
        expect(evidenceLabel('ttfbMs')).toBe('TTFB ms');
        expect(evidenceLabel('daysLeft')).toBe('Days left');
        expect(evidenceLabel('h3Advertised')).toBe('H3 advertised');
        expect(evidenceLabel('x_frame_options')).toBe('X frame options');
        expect(evidenceLabel('status')).toBe('Status');
    });
});

describe('evidence values', () => {
    it('writes sizes in kB and MB and keeps the exact number for a tooltip', () => {
        expect(evidenceValue('htmlBytes', '1048576')).toEqual({ text: '1.0 MB', exact: '1,048,576 bytes' });
        expect(evidenceValue('htmlTransferredBytes', '148838')).toEqual({ text: '145 kB', exact: '148,838 bytes' });
        expect(evidenceValue('bytes', '2048')).toEqual({ text: '2.0 kB', exact: '2,048 bytes' });
        expect(evidenceValue('bytes', '577')).toEqual({ text: '577 B' });
    });

    it('adds the unit the name gives, and says yes and no for a boolean', () => {
        expect(evidenceValue('ttfbMs', '612')).toEqual({ text: '612 ms' });
        expect(evidenceValue('daysLeft', '1')).toEqual({ text: '1 day' });
        expect(evidenceValue('daysLeft', '-5')).toEqual({ text: '-5 days' });
        expect(evidenceValue('modernPercent', '25')).toEqual({ text: '25 %' });
        expect(evidenceValue('googleFonts', 'true')).toEqual({ text: 'yes' });
        expect(evidenceValue('truncated', 'false')).toEqual({ text: 'no' });
    });

    it('speaks Czech on a Czech page: decimal comma, three forms of days, ano and ne', () => {
        expect(evidenceValue('htmlBytes', '1048576', 'cs')).toEqual({ text: '1,0 MB', exact: `${(1048576).toLocaleString('cs-CZ')} bajtů` });
        expect(['1', '3', '5'].map((days) => evidenceValue('daysLeft', days, 'cs').text)).toEqual(['1 den', '3 dny', '5 dní']);
        expect(evidenceValue('googleFonts', 'true', 'cs')).toEqual({ text: 'ano' });
        expect(evidenceValue('truncated', 'false', 'cs')).toEqual({ text: 'ne' });
    });

    it('leaves a value that is text, or a number with no unit in its name, as it is', () => {
        expect(evidenceValue('status', '404')).toEqual({ text: '404' });
        expect(evidenceValue('htmlEncoding', 'gzip')).toEqual({ text: 'gzip' });
        expect(evidenceValue('hosts', 'a.com, b.com')).toEqual({ text: 'a.com, b.com' });
        expect(evidenceValue('title', '1.0 MB big')).toEqual({ text: '1.0 MB big' });
    });
});
