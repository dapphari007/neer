/**
 * Threshold provenance.
 *
 * Every numeric cutoff in this package is tagged with where it came from. This
 * is not documentation hygiene — it is the mechanism that keeps the system
 * honest in public.
 *
 * An environmental index is a chain of numbers, and a reader has no way to tell
 * a legally binding limit from something the author invented on a Tuesday unless
 * the code says which is which. Neer therefore refuses to let a threshold exist
 * without a provenance tag: the type system requires one, the methodology doc is
 * generated from these tags, and the UI surfaces the tag next to any score that
 * depends on a `modelled` value.
 *
 * The practical consequence is that "this stream is Poor" can always be traced
 * to either a citable standard or an explicitly flagged assumption, and never
 * hides in between.
 */

export type ProvenanceKind =
  /**
   * Taken verbatim from a legal instrument, standard, or peer-reviewed index
   * definition. The number is not ours and must not be silently changed.
   */
  | 'standard'
  /**
   * Arithmetically derived from a `standard` value — a unit conversion, a
   * percentile restatement, or an interpolation between published class
   * boundaries. Traceable, but one step removed.
   */
  | 'derived'
  /**
   * Our own construct. Defensible and documented, but not backed by a published
   * boundary. Anything tagged this way is a calibration target, and the
   * methodology doc says so explicitly rather than implying authority we do not
   * have.
   */
  | 'modelled';

export interface Provenance {
  readonly kind: ProvenanceKind;
  /** Short citation shown in the UI and written into finding records. */
  readonly source: string;
  /** Resolvable identifier — DOI, CELEX number, or URL. */
  readonly ref: string;
  /** Why this value, and what would have to be true for it to be wrong. */
  readonly note?: string;
}

/** A numeric threshold that cannot exist without saying where it came from. */
export interface Cited<T> {
  readonly value: T;
  readonly provenance: Provenance;
}

export const cite = <T>(value: T, provenance: Provenance): Cited<T> => ({ value, provenance });

// ─── Sources referenced throughout this package ──────────────────────────────

export const SOURCES = {
  BATHING_WATER_DIRECTIVE: {
    kind: 'standard',
    source: 'EU Bathing Water Directive 2006/7/EC, Annex I',
    ref: 'CELEX:32006L0007',
  },
  CCME_WQI: {
    kind: 'standard',
    source: "CCME Water Quality Index 1.0 User's Manual",
    ref: 'https://ccme.ca/en/res/wqimanualen.pdf',
  },
  QBR: {
    kind: 'standard',
    source: 'Munné, Solà & Prat (1998), QBR riparian quality index protocol',
    ref: 'https://www.fehm.cat/wp-content/uploads/2025/03/Prot_QBR-english.pdf',
  },
  IBMWP: {
    kind: 'standard',
    source: 'Alba-Tercedor et al. (2002), Limnetica 21(2):175 — IBMWP class boundaries',
    ref: 'https://www.limnetica.com/documentos/limnetica/limnetica-21-2-p-175.pdf',
  },
  WHPT_EQR: {
    kind: 'standard',
    source: 'UKTAG Annex 4, Rivers Invertebrates WHPT — EQR class boundaries',
    ref: 'https://www.wfduk.org/sites/default/files/Media/Environmental%20standards/Annex%204%20Rivers%20Invertebrates%20WHPT.pdf',
  },
  UKTAG_CLASSIFICATION: {
    kind: 'standard',
    source: 'UKTAG (2009), Recommendations on Surface Water Status Classification',
    ref: 'https://www.wfduk.org/sites/default/files/Media/Characterisation%20of%20the%20water%20environment/Recommendations%20on%20surface%20water%20status%20classification_Final_010609.pdf',
  },
  WHO_RECREATIONAL: {
    kind: 'standard',
    source: 'WHO (2021), Guidelines on Recreational Water Quality, Vol. 1',
    ref: 'https://www.ncbi.nlm.nih.gov/books/NBK572625/',
  },
  ECDC_WNV: {
    kind: 'standard',
    source: 'ECDC, West Nile virus factsheet; Vogels et al. thermal competence range',
    ref: 'https://www.ecdc.europa.eu/en/west-nile-fever/facts',
  },
  UWWTD_ART17: {
    kind: 'standard',
    source: 'Recast Urban Wastewater Treatment Directive, Article 17 (AMR surveillance)',
    ref: 'https://environment.ec.europa.eu/news/antimicrobial-resistance-could-be-traced-through-wastewater-under-one-health-approach-2026-08-19_en',
  },
  OAH_INDICATORS: {
    kind: 'standard',
    source: 'OneAquaHealth Key Indicators of Ecosystem and Biological Health — Factsheets',
    ref: 'https://doi.org/10.5281/zenodo.20345207',
  },
  OAH_PROTOCOLS: {
    kind: 'standard',
    source: 'OneAquaHealth Field Sampling Protocols for Urban Stream Ecosystems',
    ref: 'https://doi.org/10.5281/zenodo.20344421',
  },
  NEER_MODEL: {
    kind: 'modelled',
    source: 'Neer scoring model — our own construct, pending field calibration',
    ref: 'docs/INDEX_METHODOLOGY.md',
  },
} as const satisfies Record<string, Omit<Provenance, 'note'>>;

/** Build a `modelled` provenance with a mandatory justification. */
export const modelled = (note: string): Provenance => ({
  ...SOURCES.NEER_MODEL,
  kind: 'modelled',
  note,
});
