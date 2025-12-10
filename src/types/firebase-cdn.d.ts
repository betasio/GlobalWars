declare module "https://www.gstatic.com/firebasejs/11.1.0/firebase-app.js" {
  export const initializeApp: (config: any) => any;
  export const getApps: () => any[];
}

declare module "https://www.gstatic.com/firebasejs/11.1.0/firebase-auth.js" {
  export const getAuth: (app?: any) => any;
  export class GoogleAuthProvider {
    constructor();
  }
  export const onAuthStateChanged: (auth: any, cb: (user: any) => void) => void;
  export const onIdTokenChanged: (auth: any, cb: (user: any) => void) => void;
  export const signInWithPopup: (
    auth: any,
    provider: any,
  ) => Promise<{ user: any }>;
  export const signOut: (auth: any) => Promise<void>;
}

declare module "https://www.gstatic.com/firebasejs/11.1.0/firebase-firestore.js" {
  export const getFirestore: (app?: any) => any;
  export const doc: (db: any, collection: string, id: string) => any;
  export const getDoc: (ref: any) => Promise<any>;
  export const setDoc: (ref: any, data: any, options?: any) => Promise<void>;
  export const runTransaction: (
    db: any,
    updateFn: (transaction: any) => Promise<any>,
  ) => Promise<void>;
  export const serverTimestamp: () => any;
}
