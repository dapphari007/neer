import { useEffect, useMemo, useRef, useState } from 'react';
import type { SiteSummary } from '../lib/api';
import type { Comparison } from '../lib/kid';
import { buildCaption, buildCardSvg, renderCardPng } from '../lib/shareCard';

/**
 * One-click post.
 *
 * "Post it!" does the most the platform allows in a single action: on phones and
 * browsers with the Web Share API it opens the system share sheet with the image
 * and caption attached, so the post lands in whichever app the person picks. On
 * desktops without it, the same click downloads the image and copies the caption
 * to the clipboard — two things that are otherwise two separate chores.
 *
 * Nothing is posted *for* anyone. The app never holds a social account or a
 * token; the person always lands in their own app with the final say, which is
 * the only acceptable design for something children will use.
 */

interface Props {
  site: SiteSummary;
  comparisons: Comparison[];
  disclosure: 'simulated' | 'real';
  onClose: () => void;
  onShared: () => void;
}

export function ShareModal({ site, comparisons, disclosure, onClose, onShared }: Props) {
  const svg = useMemo(
    () => buildCardSvg(site, comparisons, disclosure),
    [site, comparisons, disclosure],
  );
  const [caption, setCaption] = useState(() => buildCaption(site, comparisons, disclosure));
  const [blob, setBlob] = useState<Blob | null>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;

    renderCardPng(svg)
      .then((png) => {
        if (cancelled) return;
        url = URL.createObjectURL(png);
        setBlob(png);
        setPreviewUrl(url);
      })
      .catch((cause: unknown) =>
        setError(cause instanceof Error ? cause.message : 'Could not create the image.'),
      );

    return () => {
      cancelled = true;
      // Object URLs pin the blob in memory until revoked.
      if (url) URL.revokeObjectURL(url);
    };
  }, [svg]);

  // Escape closes; focus moves into the dialog so keyboard users are not
  // stranded behind it.
  useEffect(() => {
    closeRef.current?.focus();
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const fileName = `neer-${site.siteId.toLowerCase()}.png`;

  const download = () => {
    if (!previewUrl) return;
    const link = document.createElement('a');
    link.href = previewUrl;
    link.download = fileName;
    link.click();
  };

  const copyCaption = async (): Promise<boolean> => {
    try {
      await navigator.clipboard.writeText(caption);
      return true;
    } catch {
      return false;
    }
  };

  const postIt = async () => {
    if (!blob) return;
    setError(null);

    const file = new File([blob], fileName, { type: 'image/png' });
    const canShareFile =
      typeof navigator.share === 'function' &&
      typeof navigator.canShare === 'function' &&
      navigator.canShare({ files: [file] });

    if (canShareFile) {
      try {
        await navigator.share({ files: [file], text: caption, title: `${site.name} — Neer` });
        onShared();
        setMessage('Shared! +30 XP 🎉');
      } catch (cause) {
        // Dismissing the share sheet is a decision, not an error.
        if ((cause as DOMException)?.name !== 'AbortError') {
          setError('Sharing did not work here — use Download instead.');
        }
      }
      return;
    }

    download();
    const copied = await copyCaption();
    onShared();
    setMessage(
      copied
        ? 'Image downloaded and caption copied — paste both into your post. +30 XP 🎉'
        : 'Image downloaded. Copy the caption below into your post. +30 XP 🎉',
    );
  };

  const encoded = encodeURIComponent(caption);

  return (
    <div
      className="modal-backdrop"
      role="dialog"
      aria-modal="true"
      aria-label={`Share ${site.name}`}
      onMouseDown={(event) => event.target === event.currentTarget && onClose()}
    >
      <div className="modal">
        <div className="modal-preview">
          {previewUrl ? (
            <img src={previewUrl} alt={`Shareable report card for ${site.name}`} />
          ) : (
            <div className="loading">{error ?? 'Drawing your card…'}</div>
          )}
        </div>

        <div className="modal-body">
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{ flex: 1 }}>
              <h2 style={{ fontSize: 24 }}>Tell this stream's story</h2>
              <p className="card-sub">
                One tap makes the post. You choose where it goes — nothing is posted for you.
              </p>
            </div>
            <button ref={closeRef} type="button" className="btn btn-sm" onClick={onClose}>
              Close
            </button>
          </div>

          <label className="sr-only" htmlFor="share-caption">
            Caption
          </label>
          <textarea
            id="share-caption"
            value={caption}
            onChange={(event) => setCaption(event.currentTarget.value)}
          />

          <button type="button" className="btn btn-coral" onClick={postIt} disabled={!blob}>
            🚀 Post it!
          </button>

          <div className="share-row">
            <button type="button" className="btn btn-sm" onClick={download} disabled={!blob}>
              ⬇ Download image
            </button>
            <button
              type="button"
              className="btn btn-sm"
              onClick={async () =>
                setMessage(
                  (await copyCaption()) ? 'Caption copied.' : 'Select the caption and copy it.',
                )
              }
            >
              📋 Copy caption
            </button>
            <a
              className="btn btn-sm"
              href={`https://twitter.com/intent/tweet?text=${encoded}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              𝕏 Post
            </a>
            <a
              className="btn btn-sm"
              href={`https://wa.me/?text=${encoded}`}
              target="_blank"
              rel="noopener noreferrer"
            >
              WhatsApp
            </a>
          </div>

          <div aria-live="polite" style={{ minHeight: 22 }}>
            {message && (
              <p style={{ color: 'var(--sun)', fontWeight: 800, fontSize: 14 }}>{message}</p>
            )}
            {error && (
              <p style={{ color: 'var(--coral)', fontWeight: 800, fontSize: 14 }}>{error}</p>
            )}
          </div>

          {disclosure === 'simulated' && (
            <p className="citation" style={{ marginTop: 'auto' }}>
              The sample-data footer is part of the image on purpose. These cards name real rivers,
              and the Coimbra check-ups are modelled rather than measured — a caption can be deleted
              when a picture is reposted, so the label lives in the pixels.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
