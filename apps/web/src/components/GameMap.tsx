import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { SiteSummary } from '../lib/api';
import { STICKERS, XP, type Game, type Sticker } from '../lib/game';
import { kidStatus } from '../lib/kid';
import { num, sourceLabel, statusColor, statusLabel, STATUS_ORDER } from '../lib/format';

/**
 * The map — a game board in Explorer mode, a plain site map in Scientist mode.
 *
 * Basemap is OpenFreeMap's dark "fiord" style, keyless and free, with its water
 * recoloured at runtime so rivers glow against the land: on a stream-health map
 * the streams should be the brightest thing on screen, and on stock styles they
 * are the faintest.
 *
 * Marking: pick a sticker, tap the map, a pin drops. Marks are personal field
 * notes kept on this device — they never feed the index, and the UI says so at
 * the point of marking rather than in a policy page nobody reads.
 *
 * Failure handling is deliberate. Site pins and marks are DOM markers positioned
 * by coordinate, not drawn into the tile layer, so if the tile service is down
 * the board degrades to correctly-placed pins on a dark canvas instead of going
 * blank mid-demonstration.
 */

interface Props {
  sites: SiteSummary[];
  selectedId?: string | null;
  onSelect: (siteId: string) => void;
  /** Present in Explorer mode; enables the HUD and marking. */
  game?: Game;
  compact?: boolean;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/fiord';
const NEEDS_HELP_BELOW = 60;

/** Make water the brightest thing on the map. Best-effort: a style change upstream must not break the page. */
function glowWater(map: maplibregl.Map) {
  try {
    for (const layer of map.getStyle().layers ?? []) {
      if (!/water/i.test(layer.id)) continue;
      if (layer.type === 'fill') {
        map.setPaintProperty(layer.id, 'fill-color', '#0e7fa0');
      } else if (layer.type === 'line') {
        map.setPaintProperty(layer.id, 'line-color', '#35e0d0');
        map.setPaintProperty(layer.id, 'line-width', [
          'interpolate',
          ['linear'],
          ['zoom'],
          8,
          1,
          12,
          2.6,
          16,
          7,
        ]);
      }
    }
  } catch (error) {
    console.warn('Could not restyle water layers.', error);
  }
}

export function GameMap({ sites, selectedId = null, onSelect, game, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const sitePinsRef = useRef<Map<string, HTMLButtonElement>>(new Map());
  const markPinsRef = useRef<Map<string, maplibregl.Marker>>(new Map());

  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);

  // One viewport per region: a pilot city and a sensor network two thousand
  // kilometres away cannot share a useful zoom level.
  const regions = [...new Set(sites.map((s) => s.region ?? 'Coimbra'))];
  const [region, setRegion] = useState<string>(regions[0] ?? 'Coimbra');

  // The map is created once; handlers read the latest values through refs
  // instead of tearing the whole map down whenever a prop changes.
  const stickerRef = useRef(sticker);
  stickerRef.current = sticker;
  const gameRef = useRef(game);
  gameRef.current = game;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  // ─── Create the map and the site pins ──────────────────────────────────────
  useEffect(() => {
    if (!containerRef.current || mapRef.current || sites.length === 0) return;

    const firstRegion = sites[0]?.region ?? 'Coimbra';
    const bounds = new maplibregl.LngLatBounds();
    sites
      .filter((site) => (site.region ?? 'Coimbra') === firstRegion)
      .forEach((site) => bounds.extend([site.lon, site.lat]));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: { top: 90, bottom: 110, left: 60, right: 60 }, maxZoom: 13 },
      attributionControl: { compact: true },
    });
    mapRef.current = map;

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.on('style.load', () => glowWater(map));
    map.on('error', (event) =>
      console.warn('Basemap tiles unavailable; pins still render.', event.error?.message),
    );

    map.on('click', (event) => {
      const active = stickerRef.current;
      const currentGame = gameRef.current;
      if (!active || !currentGame) return;
      currentGame.addMark(active.kind, event.lngLat.lat, event.lngLat.lng);
      setToast({
        key: Date.now(),
        text: `${active.emoji} ${active.label} marked!  +${XP.mark} XP`,
      });
    });

    const hover = new maplibregl.Popup({ closeButton: false, closeOnClick: false, offset: 46 });

    for (const site of sites) {
      // MapLibre owns `transform` on the marker root, so the rotated teardrop
      // has to live one element down.
      const root = document.createElement('div');
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = site.source === 'sensor' ? 'site-pin sensor' : 'site-pin';
      pin.style.background = statusColor(site.status);
      pin.setAttribute(
        'aria-label',
        `${site.name}: ${num(site.sohi, 0)} out of 100, ${statusLabel(site.status)}. Open this stream.`,
      );

      const label = document.createElement('span');
      label.textContent = site.sohi === null ? '?' : String(Math.round(site.sohi));
      pin.appendChild(label);

      if (site.sohi !== null && site.sohi < NEEDS_HELP_BELOW) {
        const ring = document.createElement('i');
        ring.className = 'pulse-ring';
        pin.appendChild(ring);
      }

      // Built with textContent, not innerHTML: site names come from the API.
      const card = document.createElement('div');
      const name = document.createElement('div');
      name.style.cssText = 'font-weight:800;font-size:14px;line-height:1.25';
      name.textContent = site.name;
      const mood = document.createElement('div');
      mood.style.cssText = 'margin-top:3px;font-size:13px;font-weight:700;color:#2a5878';
      mood.textContent = `${num(site.sohi, 0)}/100 · ${kidStatus(site.status).label} — tap to visit`;
      const prov = document.createElement('div');
      const provenance = sourceLabel(site.source);
      prov.style.cssText = `margin-top:5px;font-size:11px;font-weight:800;color:${provenance.cls === 'sensor' ? '#0f7a4a' : '#8a6100'}`;
      prov.textContent =
        provenance.cls === 'sensor' ? '📡 Real sensor — live readings' : '🧪 Simulated check-ups';
      card.append(name, mood, prov);

      pin.addEventListener('mouseenter', () =>
        hover.setLngLat([site.lon, site.lat]).setDOMContent(card).addTo(map),
      );
      pin.addEventListener('mouseleave', () => hover.remove());
      pin.addEventListener('click', (event) => {
        event.stopPropagation();
        hover.remove();
        onSelectRef.current(site.siteId);
      });

      root.appendChild(pin);
      new maplibregl.Marker({ element: root, anchor: 'bottom', offset: [0, -6] })
        .setLngLat([site.lon, site.lat])
        .addTo(map);
      sitePinsRef.current.set(site.siteId, pin);
    }

    return () => {
      sitePinsRef.current.clear();
      markPinsRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [sites]);

  // ─── Fit the viewport to the chosen region ─────────────────────────────────
  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const inRegion = sites.filter((s) => (s.region ?? 'Coimbra') === region);
    if (inRegion.length === 0) return;
    const bounds = new maplibregl.LngLatBounds();
    inRegion.forEach((s) => bounds.extend([s.lon, s.lat]));
    map.fitBounds(bounds, {
      padding: { top: 90, bottom: 110, left: 60, right: 60 },
      maxZoom: 13,
      duration: 900,
    });
  }, [region, sites]);

  // ─── Reflect selection ─────────────────────────────────────────────────────
  useEffect(() => {
    sitePinsRef.current.forEach((pin, siteId) => {
      pin.dataset.selected = String(siteId === selectedId);
    });
  }, [selectedId]);

  // ─── Sync personal marks onto the map ──────────────────────────────────────
  const marks = game?.marks;
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !marks) return;

    const wanted = new Set(marks.map((mark) => mark.id));
    markPinsRef.current.forEach((marker, id) => {
      if (!wanted.has(id)) {
        marker.remove();
        markPinsRef.current.delete(id);
      }
    });

    for (const mark of marks) {
      if (markPinsRef.current.has(mark.id)) continue;
      const meta = STICKERS.find((s) => s.kind === mark.kind);
      if (!meta) continue;

      const root = document.createElement('div');
      const pin = document.createElement('button');
      pin.type = 'button';
      pin.className = 'mark-pin';
      pin.textContent = meta.emoji;
      pin.setAttribute('aria-label', `Your mark: ${meta.label}`);
      root.appendChild(pin);

      const body = document.createElement('div');
      const title = document.createElement('div');
      title.style.cssText = 'font-weight:800;font-size:14px';
      title.textContent = `${meta.emoji} ${meta.label}`;
      const when = document.createElement('div');
      when.style.cssText = 'font-size:12px;color:#2a5878;margin:2px 0 8px';
      when.textContent = `Marked ${new Date(mark.at).toLocaleDateString()} · saved on this device only`;
      const remove = document.createElement('button');
      remove.type = 'button';
      remove.textContent = 'Remove mark';
      remove.style.cssText =
        'border:none;border-radius:999px;padding:5px 12px;font-weight:800;font-size:12px;background:#07304f;color:#f1fbff;cursor:pointer';
      remove.addEventListener('click', () => gameRef.current?.removeMark(mark.id));
      body.append(title, when, remove);

      // A pin click must not also fall through to the map and drop a second mark.
      pin.addEventListener('click', (event) => event.stopPropagation());

      const marker = new maplibregl.Marker({ element: root, anchor: 'center' })
        .setLngLat([mark.lon, mark.lat])
        .setPopup(new maplibregl.Popup({ offset: 24, closeButton: false }).setDOMContent(body))
        .addTo(map);
      markPinsRef.current.set(mark.id, marker);
    }
    // `sites` is a dependency because the map is created when sites arrive; marks
    // restored from storage before that moment would otherwise never be drawn.
  }, [marks, sites]);

  const level = game?.level;

  return (
    <>
      {regions.length > 1 && (
        <div className="region-tabs" role="group" aria-label="Choose a region">
          {regions.map((r) => {
            const count = sites.filter((s) => (s.region ?? 'Coimbra') === r).length;
            return (
              <button
                key={r}
                type="button"
                aria-pressed={region === r}
                onClick={() => setRegion(r)}
              >
                {r} · {count}
              </button>
            );
          })}
        </div>
      )}
      <div className={`map-frame${compact ? ' compact' : ''}${sticker ? ' marking' : ''}`}>
        <div ref={containerRef} className="map-canvas" />

        {toast && (
          <div key={toast.key} className="toast" role="status">
            {toast.text}
          </div>
        )}

        {game && level && (
          <div className="hud hud-top">
            <div className="hud-level">
              <span>
                Lv {level.number} · {level.name}
              </span>
              <small className="tnum">{game.xp} XP</small>
            </div>
            <div
              className="xp-track"
              role="progressbar"
              aria-label="Progress to next level"
              aria-valuemin={0}
              aria-valuemax={100}
              aria-valuenow={Math.round(level.progress * 100)}
            >
              <div className="xp-fill" style={{ width: `${Math.max(4, level.progress * 100)}%` }} />
            </div>
            <div
              style={{ marginTop: 5, fontSize: 11.5, color: 'var(--text-muted)', fontWeight: 700 }}
            >
              {level.nextName ? `${level.toNext} XP to ${level.nextName}` : 'Top rank reached!'}
            </div>
          </div>
        )}

        <div className="hud legend-hud">
          {[...STATUS_ORDER].reverse().map((status) => (
            <div className="legend-row" key={status}>
              <i className="swatch" style={{ background: `var(--status-${status})` }} />
              {game ? kidStatus(status).label : statusLabel(status)}
            </div>
          ))}
          <div className="legend-row" style={{ marginTop: 3 }}>
            <i
              className="swatch"
              style={{ background: 'none', border: '2.5px solid var(--coral)' }}
            />
            {game ? 'Pulsing = needs help' : 'Pulsing = below Good'}
          </div>
        </div>

        {game && (
          <div className="hud hud-bottom" role="toolbar" aria-label="Mark something you spotted">
            <span className="hud-hint">
              {sticker
                ? `Tap the map to drop “${sticker.label}”`
                : 'Spotted something? Pick a sticker:'}
            </span>
            {STICKERS.map((option) => (
              <button
                key={option.kind}
                type="button"
                className="sticker-btn"
                aria-pressed={sticker?.kind === option.kind}
                onClick={() =>
                  setSticker((current) => (current?.kind === option.kind ? null : option))
                }
              >
                <span className="emoji" aria-hidden="true">
                  {option.emoji}
                </span>
                {option.label}
              </button>
            ))}
          </div>
        )}
      </div>
    </>
  );
}
