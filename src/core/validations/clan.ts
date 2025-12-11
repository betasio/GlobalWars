export interface ClanNameValidationResult {
  isValid: boolean;
  error?: string;
}

const CLAN_NAME_REGEX = /^[A-Za-z0-9 ]{3,24}$/;
const CLAN_NICKNAME_REGEX = /^[A-Za-z0-9]{3}$/;

export function sanitizeClanName(name: string): string {
  return name.replace(/\s+/g, " ").trim();
}

export function sanitizeClanNickname(nickname: string): string {
  return nickname.replace(/[^A-Za-z0-9]/g, "").toUpperCase();
}

export function validateClanName(name: string): ClanNameValidationResult {
  const sanitized = sanitizeClanName(name);
  if (!sanitized || !CLAN_NAME_REGEX.test(sanitized)) {
    return { isValid: false, error: "clan.invalid_name" };
  }
  return { isValid: true };
}

export function validateClanNickname(
  nickname: string,
): ClanNameValidationResult {
  const sanitized = sanitizeClanNickname(nickname);
  if (!sanitized || !CLAN_NICKNAME_REGEX.test(sanitized)) {
    return { isValid: false, error: "clan.invalid_nickname" };
  }
  return { isValid: true };
}
