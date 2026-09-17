import { useCallback, useEffect, useState } from 'react';

/**
 * Explorer progress — marks, visits, XP.
 *
 * Stored in localStorage, on this device only, and the UI says so wherever a
 * mark is made. That limit is deliberate for this build: the API is read-only by
 * design, and a child's map marks are not something to start collecting on a
 * server without consent flows that a hackathon prototype does not have. A mark
 * here is a personal field note, not a submitted observation, and it never feeds
 * the index.
 *
 * Every storage access is wrapped: private windows and blocked site data make
 * localStorage throw, and the game must degrade to "progress is not remembered",
 * never to a blank page.
 */

export interface Sticker {
  kind: string;
  emoji: string;
  label: string;
}

export const STICKERS: readonly Sticker[] = [
  { kind: 'litter', emoji: '🗑️', label: 'Litter' },
  { kind: 'foam', emoji: '🫧', label: 'Foam' },
  { kind: 'smell', emoji: '👃', label: 'Bad smell' },
  { kind: 'pipe', emoji: '🚰', label: 'Pipe' },
  { kind: 'fish', emoji: '🐟', label: 'Fish' },
  { kind: 'bird', emoji: '🦆', label: 'Bird' },
  { kind: 'bug', emoji: '🪲', label: 'Water bug' },
  { kind: 'clean', emoji: '✨', label: 'Clean spot' },
];

export interface Mark {
  id: string;
  kind: string;
  lat: number;
  lon: number;
  at: string;
}

interface GameState {
  xp: number;
  marks: Mark[];
  visited: string[];
  shares: number;
}

const EMPTY: GameState = { xp: 0, marks: [], visited: [], shares: 0 };
const KEY = 'neer.explorer.v1';

export const XP = { mark: 20, visit: 10, share: 30 } as const;

export const LEVELS = [
  { at: 0, name: 'Puddle Jumper' },
  { at: 60, name: 'Stream Scout' },
  { at: 150, name: 'River Ranger' },
  { at: 300, name: 'Water Guardian' },
  { at: 500, name: 'Ocean Legend' },
] as const;

export function levelFor(xp: number) {
  let index = 0;
  LEVELS.forEach((level, i) => {
    if (xp >= level.at) index = i;
  });
  const current = LEVELS[index]!;
  const next = LEVELS[index + 1];
  return {
    number: index + 1,
    name: current.name,
    nextName: next?.name ?? null,
    progress: next ? (xp - current.at) / (next.at - current.at) : 1,
    toNext: next ? next.at - xp : 0,
  };
}

function load(): GameState {
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return EMPTY;
    const parsed = JSON.parse(raw) as Partial<GameState>;
    return {
      xp: Number.isFinite(parsed.xp) ? Number(parsed.xp) : 0,
      marks: Array.isArray(parsed.marks) ? parsed.marks.slice(0, 200) : [],
      visited: Array.isArray(parsed.visited) ? parsed.visited : [],
      shares: Number.isFinite(parsed.shares) ? Number(parsed.shares) : 0,
    };
  } catch {
    return EMPTY;
  }
}

export function useGame() {
  const [state, setState] = useState<GameState>(load);

  useEffect(() => {
    try {
      window.localStorage.setItem(KEY, JSON.stringify(state));
    } catch {
      // Storage unavailable — play on without remembering.
    }
  }, [state]);

  const addMark = useCallback((kind: string, lat: number, lon: number) => {
    setState((s) => ({
      ...s,
      xp: s.xp + XP.mark,
      marks: [
        ...s.marks,
        {
          id: `${Date.now()}-${Math.round(Math.random() * 1e6)}`,
          kind,
          lat,
          lon,
          at: new Date().toISOString(),
        },
      ].slice(-200),
    }));
  }, []);

  // Removing a mark takes its XP back, so the quickest route up the levels is
  // not "mark and delete the same spot fifty times".
  const removeMark = useCallback((id: string) => {
    setState((s) =>
      s.marks.some((m) => m.id === id)
        ? { ...s, xp: Math.max(0, s.xp - XP.mark), marks: s.marks.filter((m) => m.id !== id) }
        : s,
    );
  }, []);

  const visit = useCallback((siteId: string) => {
    setState((s) =>
      s.visited.includes(siteId)
        ? s
        : { ...s, xp: s.xp + XP.visit, visited: [...s.visited, siteId] },
    );
  }, []);

  const recordShare = useCallback(() => {
    setState((s) => ({ ...s, xp: s.xp + XP.share, shares: s.shares + 1 }));
  }, []);

  const reset = useCallback(() => setState(EMPTY), []);

  return { ...state, level: levelFor(state.xp), addMark, removeMark, visit, recordShare, reset };
}

export type Game = ReturnType<typeof useGame>;
