import {
  comedianCategories,
  linkTypes,
  ru,
  type ComedianCategory,
  type ComedianProfileInput,
  type LinkType,
  type Me,
  type OrganizerProfileInput,
  type UserRole,
} from '@standup/shared';
import { CitySelect, TextField } from './ui';

const t = ru.app;

export interface ComedianDraft {
  stageName: string;
  cityId: number | null;
  contact: string;
  category: ComedianCategory;
  bio: string;
  links: Array<{ type: LinkType; url: string }>;
  travelBufferMinutes: string;
  defaultSetMinutes: string;
  isSearchable: boolean;
}

/** Город по умолчанию — из другого профиля пользователя, если он уже есть. */
function knownCity(me: Me): number | null {
  return me.comedianProfile?.cityId ?? me.organizerProfile?.cityId ?? null;
}

export function comedianDraft(me: Me): ComedianDraft {
  const p = me.comedianProfile;
  return {
    stageName: p?.stageName ?? '',
    cityId: knownCity(me),
    contact: p?.contact ?? (me.telegramUsername ? `@${me.telegramUsername}` : ''),
    category: p?.category ?? 'newbie',
    bio: p?.bio ?? '',
    links: p?.links ?? [],
    travelBufferMinutes: String(p?.travelBufferMinutes ?? 30),
    defaultSetMinutes: p?.defaultSetMinutes ? String(p.defaultSetMinutes) : '',
    isSearchable: p?.isSearchable ?? true,
  };
}

export function comedianReady(d: ComedianDraft): boolean {
  return d.stageName.trim() !== '' && d.cityId !== null && d.contact.trim() !== '';
}

const toInt = (s: string) => (s.trim() === '' ? null : Number.parseInt(s, 10));

/** Минимальный вариант (онбординг) отправляет только обязательные поля — остальные сервер не трогает. */
export function comedianInput(d: ComedianDraft, full: boolean): ComedianProfileInput {
  const base = { stageName: d.stageName.trim(), cityId: d.cityId!, contact: d.contact.trim() };
  if (!full) return base;
  return {
    ...base,
    category: d.category,
    bio: d.bio.trim() || null,
    links: d.links.filter((l) => l.url.trim() !== '').map((l) => ({ ...l, url: l.url.trim() })),
    travelBufferMinutes: toInt(d.travelBufferMinutes) ?? 30,
    defaultSetMinutes: toInt(d.defaultSetMinutes),
    isSearchable: d.isSearchable,
  };
}

export function ComedianFields({
  draft,
  onChange,
  full,
}: {
  draft: ComedianDraft;
  onChange: (d: ComedianDraft) => void;
  full: boolean;
}) {
  const set = <K extends keyof ComedianDraft>(key: K, value: ComedianDraft[K]) =>
    onChange({ ...draft, [key]: value });

  return (
    <>
      <TextField
        label={t.fields.stageName}
        value={draft.stageName}
        onChange={(v) => set('stageName', v)}
      />
      <CitySelect value={draft.cityId} onChange={(v) => set('cityId', v)} />
      <TextField
        label={t.fields.contact}
        value={draft.contact}
        hint={t.fields.contactHint}
        onChange={(v) => set('contact', v)}
      />
      {full && (
        <>
          <label>
            {t.fields.category}
            <select
              value={draft.category}
              onChange={(e) => set('category', e.target.value as ComedianCategory)}
            >
              {comedianCategories.map((c) => (
                <option key={c} value={c}>
                  {t.categories[c]}
                </option>
              ))}
            </select>
          </label>
          <TextField
            label={t.fields.bio}
            optional
            multiline
            value={draft.bio}
            onChange={(v) => set('bio', v)}
          />
          <LinksEditor links={draft.links} onChange={(v) => set('links', v)} />
          <TextField
            label={t.fields.travelBuffer}
            inputMode="numeric"
            value={draft.travelBufferMinutes}
            onChange={(v) => set('travelBufferMinutes', v.replace(/\D/g, ''))}
          />
          <TextField
            label={t.fields.defaultSet}
            optional
            inputMode="numeric"
            value={draft.defaultSetMinutes}
            onChange={(v) => set('defaultSetMinutes', v.replace(/\D/g, ''))}
          />
          <label className="checkbox">
            <input
              type="checkbox"
              checked={draft.isSearchable}
              onChange={(e) => set('isSearchable', e.target.checked)}
            />
            <span>{t.fields.searchable}</span>
          </label>
        </>
      )}
    </>
  );
}

function LinksEditor({
  links,
  onChange,
}: {
  links: ComedianDraft['links'];
  onChange: (links: ComedianDraft['links']) => void;
}) {
  const update = (i: number, patch: Partial<ComedianDraft['links'][number]>) =>
    onChange(links.map((l, j) => (j === i ? { ...l, ...patch } : l)));

  return (
    <div className="field-group">
      <span className="field-label">
        {t.fields.links} <span className="optional">· {t.fields.linksHint}</span>
      </span>
      {links.map((link, i) => (
        <div className="row" key={i}>
          <select
            value={link.type}
            onChange={(e) => update(i, { type: e.target.value as LinkType })}
          >
            {linkTypes.map((lt) => (
              <option key={lt} value={lt}>
                {t.linkTypes[lt]}
              </option>
            ))}
          </select>
          <input
            className="grow"
            type="url"
            placeholder={t.fields.linkUrl}
            value={link.url}
            onChange={(e) => update(i, { url: e.target.value })}
          />
          <button
            className="icon-button"
            aria-label={t.delete}
            onClick={() => onChange(links.filter((_, j) => j !== i))}
          >
            ✕
          </button>
        </div>
      ))}
      {links.length < 10 && (
        <button
          className="secondary"
          onClick={() => onChange([...links, { type: 'video', url: '' }])}
        >
          + {t.add}
        </button>
      )}
    </div>
  );
}

export interface OrganizerDraft {
  displayName: string;
  cityId: number | null;
  projectName: string;
  contact: string;
}

export function organizerDraft(me: Me): OrganizerDraft {
  const p = me.organizerProfile;
  return {
    displayName: p?.displayName ?? me.firstName,
    cityId: knownCity(me),
    projectName: p?.projectName ?? '',
    contact: p?.contact ?? (me.telegramUsername ? `@${me.telegramUsername}` : ''),
  };
}

export function organizerReady(d: OrganizerDraft): boolean {
  return d.displayName.trim() !== '' && d.cityId !== null;
}

export function organizerInput(d: OrganizerDraft, full: boolean): OrganizerProfileInput {
  const base = { displayName: d.displayName.trim(), cityId: d.cityId! };
  if (!full) return base;
  return { ...base, projectName: d.projectName.trim() || null, contact: d.contact.trim() || null };
}

export function OrganizerFields({
  draft,
  onChange,
  full,
}: {
  draft: OrganizerDraft;
  onChange: (d: OrganizerDraft) => void;
  full: boolean;
}) {
  const set = <K extends keyof OrganizerDraft>(key: K, value: OrganizerDraft[K]) =>
    onChange({ ...draft, [key]: value });
  return (
    <>
      <TextField
        label={t.fields.displayName}
        value={draft.displayName}
        onChange={(v) => set('displayName', v)}
      />
      <CitySelect value={draft.cityId} onChange={(v) => set('cityId', v)} />
      {full && (
        <>
          <TextField
            label={t.fields.projectName}
            optional
            value={draft.projectName}
            onChange={(v) => set('projectName', v)}
          />
          <TextField
            label={t.fields.contact}
            optional
            value={draft.contact}
            onChange={(v) => set('contact', v)}
          />
        </>
      )}
    </>
  );
}

const roleOrder: UserRole[] = ['comedian', 'organizer', 'host'];
const roleHint: Record<UserRole, string> = {
  comedian: t.roles.comedianHint,
  organizer: t.roles.organizerHint,
  host: t.roles.hostHint,
};

export function RolePicker({
  value,
  onChange,
}: {
  value: UserRole[];
  onChange: (roles: UserRole[]) => void;
}) {
  const toggle = (role: UserRole) =>
    onChange(value.includes(role) ? value.filter((r) => r !== role) : [...value, role]);
  return (
    <div className="choices">
      {roleOrder.map((role) => (
        <button
          key={role}
          className={`choice${value.includes(role) ? ' selected' : ''}`}
          aria-pressed={value.includes(role)}
          onClick={() => toggle(role)}
        >
          <strong>{t.roles[role]}</strong>
          <span>{roleHint[role]}</span>
        </button>
      ))}
    </div>
  );
}
