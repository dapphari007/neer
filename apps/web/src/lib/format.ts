/**
 * Formatting and the shared visual vocabulary.
 *
 * Colour lookups live here rather than inline so the token names stay the single
 * source of truth — the validated palette is defined once in `theme.css` and
 * read through CSS custom properties, never re-typed as hex in a component.
 */

export const STATUS_ORDER = ['bad', 'poor', 'moderate', 'good', 'high'] as const;
export type StatusClass = (typeof STATUS_ORDER)[number];

export const SEVERITY_ORDER = ['info', 'watch', 'elevated', 'high'] as const;
export type Severity = (typeof SEVERITY_ORDER)[number];

/**
 * Status colour — the Water Framework Directive's statutory colour code.
 *
 * Blue / green / yellow / orange / red for high / good / moderate / poor / bad is
 * what every river status map in Europe uses, and what a child already reads as
 * "good to bad". The steps in `theme.css` were tuned until they cleared
 * colour-blind separation, a normal-vision difference floor and contrast on the
 * chart surface. Yellow cannot sit inside the lightness band — that is what
 * yellow is — so colour is never the only carrier: every use pairs it with the
 * number, a mascot face, or a written label.
 */
export const statusColor = (status: string | null | undefined): string =>
  `var(--status-${status && STATUS_ORDER.includes(status as StatusClass) ? status : 'moderate'})`;

export const severityColor = (severity: string): string =>
  `var(--sev-${SEVERITY_ORDER.includes(severity as Severity) ? severity : 'info'})`;

/** Status colours carry no meaning alone — every one is paired with a glyph. */
export const severityGlyph = (severity: string): string =>
  ({ info: 'i', watch: '!', elevated: '!!', high: '!!!' })[severity] ?? 'i';

export const severityLabel = (severity: string): string =>
  ({ info: 'Information', watch: 'Watch', elevated: 'Elevated', high: 'High' })[severity] ??
  severity;

export const domainLabel = (domain: string): string =>
  ({
    ecological: 'Ecological',
    pressure: 'Pressure',
    human_health: 'Human health',
    animal_health: 'Animal health',
    data_quality: 'Data quality',
  })[domain] ?? domain;

export const urbanClassLabel = (urbanClass: string): string =>
  ({ urban_core: 'Urban core', peri_urban: 'Peri-urban', semi_natural: 'Semi-natural' })[
    urbanClass
  ] ?? urbanClass;

export const statusLabel = (status: string | null | undefined): string =>
  status ? status.charAt(0).toUpperCase() + status.slice(1) : 'No data';

/** One decimal, or an em dash. Never "0" for absent — they mean different things. */
export const num = (value: number | null | undefined, digits = 1): string =>
  value === null || value === undefined || !Number.isFinite(value) ? '—' : value.toFixed(digits);

export const pct = (value: number | null | undefined): string =>
  value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${Math.round(value * 100)}%`;

export const shortDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'short',
    timeZone: 'UTC',
  });

export const longDate = (iso: string): string =>
  new Date(`${iso}T00:00:00Z`).toLocaleDateString('en-GB', {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
    timeZone: 'UTC',
  });
