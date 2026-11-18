import { useQuery } from '@tanstack/react-query';
import {
  socialLinkTypes,
  ru,
  type ComedianExperience,
  type LinkType,
  type ProfileLink,
} from '@standup/shared';
import { api } from './api';
import { ErrorText, useCities } from './ui';

const t = ru.app;

const isSocial = (type: LinkType) => (socialLinkTypes as readonly LinkType[]).includes(type);

function Links({ title, links }: { title: string; links: ProfileLink[] }) {
  if (links.length === 0) return null;
  return (
    <div className="stack-tight">
      <span className="field-label">{title}</span>
      <div className="row wrap">
        {links.map((l, i) => (
          <a key={`${l.url}-${i}`} className="chip" href={l.url} target="_blank" rel="noreferrer">
            {t.linkTypes[l.type]}
          </a>
        ))}
      </div>
    </div>
  );
}

/** Опыт: стаж, частота и «всего примерно» плашками, ниже — сеты и языки. */
function Experience({ data }: { data: ComedianExperience }) {
  const facts = [
    data.startedYear !== null && t.invite.since(data.startedYear),
    data.gigsPerMonth !== null && t.invite.perMonth(data.gigsPerMonth),
    data.totalGigsEstimate !== null && t.invite.total(data.totalGigsEstimate),
  ].filter((f): f is string => !!f);
  if (facts.length === 0 && data.setLengths.length === 0 && data.languages.length === 0) {
    return null;
  }
  return (
    <div className="stack-tight comedian-experience">
      {facts.length > 0 && (
        <div className="event-facts">
          {facts.map((f) => (
            <span key={f}>{f}</span>
          ))}
        </div>
      )}
      {data.setLengths.length > 0 && <span>{t.invite.sets(data.setLengths.join(', '))}</span>}
      {data.languages.length > 0 && (
        <span>
          {t.invite.languages(data.languages.map((l) => t.languages[l].toLowerCase()).join(', '))}
        </span>
      )}
    </div>
  );
}

/**
 * Профиль комика (SPEC §10): фото, кто он, соцсети, видео, выступления через приложение.
 * Контакт приходит только организаторам.
 */
export function ComedianCardView({ id }: { id: string }) {
  const { data: cities = [] } = useCities();
  const { data, error, isPending } = useQuery({
    queryKey: ['comedian', id],
    queryFn: () => api.comedian(id),
  });
  if (isPending) return <p className="hint">{t.loading}</p>;
  if (error) return <ErrorText error={error} />;
  const city = cities.find((c) => c.id === data.cityId)?.name;
  return (
    <section className="card comedian-card">
      {data.photos.length > 0 && (
        <div className="photos">
          {data.photos.map((p) => (
            <figure key={p.id}>
              <img src={p.previewUrl} alt="" loading="lazy" />
            </figure>
          ))}
        </div>
      )}
      <div className="stack-tight">
        <strong>{data.stageName}</strong>
        {city && <span className="hint">{city}</span>}
      </div>
      <Experience data={data} />
      {data.bio && <p className="pre">{data.bio}</p>}
      <Links title={t.comedianCard.socials} links={data.links.filter((l) => isSocial(l.type))} />
      <Links title={t.comedianCard.videos} links={data.links.filter((l) => !isSocial(l.type))} />
      <div className="stack-tight">
        <span className="hint">{t.invite.gigs(data.gigsCount)}</span>
        {data.contact && (
          <span className="hint">
            {t.fields.contact}: {data.contact}
          </span>
        )}
      </div>
    </section>
  );
}
