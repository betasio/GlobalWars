const FIREBASE_SDK_VERSION = "10.12.4";

const firebaseConfig = {
  apiKey: "AIzaSyARehGFiYvbAqfqCiDyluBdqvw0jDUW5d8",
  authDomain: "globalwars-75bcf.firebaseapp.com",
  projectId: "globalwars-75bcf",
  storageBucket: "globalwars-75bcf.firebasestorage.app",
  messagingSenderId: "833972164306",
  appId: "1:833972164306:web:a281390984af4286d67f0b",
  measurementId: "G-8SQR6MZKHS",
};

type FirebaseNamespace = any;

declare global {
  interface Window {
    firebase?: FirebaseNamespace;
  }
}

async function loadScript(src: string): Promise<void> {
  if (document.querySelector(`script[src="${src}"]`)) {
    return;
  }
  await new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    script.src = src;
    script.async = true;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load ${src}`));
    document.head.appendChild(script);
  });
}

async function initFirebaseCompat() {
  if (typeof window === "undefined") {
    throw new Error("Firebase initialization requires a browser environment");
  }

  if (window.firebase && window.firebase.apps && window.firebase.apps.length) {
    return window.firebase;
  }

  await loadScript(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-app-compat.js`,
  );
  await loadScript(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-auth-compat.js`,
  );
  await loadScript(
    `https://www.gstatic.com/firebasejs/${FIREBASE_SDK_VERSION}/firebase-firestore-compat.js`,
  );

  const firebase = window.firebase;
  if (!firebase) {
    throw new Error("Firebase SDK failed to load");
  }

  firebase.initializeApp(firebaseConfig);
  return firebase;
}

export const firebasePromise = initFirebaseCompat();
