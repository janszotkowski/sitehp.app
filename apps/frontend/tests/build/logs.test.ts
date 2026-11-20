import { describe, expect, it } from 'vitest';
import { dropUseClientDirectiveWarning } from '@vite/logs';

type Call = [string, { code?: string; id?: string; message: string }];

const run = (log: { code?: string; id?: string; message: string }): Call[] => {
    const forwarded: Call[] = [];
    // The handler is called with the log level, the log and the default handler; only what reaches the default handler is shown.
    dropUseClientDirectiveWarning('warn', log as never, ((level: string, forwardedLog: Call[1]) => forwarded.push([level, forwardedLog])) as never);
    return forwarded;
};

const useClient = (id: string) => ({ code: 'MODULE_LEVEL_DIRECTIVE', id, message: 'The semantics of the module level directive "use client" in "x" may not be preserved when bundling.' });

describe('dropUseClientDirectiveWarning', () => {
    it("drops the 'use client' directive warning for a dependency", () => {
        expect(run(useClient('/repo/node_modules/.pnpm/@base-ui+react@1/node_modules/@base-ui/react/useX.mjs'))).toEqual([]);
    });

    it("still shows a 'use client' directive in our own source", () => {
        expect(run(useClient('/repo/apps/frontend/src/components/Thing.tsx'))).toHaveLength(1);
    });

    it('still shows any other warning from a dependency', () => {
        const other = { code: 'CIRCULAR_DEPENDENCY', id: '/repo/node_modules/x/index.js', message: 'Circular dependency' };
        expect(run(other)).toEqual([['warn', other]]);
    });

    it('still shows another module-level directive from a dependency', () => {
        const other = { code: 'MODULE_LEVEL_DIRECTIVE', id: '/repo/node_modules/x/index.js', message: 'The semantics of the module level directive "use server" may not be preserved' };
        expect(run(other)).toHaveLength(1);
    });

    it('does not fail on a log without an id', () => {
        expect(run({ code: 'EVAL', message: 'Use of eval' })).toHaveLength(1);
    });
});
