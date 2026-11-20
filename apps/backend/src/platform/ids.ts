import { randomBytes } from 'node:crypto';
import type { IdGenerator } from '@platform/ports.ts';

/**
 * 128 random bits from the operating system's CSPRNG, as 22 URL-safe characters.
 * Never sequential, never derived from anything guessable: the id of a report is the
 * only thing that gives access to it.
 *
 * An id never starts with `-`: a command line would read it as an option
 * (`sitehp report -abc…`). Ids that would are drawn again, which costs about
 * 0.03 bits of the 128 and changes nothing about guessability.
 */
export const secureIdGenerator: IdGenerator = {
    next: () => {
        for (;;) {
            const id = randomBytes(16).toString('base64url');
            if (!id.startsWith('-')) return id;
        }
    },
};
