export interface RegistrationSettings {
  requireVerification: boolean;
  revision: number;
}

export function registrationSettings(data?: Record<string, unknown>): RegistrationSettings {
  return { requireVerification: data?.requireVerification !== false,
    revision: typeof data?.revision === "number" ? data.revision : 0 };
}
