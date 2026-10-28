import { useEffect, useRef, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { countries, ru, type City } from '@standup/shared';
import { api } from './api';
import { isInTelegram, onMainButton, setMainButton, showBackButton } from './telegram';

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

/** Назад: нативная BackButton в Telegram, ссылка в браузере. Без `to` — шаг назад по истории. */
export function BackButton({ to, onClick }: { to?: string; onClick?: () => void }) {
  const navigate = useNavigate();
  const handler = useRef<() => void>(() => {});
  handler.current = onClick ?? (() => (to ? navigate(to) : navigate(-1)));
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

export function ErrorText({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="error">{error instanceof Error ? error.message : String(error)}</p>;
}

export function useCities() {
  return useQuery({ queryKey: ['cities'], queryFn: api.cities, staleTime: Infinity });
}

export function CitySelect({
  value,
  onChange,
}: {
  value: number | null;
  onChange: (id: number) => void;
}) {
  const { data: cities = [] } = useCities();
  const byCountry = (country: City['country']) => cities.filter((c) => c.country === country);
  return (
    <label>
      {t.fields.city}
      <select value={value ?? ''} onChange={(e) => onChange(Number(e.target.value))}>
        <option value="" disabled>
          {t.fields.cityPlaceholder}
        </option>
        {countries.map((country) => (
          <optgroup key={country} label={t.countries[country]}>
            {byCountry(country).map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </optgroup>
        ))}
      </select>
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
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  hint?: string;
  optional?: boolean;
  placeholder?: string;
  multiline?: boolean;
  inputMode?: 'numeric' | 'text';
}) {
  return (
    <label>
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
