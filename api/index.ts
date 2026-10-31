import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import express, { Router } from 'express';
import type { Express, Request, Response, NextFunction } from 'express';
import { GoogleGenAI, Type } from '@google/genai';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

export interface AppletFirebaseConfig {
  projectId: string;
  apiKey: string;
  authDomain: string;
  databaseURL?: string;
  firestoreDatabaseId: string;
  storageBucket: string;
  messagingSenderId: string;
  appId: string;
  measurementId: string;
  vapidKey: string;
  superAdminEmails: string[];
}

export interface VerifiedUser {
  uid: string;
  email: string;
  emailVerified: boolean;
  displayName: string;
  disabled: boolean;
  isBootstrappedSuperAdmin: boolean;
}

export interface AuthenticatedRequest extends Request {
  verifiedUser?: VerifiedUser;
}

const STORE_ID = 'finesteride-recur-bd';
const DEFAULT_WEB_PUSH_VAPID_KEY =
  'BKo5qev_gQH2OPwkHgRsKpGPMXVVbpeFVLEAwZNkO6nPlfWriuVOAqfICwUGDD0zM6CcEEhPA95lScKpimlwgpo';

function resolveProjectFile(fileName: string): string | null {
  const candidates = [
    path.join(process.cwd(), fileName),
    path.join(__dirname, fileName),
    path.join(__dirname, '..', fileName),
  ];
  for (const candidate of candidates) {
    if (fs.existsSync(candidate)) {
      return candidate;
    }
  }
  return null;
}

function getSuperAdminEmailSet(): Set<string> {
  const rawExtra = [
    process.env.VITE_SUPER_ADMIN_EMAIL || '',
    process.env.SUPER_ADMIN_EMAIL || '',
  ].join(',');
  return new Set<string>(
    rawExtra
      .split(',')
      .map((e) => e.trim().toLowerCase())
      .filter(Boolean)
  );
}

function resolveServerDatabaseId(
  rawEnvDbId: string | undefined,
  activeProjectId: string,
  appletProjectId: string | undefined,
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

  const isCustomProject = Boolean(
    activeProjectId && appletProjectId && activeProjectId !== appletProjectId
  );
  if (isCustomProject) {
    return defaultAliases.has(normalized) ? '(default)' : trimmed;
  }

  if (trimmed) {
    return defaultAliases.has(normalized) ? '(default)' : trimmed;
  }

  return appletDbId || '(default)';
}

export function loadFirebaseWebConfig(): AppletFirebaseConfig {
  const superAdminEmails = Array.from(getSuperAdminEmailSet());
  const explicitAppletConfigPaths = [
    path.join(process.cwd(), 'firebase-applet-config.json'),
    path.join(__dirname, '..', 'firebase-applet-config.json'),
    path.join(__dirname, 'firebase-applet-config.json'),
  ];
  const configPath =
    explicitAppletConfigPaths.find((candidate) => fs.existsSync(candidate)) ||
    resolveProjectFile('firebase-applet-config.json');

  if (configPath) {
    try {
      const raw = fs.readFileSync(configPath, 'utf-8');
      const parsed = JSON.parse(raw) as Partial<AppletFirebaseConfig>;
      const envProjectId = (
        process.env.VITE_FIREBASE_PROJECT_ID ||
        process.env.FIREBASE_PROJECT_ID ||
        ''
      ).trim();
      const envApiKey = (
        process.env.VITE_FIREBASE_API_KEY ||
        process.env.FIREBASE_API_KEY ||
        ''
      ).trim();
      const resolvedProjectId = envProjectId || parsed.projectId || '';
      const isCustomProject = Boolean(
        envProjectId && parsed.projectId && envProjectId !== parsed.projectId
      );
      return {
        projectId: resolvedProjectId,
        apiKey: envApiKey || (isCustomProject ? '' : parsed.apiKey || ''),
        authDomain:
          process.env.VITE_FIREBASE_AUTH_DOMAIN ||
          (isCustomProject ? `${resolvedProjectId}.firebaseapp.com` : parsed.authDomain || ''),
        databaseURL:
          process.env.VITE_FIREBASE_DATABASE_URL ||
          (isCustomProject ? undefined : parsed.databaseURL || undefined),
        firestoreDatabaseId: resolveServerDatabaseId(
          process.env.VITE_FIREBASE_DATABASE_ID,
          resolvedProjectId,
          parsed.projectId,
          parsed.firestoreDatabaseId
        ),
        storageBucket:
          process.env.VITE_FIREBASE_STORAGE_BUCKET ||
          (isCustomProject ? `${resolvedProjectId}.firebasestorage.app` : parsed.storageBucket || ''),
        messagingSenderId:
          process.env.VITE_FIREBASE_MESSAGING_SENDER_ID ||
          (isCustomProject ? '' : parsed.messagingSenderId || ''),
        appId: process.env.VITE_FIREBASE_APP_ID || (isCustomProject ? '' : parsed.appId || ''),
        measurementId:
          process.env.VITE_FIREBASE_MEASUREMENT_ID ||
          (isCustomProject ? '' : parsed.measurementId || ''),
        vapidKey: (
          process.env.VITE_FIREBASE_VAPID_KEY ||
          process.env.FIREBASE_VAPID_KEY ||
          parsed.vapidKey ||
          DEFAULT_WEB_PUSH_VAPID_KEY
        ).trim(),
        superAdminEmails,
      };
    } catch (err) {
      console.error('Warning: Failed to parse firebase-applet-config.json, falling back to environment variables:', err);
    }
  }

  const resolvedProjectId = (
    process.env.VITE_FIREBASE_PROJECT_ID ||
    process.env.FIREBASE_PROJECT_ID ||
    ''
  ).trim();
  const resolvedApiKey = (
    process.env.VITE_FIREBASE_API_KEY ||
    process.env.FIREBASE_API_KEY ||
    ''
  ).trim();
  return {
    projectId: resolvedProjectId,
    apiKey: resolvedApiKey,
    authDomain: process.env.VITE_FIREBASE_AUTH_DOMAIN || (resolvedProjectId ? `${resolvedProjectId}.firebaseapp.com` : ''),
    firestoreDatabaseId: resolveServerDatabaseId(
      process.env.VITE_FIREBASE_DATABASE_ID,
      resolvedProjectId,
      undefined,
      undefined
    ),
    storageBucket:
      process.env.VITE_FIREBASE_STORAGE_BUCKET ||
      (resolvedProjectId ? `${resolvedProjectId}.firebasestorage.app` : ''),
    messagingSenderId: process.env.VITE_FIREBASE_MESSAGING_SENDER_ID || '',
    appId: process.env.VITE_FIREBASE_APP_ID || '',
    measurementId: process.env.VITE_FIREBASE_MEASUREMENT_ID || '',
    vapidKey: (
      process.env.VITE_FIREBASE_VAPID_KEY ||
      process.env.FIREBASE_VAPID_KEY ||
      DEFAULT_WEB_PUSH_VAPID_KEY
    ).trim(),
    superAdminEmails,
  };
}

function decodeJwtAudience(idToken: string): string {
  try {
    const parts = idToken.split('.');
    if (parts.length < 2) return '';
    const payloadJson = Buffer.from(parts[1], 'base64url').toString('utf-8');
    const payload = JSON.parse(payloadJson) as { aud?: string };
    return typeof payload.aud === 'string' ? payload.aud.trim() : '';
  } catch {
    return '';
  }
}

async function verifyIdTokenWithGoogle(
  idToken: string,
  clientHeaderApiKey?: string,
  clientHeaderProjectId?: string
): Promise<VerifiedUser> {
  const activeConfig = loadFirebaseWebConfig();
  const safeHeaderKey = (clientHeaderApiKey || '').trim();
  const safeHeaderProject = (clientHeaderProjectId || '').trim();
  const candidateKeys = Array.from(
    new Set(
      [activeConfig.apiKey, safeHeaderKey]
        .map((k) => (k || '').trim())
        .filter((k) => k.length >= 20 && /^AIza[0-9A-Za-z_-]+$/.test(k))
    )
  );

  if (candidateKeys.length === 0) {
    throw new Error(
      'Server is missing VITE_FIREBASE_API_KEY environment variable. Add your VITE_FIREBASE_* variables in your hosting dashboard (e.g. Vercel Project Settings -> Environment Variables) and redeploy.'
    );
  }

  const tokenAud = decodeJwtAudience(idToken);
  if (
    activeConfig.projectId &&
    tokenAud &&
    tokenAud !== activeConfig.projectId &&
    (!safeHeaderProject || tokenAud !== safeHeaderProject)
  ) {
    throw new Error('Firebase ID token audience does not match the active project.');
  }

  let lookupUsers:
    | Array<{
        localId: string;
        email?: string;
        emailVerified?: boolean;
        displayName?: string;
        disabled?: boolean;
      }>
    | undefined;

  for (const apiKey of candidateKeys) {
    const endpoint = `https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=${encodeURIComponent(
      apiKey
    )}`;
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ idToken }),
    });
    if (response.ok) {
      const data = (await response.json()) as {
        users?: Array<{
          localId: string;
          email?: string;
          emailVerified?: boolean;
          displayName?: string;
          disabled?: boolean;
        }>;
      };
      lookupUsers = data.users;
      break;
    }
  }

  if (!lookupUsers) {
    throw new Error('Invalid or expired Firebase Authentication ID token.');
  }

  const account = lookupUsers[0];
  if (!account || !account.localId) {
    throw new Error('Authenticated account record not found in Firebase Identity Toolkit.');
  }
  if (account.disabled) {
    throw new Error('This Firebase Authentication account has been disabled.');
  }
  if (!account.emailVerified) {
    throw new Error('Verified email address is required for administrative operations.');
  }

  const normalizedEmail = (account.email || '').trim().toLowerCase();
  const explicitSet = getSuperAdminEmailSet();
  return {
    uid: account.localId,
    email: normalizedEmail,
    emailVerified: Boolean(account.emailVerified),
    displayName: account.displayName || normalizedEmail,
    disabled: Boolean(account.disabled),
    isBootstrappedSuperAdmin:
      explicitSet.size > 0
        ? explicitSet.has(normalizedEmail)
        : Boolean(normalizedEmail && normalizedEmail.includes('@')),
  };
}

async function requireVerifiedAuth(
  req: AuthenticatedRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const authHeader = req.headers.authorization || '';
    if (!authHeader.startsWith('Bearer ')) {
      res.status(401).json({ error: 'Missing Authorization Bearer token.' });
      return;
    }
    const token = authHeader.slice('Bearer '.length).trim();
    if (!token) {
      res.status(401).json({ error: 'Empty Firebase ID token.' });
      return;
    }
    const headerApiKey =
      typeof req.headers['x-firebase-web-api-key'] === 'string'
        ? req.headers['x-firebase-web-api-key']
        : undefined;
    const headerProjectId =
      typeof req.headers['x-firebase-project-id'] === 'string'
        ? req.headers['x-firebase-project-id']
        : undefined;
    const verified = await verifyIdTokenWithGoogle(token, headerApiKey, headerProjectId);
    req.verifiedUser = verified;
    next();
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Token verification failed.';
    res.status(401).json({ error: message });
  }
}

const PERMITTED_ORDER_TRANSITIONS: Record<string, string[]> = {
  pending: ['awaiting_review', 'confirmed', 'cancelled'],
  awaiting_review: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['ready_for_dispatch', 'cancelled'],
  ready_for_dispatch: ['shipped', 'cancelled'],
  shipped: ['delivered', 'refund_pending'],
  delivered: ['refund_pending'],
  refund_pending: ['refunded'],
  cancelled: [],
  refunded: [],
};

export function sendRuntimeFirebaseConfig(_req: Request, res: Response): void {
  const activeConfig = loadFirebaseWebConfig();
  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.send(`window.__FIREBASE_RUNTIME_CONFIG__ = ${JSON.stringify(activeConfig)};\n`);
}

export function sendFirebaseMessagingServiceWorker(_req: Request, res: Response): void {
  const activeConfig = loadFirebaseWebConfig();
  const swFirebaseConfig = {
    apiKey: activeConfig.apiKey,
    authDomain: activeConfig.authDomain,
    projectId: activeConfig.projectId,
    storageBucket: activeConfig.storageBucket,
    messagingSenderId: activeConfig.messagingSenderId,
    appId: activeConfig.appId,
  };

  const scriptBody = `/* Dynamic Firebase Cloud Messaging Service Worker — Finesteride Recur 1Mg Shop Bd */
self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

const SW_FIREBASE_CONFIG = ${JSON.stringify(swFirebaseConfig)};
let fcmInitialized = false;

try {
  if (
    SW_FIREBASE_CONFIG.apiKey &&
    SW_FIREBASE_CONFIG.projectId &&
    SW_FIREBASE_CONFIG.messagingSenderId &&
    SW_FIREBASE_CONFIG.appId
  ) {
    importScripts(
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-app-compat.js',
      'https://www.gstatic.com/firebasejs/10.14.1/firebase-messaging-compat.js'
    );
    firebase.initializeApp(SW_FIREBASE_CONFIG);
    const messaging = firebase.messaging();
    fcmInitialized = true;

    messaging.onBackgroundMessage((payload) => {
      const notification = payload.notification || {};
      const title = notification.title || 'Finesteride Recur 1Mg Admin';
      const options = {
        body: notification.body || 'New pharmacy administrative alert received.',
        data: payload.data || {},
        tag: (payload.data && payload.data.tag) || 'pharmacy-admin-fcm',
      };
      self.registration.showNotification(title, options);
    });
  }
} catch (_err) {
  fcmInitialized = false;
}

self.addEventListener('push', (event) => {
  if (fcmInitialized || !event.data) return;
  let payload = {};
  try {
    payload = event.data.json();
  } catch (_e) {
    payload = { notification: { title: 'Finesteride Recur 1Mg Admin', body: event.data.text() } };
  }
  const notification = payload.notification || payload.data || {};
  const title = notification.title || 'Finesteride Recur 1Mg Admin Alert';
  const options = {
    body: notification.body || 'New pharmacy administrative update received.',
    data: payload.data || {},
    tag: notification.tag || 'pharmacy-admin-push',
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windowClients) => {
      for (const client of windowClients) {
        if ('focus' in client) {
          return client.focus();
        }
      }
      if (self.clients.openWindow) {
        return self.clients.openWindow('/');
      }
      return undefined;
    })
  );
});
`;

  res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
  res.setHeader('Service-Worker-Allowed', '/');
  res.send(scriptBody);
}

export function createApiRouter(): Router {
  const router = Router();

  router.get('/runtime-firebase-config', sendRuntimeFirebaseConfig);
  router.get('/runtime-firebase-config.js', sendRuntimeFirebaseConfig);
  router.get('/firebase-messaging-sw.js', sendFirebaseMessagingServiceWorker);

  // 1. Public Backend Health & Shared Schema Metadata (No secrets exposed)
  router.get('/health', (_req: Request, res: Response) => {
    const activeConfig = loadFirebaseWebConfig();
    res.json({
      status: 'ok',
      storeId: STORE_ID,
      projectId: activeConfig.projectId,
      firestoreDatabaseId: activeConfig.firestoreDatabaseId,
      webPushConfigured: Boolean(activeConfig.vapidKey),
      serverTimestamp: new Date().toISOString(),
    });
  });

  // 1b. Security Rules Bundle Helper for Custom Firebase Project Provisioning
  router.get('/firebase/rules-bundle', (_req: Request, res: Response) => {
    const activeConfig = loadFirebaseWebConfig();
    const firestoreRulesPath = resolveProjectFile('firestore.rules');
    const storageRulesPath = resolveProjectFile('storage.rules');
    const firestoreRules = firestoreRulesPath ? fs.readFileSync(firestoreRulesPath, 'utf-8') : '';
    const storageRules = storageRulesPath ? fs.readFileSync(storageRulesPath, 'utf-8') : '';
    res.json({
      projectId: activeConfig.projectId,
      firestoreDatabaseId: activeConfig.firestoreDatabaseId,
      firestoreRules,
      storageRules,
    });
  });

  // 2. Trusted Identity & Account Status Verification
  router.post('/auth/verify-session', requireVerifiedAuth, (req: AuthenticatedRequest, res: Response) => {
    res.json({
      verified: true,
      user: req.verifiedUser,
      serverTimestamp: new Date().toISOString(),
    });
  });

  // 3. Trusted Discount & Coupon Calculation Engine
  router.post('/discounts/calculate', requireVerifiedAuth, (req: AuthenticatedRequest, res: Response) => {
    const {
      subtotalBdt,
      deliveryFeeBdt,
      coupon,
      itemCategories,
    } = req.body as {
      subtotalBdt?: number;
      deliveryFeeBdt?: number;
      itemCategories?: string[];
      coupon?: {
        code: string;
        discountType: 'percentage' | 'fixed_bdt';
        discountValue: number;
        minOrderAmountBdt: number;
        maxDiscountBdt: number;
        startDate: string;
        endDate: string;
        usageLimit: number;
        usedCount: number;
        applicableCategory: string;
        status: 'active' | 'inactive';
      } | null;
    };

    const safeSubtotal = Math.max(0, Number(subtotalBdt) || 0);
    const safeDelivery = Math.max(0, Number(deliveryFeeBdt) || 0);

    if (!coupon) {
      res.json({
        valid: true,
        subtotalBdt: safeSubtotal,
        discountBdt: 0,
        deliveryFeeBdt: safeDelivery,
        totalAmountBdt: safeSubtotal + safeDelivery,
        reason: 'No coupon applied.',
      });
      return;
    }

    const todayIso = new Date().toISOString().slice(0, 10);
    if (coupon.status !== 'active') {
      res.status(400).json({ valid: false, error: 'Coupon is currently inactive.' });
      return;
    }
    if (todayIso < coupon.startDate || todayIso > coupon.endDate) {
      res.status(400).json({
        valid: false,
        error: `Coupon is only valid between ${coupon.startDate} and ${coupon.endDate}.`,
      });
      return;
    }
    if (coupon.usedCount >= coupon.usageLimit) {
      res.status(400).json({ valid: false, error: 'Coupon usage limit has been exhausted.' });
      return;
    }
    if (safeSubtotal < coupon.minOrderAmountBdt) {
      res.status(400).json({
        valid: false,
        error: `Minimum order subtotal of BDT ${coupon.minOrderAmountBdt} is required for coupon ${coupon.code}.`,
      });
      return;
    }
    if (
      coupon.applicableCategory &&
      coupon.applicableCategory !== 'all' &&
      Array.isArray(itemCategories) &&
      !itemCategories.includes(coupon.applicableCategory)
    ) {
      res.status(400).json({
        valid: false,
        error: `Coupon ${coupon.code} applies only to category "${coupon.applicableCategory}".`,
      });
      return;
    }

    let rawDiscount = 0;
    if (coupon.discountType === 'percentage') {
      const clampedPct = Math.min(90, Math.max(0, Number(coupon.discountValue) || 0));
      rawDiscount = Math.round((safeSubtotal * clampedPct) / 100);
    } else {
      rawDiscount = Math.round(Math.max(0, Number(coupon.discountValue) || 0));
    }

    if (coupon.maxDiscountBdt > 0) {
      rawDiscount = Math.min(rawDiscount, coupon.maxDiscountBdt);
    }

    const finalDiscount = Math.min(rawDiscount, safeSubtotal);
    const totalAmountBdt = Math.max(0, safeSubtotal - finalDiscount + safeDelivery);

    res.json({
      valid: true,
      couponCode: coupon.code,
      subtotalBdt: safeSubtotal,
      discountBdt: finalDiscount,
      deliveryFeeBdt: safeDelivery,
      totalAmountBdt,
      verifiedAt: new Date().toISOString(),
    });
  });

  // 4. Trusted Order Workflow & Prescription Safety Validator
  router.post(
    '/orders/validate-transition',
    requireVerifiedAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const {
        currentStatus,
        nextStatus,
        staffRole,
        requiresPrescription,
        prescriptionReviewStatus,
        reviewerLicense,
        trackingReference,
        cancellationReason,
      } = req.body as {
        currentStatus?: string;
        nextStatus?: string;
        staffRole?: string;
        requiresPrescription?: boolean;
        prescriptionReviewStatus?: string;
        reviewerLicense?: string;
        trackingReference?: string;
        cancellationReason?: string;
      };

      const effectiveRole = req.verifiedUser?.isBootstrappedSuperAdmin ? 'super_admin' : staffRole || '';
      if (!['super_admin', 'store_admin', 'order_manager'].includes(effectiveRole)) {
        res.status(403).json({
          allowed: false,
          error: 'Your staff role is not permitted to transition order statuses.',
        });
        return;
      }

      if (!currentStatus || !nextStatus || !(currentStatus in PERMITTED_ORDER_TRANSITIONS)) {
        res.status(400).json({ allowed: false, error: 'Invalid current or target order status.' });
        return;
      }

      const allowedNext = PERMITTED_ORDER_TRANSITIONS[currentStatus] || [];
      if (!allowedNext.includes(nextStatus) && effectiveRole !== 'super_admin') {
        res.status(400).json({
          allowed: false,
          error: `Transition from "${currentStatus}" to "${nextStatus}" violates the pharmacy order workflow policy.`,
        });
        return;
      }

      const fulfillmentStatuses = [
        'confirmed',
        'processing',
        'ready_for_dispatch',
        'shipped',
        'delivered',
      ];
      if (requiresPrescription && fulfillmentStatuses.includes(nextStatus)) {
        if (
          prescriptionReviewStatus !== 'approved' ||
          !reviewerLicense ||
          reviewerLicense.trim().length < 3
        ) {
          res.status(422).json({
            allowed: false,
            error:
              'Clinical safety block: Orders containing prescription-only medicines cannot be confirmed or dispatched until a licensed reviewer approves the prescription.',
          });
          return;
        }
      }

      if (nextStatus === 'shipped' && (!trackingReference || trackingReference.trim().length < 3)) {
        res.status(400).json({
          allowed: false,
          error:
            'A valid courier shipment or rider tracking reference is required before marking an order as Shipped.',
        });
        return;
      }

      if (
        nextStatus === 'cancelled' &&
        (!cancellationReason || cancellationReason.trim().length < 5)
      ) {
        res.status(400).json({
          allowed: false,
          error:
            'A documented policy reason (minimum 5 characters) is required when cancelling an order.',
        });
        return;
      }

      res.json({
        allowed: true,
        verifiedByUid: req.verifiedUser?.uid,
        verifiedAt: new Date().toISOString(),
      });
    }
  );

  // 5. Trusted Payment Gateway Reconciliation, Anti-Spoofing & Refund Verification
  router.post(
    '/payments/verify-gateway',
    requireVerifiedAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const {
        orderId,
        paymentMethod,
        decision = 'verify_paid',
        transactionReference,
        reason,
        amountBdt,
        staffRole,
        reconciliationConfirmed,
      } = req.body as {
        orderId?: string;
        paymentMethod?: 'cod' | 'bkash' | 'nagad';
        decision?: 'verify_paid' | 'mark_failed' | 'complete_refund';
        transactionReference?: string;
        reason?: string;
        amountBdt?: number;
        staffRole?: string;
        reconciliationConfirmed?: boolean;
      };

      const effectiveRole = req.verifiedUser?.isBootstrappedSuperAdmin ? 'super_admin' : staffRole || '';
      if (!['super_admin', 'store_admin', 'order_manager'].includes(effectiveRole)) {
        res.status(403).json({
          verified: false,
          error: 'Insufficient permissions to verify or adjudicate payment settlement.',
        });
        return;
      }

      if (!orderId || !paymentMethod || (Number(amountBdt) || 0) <= 0) {
        res.status(400).json({
          verified: false,
          error: 'Valid orderId, paymentMethod, and positive amountBdt are required.',
        });
        return;
      }

      const verifiedAt = new Date().toISOString();
      const cleanRef = (transactionReference || '').trim().toUpperCase();
      const cleanReason = (reason || '').trim();

      if (decision === 'mark_failed') {
        if (cleanReason.length < 5) {
          res.status(400).json({
            verified: false,
            error: 'A documented verification failure reason (minimum 5 characters) is required.',
          });
          return;
        }
        const failDigest = crypto
          .createHash('sha256')
          .update(`${orderId}:failed:${cleanRef}:${cleanReason}:${req.verifiedUser?.uid}:${verifiedAt}`)
          .digest('hex')
          .slice(0, 10)
          .toUpperCase();

        const stampedFailRef = cleanRef
          ? `${cleanRef} [REJECTED-${failDigest}]`
          : `NO-TRX [REJECTED-${failDigest}]`;

        res.json({
          verified: true,
          paymentStatus: 'failed',
          normalizedReference: stampedFailRef.slice(0, 100),
          paymentVerifiedAt: '',
          verifiedByEmail: req.verifiedUser?.email,
        });
        return;
      }

      if (decision === 'complete_refund') {
        if (!cleanRef || cleanRef.length < 4) {
          res.status(400).json({
            verified: false,
            error: 'A valid refund disbursement reference (minimum 4 characters) is required.',
          });
          return;
        }
        if (!reconciliationConfirmed) {
          res.status(400).json({
            verified: false,
            error: 'Confirm that the refund amount has been disbursed before marking as Refunded.',
          });
          return;
        }
        const refundDigest = crypto
          .createHash('sha256')
          .update(`${orderId}:refunded:${cleanRef}:${amountBdt}:${req.verifiedUser?.uid}:${verifiedAt}`)
          .digest('hex')
          .slice(0, 12)
          .toUpperCase();

        res.json({
          verified: true,
          paymentStatus: 'refunded',
          normalizedReference: `${cleanRef} [RFD-${refundDigest}]`.slice(0, 100),
          paymentVerifiedAt: verifiedAt,
          verifiedByEmail: req.verifiedUser?.email,
        });
        return;
      }

      if (paymentMethod === 'bkash') {
        if (!/^[A-Z0-9]{8,14}$/.test(cleanRef)) {
          res.status(400).json({
            verified: false,
            error:
              'bKash verification requires an 8–14 character alphanumeric Merchant TrxID verified against merchant settlement.',
          });
          return;
        }
        if (!reconciliationConfirmed) {
          res.status(400).json({
            verified: false,
            error:
              'Client-submitted references are never auto-trusted. Confirm merchant gateway settlement verification.',
          });
          return;
        }
      } else if (paymentMethod === 'nagad') {
        if (!/^[A-Z0-9\-]{8,18}$/.test(cleanRef)) {
          res.status(400).json({
            verified: false,
            error: 'Nagad verification requires an 8–18 character merchant issuer reference ID.',
          });
          return;
        }
        if (!reconciliationConfirmed) {
          res.status(400).json({
            verified: false,
            error:
              'Client-submitted references are never auto-trusted. Confirm Nagad merchant portal settlement verification.',
          });
          return;
        }
      } else if (paymentMethod === 'cod') {
        if (!cleanRef || cleanRef.length < 4) {
          res.status(400).json({
            verified: false,
            error:
              'Cash on Delivery settlement requires courier cash-collection receipt reference.',
          });
          return;
        }
      }

      const digest = crypto
        .createHash('sha256')
        .update(
          `${orderId}:${paymentMethod}:${cleanRef}:${amountBdt}:${req.verifiedUser?.uid}:${verifiedAt}`
        )
        .digest('hex')
        .slice(0, 16)
        .toUpperCase();

      res.json({
        verified: true,
        paymentStatus: 'verified_paid',
        normalizedReference: `${cleanRef} [SRV-${digest}]`.slice(0, 100),
        paymentVerifiedAt: verifiedAt,
        verifiedByEmail: req.verifiedUser?.email,
      });
    }
  );

  // 6. Privacy-Enforced CSV Export Generator
  router.post(
    '/reports/sanitize-csv',
    requireVerifiedAuth,
    (req: AuthenticatedRequest, res: Response) => {
      const { rows, staffRole, includePii } = req.body as {
        rows?: Array<Record<string, unknown>>;
        staffRole?: string;
        includePii?: boolean;
      };

      if (!Array.isArray(rows) || rows.length === 0) {
        res.status(400).json({ error: 'No report records supplied for CSV export.' });
        return;
      }

      const effectiveRole = req.verifiedUser?.isBootstrappedSuperAdmin ? 'super_admin' : staffRole || '';
      const canExportPii =
        ['super_admin', 'store_admin'].includes(effectiveRole) && Boolean(includePii);
      const sensitiveFields = new Set([
        'customerPhone',
        'phone',
        'email',
        'shippingAddress',
        'deliveryAddress',
      ]);

      const headers = Object.keys(rows[0]).filter(
        (key) => canExportPii || !sensitiveFields.has(key)
      );
      const escapeCsvCell = (val: unknown): string => {
        const str = val === null || val === undefined ? '' : String(val);
        const safeStr = /^[=+\-@]/.test(str) ? `'${str}` : str;
        if (safeStr.includes(',') || safeStr.includes('"') || safeStr.includes('\n')) {
          return `"${safeStr.replace(/"/g, '""')}"`;
        }
        return safeStr;
      };

      const csvLines = [
        headers.join(','),
        ...rows.map((row) => headers.map((h) => escapeCsvCell(row[h])).join(',')),
      ];

      res.json({
        csv: csvLines.join('\n'),
        piiRedacted: !canExportPii,
        rowCount: rows.length,
      });
    }
  );

  // 7. Server-Side AI Proactive Stock & Inventory Analysis Engine (Gemini 3.8 Flash)
  router.post(
    '/ai/stock-analysis',
    requireVerifiedAuth,
    async (req: AuthenticatedRequest, res: Response) => {
      try {
        const { products = [], batches = [] } = req.body as {
          products?: Array<{
            id: string;
            name: string;
            genericName?: string;
            categoryName?: string;
            stockQuantity: number;
            minStockThreshold: number;
            availabilityStatus: string;
            reorderQuantity?: number;
          }>;
          batches?: Array<{
            id: string;
            productName?: string;
            batchNumber: string;
            expiryDate: string;
            quantityRemaining: number;
            status: string;
          }>;
        };

        const apiKey = process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;

        // Perform local analytical rule calculation for fallback or complement
        const lowStockProducts = products.filter(
          (p) =>
            p.stockQuantity <= (p.minStockThreshold || 10) ||
            p.availabilityStatus === 'low_stock' ||
            p.availabilityStatus === 'out_of_stock'
        );

        const todayIso = new Date().toISOString().slice(0, 10);
        const nearExpiryBatches = batches.filter((b) => {
          if (b.quantityRemaining <= 0) return false;
          const diffDays = Math.ceil(
            (new Date(b.expiryDate).getTime() - new Date(todayIso).getTime()) /
              (1000 * 3600 * 24)
          );
          return diffDays <= 60 || b.status === 'near_expiry' || b.status === 'expired_quarantined';
        });

        if (apiKey) {
          try {
            const ai = new GoogleGenAI({
              apiKey,
              httpOptions: {
                headers: {
                  'User-Agent': 'aistudio-build',
                },
              },
            });

            const prompt = `You are an expert AI Pharmacy Inventory Manager. Analyze the following pharmacy catalog stock levels and batch expiry records. Predict which products will run out of stock soon, identify urgent reorder priorities, and provide actionable reorder guidance for the pharmacy admin in both Bengali and English.

Pharmacy Stock Catalog (${products.length} SKUs):
${JSON.stringify(products.slice(0, 35))}

Batch Expiry Records (${batches.length} batches):
${JSON.stringify(batches.slice(0, 35))}

Return a structured JSON response matching the required schema.`;

            const aiResponse = await ai.models.generateContent({
              model: 'gemini-3.8-flash',
              contents: prompt,
              config: {
                responseMimeType: 'application/json',
                responseSchema: {
                  type: Type.OBJECT,
                  properties: {
                    summaryBn: { type: Type.STRING },
                    summaryEn: { type: Type.STRING },
                    overallRiskLevel: { type: Type.STRING },
                    urgentAlerts: {
                      type: Type.ARRAY,
                      items: {
                        type: Type.OBJECT,
                        properties: {
                          productId: { type: Type.STRING },
                          productName: { type: Type.STRING },
                          severity: { type: Type.STRING },
                          alertType: { type: Type.STRING },
                          messageBn: { type: Type.STRING },
                          messageEn: { type: Type.STRING },
                          suggestedReorderQuantity: { type: Type.NUMBER },
                          runoutDaysEstimate: { type: Type.NUMBER },
                        },
                        required: [
                          'productId',
                          'productName',
                          'severity',
                          'alertType',
                          'messageBn',
                          'messageEn',
                          'suggestedReorderQuantity',
                        ],
                      },
                    },
                    recommendationsBn: { type: Type.ARRAY, items: { type: Type.STRING } },
                    recommendationsEn: { type: Type.ARRAY, items: { type: Type.STRING } },
                  },
                  required: [
                    'summaryBn',
                    'summaryEn',
                    'overallRiskLevel',
                    'urgentAlerts',
                    'recommendationsBn',
                    'recommendationsEn',
                  ],
                },
              },
            });

            if (aiResponse.text) {
              const parsed = JSON.parse(aiResponse.text);
              res.json({
                ...parsed,
                aiPowered: true,
                analyzedAt: new Date().toISOString(),
              });
              return;
            }
          } catch (geminiError) {
            console.warn('Gemini API call warning, falling back to rule engine:', geminiError);
          }
        }

        // Rule-based analytical fallback
        const fallbackAlerts = lowStockProducts.map((p) => {
          const isOut = p.stockQuantity <= 0;
          return {
            productId: p.id,
            productName: p.name,
            severity: isOut ? 'critical' : 'warning',
            alertType: isOut ? 'out_of_stock' : 'low_stock',
            messageBn: isOut
              ? `"${p.name}" এর স্টক সম্পূর্ণ শেষ হয়ে গেছে! দ্রুত স্টক রি-অর্ডার করুন।`
              : `"${p.name}" এর স্টক ফুরিয়ে আসছে (বাকি: ${p.stockQuantity} টি, ন্যূনতম সীমা: ${p.minStockThreshold || 10} টি)।`,
            messageEn: isOut
              ? `"${p.name}" is completely out of stock! Reorder immediately.`
              : `"${p.name}" stock is running critically low (${p.stockQuantity} left, min threshold: ${p.minStockThreshold || 10}).`,
            suggestedReorderQuantity: (p.reorderQuantity && p.reorderQuantity > 0) ? p.reorderQuantity : Math.max(50, (p.minStockThreshold || 10) * 3),
            runoutDaysEstimate: isOut ? 0 : Math.max(1, Math.floor(p.stockQuantity / 2)),
          };
        });

        const expiryAlerts = nearExpiryBatches.map((b) => ({
          productId: b.id,
          productName: `${b.productName || 'Medicine'} (Batch ${b.batchNumber})`,
          severity: 'warning',
          alertType: 'near_expiry',
          messageBn: `ব্যাচ ${b.batchNumber} এর মেয়াদ ${b.expiryDate} তারিখে শেষ হবে (অবশিষ্ট: ${b.quantityRemaining} টি)।`,
          messageEn: `Batch ${b.batchNumber} expires on ${b.expiryDate} (${b.quantityRemaining} units remaining).`,
          suggestedReorderQuantity: 0,
          runoutDaysEstimate: Math.max(0, Math.ceil((new Date(b.expiryDate).getTime() - new Date().getTime()) / (1000 * 3600 * 24))),
        }));

        const totalAlerts = [...fallbackAlerts, ...expiryAlerts];
        const overallRiskLevel = totalAlerts.some((a) => a.severity === 'critical')
          ? 'high'
          : totalAlerts.length > 0
          ? 'medium'
          : 'low';

        res.json({
          summaryBn: totalAlerts.length === 0
            ? 'সকল পণ্যের স্টক ও ব্যাচ মেয়াদ নিরাপদ অবস্থায় আছে।'
            : `${lowStockProducts.length}টি পণ্যের স্টক ফুরিয়ে আসার ঝুঁকিতে এবং ${nearExpiryBatches.length}টি ব্যাচ মেয়াদের কাছাকাছি।`,
          summaryEn: totalAlerts.length === 0
            ? 'All product stocks and batch expiries are within safe parameters.'
            : `${lowStockProducts.length} product(s) low on stock and ${nearExpiryBatches.length} batch(es) near expiry.`,
          overallRiskLevel,
          urgentAlerts: totalAlerts,
          recommendationsBn: [
            'স্বল্প স্টকের ওষুধগুলো পাইকারি সরবরাহকারীর কাছ থেকে দ্রুত রি-অর্ডার করুন।',
            'মেয়াদ ফুরিয়ে আসা ব্যাচগুলো প্রথমে বিক্রি করতে FEFO (First-Expired-First-Out) পদ্ধতি ব্যবহার করুন।',
            'জরুরী অ্যান্টিবায়োটিক ও জীবনরক্ষাকারী ওষুধের জন্য নিয়মিত ন্যূনতম স্টক সীমা বজায় রাখুন।',
          ],
          recommendationsEn: [
            'Place bulk reorders for low-stock medicines from wholesale suppliers.',
            'Apply FEFO (First-Expired-First-Out) dispensing policy for near-expiry batches.',
            'Maintain safe buffer stocks for essential lifesaving medications.',
          ],
          aiPowered: false,
          analyzedAt: new Date().toISOString(),
        });
      } catch (err) {
        console.error('AI Stock analysis endpoint error:', err);
        res.status(500).json({ error: 'Failed to complete AI stock analysis.' });
      }
    }
  );

  return router;
}

export function createServerlessApiApp(): Express {
  const app = express();
  app.use(express.json({ limit: '1mb' }));
  app.use((req: Request, _res: Response, next: NextFunction) => {
    const rawSubpath = req.query.__api_path;
    if (
      (req.path === '/api' || req.path === '/' || req.path === '/api/index') &&
      typeof rawSubpath === 'string' &&
      rawSubpath.trim().length > 0
    ) {
      const cleanSubpath = rawSubpath.replace(/^\/+/, '');
      const searchParams = new URLSearchParams(req.url.split('?')[1] || '');
      searchParams.delete('__api_path');
      const remainingQuery = searchParams.toString();
      req.url = `/api/${cleanSubpath}${remainingQuery ? `?${remainingQuery}` : ''}`;
    }
    next();
  });
  app.get('/runtime-firebase-config.js', sendRuntimeFirebaseConfig);
  app.get('/firebase-messaging-sw.js', sendFirebaseMessagingServiceWorker);
  const apiRouter = createApiRouter();
  app.use('/api', apiRouter);
  // Also mount on '/' in case a serverless platform strips the '/api' prefix during rewrite
  app.use('/', apiRouter);
  return app;
}

const vercelHandler = createServerlessApiApp();
export default vercelHandler;
