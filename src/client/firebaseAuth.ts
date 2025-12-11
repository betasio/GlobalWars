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

type FirebaseFirestoreModule = {
  getFirestore: (app?: any) => any;
  doc: (db: any, collection: string, id: string) => any;
  getDoc: (ref: any) => Promise<any>;
  setDoc: (ref: any, data: any, options?: any) => Promise<void>;
  deleteDoc?: (ref: any) => Promise<void>;
  runTransaction: (
    db: any,
    updater: (transaction: any) => Promise<any>,
  ) => Promise<void>;
  serverTimestamp: () => any;
};

type FirebaseModules = {
  app: FirebaseAppModule;
  auth: FirebaseAuthModule;
  firestore?: FirebaseFirestoreModule;
};

let firebaseModulesPromise: Promise<FirebaseModules | null> | null = null;
let cachedUser: any = null;
let cachedIdToken: string | null = null;
let authInstance: any = null;
let firestoreInstance: any = null;

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

    const [appModule, authModule, firestoreModule] = await Promise.all([
      import(
        /* webpackIgnore: true */ "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js"
      ),
      import(
        /* webpackIgnore: true */ "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js"
      ),
      import(
        /* webpackIgnore: true */ "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js"
      ),
    ]);

    return {
      app: appModule as unknown as FirebaseAppModule,
      auth: authModule as unknown as FirebaseAuthModule,
      firestore: firestoreModule as unknown as FirebaseFirestoreModule,
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

async function ensureFirestore(): Promise<{
  db: any;
  firestore: FirebaseFirestoreModule | null;
  configured: boolean;
}> {
  const modules = await loadFirebaseModules();
  const firestore = modules?.firestore ?? null;
  if (!modules || !firestore) return { db: null, firestore, configured: false };

  if (!firestoreInstance) {
    const app = modules.app.getApps().length
      ? modules.app.getApps()[0]
      : modules.app.initializeApp(
          (cachedEnvConfig ?? (await getClientEnv())).firebase!,
        );
    firestoreInstance = firestore.getFirestore(app);
  }

  return { db: firestoreInstance, firestore, configured: true };
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

const USER_COLLECTION = "users";
const USERNAME_CLAIMS_COLLECTION = "usernameClaims";
const CLAN_COLLECTION = "clans";
const CLAN_CLAIMS_COLLECTION = "clanClaims";

export type ClanMemberRole = "leader" | "member";

export interface ClanMember {
  uid: string;
  username: string;
  role: ClanMemberRole;
  joinedAt?: any;
}

export interface ClanProfile {
  id: string;
  name: string;
  leaderUid: string;
  members: Record<string, ClanMember>;
  membersCount: number;
}

export async function fetchStoredUsername(uid: string): Promise<string | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return null;

  const userRef = firestore.doc(db, USER_COLLECTION, uid);
  const snap = await firestore.getDoc(userRef);
  if (snap?.exists && snap.exists()) {
    return snap.data()?.username ?? null;
  }
  return null;
}

export async function claimUsername(
  uid: string,
  username: string,
): Promise<void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalized = encodeURIComponent(username.trim().toLowerCase());
  await firestore.runTransaction(db, async (tx: any) => {
    const claimRef = firestore.doc(db, USERNAME_CLAIMS_COLLECTION, normalized);
    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    const userSnap = await tx.get(userRef);
    const previousUsername = userSnap?.exists
      ? userSnap.data()?.username
      : null;
    const previousClaimId = previousUsername
      ? encodeURIComponent(previousUsername.trim().toLowerCase())
      : null;

    const claimSnap = await tx.get(claimRef);
    if (claimSnap?.exists && claimSnap.exists()) {
      const currentUid = claimSnap.data()?.uid;
      if (currentUid && currentUid !== uid) {
        const err: any = new Error("username_taken");
        err.code = "username_taken";
        throw err;
      }
    }

    tx.set(claimRef, {
      uid,
      username,
      updatedAt: firestore.serverTimestamp(),
    });

    tx.set(
      userRef,
      {
        username,
        updatedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );

    if (previousClaimId && previousClaimId !== normalized) {
      const previousClaimRef = firestore.doc(
        db,
        USERNAME_CLAIMS_COLLECTION,
        previousClaimId,
      );
      tx.delete(previousClaimRef);
    }
  });
}

function normalizeClanName(name: string): string {
  return encodeURIComponent(name.trim().toLowerCase());
}

async function fetchClanById(
  clanId: string,
): Promise<ClanProfile | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return null;

  const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
  const snap = await firestore.getDoc(clanRef);
  if (!snap?.exists || !snap.exists()) return null;
  const data = snap.data() ?? {};
  return {
    id: clanId,
    name: data.name ?? clanId,
    leaderUid: data.leaderUid ?? "",
    members: data.members ?? {},
    membersCount: data.membersCount ?? Object.keys(data.members ?? {}).length,
  };
}

export async function fetchClanForUser(
  uid: string,
): Promise<ClanProfile | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return null;

  const userRef = firestore.doc(db, USER_COLLECTION, uid);
  const snap = await firestore.getDoc(userRef);
  if (!snap?.exists || !snap.exists()) {
    return null;
  }
  const clanId = snap.data()?.clanId;
  if (!clanId) return null;
  return fetchClanById(clanId);
}

async function ensureUserNotInClan(
  tx: any,
  firestore: FirebaseFirestoreModule,
  db: any,
  uid: string,
): Promise<void> {
  const userRef = firestore.doc(db, USER_COLLECTION, uid);
  const userSnap = await tx.get(userRef);
  if (userSnap?.exists && userSnap.exists()) {
    if (userSnap.data()?.clanId) {
      const err: any = new Error("already_in_clan");
      err.code = "already_in_clan";
      throw err;
    }
  }
}

export async function createClan(
  uid: string,
  username: string,
  clanName: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalized = normalizeClanName(clanName);
  const now = firestore.serverTimestamp();

  await firestore.runTransaction(db, async (tx: any) => {
    await ensureUserNotInClan(tx, firestore, db, uid);

    const claimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, normalized);
    const claimSnap = await tx.get(claimRef);
    if (claimSnap?.exists && claimSnap.exists()) {
      const err: any = new Error("clan_name_taken");
      err.code = "clan_name_taken";
      throw err;
    }

    const clanRef = firestore.doc(db, CLAN_COLLECTION, normalized);
    tx.set(clanRef, {
      name: clanName,
      normalizedName: normalized,
      leaderUid: uid,
      members: {
        [uid]: {
          uid,
          username,
          role: "leader",
          joinedAt: now,
        },
      },
      membersCount: 1,
      createdAt: now,
      updatedAt: now,
    });

    tx.set(
      claimRef,
      {
        uid,
        name: clanName,
        clanId: normalized,
        createdAt: now,
      },
      { merge: true },
    );

    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    tx.set(
      userRef,
      {
        clanId: normalized,
        clanRole: "leader",
        clanName,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  const created = await fetchClanById(normalized);
  if (!created) {
    throw new Error("clan_create_failed");
  }
  return created;
}

export async function joinClan(
  uid: string,
  username: string,
  clanName: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalized = normalizeClanName(clanName);
  const now = firestore.serverTimestamp();

  await firestore.runTransaction(db, async (tx: any) => {
    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    const userSnap = await tx.get(userRef);
    if (userSnap?.exists && userSnap.exists()) {
      const existingClan = userSnap.data()?.clanId;
      if (existingClan && existingClan !== normalized) {
        const err: any = new Error("already_in_clan");
        err.code = "already_in_clan";
        throw err;
      }
    }

    const claimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, normalized);
    const claimSnap = await tx.get(claimRef);
    const targetClanId =
      claimSnap?.exists && claimSnap.exists() && claimSnap.data()?.clanId
        ? claimSnap.data().clanId
        : normalized;

    const clanRef = firestore.doc(db, CLAN_COLLECTION, targetClanId);
    const clanSnap = await tx.get(clanRef);
    if (!clanSnap?.exists || !clanSnap.exists()) {
      const err: any = new Error("clan_not_found");
      err.code = "clan_not_found";
      throw err;
    }

    const clanData = clanSnap.data() ?? {};
    const members = clanData.members ?? {};
    members[uid] = {
      uid,
      username,
      role: uid === clanData.leaderUid ? "leader" : "member",
      joinedAt: now,
    };

    tx.set(
      clanRef,
      {
        ...clanData,
        members,
        membersCount: Object.keys(members).length,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(
      userRef,
      {
        clanId: normalized,
        clanRole: uid === clanData.leaderUid ? "leader" : "member",
        clanName: clanData.name ?? clanName,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  const joined = await fetchClanById(normalized);
  if (!joined) {
    throw new Error("clan_join_failed");
  }
  return joined;
}

export async function leaveClan(uid: string): Promise<void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  await firestore.runTransaction(db, async (tx: any) => {
    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap?.exists || !userSnap.exists()) {
      return;
    }
    const clanId = userSnap.data()?.clanId;
    if (!clanId) return;

    const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
    const clanSnap = await tx.get(clanRef);
    if (!clanSnap?.exists || !clanSnap.exists()) {
      tx.set(userRef, { clanId: null, clanRole: null }, { merge: true });
      return;
    }
    const clanData = clanSnap.data() ?? {};
    if (clanData.leaderUid === uid) {
      const err: any = new Error("leader_cannot_leave");
      err.code = "leader_cannot_leave";
      throw err;
    }

    const members = clanData.members ?? {};
    delete members[uid];
    tx.set(
      clanRef,
      {
        ...clanData,
        members,
        membersCount: Math.max(0, Object.keys(members).length),
        updatedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );

    tx.set(userRef, { clanId: null, clanRole: null, clanName: null }, { merge: true });
  });
}

export async function renameClan(
  uid: string,
  clanId: string,
  newName: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalizedNew = normalizeClanName(newName);
  const now = firestore.serverTimestamp();

  await firestore.runTransaction(db, async (tx: any) => {
    const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
    const clanSnap = await tx.get(clanRef);
    if (!clanSnap?.exists || !clanSnap.exists()) {
      const err: any = new Error("clan_not_found");
      err.code = "clan_not_found";
      throw err;
    }
    const clanData = clanSnap.data() ?? {};
    if (clanData.leaderUid !== uid) {
      const err: any = new Error("not_leader");
      err.code = "not_leader";
      throw err;
    }

    const newClaimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, normalizedNew);
    const newClaimSnap = await tx.get(newClaimRef);
    if (newClaimSnap?.exists && newClaimSnap.exists()) {
      const err: any = new Error("clan_name_taken");
      err.code = "clan_name_taken";
      throw err;
    }

    const oldClaimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, clanId);

    const updatedMembers = clanData.members ?? {};
    Object.keys(updatedMembers).forEach((memberUid) => {
      updatedMembers[memberUid] = {
        ...updatedMembers[memberUid],
      };
    });

    tx.set(
      newClaimRef,
      {
        uid,
        name: newName,
        clanId,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.set(
      clanRef,
      {
        ...clanData,
        name: newName,
        normalizedName: normalizedNew,
        updatedAt: now,
      },
      { merge: true },
    );

    tx.delete(oldClaimRef);

    const members: Record<string, ClanMember> = clanData.members ?? {};
    Object.keys(members).forEach((memberUid) => {
      const userRef = firestore.doc(db, USER_COLLECTION, memberUid);
      tx.set(
        userRef,
        { clanId: clanId, clanRole: members[memberUid]?.role, clanName: newName },
        { merge: true },
      );
    });
  });

  const renamed = await fetchClanById(clanId);
  if (!renamed) {
    throw new Error("clan_rename_failed");
  }
  return renamed;
}

export async function disbandClan(uid: string, clanId: string): Promise<void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  await firestore.runTransaction(db, async (tx: any) => {
    const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
    const clanSnap = await tx.get(clanRef);
    if (!clanSnap?.exists || !clanSnap.exists()) {
      return;
    }
    const clanData = clanSnap.data() ?? {};
    if (clanData.leaderUid !== uid) {
      const err: any = new Error("not_leader");
      err.code = "not_leader";
      throw err;
    }

    const members: Record<string, ClanMember> = clanData.members ?? {};
    Object.keys(members).forEach((memberUid) => {
      const userRef = firestore.doc(db, USER_COLLECTION, memberUid);
      tx.set(
        userRef,
        { clanId: null, clanRole: null, clanName: null },
        { merge: true },
      );
    });

    const claimRef = firestore.doc(
      db,
      CLAN_CLAIMS_COLLECTION,
      clanData.normalizedName ?? clanId,
    );
    const legacyClaimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, clanId);
    tx.delete(clanRef);
    tx.delete(claimRef);
    tx.delete(legacyClaimRef);
  });
}

export async function kickMember(
  uid: string,
  clanId: string,
  memberUid: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  await firestore.runTransaction(db, async (tx: any) => {
    const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
    const clanSnap = await tx.get(clanRef);
    if (!clanSnap?.exists || !clanSnap.exists()) {
      const err: any = new Error("clan_not_found");
      err.code = "clan_not_found";
      throw err;
    }
    const clanData = clanSnap.data() ?? {};
    if (clanData.leaderUid !== uid) {
      const err: any = new Error("not_leader");
      err.code = "not_leader";
      throw err;
    }
    if (memberUid === uid) {
      const err: any = new Error("cannot_kick_self");
      err.code = "cannot_kick_self";
      throw err;
    }

    const members = clanData.members ?? {};
    delete members[memberUid];

    tx.set(
      clanRef,
      {
        ...clanData,
        members,
        membersCount: Math.max(0, Object.keys(members).length),
        updatedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );

    const userRef = firestore.doc(db, USER_COLLECTION, memberUid);
    tx.set(userRef, { clanId: null, clanRole: null, clanName: null }, { merge: true });
  });

  const clan = await fetchClanById(clanId);
  if (!clan) {
    throw new Error("clan_not_found");
  }
  return clan;
}
