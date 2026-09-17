/**
 * Drip — the water-droplet mascot.
 *
 * Built as an SVG *string* rather than JSX because it is needed in two places
 * that cannot share a React tree: on screen, and inside the share-card image,
 * which is an SVG rasterised through a canvas. One source of geometry means the
 * character people see is exactly the character that ends up in their post.
 *
 * Drip's face is a second encoding of stream status, alongside colour, the
 * number and the written label — so the state is readable by a child who cannot
 * yet read the label, and by anyone who cannot distinguish the colours.
 *
 * Every string here is a compile-time constant. No user or API text is ever
 * interpolated into this markup, which is what makes injecting it as HTML safe.
 */

export type Mood = 'high' | 'good' | 'moderate' | 'poor' | 'bad';

const BODY: Record<Mood, { light: string; base: string; dark: string }> = {
  high: { light: '#9cc9ff', base: '#3987e5', dark: '#1f5fb8' },
  good: { light: '#8fe0b4', base: '#27a35f', dark: '#16733f' },
  moderate: { light: '#ffe68f', base: '#f2c230', dark: '#c4940d' },
  poor: { light: '#ffb877', base: '#ea7317', dark: '#b3520a' },
  bad: { light: '#f78bb0', base: '#d92b6a', dark: '#a01548' },
};

const INK = '#062a4f';

function face(mood: Mood): string {
  const eyes = (open: number) => `
    <ellipse cx="44" cy="84" rx="7.5" ry="${open}" fill="${INK}"/>
    <ellipse cx="76" cy="84" rx="7.5" ry="${open}" fill="${INK}"/>
    <circle cx="46.5" cy="81" r="2.4" fill="#fff"/>
    <circle cx="78.5" cy="81" r="2.4" fill="#fff"/>`;

  const cheeks = `
    <ellipse cx="33" cy="98" rx="7" ry="4.5" fill="#ff8fa3" opacity="0.55"/>
    <ellipse cx="87" cy="98" rx="7" ry="4.5" fill="#ff8fa3" opacity="0.55"/>`;

  switch (mood) {
    case 'high':
      return `${eyes(8.5)}${cheeks}
        <path d="M44 100 Q60 122 76 100 Z" fill="${INK}"/>
        <path d="M50 108 Q60 117 70 108 Q60 112 50 108 Z" fill="#ff7a90"/>`;
    case 'good':
      return `${eyes(8)}${cheeks}
        <path d="M46 102 Q60 115 74 102" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'moderate':
      return `${eyes(7.5)}
        <path d="M48 106 L72 106" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'poor':
      return `${eyes(7)}
        <path d="M34 70 L52 75" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <path d="M86 70 L68 75" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <path d="M47 110 Q60 99 73 110" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>`;
    case 'bad':
      return `${eyes(5)}
        <path d="M33 69 L53 76" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <path d="M87 69 L67 76" stroke="${INK}" stroke-width="4" stroke-linecap="round"/>
        <path d="M44 108 Q49 101 54 108 T64 108 T76 108" fill="none" stroke="${INK}" stroke-width="4.5" stroke-linecap="round"/>
        <path d="M95 60 Q101 70 95 76 Q89 70 95 60 Z" fill="#bfeaff" opacity="0.9"/>`;
  }
}

/** Inner SVG markup for Drip, drawn in a 120 × 140 box. `uid` keeps gradient ids unique. */
export function mascotMarkup(mood: Mood, uid = 'drip'): string {
  const c = BODY[mood];
  return `
    <defs>
      <linearGradient id="${uid}-body" x1="0.2" y1="0" x2="0.8" y2="1">
        <stop offset="0" stop-color="${c.light}"/>
        <stop offset="0.55" stop-color="${c.base}"/>
        <stop offset="1" stop-color="${c.dark}"/>
      </linearGradient>
    </defs>
    <ellipse cx="60" cy="134" rx="30" ry="4.5" fill="#010c1c" opacity="0.28"/>
    <path d="M60 6 C60 6 108 60 108 90 A48 48 0 0 1 12 90 C12 60 60 6 60 6 Z"
          fill="url(#${uid}-body)" stroke="#f1fbff" stroke-width="4" stroke-linejoin="round"/>
    <path d="M38 50 C30 62 26 72 26 84" fill="none" stroke="#fff" stroke-width="6"
          stroke-linecap="round" opacity="0.5"/>
    ${face(mood)}`;
}

export const toMood = (status: string | null | undefined): Mood =>
  status === 'high' || status === 'good' || status === 'poor' || status === 'bad'
    ? status
    : 'moderate';
