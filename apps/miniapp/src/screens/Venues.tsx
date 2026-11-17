import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PHOTO_MAX_BYTES,
  VENUE_CAPACITY_MAX,
  ru,
  venueKinds,
  type Venue,
  type VenueKind,
  type VenueListItem,
} from '@standup/shared';
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
  useCities,
  useRequired,
} from '../ui';
import { VenueCard, VenueTile } from '../venue-card';

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
  const cities = useCities();
  const cityName = cities.data?.find((c) => c.id === cityId)?.name;
  const { data, error, isPending } = useQuery({
    queryKey: ['venues', cityId],
    queryFn: () => api.venues(cityId),
  });
  if (isPending) return <p className="hint">{t.loading}</p>;
  if (error) return <ErrorText error={error} />;
  if (data.length === 0) return <p className="hint">{v.empty}</p>;
  return (
    <div className="list">
      {data.map((venue) =>
        venue.canEdit ? (
          <OwnVenueCard key={venue.id} venue={venue} cityId={cityId} cityName={cityName} />
        ) : (
          <VenueCard
            key={venue.id}
            venue={venue}
            cityName={cityName}
            afisha={venue.afisha}
            owner={venue.owner}
          />
        ),
      )}
    </div>
  );
}

/** Строка поля «Мест в зале» → число или undefined (пусто или не число). */
function parseCapacity(value: string): number | undefined {
  const text = value.replace(/\s/g, '');
  if (!text) return undefined;
  const n = Number(text);
  return Number.isInteger(n) && n >= 1 && n <= VENUE_CAPACITY_MAX ? n : undefined;
}

/** Выбор типа площадки — чипы в ряд. */
function KindPicker({
  value,
  onChange,
  invalid,
}: {
  value: VenueKind | null;
  onChange: (kind: VenueKind) => void;
  invalid?: boolean;
}) {
  return (
    <div className={invalid ? 'field-group invalid' : 'field-group'}>
      <span className="field-label">{v.kind}</span>
      <div className="row wrap">
        {venueKinds.map((k) => (
          <button
            key={k}
            type="button"
            className={value === k ? 'chip active' : 'chip'}
            onClick={() => onChange(k)}
          >
            {v.kinds[k]}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Своя площадка: можно поменять тип и число мест («Изменить» или «Мест»), лого и фото. */
function OwnVenueCard({
  venue,
  cityId,
  cityName,
}: {
  venue: VenueListItem;
  cityId: number;
  cityName?: string;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [value, setValue] = useState('');
  const [kind, setKind] = useState<VenueKind | null>(venue.kind);
  const startEdit = () => {
    setValue(venue.capacity ? String(venue.capacity) : '');
    setKind(venue.kind);
    save.reset();
    setEditing(true);
  };
  const save = useMutation({
    mutationFn: async () => {
      const capacity = parseCapacity(value);
      if (capacity === undefined) throw new Error(v.capacityInvalid);
      return api.patchVenue(venue.id, { capacity, ...(kind ? { kind } : {}) });
    },
    onSuccess: () => {
      haptic('success');
      setEditing(false);
      void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
    },
    onError: () => haptic('error'),
  });
  return (
    <VenueCard
      venue={venue}
      cityName={cityName}
      afisha={venue.afisha}
      onCapacity={startEdit}
      tiles={
        <>
          <ImageTile venue={venue} cityId={cityId} kind="logo" />
          <ImageTile venue={venue} cityId={cityId} kind="photo" />
          <VenueTile icon="edit" label={v.edit} onClick={startEdit} />
        </>
      }
    >
      {editing && (
        <div className="stack">
          <KindPicker value={kind} onChange={setKind} />
          <TextField
            label={v.capacityField}
            value={value}
            onChange={setValue}
            inputMode="numeric"
            hint={v.capacityHint}
          />
          <ErrorText error={save.error} />
          <div className="action-bar">
            <button disabled={save.isPending} onClick={() => save.mutate()}>
              {v.save}
            </button>
            <button className="secondary" onClick={() => setEditing(false)}>
              {v.cancel}
            </button>
          </div>
        </div>
      )}
    </VenueCard>
  );
}

/** Плитка «Лого» / «Фото» у своей площадки: загрузить, заменить, убрать (✕ в углу). */
function ImageTile({ venue, cityId, kind }: { venue: Venue; cityId: number; kind: ImageKind }) {
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
  const label = kind === 'logo' ? v.logo : v.photoShort;
  const busy = upload.isPending || remove.isPending;
  const error = upload.error ?? remove.error;
  return (
    <>
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
      <VenueTile
        icon={kind === 'logo' ? 'logo' : 'photo'}
        label={
          error
            ? error instanceof Error
              ? error.message
              : v.uploadFailed
            : upload.isPending
              ? v.uploading
              : label
        }
        disabled={busy}
        onClick={() => input.current?.click()}
        corner={
          has && (
            <button
              type="button"
              className="venue-tile-remove"
              aria-label={`${label}: ${v.remove}`}
              disabled={busy}
              onClick={() => remove.mutate()}
            >
              ✕
            </button>
          )
        }
      />
    </>
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
        <button className="secondary grow" onClick={() => input.current?.click()}>
          {file ? v.change : v.pickFile}
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
  const [capacity, setCapacity] = useState('');
  const [kind, setKind] = useState<VenueKind | null>(null);
  const [logo, setLogo] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // Название только что добавленной площадки — для сообщения об успехе.
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      for (const f of [logo, photo]) {
        if (f && f.size > PHOTO_MAX_BYTES) throw new Error(v.tooLarge);
      }
      const seats = parseCapacity(capacity);
      if (seats === undefined) throw new Error(v.capacityInvalid);
      const venue = await api.createVenue({
        name: name.trim(),
        address: address.trim(),
        cityId,
        capacity: seats,
        kind: kind!,
      });
      // Площадка уже создана: картинки догружаются, ошибка загрузки её не отменяет.
      if (logo) await api.uploadVenueImage(venue.id, 'logo', logo);
      if (photo) await api.uploadVenueImage(venue.id, 'photo', photo);
      return venue;
    },
    onSuccess: (venue) => {
      setCreated(venue.name);
      required.reset();
      setName('');
      setAddress('');
      setCapacity('');
      setKind(null);
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
    [v.kind, kind !== null],
    [v.capacityField, capacity.trim() !== ''],
  ]);
  const change =
    <T,>(set: (value: T) => void) =>
    (value: T) => {
      setCreated(null);
      set(value);
    };
  return (
    <section className="card">
      <h2>{v.add}</h2>
      <TextField
        label={t.fields.venueName}
        value={name}
        invalid={required.isMissing(t.fields.venueName)}
        onChange={change(setName)}
      />
      <TextField
        label={t.fields.address}
        value={address}
        invalid={required.isMissing(t.fields.address)}
        onChange={change(setAddress)}
      />
      <KindPicker value={kind} onChange={change(setKind)} invalid={required.isMissing(v.kind)} />
      <TextField
        label={v.capacityField}
        value={capacity}
        onChange={change(setCapacity)}
        inputMode="numeric"
        hint={v.capacityHint}
        invalid={required.isMissing(v.capacityField)}
      />
      <FilePick label={v.logo} hint={v.logoHint} file={logo} onChange={setLogo} round />
      <FilePick label={v.photo} file={photo} onChange={setPhoto} />
      <MissingText missing={required.missing} />
      <ErrorText error={create.error} />
      {created && <p className="success">{v.created(created)}</p>}
      <button disabled={create.isPending} onClick={() => required.check() && create.mutate()}>
        {create.isPending ? v.uploading : t.add}
      </button>
    </section>
  );
}
