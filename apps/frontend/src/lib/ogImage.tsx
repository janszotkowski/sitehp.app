import { Resvg } from '@resvg/resvg-js';
import { domainToUnicode, scoreBreakdown, scoreColorHex, type ScanSnapshot } from '@sitehp.app/core/browser';
import satori from 'satori';
import interRegular from '@fontsource/inter/files/inter-latin-400-normal.woff?inline';
import interSemibold from '@fontsource/inter/files/inter-latin-600-normal.woff?inline';
import interExtRegular from '@fontsource/inter/files/inter-latin-ext-400-normal.woff?inline';
import interExtSemibold from '@fontsource/inter/files/inter-latin-ext-600-normal.woff?inline';
import type { Locale } from '@lib/i18n/switchLocalePath';
import { olderScoreModel } from '@lib/scanSnapshot';
import { blockedStatus } from '@lib/reportModel';
import { categoryTitle } from '@lib/reportTitles';
import { m } from '@paraglide/messages.js';

/** The size every network expects for a large preview. */
const WIDTH = 1200;
const HEIGHT = 630;

/** The dark theme's tokens (`app.css`): the card looks like the report it links to. */
const COLOR = { background: '#000000', card: '#141418', track: '#1c1c22', foreground: '#f5f5f7', muted: '#a6a6ae' };

// Vite inlines the font files as data URLs, so the server bundle needs no file next to it at run time.
// Latin-ext carries the Czech letters (ě, š, č, ř…). Satori falls back only across family names, so it has a name of its own.
const fontData = (dataUrl: string): Buffer => Buffer.from(dataUrl.slice(dataUrl.indexOf(',') + 1), 'base64');
const FONTS = [
    { name: 'Inter', data: fontData(interRegular), weight: 400 as const, style: 'normal' as const },
    { name: 'Inter', data: fontData(interSemibold), weight: 600 as const, style: 'normal' as const },
    { name: 'Inter Ext', data: fontData(interExtRegular), weight: 400 as const, style: 'normal' as const },
    { name: 'Inter Ext', data: fontData(interExtSemibold), weight: 600 as const, style: 'normal' as const },
];

type RingProps = { size: number; stroke: number; score: number | null; numeral: string; fontSize: number };

/** The score ring of the report, drawn for the image: a track, an arc as long as the score, the numeral in the middle. */
const Ring = (props: RingProps) => {
    const radius = 100 - props.stroke / 2;
    const circumference = 2 * Math.PI * radius;
    const color = props.score === null ? COLOR.muted : scoreColorHex(props.score);
    const arc = props.score === null ? 0 : (circumference * Math.min(100, Math.max(0, props.score))) / 100;
    return (
        <div style={{ display: 'flex', position: 'relative', width: props.size, height: props.size, alignItems: 'center', justifyContent: 'center' }}>
            <svg
                width={props.size}
                height={props.size}
                viewBox={'0 0 200 200'}
                style={{ position: 'absolute', top: 0, left: 0 }}
            >
                <circle
                    cx={100}
                    cy={100}
                    r={radius}
                    fill={'none'}
                    stroke={COLOR.track}
                    strokeWidth={props.stroke}
                />
                {arc > 0.5 && (
                    <circle
                        cx={100}
                        cy={100}
                        r={radius}
                        fill={'none'}
                        stroke={color}
                        strokeWidth={props.stroke}
                        strokeLinecap={'round'}
                        strokeDasharray={`${arc} ${circumference}`}
                        transform={'rotate(-90 100 100)'}
                    />
                )}
            </svg>
            <span style={{ fontSize: props.fontSize, fontWeight: 600, letterSpacing: '-0.04em', color: props.score === null ? COLOR.muted : COLOR.foreground }}>{props.numeral}</span>
        </div>
    );
};

/** A long name would run off the card: shortened at the end, the start (what people recognise) kept. */
const shorten = (text: string, max: number): string => (text.length > max ? `${text.slice(0, max - 1)}…` : text);

/**
 * The share preview of a report (1200 × 630 PNG): the HP ring, the domain, the score per category and the date.
 * Only what the report already shows publicly is drawn: no evidence, headers or page content.
 */
export const renderOgImage = async (snapshot: ScanSnapshot, locale: Locale): Promise<Buffer> => {
    const domain = shorten(domainToUnicode(snapshot.domain), 40);
    // An earlier model's report: today's weights would not add its categories up to its HP (see `olderScoreModel`).
    // A scan of a choice of checks has no HP to share: picking only the checks a site passes would make any site a 100.
    const custom = snapshot.selectedChecks !== undefined;
    const breakdown = snapshot.status === 'running' || custom || olderScoreModel(snapshot) !== undefined ? null : scoreBreakdown(snapshot.checks);
    const score = snapshot.status === 'completed' && !custom ? snapshot.score : null;
    const blocked = blockedStatus(snapshot.checks);
    const line =
        snapshot.status === 'running'
            ? m.og_report_running({}, { locale })
            : blocked !== null
              ? m.og_report_blocked({ status: blocked }, { locale })
              : score === null
                ? m.og_report_no_score({}, { locale })
                : m.og_report_score({ score }, { locale });

    const svg = await satori(
        <div
            style={{ display: 'flex', width: WIDTH, height: HEIGHT, padding: 64, background: COLOR.background, fontFamily: 'Inter, Inter Ext', color: COLOR.foreground, gap: 64, alignItems: 'center' }}
        >
            <Ring
                size={380}
                stroke={14}
                score={score}
                numeral={score === null ? '–' : String(score)}
                fontSize={score === 100 ? 120 : 150}
            />
            <div style={{ display: 'flex', flexDirection: 'column', flex: 1, gap: 20, minWidth: 0 }}>
                <span style={{ fontSize: 26, fontWeight: 600, color: COLOR.muted }}>sitehp.app</span>
                <span style={{ fontSize: domain.length > 24 ? 48 : 64, fontWeight: 600, letterSpacing: '-0.02em', lineHeight: 1.1 }}>{domain}</span>
                <span style={{ fontSize: 30, color: COLOR.muted }}>{line}</span>
                {breakdown !== null && (
                    <div style={{ display: 'flex', flexWrap: 'wrap', columnGap: 28, rowGap: 16, marginTop: 24 }}>
                        {breakdown.categories.map((item) => (
                            <div
                                key={item.category}
                                style={{ display: 'flex', alignItems: 'center', gap: 14 }}
                            >
                                <Ring
                                    size={76}
                                    stroke={18}
                                    score={item.score}
                                    numeral={String(item.score)}
                                    fontSize={28}
                                />
                                <span style={{ fontSize: 24, color: COLOR.muted }}>{categoryTitle(item.category, locale)}</span>
                            </div>
                        ))}
                    </div>
                )}
                <span style={{ fontSize: 22, color: COLOR.muted, marginTop: 'auto' }}>{snapshot.createdAt.slice(0, 10)}</span>
            </div>
        </div>,
        { width: WIDTH, height: HEIGHT, fonts: FONTS },
    );
    return new Resvg(svg, { fitTo: { mode: 'width', value: WIDTH } }).render().asPng();
};
