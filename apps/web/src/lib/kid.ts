import type { Measurements } from './api';

/**
 * Plain-language layer.
 *
 * Turns measurements into comparisons a ten-year-old already has a feeling for.
 * "Turbidity 46 NTU" means nothing; "about as cloudy as tea with milk" does.
 *
 * Two rules keep this honest rather than merely cute:
 *
 *  1. **Comparisons come from the measured value, never from the composite
 *     score.** A comparison about water clarity is driven by the turbidity
 *     reading. If a parameter was not measured, its card says so — it does not
 *     borrow a guess from the index.
 *
 *  2. **The real number is always shown underneath.** The analogy is a way in,
 *     not a replacement. A curious child, a parent or a teacher can see exactly
 *     what was measured, and the analogies are worded as "about as" rather than
 *     as equivalences, because tea with milk is not a calibrated standard.
 */

export interface Comparison {
  key: string;
  emoji: string;
  topic: string;
  like: string;
  why: string;
  real: string;
  /** 0–1, how good this is. Drives the little meter. */
  goodness: number;
}

type Band<T> = { upTo: number; value: T };
const pick = <T>(v: number, bands: Band<T>[]): T =>
  (bands.find((b) => v <= b.upTo) ?? bands[bands.length - 1]!).value;

const NOT_MEASURED = (key: string, emoji: string, topic: string): Comparison => ({
  key,
  emoji,
  topic,
  like: 'Nobody has measured this lately',
  why: 'This stream needs an explorer with a test kit! Without a measurement we would only be guessing — and we do not guess.',
  real: 'No reading in the last 14 days',
  goodness: 0,
});

export function buildComparisons(m: Measurements | undefined): Comparison[] {
  if (!m) return [];
  const out: Comparison[] = [];

  // ─── Water clarity ─────────────────────────────────────────────────────────
  if (m.turbidityNtu === null) {
    out.push(NOT_MEASURED('clarity', '🥛', 'How clear is the water?'));
  } else {
    const c = pick(m.turbidityNtu, [
      {
        upTo: 5,
        value: {
          emoji: '💎',
          like: 'About as clear as tap water',
          why: 'You could count the pebbles on the bottom. Fish can easily spot their lunch.',
          g: 1,
        },
      },
      {
        upTo: 15,
        value: {
          emoji: '🍋',
          like: 'About as cloudy as lemonade',
          why: 'A little hazy, but light still reaches the plants on the stream bed.',
          g: 0.75,
        },
      },
      {
        upTo: 40,
        value: {
          emoji: '🍵',
          like: 'About as cloudy as tea with milk',
          why: 'Mud and bits are floating around. Underwater plants are not getting much sunlight.',
          g: 0.45,
        },
      },
      {
        upTo: Infinity,
        value: {
          emoji: '🍫',
          like: 'About as cloudy as chocolate milk',
          why: 'So murky that fish can barely see, and mud can clog their gills.',
          g: 0.12,
        },
      },
    ]);
    out.push({
      key: 'clarity',
      emoji: c.emoji,
      topic: 'How clear is the water?',
      like: c.like,
      why: c.why,
      real: `Turbidity: ${m.turbidityNtu} NTU (lower is clearer)`,
      goodness: c.g,
    });
  }

  // ─── Oxygen ────────────────────────────────────────────────────────────────
  if (m.dissolvedOxygenMgl === null) {
    out.push(NOT_MEASURED('oxygen', '🫧', 'Can fish breathe easily?'));
  } else {
    const c = pick(-m.dissolvedOxygenMgl, [
      {
        upTo: -8,
        value: {
          emoji: '🌬️',
          like: 'Like fresh air in a breezy park',
          why: 'Loads of oxygen in the water. Even the fussiest stream creatures can breathe easily.',
          g: 1,
        },
      },
      {
        upTo: -6,
        value: {
          emoji: '🏫',
          like: 'Like a classroom with the windows open',
          why: 'Enough oxygen for most creatures — comfortable, not perfect.',
          g: 0.7,
        },
      },
      {
        upTo: -4,
        value: {
          emoji: '🚌',
          like: 'Like a stuffy, crowded bus',
          why: 'Oxygen is running low. Sensitive creatures start to leave.',
          g: 0.38,
        },
      },
      {
        upTo: Infinity,
        value: {
          emoji: '🥤',
          like: 'Like breathing through a straw',
          why: 'Hardly any oxygen. Fish gasp at the surface and only the toughest bugs survive.',
          g: 0.1,
        },
      },
    ]);
    out.push({
      key: 'oxygen',
      emoji: c.emoji,
      topic: 'Can fish breathe easily?',
      like: c.like,
      why: c.why,
      real: `Dissolved oxygen: ${m.dissolvedOxygenMgl} mg/L (fish like 6 or more)`,
      goodness: c.g,
    });
  }

  // ─── Temperature ───────────────────────────────────────────────────────────
  if (m.waterTempC !== null) {
    const c = pick(m.waterTempC, [
      {
        upTo: 12,
        value: {
          emoji: '🧊',
          like: 'Cold, like a drink from the fridge',
          why: 'Cold water holds lots of oxygen. Trout love it.',
          g: 0.95,
        },
      },
      {
        upTo: 19,
        value: {
          emoji: '🌤️',
          like: 'Cool, like a swimming pool in spring',
          why: 'Just right for most stream life.',
          g: 0.9,
        },
      },
      {
        upTo: 24,
        value: {
          emoji: '☀️',
          like: 'Warm, like a paddling pool in the sun',
          why: 'Warm water holds less oxygen — like a fizzy drink going flat as it warms up.',
          g: 0.55,
        },
      },
      {
        upTo: Infinity,
        value: {
          emoji: '🛁',
          like: 'Warm like bath water',
          why: 'Too warm for many stream creatures, and green slime grows faster.',
          g: 0.2,
        },
      },
    ]);
    out.push({
      key: 'temp',
      emoji: c.emoji,
      topic: 'How warm is it?',
      like: c.like,
      why: c.why,
      real: `Water temperature: ${m.waterTempC} °C`,
      goodness: c.g,
    });
  }

  // ─── Nutrients ─────────────────────────────────────────────────────────────
  if (m.phosphateMgl !== null) {
    const c = pick(m.phosphateMgl, [
      {
        upTo: 0.1,
        value: {
          emoji: '🥗',
          like: 'A healthy, balanced diet',
          why: 'Just enough plant food. Nothing is growing out of control.',
          g: 1,
        },
      },
      {
        upTo: 0.4,
        value: {
          emoji: '🍪',
          like: 'A few too many snacks',
          why: 'A bit more plant food than the stream needs, washed in from soaps, farms and drains.',
          g: 0.65,
        },
      },
      {
        upTo: 1,
        value: {
          emoji: '🍰',
          like: 'Cake for breakfast, lunch and dinner',
          why: 'Far too much plant food. Green algae starts to take over.',
          g: 0.3,
        },
      },
      {
        upTo: Infinity,
        value: {
          emoji: '🎂',
          like: 'An all-you-can-eat party for algae',
          why: 'Algae grows wildly, then rots and uses up the oxygen that fish need.',
          g: 0.1,
        },
      },
    ]);
    out.push({
      key: 'food',
      emoji: c.emoji,
      topic: 'Too much plant food?',
      like: c.like,
      why: c.why,
      real: `Phosphate: ${m.phosphateMgl} mg/L (plant food from soaps, farms and drains)`,
      goodness: c.g,
    });
  }

  // ─── Litter ────────────────────────────────────────────────────────────────
  if (m.litterScore !== null) {
    const c = pick(m.litterScore, [
      {
        upTo: 0.3,
        value: {
          emoji: '✨',
          like: 'As tidy as a just-cleaned classroom',
          why: 'Explorers found hardly any rubbish here. Brilliant!',
          g: 1,
        },
      },
      {
        upTo: 1.2,
        value: {
          emoji: '🧃',
          like: 'Like a park after a picnic',
          why: 'A few wrappers and bottles. One litter-pick would sort it out.',
          g: 0.65,
        },
      },
      {
        upTo: 2.2,
        value: {
          emoji: '🗑️',
          like: 'Like an overflowing bin',
          why: 'Quite a lot of rubbish. Animals can get tangled or mistake it for food.',
          g: 0.3,
        },
      },
      {
        upTo: Infinity,
        value: {
          emoji: '🚯',
          like: 'Like a playground nobody ever cleans',
          why: 'Rubbish everywhere. It traps wildlife — and gives mosquitoes little pools to breed in.',
          g: 0.08,
        },
      },
    ]);
    out.push({
      key: 'litter',
      emoji: c.emoji,
      topic: 'How much rubbish?',
      like: c.like,
      why: c.why,
      real: `Litter score: ${m.litterScore} out of 3 (0 is spotless)`,
      goodness: c.g,
    });
  }

  return out;
}

// ─── Status in kid language ───────────────────────────────────────────────────

export interface KidStatus {
  label: string;
  stars: number;
  says: string;
}

export function kidStatus(status: string | null | undefined): KidStatus {
  switch (status) {
    case 'high':
      return {
        label: 'Sparkling!',
        stars: 5,
        says: 'I feel fantastic! Even my fussiest bug friends live here.',
      };
    case 'good':
      return {
        label: 'Doing well',
        stars: 4,
        says: 'I am feeling good! A little care will keep me this way.',
      };
    case 'moderate':
      return {
        label: 'Needs some care',
        stars: 3,
        says: 'I am okay… but a few things are bothering me. Can you spot them?',
      };
    case 'poor':
      return {
        label: 'Feeling poorly',
        stars: 2,
        says: 'I do not feel well. I need people to look after me.',
      };
    case 'bad':
      return {
        label: 'Needs a hero',
        stars: 1,
        says: 'I am really struggling. I need help from grown-ups and explorers like you!',
      };
    default:
      return {
        label: 'Nobody has checked',
        stars: 0,
        says: 'Nobody has visited me lately. Will you be my explorer?',
      };
  }
}

/** Findings, retold. The "what you can do" line still comes from the rule engine. */
export const KID_FINDINGS: Record<string, { emoji: string; title: string; story: string }> = {
  'cso-first-flush': {
    emoji: '🌧️',
    title: 'The city pipes overflowed',
    story:
      'After heavy rain, the pipes under the streets got too full — like a bathtub overflowing — and dirty water spilled into the stream.',
  },
  hypoxia: {
    emoji: '😮‍💨',
    title: 'Not enough air in the water',
    story:
      'Fish breathe oxygen that is mixed into the water. Right now there is too little of it, so breathing is hard work.',
  },
  'cyanobacteria-alert-2': {
    emoji: '🟢',
    title: 'Green slime warning',
    story:
      'Warm, still water with too much plant food lets green slime take over. Some kinds are poisonous — especially for dogs.',
  },
  'biotic-community-collapse': {
    emoji: '🪲',
    title: 'The fussy bugs have moved out',
    story:
      'Stoneflies and mayflies only live in clean water. Here, mostly tough worms are left — a sign the water has been unhappy for months.',
  },
  'vector-breeding-habitat': {
    emoji: '🦟',
    title: 'A mosquito hang-out',
    story:
      'Still, warm water and rubbish that holds little puddles make a perfect nursery for mosquitoes.',
  },
  'amr-pressure-hotspot': {
    emoji: '🚰',
    title: 'Lots of pipes empty here',
    story:
      'Many drain pipes flow into this stream. Scientists should check it for tough germs that medicines struggle to beat.',
  },
  'sustained-decline': {
    emoji: '📉',
    title: 'Slowly getting worse',
    story: 'No single bad day — but week after week, this stream has been feeling a little worse.',
  },
  'monitoring-gap': {
    emoji: '🔭',
    title: 'Explorers wanted!',
    story:
      'Nobody has checked on this stream for a long time. We cannot help a stream we are not watching.',
  },
  'nutrient-enrichment': {
    emoji: '🍰',
    title: 'Too much plant food',
    story:
      'Soaps, farm fertiliser and drains add plant food to the water. Too much makes algae grow wild and use up the oxygen.',
  },
};
