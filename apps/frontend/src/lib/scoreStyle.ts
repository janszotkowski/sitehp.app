import { scoreColor } from '@sitehp.app/core/browser';
import type { CSSProperties } from 'react';

/**
 * Inline custom properties that carry a score's color for both themes. The server
 * cannot know the theme, so both are emitted and the `score-themed` utility picks one.
 * `null` (no score yet) sets nothing and the element keeps the neutral default.
 */
export const scoreColorStyle = (score: number | null): CSSProperties => (score === null ? {} : { '--sc-dark': scoreColor(score, 'dark'), '--sc-light': scoreColor(score, 'light') }) as CSSProperties;
