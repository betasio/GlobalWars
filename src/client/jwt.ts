import { PlayerProfile, UserMeResponse } from "../core/ApiSchemas";
import {
  ensureFirebaseReady,
  getCachedFirebaseIdToken,
  logoutFirebase,
} from "./firebaseAuth";

export function getApiBase() {
  const { hostname } = new URL(window.location.href);
  const parts = hostname.split(".");

  if (hostname === "localhost") {
    const apiDomain = process?.env?.API_DOMAIN;
    if (apiDomain) {
      return `https://${apiDomain}`;
    }
    return localStorage.getItem("apiHost") ?? "http://localhost:8787";
  }

  if (parts.length >= 3 && parts.slice(-2).join(".") === "co.uk") {
    return `${window.location.protocol}//${parts.slice(-3).join(".")}/api`;
  }

  return `${window.location.origin}/api`;
}

export function getAuthHeader(): string {
  const token = getCachedFirebaseIdToken();
  if (!token) return "";
  return `Bearer ${token}`;
}

export async function tokenLogin(_token: string): Promise<string | null> {
  console.warn("Token login is disabled while Firebase auth is active.");
  return null;
}

export async function logOut() {
  await logoutFirebase();
  return true;
}

export async function getUserMe(): Promise<UserMeResponse | false> {
  const { configured, user } = await ensureFirebaseReady();
  if (!configured || !user) {
    return false;
  }

  return {
    user: {
      email: user.email ?? undefined,
    },
    player: {
      publicId: user.uid,
      roles: [],
      flares: [],
    },
  };
}

export async function fetchPlayerById(
  _playerId: string,
): Promise<PlayerProfile | false> {
  console.warn("Player profile lookups are disabled for Firebase-only auth");
  return false;
}
