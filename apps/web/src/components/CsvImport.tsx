import { useState } from 'react';

/**
 * Upload a OneAquaHealth-format CSV.
 *
 * Only shown on the live build — the static export has no API to send it to.
 * The first pass is always a dry run: the coordinator sees which columns and
 * sites the importer understood before a single row is written. Importing what
 * a machine "mostly" understood is how wrong data gets a confident score.
 */
export function CsvImport({ apiBase }: { apiBase: string }) {
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);

  const send = async (dryRun: boolean) => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch(`${apiBase}/api/import/oah-csv${dryRun ? '?dryRun=1' : ''}`, {
        method: 'POST',
        headers: { 'Content-Type': 'text/csv' },
        body: await file.text(),
      });
      const payload = (await response.json()) as {
        data?: Record<string, unknown>;
        message?: unknown;
      };
      if (!response.ok) {
        setError(
          Array.isArray(payload.message) ? payload.message.join(' ') : String(payload.message),
        );
        setResult(null);
      } else {
        setResult(payload.data ?? null);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause));
    } finally {
      setBusy(false);
    }
  };

  const report = result?.report as
    | {
        layout: string;
        rowsRead: number;
        observations: number;
        unknownCodes: string[];
        ignoredCodes: string[];
      }
    | undefined;
  const unresolved = (result?.unresolvedSites as string[] | undefined) ?? [];

  return (
    <div className="card">
      <div className="card-head">
        <h2 className="card-title">Import OneAquaHealth data</h2>
        <p className="card-sub">
          Upload a CSV in the OneAquaHealth platform's own parameter codes (WTC, WDO_MG, WPH,
          WCON_US…). Wide or long layout; site references are matched to Neer sites by id, provider
          reference or name. Check the dry run first — nothing is written until you import.
        </p>
      </div>
      <div style={{ padding: '14px 18px 18px', display: 'flex', flexDirection: 'column', gap: 12 }}>
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={(event) => {
            setFile(event.currentTarget.files?.[0] ?? null);
            setResult(null);
            setError(null);
          }}
          style={{ fontSize: 13 }}
        />
        <div className="share-row">
          <button
            type="button"
            className="btn btn-sm"
            disabled={!file || busy}
            onClick={() => send(true)}
          >
            Dry run
          </button>
          <button
            type="button"
            className="btn btn-sm btn-primary"
            disabled={!file || busy || !result || result.dryRun !== true}
            onClick={() => send(false)}
            title={!result || result.dryRun !== true ? 'Run a dry run first' : undefined}
          >
            Import
          </button>
        </div>

        {error && (
          <p style={{ color: 'var(--coral)', fontWeight: 800, fontSize: 13 }} role="alert">
            {error}
          </p>
        )}

        {result && report && (
          <div className="action-text" style={{ fontSize: 13 }}>
            <strong>{result.dryRun ? 'Dry run' : 'Imported'}</strong> · layout {report.layout} ·{' '}
            {report.rowsRead} rows read · {report.observations} visits parsed ·{' '}
            {String(result.dryRun ? result.wouldImport : result.imported)} to{' '}
            {(result.siteIds as string[]).length} site(s)
            {unresolved.length > 0 && (
              <div style={{ color: 'var(--sun)', marginTop: 6 }}>
                Not matched to any site (skipped): {unresolved.join(', ')}
              </div>
            )}
            {report.unknownCodes.length > 0 && (
              <div style={{ color: 'var(--text-muted)', marginTop: 6 }}>
                Unknown codes ignored: {report.unknownCodes.join(', ')}
              </div>
            )}
            {report.ignoredCodes.length > 0 && (
              <div style={{ color: 'var(--text-muted)', marginTop: 4 }}>
                Recorded by the protocol but not scored yet: {report.ignoredCodes.join(', ')}
              </div>
            )}
            {!result.dryRun && (
              <div style={{ marginTop: 6 }}>
                Sites re-scored within seconds; watch the live indicator.
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
