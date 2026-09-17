import { SOURCES, modelled } from './provenance';

/**
 * QBR — riparian quality index (Munné, Solà & Prat, 1998).
 *
 * QBR earns a full faithful implementation here for two reasons the research
 * made unambiguous. First, it is the most citizen-feasible index in the whole
 * assessment literature: it needs no taxonomy beyond telling a native tree from
 * an introduced one, and a trained volunteer completes it in about half an hour.
 * Second, in the Iberian reference dataset it is the *strongest single predictor*
 * of invertebrate community quality (β = 0.342, r = 0.705 against IBMWP) —
 * stronger than ammonium, conductivity or habitat structure. A volunteer who can
 * only do one thing well should do this one.
 *
 * Structure: four independent blocks, each clamped to 0–25, summed to 0–100.
 * Each block takes one base score by condition, then applies every applicable
 * modifier, then clamps. The clamp is per block and is load-bearing — without it
 * the modifiers would let one exceptional block compensate for another's
 * collapse, which the index is specifically designed to prevent.
 *
 * @see https://www.fehm.cat/wp-content/uploads/2025/03/Prot_QBR-english.pdf
 */

export const QBR_PROVENANCE = { ...SOURCES.QBR, kind: 'standard' as const };

/** Geomorphological type of the reach, from the margin-slope key on the protocol sheet. */
export type GeomorphType = 1 | 2 | 3;

export interface QbrInputs {
  // ─── Block 1: total riparian cover ─────────────────────────────────────────
  /** Riparian cover as a percentage of both banks, excluding annual plants. */
  readonly coverPct: number;
  /** Connectivity between riparian vegetation and adjacent woodland, percent. */
  readonly connectivityPct: number;

  // ─── Block 2: cover structure ──────────────────────────────────────────────
  readonly treeCoverPct: number;
  readonly shrubCoverPct: number;
  /** Share of the channel margin carrying helophytes or shrubs. */
  readonly helophyteChannelPct: number;
  /** Trees and shrubs occupy the same patches rather than separate ones. */
  readonly treesAndShrubsInterspersed: boolean;
  /** Vegetation forms discontinuous, isolated patches. */
  readonly patchyDiscontinuous: boolean;

  // ─── Block 3: cover quality ────────────────────────────────────────────────
  readonly geomorphType: GeomorphType;
  readonly nativeTreeSpecies: number;
  readonly nativeShrubSpecies: number;
  /** Continuous native tree community covering ≥75% of the edge riparian area. */
  readonly continuousTreeCommunityPct: number;
  readonly galleryStructure: boolean;
  readonly manMadeBuildings: boolean;
  readonly isolatedNonNativeTrees: boolean;
  readonly nonNativeTreeCommunities: boolean;
  readonly garbagePresent: boolean;

  // ─── Block 4: channel alteration ───────────────────────────────────────────
  readonly channelAlteration:
    'unmodified' | 'terraces_modified' | 'discontinuous_structures' | 'channelized';
  readonly rigidStructuresInBed: boolean;
  readonly transverseStructures: boolean;
}

export interface QbrBlockResult {
  readonly block: 1 | 2 | 3 | 4;
  readonly label: string;
  readonly base: number;
  readonly modifiers: ReadonlyArray<{ reason: string; delta: number }>;
  /** Clamped to 0–25. */
  readonly score: number;
}

export type QbrClass = 'natural' | 'good' | 'fair' | 'bad' | 'very_bad';

export interface QbrResult {
  /** 0–100. */
  readonly total: number;
  readonly qbrClass: QbrClass;
  readonly blocks: readonly QbrBlockResult[];
  readonly limitingBlock: QbrBlockResult;
}

const clampBlock = (v: number): number => Math.max(0, Math.min(25, v));

function block1(i: QbrInputs): QbrBlockResult {
  const base = i.coverPct > 80 ? 25 : i.coverPct >= 50 ? 10 : i.coverPct >= 10 ? 5 : 0;
  const modifiers: Array<{ reason: string; delta: number }> = [];

  if (i.connectivityPct >= 100)
    modifiers.push({ reason: 'Total connectivity to woodland', delta: 10 });
  else if (i.connectivityPct > 50) modifiers.push({ reason: 'Connectivity above 50%', delta: 5 });
  else if (i.connectivityPct >= 25) modifiers.push({ reason: 'Connectivity 25–50%', delta: -5 });
  else modifiers.push({ reason: 'Connectivity below 25%', delta: -10 });

  return {
    block: 1,
    label: 'Total riparian cover',
    base,
    modifiers,
    score: clampBlock(base + modifiers.reduce((s, m) => s + m.delta, 0)),
  };
}

function block2(i: QbrInputs): QbrBlockResult {
  let base: number;
  if (i.treeCoverPct > 75) base = 25;
  else if (i.treeCoverPct >= 50) base = 10;
  else if (i.treeCoverPct >= 25 && i.shrubCoverPct >= 25) base = 10;
  else if (i.treeCoverPct < 50 && i.shrubCoverPct >= 10 && i.shrubCoverPct <= 25) base = 5;
  else base = 0;

  const modifiers: Array<{ reason: string; delta: number }> = [];
  if (i.helophyteChannelPct >= 50) {
    modifiers.push({ reason: 'Helophytes or shrubs on ≥50% of channel', delta: 10 });
  } else if (i.helophyteChannelPct >= 25) {
    modifiers.push({ reason: 'Helophytes or shrubs on 25–50% of channel', delta: 5 });
  }
  if (i.treesAndShrubsInterspersed) {
    modifiers.push({ reason: 'Trees and shrubs in the same patches', delta: 5 });
  }
  if (i.patchyDiscontinuous) {
    modifiers.push({ reason: 'Trees and shrubs in separate discontinuous patches', delta: -5 });
  }
  if (i.treeCoverPct > 0 && i.shrubCoverPct < 50 && !i.patchyDiscontinuous) {
    modifiers.push({ reason: 'Regular trees with shrubland below 50%', delta: -10 });
  }

  return {
    block: 2,
    label: 'Cover structure',
    base,
    modifiers,
    score: clampBlock(base + modifiers.reduce((s, m) => s + m.delta, 0)),
  };
}

function block3(i: QbrInputs): QbrBlockResult {
  // Species-count thresholds shift with geomorphological type: a narrow
  // steep-margin reach cannot physically support the diversity a broad
  // alluvial one can, so scoring both against one threshold would penalise
  // the former for its geology rather than its condition.
  const thresholds: Record<GeomorphType, [number, number, number]> = {
    1: [2, 1, 0],
    2: [3, 2, 1],
    3: [4, 3, 1],
  };
  const [top, mid, low] = thresholds[i.geomorphType];
  const n = i.nativeTreeSpecies;
  const base = n >= top ? 25 : n >= mid ? 10 : n >= low ? 5 : 0;

  const modifiers: Array<{ reason: string; delta: number }> = [];
  if (i.continuousTreeCommunityPct >= 75) {
    modifiers.push({ reason: 'Continuous native tree community covering ≥75%', delta: 10 });
  } else if (i.continuousTreeCommunityPct >= 50) {
    modifiers.push({ reason: 'Near-continuous native tree community ≥50%', delta: 5 });
  }
  if (i.galleryStructure) modifiers.push({ reason: 'Gallery structure present', delta: 5 });

  const shrubThreshold = i.geomorphType + 2;
  if (i.nativeShrubSpecies > shrubThreshold) {
    modifiers.push({ reason: `Native shrub species above ${shrubThreshold}`, delta: 5 });
  }
  if (i.manMadeBuildings) modifiers.push({ reason: 'Man-made buildings present', delta: -5 });
  if (i.isolatedNonNativeTrees) {
    modifiers.push({ reason: 'Isolated non-native tree species', delta: -5 });
  }
  if (i.nonNativeTreeCommunities) {
    modifiers.push({ reason: 'Communities of non-native trees', delta: -10 });
  }
  if (i.garbagePresent) modifiers.push({ reason: 'Garbage present', delta: -10 });

  return {
    block: 3,
    label: 'Cover quality',
    base,
    modifiers,
    score: clampBlock(base + modifiers.reduce((s, m) => s + m.delta, 0)),
  };
}

function block4(i: QbrInputs): QbrBlockResult {
  const base =
    i.channelAlteration === 'unmodified'
      ? 25
      : i.channelAlteration === 'terraces_modified'
        ? 10
        : i.channelAlteration === 'discontinuous_structures'
          ? 5
          : 0;

  const modifiers: Array<{ reason: string; delta: number }> = [];
  if (i.rigidStructuresInBed)
    modifiers.push({ reason: 'Rigid structures in the river bed', delta: -10 });
  if (i.transverseStructures)
    modifiers.push({ reason: 'Transverse structures (weirs)', delta: -10 });

  return {
    block: 4,
    label: 'Channel alteration',
    base,
    modifiers,
    score: clampBlock(base + modifiers.reduce((s, m) => s + m.delta, 0)),
  };
}

/**
 * Classify a QBR total.
 *
 * The published bands leave gaps — 91–94, 71–74, 51–54, 26–29 — which are not
 * errors: QBR scores are always multiples of 5, so those values are unreachable
 * by construction. Implemented as inclusive lower bounds so that any total,
 * including ones the index cannot actually produce, still classifies.
 */
export function classifyQbr(total: number): QbrClass {
  if (total >= 95) return 'natural';
  if (total >= 75) return 'good';
  if (total >= 55) return 'fair';
  if (total >= 30) return 'bad';
  return 'very_bad';
}

export function computeQbr(inputs: QbrInputs): QbrResult {
  const blocks = [block1(inputs), block2(inputs), block3(inputs), block4(inputs)];
  const total = blocks.reduce((s, b) => s + b.score, 0);
  const limitingBlock = blocks.reduce(
    (worst, b) => (b.score < worst.score ? b : worst),
    blocks[0]!,
  );

  return { total, qbrClass: classifyQbr(total), blocks, limitingBlock };
}

/**
 * Approximate a QBR total from the coarse 0–3 riparian score that lightweight
 * protocols collect.
 *
 * This is an explicit degradation, not an equivalence. Full QBR resolves four
 * independent dimensions; a single 0–3 ordinal collapses them into one. The
 * mapping exists so that sites with only the coarse observation still contribute
 * to the pressure sub-index instead of dropping out, and any score relying on it
 * is marked lower-confidence rather than presented as a QBR result.
 */
export const approximateQbrFromOrdinal = (riparianScore: number) => ({
  total: [10, 35, 60, 85][Math.max(0, Math.min(3, Math.round(riparianScore)))] ?? 10,
  provenance: modelled(
    'Coarse 0–3 riparian ordinal mapped onto QBR band midpoints. Not a QBR assessment: full QBR resolves cover, structure, quality and channel alteration independently, and this mapping cannot recover which of them is limiting.',
  ),
});
