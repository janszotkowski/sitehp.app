import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createRouter } from '@tanstack/react-router';
import { ErrorState } from '@components/ErrorState';
import { NotFound } from '@components/NotFound';
import type { RouterContext } from '@lib/routerContext';
import { routeTree } from './routeTree.gen';

export const getRouter = () => {
    // One client per router, so per request on the server: no cached data crosses from one visitor to another.
    const queryClient = new QueryClient();
    return createRouter({
        routeTree,
        context: { queryClient } satisfies RouterContext,
        Wrap: (props) => <QueryClientProvider client={queryClient}>{props.children}</QueryClientProvider>,
        scrollRestoration: true,
        defaultPreload: 'intent',
        // On the router, not on the root route: a not-found address is attributed
        // to the deepest route that still matched (for `/en/nothing` that is
        // `/$locale`), which asks itself and then the router — the root is never
        // asked. A router-level default covers both `/en/nothing` and `/`.
        defaultNotFoundComponent: NotFound,
        defaultErrorComponent: ({ error, reset }) => (
            <ErrorState
                error={error}
                reset={reset}
            />
        ),
    });
};

declare module '@tanstack/react-router' {
    // oxlint-disable-next-line typescript-eslint/consistent-type-definitions
    interface Register {
        router: ReturnType<typeof getRouter>;
    }
}
