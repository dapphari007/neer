import { createHash } from 'node:crypto';
import type { ObservationRow } from '../rows';

/**
 * OneAquaHealth CSV import — batch ingestion in the project's own vocabulary.
 *
 * The OneAquaHealth data platform (apps.oneaquahealth) collects field data by
 * CSV upload against a fixed parameter code list — ATC, WTC, WDO_MG, WPH,
 * WCON_US and so on. This importer reads that format, so data already gathered
 * under the project's protocols can be scored by Neer without anyone retyping a
 * column. Real-time ingestion and batch import land in the same table and are
 * scored by the same function; the difference is only how they arrive.
 *
 * Two layouts are accepted, because platforms export both:
 *
 *   wide — one row per visit, one column per parameter code:
 *          site_id,date,time,ATC,WTC,WDO_MG,WPH,WCON_US,...
 *   long — one row per measurement:
 *          site_id,date,time,code,value
 *
 * Column names are matched case-insensitively and ignore spaces, hyphens and
 * underscores, so "WDO MG", "wdo_mg" and "WDO-MG" are the same code. Unknown
 * codes are reported, not silently dropped, and no value is ever guessed: a
 * blank cell is an absent measurement.
 *
 * The exact column set of the platform's template has not been verified against
 * a downloaded file — the code list below is what its Water Parameters page
 * publishes. Anyone importing a real export should check the report this
 * function returns before trusting a run: it names every column it could not
 * place.
 */

/** OneAquaHealth water-parameter codes → observation fields. */
export const OAH_CODES: Record<
  string,
  { field: keyof ObservationRow | 'skip'; label: string; unit: string }
> = {
  ATC: { field: 'skip', label: 'Air temperature', unit: '°C' },
  WTC: { field: 'water_temp_c', label: 'Water temperature', unit: '°C' },
  WDO_MG: { field: 'dissolved_oxygen_mgl', label: 'Dissolved oxygen', unit: 'mg/L' },
  WDO_PC: { field: 'skip', label: 'Dissolved oxygen saturation', unit: '%' },
  WPH: { field: 'ph', label: 'pH', unit: '' },
  WCON_US: { field: 'conductivity_uscm', label: 'Conductivity', unit: 'µS/cm' },
  WTDS_MG: { field: 'skip', label: 'Total dissolved solids', unit: 'mg/L' },
  WTURB_NTU: { field: 'turbidity_ntu', label: 'Turbidity', unit: 'NTU' },
  WNO3_MG: { field: 'nitrate_mgl', label: 'Nitrate', unit: 'mg/L' },
  WPO4_MG: { field: 'phosphate_mgl', label: 'Phosphate', unit: 'mg/L' },
  WNH4_MG: { field: 'ammonium_mgl', label: 'Ammonium', unit: 'mg/L' },
  // Hydromorphology — recorded by the protocol, not consumed by the index yet.
  FCV_VI: { field: 'skip', label: 'Flow velocity (i)', unit: 'm/s' },
  FCV_VII: { field: 'skip', label: 'Flow velocity (ii)', unit: 'm/s' },
  FCV_VIII: { field: 'skip', label: 'Flow velocity (iii)', unit: 'm/s' },
  WCD_DI: { field: 'skip', label: 'Water depth (i)', unit: 'cm' },
  WCD_DII: { field: 'skip', label: 'Water depth (ii)', unit: 'cm' },
  WCD_DIII: { field: 'skip', label: 'Water depth (iii)', unit: 'cm' },
  WW_WI: { field: 'skip', label: 'Water width (i)', unit: 'm' },
  WW_WII: { field: 'skip', label: 'Water width (ii)', unit: 'm' },
  WW_WIII: { field: 'skip', label: 'Water width (iii)', unit: 'm' },
};

/** Columns that identify the visit rather than measure anything. */
const SITE_COLUMNS = [
  'site_id',
  'siteid',
  'site',
  'site_code',
  'sitecode',
  'station',
  'site_number',
  'sitenumber',
];
const DATE_COLUMNS = ['date', 'sampling_date', 'sample_date', 'day'];
const TIME_COLUMNS = ['time', 'sampling_time', 'sample_time'];
const DATETIME_COLUMNS = ['datetime', 'timestamp', 'observed_at', 'sampled_at'];
const OBSERVER_COLUMNS = ['observer', 'observer_id', 'user', 'volunteer', 'recorded_by'];
const CODE_COLUMNS = ['code', 'parameter', 'parameter_code', 'variable'];
const VALUE_COLUMNS = ['value', 'measurement', 'result'];

const norm = (s: string): string =>
  s
    .trim()
    .toUpperCase()
    .replace(/[\s\-_.()]+/g, '_')
    .replace(/^_|_$/g, '');
const normKey = (s: string): string => norm(s).toLowerCase();

export interface OahImportReport {
  layout: 'wide' | 'long' | 'unknown';
  rowsRead: number;
  observations: number;
  skippedRows: number;
  unknownCodes: string[];
  ignoredCodes: string[];
  siteRefs: string[];
  problems: string[];
}

export interface OahParsedVisit {
  /** Whatever the site column held — resolved to a Neer site id by the caller. */
  siteRef: string;
  observedAt: Date;
  observerId: string;
  values: Partial<Record<Exclude<keyof ObservationRow, 'taxa_groups' | 'taxa_abundance'>, number>>;
}

/**
 * Sniff the delimiter from the header line.
 *
 * Continental exports use semicolons and decimal commas; treating both `,` and
 * `;` as delimiters would split "7,3" into two cells. One file, one delimiter:
 * semicolon if the header has one, otherwise comma.
 */
export function sniffDelimiter(text: string): ',' | ';' {
  const header = text.split(/\r?\n/, 1)[0] ?? '';
  return header.includes(';') ? ';' : ',';
}

/** Minimal RFC 4180 parser: quoted fields, doubled quotes, CRLF, one delimiter. */
export function parseCsv(text: string, delimiter: ',' | ';' = sniffDelimiter(text)): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i]!;
    if (quoted) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else quoted = false;
      } else field += c;
    } else if (c === '"') quoted = true;
    else if (c === delimiter) {
      row.push(field);
      field = '';
    } else if (c === '\n' || c === '\r') {
      if (c === '\r' && text[i + 1] === '\n') i++;
      row.push(field);
      field = '';
      if (row.some((f) => f.trim() !== '')) rows.push(row);
      row = [];
    } else field += c;
  }
  row.push(field);
  if (row.some((f) => f.trim() !== '')) rows.push(row);
  return rows;
}

function parseWhen(date: string, time: string, datetime: string): Date | null {
  const raw = datetime.trim() || `${date.trim()}${time.trim() ? `T${time.trim()}` : ''}`;
  if (!raw) return null;
  // Accept ISO, and the European day-first form the protocol sheets use.
  const eu = raw.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:[ T](\d{1,2}):(\d{2}))?/);
  const parsed = eu
    ? new Date(Date.UTC(+eu[3]!, +eu[2]! - 1, +eu[1]!, +(eu[4] ?? 12), +(eu[5] ?? 0)))
    : new Date(raw.includes('T') || raw.includes(' ') ? raw : `${raw}T12:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function toNumber(raw: string): number | null {
  const cleaned = raw.trim().replace(',', '.');
  if (cleaned === '' || /^(na|n\/a|null|-)$/i.test(cleaned)) return null;
  const n = Number(cleaned);
  return Number.isFinite(n) ? n : null;
}

/** Parse the CSV into visits. Site references are left unresolved for the caller. */
export function parseOahCsv(text: string): { visits: OahParsedVisit[]; report: OahImportReport } {
  const rows = parseCsv(text.replace(/^﻿/, ''));
  const report: OahImportReport = {
    layout: 'unknown',
    rowsRead: Math.max(0, rows.length - 1),
    observations: 0,
    skippedRows: 0,
    unknownCodes: [],
    ignoredCodes: [],
    siteRefs: [],
    problems: [],
  };
  if (rows.length < 2) {
    report.problems.push('No data rows found.');
    return { visits: [], report };
  }

  const header = rows[0]!.map(normKey);
  const col = (names: string[]) => header.findIndex((h) => names.includes(h));
  const siteCol = col(SITE_COLUMNS);
  const dateCol = col(DATE_COLUMNS);
  const timeCol = col(TIME_COLUMNS);
  const datetimeCol = col(DATETIME_COLUMNS);
  const observerCol = col(OBSERVER_COLUMNS);
  const codeCol = col(CODE_COLUMNS);
  const valueCol = col(VALUE_COLUMNS);

  if (siteCol < 0)
    report.problems.push('No site column (expected one of: site_id, site, station).');
  if (dateCol < 0 && datetimeCol < 0)
    report.problems.push('No date column (expected one of: date, datetime, timestamp).');
  if (report.problems.length) return { visits: [], report };

  const unknown = new Set<string>();
  const ignored = new Set<string>();
  const siteRefs = new Set<string>();
  const visitsByKey = new Map<string, OahParsedVisit>();

  const visitFor = (cells: string[]): OahParsedVisit | null => {
    const siteRef = (cells[siteCol] ?? '').trim();
    const when = parseWhen(
      cells[dateCol] ?? '',
      timeCol >= 0 ? (cells[timeCol] ?? '') : '',
      datetimeCol >= 0 ? (cells[datetimeCol] ?? '') : '',
    );
    if (!siteRef || !when) return null;
    const observerId =
      observerCol >= 0 && (cells[observerCol] ?? '').trim()
        ? (cells[observerCol] ?? '').trim()
        : 'oah-csv';
    const key = `${siteRef}|${when.toISOString()}|${observerId}`;
    let visit = visitsByKey.get(key);
    if (!visit) {
      visit = { siteRef, observedAt: when, observerId, values: {} };
      visitsByKey.set(key, visit);
      siteRefs.add(siteRef);
    }
    return visit;
  };

  const apply = (visit: OahParsedVisit, code: string, raw: string) => {
    const spec = OAH_CODES[norm(code)];
    if (!spec) {
      unknown.add(code);
      return;
    }
    if (spec.field === 'skip') {
      ignored.add(code);
      return;
    }
    const n = toNumber(raw);
    if (n !== null) (visit.values as Record<string, number>)[spec.field] = n;
  };

  const isLong = codeCol >= 0 && valueCol >= 0;
  report.layout = isLong ? 'long' : 'wide';

  const parameterCols = isLong
    ? []
    : header
        .map((h, i) => ({ i, code: rows[0]![i]! }))
        .filter(({ i }) => ![siteCol, dateCol, timeCol, datetimeCol, observerCol].includes(i));

  for (const cells of rows.slice(1)) {
    const visit = visitFor(cells);
    if (!visit) {
      report.skippedRows++;
      continue;
    }
    if (isLong) apply(visit, cells[codeCol] ?? '', cells[valueCol] ?? '');
    else for (const { i, code } of parameterCols) apply(visit, code, cells[i] ?? '');
  }

  const visits = [...visitsByKey.values()].filter((v) => Object.keys(v.values).length > 0);
  report.observations = visits.length;
  report.unknownCodes = [...unknown].sort();
  report.ignoredCodes = [...ignored].sort();
  report.siteRefs = [...siteRefs].sort();
  return { visits, report };
}

/** Deterministic id per visit so re-importing the same file cannot duplicate it after a merge. */
function visitUuid(siteId: string, observedAt: Date, observerId: string): string {
  const hex = createHash('sha1')
    .update(`${siteId}|${observedAt.toISOString()}|${observerId}`)
    .digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-${((parseInt(hex[16]!, 16) & 0x3) | 0x8).toString(16)}${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/** Turn resolved visits into observation rows. `resolveSite` maps a CSV reference to a Neer site id, or null. */
export function visitsToRows(
  visits: readonly OahParsedVisit[],
  resolveSite: (ref: string) => string | null,
  source = 'oah-csv',
): { rows: ObservationRow[]; unresolved: string[] } {
  const rows: ObservationRow[] = [];
  const unresolved = new Set<string>();
  for (const v of visits) {
    const siteId = resolveSite(v.siteRef);
    if (!siteId) {
      unresolved.add(v.siteRef);
      continue;
    }
    rows.push({
      observation_id: visitUuid(siteId, v.observedAt, v.observerId),
      site_id: siteId,
      observed_at: v.observedAt.toISOString().slice(0, 23).replace('T', ' '),
      observer_id: v.observerId,
      // Protocol sampling is done by trained teams with probes, not test strips.
      observer_experience: 'trained',
      method: 'handheld_probe',
      source,
      photo_count: 0,
      water_temp_c: v.values.water_temp_c ?? null,
      ph: v.values.ph ?? null,
      dissolved_oxygen_mgl: v.values.dissolved_oxygen_mgl ?? null,
      conductivity_uscm: v.values.conductivity_uscm ?? null,
      turbidity_ntu: v.values.turbidity_ntu ?? null,
      nitrate_mgl: v.values.nitrate_mgl ?? null,
      phosphate_mgl: v.values.phosphate_mgl ?? null,
      ammonium_mgl: v.values.ammonium_mgl ?? null,
      water_colour: 'clear',
      odour: 'none',
      foam_present: 0,
      surface_film: 0,
      litter_score: 0,
      algae_cover_pct: null,
      flow_state: 'normal',
      riparian_score: 0,
      visible_discharge: 0,
      taxa_groups: [],
      taxa_abundance: [],
      notes: '',
    });
  }
  return { rows, unresolved: [...unresolved].sort() };
}
