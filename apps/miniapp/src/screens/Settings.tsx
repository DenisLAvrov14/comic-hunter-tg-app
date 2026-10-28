import { useState } from 'react';
import { ru } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { askWriteAccess, haptic } from '../telegram';
import { BackButton, ErrorText, MainButton, Screen } from '../ui';

const t = ru.app;
const s = t.settings;
const PRE_SHOW = [15, 30, 45, 60, 90];

export function SettingsScreen() {
  const { me, setUser } = useMe();
  const [digestTime, setDigestTime] = useState(me.digestTime);
  const [preShow, setPreShow] = useState<number | null>(me.preShowMinutes);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);

  async function save() {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      setUser(await api.patchMe({ digestTime, preShowMinutes: preShow }));
      setSaved(true);
      haptic('success');
    } catch (e) {
      setError(e);
      haptic('error');
    } finally {
      setSaving(false);
    }
  }

  async function enableBot() {
    if (await askWriteAccess()) setUser(await api.patchMe({ writeAccessGranted: true }));
  }

  return (
    <Screen title={s.title} back={<BackButton to="/" />}>
      {!me.botStarted && (
        <section className="card">
          <p className="hint">{s.botOff}</p>
          <button onClick={enableBot}>{t.onboarding.enableNotifications}</button>
        </section>
      )}
      <section className="card">
        <label>
          {s.digestTime}
          <input type="time" value={digestTime} onChange={(e) => setDigestTime(e.target.value)} />
          <span className="field-hint">{s.digestHint}</span>
        </label>
        <label>
          {s.preShow}
          <select
            value={preShow ?? ''}
            onChange={(e) => setPreShow(e.target.value === '' ? null : Number(e.target.value))}
          >
            <option value="">{s.preShowOff}</option>
            {PRE_SHOW.map((m) => (
              <option key={m} value={m}>
                {s.minutes(m)}
              </option>
            ))}
          </select>
        </label>
      </section>
      <ErrorText error={error} />
      {saved && <p className="success">{t.saved}</p>}
      <MainButton text={t.save} loading={saving} disabled={!digestTime} onClick={save} />
    </Screen>
  );
}
