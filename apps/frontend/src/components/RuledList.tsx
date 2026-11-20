import type { CSSProperties, ReactNode } from 'react';
import { cn } from '@lib/utils';

export type RuledItem = {
    key: string;
    title: ReactNode;
    /** The sentence (or anything else, such as a bar) beside the title. */
    body: ReactNode;
    /** A stable id on the heading, so the row can be linked to (`#id`). */
    id?: string;
    /** Small text under the title: a count, a weight, a state. */
    meta?: ReactNode;
    /** Before the title on the same line: a step number. */
    lead?: ReactNode;
    /** Planned or secondary: the row is drawn quieter. */
    muted?: boolean;
};

type RuledListProps = { items: readonly RuledItem[]; ordered?: boolean; className?: string };

type RuledColumnsProps = { items: readonly RuledItem[]; ordered?: boolean; columns?: 2 | 3; className?: string };

type RowPartProps = { item: RuledItem };

const Title = (props: RowPartProps) => (
    <div className={'flex flex-col gap-1'}>
        <div className={'flex items-baseline gap-3'}>
            {props.item.lead !== undefined && (
                <span
                    aria-hidden={'true'}
                    className={'text-headline tabular-nums text-subtle-foreground'}
                >
                    {props.item.lead}
                </span>
            )}
            <h3
                id={props.item.id}
                className={cn('text-headline', props.item.muted === true && 'text-muted-foreground')}
            >
                {props.item.title}
            </h3>
        </div>
        {props.item.meta !== undefined && <p className={'text-caption tabular-nums text-subtle-foreground'}>{props.item.meta}</p>}
    </div>
);

const Body = (props: RowPartProps) =>
    typeof props.item.body === 'string' ? (
        <p className={cn('max-w-prose text-callout', props.item.muted === true ? 'text-subtle-foreground' : 'text-muted-foreground')}>{props.item.body}</p>
    ) : (
        props.item.body
    );

/**
 * The site's list of titled rows divided by hairlines: the title on the left, what it means beside it on a wide screen,
 * stacked on a phone. One component so every page draws it the same way (home, About, How scoring works).
 */
export const RuledList = (props: RuledListProps) => {
    const List = props.ordered === true ? 'ol' : 'ul';
    return (
        <List className={cn('flex flex-col border-t', props.className)}>
            {props.items.map((item) => (
                <li
                    key={item.key}
                    className={'reveal grid gap-x-10 gap-y-2 border-b py-5 text-left md:grid-cols-[16rem_1fr]'}
                >
                    <Title item={item} />
                    <Body item={item} />
                </li>
            ))}
        </List>
    );
};

/** The same rows side by side, each under its own hairline: for short steps and points. */
export const RuledColumns = (props: RuledColumnsProps) => {
    const List = props.ordered === true ? 'ol' : 'ul';
    return (
        <List className={cn('grid gap-x-10 gap-y-8', props.columns === 2 ? 'sm:grid-cols-2' : 'md:grid-cols-3', props.className)}>
            {props.items.map((item, index) => (
                <li
                    key={item.key}
                    style={{ '--i': index % 3 } as CSSProperties}
                    className={'glow-hover reveal reveal-stagger flex flex-col gap-2 border-t pt-5 text-left [--glow-bleed-bottom:1.25rem] [--glow-bleed-x:1rem]'}
                >
                    <Title item={item} />
                    <Body item={item} />
                </li>
            ))}
        </List>
    );
};
