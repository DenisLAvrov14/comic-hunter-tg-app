import { useEffect, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  PHOTO_LIMIT,
  PHOTO_MAX_BYTES,
  VENUE_CAPACITY_MAX,
  ru,
  venueKinds,
  type AdminPerson,
  type Venue,
  type VenueKind,
  type VenueListItem,
} from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { useActiveRole } from '../navigation';
import { haptic, withConfirm } from '../telegram';
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
  const { me } = useMe();
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
      {data.map((venue) => {
        // Админ может назначить реального владельца (например, площадке из каталога).
        const details = me.isAdmin ? <OwnerAssign venue={venue} cityId={cityId} /> : undefined;
        return venue.canEdit ? (
          <OwnVenueCard
            key={venue.id}
            venue={venue}
            cityId={cityId}
            cityName={cityName}
            details={details}
          />
        ) : (
          <VenueCard
            key={venue.id}
            venue={venue}
            cityName={cityName}
            afisha={venue.afisha}
            owner={venue.owner}
            details={details}
          />
        );
      })}
    </div>
  );
}

type HallRow = { name: string; capacity: string };
const oneHall = (capacity = ''): HallRow[] => [{ name: '', capacity }];

/** Строки залов площадки для правки: несколько залов — каждый, иначе одно число мест. */
function hallRows(venue: Venue): HallRow[] {
  if (venue.halls.length > 1) {
    return venue.halls.map((h) => ({ name: h.name, capacity: String(h.capacity) }));
  }
  return oneHall(venue.capacity ? String(venue.capacity) : '');
}

/** Залы из формы → тело запроса: один зал — capacity, несколько — halls. Ошибка — текстом. */
function hallsPayload(
  rows: HallRow[],
): { capacity: number } | { halls: Array<{ name: string; capacity: number }> } {
  const numbers = rows.map((r) => parseCapacity(r.capacity));
  if (numbers.some((n) => n === undefined)) throw new Error(v.capacityInvalid);
  if (rows.length === 1) return { capacity: numbers[0]! };
  if (rows.some((r) => !r.name.trim())) throw new Error(v.hallNamesRequired);
  return { halls: rows.map((r, i) => ({ name: r.name.trim(), capacity: numbers[i]! })) };
}

/**
 * Места площадки: одно поле «Мест в зале»; «+ Ещё зал» — несколько залов, у каждого
 * название и места (у CENTRAL, например, нижний и верхний).
 */
function HallsEditor({
  rows,
  onChange,
  invalid,
}: {
  rows: HallRow[];
  onChange: (rows: HallRow[]) => void;
  invalid?: boolean;
}) {
  const set = (i: number, patch: Partial<HallRow>) =>
    onChange(rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
  return (
    <div className="field-group">
      {rows.length === 1 ? (
        <TextField
          label={v.capacityField}
          value={rows[0]!.capacity}
          onChange={(capacity) => set(0, { capacity })}
          inputMode="numeric"
          hint={v.capacityHint}
          invalid={invalid}
        />
      ) : (
        <>
          <span className="field-label">{v.halls}</span>
          {rows.map((r, i) => (
            <div key={i} className="hall-row">
              <TextField
                label={i === 0 ? v.hallName : ''}
                value={r.name}
                placeholder={v.hallNamePlaceholders[i] ?? v.hallName}
                onChange={(name) => set(i, { name })}
                invalid={invalid && !r.name.trim()}
              />
              <TextField
                label={i === 0 ? v.capacity : ''}
                value={r.capacity}
                onChange={(capacity) => set(i, { capacity })}
                inputMode="numeric"
                invalid={invalid && !r.capacity.trim()}
              />
              <button
                type="button"
                className="icon-button"
                aria-label={v.removeHall}
                onClick={() => onChange(rows.filter((_, j) => j !== i))}
              >
                ✕
              </button>
            </div>
          ))}
        </>
      )}
      {rows.length < 5 && (
        <button
          type="button"
          className="link-button"
          onClick={() => onChange([...rows, { name: '', capacity: '' }])}
        >
          {v.addHall}
        </button>
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
  details,
}: {
  venue: VenueListItem;
  cityId: number;
  cityName?: string;
  details?: ReactNode;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [rows, setRows] = useState<HallRow[]>(oneHall());
  const [kind, setKind] = useState<VenueKind | null>(venue.kind);
  const [website, setWebsite] = useState('');
  const startEdit = () => {
    setRows(hallRows(venue));
    setKind(venue.kind);
    setWebsite(venue.website ?? '');
    save.reset();
    setEditing(true);
  };
  const removePhoto = useMutation({
    mutationFn: (photoId: string) => api.deleteVenuePhoto(venue.id, photoId),
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
    },
    onError: () => haptic('error'),
  });
  const save = useMutation({
    mutationFn: async () => {
      return api.patchVenue(venue.id, {
        ...hallsPayload(rows),
        website: website.trim() || null,
        ...(kind ? { kind } : {}),
      });
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
      details={details}
      gallery={{
        onRemove: (photoId) => {
          withConfirm(v.removePhotoConfirm, () => removePhoto.mutate(photoId), {
            ok: ru.app.confirm.delete,
          });
        },
        add: <AddPhotoCell venue={venue} cityId={cityId} />,
      }}
      onCapacity={startEdit}
      tiles={
        <>
          <LogoTile venue={venue} cityId={cityId} />
          <PhotoTile venue={venue} cityId={cityId} />
          <VenueTile icon="edit" label={v.edit} onClick={startEdit} />
        </>
      }
    >
      {editing && (
        <div className="stack">
          <KindPicker value={kind} onChange={setKind} />
          <HallsEditor rows={rows} onChange={setRows} />
          <TextField
            label={v.website}
            value={website}
            onChange={setWebsite}
            placeholder={v.websiteHint}
            optional
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

/** Добавить фото в галерею своей площадки: скрытый выбор файла и загрузка. */
function useAddPhoto(venue: Venue, cityId: number) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (file.size > PHOTO_MAX_BYTES) throw new Error(v.tooLarge);
      return api.addVenuePhoto(venue.id, file);
    },
    onSuccess: () => {
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
    },
    onError: () => haptic('error'),
  });
  const full = venue.photos.length >= PHOTO_LIMIT;
  const element = (
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
  );
  return { element, pick: () => input.current?.click(), upload, full };
}

/** Плитка «Фото»: добавить ещё фото в галерею (листается в карточке). */
function PhotoTile({ venue, cityId }: { venue: Venue; cityId: number }) {
  const add = useAddPhoto(venue, cityId);
  const error = add.upload.error;
  return (
    <>
      {add.element}
      <VenueTile
        icon="photo"
        label={
          error
            ? error instanceof Error
              ? error.message
              : v.uploadFailed
            : add.upload.isPending
              ? v.uploading
              : add.full
                ? v.photoLimit(PHOTO_LIMIT)
                : venue.photos.length
                  ? `${v.photoShort} · ${venue.photos.length}`
                  : v.addPhoto
        }
        disabled={add.upload.isPending || add.full}
        onClick={add.pick}
      />
    </>
  );
}

/** «+» в галерее раскрытой карточки — то же добавление фото. */
function AddPhotoCell({ venue, cityId }: { venue: Venue; cityId: number }) {
  const add = useAddPhoto(venue, cityId);
  if (add.full) return null;
  return (
    <>
      {add.element}
      <button
        type="button"
        className="venue-gallery-add"
        aria-label={v.addPhoto}
        disabled={add.upload.isPending}
        onClick={add.pick}
      >
        {add.upload.isPending ? '…' : '+'}
      </button>
    </>
  );
}

/** Плитка «Лого» у своей площадки: загрузить, заменить, убрать (✕ в углу). */
function LogoTile({ venue, cityId }: { venue: Venue; cityId: number }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const done = () => {
    haptic('success');
    void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
  };
  const upload = useMutation({
    mutationFn: (file: File) => {
      if (file.size > PHOTO_MAX_BYTES) throw new Error(v.tooLarge);
      return api.uploadVenueLogo(venue.id, file);
    },
    onSuccess: done,
    onError: () => haptic('error'),
  });
  const remove = useMutation({
    mutationFn: () => api.deleteVenueLogo(venue.id),
    onSuccess: done,
    onError: () => haptic('error'),
  });
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
        icon="logo"
        label={
          error
            ? error instanceof Error
              ? error.message
              : v.uploadFailed
            : upload.isPending
              ? v.uploading
              : v.logo
        }
        disabled={busy}
        onClick={() => input.current?.click()}
        corner={
          venue.logoUrl && (
            <button
              type="button"
              className="venue-tile-remove"
              aria-label={`${v.logo}: ${v.remove}`}
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
  const [rows, setRows] = useState<HallRow[]>(oneHall());
  const [kind, setKind] = useState<VenueKind | null>(null);
  const [website, setWebsite] = useState('');
  const [logo, setLogo] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  // Название только что добавленной площадки — для сообщения об успехе.
  const [created, setCreated] = useState<string | null>(null);
  const create = useMutation({
    mutationFn: async () => {
      for (const f of [logo, photo]) {
        if (f && f.size > PHOTO_MAX_BYTES) throw new Error(v.tooLarge);
      }
      const seats = hallsPayload(rows);
      const venue = await api.createVenue({
        name: name.trim(),
        address: address.trim(),
        cityId,
        ...seats,
        kind: kind!,
        website: website.trim() || null,
      });
      // Площадка уже создана: картинки догружаются, ошибка загрузки её не отменяет.
      if (logo) await api.uploadVenueLogo(venue.id, logo);
      if (photo) await api.addVenuePhoto(venue.id, photo);
      return venue;
    },
    onSuccess: (venue) => {
      setCreated(venue.name);
      required.reset();
      setName('');
      setAddress('');
      setRows(oneHall());
      setKind(null);
      setWebsite('');
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
    [v.capacityField, rows.every((r) => r.capacity.trim() !== '')],
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
      <HallsEditor
        rows={rows}
        onChange={change(setRows)}
        invalid={required.isMissing(v.capacityField)}
      />
      <TextField
        label={v.website}
        value={website}
        onChange={change(setWebsite)}
        placeholder={v.websiteHint}
        optional
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

/** Как назвать человека: @ник, если есть, иначе имя. */
function personName(p: { name: string; telegramUsername: string | null }) {
  return p.telegramUsername ? `@${p.telegramUsername}` : p.name;
}

/** Для админа: текущий владелец площадки и назначение другого (поиск по имени или @нику). */
function OwnerAssign({ venue, cityId }: { venue: VenueListItem; cityId: number }) {
  const queryClient = useQueryClient();
  const [searching, setSearching] = useState(false);
  const [q, setQ] = useState('');
  const [done, setDone] = useState<string | null>(null);
  const query = q.trim();
  const found = useQuery({
    queryKey: ['admin', 'users', query],
    queryFn: () => api.searchUsers(query),
    enabled: searching && query.length >= 2,
  });
  const assign = useMutation({
    mutationFn: (p: AdminPerson) => api.assignVenueOwner(venue.id, p.id),
    onSuccess: (_, p) => {
      haptic('success');
      setDone(v.ownerDone(personName(p)));
      setSearching(false);
      setQ('');
      void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
    },
    onError: () => haptic('error'),
  });
  const current = venue.canEdit ? t.admin.you : venue.owner ? personName(venue.owner) : v.ownerNone;
  return (
    <div className="stack">
      <div className="venue-card-detail">
        <span className="hint">{v.owner}</span>
        <span>{current}</span>
      </div>
      {done && <p className="success">{done}</p>}
      {searching ? (
        <>
          <TextField label={v.ownerSearch} value={q} onChange={setQ} />
          {query.length >= 2 &&
            (found.isPending ? (
              <p className="hint">{t.loading}</p>
            ) : found.data?.length === 0 ? (
              <p className="hint">{t.admin.searchEmpty}</p>
            ) : (
              found.data?.map((p) => (
                <div key={p.id} className="row">
                  <span className="grow stack-tight">
                    <span>{personName(p)}</span>
                    {p.telegramUsername && <span className="hint">{p.name}</span>}
                  </span>
                  <button
                    className="secondary"
                    disabled={assign.isPending}
                    onClick={() => {
                      withConfirm(
                        v.ownerConfirm(personName(p), venue.name),
                        () => assign.mutate(p),
                        { destructive: false },
                      );
                    }}
                  >
                    {t.admin.grant}
                  </button>
                </div>
              ))
            ))}
          <ErrorText error={found.error ?? assign.error} />
          <button className="secondary" onClick={() => setSearching(false)}>
            {v.cancel}
          </button>
        </>
      ) : (
        <button
          className="secondary"
          onClick={() => {
            setDone(null);
            setSearching(true);
          }}
        >
          {venue.owner || venue.canEdit ? v.ownerChange : v.ownerAssign}
        </button>
      )}
    </div>
  );
}
