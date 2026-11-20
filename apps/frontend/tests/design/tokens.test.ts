import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { springs } from '@lib/motion.ts';

/**
 * The design language lives in docs/DESIGN.md and is implemented in
 * src/styles/app.css and src/lib/motion.ts. This test reads the tables of the
 * document and checks the code against them, so the two cannot drift apart.
 */

const doc = readFileSync('../../docs/DESIGN.md', 'utf8');
const css = readFileSync('src/styles/app.css', 'utf8');

const section = (title: string): string => {
    const start = doc.indexOf(title);
    expect(start, `section "${title}" is missing from the design document`).toBeGreaterThan(-1);
    const next = doc.indexOf('\n### ', start + title.length);
    const nextH2 = doc.indexOf('\n## ', start + title.length);
    const end = [next, nextH2].filter((index) => index > -1).sort((a, b) => a - b)[0] ?? doc.length;
    return doc.slice(start, end);
};

const rows = (text: string): string[][] => {
    return text
        .split('\n')
        .filter((line) => line.startsWith('|') && !/^\|\s*-/.test(line))
        .slice(1)
        .map((line) =>
            line
                .split('|')
                .slice(1, -1)
                .map((cell) => cell.trim().replaceAll('`', '').replaceAll('−', '-')),
        );
};

const block = (selector: string): Map<string, string> => {
    const start = css.indexOf(`\n${selector} {`);
    expect(start, `block ${selector} is missing from app.css`).toBeGreaterThan(-1);
    const end = css.indexOf('\n}', start);
    const map = new Map<string, string>();
    for (const [, name, value] of css.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        if (name !== undefined && value !== undefined) map.set(name, value.trim());
    }
    return map;
};

const theme = (): Map<string, string> => {
    const start = css.indexOf('@theme inline {');
    const end = css.indexOf('\n}', start);
    const map = new Map<string, string>();
    for (const [, name, value] of css.slice(start, end).matchAll(/(--[\w-]+):\s*([^;]+);/g)) {
        if (name !== undefined && value !== undefined) map.set(name, value.trim());
    }
    return map;
};

const norm = (value: string) => value.toLowerCase().replaceAll(/\s+/g, '');

describe('color tokens match the design document', () => {
    const light = block(':root');
    const dark = block('.dark');
    // Neutral palette columns: token, dark, light. Score table columns: token, HP, meaning, dark, light.
    const neutrals = rows(section('### 3.2 Neutral palette')).filter((row) => row[0]?.startsWith('--'));
    const scores = rows(section('### 3.3 Score colors')).filter((row) => row[0]?.startsWith('--'));
    const palette = [...neutrals.map((row) => [row[0], row[1], row[2]]), ...scores.map((row) => [row[0], row[3], row[4]])];

    it('reads a plausible number of tokens from the document', () => {
        expect(palette.length).toBeGreaterThanOrEqual(15);
    });

    it.each(palette.map((row) => [row[0] ?? '', row[1] ?? '', row[2] ?? ''] as const))('%s has the documented dark and light values', (token, documentedDark, documentedLight) => {
        const toColor = (value: string) => {
            // `rgba(255,255,255,.08)` in the document is `rgb(255 255 255 / 8%)` in the CSS.
            const alpha = /^rgba\((\d+),\s*(\d+),\s*(\d+),\s*([\d.]+)\)$/.exec(value.trim());
            return alpha ? `rgb(${alpha[1]}${alpha[2]}${alpha[3]}/${Math.round(Number(alpha[4]) * 100)}%)` : norm(value);
        };
        expect(toColor(dark.get(token) ?? 'missing'), `${token} (dark)`).toBe(toColor(documentedDark));
        expect(toColor(light.get(token) ?? 'missing'), `${token} (light)`).toBe(toColor(documentedLight));
    });
});

describe('radii match the design document', () => {
    const vars = theme();
    const radii = rows(section('### 5.1 Shape')).filter((row) => row[0]?.startsWith('--radius'));

    it.each(radii.map((row) => [row[0] ?? '', row[1] ?? '']))('%s is %s', (token, size) => {
        expect(vars.get(token), token).toBe(size.replace(' ', ''));
    });
});

describe('type scale matches the design document', () => {
    const vars = theme();
    const roles = rows(section('### 4.2 Scale')).filter((row) => row[1]?.startsWith('text-'));

    it('documents every role that has a utility', () => {
        expect(roles.length).toBe(9);
    });

    it.each(roles.map((row) => row.slice(1)))('%s has the documented size, weight, leading and tracking', (utility, size, weight, leading, tracking) => {
        const name = `--${utility}`;
        expect(vars.get(name), `${name} size`).toBe(size);
        expect(vars.get(`${name}--font-weight`), `${name} weight`).toBe(weight);
        expect(vars.get(`${name}--line-height`), `${name} leading`).toBe(leading);
        const documentedTracking = tracking === '0' ? undefined : tracking.replace('+', '');
        expect(vars.get(`${name}--letter-spacing`), `${name} tracking`).toBe(documentedTracking);
    });
});

describe('spring tokens match the design document', () => {
    const documented = rows(section('### 7.2 Spring tokens')).filter((row) => row[0]?.startsWith('spring-'));

    it('documents every spring in code and nothing else', () => {
        expect(documented.map((row) => row[0]?.replace('spring-', '')).sort()).toEqual(Object.keys(springs).sort());
    });

    it.each(documented.map((row) => [row[0]?.replace('spring-', '') ?? '', row[1] ?? '', row[2] ?? '']))('%s maps damping and response to bounce and duration', (name, damping, response) => {
        const token = springs[name as keyof typeof springs];
        expect(token.bounce).toBeCloseTo(1 - Number(damping), 5);
        expect(token.duration).toBeCloseTo(Number(response.replace(' s', '')), 5);
    });
});
