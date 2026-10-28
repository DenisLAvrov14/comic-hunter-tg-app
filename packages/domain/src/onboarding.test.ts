import { describe, expect, it } from 'vitest';
import { onboardingStep, requiredProfiles } from './onboarding';

const none = { hasComedianProfile: false, hasOrganizerProfile: false };

describe('requiredProfiles', () => {
  it('комику и организатору нужны профили, ведущему — нет', () => {
    expect(requiredProfiles(['comedian'])).toEqual(['comedian']);
    expect(requiredProfiles(['organizer'])).toEqual(['organizer']);
    expect(requiredProfiles(['host'])).toEqual([]);
    expect(requiredProfiles(['host', 'organizer', 'comedian'])).toEqual(['comedian', 'organizer']);
  });
});

describe('onboardingStep', () => {
  it('без ролей — выбор ролей', () => {
    expect(onboardingStep({ roles: [], ...none })).toBe('roles');
  });

  it('комик без профиля — профиль', () => {
    expect(onboardingStep({ roles: ['comedian'], ...none })).toBe('profile');
  });

  it('комик с профилем — готово', () => {
    expect(onboardingStep({ roles: ['comedian'], ...none, hasComedianProfile: true })).toBe('done');
  });

  it('две роли: нужны оба профиля', () => {
    const roles = ['comedian', 'organizer'] as const;
    expect(onboardingStep({ roles, ...none, hasComedianProfile: true })).toBe('profile');
    expect(onboardingStep({ roles, ...none, hasOrganizerProfile: true })).toBe('profile');
    expect(onboardingStep({ roles, hasComedianProfile: true, hasOrganizerProfile: true })).toBe(
      'done',
    );
  });

  it('только ведущий — готово сразу после выбора роли', () => {
    expect(onboardingStep({ roles: ['host'], ...none })).toBe('done');
  });

  it('лишний профиль без роли не мешает', () => {
    expect(
      onboardingStep({ roles: ['organizer'], hasComedianProfile: true, hasOrganizerProfile: true }),
    ).toBe('done');
  });
});
