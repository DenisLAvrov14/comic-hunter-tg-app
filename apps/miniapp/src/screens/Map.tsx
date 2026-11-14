import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { ru, type MapEvent } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { ComedianCardView } from '../comedian-card';
import { formatDateTime, todayLocal } from '../format';
import { haptic } from '../telegram';
import { CitySelect, ErrorText, Screen, useCities } from '../ui';

const t = ru.app;
const m = t.map;

/**
 * «Карта» комика и организатора: все события города на дату. По нажатию раскрывается
 * состав, по нажатию на комика — его профиль.
 */
export function MapScreen() {
  const { me } = useMe();
  const { data: cities = [] } = useCities();
  const [city, setCity] = useState<number | null>(
    me.comedianProfile?.cityId ?? me.organizerProfile?.cityId ?? null,
  );
  const [date, setDate] = useState(todayLocal);
  const { data, error, isPending } = useQuery({
    queryKey: ['map', city, date],
    queryFn: () => api.map({ city: city ?? undefined, date }),
    enabled: date !== '',
  });
  const cityName = (id: number) => (city ? undefined : cities.find((c) => c.id === id)?.name);

  return (
    <Screen title={m.title}>
      <div className="fields">
        <CitySelect
          value={city}
          onChange={setCity}
          anyLabel={t.events.anyCity}
          onAny={() => setCity(null)}
        />
        <label>
          {m.date}
          <input type="date" value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
      </div>
      <p className="hint">{m.hint}</p>
      {isPending ? (
        <p className="hint">{t.loading}</p>
      ) : error ? (
        <ErrorText error={error} />
      ) : data.length === 0 ? (
        <p className="hint">{m.empty}</p>
      ) : (
        <div className="list">
          {data.map((e) => (
            <MapEventItem key={e.id} e={e} city={cityName(e.venue.cityId)} />
          ))}
        </div>
      )}
    </Screen>
  );
}

function MapEventItem({ e, city }: { e: MapEvent; city?: string }) {
  const [open, setOpen] = useState(false);
  const [person, setPerson] = useState<string | null>(null);
  return (
    <section className={`map-event${open ? ' open' : ''}`}>
      <button
        className="map-event-head"
        aria-expanded={open}
        onClick={() => {
          haptic();
          setOpen(!open);
        }}
      >
        <span className="grow stack-tight">
          <span className="event-when">{formatDateTime(e.startsAt, e.timezone)}</span>
          <strong>{e.title}</strong>
          <span className="hint">
            {e.venue.name}
            {city ? `, ${city}` : ''} · {t.formats[e.format]}
          </span>
          <span className="hint">
            {e.status !== 'recruiting' ? `${t.eventStatuses[e.status]} · ` : ''}
            {t.events.slots(e.acceptedCount, e.slotsCount)}
          </span>
        </span>
        <span className="chevron" aria-hidden="true">
          {open ? '▴' : '▾'}
        </span>
      </button>
      {open && (
        <div className="map-event-body">
          {e.lineup === null ? (
            <p className="hint">{m.lineupHidden}</p>
          ) : e.lineup.length === 0 ? (
            <p className="hint">{m.lineupEmpty}</p>
          ) : (
            <ol className="performers">
              {e.lineup.map((p) => (
                <li key={p.comedianId}>
                  <button
                    className={`performer${person === p.comedianId ? ' active' : ''}`}
                    aria-expanded={person === p.comedianId}
                    onClick={() => setPerson(person === p.comedianId ? null : p.comedianId)}
                  >
                    <span className="performer-pos">{p.position}</span>
                    {p.photoUrl ? (
                      <img className="avatar" src={p.photoUrl} alt="" />
                    ) : (
                      <span className="avatar" />
                    )}
                    <span className="grow">{p.stageName}</span>
                    <span className="chevron" aria-hidden="true">
                      {person === p.comedianId ? '▴' : '▾'}
                    </span>
                  </button>
                  {person === p.comedianId && <ComedianCardView id={p.comedianId} />}
                </li>
              ))}
            </ol>
          )}
          <Link className="link-button" to={`/events/${e.id}`}>
            {m.details} →
          </Link>
        </div>
      )}
    </section>
  );
}
