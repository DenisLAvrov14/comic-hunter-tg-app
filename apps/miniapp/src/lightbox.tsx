import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { ru } from '@standup/shared';

const t = ru.app.venues;

/**
 * Просмотр картинок на весь экран внутри приложения (без перехода в браузер):
 * листаются свайпом вбок, на компьютере — стрелками. Закрыть — ✕, Esc или нажатие по фону.
 */
export function Lightbox({
  images,
  start = 0,
  onClose,
}: {
  images: string[];
  start?: number;
  onClose: () => void;
}) {
  const track = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(start);

  useLayoutEffect(() => {
    const el = track.current;
    if (el) el.scrollLeft = start * el.clientWidth;
  }, [start]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') go(1);
      if (e.key === 'ArrowLeft') go(-1);
    };
    window.addEventListener('keydown', onKey);
    const overflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = overflow;
    };
  });

  function go(step: number) {
    const el = track.current;
    if (el) el.scrollBy({ left: step * el.clientWidth, behavior: 'smooth' });
  }

  return createPortal(
    <div className="lightbox" role="dialog" aria-modal="true">
      <div
        className="lightbox-track"
        ref={track}
        onScroll={(e) =>
          setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))
        }
      >
        {images.map((src, i) => (
          <div
            key={`${i}-${src}`}
            className="lightbox-slide"
            onClick={(e) => e.target === e.currentTarget && onClose()}
          >
            <img src={src} alt="" />
          </div>
        ))}
      </div>
      <button type="button" className="lightbox-close" aria-label={t.close} onClick={onClose}>
        ✕
      </button>
      {images.length > 1 && (
        <>
          <span className="lightbox-counter">
            {index + 1} / {images.length}
          </span>
          {index > 0 && (
            <button
              type="button"
              className="lightbox-arrow prev"
              aria-label={t.prev}
              onClick={() => go(-1)}
            >
              ‹
            </button>
          )}
          {index < images.length - 1 && (
            <button
              type="button"
              className="lightbox-arrow next"
              aria-label={t.next}
              onClick={() => go(1)}
            >
              ›
            </button>
          )}
        </>
      )}
    </div>,
    document.body,
  );
}
