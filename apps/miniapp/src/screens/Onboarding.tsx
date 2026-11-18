import { useEffect, useRef, useState, type ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { PHOTO_LIMIT, PHOTO_MAX_BYTES, ru, type Me, type UserRole } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import {
  ComedianFields,
  OrganizerFields,
  RolePicker,
  comedianDraft,
  comedianInput,
  comedianRequired,
  organizerDraft,
  organizerInput,
  organizerRequired,
} from '../forms';
import { askWriteAccess, haptic } from '../telegram';
import { BackButton, ErrorText, MainButton, MissingText, useRequired } from '../ui';

const t = ru.app;
const o = t.onboarding;

type Step = 'roles' | 'profile' | 'notifications';

/** Три экрана: роли → минимальный профиль → разрешение на сообщения от бота. */
export function Onboarding() {
  const { me, setUser } = useMe();
  const navigate = useNavigate();
  const [step, setStep] = useState<Step>(me.roles.length > 0 ? 'profile' : 'roles');
  // Если бот уже запущен, третий шаг не нужен — считаем это при входе в онбординг.
  const [needsNotifications] = useState(!me.botStarted);
  const total = needsNotifications ? 3 : 2;

  const finish = () => navigate('/', { replace: true });

  return (
    <div className="screen">
      <p className="hint">{o.step(step === 'roles' ? 1 : step === 'profile' ? 2 : 3, total)}</p>
      {step === 'roles' && (
        <RolesStep
          me={me}
          onDone={(user) => {
            setUser(user);
            setStep('profile');
          }}
        />
      )}
      {step === 'profile' && (
        <ProfileStep
          me={me}
          onBack={() => setStep('roles')}
          onDone={(user) => {
            setUser(user);
            if (needsNotifications) setStep('notifications');
            else finish();
          }}
        />
      )}
      {step === 'notifications' && (
        <NotificationsStep
          me={me}
          onBack={() => setStep('profile')}
          onGranted={setUser}
          onDone={finish}
        />
      )}
    </div>
  );
}

function RolesStep({ me, onDone }: { me: Me; onDone: (user: Me) => void }) {
  const [roles, setRoles] = useState<UserRole[]>(me.roles);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function submit() {
    if (roles.length === 0) {
      setError(t.chooseRole);
      haptic('error');
      return;
    }
    setSaving(true);
    setError(null);
    try {
      onDone(await api.putRoles(roles));
      haptic();
    } catch (e) {
      setError(e);
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <h1>{o.rolesTitle}</h1>
      <p className="hint">{o.rolesHint}</p>
      <RolePicker value={roles} onChange={setRoles} />
      <ErrorText error={error} />
      <MainButton text={t.next} loading={saving} onClick={submit} />
    </>
  );
}

function ProfileStep({
  me,
  onBack,
  onDone,
}: {
  me: Me;
  onBack: () => void;
  onDone: (user: Me) => void;
}) {
  const isComedian = me.roles.includes('comedian');
  const isOrganizer = me.roles.includes('organizer');
  const [comedian, setComedian] = useState(() => comedianDraft(me));
  const [organizer, setOrganizer] = useState(() => organizerDraft(me));
  const [avatar, setAvatar] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);

  // Город, выбранный в одной форме, подставляем в другую, пока там пусто.
  // Любая правка снимает прошлую ошибку.
  const setComedianDraft = (d: typeof comedian) => {
    setComedian(d);
    setError(null);
    if (organizer.cityId === null && d.cityId !== null)
      setOrganizer({ ...organizer, cityId: d.cityId });
  };
  const setOrganizerDraft = (d: typeof organizer) => {
    setOrganizer(d);
    setError(null);
    if (comedian.cityId === null && d.cityId !== null)
      setComedian({ ...comedian, cityId: d.cityId });
  };

  const required = useRequired([
    ...(isComedian ? comedianRequired(comedian) : []),
    ...(isOrganizer ? organizerRequired(organizer) : []),
  ]);

  async function submit() {
    if (!required.check()) return;
    setSaving(true);
    setError(null);
    try {
      let user = me;
      if (isComedian) {
        user = await api.putComedianProfile(comedianInput(comedian));
        // Фото грузим, когда профиль уже есть: первое фото и есть аватар.
        if (avatar) {
          await api.uploadPhoto(avatar);
          setAvatar(null);
          user = await api.me();
        }
      }
      if (isOrganizer) user = await api.putOrganizerProfile(organizerInput(organizer, false));
      haptic('success');
      onDone(user);
    } catch (e) {
      setError(e);
      haptic('error');
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <BackButton onClick={onBack} />
      <h1>{o.profileTitle}</h1>
      {isComedian && (
        <section className="card">
          {isOrganizer && <h2>{o.comedianSection}</h2>}
          <AvatarPicker
            file={avatar}
            current={me.comedianProfile?.photos[0]?.previewUrl ?? null}
            onChange={setAvatar}
            onError={setError}
          />
          <ComedianFields
            draft={comedian}
            onChange={setComedianDraft}
            full={false}
            missing={required.missing}
          />
        </section>
      )}
      {isOrganizer && (
        <section className="card">
          {isComedian && <h2>{o.organizerSection}</h2>}
          <OrganizerFields
            draft={organizer}
            onChange={setOrganizerDraft}
            full={false}
            missing={required.missing}
          />
        </section>
      )}
      {!isComedian && !isOrganizer ? (
        <p className="hint">{o.hostOnly}</p>
      ) : (
        <p className="hint">{t.fillLater}</p>
      )}
      <MissingText missing={required.missing} />
      <ErrorText error={error} />
      <MainButton text={t.next} loading={saving} onClick={submit} />
    </>
  );
}

/** Аватар комика: выбранный файл показываем сразу, загружаем после сохранения профиля. */
function AvatarPicker({
  file,
  current,
  onChange,
  onError,
}: {
  file: File | null;
  /** Уже загруженное фото (если онбординг проходят повторно). */
  current: string | null;
  onChange: (file: File | null) => void;
  onError: (message: string) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [preview, setPreview] = useState<string | null>(null);
  useEffect(() => {
    if (!file) return setPreview(null);
    const url = URL.createObjectURL(file);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  function onFile(e: ChangeEvent<HTMLInputElement>) {
    const picked = e.target.files?.[0];
    e.target.value = '';
    if (!picked) return;
    if (picked.size > PHOTO_MAX_BYTES) return onError(t.profile.photosHint(PHOTO_LIMIT));
    onChange(picked);
  }

  const shown = preview ?? current;
  return (
    <div className="avatar-picker">
      <button
        type="button"
        className="avatar-picker-image"
        aria-label={t.fields.avatarPick}
        onClick={() => input.current?.click()}
      >
        {shown ? <img src={shown} alt="" /> : <span aria-hidden="true">+</span>}
      </button>
      <div className="stack-tight">
        <span className="field-label">
          {t.fields.avatar} <span className="optional">· {t.optional}</span>
        </span>
        <span className="field-hint">{t.fields.avatarHint}</span>
        <button type="button" className="link-button" onClick={() => input.current?.click()}>
          {shown ? t.fields.avatarChange : t.fields.avatarPick}
        </button>
      </div>
      <input ref={input} type="file" accept="image/*" hidden onChange={onFile} />
    </div>
  );
}

function NotificationsStep({
  me,
  onBack,
  onGranted,
  onDone,
}: {
  me: Me;
  onBack: () => void;
  onGranted: (user: Me) => void;
  onDone: () => void;
}) {
  const [state, setState] = useState<'idle' | 'asking' | 'denied'>('idle');
  const [error, setError] = useState<unknown>(null);

  async function enable() {
    setState('asking');
    setError(null);
    try {
      if (await askWriteAccess()) {
        onGranted(await api.patchMe({ writeAccessGranted: true }));
        haptic('success');
        setState('idle');
      } else {
        setState('denied');
      }
    } catch (e) {
      setError(e);
      setState('idle');
    }
  }

  return (
    <>
      <BackButton onClick={onBack} />
      <h1>{o.notificationsTitle}</h1>
      <p>{o.notificationsHint}</p>
      {me.botStarted ? (
        <p className="success">✓ {o.notificationsEnabled}</p>
      ) : (
        <button onClick={enable} disabled={state === 'asking'}>
          {o.enableNotifications}
        </button>
      )}
      {state === 'denied' && <p className="hint">{o.notificationsDenied}</p>}
      <ErrorText error={error} />
      <MainButton text={me.botStarted ? o.finish : o.skip} onClick={onDone} />
    </>
  );
}
