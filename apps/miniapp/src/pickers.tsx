import {
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
  type RefObject,
} from 'react';
import { createPortal } from 'react-dom';
import { ru } from '@standup/shared';
import { isDesktop } from './telegram';

const p = ru.app.picker;

/**
 * Дата (yyyy-MM-dd). На телефоне — системный выбор, на компьютере — свой календарь
 * в цветах темы, как у выпадающих списков (select.tsx).
 */
export function DateInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  if (!isDesktop()) {
    return <input type="date" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <DesktopDate value={value} onChange={onChange} />;
}

/** Время (HH:mm). На компьютере — два столбца: часы и минуты с шагом 5. */
export function TimeInput({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  if (!isDesktop()) {
    return <input type="time" value={value} onChange={(e) => onChange(e.target.value)} />;
  }
  return <DesktopTime value={value} onChange={onChange} />;
}

// --- Общее: кнопка-поле и всплывающее окно под ней ---

function usePopover(width: number, height: number) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const up = below < height && r.top - 8 > below;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - width - 8));
    setPos({
      left,
      width,
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }

  function show() {
    place();
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const onMove = (e: Event) => {
      if (!(e.target instanceof Node && popoverRef.current?.contains(e.target))) place();
    };
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return { open, pos, triggerRef, popoverRef, show, close };
}

function Trigger({
  triggerRef,
  open,
  onClick,
  label,
  placeholder,
  icon,
}: {
  triggerRef: RefObject<HTMLButtonElement>;
  open: boolean;
  onClick: () => void;
  label: string;
  placeholder: string;
  icon: ReactNode;
}) {
  return (
    <button
      ref={triggerRef}
      type="button"
      className={`select-trigger${label ? '' : ' placeholder'}`}
      aria-haspopup="dialog"
      aria-expanded={open}
      onClick={onClick}
    >
      <span>{label || placeholder}</span>
      <svg viewBox="0 0 24 24" aria-hidden="true">
        {icon}
      </svg>
    </button>
  );
}

// --- Дата ---

const pad = (n: number) => String(n).padStart(2, '0');

/** Сегодня по часам устройства — это выбор в интерфейсе, не бизнес-логика. */
function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function shiftDay(date: string, n: number) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

function shiftMonth(month: string, n: number) {
  const d = new Date(`${month}-01T00:00:00Z`);
  d.setUTCMonth(d.getUTCMonth() + n);
  return d.toISOString().slice(0, 7);
}

const utc = (date: string) => new Date(`${date}T00:00:00Z`);

/** «ср, 25 ноября»; год — только если не текущий. */
function dateLabel(date: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return '';
  const sameYear = date.slice(0, 4) === todayKey().slice(0, 4);
  const label = new Intl.DateTimeFormat('ru-RU', {
    weekday: 'short',
    day: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(utc(date));
  return sameYear ? label : `${label} ${date.slice(0, 4)}`;
}

/** «Ноябрь 2026» — без «г.». */
function monthTitle(month: string) {
  const name = new Intl.DateTimeFormat('ru-RU', { month: 'long', timeZone: 'UTC' }).format(
    utc(`${month}-01`),
  );
  return `${name.charAt(0).toUpperCase()}${name.slice(1)} ${month.slice(0, 4)}`;
}

function DesktopDate({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pop = usePopover(296, 340);
  const today = todayKey();
  const [month, setMonth] = useState((value || today).slice(0, 7));

  const first = `${month}-01`;
  const offset = (utc(first).getUTCDay() + 6) % 7;
  const cells = Array.from({ length: 42 }, (_, i) => shiftDay(first, i - offset));
  const title = monthTitle(month);

  function choose(d: string) {
    if (d !== value) onChange(d);
    pop.close();
  }

  return (
    <>
      <Trigger
        triggerRef={pop.triggerRef}
        open={pop.open}
        label={dateLabel(value)}
        placeholder={p.date}
        icon={
          <>
            <rect x="3" y="5" width="18" height="16" rx="3" />
            <path d="M3 10h18M8 3v4M16 3v4" />
          </>
        }
        onClick={() => {
          if (pop.open) return pop.close();
          setMonth((value || today).slice(0, 7));
          pop.show();
        }}
      />
      {pop.open &&
        createPortal(
          <div ref={pop.popoverRef} className="select-popover picker" style={pop.pos} role="dialog">
            <div className="picker-head">
              <button
                type="button"
                className="picker-nav"
                aria-label={p.prevMonth}
                onClick={() => setMonth(shiftMonth(month, -1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M15 6l-6 6 6 6" />
                </svg>
              </button>
              <strong>{title}</strong>
              <button
                type="button"
                className="picker-nav"
                aria-label={p.nextMonth}
                onClick={() => setMonth(shiftMonth(month, 1))}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="M9 6l6 6-6 6" />
                </svg>
              </button>
            </div>
            <div className="picker-grid">
              {p.weekdays.map((w) => (
                <span key={w} className="picker-weekday">
                  {w}
                </span>
              ))}
              {cells.map((d) => {
                const cls = [
                  'picker-day',
                  d.slice(0, 7) !== month ? 'other' : '',
                  d === today ? 'today' : '',
                  d === value ? 'selected' : '',
                ]
                  .filter(Boolean)
                  .join(' ');
                return (
                  <button key={d} type="button" className={cls} onClick={() => choose(d)}>
                    {Number(d.slice(8))}
                  </button>
                );
              })}
            </div>
            <button type="button" className="picker-today" onClick={() => choose(today)}>
              {p.today}
            </button>
          </div>,
          document.body,
        )}
    </>
  );
}

// --- Время ---

const HOURS = Array.from({ length: 24 }, (_, i) => pad(i));
const MINUTES = Array.from({ length: 12 }, (_, i) => pad(i * 5));

function DesktopTime({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const pop = usePopover(176, 300);
  const [h = '', m = ''] = /^\d{2}:\d{2}$/.test(value) ? value.split(':') : [];
  // Нестандартные минуты (например, 20:07) остаются в списке, чтобы их было видно.
  const minutes = m && !MINUTES.includes(m) ? [...MINUTES, m].sort() : MINUTES;

  useLayoutEffect(() => {
    if (!pop.open) return;
    pop.popoverRef.current
      ?.querySelectorAll('[aria-selected="true"]')
      .forEach((el) => el.scrollIntoView({ block: 'center' }));
  }, [pop.open, pop.popoverRef]);

  return (
    <>
      <Trigger
        triggerRef={pop.triggerRef}
        open={pop.open}
        label={h ? `${h}:${m}` : ''}
        placeholder={p.time}
        icon={
          <>
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </>
        }
        onClick={() => (pop.open ? pop.close() : pop.show())}
      />
      {pop.open &&
        createPortal(
          <div
            ref={pop.popoverRef}
            className="select-popover picker picker-time"
            style={pop.pos}
            role="dialog"
          >
            <div className="picker-column" role="listbox" aria-label={p.hours}>
              {HOURS.map((x) => (
                <div
                  key={x}
                  role="option"
                  aria-selected={x === h}
                  className="select-option"
                  // Час без минут — с :00; минуты не сбрасываются.
                  onClick={() => onChange(`${x}:${m || '00'}`)}
                >
                  {x}
                </div>
              ))}
            </div>
            <div className="picker-column" role="listbox" aria-label={p.minutes}>
              {minutes.map((x) => (
                <div
                  key={x}
                  role="option"
                  aria-selected={x === m}
                  className="select-option"
                  onClick={() => {
                    onChange(`${h || '20'}:${x}`);
                    pop.close();
                  }}
                >
                  {x}
                </div>
              ))}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
