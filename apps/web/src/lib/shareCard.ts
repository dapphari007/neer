import type { SiteSummary } from './api';
import type { Comparison } from './kid';
import { kidStatus } from './kid';
import { mascotMarkup, toMood } from './mascot';

/**
 * The shareable stream card.
 *
 * A square image built as SVG and rasterised through a canvas, so it can be
 * handed to the system share sheet, downloaded, or attached to any post.
 *
 * **The disclosure is part of the picture.** These cards name real rivers, and
 * in this deployment the observations behind the score are simulated. A caption
 * can be edited or dropped the moment an image is reposted; pixels cannot. So
 * "demo data — simulated observations" is drawn into the image itself, where it
 * travels with every copy. Making something one-click shareable raises the bar
 * for how hard it must be to strip its caveats, not lowers it.
 */

const SIZE = 1080;
const FONT = `'Segoe UI', 'Helvetica Neue', Arial, sans-serif`;

/** Site names and comparison text originate outside this file — always escape. */
const esc = (value: string): string =>
  value.replace(
    /[&<>"']/g,
    (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;' })[c] ?? c,
  );

const STATUS_HEX: Record<string, string> = {
  high: '#3987e5',
  good: '#27a35f',
  moderate: '#f2c230',
  poor: '#ea7317',
  bad: '#d92b6a',
};

export function buildCardSvg(
  site: SiteSummary,
  comparisons: Comparison[],
  disclosure: 'simulated' | 'real',
): string {
  const kid = kidStatus(site.status);
  const score = site.sohi === null ? '–' : String(Math.round(site.sohi));
  const accent = STATUS_HEX[site.status ?? 'moderate'] ?? '#f2c230';

  // Names follow "River — reach"; breaking at the dash gives two tidy lines.
  const [river, reach] = site.name.split(' — ');

  const bubbles = Array.from({ length: 16 }, (_, i) => {
    const x = (i * 197 + 80) % SIZE;
    const y = (i * 131 + 140) % 900;
    const r = 8 + ((i * 7) % 22);
    return `<circle cx="${x}" cy="${y}" r="${r}" fill="#fff" opacity="0.07" stroke="#bfeaff" stroke-opacity="0.22" stroke-width="2"/>`;
  }).join('');

  const stars = Array.from(
    { length: 5 },
    (_, i) =>
      `<tspan fill="${i < kid.stars ? '#ffd166' : '#ffffff'}" fill-opacity="${i < kid.stars ? 1 : 0.22}">★</tspan>`,
  ).join('');

  const lines = comparisons
    .filter((c) => c.goodness > 0)
    .slice(0, 3)
    .map(
      (c, i) => `
      <g transform="translate(90, ${742 + i * 70})">
        <text x="0" y="0" font-size="44">${c.emoji}</text>
        <text x="74" y="-3" font-size="35" font-weight="600" fill="#f1fbff">${esc(c.like)}</text>
      </g>`,
    )
    .join('');

  const demoBand =
    disclosure === 'simulated'
      ? `<rect x="0" y="960" width="${SIZE}" height="120" fill="#031a36" opacity="0.92"/>
         <rect x="60" y="988" width="196" height="46" rx="23" fill="#ffd166"/>
         <text x="158" y="1020" text-anchor="middle" font-size="25" font-weight="800" fill="#3a2a00">DEMO DATA</text>
         <text x="276" y="1008" font-size="23" font-weight="600" fill="#b9d9ea">Simulated observations, real weather.</text>
         <text x="276" y="1040" font-size="23" font-weight="600" fill="#b9d9ea">Not a measurement of this stream.</text>
         <text x="1020" y="1024" text-anchor="end" font-size="27" font-weight="800" fill="#35e0d0">#OneAquaHealth</text>`
      : `<rect x="0" y="960" width="${SIZE}" height="120" fill="#031a36" opacity="0.92"/>
         <text x="60" y="1030" font-size="27" font-weight="600" fill="#b9d9ea">Citizen science stream health · neer</text>
         <text x="1020" y="1030" text-anchor="end" font-size="27" font-weight="800" fill="#35e0d0">#OneAquaHealth</text>`;

  return `<svg xmlns="http://www.w3.org/2000/svg" width="${SIZE}" height="${SIZE}" viewBox="0 0 ${SIZE} ${SIZE}" font-family="${FONT}">
  <defs>
    <linearGradient id="sea" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="#0e86a3"/>
      <stop offset="0.35" stop-color="#07406b"/>
      <stop offset="1" stop-color="#031a36"/>
    </linearGradient>
    <radialGradient id="sun" cx="0.5" cy="0" r="0.7">
      <stop offset="0" stop-color="#9cf0ff" stop-opacity="0.5"/>
      <stop offset="1" stop-color="#9cf0ff" stop-opacity="0"/>
    </radialGradient>
  </defs>

  <rect width="${SIZE}" height="${SIZE}" fill="url(#sea)"/>
  <rect width="${SIZE}" height="620" fill="url(#sun)"/>
  ${bubbles}

  <text x="60" y="98" font-size="46" font-weight="800" fill="#f1fbff" letter-spacing="1">Neer</text>
  <text x="1020" y="96" text-anchor="end" font-size="27" font-weight="700" fill="#b9d9ea" letter-spacing="4">STREAM REPORT</text>
  <rect x="60" y="124" width="960" height="3" rx="1.5" fill="#ffffff" opacity="0.18"/>

  <text x="60" y="212" font-size="60" font-weight="800" fill="#f1fbff">${esc(river ?? site.name)}</text>
  ${reach ? `<text x="60" y="268" font-size="38" font-weight="600" fill="#b9d9ea">${esc(reach)}</text>` : ''}

  <g transform="translate(84, 300) scale(2.55)">${mascotMarkup(toMood(site.status), 'card')}</g>

  <text x="470" y="470" font-size="200" font-weight="800" fill="#f1fbff">${score}<tspan font-size="64" fill="#b9d9ea" dx="10">/100</tspan></text>
  <rect x="470" y="502" width="${Math.max(260, kid.label.length * 27 + 60)}" height="68" rx="34" fill="${accent}"/>
  <text x="500" y="549" font-size="40" font-weight="800" fill="#ffffff">${esc(kid.label)}</text>
  <text x="470" y="640" font-size="58" letter-spacing="6">${stars}</text>

  ${lines}
  ${demoBand}
</svg>`;
}

/** Rasterise the card. Rejects rather than resolving with an empty image. */
export async function renderCardPng(svg: string): Promise<Blob> {
  const image = new Image();
  image.decoding = 'async';
  const loaded = new Promise<void>((resolve, reject) => {
    image.onload = () => resolve();
    image.onerror = () => reject(new Error('Could not draw the share card.'));
  });
  image.src = `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
  await loaded;

  const canvas = document.createElement('canvas');
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available in this browser.');
  ctx.drawImage(image, 0, 0, SIZE, SIZE);

  return new Promise<Blob>((resolve, reject) =>
    canvas.toBlob(
      (blob) => (blob ? resolve(blob) : reject(new Error('Could not create the image.'))),
      'image/png',
    ),
  );
}

export function buildCaption(
  site: SiteSummary,
  comparisons: Comparison[],
  disclosure: 'simulated' | 'real',
): string {
  const kid = kidStatus(site.status);
  const score = site.sohi === null ? '–' : Math.round(site.sohi);
  const highlight = comparisons.find((c) => c.goodness > 0);

  return [
    `🌊 ${site.name} scores ${score}/100 on the Stream One Health Index — "${kid.label}".`,
    highlight ? `${highlight.emoji} ${highlight.topic} ${highlight.like}.` : null,
    (site.sohi ?? 100) < 60
      ? 'This stream needs some care. Healthy streams mean healthy wildlife — and healthy people. 💙'
      : 'Healthy streams mean healthy wildlife — and healthy people. 💙',
    disclosure === 'simulated'
      ? '(Demo: simulated observations + real weather — not a measurement of this stream.)'
      : null,
    '#OneAquaHealth #CitizenScience #OneHealth',
  ]
    .filter(Boolean)
    .join('\n\n');
}
