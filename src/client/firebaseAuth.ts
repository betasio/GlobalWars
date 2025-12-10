import {
  cachedEnvConfig,
  getClientEnv,
  type FirebaseClientConfig,
} from "../core/configuration/ConfigLoader";

// We load the Firebase SDK from the official CDN at runtime so we don't
// depend on local npm packages in environments where registry access is
// locked down.
type FirebaseAppModule = {
  initializeApp: (config: FirebaseClientConfig) => any;
  getApps: () => any[];
};

type FirebaseAuthModule = {
  getAuth: (app?: any) => any;
  GoogleAuthProvider: new () => any;
  onAuthStateChanged: (auth: any, cb: (user: any) => void) => void;
  onIdTokenChanged: (auth: any, cb: (user: any) => void) => void;
  signInWithPopup: (auth: any, provider: any) => Promise<{ user: any }>;
  signOut: (auth: any) => Promise<void>;
};

type FirebaseModules = {
  app: FirebaseAppModule;
  auth: FirebaseAuthModule;
};

let firebaseModulesPromise: Promise<FirebaseModules | null> | null = null;
let cachedUser: any = null;
let cachedIdToken: string | null = null;
let authInstance: any = null;

function hasFirebaseConfig(
  config: FirebaseClientConfig | undefined,
): FirebaseClientConfig | null {
  if (!config) return null;
  const { apiKey, authDomain, projectId, appId } = config;
  if (!apiKey || !authDomain || !projectId || !appId) return null;
  return config;
}

async function loadFirebaseModules(): Promise<FirebaseModules | null> {
  if (firebaseModulesPromise) return firebaseModulesPromise;

  firebaseModulesPromise = (async () => {
    const env = cachedEnvConfig ?? (await getClientEnv());
    const firebaseConfig = hasFirebaseConfig(env.firebase);
    if (!firebaseConfig) {
      console.warn("Firebase config missing; Google login disabled.");
      return null;
    }

    const [appModule, authModule] = await Promise.all([
      import(
        /* webpackIgnore: true */ "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js"
      ),
      import(
        /* webpackIgnore: true */ "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js"
      ),
    ]);

    return {
      app: appModule as unknown as FirebaseAppModule,
      auth: authModule as unknown as FirebaseAuthModule,
    };
  })();

  return firebaseModulesPromise;
}

async function ensureAuth(): Promise<{ auth: any; configured: boolean }> {
  const modules = await loadFirebaseModules();
  if (!modules) return { auth: null, configured: false };

  if (!authInstance) {
    const app = modules.app.getApps().length
      ? modules.app.getApps()[0]
      : modules.app.initializeApp(
          (cachedEnvConfig ?? (await getClientEnv())).firebase!,
        );
    authInstance = modules.auth.getAuth(app);

    modules.auth.onAuthStateChanged(authInstance, (user) => {
      cachedUser = user;
      document.dispatchEvent(
        new CustomEvent("firebase-auth-changed", { detail: user ?? null }),
      );
    });

    modules.auth.onIdTokenChanged(authInstance, async (user) => {
      if (!user) {
        cachedIdToken = null;
        return;
      }
      try {
        cachedIdToken = await user.getIdToken();
      } catch (err) {
        console.warn("Failed to refresh Firebase ID token", err);
      }
    });
  }

  return { auth: authInstance, configured: true };
}

export async function loginWithGoogle(): Promise<any | null> {
  const { auth, configured } = await ensureAuth();
  if (!configured || !auth) return null;

  const modules = await loadFirebaseModules();
  if (!modules) return null;

  const provider = new modules.auth.GoogleAuthProvider();
  const credential = await modules.auth.signInWithPopup(auth, provider);
  return credential.user;
}

export async function logoutFirebase(): Promise<void> {
  const { auth, configured } = await ensureAuth();
  if (!configured || !auth) return;
  const modules = await loadFirebaseModules();
  if (!modules) return;
  await modules.auth.signOut(auth);
}

export async function ensureFirebaseReady(): Promise<{
  user: any | null;
  configured: boolean;
}> {
  const { configured } = await ensureAuth();
  return {
    user: cachedUser,
    configured,
  };
}

export function getCachedFirebaseUser(): any | null {
  return cachedUser;
}

export function getCachedFirebaseIdToken(): string | null {
  return cachedIdToken;
}
