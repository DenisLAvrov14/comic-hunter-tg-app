import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { ru } from '@standup/shared';
import { api } from '../api';
import { useMe } from '../auth';
import { haptic } from '../telegram';
import { BackButton, ErrorText, Screen, TextField, useCities } from '../ui';

const t = ru.app;

export function VenuesScreen() {
  const { me } = useMe();
  const cityId = me.organizerProfile?.cityId ?? null;
  const { data: cities = [] } = useCities();
  const cityName = cities.find((c) => c.id === cityId)?.name ?? '';

  return (
    <Screen title={t.venues.title} back={<BackButton to="/" />}>
      {cityId === null ? (
        <p className="hint">{t.venues.needProfile}</p>
      ) : (
        <>
          <p className="hint">{t.venues.inCity(cityName)}</p>
          <VenueList cityId={cityId} />
          <NewVenue cityId={cityId} />
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
  if (data.length === 0) return <p className="hint">{t.venues.empty}</p>;
  return (
    <ul className="list">
      {data.map((v) => (
        <li key={v.id}>
          <strong>{v.name}</strong>
          <span className="hint">{v.address}</span>
        </li>
      ))}
    </ul>
  );
}

function NewVenue({ cityId }: { cityId: number }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const create = useMutation({
    mutationFn: () => api.createVenue({ name: name.trim(), address: address.trim(), cityId }),
    onSuccess: () => {
      setName('');
      setAddress('');
      haptic('success');
      void queryClient.invalidateQueries({ queryKey: ['venues', cityId] });
    },
    onError: () => haptic('error'),
  });

  const ready = name.trim() !== '' && address.trim() !== '';
  return (
    <section className="card">
      <h2>{t.venues.add}</h2>
      <TextField label={t.fields.venueName} value={name} onChange={setName} />
      <TextField label={t.fields.address} value={address} onChange={setAddress} />
      <ErrorText error={create.error} />
      <button disabled={!ready || create.isPending} onClick={() => create.mutate()}>
        {t.add}
      </button>
    </section>
  );
}
