import type { ReactNode } from 'react';

type InfoSectionProps = {
    title: string;
    /** A stable id for the heading, so the section can be linked to (`#id`). */
    id?: string;
    children: ReactNode;
};

/** A titled block of an information page: a heading and what belongs under it, at reading width. */
export const InfoSection = (props: InfoSectionProps) => (
    <section className={'reveal flex flex-col gap-3'}>
        <h2
            id={props.id}
            className={'text-title-2'}
        >
            {props.title}
        </h2>
        {props.children}
    </section>
);
