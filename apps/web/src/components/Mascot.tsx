import { useId, useMemo } from 'react';
import { mascotMarkup, toMood } from '../lib/mascot';

/**
 * Drip, on screen.
 *
 * The markup is a compile-time constant produced by `mascotMarkup` — no API or
 * user text is ever interpolated into it — which is what makes injecting it as
 * HTML safe. It is a string rather than JSX because the share card needs the
 * identical geometry inside an SVG that is rasterised outside React.
 */
export function Mascot({
  status,
  size = 96,
  float = false,
  title,
}: {
  status: string | null | undefined;
  size?: number;
  float?: boolean;
  title?: string;
}) {
  const uid = useId().replace(/[^a-zA-Z0-9]/g, '');
  const mood = toMood(status);
  const markup = useMemo(() => mascotMarkup(mood, `m${uid}`), [mood, uid]);

  return (
    <svg
      className={float ? 'float' : undefined}
      viewBox="0 0 120 140"
      width={size}
      height={(size * 140) / 120}
      role="img"
      aria-label={
        title ??
        `Drip the droplet looks ${mood === 'high' ? 'delighted' : mood === 'good' ? 'happy' : mood === 'moderate' ? 'unsure' : mood === 'poor' ? 'worried' : 'unwell'}`
      }
      style={{ flex: 'none', overflow: 'visible' }}
      dangerouslySetInnerHTML={{ __html: markup }}
    />
  );
}
