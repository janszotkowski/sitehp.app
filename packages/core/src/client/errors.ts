import { errorResponseSchema, type ErrorCode, type ErrorResponse } from '../contract/errors.ts';

type ApiErrorDetail = NonNullable<ErrorResponse['error']['details']>;

/** A failure reported by the API, with the stable code from the contract. Clients map `code` to a localized message. */
export class ApiError extends Error {
    readonly code: ErrorCode;
    readonly status: number;
    readonly requestId: string | undefined;
    readonly details: ApiErrorDetail | undefined;

    constructor(code: ErrorCode, message: string, status: number, requestId?: string, details?: ApiErrorDetail) {
        super(message);
        this.name = 'ApiError';
        this.code = code;
        this.status = status;
        this.requestId = requestId;
        this.details = details;
    }
}

/** Turns a non-2xx response into an `ApiError`. A body that is not the error contract becomes `INTERNAL`, never a crash. */
export const apiErrorFromResponse = async (response: Response): Promise<ApiError> => {
    const parsed = errorResponseSchema.safeParse(await response.json().catch(() => undefined));
    if (!parsed.success) {
        return new ApiError('INTERNAL', `Unexpected response (HTTP ${response.status}).`, response.status, response.headers.get('x-request-id') ?? undefined);
    }
    const { code, message, requestId, details } = parsed.data.error;
    return new ApiError(code, message, response.status, requestId, details);
};
