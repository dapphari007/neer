import { useEffect, useState } from 'react';

/**
 * The live indicator.
 *
 * Says three true things and nothing else: whether the event stream is open,
 * how long ago the data last changed, and what changed. It never says "live"
 * on the static build — a static export does not change, and a pulsing dot
 * over data that cannot move would be exactly the kind of decoration this
 * product exists to refuse.
 */
export function LivePill({
  connected,
  lastEventAt,
  lastEventLabel,
  isStatic,
}: {
  connected: boolean;
  lastEventAt: number | null;
  lastEventLabel: string | null;
  isStatic: boolean;
}) {
  const [, tick] = useState(0);

  // Re-render every few seconds so "12s ago" keeps counting without a store.
  useEffect(() => {
    const timer = setInterval(() => tick((n) => n + 1), 3_000);
    return () => clearInterval(timer);
  }, []);

  if (isStatic) {
    return (
      <span className="live-pill static" title="This is the static export; it does not update.">
        <i className="dot" aria-hidden="true" />
        Snapshot
      </span>
    );
  }

  const ago = lastEventAt ? Math.max(0, Math.round((Date.now() - lastEventAt) / 1000)) : null;
  const agoText =
    ago === null
      ? 'waiting for first update'
      : ago < 60
        ? `${ago}s ago`
        : `${Math.round(ago / 60)}m ago`;

  return (
    <span
      className={`live-pill ${connected ? 'on' : 'off'}`}
      role="status"
      aria-live="polite"
      title={lastEventLabel ?? undefined}
    >
      <i className="dot" aria-hidden="true" />
      {connected ? 'Live' : 'Reconnecting'} · {agoText}
      {lastEventLabel && <span className="live-what">{lastEventLabel}</span>}
    </span>
  );
}
