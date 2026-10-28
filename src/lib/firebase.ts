import { initializeApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider } from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';
import appletConfig from '../../firebase-applet-config.json';

/**
 * Shared Firebase Initialization Module
 * Connects both the Admin Panel and Customer Panel to the same Firebase project.
 * Note: Firebase Web API keys identify the Firebase project; they do NOT grant
 * administrative authority. Access control is enforced via Firebase Auth,
 * Firestore/Storage Security Rules, and server-side token verification.
 */
interface RuntimeFirebaseWindowConfig {
  projectId?: string;
  apiKey?: string;
  authDomain?: string;
  databaseURL?: string;
  firestoreDatabaseId?: string;
  storageBucket?: string;
  messagingSenderId?: string;
  appId?: string;
  measurementId?: string;
  vapidKey?: string;
  superAdminEmails?: string[];
}

declare global {
  interface Window {
    __FIREBASE_RUNTIME_CONFIG__?: RuntimeFirebaseWindowConfig | null;
  }
}

const runtimeCfg: RuntimeFirebaseWindowConfig =
  (typeof window !== 'undefined' && window.__FIREBASE_RUNTIME_CONFIG__) || {};

function pickNonEmpty(...values: Array<string | undefined | null>): string {
  for (const val of values) {
    if (typeof val === 'string' && val.trim().length > 0) {
      return val.trim();
    }
  }
  return '';
}

const resolvedFirebaseConfig = {
  apiKey: pickNonEmpty(runtimeCfg.apiKey, import.meta.env.VITE_FIREBASE_API_KEY, appletConfig.apiKey),
  authDomain: pickNonEmpty(runtimeCfg.authDomain, import.meta.env.VITE_FIREBASE_AUTH_DOMAIN, appletConfig.authDomain),
  databaseURL:
    pickNonEmpty(runtimeCfg.databaseURL, import.meta.env.VITE_FIREBASE_DATABASE_URL, appletConfig.databaseURL) ||
    undefined,
  projectId: pickNonEmpty(runtimeCfg.projectId, import.meta.env.VITE_FIREBASE_PROJECT_ID, appletConfig.projectId),
  storageBucket: pickNonEmpty(
    runtimeCfg.storageBucket,
    import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
    appletConfig.storageBucket
  ),
  messagingSenderId: pickNonEmpty(
    runtimeCfg.messagingSenderId,
    import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    appletConfig.messagingSenderId
  ),
  appId: pickNonEmpty(runtimeCfg.appId, import.meta.env.VITE_FIREBASE_APP_ID, appletConfig.appId),
  measurementId:
    pickNonEmpty(runtimeCfg.measurementId, import.meta.env.VITE_FIREBASE_MEASUREMENT_ID, appletConfig.measurementId) ||
    undefined,
};

export const DEFAULT_FIREBASE_VAPID_KEY =
  'BKo5qev_gQH2OPwkHgRsKpGPMXVVbpeFVLEAwZNkO6nPlfWriuVOAqfICwUGDD0zM6CcEEhPA95lScKpimlwgpo';

export const FIREBASE_WEB_PUSH_VAPID_KEY: string = pickNonEmpty(
  runtimeCfg.vapidKey,
  import.meta.env.VITE_FIREBASE_VAPID_KEY,
  (appletConfig as { vapidKey?: string }).vapidKey,
  DEFAULT_FIREBASE_VAPID_KEY
);

function resolveFirestoreDatabaseId(
  rawEnvDbId: string | undefined,
  activeProjectId: string,
  appletProjectId: string,
  appletDbId: string | undefined
): string {
  const trimmed = (rawEnvDbId || '').trim();
  const normalized = trimmed.toLowerCase();
  const defaultAliases = new Set([
    '',
    'default',
    '(default)',
    'adminpanel',
    'admin-panel',
    'admin_panel',
    activeProjectId.toLowerCase(),
  ]);

  const isCustomProject = Boolean(activeProjectId && activeProjectId !== appletProjectId);
  if (isCustomProject) {
    return defaultAliases.has(normalized) ? '(default)' : trimmed;
  }

  if (trimmed) {
    return defaultAliases.has(normalized) ? '(default)' : trimmed;
  }

  return appletDbId || '(default)';
}

export const FIRESTORE_DATABASE_ID: string = resolveFirestoreDatabaseId(
  pickNonEmpty(runtimeCfg.firestoreDatabaseId, import.meta.env.VITE_FIREBASE_DATABASE_ID),
  resolvedFirebaseConfig.projectId,
  appletConfig.projectId,
  appletConfig.firestoreDatabaseId
);

export const SHARED_STORE_ID = 'finesteride-recur-bd';
export const BOOTSTRAPPED_SUPER_ADMIN_EMAIL = 'ahmadshorif00001@gmail.com';
export const BOOTSTRAPPED_SUPER_ADMIN_EMAILS: readonly string[] = [
  'ahmadshorif00001@gmail.com',
  'ventegksy@gmail.com',
];

export function isBootstrappedSuperAdminEmail(email?: string | null): boolean {
  if (!email) return false;
  const normalized = email.trim().toLowerCase();
  if (!normalized) return false;
  if (BOOTSTRAPPED_SUPER_ADMIN_EMAILS.includes(normalized)) return true;
  if (
    Array.isArray(runtimeCfg.superAdminEmails) &&
    runtimeCfg.superAdminEmails.map((e) => e.trim().toLowerCase()).includes(normalized)
  ) {
    return true;
  }

  const extraEmailsRaw = (import.meta.env.VITE_SUPER_ADMIN_EMAIL || '').trim();
  if (!extraEmailsRaw) return false;
  const extraEmails = extraEmailsRaw
    .split(',')
    .map((item: string) => item.trim().toLowerCase())
    .filter(Boolean);
  return extraEmails.includes(normalized);
}

export const app = initializeApp(resolvedFirebaseConfig);
export const db = getFirestore(app, FIRESTORE_DATABASE_ID);
export const auth = getAuth(app);
export const storage = getStorage(app);

export const googleProvider = new GoogleAuthProvider();
googleProvider.setCustomParameters({ prompt: 'select_account' });

export function getActiveFirebaseApiKey(): string {
  return resolvedFirebaseConfig.apiKey;
}

export function getFirebaseVapidKey(): string {
  return FIREBASE_WEB_PUSH_VAPID_KEY;
}

export function getFirebaseProjectInfo() {
  return {
    projectId: resolvedFirebaseConfig.projectId,
    authDomain: resolvedFirebaseConfig.authDomain,
    storageBucket: resolvedFirebaseConfig.storageBucket,
    messagingSenderId: resolvedFirebaseConfig.messagingSenderId,
    vapidKey: FIREBASE_WEB_PUSH_VAPID_KEY,
    databaseId: FIRESTORE_DATABASE_ID,
    storeId: SHARED_STORE_ID,
  };
}

let cachedDbProvisionCheck: Promise<{ provisioned: boolean; message: string | null }> | null = null;

export async function verifyFirestoreDatabaseProvisioned(
  forceRefresh = false
): Promise<{ provisioned: boolean; message: string | null }> {
  if (!forceRefresh && cachedDbProvisionCheck) {
    return cachedDbProvisionCheck;
  }

  const runCheck = async (): Promise<{ provisioned: boolean; message: string | null }> => {
    const projectId = resolvedFirebaseConfig.projectId;
    if (!projectId) {
      return {
        provisioned: false,
        message: 'Firebase Project ID is missing. Check VITE_FIREBASE_PROJECT_ID in your configuration.',
      };
    }

    try {
      const endpoint = `https://firestore.googleapis.com/v1/projects/${encodeURIComponent(
        projectId
      )}/databases/${encodeURIComponent(FIRESTORE_DATABASE_ID)}/documents/test/connection`;
      const res = await fetch(endpoint, { method: 'GET' });

      if (res.status === 404) {
        const bodyText = await res.text();
        if (bodyText.includes('does not exist for project')) {
          return {
            provisioned: false,
            message: `Cloud Firestore (separate from Realtime Database) is not created yet in project "${projectId}". In Firebase Console left menu, click "Firestore" -> "Create database" -> keep "(default)" -> then paste firestore.rules under "Rules" and click Publish.`,
          };
        }
      }
      return { provisioned: true, message: null };
    } catch {
      // Network hiccup: assume provisioned and let SDK handle normal connectivity
      return { provisioned: true, message: null };
    }
  };

  cachedDbProvisionCheck = runCheck();
  return cachedDbProvisionCheck;
}

async function testConnection(): Promise<void> {
  const status = await verifyFirestoreDatabaseProvisioned();
  if (!status.provisioned) {
    return;
  }

  try {
    await getDocFromServer(doc(db, 'test', 'connection'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

void testConnection();

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): never {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.error('Firestore Error: ', JSON.stringify(errInfo));
  throw new Error(JSON.stringify(errInfo));
}
