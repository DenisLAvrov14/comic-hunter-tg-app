import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { PHOTO_MAX_BYTES, ru, type Venue } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { useActiveRole } from '../navigation';
import { haptic } from '../telegram';
import {
  BackButton,
  CitySelect,
  ErrorText,
  MissingText,
  Screen,
  TextField,
  useRequired,
} from '../ui';

const t = ru.app;
const v = t.venues;
type ImageKind = 'logo' | 'photo';

export function VenuesScreen() {
  const { me } = useMe();
  const { active } = useActiveRole();
  // Город профиля — только значение по умолчанию: смотреть можно любой.
  const [cityId, setCityId] = useState(
    me.organizerProfile?.cityId ?? me.comedianProfile?.cityId ?? null,
  );

  return (
    <Screen title={v.title} back={active === 'organizer' ? undefined : <BackButton to="/more" />}>
      <CitySelect value={cityId} onChange={setCityId} />
      {cityId !== null && (
        <>
          <VenueList cityId={cityId} />
          {me.roles.includes('organizer') && <NewVenue cityId={cityId} />}
        </>
      )}
    </Screen>
  );
}

function VenueList({ cityId }: { cityId: number }) {
  const { data, error, isPending } = useQuery({
    queryKey: ['venues', cityId],
    queryFn: () => api.venues(cityId),
  });
  if (isPending) return <p className="hint">{t.loading}</p>;
  if (error) return <ErrorText error={error} />;
  if (data.length === 0) return <p className="hint">{v.empty}</p>;
  return (
    <div className="list">
      {data.map((venue) => (
        <VenueItem key={venue.id} venue={venue} cityId={cityId} />
      ))}
    </div>
  );
}

function Logo({ url }: { url: string | null }) {
  return url ? (
    <img className="venue-logo" src={url} alt="" loading="lazy" />
  ) : (
    <span className="venue-logo" aria-hidden="true" />
  );
}

function VenueItem({ venue, cityId }: { venue: Venue; cityId: number }) {
  const [open, setOpen] = useState(false);
  const expandable = !!venue.photo || venue.canEdit;
  return (
    <section className="venue-item">
      <button
        className="venue-head"
        aria-expanded={expandable ? open : undefined}
        disabled={!expandable}
        onClick={() => setOpen(!open)}
      >
        <Logo url={venue.logoUrl} />
        <span className="grow stack-tight">
          <strong>{venue.name}</strong>
          <span className="hint">{venue.address}</span>
        </span>
        {expandable && (
          <span className="chevron" aria-hidden="true">
            {open ? '▴' : '▾'}
          </span>
        )}
      </button>
      {open && (
        <div className="venue-body">
          {venue.photo && (
            <a href={venue.photo.url} target="_blank" rel="noreferrer">
              <img className="venue-photo" src={venue.photo.previewUrl} alt="" />
            </a>
          )}
          {venue.canEdit && (
            <div className="row wrap">
              <ImageButton venue={venue} cityId={cityId} kind="logo" />
              <ImageButton venue={venue} cityId={cityId} kind="photo" />
            </div>
          )}
        </div>
      )}
    </section>
  );
}

/** Загрузить, заменить или убрать лого / фото у своей площадки. */
function ImageButton({ venue, cityId, kind }: { venue: Venue; cityId: number; kind: ImageKind }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const has = kind === 'logo' ? !!venue.logoUrl : !!venue.photo;
  const done = () => {
    haptic('success');
    void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => api.uploadVenueImage(venue.id, kind, file),
    onSuccess: done,
    onError: () => haptic('error'),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteVenueImage(venue.id, kind),
    onSuccess: done,
    onError: () => haptic('error'),
  });
  const label = kind === 'logo' ? v.logo : v.photo;
  const busy = upload.isPending || remove.isPending;
  return (
    <div className="stack-tight">
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => {
          const file = pickFile(e);
          if (file) upload.mutate(file);
        }}
      />
      <div className="row">
        <button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {upload.isPending ? v.uploading : `${label}: ${has ? v.change : v.choose}`}
        </button>
        {has && (
          <button
            className="icon-button"
            aria-label={`${label}: ${v.remove}`}
            disabled={busy}
            onClick={() => remove.mutate()}
          >
            ✕
          </button>
        )}
      </div>
      <ErrorText error={upload.error ?? remove.error} />
    </div>
  );
}

/** Файл из input, сброс значения (чтобы можно было выбрать тот же файл снова). */
function pickFile(e: ChangeEvent<HTMLInputElement>): File | null {
  const file = e.target.files?.[0] ?? null;
  e.target.value = '';
  return file;
}

/** Выбранная картинка до загрузки: превью из файла. */
function useFilePreview(file: File | null) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setUrl(null);
    const next = URL.createObjectURL(file);
    setUrl(next);
    return () => URL.revokeObjectURL(next);
  }, [file]);
  return url;
}

function FilePick({
  label,
  hint,
  file,
  onChange,
  round,
}: {
  label: string;
  hint?: string;
  file: File | null;
  onChange: (f: File | null) => void;
  round?: boolean;
}) {
  const input = useRef<HTMLInputElement>(null);
  const preview = useFilePreview(file);
  return (
    <div className="field-group">
      <span className="field-label">
        {label} <span className="optional">· {hint ?? t.optional}</span>
      </span>
      <div className="row">
        {preview && <img className={round ? 'venue-logo' : 'venue-thumb'} src={preview} alt="" />}
        <button className="secondary" onClick={() => input.current?.click()}>
          {file ? v.change : v.choose}
        </button>
        {file && (
          <button className="icon-button" aria-label={v.remove} onClick={() => onChange(null)}>
            ✕
          </button>
        )}
      </div>
      <input
        ref={input}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onChange(pickFile(e))}
      />
    </div>
  );
}

function NewVenue({ cityId }: { cityId: number }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      for (const f of [logo, photo]) {
        if (f && f.size > PHOTO_MAX_BYTES) throw new Error(v.tooLarge);
      }
      const venue = await api.createVenue({ name: name.trim(), address: address.trim(), cityId });
      // Площадка уже создана: картинки догружаются, ошибка загрузки её не отменяет.
      if (logo) await api.uploadVenueImage(venue.id, 'logo', logo);
      if (photo) await api.uploadVenueImage(venue.id, 'photo', photo);
      return venue;
    },
    onSuccess: () => {
      setName('');
      setAddress('');
      setLogo(null);
      setPhoto(null);
      haptic('success');
    },
    onError: () => haptic('error'),
    onSettled: () => void queryClient.invalidateQueries({ queryKey: ['venues', cityId] }),
  });

  const required = useRequired([
    [t.fields.venueName, name.trim() !== ''],
    [t.fields.address, address.trim() !== ''],
  ]);
  return (
    <section className="card">
      <h2>{v.add}</h2>
      <TextField
        label={t.fields.venueName}
        value={name}
        invalid={required.isMissing(t.fields.venueName)}
        onChange={setName}
      />
      <TextField
        label={t.fields.address}
        value={address}
        invalid={required.isMissing(t.fields.address)}
        onChange={setAddress}
      />
      <FilePick label={v.logo} hint={v.logoHint} file={logo} onChange={setLogo} round />
      <FilePick label={v.photo} file={photo} onChange={setPhoto} />
      <MissingText missing={required.missing} />
      <ErrorText error={create.error} />
      <button disabled={create.isPending} onClick={() => required.check() && create.mutate()}>
        {create.isPending ? v.uploading : t.add}
      </button>
    </section>
  );
}
