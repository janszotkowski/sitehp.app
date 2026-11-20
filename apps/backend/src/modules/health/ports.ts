/** One dependency the API cannot serve without (the database, Redis): `check` resolves when it answers and rejects when it does not. */
export type ReadinessProbe = {
    name: string;
    check: () => Promise<unknown>;
};
