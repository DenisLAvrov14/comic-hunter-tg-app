import { useRef, useState, type ChangeEvent } from 'react';
import { PHOTO_LIMIT, PHOTO_MAX_BYTES, ru, type Me, type UserRole } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import {
  ComedianFields,
  OrganizerFields,
  RolePicker,
  comedianDraft,
  comedianInput,
  comedianReady,
  organizerDraft,
  organizerInput,
  organizerReady,
} from '../forms';
import { haptic } from '../telegram';
import { BackButton, ErrorText, MainButton, Screen } from '../ui';

const t = ru.app;

/** Сохранение формы: флаг загрузки, ошибка и короткое «Сохранено». */
function useSave(setUser: (u: Me) => void) {
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function run(action: () => Promise<Me>) {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setUser(await action());
      setSaved(true);
      haptic('success');
    } catch (e) {
      setError(e);
      haptic('error');
    } finally {
      setSaving(false);
    }
  }

  const fail = (message: string) => {
    setError(message);
    haptic('error');
  };

  return { saving, saved, error, run, fail };
}

export function ComedianProfileScreen() {
  const { me, setUser } = useMe();
  const [draft, setDraft] = useState(() => comedianDraft(me));
  const save = useSave(setUser);

  return (
    <Screen title={t.profile.title} back={<BackButton to="/" />}>
      <section className="card">
        <ComedianFields draft={draft} onChange={setDraft} full />
      </section>
      {me.comedianProfile && <Photos me={me} setUser={setUser} />}
      <ErrorText error={save.error} />
      {save.saved && <p className="success">{t.saved}</p>}
      <MainButton
        text={t.save}
        loading={save.saving}
        onClick={() =>
          comedianReady(draft)
            ? save.run(() => api.putComedianProfile(comedianInput(draft, true)))
            : save.fail(t.required)
        }
      />
    </Screen>
  );
}

function Photos({ me, setUser }: { me: Me; setUser: (u: Me) => void }) {
  const photos = me.comedianProfile?.photos ?? [];
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function act(action: () => Promise<unknown>) {
    setBusy(true);
    setError(null);
    try {
      await action();
      setUser(await api.me());
    } catch (e) {
      setError(e);
      haptic('error');
    } finally {
      setBusy(false);
    }
  }

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > PHOTO_MAX_BYTES) {
      setError(t.profile.photosHint(PHOTO_LIMIT));
      return;
    }
    void act(() => api.uploadPhoto(file));
  }

  return (
    <section className="card">
      <h2>{t.profile.photos}</h2>
      <p className="hint">{t.profile.photosHint(PHOTO_LIMIT)}</p>
      {photos.length > 0 && (
        <div className="photos">
          {photos.map((p) => (
            <figure key={p.id}>
              <img src={p.previewUrl} alt="" loading="lazy" />
              <button
                className="icon-button"
                aria-label={t.delete}
                disabled={busy}
                onClick={() => act(() => api.deletePhoto(p.id))}
              >
                ✕
              </button>
            </figure>
          ))}
        </div>
      )}
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
      {photos.length < PHOTO_LIMIT && (
        <button className="secondary" disabled={busy} onClick={() => input.current?.click()}>
          {busy ? t.profile.uploading : `+ ${t.profile.addPhoto}`}
        </button>
      )}
      <ErrorText error={error} />
    </section>
  );
}

export function OrganizerProfileScreen() {
  const { me, setUser } = useMe();
  const [draft, setDraft] = useState(() => organizerDraft(me));
  const save = useSave(setUser);

  return (
    <Screen title={t.organizer.title} back={<BackButton to="/" />}>
      <section className="card">
        <OrganizerFields draft={draft} onChange={setDraft} full />
      </section>
      <ErrorText error={save.error} />
      {save.saved && <p className="success">{t.saved}</p>}
      <MainButton
        text={t.save}
        loading={save.saving}
        onClick={() =>
          organizerReady(draft)
            ? save.run(() => api.putOrganizerProfile(organizerInput(draft, true)))
            : save.fail(t.required)
        }
      />
    </Screen>
  );
}

export function RolesScreen() {
  const { me, setUser } = useMe();
  const [roles, setRoles] = useState<UserRole[]>(me.roles);
  const save = useSave(setUser);

  return (
    <Screen title={t.rolesScreen.title} back={<BackButton to="/" />}>
      <RolePicker value={roles} onChange={setRoles} />
      <ErrorText error={save.error} />
      {save.saved && <p className="success">{t.saved}</p>}
      <MainButton
        text={t.save}
        disabled={roles.length === 0}
        loading={save.saving}
        onClick={() => save.run(() => api.putRoles(roles))}
      />
    </Screen>
  );
}
