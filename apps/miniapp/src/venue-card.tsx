import { useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ru, type Venue, type VenueListItem } from '@standup/shared';
import { dayLabel, formatTime } from './format';
import { Lightbox } from './lightbox';
import { openExternal, openTelegramProfile } from './telegram';

const v = ru.app.venues;

const ICONS = {
  pin: 'M12 21s-7-6.2-7-11.5A7 7 0 0 1 19 9.5C19 14.8 12 21 12 21Z M12 12a2.5 2.5 0 1 0 0-5 2.5 2.5 0 0 0 0 5Z',
  map: 'M9 4 3 6.5v13L9 17l6 2.5 6-2.5v-13L15 6.5 9 4Z M9 4v13 M15 6.5v13',
  photo:
    'M4 7h3l1.5-2h7L17 7h3a1 1 0 0 1 1 1v10a1 1 0 0 1-1 1H4a1 1 0 0 1-1-1V8a1 1 0 0 1 1-1Z M12 16a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Z',
  logo: 'M12 21a9 9 0 1 0 0-18 9 9 0 0 0 0 18Z M8.5 14.5s1.2 1.5 3.5 1.5 3.5-1.5 3.5-1.5 M9 9.5h.01 M15 9.5h.01',
  mic: 'M12 3a3 3 0 0 0-3 3v6a3 3 0 0 0 6 0V6a3 3 0 0 0-3-3Z M5.5 11a6.5 6.5 0 0 0 13 0 M12 17.5V21',
  seat: 'M6 11V6a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v5 M4 11h16v4H4z M6 15v4 M18 15v4',
  edit: 'M4 20h4L19 9l-4-4L4 16v4Z M13.5 6.5l4 4',
} as const;

export type VenueIcon = keyof typeof ICONS;

export function VenueIconSvg({ name }: { name: VenueIcon }) {
  return (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d={ICONS[name]} />
    </svg>
  );
}

/** Ссылка на площадку в Яндекс Картах. */
export function venueMapUrl(cityName: string | undefined, venue: Venue) {
  const text = [cityName, venue.address, venue.name].filter(Boolean).join(', ');
  return `https://yandex.ru/maps/?text=${encodeURIComponent(text)}`;
}

/** Плитка действия внизу карточки: иконка и подпись. */
export function VenueTile({
  icon,
  label,
  onClick,
  disabled,
  corner,
}: {
  icon: VenueIcon;
  label: string;
  onClick: () => void;
  disabled?: boolean;
  /** Маленькая кнопка в углу плитки (например, «убрать»). */
  corner?: ReactNode;
}) {
  return (
    <div className="venue-tile-wrap">
      <button type="button" className="venue-tile" disabled={disabled} onClick={onClick}>
        <VenueIconSvg name={icon} />
        <span>{label}</span>
      </button>
      {corner}
    </div>
  );
}

/** Плашка-показатель в шапке: иконка с подписью и крупное значение. */
function Stat({
  icon,
  label,
  value,
  onClick,
}: {
  icon: VenueIcon;
  label: string;
  value: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="venue-stat-label">
        <VenueIconSvg name={icon} />
        {label}
      </span>
      <span className="venue-stat-value">{value}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="venue-stat" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="venue-stat">{body}</div>
  );
}

/** «140+»: места всегда с плюсом — сколько вмещает зал, бывает и больше. */
export const seats = (n: number) => `${n}+`;

/** Плашка «Мест»: всего мест; при нескольких залах подпись «2 зала», каждый — в «Подробнее». */
function capacityStat(venue: Venue, editable: boolean) {
  if (venue.halls.length > 1) {
    return {
      label: v.hallsCount(venue.halls.length),
      value: seats(venue.capacity ?? 0),
    };
  }
  return {
    label: v.capacity,
    value: venue.capacity ? seats(venue.capacity) : editable ? v.setCapacity : '—',
  };
}

/** Афиша: ближайшие события площадки; нажатие — открыть событие. */
function AfishaPanel({ afisha, timezone }: { afisha: VenueListItem['afisha']; timezone: string }) {
  const navigate = useNavigate();
  return (
    <div className="venue-afisha">
      <div className="venue-afisha-head">
        <strong>{v.afisha}</strong>
        <span className="hint">{afisha.total ? v.afishaCount(afisha.total) : v.afishaEmpty}</span>
      </div>
      {afisha.items.length > 0 && (
        <div className="venue-afisha-items">
          {afisha.items.map((e, i) => (
            <button
              key={e.id}
              type="button"
              className={i === 0 ? 'venue-afisha-item next' : 'venue-afisha-item'}
              onClick={() => navigate(`/events/${e.id}`)}
            >
              <span className="venue-afisha-time">{formatTime(e.startsAt, timezone)}</span>
              <span className="venue-afisha-day">
                {dayLabel(e.startsAt, timezone, { today: v.today, tomorrow: v.tomorrow })}
              </span>
              <span className="venue-afisha-format">{ru.app.formats[e.format]}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Контакт из профиля: @ник или t.me — открыть профиль в Telegram, ссылка — открыть,
 * остальное (телефон, почта) — просто текст.
 */
export function ContactLink({ contact }: { contact: string }) {
  const text = contact.trim();
  const username = /^(?:@|(?:https?:\/\/)?t\.me\/)([A-Za-z0-9_]{4,32})\/?$/.exec(text)?.[1];
  if (username) {
    return (
      <button type="button" className="link-button" onClick={() => openTelegramProfile(username)}>
        @{username}
      </button>
    );
  }
  if (/^https?:\/\//.test(text)) {
    return (
      <button type="button" className="link-button" onClick={() => openExternal(text)}>
        {text.replace(/^https?:\/\//, '')}
      </button>
    );
  }
  return <span>{text}</span>;
}

/** Строка «Владелец @ник»: ник — ссылка на профиль в Telegram, чтобы написать. */
function OwnerLine({ owner }: { owner: NonNullable<VenueListItem['owner']> }) {
  const username = owner.telegramUsername;
  return (
    <p className="venue-card-meta">
      <span className="hint">{v.owner}</span>{' '}
      {username ? (
        <button type="button" className="link-button" onClick={() => openTelegramProfile(username)}>
          @{username}
        </button>
      ) : (
        <span>{owner.name}</span>
      )}
      {owner.contact && owner.contact !== `@${username}` && (
        <>
          <span className="hint"> · </span>
          <ContactLink contact={owner.contact} />
        </>
      )}
    </p>
  );
}

/** Картинки карточки: фото по порядку; без фото — лого. preview — в карточке, full — на весь экран. */
function venueSlides(venue: Venue) {
  if (venue.photos.length > 0) {
    return venue.photos.map((p) => ({ preview: p.previewUrl, full: p.url }));
  }
  return venue.logoUrl ? [{ preview: venue.logoUrl, full: venue.logoUrl }] : [];
}

/** Слайдер в карточке: листается вбок, точки показывают, какое фото открыто. */
function MediaSlider({
  slides,
  onOpen,
}: {
  slides: Array<{ preview: string }>;
  onOpen: (index: number) => void;
}) {
  const [index, setIndex] = useState(0);
  return (
    <>
      <div
        className="venue-slider"
        onScroll={(e) =>
          setIndex(Math.round(e.currentTarget.scrollLeft / e.currentTarget.clientWidth))
        }
      >
        {slides.map((s, i) => (
          <button
            key={`${i}-${s.preview}`}
            type="button"
            className="venue-slide"
            aria-label={v.openPhoto}
            onClick={() => onOpen(i)}
          >
            <img src={s.preview} alt="" loading="lazy" />
          </button>
        ))}
      </div>
      {slides.length > 1 && (
        <span className="venue-slider-dots" aria-hidden="true">
          {slides.map((s, i) => (
            <i key={`${i}-${s.preview}`} className={i === index ? 'active' : undefined} />
          ))}
        </span>
      )}
    </>
  );
}

/** Галерея в раскрытой карточке; у владельца — ✕ на фото и кнопка «добавить». */
function Gallery({
  venue,
  onOpen,
  onRemove,
  add,
}: {
  venue: Venue;
  onOpen: (index: number) => void;
  onRemove?: (photoId: string) => void;
  add?: ReactNode;
}) {
  if (venue.photos.length === 0 && !add) return null;
  return (
    <div className="venue-gallery">
      <span className="hint">{v.photos}</span>
      <div className="venue-gallery-grid">
        {venue.photos.map((p, i) => (
          <div key={p.id} className="venue-gallery-item">
            <button type="button" aria-label={v.openPhoto} onClick={() => onOpen(i)}>
              <img src={p.previewUrl} alt="" loading="lazy" />
            </button>
            {onRemove && (
              <button
                type="button"
                className="venue-tile-remove"
                aria-label={v.removePhoto}
                onClick={() => onRemove(p.id)}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        {add}
      </div>
    </div>
  );
}

/**
 * Карточка площадки. Шапка — слайдер фото на всю её высоту слева; справа название, город,
 * адрес и две плашки: «Мест» и «На карте». Ниже — афиша, статус, плитки и «Подробнее».
 */
export function VenueCard({
  venue,
  cityName,
  showStatus = true,
  onCapacity,
  afisha,
  owner,
  tiles,
  details,
  gallery,
  children,
}: {
  venue: Venue;
  cityName?: string;
  /** Ближайшие события — у проверенной площадки в общем списке. */
  afisha?: VenueListItem['afisha'];
  /** Кто добавил площадку — показывается, если это не вы. */
  owner?: VenueListItem['owner'];
  /** Плашка с пояснением «На проверке» / «Отклонена». */
  showStatus?: boolean;
  /** Нажатие на «Мест» — у своей площадки, чтобы поменять число. */
  onCapacity?: () => void;
  /** Плитки действий внизу (лого и фото у своей площадки). */
  tiles?: ReactNode;
  /** Дополнительно в раскрытой карточке (например, назначение владельца для админа). */
  details?: ReactNode;
  /** Владелец: удалить фото и кнопка «добавить» в галерее раскрытой карточки. */
  gallery?: { onRemove: (photoId: string) => void; add?: ReactNode };
  children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  // Открытая на весь экран картинка: список и с какой начать.
  const [viewer, setViewer] = useState<{ images: string[]; start: number } | null>(null);
  const slides = venueSlides(venue);
  const openSlides = (start: number) => setViewer({ images: slides.map((s) => s.full), start });
  const openPhotos = (start: number) =>
    setViewer({ images: venue.photos.map((p) => p.url), start });
  const status = venue.status === 'approved' ? null : venue.status;
  const media = (
    <>
      {slides.length > 0 ? (
        <MediaSlider slides={slides} onOpen={openSlides} />
      ) : (
        <span className="venue-card-placeholder">
          <VenueIconSvg name="mic" />
        </span>
      )}
      {venue.kind && <span className="venue-card-kind">{v.kinds[venue.kind]}</span>}
      {status && (
        <span className={status === 'rejected' ? 'venue-card-chip danger' : 'venue-card-chip'}>
          {status === 'rejected' ? v.rejected : v.pending}
        </span>
      )}
      {venue.photos.length > 0 && venue.logoUrl && (
        <button
          type="button"
          className="venue-card-avatar"
          aria-label={v.logo}
          onClick={() => setViewer({ images: [venue.logoUrl!], start: 0 })}
        >
          <img src={venue.logoUrl} alt="" loading="lazy" />
        </button>
      )}
    </>
  );

  return (
    <section className="venue-card">
      <div className="venue-card-top">
        <div className="venue-card-media">{media}</div>
        <div className="venue-card-info">
          <h3 className="venue-card-name">{venue.name}</h3>
          {cityName && <span className="venue-card-city">{cityName}</span>}
          <span className="venue-card-address">
            <VenueIconSvg name="pin" />
            <span>{venue.address}</span>
          </span>
          <div className="venue-stats">
            <Stat icon="seat" {...capacityStat(venue, !!onCapacity)} onClick={onCapacity} />
            <button
              type="button"
              className="venue-stat venue-stat-map"
              onClick={() => openExternal(venueMapUrl(cityName, venue))}
            >
              <VenueIconSvg name="map" />
              {v.onMap}
            </button>
          </div>
        </div>
      </div>

      {afisha && venue.status === 'approved' && (
        <AfishaPanel afisha={afisha} timezone={venue.timezone} />
      )}

      {showStatus && status && (
        <div className={status === 'rejected' ? 'venue-card-panel danger' : 'venue-card-panel'}>
          <span className="hint">
            {status === 'rejected' ? v.rejectedHint(venue.rejectReason) : v.pendingHint}
          </span>
        </div>
      )}

      {tiles && <div className="venue-card-tiles">{tiles}</div>}

      {children}

      {open && (
        <div className="venue-card-details">
          {venue.halls.length > 1 &&
            venue.halls.map((h) => (
              <div key={h.name} className="venue-card-detail">
                <span className="hint">{h.name}</span>
                <span>{v.hallSeats(h.capacity)}</span>
              </div>
            ))}
          <div className="venue-card-detail">
            <span className="hint">{v.website}</span>
            {venue.website ? (
              <button
                type="button"
                className="link-button"
                onClick={() => openExternal(venue.website!)}
              >
                {venue.website.replace(/^https?:\/\/(www\.)?/, '')} ↗
              </button>
            ) : (
              <span className="hint">{v.websiteNone}</span>
            )}
          </div>
          <Gallery
            venue={venue}
            onOpen={openPhotos}
            onRemove={gallery?.onRemove}
            add={gallery?.add}
          />
          {details}
        </div>
      )}
      {viewer && (
        <Lightbox images={viewer.images} start={viewer.start} onClose={() => setViewer(null)} />
      )}
      <div className="venue-card-footer">
        {owner && !venue.canEdit ? <OwnerLine owner={owner} /> : <span />}
        <button
          type="button"
          className="link-button venue-card-more"
          aria-expanded={open}
          onClick={() => setOpen(!open)}
        >
          {open ? `${v.less} ▴` : `${v.more} ▾`}
        </button>
      </div>
    </section>
  );
}
