import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { eventFormats, ru, type AutoAcceptRule, type AutoAcceptRuleInput } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { askWriteAccess, haptic, openExternal } from '../telegram';
import { BackButton, ErrorText, MainButton, Screen, TextField } from '../ui';

const t = ru.app;
const s = t.settings;
const PRE_SHOW = [15, 30, 45, 60, 90];
const WEEKDAYS = [1, 2, 3, 4, 5, 6, 7];

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
      {me.roles.includes('comedian') && (
        <>
          <RulesSection />
          <FeedSection />
        </>
      )}
      <MainButton text={t.save} loading={saving} disabled={!digestTime} onClick={save} />
    </Screen>
  );
}

/** Доверенные организаторы и правила автопринятия (SPEC §6.2). */
function RulesSection() {
  const queryClient = useQueryClient();
  const rules = useQuery({ queryKey: ['rules'], queryFn: api.rules });
  const [adding, setAdding] = useState(false);
  const [q, setQ] = useState('');
  const organizers = useQuery({
    queryKey: ['organizers', q],
    queryFn: () => api.organizers(q.trim()),
    enabled: adding,
  });
  const save = useMutation({
    mutationFn: ({ organizerId, body }: { organizerId: string; body: AutoAcceptRuleInput }) =>
      api.putRule(organizerId, body),
    onSuccess: (fresh) => {
      haptic('success');
      queryClient.setQueryData(['rules'], fresh);
    },
  });
  const remove = useMutation({
    mutationFn: (organizerId: string) => api.deleteRule(organizerId),
    onSuccess: (fresh) => queryClient.setQueryData(['rules'], fresh),
  });
  const r = t.rules;

  return (
    <section className="card">
      <h2>{r.title}</h2>
      <p className="hint">{r.hint}</p>
      {rules.data?.length === 0 && <p className="hint">{r.empty}</p>}
      {rules.data?.map((rule) => (
        <RuleEditor
          key={rule.organizerId}
          rule={rule}
          saving={save.isPending}
          onSave={(body) => save.mutate({ organizerId: rule.organizerId, body })}
          onRemove={() => remove.mutate(rule.organizerId)}
        />
      ))}
      {adding ? (
        <>
          <TextField label={r.search} value={q} onChange={setQ} />
          {organizers.data
            ?.filter((o) => !rules.data?.some((x) => x.organizerId === o.userId))
            .map((o) => (
              <button
                key={o.userId}
                className="secondary"
                onClick={() => {
                  setAdding(false);
                  save.mutate({ organizerId: o.userId, body: {} });
                }}
              >
                {o.name}
                {o.projectName ? ` · ${o.projectName}` : ''}
              </button>
            ))}
        </>
      ) : (
        <button className="secondary" onClick={() => setAdding(true)}>
          + {r.add}
        </button>
      )}
      <ErrorText error={save.error ?? remove.error} />
    </section>
  );
}

function toggle<T>(list: T[], v: T): T[] {
  return list.includes(v) ? list.filter((x) => x !== v) : [...list, v];
}

function RuleEditor({
  rule,
  saving,
  onSave,
  onRemove,
}: {
  rule: AutoAcceptRule;
  saving: boolean;
  onSave: (body: AutoAcceptRuleInput) => void;
  onRemove: () => void;
}) {
  const r = t.rules;
  const [open, setOpen] = useState(false);
  const [d, setD] = useState({
    formats: rule.formats ?? [],
    weekdays: rule.weekdays ?? [],
    timeFrom: rule.timeFrom ?? '',
    timeTo: rule.timeTo ?? '',
    maxGigsPerDay: rule.maxGigsPerDay ? String(rule.maxGigsPerDay) : '',
  });
  const body = (enabled: boolean): AutoAcceptRuleInput => ({
    enabled,
    formats: d.formats.length ? d.formats : null,
    weekdays: d.weekdays.length ? d.weekdays : null,
    timeFrom: d.timeFrom || null,
    timeTo: d.timeTo || null,
    maxGigsPerDay: d.maxGigsPerDay ? Number(d.maxGigsPerDay) : null,
  });

  return (
    <div className="lineup-row">
      <div className="row">
        <strong className="grow">
          {rule.organizerName}
          {rule.projectName && <span className="hint"> · {rule.projectName}</span>}
        </strong>
        <button className="link-button" onClick={() => setOpen(!open)}>
          {open ? '▴' : '▾'}
        </button>
      </div>
      <label className="checkbox">
        <input
          type="checkbox"
          checked={rule.enabled}
          disabled={saving}
          onChange={(e) => onSave(body(e.target.checked))}
        />
        <span>{r.enabled}</span>
      </label>
      {open && (
        <>
          <span className="field-label">{r.formats}</span>
          <div className="row wrap">
            {eventFormats.map((f) => (
              <button
                key={f}
                className={d.formats.includes(f) ? 'chip active' : 'chip'}
                onClick={() => setD({ ...d, formats: toggle(d.formats, f) })}
              >
                {t.formats[f]}
              </button>
            ))}
          </div>
          <span className="field-label">{r.weekdays}</span>
          <div className="row wrap">
            {WEEKDAYS.map((w) => (
              <button
                key={w}
                className={d.weekdays.includes(w) ? 'chip active' : 'chip'}
                onClick={() => setD({ ...d, weekdays: toggle(d.weekdays, w) })}
              >
                {t.calendar.weekdays[w - 1]}
              </button>
            ))}
          </div>
          <div className="row">
            <label>
              {r.timeFrom}
              <input
                type="time"
                value={d.timeFrom}
                onChange={(e) => setD({ ...d, timeFrom: e.target.value })}
              />
            </label>
            <label>
              {r.timeTo}
              <input
                type="time"
                value={d.timeTo}
                onChange={(e) => setD({ ...d, timeTo: e.target.value })}
              />
            </label>
          </div>
          <TextField
            label={r.maxPerDay}
            optional
            inputMode="numeric"
            value={d.maxGigsPerDay}
            onChange={(v) => setD({ ...d, maxGigsPerDay: v.replace(/\D/g, '') })}
          />
          <div className="row wrap">
            <button disabled={saving} onClick={() => onSave(body(rule.enabled))}>
              {r.save}
            </button>
            <button className="secondary danger-text" onClick={onRemove}>
              {r.remove}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

/** ICS-подписка: webcal для iPhone, https-ссылка для Google (SPEC §10). */
function FeedSection() {
  const queryClient = useQueryClient();
  const feed = useQuery({ queryKey: ['calendarFeed'], queryFn: api.calendarFeed });
  const [copied, setCopied] = useState(false);
  const rotate = useMutation({
    mutationFn: api.rotateCalendarFeed,
    onSuccess: (fresh) => {
      setCopied(false);
      queryClient.setQueryData(['calendarFeed'], fresh);
    },
  });
  const f = t.feed;
  const data = feed.data;
  return (
    <section className="card">
      <h2>{f.title}</h2>
      <p className="hint">{f.hint}</p>
      {data && (
        <>
          <code className="link">{data.url}</code>
          <div className="row wrap">
            <button onClick={() => openExternal(data.webcalUrl)}>{f.subscribe}</button>
            <button
              className="secondary"
              onClick={() =>
                void navigator.clipboard?.writeText(data.url).then(() => {
                  setCopied(true);
                  haptic('success');
                })
              }
            >
              {copied ? f.copied : f.copy}
            </button>
          </div>
          <p className="hint">{f.iphone}</p>
          <p className="hint">{f.google}</p>
          <button
            className="link-button danger-text"
            onClick={() => {
              if (window.confirm(f.rotateConfirm)) rotate.mutate();
            }}
          >
            {f.rotate}
          </button>
        </>
      )}
      <ErrorText error={feed.error ?? rotate.error} />
    </section>
  );
}
