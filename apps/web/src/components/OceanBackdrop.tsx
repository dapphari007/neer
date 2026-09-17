import { useMemo } from 'react';

/**
 * The water column behind everything: light rays near the surface and bubbles
 * rising. The seabed is a separate component placed at the true bottom of the
 * page — pinned to the viewport it cut coral across headings mid-scroll, and a
 * seabed you can never scroll down to is not much of a seabed.
 *
 * Purely decorative, so it is `aria-hidden`, ignores pointer events, and every
 * animation switches off under `prefers-reduced-motion`. Bubble positions come
 * from a fixed sequence rather than Math.random so the scene does not reshuffle
 * on every render.
 */
export function OceanBackdrop() {
  const bubbles = useMemo(
    () =>
      Array.from({ length: 18 }, (_, i) => ({
        left: `${(i * 53 + 7) % 100}%`,
        size: 8 + ((i * 11) % 26),
        duration: 11 + ((i * 7) % 14),
        delay: -((i * 3.7) % 20),
      })),
    [],
  );

  return (
    <div className="ocean" aria-hidden="true">
      <div className="ocean-rays" />

      {bubbles.map((b, i) => (
        <span
          key={i}
          className="bubble"
          style={{
            left: b.left,
            width: b.size,
            height: b.size,
            animationDuration: `${b.duration}s`,
            animationDelay: `${b.delay}s`,
          }}
        />
      ))}
    </div>
  );
}

/** The seabed, in normal flow at the end of the page. */
export function Seafloor() {
  return (
    <footer className="seafloor">
      <svg
        aria-hidden="true"
        className="seabed"
        viewBox="0 0 1440 210"
        preserveAspectRatio="xMidYMax slice"
      >
        {/* far dunes */}
        <path d="M0 150 Q240 96 480 138 T960 128 T1440 146 V210 H0 Z" fill="#04264a" />

        {/* kelp, left */}
        <g
          className="sway slow"
          fill="none"
          stroke="#1d8f6c"
          strokeWidth="11"
          strokeLinecap="round"
        >
          <path d="M120 210 C96 160 146 128 118 78 C104 52 124 34 118 12" />
        </g>
        <g className="sway" fill="none" stroke="#27b083" strokeWidth="9" strokeLinecap="round">
          <path d="M176 210 C198 170 154 142 182 102 C196 80 178 62 186 44" />
        </g>
        <g className="sway slow" fill="none" stroke="#167a5b" strokeWidth="8" strokeLinecap="round">
          <path d="M70 210 C58 176 88 156 70 124" />
        </g>

        {/* branching coral, left-centre */}
        <g
          fill="none"
          stroke="#ff7a59"
          strokeWidth="10"
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <path d="M360 210 V160 M360 176 L330 146 V124 M360 166 L392 138 V112 M330 140 L312 126 M392 132 L412 120" />
        </g>

        {/* fan coral, right-centre */}
        <g fill="none" stroke="#f78bb0" strokeWidth="8" strokeLinecap="round">
          <path d="M1010 210 V150 M1010 170 L980 132 M1010 162 L1042 126 M1010 150 L1000 108 M1010 150 L1026 104 M980 132 L966 112 M1042 126 L1060 108" />
        </g>

        {/* kelp, right */}
        <g className="sway" fill="none" stroke="#27b083" strokeWidth="10" strokeLinecap="round">
          <path d="M1290 210 C1268 164 1316 136 1288 90 C1274 66 1294 48 1288 26" />
        </g>
        <g className="sway slow" fill="none" stroke="#1d8f6c" strokeWidth="8" strokeLinecap="round">
          <path d="M1350 210 C1370 176 1332 152 1354 116" />
        </g>

        {/* near seabed with rocks */}
        <path d="M0 184 Q180 158 360 178 T720 172 T1080 182 T1440 168 V210 H0 Z" fill="#031a36" />
        <ellipse cx="560" cy="190" rx="54" ry="20" fill="#0a3a63" />
        <ellipse cx="616" cy="196" rx="30" ry="13" fill="#0c4675" />
        <ellipse cx="1180" cy="192" rx="46" ry="17" fill="#0a3a63" />

        {/* a starfish, because every seabed needs one */}
        <path
          d="M840 176 l6 13 14 2 -10 10 3 14 -13 -7 -13 7 3 -14 -10 -10 14 -2 z"
          fill="#ffd166"
          stroke="#e0a93a"
          strokeWidth="2"
          strokeLinejoin="round"
        />
      </svg>
      <p className="seafloor-note">
        Neer · built for the IEEE OneAquaHealth Global Hackathon 2026 · map data © OpenStreetMap
        contributors · weather by Open-Meteo
      </p>
    </footer>
  );
}
