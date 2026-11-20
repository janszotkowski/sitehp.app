import { zValidator } from '@hono/zod-validator';
import type { ValidationTargets } from 'hono';
import type { core } from 'zod';
import { AppError } from '@platform/errors.ts';

/** Validates a request part against a contract schema; a failure is a `VALIDATION_FAILED` error with field details. */
export const validate = <Target extends keyof ValidationTargets, Schema extends core.$ZodType>(target: Target, schema: Schema) => {
    return zValidator(target, schema, (result) => {
        if (!result.success) {
            throw new AppError(
                'VALIDATION_FAILED',
                'The request is not valid.',
                result.error.issues.map((issue) => ({ path: issue.path.join('.'), message: issue.message })),
            );
        }
    });
};
