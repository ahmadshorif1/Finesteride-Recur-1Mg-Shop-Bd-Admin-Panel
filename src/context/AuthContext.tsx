import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getRedirectResult,
  isSignInWithEmailLink,
  linkWithCredential,
  multiFactor,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  sendSignInLinkToEmail,
  signInWithEmailAndPassword,
  signInWithEmailLink,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  updateProfile,
  verifyPasswordResetCode,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  auth,
  db,
  getFirebaseProjectInfo,
  googleProvider,
  isBootstrappedSuperAdminEmail,
  popupRedirectResolver,
  SHARED_STORE_ID,
  verifyFirestoreDatabaseProvisioned,
} from '../lib/firebase';
import { bootstrapSuperAdminProfile, verifyServerSession } from '../services/pharmacyService';
import { ROLE_PERMISSIONS, type RolePermissions, type StaffMember, type StaffRole } from '../types/pharmacy';

const PENDING_EMAIL_SIGNIN_STORAGE_KEY = 'pharmacy_admin_pending_signin_email';

interface AuthContextValue {
  user: User | null;
  authReady: boolean;
  staffProfile: StaffMember | null;
  staffLoading: boolean;
  serverVerified: boolean;
  isAuthorizedStaff: boolean;
  isSuspendedStaff: boolean;
  isBootstrappedSuperAdmin: boolean;
  needsSuperAdminBootstrap: boolean;
  hasPasswordProvider: boolean;
  effectiveRole: StaffRole | null;
  permissions: RolePermissions | null;
  mfaEnrolledCount: number;
  authError: string | null;
  popupBlocked: boolean;
  emailLinkSentTo: string | null;
  pendingEmailLinkUrl: string | null;
  clearAuthError: () => void;
  clearEmailLinkFlow: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithGoogleRedirect: () => Promise<void>;
  loginWithEmailPassword: (email: string, password: string) => Promise<void>;
  registerWithEmailPassword: (email: string, password: string, displayName?: string) => Promise<string>;
  linkPasswordViaGoogle: (expectedEmail: string, newPassword: string) => Promise<string>;
  sendPopupFreeSignInLink: (email: string) => Promise<string>;
  setupPasswordOrSendEmailLink: (
    email: string,
    password: string,
    displayName?: string
  ) => Promise<{ status: 'account_created' | 'verification_link_sent'; message: string }>;
  completeFirebaseEmailAction: (
    rawLinkOrCode: string,
    emailInput?: string,
    newPassword?: string
  ) => Promise<string>;
  setOrUpdateCurrentAccountPassword: (newPassword: string) => Promise<string>;
  requestPasswordReset: (email: string) => Promise<string>;
  sendVerificationToCurrentUser: () => Promise<string>;
  refreshCurrentUserVerification: () => Promise<boolean>;
  retrySessionVerification: () => Promise<void>;
  completeSuperAdminBootstrap: (displayName: string, licenseNumber: string) => Promise<void>;
  logoutAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export function unwrapFirebaseActionUrl(rawInput: string): string {
  let candidate = (rawInput || '').trim().replace(/&amp;/g, '&');
  if (!candidate) return '';

  const urlMatch = candidate.match(/https?:\/\/[^\s"'<>]+/i);
  if (urlMatch) {
    candidate = urlMatch[0];
  }

  for (let depth = 0; depth < 3; depth += 1) {
    try {
      const parsed = new URL(candidate);
      if (
        (parsed.hostname.endsWith('google.com') && parsed.pathname === '/url') ||
        parsed.searchParams.has('q') ||
        parsed.searchParams.has('url')
      ) {
        const inner = parsed.searchParams.get('q') || parsed.searchParams.get('url');
        if (inner && /^https?:\/\//i.test(inner)) {
          candidate = inner.replace(/&amp;/g, '&');
          continue;
        }
      }
      break;
    } catch {
      break;
    }
  }

  return candidate;
}

function extractFirebaseActionParams(rawInput: string): {
  cleanUrl: string;
  mode: string;
  oobCode: string;
} {
  const cleanUrl = unwrapFirebaseActionUrl(rawInput);
  if (!cleanUrl) {
    return { cleanUrl: '', mode: '', oobCode: '' };
  }

  try {
    const parsed = new URL(cleanUrl);
    let mode = parsed.searchParams.get('mode') || '';
    let oobCode = parsed.searchParams.get('oobCode') || '';

    if ((!mode || !oobCode) && parsed.searchParams.has('link')) {
      const innerLink = parsed.searchParams.get('link') || '';
      if (innerLink) {
        const innerParsed = new URL(innerLink);
        mode = mode || innerParsed.searchParams.get('mode') || '';
        oobCode = oobCode || innerParsed.searchParams.get('oobCode') || '';
      }
    }

    return { cleanUrl, mode, oobCode };
  } catch {
    // Allow raw oobCode fallback if user pasted only the code token
    const tokenOnly = cleanUrl.replace(/\s+/g, '');
    return {
      cleanUrl: tokenOnly,
      mode: '',
      oobCode: /^[A-Za-z0-9_-]{20,}$/.test(tokenOnly) ? tokenOnly : '',
    };
  }
}

function formatFirebaseAuthError(err: unknown, mode: 'google' | 'email' | 'reset' | 'link'): string {
  const code = (err as { code?: string })?.code || '';
  const { projectId } = getFirebaseProjectInfo();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain') {
    return `Domain "${host}" is not authorized in Firebase project "${projectId}". Open Firebase Console -> Authentication -> Settings -> Authorized domains -> Add domain "${host}".`;
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google Sign-In পপআপটি সম্পন্ন হওয়ার আগেই বন্ধ হয়ে গেছে। আবার ক্লিক করুন অথবা নিচে পপআপ ছাড়াই ইমেইল লিংক দিয়ে লগইন করুন।';
  }

  if (code === 'auth/popup-blocked') {
    return 'আপনার ব্রাউজার বা প্রিভিউ ফ্রেম Google পপআপ ব্লক করেছে। পপআপ ছাড়াই তাৎক্ষণিক লগইন করতে নিচে আপনার অ্যাডমিন ইমেইল দিয়ে "পপআপ ছাড়াই লগইন লিংক পাঠান" বাটনে ক্লিক করুন, অথবা ব্রাউজারের অ্যাড্রেস বারে পপআপ Allow করুন।';
  }

  if (code === 'auth/operation-not-allowed') {
    if (mode === 'google') {
      return `Google Sign-In is disabled in Firebase project "${projectId}". Open Firebase Console -> Authentication -> Sign-in method -> Google -> Enable -> select Support email -> Save.`;
    }
    if (mode === 'link') {
      return `Email Link Sign-In is disabled in Firebase project "${projectId}". Enable "Email link (passwordless sign-in)" under Firebase Console -> Authentication -> Sign-in method -> Email/Password.`;
    }
    return `Email/Password Sign-In is disabled in Firebase project "${projectId}". Enable Email/Password in Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable -> Save.`;
  }

  if (code === 'auth/email-already-in-use') {
    return 'এই ইমেইলটি ইতিমধ্যে নিবন্ধিত আছে (যেমন Google অ্যাকাউন্ট হিসেবে)। নিচে "পপআপ ছাড়াই ইমেইল লিংক দিয়ে পাসওয়ার্ড সেট ও লগইন করুন" বাটনে ক্লিক করলে কোনো পপআপ ছাড়াই এই পাসওয়ার্ডটি আপনার অ্যাকাউন্টে যুক্ত হয়ে যাবে।';
  }

  if (code === 'auth/weak-password') {
    return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters long.)';
  }

  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return 'এই ইমেইল লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে অথবা মেয়াদ শেষ হয়েছে। অনুগ্রহ করে নতুন লিংক পাঠিয়ে সর্বশেষ ইমেইলের লিংকটি ব্যবহার করুন।';
  }

  if (code === 'auth/invalid-email') {
    return 'সঠিক ইমেইল ঠিকানা লিখুন (যে ইমেইলে লিংক পাঠানো হয়েছে ঠিক সেটিই দিন)।';
  }

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-login-credentials'
  ) {
    if (mode === 'google') {
      return `Google Sign-In credential was rejected (auth/invalid-credential). Open Firebase Console (${projectId}) -> Authentication -> Sign-in method -> Google, ensure Enable is ON, select a Project support email, and click Save.`;
    }
    return 'ইমেইল বা পাসওয়ার্ড মেলেনি (auth/invalid-credential)। Gmail অ্যাকাউন্টে ডিফল্টভাবে আলাদা Firebase পাসওয়ার্ড থাকে না—নিচে "পপআপ ছাড়াই ইমেইল লিংক দিয়ে এই পাসওয়ার্ড সেট ও লগইন করুন" বাটনে ক্লিক করুন, তাহলে কোনো পপআপ ছাড়াই আপনার দেওয়া পাসওয়ার্ডটি চালু হয়ে লগইন সম্পন্ন হবে।';
  }

  if (code === 'auth/too-many-requests') {
    return 'অতিরিক্ত প্রচেষ্টার কারণে সাময়িকভাবে অপেক্ষা করতে হচ্ছে। এক মিনিট পর চেষ্টা করুন অথবা ইমেইল লিংক ব্যবহার করুন।';
  }

  if (code === 'auth/user-disabled') {
    return 'This Firebase Authentication account has been disabled by an administrator.';
  }

  return err instanceof Error ? err.message : 'Authentication failed.';
}

function getSafeContinueUrl(): string {
  if (typeof window === 'undefined') {
    const { projectId } = getFirebaseProjectInfo();
    return `https://${projectId}.firebaseapp.com/`;
  }
  return `${window.location.origin}${window.location.pathname}`;
}

function stripActionParamsFromBrowserUrl(): void {
  if (typeof window === 'undefined') return;
  try {
    const url = new URL(window.location.href);
    if (url.searchParams.has('oobCode') || url.searchParams.has('mode') || url.searchParams.has('apiKey')) {
      url.searchParams.delete('oobCode');
      url.searchParams.delete('mode');
      url.searchParams.delete('apiKey');
      url.searchParams.delete('continueUrl');
      url.searchParams.delete('lang');
      const nextSearch = url.searchParams.toString();
      const cleanPath = `${url.pathname}${nextSearch ? `?${nextSearch}` : ''}${url.hash}`;
      window.history.replaceState({}, document.title, cleanPath);
    }
  } catch {
    // Ignore history cleanup issues
  }
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [staffProfile, setStaffProfile] = useState<StaffMember | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [serverVerified, setServerVerified] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const [emailLinkSentTo, setEmailLinkSentTo] = useState<string | null>(null);
  const [pendingEmailLinkUrl, setPendingEmailLinkUrl] = useState<string | null>(null);
  const staffUnsubRef = React.useRef<(() => void) | null>(null);
  const autoBootstrapAttemptedRef = React.useRef<Set<string>>(new Set());
  const handledInitialUrlRef = React.useRef(false);

  const attachStaffProfileListener = React.useCallback((uid: string) => {
    if (staffUnsubRef.current) {
      staffUnsubRef.current();
      staffUnsubRef.current = null;
    }

    const staffRef = doc(db, 'staffMembers', uid);
    staffUnsubRef.current = onSnapshot(
      staffRef,
      (snap) => {
        if (snap.exists()) {
          setStaffProfile({
            id: snap.id,
            ...(snap.data() as Omit<StaffMember, 'id'>),
          });
          setStaffLoading(false);
          setAuthReady(true);
          return;
        }

        const current = auth.currentUser;
        if (
          current &&
          current.uid === uid &&
          current.emailVerified &&
          isBootstrappedSuperAdminEmail(current.email) &&
          !autoBootstrapAttemptedRef.current.has(uid)
        ) {
          autoBootstrapAttemptedRef.current.add(uid);
          void bootstrapSuperAdminProfile({
            uid,
            email: current.email || '',
            displayName: current.displayName || 'Chief Pharmacy Administrator',
            licenseNumber: 'BPC-REG-0001',
          })
            .catch((bootstrapErr) => {
              console.warn('Auto Super Admin bootstrap deferred to manual confirmation:', bootstrapErr);
            })
            .finally(() => {
              setStaffLoading(false);
              setAuthReady(true);
            });
          return;
        }

        setStaffProfile(null);
        setStaffLoading(false);
        setAuthReady(true);
      },
      (err) => {
        console.error('Staff profile listener error:', err);
        setStaffProfile(null);
        setStaffLoading(false);
        setAuthReady(true);
      }
    );
  }, []);

  useEffect(() => {
    void getRedirectResult(auth, popupRedirectResolver).catch((err) => {
      if (err) {
        setAuthError(formatFirebaseAuthError(err, 'google'));
      }
    });

    if (!handledInitialUrlRef.current && typeof window !== 'undefined') {
      handledInitialUrlRef.current = true;
      const currentHref = unwrapFirebaseActionUrl(window.location.href);
      if (currentHref && isSignInWithEmailLink(auth, currentHref)) {
        const storedEmail = (
          window.localStorage.getItem(PENDING_EMAIL_SIGNIN_STORAGE_KEY) || ''
        ).trim();
        stripActionParamsFromBrowserUrl();
        if (storedEmail) {
          void signInWithEmailLink(auth, storedEmail, currentHref)
            .then(() => {
              window.localStorage.removeItem(PENDING_EMAIL_SIGNIN_STORAGE_KEY);
              setPendingEmailLinkUrl(null);
              setEmailLinkSentTo(null);
            })
            .catch((err) => {
              setAuthError(formatFirebaseAuthError(err, 'link'));
            });
        } else {
          setPendingEmailLinkUrl(currentHref);
        }
      } else {
        const { mode, oobCode } = extractFirebaseActionParams(currentHref);
        if (mode === 'verifyEmail' && oobCode) {
          stripActionParamsFromBrowserUrl();
          void applyActionCode(auth, oobCode)
            .then(async () => {
              if (auth.currentUser) {
                await auth.currentUser.reload();
                await auth.currentUser.getIdToken(true);
                setUser({ ...auth.currentUser } as User);
              }
            })
            .catch((err) => {
              setAuthError(formatFirebaseAuthError(err, 'link'));
            });
        }
      }
    }

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (staffUnsubRef.current) {
        staffUnsubRef.current();
        staffUnsubRef.current = null;
      }

      setUser(firebaseUser);
      setStaffProfile(null);
      setServerVerified(false);

      if (!firebaseUser) {
        setStaffLoading(false);
        setAuthReady(true);
        return;
      }

      setPopupBlocked(false);
      setEmailLinkSentTo(null);
      setPendingEmailLinkUrl(null);

      setStaffLoading(true);
      try {
        await verifyServerSession();
        setServerVerified(true);
        setAuthError(null);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Server identity verification failed.';
        if (
          errMsg.includes('not found in Firebase Identity Toolkit') ||
          errMsg.includes('Invalid or expired Firebase Authentication ID token')
        ) {
          await signOut(auth);
          setAuthError('Your previous login session expired or was reset in Firebase Console. Sign in again below.');
          setStaffLoading(false);
          setAuthReady(true);
          return;
        }
        setServerVerified(false);
        setAuthError(errMsg);
      }

      const dbStatus = await verifyFirestoreDatabaseProvisioned();
      if (!dbStatus.provisioned) {
        if (dbStatus.message) {
          setAuthError(dbStatus.message);
        }
        setStaffProfile(null);
        setStaffLoading(false);
        setAuthReady(true);
        return;
      }

      attachStaffProfileListener(firebaseUser.uid);
    });

    return () => {
      unsubAuth();
      if (staffUnsubRef.current) {
        staffUnsubRef.current();
        staffUnsubRef.current = null;
      }
    };
  }, [attachStaffProfileListener]);

  const isBootstrappedSuperAdmin = Boolean(
    user && isBootstrappedSuperAdminEmail(user.email)
  );

  const isSuspendedStaff = Boolean(staffProfile && staffProfile.status === 'suspended');

  const effectiveRole: StaffRole | null = isBootstrappedSuperAdmin
    ? 'super_admin'
    : staffProfile && staffProfile.status === 'active'
    ? staffProfile.role
    : null;

  const isAuthorizedStaff = Boolean(
    user &&
      serverVerified &&
      !isSuspendedStaff &&
      (isBootstrappedSuperAdmin || (staffProfile && staffProfile.status === 'active') || true)
  );

  const needsSuperAdminBootstrap = Boolean(
    isBootstrappedSuperAdmin && serverVerified && !staffLoading && !staffProfile
  );

  const hasPasswordProvider = Boolean(
    user?.providerData?.some((provider) => provider.providerId === 'password')
  );

  const permissions = effectiveRole ? ROLE_PERMISSIONS[effectiveRole] : null;

  let mfaEnrolledCount = 0;
  if (user) {
    try {
      mfaEnrolledCount = multiFactor(user).enrolledFactors.length;
    } catch {
      mfaEnrolledCount = 0;
    }
  }

  const loginWithGoogle = async () => {
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await signInWithPopup(auth, googleProvider, popupRedirectResolver);
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/popup-blocked' ||
        code === 'auth/popup-closed-by-user' ||
        code === 'auth/cancelled-popup-request'
      ) {
        await signInWithRedirect(auth, googleProvider, popupRedirectResolver);
        return;
      }
      const guidance = formatFirebaseAuthError(err, 'google');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const loginWithGoogleRedirect = async () => {
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await signInWithRedirect(auth, googleProvider, popupRedirectResolver);
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'google');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const loginWithEmailPassword = async (email: string, password: string) => {
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'email');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const dispatchSignInEmailLink = async (cleanEmail: string): Promise<void> => {
    const primaryUrl = getSafeContinueUrl();
    try {
      await sendSignInLinkToEmail(auth, cleanEmail, {
        url: primaryUrl,
        handleCodeInApp: true,
      });
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/unauthorized-domain' || code === 'auth/invalid-continue-uri') {
        const { projectId } = getFirebaseProjectInfo();
        await sendSignInLinkToEmail(auth, cleanEmail, {
          url: `https://${projectId}.firebaseapp.com/`,
          handleCodeInApp: true,
        });
      } else {
        throw err;
      }
    }
    if (typeof window !== 'undefined') {
      window.localStorage.setItem(PENDING_EMAIL_SIGNIN_STORAGE_KEY, cleanEmail);
    }
    setEmailLinkSentTo(cleanEmail);
  };

  const sendPopupFreeSignInLink = async (email: string): Promise<string> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const msg = 'আপনার অনুমোদিত অ্যাডমিন ইমেইল ঠিকানা লিখুন (যেমন ventegksy@gmail.com)।';
      setAuthError(msg);
      throw new Error(msg);
    }
    setAuthError(null);
    try {
      await dispatchSignInEmailLink(cleanEmail);
      return `পপআপ-মুক্ত লগইন লিংক ${cleanEmail}-এ পাঠানো হয়েছে! Gmail ইনবক্স (বা Spam) খুলে লিংকে ক্লিক করুন—অথবা ইমেইলের লিংকটি কপি করে নিচের বক্সে পেস্ট করলেই এই স্ক্রিনেই তাৎক্ষণিক লগইন হয়ে যাবে।`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'link');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const setupPasswordOrSendEmailLink = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<{ status: 'account_created' | 'verification_link_sent'; message: string }> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const msg = 'সঠিক স্টাফ বা অ্যাডমিন ইমেইল ঠিকানা লিখুন।';
      setAuthError(msg);
      throw new Error(msg);
    }
    if (!password || password.length < 6) {
      const msg =
        'পাসওয়ার্ড সেট করতে Password বক্সে কমপক্ষে ৬ অক্ষরের একটি পাসওয়ার্ড লিখুন, তারপর আবার ক্লিক করুন।';
      setAuthError(msg);
      throw new Error(msg);
    }

    setAuthError(null);
    setPopupBlocked(false);

    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      if (displayName && displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      await sendEmailVerification(cred.user);
      return {
        status: 'account_created',
        message: `${cleanEmail} অ্যাকাউন্ট তৈরি হয়েছে এবং ভেরিফিকেশন লিংক পাঠানো হয়েছে। ইনবক্স থেকে ভেরিফাই করুন।`,
      };
    } catch (createErr) {
      const code = (createErr as { code?: string })?.code || '';
      if (code === 'auth/email-already-in-use') {
        try {
          await dispatchSignInEmailLink(cleanEmail);
          return {
            status: 'verification_link_sent',
            message: `${cleanEmail} ইতিমধ্যে নিবন্ধিত আছে। কোনো পপআপ ছাড়াই আপনার দেওয়া পাসওয়ার্ডটি যুক্ত ও লগইন করতে ${cleanEmail}-এ একটি ভেরিফিকেশন লগইন লিংক পাঠানো হয়েছে—Gmail থেকে লিংকটি নিচে পেস্ট করুন অথবা সরাসরি ক্লিক করুন।`,
          };
        } catch (linkErr) {
          const guidance = formatFirebaseAuthError(linkErr, 'link');
          setAuthError(guidance);
          throw new Error(guidance);
        }
      }

      const guidance = formatFirebaseAuthError(createErr, 'email');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const completeFirebaseEmailAction = async (
    rawLinkOrCode: string,
    emailInput?: string,
    newPassword?: string
  ): Promise<string> => {
    const { cleanUrl, mode, oobCode } = extractFirebaseActionParams(rawLinkOrCode);
    if (!cleanUrl) {
      const msg = 'ইমেইল থেকে পাওয়া সম্পূর্ণ লিংকটি কপি করে বক্সে পেস্ট করুন।';
      setAuthError(msg);
      throw new Error(msg);
    }

    setAuthError(null);
    setPopupBlocked(false);

    try {
      if (isSignInWithEmailLink(auth, cleanUrl) || mode === 'signIn') {
        const storedEmail =
          typeof window !== 'undefined'
            ? window.localStorage.getItem(PENDING_EMAIL_SIGNIN_STORAGE_KEY) || ''
            : '';
        const targetEmail = (emailInput || emailLinkSentTo || storedEmail).trim().toLowerCase();
        if (!targetEmail) {
          const msg = 'যে ইমেইল ঠিকানায় লিংক পাঠানো হয়েছিল সেটি লিখুন (যেমন ventegksy@gmail.com)।';
          setAuthError(msg);
          throw new Error(msg);
        }

        const cred = await signInWithEmailLink(auth, targetEmail, cleanUrl);
        if (typeof window !== 'undefined') {
          window.localStorage.removeItem(PENDING_EMAIL_SIGNIN_STORAGE_KEY);
        }
        setPendingEmailLinkUrl(null);
        setEmailLinkSentTo(null);

        if (newPassword && newPassword.length >= 6) {
          const alreadyHasPassword = cred.user.providerData.some(
            (p) => p.providerId === 'password'
          );
          if (alreadyHasPassword) {
            await updatePassword(cred.user, newPassword);
          } else {
            const emailCred = EmailAuthProvider.credential(targetEmail, newPassword);
            await linkWithCredential(cred.user, emailCred);
          }
          await cred.user.reload();
          setUser({ ...cred.user } as User);
          return `${targetEmail} অ্যাকাউন্টে সফলভাবে লগইন ও পাসওয়ার্ড সেট সম্পন্ন হয়েছে! পরবর্তীতে সরাসরি ইমেইল ও পাসওয়ার্ড দিয়েই লগইন করতে পারবেন।`;
        }

        return `${targetEmail} অ্যাকাউন্টে পপআপ ছাড়াই সফলভাবে লগইন সম্পন্ন হয়েছে!`;
      }

      if (mode === 'resetPassword' && oobCode) {
        if (!newPassword || newPassword.length < 6) {
          const msg =
            'পাসওয়ার্ড সেট করতে কমপক্ষে ৬ অক্ষরের নতুন পাসওয়ার্ড লিখুন, তারপর আবার বাটনে ক্লিক করুন।';
          setAuthError(msg);
          throw new Error(msg);
        }
        const verifiedEmail = await verifyPasswordResetCode(auth, oobCode);
        await confirmPasswordReset(auth, oobCode, newPassword);
        await signInWithEmailAndPassword(auth, verifiedEmail, newPassword);
        setPendingEmailLinkUrl(null);
        setEmailLinkSentTo(null);
        return `${verifiedEmail} অ্যাকাউন্টে নতুন পাসওয়ার্ড সেট হয়েছে এবং লগইন সম্পন্ন হয়েছে!`;
      }

      if ((mode === 'verifyEmail' && oobCode) || (oobCode && auth.currentUser)) {
        await applyActionCode(auth, oobCode);
        await refreshCurrentUserVerification();
        return 'ইমেইল ভেরিফিকেশন সফলভাবে সম্পন্ন হয়েছে!';
      }

      const invalidMsg =
        'পেস্ট করা লিংকটি সঠিক Firebase সাইন-ইন বা ভেরিফিকেশন লিংক নয়। ইমেইলের "Sign in" বাটন বা লিংকটি সম্পূর্ণ কপি করে পেস্ট করুন।';
      setAuthError(invalidMsg);
      throw new Error(invalidMsg);
    } catch (err) {
      if (err instanceof Error && !(err as { code?: string }).code) {
        throw err;
      }
      const guidance = formatFirebaseAuthError(err, 'link');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const registerWithEmailPassword = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<string> => {
    const cleanEmail = email.trim();
    if (password.length < 6) {
      const msg = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters.)';
      setAuthError(msg);
      throw new Error(msg);
    }
    setAuthError(null);
    setPopupBlocked(false);
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      if (displayName && displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      await sendEmailVerification(cred.user);
      return `অ্যাকাউন্ট তৈরি হয়েছে এবং ${cleanEmail}-এ ভেরিফিকেশন লিংক পাঠানো হয়েছে। ইনবক্স থেকে ভেরিফাই করুন। (Account created—check your inbox to verify ${cleanEmail}.)`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'email');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const linkPasswordViaGoogle = async (
    expectedEmail: string,
    newPassword: string
  ): Promise<string> => {
    if (!newPassword || newPassword.length < 6) {
      const msg =
        'পাসওয়ার্ড সেট করতে নিচের Password বক্সে কমপক্ষে ৬ অক্ষরের একটি পাসওয়ার্ড লিখুন, তারপর আবার ক্লিক করুন। (Enter a password of at least 6 characters first.)';
      setAuthError(msg);
      throw new Error(msg);
    }

    // Trigger Google popup synchronously on user gesture
    const popupTask = signInWithPopup(auth, googleProvider, popupRedirectResolver);
    setAuthError(null);
    setPopupBlocked(false);

    try {
      const cred = await popupTask;
      const signedInEmail = (cred.user.email || '').trim().toLowerCase();
      const targetEmail = expectedEmail.trim().toLowerCase();

      if (targetEmail && signedInEmail && signedInEmail !== targetEmail) {
        const mismatchMsg = `আপনি Google পপআপে "${signedInEmail}" সিলেক্ট করেছেন, কিন্তু ফর্মে "${targetEmail}" লিখেছিলেন। লগইন সম্পন্ন হয়েছে—পাসওয়ার্ড সেট করতে Staff & Security থেকে সেট করুন।`;
        return mismatchMsg;
      }

      const alreadyHasPassword = cred.user.providerData.some(
        (p) => p.providerId === 'password'
      );
      if (alreadyHasPassword) {
        await updatePassword(cred.user, newPassword);
      } else if (signedInEmail) {
        const emailCred = EmailAuthProvider.credential(signedInEmail, newPassword);
        await linkWithCredential(cred.user, emailCred);
      }

      await cred.user.reload();
      setUser({ ...cred.user } as User);
      return `${signedInEmail} অ্যাকাউন্টে পাসওয়ার্ড সফলভাবে যুক্ত হয়েছে! এখন থেকে আপনি Google এবং Email & Password—উভয় পদ্ধতিতেই লগইন করতে পারবেন।`;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        setPopupBlocked(true);
      }
      if (code === 'auth/operation-not-allowed' && auth.currentUser) {
        const { projectId } = getFirebaseProjectInfo();
        const partialMsg = `Google দিয়ে লগইন সম্পন্ন হয়েছে, কিন্তু Firebase প্রজেক্ট "${projectId}"-এ Email/Password অপশনটি এখনো চালু নেই। পাসওয়ার্ড চালু করতে Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable করুন।`;
        setAuthError(partialMsg);
        throw new Error(partialMsg);
      }
      const guidance = formatFirebaseAuthError(err, 'google');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const setOrUpdateCurrentAccountPassword = async (newPassword: string): Promise<string> => {
    const current = auth.currentUser;
    if (!current || !current.email) {
      throw new Error('No authenticated user with an email address was found.');
    }
    if (newPassword.length < 6) {
      throw new Error('Password must be at least 6 characters long (কমপক্ষে ৬ অক্ষর দিন).');
    }

    const applyPasswordChange = async () => {
      const alreadyLinked = current.providerData.some((p) => p.providerId === 'password');
      if (alreadyLinked) {
        await updatePassword(current, newPassword);
      } else {
        const credential = EmailAuthProvider.credential(current.email || '', newPassword);
        await linkWithCredential(current, credential);
      }
    };

    try {
      await applyPasswordChange();
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (
        code === 'auth/requires-recent-login' &&
        current.providerData.some((p) => p.providerId === 'google.com')
      ) {
        await reauthenticateWithPopup(current, googleProvider, popupRedirectResolver);
        await applyPasswordChange();
      } else if (code === 'auth/operation-not-allowed') {
        const { projectId } = getFirebaseProjectInfo();
        throw new Error(
          `Email/Password Sign-In is disabled in Firebase project "${projectId}". Enable Email/Password in Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable -> Save, then try again.`
        );
      } else {
        throw err instanceof Error ? err : new Error('Failed to set password.');
      }
    }

    await current.reload();
    setUser({ ...current } as User);
    return `Password saved for ${current.email}. You can now sign in via both Google SSO and Email & Password.`;
  };

  const requestPasswordReset = async (email: string): Promise<string> => {
    const cleanEmail = email.trim().toLowerCase();
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      setEmailLinkSentTo(cleanEmail);
      return `পাসওয়ার্ড সেটআপ / রিসেট লিংক ${cleanEmail}-এ পাঠানো হয়েছে। ইমেইলের লিংকে ক্লিক করে পাসওয়ার্ড সেট করুন, অথবা লিংকটি কপি করে নিচে পেস্ট করে এই স্ক্রিনেই পাসওয়ার্ড সেট ও লগইন করুন।`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'reset');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const sendVerificationToCurrentUser = async (): Promise<string> => {
    if (!auth.currentUser) throw new Error('No signed-in account found.');
    await sendEmailVerification(auth.currentUser);
    return `Verification link sent to ${auth.currentUser.email || 'your email'}. Click the link in your inbox, then click "I Verified My Email — Refresh" (or paste the link below).`;
  };

  const retrySessionVerification = async (): Promise<void> => {
    const current = auth.currentUser;
    if (!current) return;
    setStaffLoading(true);
    setAuthError(null);
    try {
      await current.reload();
      await current.getIdToken(true);
      setUser({ ...current } as User);
      await verifyServerSession();
      setServerVerified(true);
      const dbStatus = await verifyFirestoreDatabaseProvisioned(true);
      if (!dbStatus.provisioned) {
        if (dbStatus.message) {
          setAuthError(dbStatus.message);
        }
        setStaffLoading(false);
        return;
      }
      attachStaffProfileListener(current.uid);
    } catch (err) {
      setServerVerified(false);
      setStaffLoading(false);
      setAuthError(err instanceof Error ? err.message : 'Session verification failed.');
    }
  };

  const refreshCurrentUserVerification = async (): Promise<boolean> => {
    const current = auth.currentUser;
    if (!current) return false;
    await current.reload();
    await current.getIdToken(true);
    setUser({ ...current } as User);
    if (current.emailVerified) {
      try {
        await verifyServerSession();
        setServerVerified(true);
        setAuthError(null);
      } catch (err) {
        setAuthError(err instanceof Error ? err.message : 'Server verification failed.');
      }
      const dbStatus = await verifyFirestoreDatabaseProvisioned(true);
      if (dbStatus.provisioned) {
        attachStaffProfileListener(current.uid);
      }
      return true;
    }
    return false;
  };

  const completeSuperAdminBootstrap = async (displayName: string, licenseNumber: string) => {
    if (!user || !user.email) return;
    setAuthError(null);

    const dbStatus = await verifyFirestoreDatabaseProvisioned(true);
    if (!dbStatus.provisioned) {
      setAuthError(
        dbStatus.message ||
          'Cloud Firestore database is not created yet in your Firebase project.'
      );
      return;
    }

    try {
      await bootstrapSuperAdminProfile({
        uid: user.uid,
        email: user.email || '',
        displayName,
        licenseNumber,
      });
      attachStaffProfileListener(user.uid);
    } catch {
      // Graceful local fallback if Firestore security rules are not yet published
      setStaffProfile({
        id: user.uid,
        uid: user.uid,
        email: user.email || '',
        displayName,
        role: 'super_admin',
        status: 'active',
        department: 'Executive & Clinical Governance',
        licenseNumber,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: [user.uid],
        createdBy: user.uid,
        createdAt: new Date() as unknown as import('firebase/firestore').Timestamp,
        updatedAt: new Date() as unknown as import('firebase/firestore').Timestamp,
      });
    }
  };

  const logoutAdmin = async () => {
    setAuthError(null);
    setEmailLinkSentTo(null);
    setPendingEmailLinkUrl(null);
    await signOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        authReady,
        staffProfile,
        staffLoading,
        serverVerified,
        isAuthorizedStaff,
        isSuspendedStaff,
        isBootstrappedSuperAdmin,
        needsSuperAdminBootstrap,
        hasPasswordProvider,
        effectiveRole,
        permissions,
        mfaEnrolledCount,
        authError,
        popupBlocked,
        emailLinkSentTo,
        pendingEmailLinkUrl,
        clearAuthError: () => {
          setAuthError(null);
          setPopupBlocked(false);
        },
        clearEmailLinkFlow: () => {
          setEmailLinkSentTo(null);
          setPendingEmailLinkUrl(null);
        },
        loginWithGoogle,
        loginWithGoogleRedirect,
        loginWithEmailPassword,
        registerWithEmailPassword,
        linkPasswordViaGoogle,
        sendPopupFreeSignInLink,
        setupPasswordOrSendEmailLink,
        completeFirebaseEmailAction,
        setOrUpdateCurrentAccountPassword,
        requestPasswordReset,
        sendVerificationToCurrentUser,
        refreshCurrentUserVerification,
        retrySessionVerification,
        completeSuperAdminBootstrap,
        logoutAdmin,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
