import { doc, getDoc, serverTimestamp, setDoc, updateDoc } from 'firebase/firestore';
import {
  deleteToken,
  getMessaging,
  getToken,
  isSupported,
  onMessage,
  type MessagePayload,
} from 'firebase/messaging';
import {
  app,
  db,
  getFirebaseProjectInfo,
  getFirebaseVapidKey,
  handleFirestoreError,
  OperationType,
  SHARED_STORE_ID,
} from './firebase';

const LOCAL_DEVICE_SEED_KEY = 'finesteride_admin_push_device_seed_v1';
const LOCAL_PUSH_TOKEN_KEY = 'finesteride_admin_push_token_v1';
const LOCAL_PUSH_SYNC_KEY = 'finesteride_admin_push_cloud_synced_v1';

export interface PushEnvironmentStatus {
  supported: boolean;
  permission: NotificationPermission | 'unsupported';
  vapidKey: string;
  vapidKeyMasked: string;
  messagingSenderId: string;
  savedToken: string | null;
  cloudSynced: boolean;
  reasonIfUnsupported: string | null;
}

export interface ForegroundPushAlert {
  id: string;
  title: string;
  body: string;
  receivedAtIso: string;
}

function maskVapidKey(key: string): string {
  const clean = key.trim();
  if (clean.length <= 16) return clean || 'Not configured';
  return `${clean.slice(0, 10)}...${clean.slice(-8)}`;
}

function getOrCreateBrowserSeed(): string {
  if (typeof window === 'undefined') return 'srv0001';
  try {
    const existing = window.localStorage.getItem(LOCAL_DEVICE_SEED_KEY);
    if (existing && /^[a-zA-Z0-9_-]{6,40}$/.test(existing)) {
      return existing;
    }
    const randomPart = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`.replace(
      /[^a-zA-Z0-9_-]/g,
      ''
    );
    window.localStorage.setItem(LOCAL_DEVICE_SEED_KEY, randomPart);
    return randomPart;
  } catch {
    return 'browser01';
  }
}

export function buildStaffPushDeviceId(staffUid: string): string {
  const safeUid = staffUid.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48) || 'staff';
  const seed = getOrCreateBrowserSeed().slice(0, 32);
  return `push_${safeUid}_${seed}`.slice(0, 120);
}

export function getSavedLocalPushToken(): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const val = window.localStorage.getItem(LOCAL_PUSH_TOKEN_KEY);
    return val && val.trim().length > 0 ? val.trim() : null;
  } catch {
    return null;
  }
}

function setSavedLocalPushState(token: string | null, cloudSynced: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (token) {
      window.localStorage.setItem(LOCAL_PUSH_TOKEN_KEY, token);
      window.localStorage.setItem(LOCAL_PUSH_SYNC_KEY, cloudSynced ? '1' : '0');
    } else {
      window.localStorage.removeItem(LOCAL_PUSH_TOKEN_KEY);
      window.localStorage.removeItem(LOCAL_PUSH_SYNC_KEY);
    }
  } catch {
    // Ignore storage quota / privacy mode restrictions
  }
}

export async function getPushEnvironmentStatus(): Promise<PushEnvironmentStatus> {
  const projectInfo = getFirebaseProjectInfo();
  const vapidKey = getFirebaseVapidKey();
  const vapidKeyMasked = maskVapidKey(vapidKey);
  const savedToken = getSavedLocalPushToken();
  let cloudSynced = false;
  if (typeof window !== 'undefined') {
    try {
      cloudSynced = window.localStorage.getItem(LOCAL_PUSH_SYNC_KEY) === '1';
    } catch {
      cloudSynced = false;
    }
  }

  if (typeof window === 'undefined') {
    return {
      supported: false,
      permission: 'unsupported',
      vapidKey,
      vapidKeyMasked,
      messagingSenderId: projectInfo.messagingSenderId,
      savedToken,
      cloudSynced,
      reasonIfUnsupported: 'Server-side rendering environment.',
    };
  }

  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    return {
      supported: false,
      permission: 'unsupported',
      vapidKey,
      vapidKeyMasked,
      messagingSenderId: projectInfo.messagingSenderId,
      savedToken,
      cloudSynced,
      reasonIfUnsupported:
        'This browser or embedded preview frame does not expose the Web Notification / Service Worker API. Open the deployed HTTPS site directly in a browser tab to receive background OS push alerts.',
    };
  }

  let fcmSupported = false;
  try {
    fcmSupported = await isSupported();
  } catch {
    fcmSupported = false;
  }

  if (!fcmSupported) {
    return {
      supported: false,
      permission: Notification.permission,
      vapidKey,
      vapidKeyMasked,
      messagingSenderId: projectInfo.messagingSenderId,
      savedToken,
      cloudSynced,
      reasonIfUnsupported:
        'Firebase Cloud Messaging Web Push requires a top-level HTTPS context with PushManager enabled.',
    };
  }

  return {
    supported: true,
    permission: Notification.permission,
    vapidKey,
    vapidKeyMasked,
    messagingSenderId: projectInfo.messagingSenderId,
    savedToken,
    cloudSynced,
    reasonIfUnsupported: null,
  };
}

async function waitForActiveServiceWorker(
  registration: ServiceWorkerRegistration
): Promise<ServiceWorkerRegistration> {
  if (registration.active) {
    return registration;
  }
  const installingWorker = registration.installing || registration.waiting;
  if (!installingWorker) {
    return navigator.serviceWorker.ready;
  }

  await new Promise<void>((resolve) => {
    const timeout = window.setTimeout(() => resolve(), 4000);
    const onStateChange = () => {
      if (installingWorker.state === 'activated' || installingWorker.state === 'redundant') {
        window.clearTimeout(timeout);
        installingWorker.removeEventListener('statechange', onStateChange);
        resolve();
      }
    };
    installingWorker.addEventListener('statechange', onStateChange);
  });

  return registration;
}

async function persistStaffPushDeviceToFirestore(params: {
  deviceId: string;
  staffUid: string;
  staffEmail: string;
  fcmToken: string;
  vapidKeyPrefix: string;
  activeStaffUids: string[];
}): Promise<void> {
  const path = `staffPushDevices/${params.deviceId}`;
  const deviceRef = doc(db, 'staffPushDevices', params.deviceId);
  const boundedUids = Array.from(
    new Set([...params.activeStaffUids, params.staffUid].filter(Boolean))
  ).slice(0, 20);
  const safeEmail = params.staffEmail.trim().toLowerCase().slice(0, 254);
  const safeUa =
    (typeof navigator !== 'undefined' ? navigator.userAgent : 'WebBrowser').slice(0, 300) ||
    'WebBrowser';

  let existsAlready = false;
  try {
    const snap = await getDoc(deviceRef);
    existsAlready = snap.exists();
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }

  if (existsAlready) {
    try {
      await updateDoc(deviceRef, {
        staffEmail: safeEmail,
        fcmToken: params.fcmToken,
        vapidKeyPrefix: params.vapidKeyPrefix,
        userAgent: safeUa,
        status: 'active',
        authorizedStaffUids: boundedUids,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  } else {
    try {
      await setDoc(deviceRef, {
        deviceId: params.deviceId,
        staffUid: params.staffUid,
        staffEmail: safeEmail,
        fcmToken: params.fcmToken,
        vapidKeyPrefix: params.vapidKeyPrefix,
        userAgent: safeUa,
        status: 'active',
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: boundedUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.CREATE, path);
    }
  }
}

export async function enableStaffWebPush(params: {
  staffUid: string;
  staffEmail: string;
  activeStaffUids: string[];
}): Promise<{
  fcmToken: string;
  cloudSynced: boolean;
  notice: string;
}> {
  const env = await getPushEnvironmentStatus();
  if (!env.supported) {
    throw new Error(
      env.reasonIfUnsupported ||
        'Web Push notifications are not supported in this browser context.'
    );
  }
  if (!env.vapidKey) {
    throw new Error(
      'Web Push Certificate Key Pair (VITE_FIREBASE_VAPID_KEY) is missing from configuration.'
    );
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') {
    throw new Error(
      'ব্রাউজারে Notification Permission অনুমোদন করা হয়নি। অ্যাড্রেস বারের লক আইকন থেকে Notifications -> Allow করে আবার চেষ্টা করুন।'
    );
  }

  const rawReg = await navigator.serviceWorker.register('/firebase-messaging-sw.js', {
    scope: '/',
  });
  const activeReg = await waitForActiveServiceWorker(rawReg);

  const messaging = getMessaging(app);
  const token = await getToken(messaging, {
    vapidKey: env.vapidKey,
    serviceWorkerRegistration: activeReg,
  });

  if (!token) {
    throw new Error(
      'Firebase Cloud Messaging কোনো রেজিস্ট্রেশন টোকেন রিটার্ন করেনি। Firebase Console-এ Cloud Messaging API সক্রিয় আছে কিনা যাচাই করুন।'
    );
  }

  const deviceId = buildStaffPushDeviceId(params.staffUid);
  let cloudSynced = false;
  let rulesSyncHint = '';

  try {
    await persistStaffPushDeviceToFirestore({
      deviceId,
      staffUid: params.staffUid,
      staffEmail: params.staffEmail,
      fcmToken: token,
      vapidKeyPrefix: env.vapidKey.slice(0, 12),
      activeStaffUids: params.activeStaffUids,
    });
    cloudSynced = true;
  } catch (err) {
    cloudSynced = false;
    const rawMsg = err instanceof Error ? err.message : String(err);
    if (rawMsg.includes('Missing or insufficient permissions') || rawMsg.includes('permission-denied')) {
      rulesSyncHint =
        ' (ব্রাউজারে Web Push সক্রিয় হয়েছে; ক্লাউড টোকেন সংরক্ষণের জন্য Firebase Console -> Firestore -> Rules-এ সর্বশেষ firestore.rules Publish করুন।)';
    }
  }

  setSavedLocalPushState(token, cloudSynced);

  return {
    fcmToken: token,
    cloudSynced,
    notice: `Firebase Web Push (VAPID Key Pair) সফলভাবে সক্রিয় হয়েছে${rulesSyncHint}`,
  };
}

export async function disableStaffWebPush(params: {
  staffUid: string;
  staffEmail: string;
  activeStaffUids: string[];
}): Promise<void> {
  const vapidKey = getFirebaseVapidKey();
  const savedToken = getSavedLocalPushToken();
  try {
    const supported = await isSupported();
    if (supported) {
      const messaging = getMessaging(app);
      await deleteToken(messaging);
    }
  } catch {
    // Ignore browser token revocation errors if already revoked
  }

  if (savedToken) {
    const deviceId = buildStaffPushDeviceId(params.staffUid);
    const path = `staffPushDevices/${deviceId}`;
    const deviceRef = doc(db, 'staffPushDevices', deviceId);
    try {
      let existsAlready = false;
      try {
        const snap = await getDoc(deviceRef);
        existsAlready = snap.exists();
      } catch (err) {
        handleFirestoreError(err, OperationType.GET, path);
      }

      if (existsAlready) {
        const boundedUids = Array.from(
          new Set([...params.activeStaffUids, params.staffUid].filter(Boolean))
        ).slice(0, 20);
        try {
          await updateDoc(deviceRef, {
            staffEmail: params.staffEmail.trim().toLowerCase().slice(0, 254),
            fcmToken: savedToken,
            vapidKeyPrefix: (vapidKey || 'BKo5qev_').slice(0, 12),
            userAgent:
              (typeof navigator !== 'undefined' ? navigator.userAgent : 'WebBrowser').slice(0, 300) ||
              'WebBrowser',
            status: 'disabled',
            authorizedStaffUids: boundedUids,
            updatedAt: serverTimestamp(),
          });
        } catch (err) {
          handleFirestoreError(err, OperationType.UPDATE, path);
        }
      }
    } catch {
      // Non-blocking if external rules are not yet updated
    }
  }

  setSavedLocalPushState(null, false);
}

export async function sendLocalVerificationNotification(): Promise<void> {
  if (typeof window === 'undefined' || !('Notification' in window)) {
    throw new Error('This browser context does not support Web Notifications.');
  }
  if (Notification.permission !== 'granted') {
    throw new Error('Enable Web Push Notifications first to grant browser notification permission.');
  }

  const title = 'Finesteride Recur 1Mg Admin — Push Verified';
  const body =
    'Firebase Cloud Messaging (VAPID Key Pair) & Service Worker notification channel is active.';

  if ('serviceWorker' in navigator) {
    const reg = await navigator.serviceWorker.getRegistration('/');
    if (reg && 'showNotification' in reg) {
      await reg.showNotification(title, {
        body,
        tag: 'pharmacy-admin-test-push',
      });
      return;
    }
  }

  new Notification(title, { body, tag: 'pharmacy-admin-test-push' });
}

export async function subscribeForegroundFcmMessages(
  onAlert: (alert: ForegroundPushAlert) => void
): Promise<(() => void) | null> {
  if (typeof window === 'undefined') return null;
  try {
    const supported = await isSupported();
    if (!supported) return null;
    const messaging = getMessaging(app);
    const unsub = onMessage(messaging, (payload: MessagePayload) => {
      const title =
        payload.notification?.title ||
        payload.data?.title ||
        'Finesteride Recur 1Mg Admin Notification';
      const body =
        payload.notification?.body ||
        payload.data?.body ||
        'A new store update was received via Firebase Cloud Messaging.';
      onAlert({
        id: `${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
        title,
        body,
        receivedAtIso: new Date().toISOString(),
      });
    });
    return unsub;
  } catch {
    return null;
  }
}
