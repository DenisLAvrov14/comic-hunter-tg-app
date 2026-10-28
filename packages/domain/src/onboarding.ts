export type Role = 'comedian' | 'organizer' | 'host';

export interface OnboardingInput {
  roles: readonly Role[];
  hasComedianProfile: boolean;
  hasOrganizerProfile: boolean;
}

export type OnboardingStep = 'roles' | 'profile' | 'done';

/** Какие профили обязательны для выбранных ролей. Ведущему отдельный профиль не нужен. */
export function requiredProfiles(roles: readonly Role[]): Array<'comedian' | 'organizer'> {
  const result: Array<'comedian' | 'organizer'> = [];
  if (roles.includes('comedian')) result.push('comedian');
  if (roles.includes('organizer')) result.push('organizer');
  return result;
}

/**
 * Следующий обязательный шаг онбординга. Шаг «уведомления» необязательный
 * (пользователь может не разрешить боту писать), поэтому здесь не учитывается.
 */
export function onboardingStep(input: OnboardingInput): OnboardingStep {
  if (input.roles.length === 0) return 'roles';
  const missing = requiredProfiles(input.roles).some((p) =>
    p === 'comedian' ? !input.hasComedianProfile : !input.hasOrganizerProfile,
  );
  return missing ? 'profile' : 'done';
}
