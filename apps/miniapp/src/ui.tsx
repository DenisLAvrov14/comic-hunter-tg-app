import { useEffect, useRef, useState, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { filterCityNames, regionOf, regions, ru, type City, type Region } from '@standup/shared';
import { api } from './api';
import { haptic, isInTelegram, onMainButton, setMainButton, showBackButton } from './telegram';
import { Select } from './select';

const t = ru.app;

/**
 * Основное действие экрана. В Telegram — нативная MainButton внизу,
 * в браузере (dev) — обычная кнопка в конце страницы.
 */
export function MainButton({
  text,
  onClick,
  disabled = false,
  loading = false,
}: {
  text: string;
  onClick: () => void;
  disabled?: boolean;
  loading?: boolean;
}) {
  const handler = useRef(onClick);
  handler.current = onClick;
  const tg = isInTelegram();

  useEffect(() => {
    if (tg) setMainButton({ text, enabled: !disabled && !loading, loading });
  }, [tg, text, disabled, loading]);

  useEffect(() => {
    if (!tg) return;
    return onMainButton(() => handler.current());
  }, [tg]);

  if (tg) return null;
  return (
    <button className="main-button" disabled={disabled || loading} onClick={onClick}>
      {loading ? t.loading : text}
    </button>
  );
}

/**
 * Назад: нативная BackButton в Telegram, ссылка в браузере. Без `to` — шаг назад по истории.
 * `fallback` — куда вернуться, если экран открыт по ссылке и истории нет.
 */
export function BackButton({
  to,
  fallback,
  onClick,
}: {
  to?: string;
  fallback?: string;
  onClick?: () => void;
}) {
  const navigate = useNavigate();
  const handler = useRef<() => void>(() => {});
  const target = to ?? (fallback && !(window.history.state?.idx > 0) ? fallback : undefined);
  handler.current = onClick ?? (() => (target ? navigate(target) : navigate(-1)));
  const tg = isInTelegram();

  useEffect(() => {
    if (!tg) return;
    return showBackButton(() => handler.current());
  }, [tg]);

  if (tg) return null;
  return (
    <button className="link-button" onClick={() => handler.current()}>
      ← {t.back}
    </button>
  );
}

export function Screen({
  title,
  back,
  children,
}: {
  title: string;
  back?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="screen">
      {back}
      <h1>{title}</h1>
      {children}
    </div>
  );
}

/**
 * Обязательные поля формы. Кнопка не блокируется молча: при попытке отправить незаполненные
 * поля подсвечиваются, экран прокручивается к первому, под формой — что именно заполнить.
 * Подсветка гаснет у поля, как только его заполнили.
 */
export function useRequired(fields: Array<[label: string, filled: boolean]>) {
  const [shown, setShown] = useState(false);
  // Подписи могут повторяться (город в двух профилях онбординга) — без дублей.
  const missing = shown
    ? [...new Set(fields.filter(([, filled]) => !filled).map(([label]) => label))]
    : [];
  return {
    missing,
    isMissing: (label: string) => missing.includes(label),
    /** true — можно отправлять; иначе показать, чего не хватает. */
    check: () => {
      if (fields.every(([, filled]) => filled)) return true;
      setShown(true);
      haptic('error');
      requestAnimationFrame(() =>
        document.querySelector('.invalid')?.scrollIntoView({ block: 'center', behavior: 'smooth' }),
      );
      return false;
    },
  };
}

export function MissingText({ missing }: { missing: string[] }) {
  if (missing.length === 0) return null;
  return <p className="error">{t.missing(missing.join(', '))}</p>;
}

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error">{error instanceof Error ? error.message : String(error)}</p>;
}

export function useCities() {
  return useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });
}

/**
 * Города региона — только из filterCityNames, в их порядке, во всех списках приложения.
 * Уже выбранный город (из старого профиля) остаётся в списке, даже если его там нет.
 */
function regionCities(cities: City[], region: Region, selected: number | null) {
  const names = filterCityNames[region];
  return cities
    .filter((c) => regionOf(c.country) === region)
    .filter((c) => names.includes(c.name) || c.id === selected)
    .sort((a, b) => rank(names, a.name) - rank(names, b.name));
}

const rank = (names: readonly string[], name: string) =>
  names.includes(name) ? names.indexOf(name) : names.length;

/** Выбор города, сгруппированный по регионам: Россия, Центральная Азия, Европа. */
export function CitySelect({
  value,
  onChange,
  anyLabel,
  onAny,
  invalid,
  label = t.fields.city,
}: {
  value: number | null;
  onChange: (id: number) => void;
  /** Пункт «без фильтра»: выбран, когда value === null. Есть — значит, это фильтр поиска. */
  anyLabel?: string;
  onAny?: () => void;
  invalid?: boolean;
  label?: string;
}) {
  const { data: cities = [] } = useCities();
  return (
    <label className={invalid ? 'invalid' : undefined}>
      {label}
      <Select value={value ?? ''} onChange={(v) => (v ? onChange(Number(v)) : onAny?.())}>
        <option value="" disabled={!anyLabel}>
          {anyLabel ?? t.fields.cityPlaceholder}
        </option>
        {regions.map((region) => (
          <optgroup key={region} label={t.regions[region]}>
            {regionCities(cities, region, value).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </Select>
    </label>
  );
}

export function TextField({
  label,
  value,
  onChange,
  hint,
  optional,
  placeholder,
  multiline,
  inputMode,
  invalid,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'numeric' | 'text';
  /** Обязательное поле не заполнено (после попытки отправить). */
  invalid?: boolean;
}) {
  return (
    <label className={invalid ? 'invalid' : undefined}>
      <span>
        {label}
        {optional && <span className="optional"> · {t.optional}</span>}
      </span>
      {multiline ? (
        <textarea rows={4} value={value} onChange={(e) => onChange(e.target.value)} />
      ) : (
        <input
          value={value}
          placeholder={placeholder}
          inputMode={inputMode}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}
