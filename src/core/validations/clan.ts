export interface ClanNameValidationResult {
  isValid: boolean;
  error?: string;
}

const CLAN_NAME_REGEX = /^[A-Za-z0-9_-]{3,20}$/;

export function sanitizeClanName(name: string): string {
  return name.replace(/\s+/g, "").trim();
}

export function validateClanName(name: string): ClanNameValidationResult {
  const sanitized = sanitizeClanName(name);
  if (!sanitized || !CLAN_NAME_REGEX.test(sanitized)) {
    return { isValid: false, error: "clan.invalid_name" };
  }
  return { isValid: true };
}
