import { describe, expect, it } from 'vitest';
import { parseCsv, parseOahCsv, visitsToRows } from './oahCsv';
import { prettifyLabel } from '../sensors/ea';

describe('parseCsv', () => {
  it('handles quoted fields, doubled quotes and CRLF', () => {
    const rows = parseCsv('a,b\r\n"x, y","say ""hi"""\r\n1,2\r\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
      ['1', '2'],
    ]);
  });

  it('sniffs a semicolon delimiter and keeps decimal commas intact', () => {
    const rows = parseCsv('a;b\n7,3;x');
    expect(rows).toEqual([
      ['a', 'b'],
      ['7,3', 'x'],
    ]);
  });
});

describe('parseOahCsv — wide layout', () => {
  const csv = [
    'site_id,date,time,ATC,WTC,WDO_MG,WDO_PC,WPH,WCON_US,WTDS_MG,FCV_VI,WEIRD',
    'CBR-COV-02,2026-06-01,09:30,21.5,18.2,7.9,88,7.6,410,270,0.4,99',
    'CBR-COV-02,2026-06-01,09:30,,,,,,,,,',
    'CBR-CEI-01,01/06/2026,10:15,19,15.1,9.8,,7.2,140,90,0.9,',
  ].join('\n');

  it('recognises the OneAquaHealth parameter codes and folds a visit', () => {
    const { visits, report } = parseOahCsv(csv);
    expect(report.layout).toBe('wide');
    expect(visits).toHaveLength(2);
    const cov = visits.find((v) => v.siteRef === 'CBR-COV-02')!;
    expect(cov.values.water_temp_c).toBe(18.2);
    expect(cov.values.dissolved_oxygen_mgl).toBe(7.9);
    expect(cov.values.ph).toBe(7.6);
    expect(cov.values.conductivity_uscm).toBe(410);
  });

  it('reports unknown codes instead of silently dropping them', () => {
    const { report } = parseOahCsv(csv);
    expect(report.unknownCodes).toEqual(['WEIRD']);
    // Recorded by the protocol but not consumed by the index — named, not lost.
    expect(report.ignoredCodes).toEqual(
      expect.arrayContaining(['ATC', 'WDO_PC', 'WTDS_MG', 'FCV_VI']),
    );
  });

  it('accepts day-first European dates', () => {
    const { visits } = parseOahCsv(csv);
    const cei = visits.find((v) => v.siteRef === 'CBR-CEI-01')!;
    expect(cei.observedAt.toISOString()).toBe('2026-06-01T10:15:00.000Z');
  });

  it('treats a blank cell as an absent measurement, never as zero', () => {
    const { visits } = parseOahCsv('site,date,WDO_MG,WPH\nS1,2026-06-01,,7.1');
    expect(visits[0]!.values.dissolved_oxygen_mgl).toBeUndefined();
    expect(visits[0]!.values.ph).toBe(7.1);
  });
});

describe('parseOahCsv — long layout', () => {
  it('folds one-row-per-measurement into one visit', () => {
    // Semicolon-delimited with a European decimal comma, as continental exports are.
    const csv = [
      'station;datetime;code;value',
      'S1;2026-06-02T08:00:00Z;WTC;16.4',
      'S1;2026-06-02T08:00:00Z;WDO MG;8.8',
      'S1;2026-06-02T08:00:00Z;wph;7,3',
    ].join('\n');
    const { visits, report } = parseOahCsv(csv);
    expect(report.layout).toBe('long');
    expect(visits).toHaveLength(1);
    expect(visits[0]!.values).toEqual({ water_temp_c: 16.4, dissolved_oxygen_mgl: 8.8, ph: 7.3 });
  });

  it('explains what is missing when the header is unusable', () => {
    const { visits, report } = parseOahCsv('foo,bar\n1,2');
    expect(visits).toHaveLength(0);
    expect(report.problems.join(' ')).toMatch(/site column/i);
  });
});

describe('visitsToRows', () => {
  it('resolves site references and lists the ones it cannot', () => {
    const { visits } = parseOahCsv('site,date,WTC\nknown,2026-06-01,15\nmystery,2026-06-01,16');
    const { rows, unresolved } = visitsToRows(visits, (ref) =>
      ref === 'known' ? 'CBR-CEI-01' : null,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]!.site_id).toBe('CBR-CEI-01');
    expect(unresolved).toEqual(['mystery']);
  });

  it('gives the same visit the same id every time, so a re-import is not a duplicate', () => {
    const { visits } = parseOahCsv('site,date,WTC\nknown,2026-06-01,15');
    const a = visitsToRows(visits, () => 'CBR-CEI-01').rows[0]!.observation_id;
    const b = visitsToRows(visits, () => 'CBR-CEI-01').rows[0]!.observation_id;
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
});

describe('EA station labels', () => {
  it('turns the agency naming convention into something a person would say', () => {
    expect(prettifyLabel('LEE_SPRINGFIELD PARK_K_201906')).toEqual({
      river: 'Lee',
      place: 'Springfield Park',
    });
    expect(prettifyLabel('BADSEY BROOK DS SILT REMOVAL')).toEqual({
      river: 'Badsey Brook Downstream Silt Removal',
      place: '',
    });
  });
});
