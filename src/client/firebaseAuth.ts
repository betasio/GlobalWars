import {
  cachedEnvConfig,
  getClientEnv,
  type FirebaseClientConfig,
} from "../core/configuration/ConfigLoader";
import { GameMode } from "../core/game/Game";
import {
  RankedDeltaBreakdown,
  RankedPlayerContext,
  computeRankedDeltaForPlayer,
} from "../core/ranked/Scoring";
import {
  RankChange,
  RankTier,
  computeRankChange,
  getRankForRating,
} from "../core/Ranks";
import { PartialGameRecord } from "../core/Schemas";
import { getPersistentID } from "./Main";

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
  deleteUser?: (user: any) => Promise<void>;
};

type FirebaseFirestoreModule = {
  getFirestore: (app?: any) => any;
  doc: (db: any, collection: string, id: string) => any;
  getDoc: (ref: any) => Promise<any>;
  setDoc: (ref: any, data: any, options?: any) => Promise<void>;
  collection: (db: any, name: string) => any;
  query: (...args: any[]) => any;
  where?: (...args: any[]) => any;
  orderBy: (field: string, direction?: "asc" | "desc") => any;
  limit: (count: number) => any;
  getDocs: (query: any) => Promise<any>;
  deleteDoc?: (ref: any) => Promise<void>;
  runTransaction: (
    db: any,
    updater: (transaction: any) => Promise<any>,
  ) => Promise<void>;
  serverTimestamp: () => any;
  getCountFromServer?: (query: any) => Promise<any>;
  onSnapshot?: (
    ref: any,
    onNext: (snap: any) => void,
    onError?: (err: any) => void,
  ) => () => void;
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
  const { auth, configured } = await ensureAuth();
  const resolvedUser = cachedUser ?? auth?.currentUser ?? null;
  if (!cachedUser && resolvedUser) {
    cachedUser = resolvedUser;
  }
  return {
    user: resolvedUser,
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
const CLAN_TAG_CLAIMS_COLLECTION = "clanTagClaims";
const PLAYER_RANKINGS_COLLECTION = "playerRankings";
const CLAN_RANKINGS_COLLECTION = "clanRankings";
const RANKED_MATCH_RESULTS_COLLECTION = "rankedMatchResults";

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
  nickname: string;
  leaderUid: string;
  members: Record<string, ClanMember>;
  membersCount: number;
  rankPoints?: number;
  totalRankPoints?: number;
  tier?: RankTier;
  games?: number;
  wins?: number;
  losses?: number;
  rankPosition?: number;
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
  const now = firestore.serverTimestamp();
  await firestore.runTransaction(db, async (tx: any) => {
    const claimRef = firestore.doc(db, USERNAME_CLAIMS_COLLECTION, normalized);
    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    const userSnap = await tx.get(userRef);
    const userData = userSnap?.exists ? (userSnap.data() ?? {}) : {};
    const previousUsername = userData?.username ?? null;
    const clanId: string | null = userData?.clanId ?? null;
    const previousClaimId = previousUsername
      ? encodeURIComponent(previousUsername.trim().toLowerCase())
      : null;

    const claimSnap = await tx.get(claimRef);
    const clanRef = clanId ? firestore.doc(db, CLAN_COLLECTION, clanId) : null;
    const clanSnap = clanRef ? await tx.get(clanRef) : null;
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
      updatedAt: now,
    });

    tx.set(
      userRef,
      {
        username,
        updatedAt: now,
      },
      { merge: true },
    );

    const playerRankingRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, uid);
    tx.set(playerRankingRef, { username, lastUpdatedAt: now }, { merge: true });

    if (previousClaimId && previousClaimId !== normalized) {
      const previousClaimRef = firestore.doc(
        db,
        USERNAME_CLAIMS_COLLECTION,
        previousClaimId,
      );
      tx.delete(previousClaimRef);
    }

    if (clanRef && clanSnap?.exists && clanSnap.exists()) {
      const clanData = clanSnap.data() ?? {};
      const memberEntry = (clanData.members ?? {})[uid];
      tx.set(
        clanRef,
        {
          [`members.${uid}`]: {
            ...memberEntry,
            uid,
            username,
            role: memberEntry?.role ?? "member",
            joinedAt: memberEntry?.joinedAt ?? now,
          },
          updatedAt: now,
        },
        { merge: true },
      );
    }
  });
}

function normalizeClanName(name: string): string {
  return encodeURIComponent(name.trim().toLowerCase());
}

function normalizeClanNickname(nickname: string): string {
  // Keep clan tag claims case-sensitive so tags like "Eee" and "EeE" can coexist.
  return encodeURIComponent(nickname.trim());
}

function didPlayerWin(winner: any, clientID: string): boolean {
  if (!winner) return false;
  const [kind, ...rest] = winner as [string, ...string[]];
  if (kind === "player") {
    return rest.includes(clientID);
  }
  if (kind === "team") {
    // Winner tuple structure: ["team", teamName, ...clientIDs]
    return rest.some((entry) => entry === clientID);
  }
  return false;
}

function safeNumber(val: unknown, fallback = 0): number {
  if (typeof val === "number") return val;
  if (typeof val === "bigint") return Number(val);
  return fallback;
}

async function fetchClanById(clanId: string): Promise<ClanProfile | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return null;

  const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
  const snap = await firestore.getDoc(clanRef);
  if (!snap?.exists || !snap.exists()) return null;
  const data = snap.data() ?? {};
  return {
    id: clanId,
    name: data.name ?? clanId,
    nickname: data.nickname ?? "",
    leaderUid: data.leaderUid ?? "",
    members: data.members ?? {},
    membersCount: data.membersCount ?? Object.keys(data.members ?? {}).length,
  };
}

async function fetchClanRanking(
  clanId: string,
): Promise<RankedClanEntry | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return null;

  const rankingRef = firestore.doc(db, CLAN_RANKINGS_COLLECTION, clanId);
  const snap = await firestore.getDoc(rankingRef);
  if (!snap?.exists || !snap.exists()) return null;

  return parseRankedClanEntry(snap);
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

let cachedClanProfile: ClanProfile | null = null;
let cachedClanUserId: string | null = null;

export async function getCachedClanForUser(
  uid: string,
): Promise<ClanProfile | null> {
  if (!uid) return null;
  if (cachedClanProfile && cachedClanUserId === uid) {
    return cachedClanProfile;
  }
  const clan = await fetchClanForUser(uid);
  cachedClanProfile = clan;
  cachedClanUserId = uid;
  return clan;
}

export async function subscribeToClan(
  clanId: string,
  onChange: (clan: ClanProfile | null) => void,
  onError?: (err: any) => void,
): Promise<() => void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return () => {};

  const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
  const rankingRef = firestore.doc(db, CLAN_RANKINGS_COLLECTION, clanId);

  let latestClan: ClanProfile | null = null;
  let latestRanking: RankedClanEntry | null = null;

  const emit = () => {
    if (!latestClan) {
      onChange(null);
      return;
    }

    const merged: ClanProfile = {
      ...latestClan,
      rankPoints: latestRanking?.rankPoints ?? latestClan.rankPoints,
      totalRankPoints:
        latestRanking?.totalRankPoints ?? latestClan.totalRankPoints,
      tier: latestRanking?.tier ?? latestClan.tier,
      games: latestRanking?.games ?? latestClan.games,
      wins: latestRanking?.wins ?? latestClan.wins,
      losses: latestRanking?.losses ?? latestClan.losses,
      rankPosition:
        latestRanking?.position ?? latestClan.rankPosition ?? undefined,
    };

    onChange(merged);
  };

  const tearDownOnError = (err: any) => {
    console.error("Failed to subscribe to clan", err);
    onError?.(err);
  };

  if (firestore.onSnapshot) {
    const unsubscribeClan = firestore.onSnapshot(
      clanRef,
      (snap: any) => {
        if (!snap?.exists || !snap.exists()) {
          latestClan = null;
          onChange(null);
          return;
        }
        const data = snap.data() ?? {};
        latestClan = {
          id: clanId,
          name: data.name ?? clanId,
          nickname: data.nickname ?? "",
          leaderUid: data.leaderUid ?? "",
          members: data.members ?? {},
          membersCount:
            data.membersCount ?? Object.keys(data.members ?? {}).length,
          rankPoints: data.rankPoints,
          totalRankPoints: data.totalRankPoints ?? data.rankPoints,
        };
        emit();
      },
      tearDownOnError,
    );

    const unsubscribeRanking = firestore.onSnapshot(
      rankingRef,
      (snap: any) => {
        if (!snap?.exists || !snap.exists()) {
          latestRanking = null;
          emit();
          return;
        }
        latestRanking = parseRankedClanEntry(snap);
        emit();
      },
      tearDownOnError,
    );

    return () => {
      try {
        unsubscribeClan?.();
        unsubscribeRanking?.();
      } catch (err) {
        console.warn("Failed to unsubscribe from clan listeners", err);
      }
    };
  }

  latestClan = await fetchClanById(clanId);
  latestRanking = await fetchClanRanking(clanId);
  emit();
  return () => {};
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
  clanNickname: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalized = normalizeClanName(clanName);
  const normalizedNickname = normalizeClanNickname(clanNickname);
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

    const tagRef = firestore.doc(
      db,
      CLAN_TAG_CLAIMS_COLLECTION,
      normalizedNickname,
    );
    const tagSnap = await tx.get(tagRef);
    if (tagSnap?.exists && tagSnap.exists()) {
      const err: any = new Error("clan_name_taken");
      err.code = "clan_name_taken";
      throw err;
    }

    const clanRef = firestore.doc(db, CLAN_COLLECTION, normalized);
    tx.set(clanRef, {
      name: clanName,
      nickname: clanNickname,
      normalizedName: normalized,
      normalizedNickname,
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

    tx.set(
      tagRef,
      { uid, clanId: normalized, nickname: clanNickname, createdAt: now },
      { merge: true },
    );

    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    tx.set(
      userRef,
      {
        clanId: normalized,
        clanRole: "leader",
        clanName,
        clanNickname,
        updatedAt: now,
      },
      { merge: true },
    );
  });

  const created = await fetchClanById(normalized);
  if (!created) {
    throw new Error("clan_create_failed");
  }
  cachedClanProfile = created;
  cachedClanUserId = uid;
  await updateClanRankingTotals(created.id, created);
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
        clanNickname: clanData.nickname ?? "",
        updatedAt: now,
      },
      { merge: true },
    );

    const playerRankingRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, uid);
    tx.set(
      playerRankingRef,
      {
        clanId: normalized,
        clanName: clanData.name ?? clanName ?? null,
        clanNickname: clanData.nickname ?? null,
        lastUpdatedAt: now,
      },
      { merge: true },
    );
  });

  const joined = await fetchClanById(normalized);
  if (!joined) {
    throw new Error("clan_join_failed");
  }
  cachedClanProfile = joined;
  cachedClanUserId = uid;
  await updateClanRankingTotals(joined.id, joined);
  return joined;
}

export async function leaveClan(uid: string): Promise<void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  let clanId: string | null = null;

  await firestore.runTransaction(db, async (tx: any) => {
    const userRef = firestore.doc(db, USER_COLLECTION, uid);
    const userSnap = await tx.get(userRef);
    if (!userSnap?.exists || !userSnap.exists()) {
      return;
    }
    clanId = userSnap.data()?.clanId ?? null;
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
    tx.set(clanRef, {
      ...clanData,
      members,
      membersCount: Math.max(0, Object.keys(members).length),
      updatedAt: firestore.serverTimestamp(),
    });

    tx.set(
      userRef,
      { clanId: null, clanRole: null, clanName: null, clanNickname: null },
      { merge: true },
    );

    const playerRankingRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, uid);
    tx.set(
      playerRankingRef,
      {
        clanId: null,
        clanName: null,
        clanNickname: null,
        lastUpdatedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );
  });
  if (cachedClanUserId === uid) {
    cachedClanProfile = null;
    cachedClanUserId = null;
  }

  if (clanId) {
    await updateClanRankingTotals(clanId);
  }
}

export async function deleteAccountAndData(
  confirmEmail: string,
): Promise<void> {
  const modules = await loadFirebaseModules();
  const { auth, configured } = await ensureAuth();
  if (!modules || !configured || !auth) {
    throw new Error("firebase_not_configured");
  }

  const user = auth.currentUser ?? cachedUser;
  if (!user) {
    throw new Error("not_authenticated");
  }

  const emailMatch = (user.email ?? "").toLowerCase();
  if (emailMatch !== confirmEmail.trim().toLowerCase()) {
    const err: any = new Error("email_mismatch");
    err.code = "email_mismatch";
    throw err;
  }

  const { db, firestore } = await ensureFirestore();
  if (!db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const uid = user.uid;
  const userRef = firestore.doc(db, USER_COLLECTION, uid);
  const playerRankingRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, uid);

  let clanId: string | null = null;
  let previousClaimRef: any | null = null;

  await firestore.runTransaction(db, async (tx: any) => {
    const userSnap = await tx.get(userRef);
    if (!userSnap?.exists || !userSnap.exists()) {
      throw new Error("user_missing");
    }

    const userData = userSnap.data() ?? {};
    clanId = userData?.clanId ?? null;
    const username = userData?.username ?? null;
    previousClaimRef = username
      ? firestore.doc(
          db,
          USERNAME_CLAIMS_COLLECTION,
          encodeURIComponent(username.trim().toLowerCase()),
        )
      : null;

    const clanRef = clanId ? firestore.doc(db, CLAN_COLLECTION, clanId) : null;
    const clanSnap = clanRef ? await tx.get(clanRef) : null;

    if (clanRef && clanSnap?.exists && clanSnap.exists()) {
      const clanData = clanSnap.data() ?? {};
      const members = { ...(clanData.members ?? {}) };
      delete members[uid];
      const membersCount = Math.max(0, Object.keys(members).length);
      tx.set(
        clanRef,
        {
          ...clanData,
          members,
          membersCount,
          leaderUid: clanData.leaderUid === uid ? null : clanData.leaderUid,
          updatedAt: firestore.serverTimestamp(),
        },
        { merge: true },
      );
    }

    if (previousClaimRef) {
      tx.delete(previousClaimRef);
    }

    tx.delete(playerRankingRef);
    tx.delete(userRef);
  });

  if (clanId) {
    await updateClanRankingTotals(clanId);
  }

  try {
    if (typeof modules.auth.deleteUser === "function") {
      await modules.auth.deleteUser(user);
    } else if (typeof (user as any)?.delete === "function") {
      await (user as any).delete();
    } else {
      const err: any = new Error("delete_user_not_supported");
      err.code = "delete_user_not_supported";
      throw err;
    }
  } catch (err) {
    console.error("Failed to delete firebase auth user", err);
    throw err;
  } finally {
    cachedUser = null;
    cachedIdToken = null;
  }
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

    const newClaimRef = firestore.doc(
      db,
      CLAN_CLAIMS_COLLECTION,
      normalizedNew,
    );
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
        {
          clanId: clanId,
          clanRole: members[memberUid]?.role,
          clanName: newName,
          clanNickname: clanData.nickname ?? "",
        },
        { merge: true },
      );
    });
  });

  const renamed = await fetchClanById(clanId);
  if (!renamed) {
    throw new Error("clan_rename_failed");
  }
  if (cachedClanUserId === uid) {
    cachedClanProfile = renamed;
  }
  return renamed;
}

export async function renameClanNickname(
  uid: string,
  clanId: string,
  newNickname: string,
): Promise<ClanProfile> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const normalizedNickname = normalizeClanNickname(newNickname);
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

    const oldNormalizedNickname =
      clanData.normalizedNickname ??
      normalizeClanNickname(clanData.nickname ?? "");
    const newClaimRef = firestore.doc(
      db,
      CLAN_TAG_CLAIMS_COLLECTION,
      normalizedNickname,
    );
    const newClaimSnap = await tx.get(newClaimRef);
    if (
      normalizedNickname !== oldNormalizedNickname &&
      newClaimSnap?.exists &&
      newClaimSnap.exists() &&
      newClaimSnap.data()?.clanId !== clanId
    ) {
      const err: any = new Error("clan_tag_taken");
      err.code = "clan_tag_taken";
      throw err;
    }

    const oldClaimRef = firestore.doc(
      db,
      CLAN_TAG_CLAIMS_COLLECTION,
      oldNormalizedNickname,
    );

    const members: Record<string, ClanMember> = clanData.members ?? {};
    Object.keys(members).forEach((memberUid) => {
      const userRef = firestore.doc(db, USER_COLLECTION, memberUid);
      tx.set(
        userRef,
        {
          clanNickname: newNickname,
        },
        { merge: true },
      );
    });

    tx.set(
      newClaimRef,
      { uid, clanId, nickname: newNickname, updatedAt: now },
      { merge: true },
    );

    tx.set(
      clanRef,
      {
        ...clanData,
        nickname: newNickname,
        normalizedNickname,
        updatedAt: now,
      },
      { merge: true },
    );

    if (normalizedNickname !== oldNormalizedNickname) {
      tx.delete(oldClaimRef);
    }
  });

  const renamed = await fetchClanById(clanId);
  if (!renamed) {
    throw new Error("clan_rename_failed");
  }
  if (cachedClanUserId === uid) {
    cachedClanProfile = renamed;
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
        { clanId: null, clanRole: null, clanName: null, clanNickname: null },
        { merge: true },
      );
    });

    const claimRef = firestore.doc(
      db,
      CLAN_CLAIMS_COLLECTION,
      clanData.normalizedName ?? clanId,
    );
    const legacyClaimRef = firestore.doc(db, CLAN_CLAIMS_COLLECTION, clanId);
    const tagClaimRef = firestore.doc(
      db,
      CLAN_TAG_CLAIMS_COLLECTION,
      clanData.normalizedNickname ??
        normalizeClanNickname(clanData.nickname ?? ""),
    );
    tx.delete(clanRef);
    tx.delete(claimRef);
    tx.delete(legacyClaimRef);
    tx.delete(tagClaimRef);
  });
  if (cachedClanUserId === uid) {
    cachedClanProfile = null;
    cachedClanUserId = null;
  }
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

    tx.set(clanRef, {
      ...clanData,
      members,
      membersCount: Math.max(0, Object.keys(members).length),
      updatedAt: firestore.serverTimestamp(),
    });

    const userRef = firestore.doc(db, USER_COLLECTION, memberUid);
    tx.set(
      userRef,
      { clanId: null, clanRole: null, clanName: null, clanNickname: null },
      { merge: true },
    );

    const playerRankingRef = firestore.doc(
      db,
      PLAYER_RANKINGS_COLLECTION,
      memberUid,
    );
    tx.set(
      playerRankingRef,
      {
        clanId: null,
        clanName: null,
        clanNickname: null,
        lastUpdatedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );
  });

  const clan = await fetchClanById(clanId);
  if (!clan) {
    throw new Error("clan_not_found");
  }
  if (cachedClanUserId === memberUid) {
    cachedClanProfile = null;
    cachedClanUserId = null;
  }
  await updateClanRankingTotals(clan.id, clan);
  return clan;
}

export interface RankedSnapshot {
  rankPoints: number;
  totalRankPoints?: number;
  rating: number;
  wins: number;
  losses: number;
  games: number;
  tier: RankTier;
}

export interface RankedPlayerEntry extends RankedSnapshot {
  uid: string;
  username: string;
  clanName?: string | null;
  clanNickname?: string | null;
  position?: number;
}

export interface RankedClanEntry extends RankedSnapshot {
  id: string;
  name?: string | null;
  nickname?: string | null;
  memberCount?: number;
  position?: number;
}

export interface RankedLeaderboards {
  players: RankedPlayerEntry[];
  clans: RankedClanEntry[];
  fetchedAt: Date;
}

export interface PlayerRankSummary {
  rankPoints: number;
  tier: RankTier;
  position?: number;
}

const extractRankPoints = (data: any): number => {
  const rankPoints = safeNumber(
    data?.totalRankPoints ?? data?.rankPoints ?? data?.rating,
    0,
  );
  return Math.max(0, rankPoints);
};

const buildRankedSnapshot = (data: any): RankedSnapshot => {
  const rankPoints = extractRankPoints(data);
  return {
    rankPoints,
    totalRankPoints: rankPoints,
    rating: rankPoints,
    wins: safeNumber(data?.wins, 0),
    losses: safeNumber(data?.losses, 0),
    games: safeNumber(data?.games, 0),
    tier: getRankForRating(rankPoints),
  };
};

const parseRankedPlayerEntry = (doc: any): RankedPlayerEntry => {
  const data = doc?.data?.() ?? doc?.data?.call?.(doc) ?? {};
  return {
    uid: doc?.id ?? "",
    username: data.username ?? "Unknown",
    clanName: data.clanName ?? null,
    clanNickname: data.clanNickname ?? null,
    ...buildRankedSnapshot(data),
  };
};

const parseRankedClanEntry = (doc: any): RankedClanEntry => {
  const data = doc?.data?.() ?? doc?.data?.call?.(doc) ?? {};
  return {
    id: doc?.id ?? "",
    name: data.name ?? doc?.id ?? "",
    nickname: data.nickname ?? null,
    memberCount: safeNumber(data?.memberCount, 0),
    ...buildRankedSnapshot(data),
  };
};

const addPositions = <T extends RankedSnapshot & { position?: number }>(
  entries: T[],
): T[] => entries.map((entry, idx) => ({ ...entry, position: idx + 1 }));

export async function fetchPlayerRankSummary(
  uid: string,
): Promise<PlayerRankSummary | null> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore || !uid) return null;

  const rankingRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, uid);
  const rankingSnap = await firestore.getDoc(rankingRef);
  if (!rankingSnap?.exists || !rankingSnap.exists()) {
    return null;
  }

  const snapshot = buildRankedSnapshot(rankingSnap.data());
  let position: number | undefined;

  const getCountFromServer = firestore.getCountFromServer;
  const where = firestore.where;

  if (getCountFromServer && where) {
    try {
      const higherQuery = firestore.query(
        firestore.collection(db, PLAYER_RANKINGS_COLLECTION),
        where("totalRankPoints", ">", snapshot.rankPoints),
      );
      const aggregate = await getCountFromServer(higherQuery);
      const count = aggregate?.data?.()?.count ?? aggregate?.data().count;
      if (typeof count === "number") {
        position = count + 1;
      }
    } catch (err) {
      console.warn("Failed to calculate player rank position", err);
    }
  }

  return {
    rankPoints: snapshot.rankPoints,
    tier: snapshot.tier,
    position,
  };
}

async function updateClanRankingTotals(
  clanId: string,
  clanData?: any,
): Promise<void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) return;

  const clanRef = firestore.doc(db, CLAN_COLLECTION, clanId);
  const clanSnap =
    clanData !== undefined
      ? { exists: () => true, data: () => clanData }
      : await firestore.getDoc(clanRef);

  if (!clanSnap?.exists || !clanSnap.exists()) return;

  const data = clanSnap.data() ?? {};
  const memberIds = Object.keys(
    (data.members as Record<string, ClanMember>) ?? {},
  );

  const playerDocs = await Promise.all(
    memberIds.map((memberUid) =>
      firestore.getDoc(
        firestore.doc(db, PLAYER_RANKINGS_COLLECTION, memberUid),
      ),
    ),
  );

  const totals: RankedSnapshot = {
    rankPoints: 0,
    rating: 0,
    wins: 0,
    losses: 0,
    games: 0,
    tier: getRankForRating(0),
  };

  for (const doc of playerDocs) {
    if (doc?.exists && doc.exists()) {
      const snapshot = buildRankedSnapshot(doc.data());
      totals.rankPoints += snapshot.rankPoints;
      totals.rating += snapshot.rating;
      totals.wins += snapshot.wins;
      totals.losses += snapshot.losses;
      totals.games += snapshot.games;
    }
  }

  const totalRankPoints = Math.max(0, totals.rankPoints);

  const clanRankingRef = firestore.doc(db, CLAN_RANKINGS_COLLECTION, clanId);
  await firestore.setDoc(
    clanRankingRef,
    {
      ...totals,
      rankPoints: totalRankPoints,
      rating: totalRankPoints,
      totalRankPoints,
      memberCount: memberIds.length,
      name: data.name ?? clanId,
      nickname: data.nickname ?? data.normalizedNickname ?? null,
      lastUpdatedAt: firestore.serverTimestamp(),
    },
    { merge: true },
  );
}

function buildRankedPlayerContexts(
  gameRecord: PartialGameRecord,
): RankedPlayerContext[] {
  return gameRecord.info.players.map((player) => ({
    clientID: player.clientID,
    username: player.username,
    persistentID: player.persistentID,
    stats: player.stats,
  }));
}

function computeRatingDelta(
  gameRecord: PartialGameRecord,
  playerId: string,
): { ratingDelta: number; breakdown: RankedDeltaBreakdown } {
  const contexts = buildRankedPlayerContexts(gameRecord);
  const breakdown = computeRankedDeltaForPlayer(
    gameRecord.info.config.gameMode ?? GameMode.FFA,
    playerId,
    contexts,
    gameRecord.info.winner,
  );

  return { ratingDelta: breakdown.ratingDelta, breakdown };
}

export interface RankedResultSummary {
  player: RankChange;
  clan?: RankChange;
  breakdown?: RankedDeltaBreakdown;
}

export async function recordRankedResult(
  gameRecord: PartialGameRecord,
): Promise<RankedResultSummary | null> {
  if (!gameRecord.info?.config?.ranked) return null;

  const { user, configured } = await ensureFirebaseReady();
  if (!configured || !user) return null; // Guests are ignored

  const { db, firestore } = await ensureFirestore();
  if (!db || !firestore) return null;

  const playerEntry = gameRecord.info.players.find(
    (p) => p.persistentID === getPersistentID(),
  );
  if (!playerEntry) return null;

  const isWinner = didPlayerWin(gameRecord.info.winner, playerEntry.clientID);
  const { ratingDelta, breakdown } = computeRatingDelta(
    gameRecord,
    playerEntry.clientID,
  );

  // Fetch clan metadata outside the transaction for readability
  const userRef = firestore.doc(db, USER_COLLECTION, user.uid);
  const userSnap = await firestore.getDoc(userRef);
  const userData = userSnap?.data() ?? {};
  const clanId: string | null = userData.clanId ?? null;
  const clanName: string | null = userData.clanName ?? null;
  const clanNickname: string | null = userData.clanNickname ?? null;

  let resultSummary: RankedResultSummary | null = null;
  const serializedBreakdown = breakdown
    ? JSON.parse(JSON.stringify(breakdown))
    : null;

  const currentGameId = gameRecord.info.gameID;
  const matchId =
    currentGameId ??
    `missing_game_id_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

  await firestore.runTransaction(db, async (tx: any) => {
    const playerRef = firestore.doc(db, PLAYER_RANKINGS_COLLECTION, user.uid);
    const playerSnap = await tx.get(playerRef);

    const clanRef = clanId
      ? firestore.doc(db, CLAN_RANKINGS_COLLECTION, clanId)
      : null;
    const clanSnap = clanRef ? await tx.get(clanRef) : null;

    const playerData: RankedSnapshot = playerSnap?.exists
      ? buildRankedSnapshot(playerSnap.data())
      : {
          rankPoints: 1000,
          rating: 1000,
          wins: 0,
          losses: 0,
          games: 0,
          tier: getRankForRating(1000),
        };

    const lastRecordedGameId = playerSnap?.data()?.lastGameId;
    // Only treat as duplicate when the current game id is present and matches
    // the previous record. Missing IDs should not prevent rank updates.
    if (currentGameId && lastRecordedGameId === currentGameId) {
      return; // Already counted this match
    }

    const playerChange = computeRankChange(playerData.rating, ratingDelta);
    const matchResultRef = firestore.doc(
      db,
      RANKED_MATCH_RESULTS_COLLECTION,
      `${user.uid}_${matchId}`,
    );

    const nextPlayerRankPoints = playerChange.newRating;
    const updatedPlayer: RankedSnapshot = {
      rankPoints: nextPlayerRankPoints,
      rating: nextPlayerRankPoints,
      wins: playerData.wins + (isWinner ? 1 : 0),
      losses: playerData.losses + (isWinner ? 0 : 1),
      games: playerData.games + 1,
      tier: getRankForRating(nextPlayerRankPoints),
    };

    tx.set(
      playerRef,
      {
        ...updatedPlayer,
        totalRankPoints: updatedPlayer.rankPoints,
        lastGameId: currentGameId ?? matchId,
        lastUpdatedAt: firestore.serverTimestamp(),
        username: playerEntry.username,
        clanId,
        clanName,
        clanNickname,
      },
      { merge: true },
    );

    tx.set(
      matchResultRef,
      {
        gameId: gameRecord.info.gameID,
        playerUid: user.uid,
        persistentId: playerEntry.persistentID ?? null,
        username: playerEntry.username,
        clanId,
        clanName,
        clanNickname,
        mode: gameRecord.info.config.gameMode ?? GameMode.FFA,
        isWinner,
        ratingDelta,
        previousRating: playerChange.previousRating,
        newRating: playerChange.newRating,
        tierBefore: playerChange.previousTier,
        tierAfter: playerChange.newTier,
        breakdown: serializedBreakdown,
        recordedAt: firestore.serverTimestamp(),
      },
      { merge: true },
    );

    let clanChange: RankChange | undefined;

    if (clanId && clanRef) {
      const clanData: RankedSnapshot = clanSnap?.exists
        ? buildRankedSnapshot(clanSnap.data())
        : {
            rankPoints: 1000,
            rating: 1000,
            wins: 0,
            losses: 0,
            games: 0,
            tier: getRankForRating(1000),
          };
      clanChange = computeRankChange(clanData.rating, ratingDelta);
      const nextClanRankPoints = clanChange.newRating;
      const updatedClan: RankedSnapshot = {
        rankPoints: nextClanRankPoints,
        rating: nextClanRankPoints,
        wins: clanData.wins + (isWinner ? 1 : 0),
        losses: clanData.losses + (isWinner ? 0 : 1),
        games: clanData.games + 1,
        tier: getRankForRating(nextClanRankPoints),
      };

      tx.set(
        clanRef,
        {
          ...updatedClan,
          totalRankPoints: updatedClan.rankPoints,
          lastGameId: gameRecord.info.gameID,
          lastUpdatedAt: firestore.serverTimestamp(),
          name: clanName,
          nickname: clanNickname,
        },
        { merge: true },
      );
    }

    resultSummary = {
      player: playerChange,
      clan: clanChange,
      breakdown,
    };
  });

  if (clanId) {
    await updateClanRankingTotals(clanId);
  }

  return resultSummary;
}

export async function fetchRankedLeaderboards(
  limitCount = 50,
): Promise<RankedLeaderboards> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    throw new Error("firebase_not_configured");
  }

  const orderField = "totalRankPoints";

  const playerQuery = firestore.query(
    firestore.collection(db, PLAYER_RANKINGS_COLLECTION),
    firestore.orderBy(orderField, "desc"),
    firestore.limit(limitCount),
  );

  const clanQuery = firestore.query(
    firestore.collection(db, CLAN_RANKINGS_COLLECTION),
    firestore.orderBy(orderField, "desc"),
    firestore.limit(limitCount),
  );

  const [playersSnap, clansSnap] = await Promise.all([
    firestore.getDocs(playerQuery),
    firestore.getDocs(clanQuery),
  ]);

  const sortByRankPoints = <T extends RankedSnapshot>(a: T, b: T) =>
    b.rankPoints - a.rankPoints;

  const players: RankedPlayerEntry[] = (playersSnap?.docs ?? [])
    .map(parseRankedPlayerEntry)
    .sort(sortByRankPoints);

  const clans: RankedClanEntry[] = (clansSnap?.docs ?? [])
    .map(parseRankedClanEntry)
    .sort(sortByRankPoints);

  const sortedPlayers = players
    .filter((p) => p.games > 0)
    .sort(sortByRankPoints);
  const sortedClans = addPositions(
    clans.filter((c) => c.games > 0).sort(sortByRankPoints),
  );

  return {
    players: addPositions(sortedPlayers),
    clans: sortedClans,
    fetchedAt: new Date(),
  };
}

export async function subscribeToRankedLeaderboards(
  onChange: (leaderboard: RankedLeaderboards) => void,
  onError?: (err: any) => void,
  limitCount = 50,
): Promise<() => void> {
  const { db, firestore, configured } = await ensureFirestore();
  if (!configured || !db || !firestore) {
    onError?.(new Error("firebase_not_configured"));
    return () => {};
  }

  // Fallback to a polling loop if realtime listeners are unavailable
  if (!firestore.onSnapshot) {
    let cancelled = false;
    const refreshIntervalMs = 15000;

    const fetchAndEmit = async () => {
      try {
        const leaderboard = await fetchRankedLeaderboards(limitCount);
        if (!cancelled) {
          onChange(leaderboard);
        }
      } catch (err) {
        if (!cancelled) {
          onError?.(err);
        }
      }
    };

    await fetchAndEmit();
    const interval = setInterval(fetchAndEmit, refreshIntervalMs);

    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }

  const orderField = "totalRankPoints";

  const playerQuery = firestore.query(
    firestore.collection(db, PLAYER_RANKINGS_COLLECTION),
    firestore.orderBy(orderField, "desc"),
    firestore.limit(limitCount),
  );

  const clanQuery = firestore.query(
    firestore.collection(db, CLAN_RANKINGS_COLLECTION),
    firestore.orderBy(orderField, "desc"),
    firestore.limit(limitCount),
  );

  let latestPlayers: RankedPlayerEntry[] | null = null;
  let latestClans: RankedClanEntry[] | null = null;
  let cancelled = false;
  const refreshIntervalMs = 15000;

  const emitLeaderboard = () => {
    if (!latestPlayers || !latestClans || cancelled) return;

    const sortByRankPoints = <T extends RankedSnapshot>(a: T, b: T) =>
      b.rankPoints - a.rankPoints;

    const playersWithPositions = addPositions(
      latestPlayers.filter((p) => p.games > 0).sort(sortByRankPoints),
    );
    const clansWithPositions = addPositions(
      latestClans.filter((c) => c.games > 0).sort(sortByRankPoints),
    );

    onChange({
      players: playersWithPositions,
      clans: clansWithPositions,
      fetchedAt: new Date(),
    });
  };

  const seedFetch = async () => {
    try {
      const leaderboard = await fetchRankedLeaderboards(limitCount);
      if (cancelled) return;
      latestPlayers = leaderboard.players;
      latestClans = leaderboard.clans;
      emitLeaderboard();
    } catch (err) {
      if (!cancelled) {
        onError?.(err);
      }
    }
  };

  const teardownOnError = (err: any) => {
    onError?.(err);
    try {
      unsubscribePlayers?.();
      unsubscribeClans?.();
    } catch (cleanupErr) {
      console.warn(
        "subscribeToRankedLeaderboards: failed to unsubscribe after error",
        cleanupErr,
      );
    }
  };

  const unsubscribePlayers = firestore.onSnapshot(
    playerQuery,
    (snapshot: any) => {
      latestPlayers = (snapshot?.docs ?? []).map(parseRankedPlayerEntry);
      emitLeaderboard();
    },
    (err: any) => {
      if (err?.code === "permission-denied") {
        console.info(
          "subscribeToRankedLeaderboards: player snapshot blocked by permissions",
        );
      } else {
        console.warn(
          "subscribeToRankedLeaderboards: players snapshot failed",
          err,
        );
      }
      teardownOnError(err);
    },
  );

  const unsubscribeClans = firestore.onSnapshot(
    clanQuery,
    (snapshot: any) => {
      latestClans = (snapshot?.docs ?? []).map(parseRankedClanEntry);
      emitLeaderboard();
    },
    (err: any) => {
      if (err?.code === "permission-denied") {
        console.info(
          "subscribeToRankedLeaderboards: clan snapshot blocked by permissions",
        );
      } else {
        console.warn(
          "subscribeToRankedLeaderboards: clans snapshot failed",
          err,
        );
      }
      teardownOnError(err);
    },
  );

  await seedFetch();
  const interval = setInterval(seedFetch, refreshIntervalMs);

  return () => {
    cancelled = true;
    clearInterval(interval);
    try {
      unsubscribePlayers?.();
      unsubscribeClans?.();
    } catch (err) {
      console.warn("subscribeToRankedLeaderboards: failed to unsubscribe", err);
    }
  };
}
