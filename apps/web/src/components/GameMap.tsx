import { useCallback, useEffect, useRef, useState } from 'react';
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
 * The map is created exactly once and is never rebuilt while the page lives.
 * Scores change every few seconds when the live feed is running, and each
 * change hands this component a fresh `sites` array; the pins are repainted in
 * place — colour, number, pulse ring, hover card — and the viewport is left
 * exactly where the reader put it. Tearing the map down on every update would
 * reload tiles, drop the reader's zoom and snap a switched region back to the
 * pilot city every twenty-five seconds.
 *
 * Regions: a pilot city and a sensor network two thousand kilometres away
 * cannot share a useful zoom level, so the map shows one region at a time and
 * the switch lives inside the frame, next to the zoom control. The pilot city
 * opens first.
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
/** The pilot city opens first; other regions follow alphabetically. */
const HOME_REGION = 'Coimbra';
const FIT_PADDING = { top: 90, bottom: 110, left: 60, right: 60 };
const FIT_MAX_ZOOM = 13;

const regionOf = (site: SiteSummary): string => site.region ?? HOME_REGION;

/** Region labels can carry a qualifier ("England · live sensors"); the button shows the place. */
const shortRegion = (region: string): string => region.split(' · ')[0] ?? region;

function regionsOf(sites: readonly SiteSummary[]): string[] {
  return [...new Set(sites.map(regionOf))].sort((a, b) =>
    a === HOME_REGION ? -1 : b === HOME_REGION ? 1 : a.localeCompare(b),
  );
}

function boundsOf(sites: readonly SiteSummary[]): maplibregl.LngLatBounds {
  const bounds = new maplibregl.LngLatBounds();
  sites.forEach((site) => bounds.extend([site.lon, site.lat]));
  return bounds;
}

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

/** One site pin and the DOM it owns, so a live update can rewrite it in place. */
interface PinEntry {
  site: SiteSummary;
  marker: maplibregl.Marker;
  pin: HTMLButtonElement;
  label: HTMLSpanElement;
  ring: HTMLElement;
  card: { name: HTMLDivElement; mood: HTMLDivElement; prov: HTMLDivElement };
}

function buildPin(
  site: SiteSummary,
  map: maplibregl.Map,
  hover: maplibregl.Popup,
  onSelect: (siteId: string) => void,
): PinEntry {
  // MapLibre owns `transform` on the marker root, so the rotated teardrop has
  // to live one element down.
  const root = document.createElement('div');
  const pin = document.createElement('button');
  pin.type = 'button';
  const label = document.createElement('span');
  pin.appendChild(label);
  const ring = document.createElement('i');
  ring.className = 'pulse-ring';

  // Built with textContent, not innerHTML: site names come from the API.
  const card = document.createElement('div');
  const name = document.createElement('div');
  name.style.cssText = 'font-weight:800;font-size:14px;line-height:1.25';
  const mood = document.createElement('div');
  mood.style.cssText = 'margin-top:3px;font-size:13px;font-weight:700;color:#2a5878';
  const prov = document.createElement('div');
  prov.style.cssText = 'margin-top:5px;font-size:11px;font-weight:800';
  card.append(name, mood, prov);

  root.appendChild(pin);
  const marker = new maplibregl.Marker({ element: root, anchor: 'bottom', offset: [0, -6] })
    .setLngLat([site.lon, site.lat])
    .addTo(map);

  const entry: PinEntry = { site, marker, pin, label, ring, card: { name, mood, prov } };

  // Handlers read `entry.site`, which repaint keeps current, rather than the
  // `site` this pin was born with.
  pin.addEventListener('mouseenter', () =>
    hover.setLngLat([entry.site.lon, entry.site.lat]).setDOMContent(card).addTo(map),
  );
  pin.addEventListener('mouseleave', () => hover.remove());
  pin.addEventListener('click', (event) => {
    event.stopPropagation();
    hover.remove();
    onSelect(entry.site.siteId);
  });
  return entry;
}

/** Bring a pin up to date with a site record. Idempotent, cheap, and viewport-neutral. */
function paintPin(entry: PinEntry, site: SiteSummary): void {
  entry.site = site;
  entry.pin.className = site.source === 'sensor' ? 'site-pin sensor' : 'site-pin';
  entry.pin.style.background = statusColor(site.status);
  entry.pin.setAttribute(
    'aria-label',
    `${site.name}: ${num(site.sohi, 0)} out of 100, ${statusLabel(site.status)}. Open this stream.`,
  );
  entry.label.textContent = site.sohi === null ? '?' : String(Math.round(site.sohi));

  const needsHelp = site.sohi !== null && site.sohi < NEEDS_HELP_BELOW;
  if (needsHelp && !entry.ring.isConnected) entry.pin.appendChild(entry.ring);
  if (!needsHelp && entry.ring.isConnected) entry.ring.remove();

  entry.card.name.textContent = site.name;
  entry.card.mood.textContent = `${num(site.sohi, 0)}/100 · ${kidStatus(site.status).label} — tap to visit`;
  const provenance = sourceLabel(site.source);
  entry.card.prov.style.color = provenance.cls === 'sensor' ? '#0f7a4a' : '#8a6100';
  entry.card.prov.textContent =
    provenance.cls === 'sensor' ? '📡 Real sensor — live readings' : '🧪 Simulated check-ups';

  entry.marker.setLngLat([site.lon, site.lat]);
}

export function GameMap({ sites, selectedId = null, onSelect, game, compact = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const hoverRef = useRef<maplibregl.Popup | null>(null);
  const pinsRef = useRef<Map<string, PinEntry>>(new Map());
  const markPinsRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  /** The region the viewport currently frames; null until the map exists. */
  const framedRef = useRef<string | null>(null);

  const [sticker, setSticker] = useState<Sticker | null>(null);
  const [toast, setToast] = useState<{ key: number; text: string } | null>(null);

  const regions = regionsOf(sites);
  const [chosenRegion, setChosenRegion] = useState<string | null>(null);
  // A chosen region that has since emptied (a retired sensor network) falls
  // back to the first one rather than leaving the switch with nothing pressed.
  const region =
    chosenRegion && regions.includes(chosenRegion) ? chosenRegion : (regions[0] ?? HOME_REGION);

  // The map is created once; handlers and effects read the latest values
  // through refs instead of tearing the map down whenever a prop changes.
  const stickerRef = useRef(sticker);
  stickerRef.current = sticker;
  const gameRef = useRef(game);
  gameRef.current = game;
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;
  const sitesRef = useRef(sites);
  sitesRef.current = sites;
  const regionRef = useRef(region);
  regionRef.current = region;

  const hasSites = sites.length > 0;

  const fitRegion = useCallback((target: string, animate: boolean) => {
    const map = mapRef.current;
    if (!map) return;
    const inRegion = sitesRef.current.filter((site) => regionOf(site) === target);
    if (inRegion.length === 0) return;
    framedRef.current = target;
    map.fitBounds(boundsOf(inRegion), {
      padding: FIT_PADDING,
      maxZoom: FIT_MAX_ZOOM,
      duration: animate ? 900 : 0,
    });
  }, []);

  // ─── Create the map once, framed on the opening region ─────────────────────
  useEffect(() => {
    if (!containerRef.current || !hasSites) return;

    const opening = sitesRef.current.filter((site) => regionOf(site) === regionRef.current);
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds: boundsOf(opening.length > 0 ? opening : sitesRef.current),
      fitBoundsOptions: { padding: FIT_PADDING, maxZoom: FIT_MAX_ZOOM },
      attributionControl: { compact: true },
    });
    mapRef.current = map;
    framedRef.current = regionRef.current;
    hoverRef.current = new maplibregl.Popup({
      closeButton: false,
      closeOnClick: false,
      offset: 46,
    });

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

    return () => {
      pinsRef.current.clear();
      markPinsRef.current.clear();
      hoverRef.current = null;
      framedRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [hasSites]);

  // ─── Keep the pins in step with the data, without touching the viewport ────
  useEffect(() => {
    const map = mapRef.current;
    const hover = hoverRef.current;
    if (!map || !hover) return;
    const pins = pinsRef.current;

    const wanted = new Set(sites.map((site) => site.siteId));
    pins.forEach((entry, siteId) => {
      if (wanted.has(siteId)) return;
      hover.remove();
      entry.marker.remove();
      pins.delete(siteId);
    });

    for (const site of sites) {
      const existing = pins.get(site.siteId);
      if (existing) {
        paintPin(existing, site);
        continue;
      }
      const entry = buildPin(site, map, hover, (siteId) => onSelectRef.current(siteId));
      paintPin(entry, site);
      pins.set(site.siteId, entry);
    }
  }, [sites]);

  // ─── Fly to a newly chosen region; a data refresh never moves the map ──────
  useEffect(() => {
    if (!mapRef.current || framedRef.current === region) return;
    fitRegion(region, true);
  }, [region, hasSites, fitRegion]);

  // ─── Reflect selection, including on pins that arrived after it was made ───
  useEffect(() => {
    pinsRef.current.forEach((entry, siteId) => {
      entry.pin.dataset.selected = String(siteId === selectedId);
    });
  }, [selectedId, sites]);

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
    // `hasSites` is a dependency because the map is created when sites arrive;
    // marks restored from storage before that moment would otherwise never be
    // drawn.
  }, [marks, hasSites]);

  const level = game?.level;
  const countByRegion = new Map<string, number>();
  for (const site of sites) {
    const key = regionOf(site);
    countByRegion.set(key, (countByRegion.get(key) ?? 0) + 1);
  }

  return (
    <div className={`map-frame${compact ? ' compact' : ''}${sticker ? ' marking' : ''}`}>
      <div ref={containerRef} className="map-canvas" />

      {toast && (
        <div key={toast.key} className="toast" role="status">
          {toast.text}
        </div>
      )}

      {regions.length > 1 && (
        <div className="hud region-hud" role="group" aria-label="Choose a region">
          {regions.map((option) => (
            <button
              key={option}
              type="button"
              title={option}
              aria-pressed={region === option}
              onClick={() => {
                // Pressing the active region again re-centres it — the way back
                // after panning off to look at something.
                if (option === region) fitRegion(option, true);
                else setChosenRegion(option);
              }}
            >
              {shortRegion(option)}
              <small className="tnum">{countByRegion.get(option) ?? 0}</small>
            </button>
          ))}
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
  );
}
