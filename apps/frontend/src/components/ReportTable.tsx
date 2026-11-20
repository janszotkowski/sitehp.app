import {
    columnFilteringFeature,
    createColumnHelper,
    createFilteredRowModel,
    createSortedRowModel,
    globalFilteringFeature,
    rowSortingFeature,
    tableFeatures,
    useTable,
    type Column,
    type FilterFn,
    type SortFn,
} from '@tanstack/react-table';
import { ArrowDown, ArrowUp, ArrowUpDown, Search, X } from 'lucide-react';
import type { Category } from '@sitehp.app/core/browser';
import { createContext, useContext, useEffect, useMemo, useState } from 'react';
import { ExportMenu } from '@components/ExportMenu';
import { StatusPill } from '@components/StatusIcon';
import { FindingModal } from '@components/FindingModal';
import { FixFirst } from '@components/FixFirst';
import { FindingSheet } from '@components/FindingSheet';
import { SegmentedControl } from '@components/SegmentedControl';
import { StatusIcon } from '@components/StatusIcon';
import { checkText } from '@lib/checkMessages';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { KEY_OWNERS, reportKeyAction } from '@lib/reportKeys';
import {
    filterCounts,
    matchesQuery,
    REPORT_FILTERS,
    reportAsJson,
    rowsForFilter,
    rowsInCategory,
    selectionIn,
    STATUS_RANK,
    statusLabel,
    topFixes,
    valueSummary,
    type ReportFilter,
    type ReportRow,
} from '@lib/reportModel';
import { reportAsMarkdown, type ReportInfo } from '@lib/reportMarkdown';
import { categoryTitle, groupTitle } from '@lib/reportTitles';
import { useMediaQuery } from '@lib/useMediaQuery';
import { cn } from '@lib/utils';
import { m } from '@paraglide/messages.js';

/** From here a check opens in the side panel; below it, as a bottom sheet. */
const DRAWER_QUERY = '(min-width: 1024px)';

/**
 * Only the table features this view uses: sorting and a global (full-text) filter. Nothing else is registered, so
 * nothing else is bundled or computed. Defined once, outside the component, so it stays stable.
 */
const features = tableFeatures({
    rowSortingFeature,
    sortedRowModel: createSortedRowModel(),
    columnFilteringFeature,
    globalFilteringFeature,
    filteredRowModel: createFilteredRowModel(),
});

type Features = typeof features;

const helper = createColumnHelper<Features, ReportRow>();

/** Ascending order of a number column; Table reverses it for descending, so it never flips the sign itself. */
const byNumber: SortFn<Features, ReportRow> = (a, b, columnId) => a.getValue<number>(columnId) - b.getValue<number>(columnId);

const byText: SortFn<Features, ReportRow> = (a, b, columnId) => a.getValue<string>(columnId).localeCompare(b.getValue<string>(columnId));

/** Small screens keep status, name and gain; the rest appears as there is room for it. */
const COLUMN_CLASS: Record<string, string> = {
    status: '',
    check: '',
    gain: 'whitespace-nowrap',
    value: 'hidden lg:table-cell',
};

type SortIconProps = { sorted: ReturnType<Column<Features, ReportRow>['getIsSorted']> };

const SortIcon = (props: SortIconProps) => {
    if (props.sorted === 'asc')
        return (
            <ArrowUp
                aria-hidden={'true'}
                className={'size-3.5'}
            />
        );
    if (props.sorted === 'desc')
        return (
            <ArrowDown
                aria-hidden={'true'}
                className={'size-3.5'}
            />
        );
    return (
        <ArrowUpDown
            aria-hidden={'true'}
            className={'size-3.5 opacity-40'}
        />
    );
};

/** The plan reaches the gain cells through context, so ticking a box re-renders the cell instead of rebuilding the columns (which would drop keyboard focus). */
const PlanContext = createContext<{ planned: readonly string[]; onToggle: (id: string) => void } | undefined>(undefined);

type GainCellProps = { id: string; gain: number; locale: Locale };

const GainCell = (props: GainCellProps) => {
    const plan = useContext(PlanContext);
    const gain = m.report_gain({ gain: props.gain }, { locale: props.locale });
    if (props.gain <= 0) return <span className={'tabular-nums'}>—</span>;
    if (plan === undefined) return <span className={'tabular-nums'}>{gain}</span>;
    return (
        // Its own control inside the clickable row: ticking it plans the fix and leaves the detail closed.
        // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
        <label
            onClick={(event) => event.stopPropagation()}
            className={'inline-flex min-h-11 cursor-pointer items-center gap-2 tabular-nums'}
        >
            <input
                type={'checkbox'}
                checked={plan.planned.includes(props.id)}
                onChange={() => plan.onToggle(props.id)}
                aria-label={m.report_plan_toggle({ title: checkText(props.id, props.locale).title }, { locale: props.locale })}
                className={'size-4 accent-(--score-color)'}
            />
            {gain}
        </label>
    );
};

const rowAnchor = (id: string): string => `finding-row-${id}`;

/** What needs doing first: worst status, and within it the biggest gain. */
const DEFAULT_SORTING = [
    { id: 'status', desc: false },
    { id: 'gain', desc: true },
];

type ReportTableProps = {
    rows: ReportRow[];
    domain: string;
    score: number | null;
    /** What the Markdown export says about the scan itself. */
    info: ReportInfo;
    /** Where the report for paper lives. */
    printHref: string;
    /** The category the table is narrowed to (chosen among the category scores above it), if any. */
    category: Category | undefined;
    onCategoryChange: (category: Category | undefined) => void;
    /** The checks ticked as "I'll fix this"; their HP gain becomes a checkbox while `onTogglePlan` is set. */
    planned: readonly string[];
    onTogglePlan: ((id: string) => void) | undefined;
    locale: Locale;
};

/**
 * Every check in one sortable, searchable table, worst and most valuable first. A row opens the check's detail:
 * in a side panel on a wide screen (which can be stepped through with the arrow keys, closed with Escape) and in a
 * bottom sheet on a phone. A switch adds the developer's columns (area, severity, effort). The search is full-text
 * over name, explanation, id, area, category, status, severity and measured values (every word must match, in any order).
 */
export const ReportTable = (props: ReportTableProps) => {
    const { locale } = props;
    const desktop = useMediaQuery(DRAWER_QUERY);
    // Until the person picks one, a finished report starts on what needs attention (the passed checks are one tap away) and a running one on everything.
    const [chosen, setChosen] = useState<ReportFilter | undefined>(undefined);
    const [selectedId, setSelectedId] = useState<string | undefined>(undefined);

    // The category chosen above narrows everything below it: the counts, the table and the cards of what to fix first.
    const inCategory = rowsInCategory(props.rows, props.category);
    const counts = filterCounts(inCategory);
    const finished = !props.rows.some((row) => row.status === 'running');
    const filter = chosen ?? (finished && counts.review > 0 ? 'review' : 'all');
    const labels: Record<ReportFilter, string> = {
        all: m.report_filter_all({}, { locale }),
        review: m.report_filter_review({}, { locale }),
        passed: m.report_filter_passed({}, { locale }),
    };

    const columns = useMemo(
        () =>
            helper.columns([
                helper.accessor((row) => STATUS_RANK[row.status], {
                    id: 'status',
                    header: m.report_col_status({}, { locale }),
                    sortFn: byNumber,
                    cell: (info) => (
                        <span className={'flex items-center gap-2'}>
                            <span className={'md:hidden'}>
                                <StatusIcon status={info.row.original.status} />
                                <span className={'sr-only'}>{statusLabel(info.row.original.status, locale)}</span>
                            </span>
                            <StatusPill
                                status={info.row.original.status}
                                locale={locale}
                                className={'hidden md:inline-flex'}
                            />
                        </span>
                    ),
                }),
                helper.accessor((row) => checkText(row.id, locale).title, { id: 'check', header: m.report_col_check({}, { locale }), sortFn: byText }),
                helper.accessor((row) => row.gain, {
                    id: 'gain',
                    header: m.report_col_gain({}, { locale }),
                    sortFn: byNumber,
                    cell: (info) => (
                        <GainCell
                            id={info.row.original.id}
                            gain={info.getValue()}
                            locale={locale}
                        />
                    ),
                }),
                helper.accessor((row) => valueSummary(row, locale).text, {
                    id: 'value',
                    header: m.report_col_value({}, { locale }),
                    sortFn: byText,
                    // A header the page sent is code, shown as sent; what we measured is a sentence.
                    cell: (info) => (
                        <span className={cn('line-clamp-2 text-muted-foreground', valueSummary(info.row.original, locale).raw ? 'text-code font-mono break-all' : 'text-caption')}>
                            {info.getValue()}
                        </span>
                    ),
                }),
            ]),
        [locale],
    );

    // The one place the full-text rule meets Table: it asks the model, once per row (only the `check` column takes part).
    const globalFilterFn: FilterFn<Features, ReportRow> = (row, _columnId, value) => matchesQuery(row.original, String(value), locale);

    const table = useTable({
        features,
        columns,
        data: rowsForFilter(inCategory, filter),
        globalFilterFn,
        getColumnCanGlobalFilter: (column) => column.id === 'check',
        getRowId: (row) => row.id,
        initialState: { sorting: DEFAULT_SORTING },
    });

    const shown = table.getRowModel().rows;
    const plan = useMemo(() => (props.onTogglePlan === undefined ? undefined : { planned: props.planned, onToggle: props.onTogglePlan }), [props.planned, props.onTogglePlan]);
    const query = String(table.state.globalFilter ?? '');
    const search = (value: string) => table.setGlobalFilter(value);

    // A filter or search that hides the selected row ends the selection, so the panel does not come back on its own later.
    const visibleId = selectionIn(
        shown.map((row) => row.id),
        selectedId,
    );
    if (visibleId !== selectedId) setSelectedId(visibleId);
    const index = shown.findIndex((row) => row.id === selectedId);
    const selected = index === -1 ? undefined : shown[index]?.original;
    // The panel and the sheet keep the last check while they slide out, so they do not empty before they have left.
    const [kept, setKept] = useState<ReportRow | undefined>(undefined);
    if (selected !== undefined && selected !== kept) setKept(selected);

    const select = (id: string | undefined) => {
        setSelectedId(id);
        if (id !== undefined) document.getElementById(rowAnchor(id))?.scrollIntoView({ block: 'nearest' });
    };
    // The panel goes inert as it closes: focus returns to the row's button rather than dropping to the page.
    const close = (refocus: boolean) => {
        const id = selectedId;
        setSelectedId(undefined);
        if (refocus && id !== undefined) document.getElementById(rowAnchor(id))?.querySelector('button')?.focus();
    };
    const rowButtonOfKept = () => (kept === undefined ? null : (document.getElementById(rowAnchor(kept.id))?.querySelector('button') ?? null));
    const step = (by: number) => {
        if (shown.length === 0) return;
        const next = shown[Math.min(shown.length - 1, Math.max(0, (index === -1 ? 0 : index) + by))];
        if (next !== undefined) select(next.id);
    };

    useEffect(() => {
        if (!desktop || selected === undefined) return undefined;
        const onKeyDown = (event: KeyboardEvent) => {
            // Only keys pressed on the table or in the drawer, so the rest of the page keeps its keys (WCAG 2.1.4).
            const target = event.target;
            if (!(target instanceof Element)) return;
            const zone = target.closest('[data-report-table]') ? 'table' : target.closest('[data-drawer-nav]') ? 'drawer-nav' : target.closest('[data-report-drawer]') ? 'drawer' : undefined;
            if (zone === undefined) return;
            const action = reportKeyAction(event, zone, target.closest(KEY_OWNERS) !== null);
            if (action === 'close') {
                close(true);
            } else if (action !== undefined) {
                event.preventDefault();
                step(action === 'next' ? 1 : -1);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    });

    return (
        <div className={'flex flex-col gap-4'}>
            <h2 className={'sr-only'}>{m.report_table_caption({ domain: props.domain }, { locale })}</h2>
            {/* Stays put whatever the filter or search: hiding it moved the controls under the pointer. */}
            <FixFirst
                rows={topFixes(inCategory, 3)}
                onOpen={select}
                locale={locale}
            />
            <div className={'flex flex-wrap items-center gap-3'}>
                <label className={'relative min-w-0 flex-1 basis-56'}>
                    <span className={'sr-only'}>{m.report_table_search({}, { locale })}</span>
                    <Search
                        aria-hidden={'true'}
                        className={'pointer-events-none absolute top-1/2 left-4 size-4 -translate-y-1/2 text-subtle-foreground'}
                    />
                    <input
                        type={'search'}
                        value={query}
                        onChange={(event) => search(event.target.value)}
                        placeholder={m.report_table_placeholder({}, { locale })}
                        className={
                            'h-11 w-full rounded-4xl border border-input bg-secondary pr-11 pl-11 text-callout outline-none placeholder:text-subtle-foreground focus-visible:ring-2 focus-visible:ring-ring [&::-webkit-search-cancel-button]:hidden'
                        }
                    />
                    {query !== '' && (
                        <button
                            type={'button'}
                            aria-label={m.report_table_clear({}, { locale })}
                            onClick={() => search('')}
                            className={
                                'absolute top-1/2 right-2 flex size-8 -translate-y-1/2 items-center justify-center rounded-4xl text-subtle-foreground outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring'
                            }
                        >
                            <X
                                aria-hidden={'true'}
                                className={'size-4'}
                            />
                        </button>
                    )}
                </label>
                <SegmentedControl
                    label={m.report_filter_label({}, { locale })}
                    value={filter}
                    options={REPORT_FILTERS.map((value) => ({ value, label: labels[value], count: counts[value] }))}
                    onChange={setChosen}
                />
                <ExportMenu
                    getJson={() => reportAsJson(props.domain, props.score, props.rows)}
                    getMarkdown={() => reportAsMarkdown(props.domain, props.score, props.rows, locale, props.info)}
                    filename={props.domain}
                    printHref={props.printHref}
                    locale={locale}
                />
            </div>
            <p
                aria-live={'polite'}
                className={'text-caption tabular-nums text-subtle-foreground'}
            >
                {m.report_table_count({ shown: shown.length, total: inCategory.length }, { locale })}
            </p>
            {props.category !== undefined && (
                <p className={'text-caption flex flex-wrap items-center gap-x-3 text-muted-foreground'}>
                    {m.report_category_only({ category: categoryTitle(props.category, locale) }, { locale })}
                    <button
                        type={'button'}
                        onClick={() => props.onCategoryChange(undefined)}
                        className={'inline-flex min-h-11 items-center rounded-xs text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'}
                    >
                        {m.report_category_clear({}, { locale })}
                    </button>
                </p>
            )}

            {/* The pane changes without moving focus, so a screen reader is told which check it now shows. */}
            <div
                role={'status'}
                aria-live={'polite'}
                className={'sr-only'}
            >
                {desktop && selected !== undefined ? m.report_detail_shown({ title: checkText(selected.id, locale).title }, { locale }) : ''}
            </div>

            {/* Scrolls sideways rather than clipping: a data table may need two dimensions (WCAG 1.4.10). */}
            <PlanContext value={plan}>
                <div className={'overflow-x-auto border-y'}>
                    <table
                        data-report-table
                        className={'w-full border-collapse text-left'}
                    >
                        <caption className={'sr-only'}>{m.report_table_caption({ domain: props.domain }, { locale })}</caption>
                        <thead className={'border-b'}>
                            {table.getHeaderGroups().map((group) => (
                                <tr key={group.id}>
                                    {group.headers.map((header) => {
                                        const sorted = header.column.getIsSorted();
                                        return (
                                            <th
                                                key={header.id}
                                                scope={'col'}
                                                aria-sort={sorted === 'asc' ? 'ascending' : sorted === 'desc' ? 'descending' : undefined}
                                                className={cn('text-overline uppercase text-subtle-foreground', COLUMN_CLASS[header.column.id])}
                                            >
                                                <button
                                                    type={'button'}
                                                    onClick={header.column.getToggleSortingHandler()}
                                                    className={
                                                        'flex min-h-11 w-full items-center gap-1.5 px-4 text-left whitespace-nowrap uppercase outline-none focus-visible:ring-2 focus-visible:ring-ring'
                                                    }
                                                >
                                                    <table.FlexRender header={header} />
                                                    <SortIcon sorted={sorted} />
                                                </button>
                                            </th>
                                        );
                                    })}
                                </tr>
                            ))}
                        </thead>
                        <tbody>
                            {shown.map((row) => (
                                // The row is clickable for the mouse; the button in its name cell is the keyboard and screen reader path to the same action.
                                // oxlint-disable-next-line jsx-a11y/click-events-have-key-events, jsx-a11y/no-noninteractive-element-interactions
                                <tr
                                    key={row.id}
                                    id={rowAnchor(row.id)}
                                    onClick={() => select(row.id === selectedId ? undefined : row.id)}
                                    className={cn('cursor-pointer border-t first:border-t-0 transition-colors hover:bg-secondary/40', row.id === selectedId && 'bg-secondary')}
                                >
                                    {row.getAllCells().map((cell) =>
                                        cell.column.id === 'check' ? (
                                            // The check's name is the row's header: a screen reader says it with every other cell of the row.
                                            // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                                            <th
                                                key={cell.id}
                                                scope={'row'}
                                                className={'px-4 py-3 text-left align-middle font-normal'}
                                            >
                                                <button
                                                    type={'button'}
                                                    aria-current={row.id === selectedId ? 'true' : undefined}
                                                    onClick={(event) => {
                                                        event.stopPropagation();
                                                        select(row.id === selectedId ? undefined : row.id);
                                                    }}
                                                    className={'flex w-full min-w-0 flex-col text-left outline-none focus-visible:ring-2 focus-visible:ring-ring'}
                                                >
                                                    <span className={'text-callout font-medium'}>{checkText(row.original.id, locale).title}</span>
                                                    <span className={'text-caption truncate text-subtle-foreground'}>{groupTitle(row.original.definition.group, locale)}</span>
                                                </button>
                                            </th>
                                        ) : (
                                            // A data cell is not a control: the rule reads `td` as a grid widget and wants a label on it.
                                            // oxlint-disable-next-line jsx-a11y/control-has-associated-label
                                            <td
                                                key={cell.id}
                                                className={cn('px-4 py-3 align-middle', COLUMN_CLASS[cell.column.id])}
                                            >
                                                <table.FlexRender cell={cell} />
                                            </td>
                                        ),
                                    )}
                                </tr>
                            ))}
                            {shown.length === 0 && (
                                <tr>
                                    <td
                                        colSpan={table.getAllLeafColumns().length}
                                        className={'text-callout px-4 py-8 text-center text-muted-foreground'}
                                    >
                                        {m.report_table_empty({}, { locale })}
                                    </td>
                                </tr>
                            )}
                        </tbody>
                    </table>
                </div>
            </PlanContext>

            {/* The checks that are fine stay out of the way, one tap from view. */}
            {filter === 'review' && counts.passed > 0 && (
                <button
                    type={'button'}
                    onClick={() => setChosen('passed')}
                    className={
                        'text-callout inline-flex min-h-11 items-center self-start rounded-xs text-link underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring'
                    }
                >
                    {m.report_show_passed({ count: counts.passed }, { locale })}
                </button>
            )}

            {desktop ? (
                <FindingModal
                    open={selected !== undefined}
                    onOpenChange={(open) => {
                        if (!open) setSelectedId(undefined);
                    }}
                    row={selected ?? kept}
                    position={Math.max(1, index + 1)}
                    count={shown.length}
                    locale={locale}
                    technologies={props.info.technologies}
                    domain={props.domain}
                    onPrev={() => step(-1)}
                    onNext={() => step(1)}
                    finalFocus={rowButtonOfKept}
                />
            ) : (
                <FindingSheet
                    open={selected !== undefined}
                    onOpenChange={(open) => {
                        if (!open) setSelectedId(undefined);
                    }}
                    row={selected ?? kept}
                    locale={locale}
                    technologies={props.info.technologies}
                    domain={props.domain}
                    position={Math.max(1, index + 1)}
                    count={shown.length}
                    onPrev={() => step(-1)}
                    onNext={() => step(1)}
                    finalFocus={rowButtonOfKept}
                />
            )}
        </div>
    );
};
