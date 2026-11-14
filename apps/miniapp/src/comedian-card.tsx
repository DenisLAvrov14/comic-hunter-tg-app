import { useQuery } from '@tanstack/react-query';
import { socialLinkTypes, ru, type LinkType, type ProfileLink } from '@standup/shared';
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
        <span className="hint">
          {t.categories[data.category]}
          {city ? ` · ${city}` : ''}
        </span>
      </div>
      {data.bio && <p className="pre">{data.bio}</p>}
      <Links title={t.comedianCard.socials} links={data.links.filter((l) => isSocial(l.type))} />
      <Links title={t.comedianCard.videos} links={data.links.filter((l) => !isSocial(l.type))} />
      <span className="hint">{t.invite.gigs(data.gigsCount)}</span>
      {data.contact && (
        <span className="hint">
          {t.fields.contact}: {data.contact}
        </span>
      )}
    </section>
  );
}
