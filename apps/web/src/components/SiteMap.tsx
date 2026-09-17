import { useEffect, useRef } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';
import type { SiteSummary } from '../lib/api';
import { num, statusColor, statusLabel, STATUS_ORDER } from '../lib/format';

/**
 * The site map.
 *
 * Basemap tiles come from OpenFreeMap — genuinely keyless and free, so a
 * reviewer never needs an account and there is no token to leak in a public
 * repository.
 *
 * The failure mode is handled deliberately: if the tile service is slow or
 * unreachable, MapLibre still projects and renders the markers, because they are
 * DOM elements positioned by coordinate rather than drawn into the tile layer.
 * The map degrades to correctly-placed sites on an empty canvas instead of
 * going blank, so an outage in a third-party service cannot take the main view
 * of the product down mid-demonstration.
 */

interface Props {
  sites: SiteSummary[];
  selectedId: string | null;
  onSelect: (siteId: string) => void;
}

const STYLE_URL = 'https://tiles.openfreemap.org/styles/positron';

export function SiteMap({ sites, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const markersRef = useRef<Map<string, maplibregl.Marker>>(new Map());
  // Held in a ref so the marker click handler always calls the current callback
  // without needing to tear down and rebuild every marker on re-render.
  const onSelectRef = useRef(onSelect);
  onSelectRef.current = onSelect;

  useEffect(() => {
    if (!containerRef.current || mapRef.current || sites.length === 0) return;

    const bounds = new maplibregl.LngLatBounds();
    sites.forEach((site) => bounds.extend([site.lon, site.lat]));

    const map = new maplibregl.Map({
      container: containerRef.current,
      style: STYLE_URL,
      bounds,
      fitBoundsOptions: { padding: 70, maxZoom: 13 },
      attributionControl: { compact: true },
    });

    map.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 90, unit: 'metric' }), 'bottom-right');

    // A style failure must not take the markers with it.
    map.on('error', (event) => {
      console.warn('Basemap tiles unavailable; markers still render.', event.error?.message);
    });

    for (const site of sites) {
      const element = document.createElement('button');
      element.className = 'site-marker';
      element.type = 'button';
      element.style.background = statusColor(site.status);
      element.style.position = 'relative';
      element.dataset.alert = Number(site.activeFindingCount ?? 0) > 0 ? 'true' : 'false';
      element.textContent = site.sohi === null ? '?' : String(Math.round(site.sohi));
      element.setAttribute(
        'aria-label',
        `${site.name}: index ${num(site.sohi)}, ${statusLabel(site.status)}`,
      );
      element.addEventListener('click', (event) => {
        event.stopPropagation();
        onSelectRef.current(site.siteId);
      });

      const marker = new maplibregl.Marker({ element })
        .setLngLat([site.lon, site.lat])
        .setPopup(
          new maplibregl.Popup({ offset: 16, closeButton: false }).setHTML(
            `<div style="font:500 12.5px system-ui;padding:2px 1px">
               <div style="font-weight:600">${escapeHtml(site.name)}</div>
               <div style="color:#52514e;margin-top:2px">
                 Index ${num(site.sohi)} · ${statusLabel(site.status)}
               </div>
             </div>`,
          ),
        )
        .addTo(map);

      markersRef.current.set(site.siteId, marker);
    }

    mapRef.current = map;

    return () => {
      markersRef.current.clear();
      map.remove();
      mapRef.current = null;
    };
  }, [sites]);

  // Reflect selection without rebuilding markers.
  useEffect(() => {
    markersRef.current.forEach((marker, siteId) => {
      marker.getElement().dataset.selected = String(siteId === selectedId);
    });
    if (selectedId && mapRef.current) {
      const site = sites.find((s) => s.siteId === selectedId);
      if (site) mapRef.current.easeTo({ center: [site.lon, site.lat], duration: 500 });
    }
  }, [selectedId, sites]);

  return (
    <div className="map-wrap">
      <div ref={containerRef} style={{ position: 'absolute', inset: 0 }} />
      <div className="map-legend">
        <div className="map-legend-title">Stream One Health Index</div>
        {[...STATUS_ORDER].reverse().map((status) => (
          <div className="legend-row" key={status}>
            <i className="swatch" style={{ background: `var(--status-${status})` }} />
            {statusLabel(status)}
          </div>
        ))}
        <div className="map-note">
          Darker means worse — visual weight follows the need for attention. A red dot marks a site
          with active findings.
        </div>
      </div>
    </div>
  );
}

/** Popup content is built as HTML, so site names are escaped rather than trusted. */
function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (char) =>
      ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char] ?? char,
  );
}
