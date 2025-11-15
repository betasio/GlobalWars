import { decodeJwt } from "jose";
import {
  TokenPayload,
  TokenPayloadSchema,
  UserMeResponse,
} from "../core/ApiSchemas";
import { firebasePromise } from "./firebase";

interface FirebaseUser {
  uid: string;
  email?: string | null;
  displayName?: string | null;
  photoURL?: string | null;
  getIdToken: (forceRefresh?: boolean) => Promise<string>;
}

interface FirebaseAuthCompat {
  currentUser: FirebaseUser | null;
  useDeviceLanguage?: () => void;
  signInWithPopup: (provider: any) => Promise<any>;
  signInWithRedirect: (provider: any) => Promise<void>;
  signOut: () => Promise<void>;
  onIdTokenChanged: (callback: (user: FirebaseUser | null) => void) => void;
  getRedirectResult?: () => Promise<{ user?: FirebaseUser | null } | null>;
  GoogleAuthProvider: new () => any;
}

const LOCAL_STORAGE_TOKEN_KEY = "token";
let firebaseAuth: FirebaseAuthCompat | null = null;
let firebaseNamespace: any | null = null;
let cachedUser: FirebaseUser | null = null;
let cachedToken: string | null = null;
let initializing = false;

export type IsLoggedInResponse =
  | { token: string; claims: TokenPayload }
  | false;

let __isLoggedIn: IsLoggedInResponse | undefined = undefined;

function setStoredToken(token: string | null) {
  if (token) {
    localStorage.setItem(LOCAL_STORAGE_TOKEN_KEY, token);
  } else {
    localStorage.removeItem(LOCAL_STORAGE_TOKEN_KEY);
  }
  __isLoggedIn = undefined;
}

function parseToken(token: string): TokenPayload | null {
  try {
    const payload = decodeJwt(token);
    const result = TokenPayloadSchema.safeParse(payload);
    if (!result.success) {
      console.warn("Token validation failed", result.error);
      return null;
    }
    return result.data;
  } catch (error) {
    console.warn("Failed to decode token", error);
    return null;
  }
}

function getStoredToken(): string | null {
  if (cachedToken) {
    return cachedToken;
  }
  const stored = localStorage.getItem(LOCAL_STORAGE_TOKEN_KEY);
  if (!stored) {
    return null;
  }
  const claims = parseToken(stored);
  if (!claims) {
    setStoredToken(null);
    return null;
  }
  if (claims.exp) {
    const now = Math.floor(Date.now() / 1000);
    if (now >= claims.exp) {
      setStoredToken(null);
      return null;
    }
  }
  cachedToken = stored;
  return stored;
}

async function ensureUserDocument(user: FirebaseUser) {
  try {
    if (!firebaseNamespace?.firestore) {
      return;
    }
    const firestore = firebaseNamespace.firestore();
    const fieldValue = firebaseNamespace.firestore.FieldValue;
    const docRef = firestore.collection("users").doc(user.uid);
    const lastLoginAt =
      fieldValue && typeof fieldValue.serverTimestamp === "function"
        ? fieldValue.serverTimestamp()
        : new Date().toISOString();
    await docRef.set(
      {
        email: user.email ?? null,
        displayName: user.displayName ?? null,
        photoURL: user.photoURL ?? null,
        lastLoginAt,
      },
      { merge: true },
    );
  } catch (error) {
    console.warn("Failed to write user document", error);
  }
}

async function refreshIdToken(forceRefresh = false): Promise<string | null> {
  await initializeFirebaseAuth();
  if (!firebaseAuth || !firebaseAuth.currentUser) {
    setStoredToken(null);
    cachedToken = null;
    return null;
  }
  try {
    const token = await firebaseAuth.currentUser.getIdToken(forceRefresh);
    cachedToken = token;
    setStoredToken(token);
    return token;
  } catch (error) {
    console.warn("Failed to refresh Firebase ID token", error);
    setStoredToken(null);
    cachedToken = null;
    return null;
  }
}

async function initializeFirebaseAuth(): Promise<void> {
  if (firebaseAuth || initializing) {
    return;
  }
  initializing = true;
  try {
    firebaseNamespace = await firebasePromise;
    const auth = firebaseNamespace.auth();
    firebaseAuth = auth;
    auth.useDeviceLanguage?.();

    auth.onIdTokenChanged(async (user: FirebaseUser | null) => {
      cachedUser = user;
      if (user) {
        cachedToken = await user.getIdToken();
        setStoredToken(cachedToken);
        await ensureUserDocument(user);
      } else {
        cachedToken = null;
        setStoredToken(null);
      }
      __isLoggedIn = undefined;
    });

    if (auth.getRedirectResult) {
      auth
        .getRedirectResult()
        .then((result) => {
          if (result?.user) {
            void ensureUserDocument(result.user);
          }
        })
        .catch((error) => {
          console.warn("Firebase redirect result failed", error);
        });
    }
  } catch (error) {
    console.error("Failed to initialize Firebase Auth", error);
  } finally {
    initializing = false;
  }
}

export function getApiBase(): string {
  return window.location.origin;
}

export async function googleLogin() {
  await initializeFirebaseAuth();
  if (!firebaseAuth || !firebaseNamespace) {
    throw new Error("Firebase Auth not available");
  }
  const provider = new firebaseNamespace.auth.GoogleAuthProvider();
  provider.setCustomParameters?.({ prompt: "select_account" });
  try {
    await firebaseAuth.signInWithPopup(provider);
  } catch (error: any) {
    const code = error?.code ?? "";
    if (code === "auth/popup-blocked" || code === "auth/popup-closed-by-user") {
      await firebaseAuth.signInWithRedirect(provider);
      return;
    }
    console.error("Google sign-in failed", error);
    throw error;
  }
}

export function getAuthHeader(): string {
  const token = getStoredToken();
  if (!token) return "";
  return `Bearer ${token}`;
}

export async function logOut() {
  await initializeFirebaseAuth();
  if (!firebaseAuth) {
    return;
  }
  await firebaseAuth.signOut();
  cachedUser = null;
  cachedToken = null;
  setStoredToken(null);
}

export function isLoggedIn(): IsLoggedInResponse {
  __isLoggedIn ??= _isLoggedIn();
  return __isLoggedIn;
}

function _isLoggedIn(): IsLoggedInResponse {
  const token = getStoredToken();
  if (!token) {
    return false;
  }
  const claims = parseToken(token);
  if (!claims) {
    return false;
  }
  const now = Math.floor(Date.now() / 1000);
  if (claims.exp && now >= claims.exp) {
    void refreshIdToken(true);
    return false;
  }
  return { token, claims };
}

export async function postRefresh(): Promise<boolean> {
  const token = await refreshIdToken(true);
  return token !== null;
}

export async function getUserMe(): Promise<UserMeResponse | false> {
  await initializeFirebaseAuth();
  const user = firebaseAuth?.currentUser ?? cachedUser;
  if (!user) {
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

export async function tokenLogin(_token: string): Promise<string | null> {
  console.warn("Token login is not supported with Firebase authentication");
  return null;
}
