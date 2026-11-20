import { useSpringValue } from '@lib/useSpringValue';

type ProgressBarProps = {
    value: number;
    max: number;
    label: string;
    className?: string;
};

/** A thin bar that springs to its value, so a step that arrives as a jump is eased instead of snapping. */
export const ProgressBar = (props: ProgressBarProps) => {
    const share = props.max > 0 ? Math.min(1, props.value / props.max) : 0;
    const shown = useSpringValue(share);
    return (
        <div
            role={'progressbar'}
            aria-label={props.label}
            aria-valuemin={0}
            aria-valuemax={props.max}
            aria-valuenow={props.value}
            className={`h-1.5 overflow-hidden rounded-full bg-muted ${props.className ?? ''}`}
        >
            <div
                className={'h-full origin-left rounded-full bg-(--score-color)'}
                style={{ transform: `scaleX(${shown})` }}
            />
        </div>
    );
};
