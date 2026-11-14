import {
  Children,
  isValidElement,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type KeyboardEvent,
  type ReactElement,
  type ReactNode,
} from 'react';
import { createPortal } from 'react-dom';
import { ru } from '@standup/shared';
import { isDesktop } from './telegram';

/**
 * Выпадающий список. Разметка — как у <select>: дочерние <option> и <optgroup>.
 * На телефоне — системный список, на компьютере — свой, в цветах темы Telegram.
 */
export function Select({
  value,
  onChange,
  children,
}: {
  value: string | number;
  onChange: (value: string) => void;
  children: ReactNode;
}) {
  if (!isDesktop()) {
    return (
      <select value={value} onChange={(e) => onChange(e.target.value)}>
        {children}
      </select>
    );
  }
  return <DesktopSelect value={String(value)} onChange={onChange} options={children} />;
}

interface Item {
  value: string;
  label: string;
  disabled: boolean;
  group: string | null;
}

/** Текст пункта: дети <option> могут быть строкой, числом или массивом из них. */
function textOf(node: ReactNode): string {
  if (node == null || typeof node === 'boolean') return '';
  if (typeof node === 'string' || typeof node === 'number') return String(node);
  if (Array.isArray(node)) return node.map(textOf).join('');
  if (isValidElement<{ children?: ReactNode }>(node)) return textOf(node.props.children);
  return '';
}

type OptionProps = { value?: string | number; disabled?: boolean; children?: ReactNode };
type GroupProps = { label?: string; children?: ReactNode };

function collect(children: ReactNode, group: string | null = null, out: Item[] = []): Item[] {
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return;
    if (child.type === 'optgroup') {
      const props = (child as ReactElement<GroupProps>).props;
      collect(props.children, props.label ?? null, out);
    } else if (child.type === 'option') {
      const props = (child as ReactElement<OptionProps>).props;
      const label = textOf(props.children);
      out.push({
        value: String(props.value ?? label),
        label,
        disabled: Boolean(props.disabled),
        group,
      });
    }
  });
  return out;
}

/** С какого числа пунктов появляется поиск. */
const SEARCH_FROM = 12;
const MAX_HEIGHT = 320;

function DesktopSelect({
  value,
  onChange,
  options,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ReactNode;
}) {
  const items = useMemo(() => collect(options), [options]);
  const selected = items.find((i) => i.value === value);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [active, setActive] = useState<string | null>(null);
  const [pos, setPos] = useState<CSSProperties>({});
  const triggerRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const searchable = items.length >= SEARCH_FROM;

  const q = query.trim().toLowerCase();
  // При поиске — без групп: сначала начинающиеся с запроса («ал» → Алматы, потом Нальчик).
  const visible = q
    ? items
        .filter((i) => !i.disabled && i.label.toLowerCase().includes(q))
        .sort(
          (a, b) =>
            Number(!a.label.toLowerCase().startsWith(q)) -
            Number(!b.label.toLowerCase().startsWith(q)),
        )
    : items;
  const choosable = visible.filter((i) => !i.disabled);

  function place() {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const below = window.innerHeight - r.bottom - 8;
    const above = r.top - 8;
    const up = below < Math.min(MAX_HEIGHT, 200) && above > below;
    setPos({
      left: r.left,
      width: Math.max(r.width, 200),
      maxHeight: Math.min(MAX_HEIGHT, up ? above : below),
      ...(up ? { bottom: window.innerHeight - r.top + 4 } : { top: r.bottom + 4 }),
    });
  }

  function show() {
    place();
    setQuery('');
    setActive(selected && !selected.disabled ? selected.value : (choosable[0]?.value ?? null));
    setOpen(true);
  }

  function close(focusTrigger = true) {
    setOpen(false);
    if (focusTrigger) triggerRef.current?.focus();
  }

  function choose(item: Item) {
    if (item.disabled) return;
    if (item.value !== value) onChange(item.value);
    close();
  }

  // Закрыть по клику мимо; при прокрутке и изменении окна — переставить.
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const target = e.target as Node;
      if (!popoverRef.current?.contains(target) && !triggerRef.current?.contains(target)) {
        close(false);
      }
    };
    const onMove = (e: Event) => {
      if (!popoverRef.current?.contains(e.target as Node)) place();
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('scroll', onMove, true);
    window.addEventListener('resize', onMove);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('scroll', onMove, true);
      window.removeEventListener('resize', onMove);
    };
  }, [open]);

  // Фокус в поиск или в список; выбранный пункт — в зоне видимости.
  useLayoutEffect(() => {
    if (!open) return;
    const root = popoverRef.current;
    (root?.querySelector<HTMLElement>('input') ?? root)?.focus();
    root?.querySelector('[aria-selected="true"]')?.scrollIntoView({ block: 'center' });
  }, [open]);

  useEffect(() => {
    if (!open || !active) return;
    popoverRef.current
      ?.querySelector(`[data-value="${CSS.escape(active)}"]`)
      ?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  // При поиске подсвечивать первый подходящий.
  useEffect(() => {
    if (open && q) setActive(choosable[0]?.value ?? null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);

  function onTriggerKey(e: KeyboardEvent) {
    if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
      e.preventDefault();
      show();
    }
  }

  function onPopoverKey(e: KeyboardEvent) {
    const idx = choosable.findIndex((i) => i.value === active);
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      const step = e.key === 'ArrowDown' ? 1 : -1;
      const next = choosable[Math.min(Math.max(idx + step, 0), choosable.length - 1)];
      if (next) setActive(next.value);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      const item = choosable[idx];
      if (item) choose(item);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab') {
      close(false);
    }
  }

  let lastGroup: string | null = null;
  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className={`select-trigger${selected?.disabled || !selected ? ' placeholder' : ''}`}
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={() => (open ? close() : show())}
        onKeyDown={onTriggerKey}
      >
        <span>{selected?.label ?? ''}</span>
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d={open ? 'M6 15l6-6 6 6' : 'M6 9l6 6 6-6'} />
        </svg>
      </button>
      {open &&
        createPortal(
          <div
            ref={popoverRef}
            className="select-popover"
            style={pos}
            tabIndex={-1}
            onKeyDown={onPopoverKey}
          >
            {searchable && (
              <input
                className="select-search"
                type="search"
                placeholder={ru.app.select.search}
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            )}
            <div className="select-list" role="listbox">
              {visible.map((item) => {
                const header = item.group !== lastGroup && item.group && !q ? item.group : null;
                lastGroup = item.group;
                return (
                  <div key={`${item.group}:${item.value}`}>
                    {header && <div className="select-group">{header}</div>}
                    {!(item.disabled && item.value === '') && (
                      <div
                        role="option"
                        data-value={item.value}
                        aria-selected={item.value === value}
                        aria-disabled={item.disabled}
                        className={`select-option${item.value === active ? ' active' : ''}`}
                        onMouseMove={() => !item.disabled && setActive(item.value)}
                        onClick={() => choose(item)}
                      >
                        <span>{item.label}</span>
                        {item.value === value && (
                          <svg viewBox="0 0 24 24" aria-hidden="true">
                            <path d="M5 12.5l4.5 4.5L19 7.5" />
                          </svg>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
              {choosable.length === 0 && <div className="select-empty">{ru.app.select.empty}</div>}
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
