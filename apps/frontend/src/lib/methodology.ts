import { CATEGORIES, CATEGORY_WEIGHT, CHECKS, GROUPS, type Category, type CheckMeta, type Group } from '@sitehp.app/core/browser';

export type MethodologyGroup = { group: Group; checks: CheckMeta[] };
export type MethodologyCategory = {
    category: Category;
    weight: number;
    /** Share of the HP it carries today, 0–1: the planned categories have no checks yet, so the live ones share their weight. */
    share: number;
    groups: MethodologyGroup[];
    count: number;
};

/** Categories that have a weight in the score but no check yet: planned, shown as such. */
export const plannedCategories = (): Category[] => CATEGORIES.filter((category) => CATEGORY_WEIGHT[category] > 0 && !CHECKS.some((check) => check.category === category));

/** Every check the engine runs, by category and group, in the order of the registry. The public methodology page is drawn from this, so it cannot list a check that does not exist or miss one that does. */
export const methodology = (): MethodologyCategory[] => {
    const live = CATEGORIES.filter((category) => CHECKS.some((check) => check.category === category));
    const liveWeight = live.reduce((sum, category) => sum + CATEGORY_WEIGHT[category], 0);
    return live.flatMap((category) => {
        const groups = GROUPS.flatMap((group) => {
            const checks = CHECKS.filter((check) => check.category === category && check.group === group);
            return checks.length === 0 ? [] : [{ group, checks }];
        });
        const share = liveWeight === 0 ? 0 : CATEGORY_WEIGHT[category] / liveWeight;
        return [{ category, weight: CATEGORY_WEIGHT[category], share, groups, count: groups.reduce((sum, item) => sum + item.checks.length, 0) }];
    });
};
