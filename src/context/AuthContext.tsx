import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  applyActionCode,
  confirmPasswordReset,
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  linkWithCredential,
  multiFactor,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
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
  isBootstrappedSuperAdminEmail,
  SHARED_STORE_ID,
  verifyFirestoreDatabaseProvisioned,
} from '../lib/firebase';
import { bootstrapSuperAdminProfile, verifyServerSession } from '../services/pharmacyService';
import { ROLE_PERMISSIONS, type RolePermissions, type StaffMember, type StaffRole } from '../types/pharmacy';

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
  pendingResetActionUrl: string | null;
  clearAuthError: () => void;
  clearPendingResetAction: () => void;
  loginWithEmailPassword: (email: string, password: string) => Promise<void>;
  registerWithEmailPassword: (email: string, password: string, displayName?: string) => Promise<string>;
  completeFirebaseEmailAction: (
    rawLinkOrCode: string,
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
    const tokenOnly = cleanUrl.replace(/\s+/g, '');
    return {
      cleanUrl: tokenOnly,
      mode: '',
      oobCode: /^[A-Za-z0-9_-]{20,}$/.test(tokenOnly) ? tokenOnly : '',
    };
  }
}

function formatFirebaseAuthError(err: unknown): string {
  const code = (err as { code?: string })?.code || '';
  const { projectId } = getFirebaseProjectInfo();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain') {
    return `Domain "${host}" is not authorized in Firebase project "${projectId}". Open Firebase Console -> Authentication -> Settings -> Authorized domains -> Add domain "${host}".`;
  }

  if (code === 'auth/operation-not-allowed') {
    return `Email/Password Sign-In is disabled in Firebase project "${projectId}". Enable Email/Password in Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable -> Save.`;
  }

  if (code === 'auth/email-already-in-use') {
    return 'এই ইমেইল দিয়ে ইতিমধ্যে একটি অ্যাকাউন্ট রয়েছে। অনুগ্রহ করে "লগইন করুন" ট্যাব থেকে পাসওয়ার্ড দিয়ে সাইন ইন করুন, অথবা পাসওয়ার্ড ভুলে গেলে "পাসওয়ার্ড ভুলে গেছেন?" অপশন ব্যবহার করুন।';
  }

  if (code === 'auth/weak-password') {
    return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters long.)';
  }

  if (code === 'auth/invalid-action-code' || code === 'auth/expired-action-code') {
    return 'এই ভেরিফিকেশন বা পাসওয়ার্ড রিসেট লিংকটি ইতিমধ্যে ব্যবহৃত হয়েছে অথবা মেয়াদ শেষ হয়েছে। অনুগ্রহ করে নতুন লিংক পাঠিয়ে সর্বশেষ ইমেইলের লিংকটি ব্যবহার করুন।';
  }

  if (code === 'auth/invalid-email') {
    return 'সঠিক ইমেইল ঠিকানা লিখুন। (Please enter a valid email address.)';
  }

  if (
    code === 'auth/invalid-credential' ||
    code === 'auth/wrong-password' ||
    code === 'auth/user-not-found' ||
    code === 'auth/invalid-login-credentials'
  ) {
    return 'ইমেইল বা পাসওয়ার্ড সঠিক নয়। নতুন অ্যাকাউন্ট তৈরি করতে "নতুন সাইনআপ / রেজিস্ট্রেশন" ট্যাবে যান, অথবা পাসওয়ার্ড রিসেট করতে "পাসওয়ার্ড ভুলে গেছেন?" ক্লিক করুন।';
  }

  if (code === 'auth/too-many-requests') {
    return 'অতিরিক্ত প্রচেষ্টার কারণে সাময়িকভাবে অপেক্ষা করতে হচ্ছে। অনুগ্রহ করে কিছুক্ষণ পর আবার চেষ্টা করুন।';
  }

  if (code === 'auth/user-disabled') {
    return 'This Firebase Authentication account has been disabled by an administrator.';
  }

  return err instanceof Error ? err.message : 'Authentication failed.';
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
  const [pendingResetActionUrl, setPendingResetActionUrl] = useState<string | null>(null);
  const staffUnsubRef = React.useRef<(() => void) | null>(null);
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
        if (current && current.uid === uid && isBootstrappedSuperAdminEmail(current.email)) {
          setStaffProfile({
            id: uid,
            uid: uid,
            email: current.email || '',
            displayName: current.displayName || 'Chief Pharmacy Administrator',
            role: 'super_admin',
            status: 'active',
            department: 'Executive & Clinical Governance',
            licenseNumber: 'BPC-REG-0001',
            storeId: SHARED_STORE_ID,
            authorizedStaffUids: [uid],
            createdBy: uid,
            createdAt: new Date() as unknown as import('firebase/firestore').Timestamp,
            updatedAt: new Date() as unknown as import('firebase/firestore').Timestamp,
          });
          setStaffLoading(false);
          setAuthReady(true);
          return;
        }

        setStaffProfile(null);
        setStaffLoading(false);
        setAuthReady(true);
      },
      (err) => {
        console.error('Staff profile listener error:', err);
        const current = auth.currentUser;
        if (current && current.uid === uid && isBootstrappedSuperAdminEmail(current.email)) {
          setStaffProfile({
            id: uid,
            uid: uid,
            email: current.email || '',
            displayName: current.displayName || 'Chief Pharmacy Administrator',
            role: 'super_admin',
            status: 'active',
            department: 'Executive & Clinical Governance',
            licenseNumber: 'BPC-REG-0001',
            storeId: SHARED_STORE_ID,
            authorizedStaffUids: [uid],
            createdBy: uid,
            createdAt: new Date() as unknown as import('firebase/firestore').Timestamp,
            updatedAt: new Date() as unknown as import('firebase/firestore').Timestamp,
          });
        } else {
          setStaffProfile(null);
        }
        setStaffLoading(false);
        setAuthReady(true);
      }
    );
  }, []);

  useEffect(() => {
    if (!handledInitialUrlRef.current && typeof window !== 'undefined') {
      handledInitialUrlRef.current = true;
      const currentHref = unwrapFirebaseActionUrl(window.location.href);
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
            setAuthError(formatFirebaseAuthError(err));
          });
      } else if (mode === 'resetPassword' && oobCode) {
        stripActionParamsFromBrowserUrl();
        setPendingResetActionUrl(currentHref);
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

      setPendingResetActionUrl(null);
      setStaffLoading(true);
      try {
        await verifyServerSession();
        setServerVerified(true);
        setAuthError(null);
      } catch (err) {
        const errMsg = err instanceof Error ? err.message : 'Server identity verification failed.';
        console.error('Server session verification failed:', errMsg);
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

  const loginWithEmailPassword = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      const guidance = formatFirebaseAuthError(err);
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const registerWithEmailPassword = async (
    email: string,
    password: string,
    displayName?: string
  ): Promise<string> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const msg = 'সঠিক ইমেইল ঠিকানা লিখুন। (Please enter a valid email address.)';
      setAuthError(msg);
      throw new Error(msg);
    }
    if (password.length < 6) {
      const msg = 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters.)';
      setAuthError(msg);
      throw new Error(msg);
    }
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, cleanEmail, password);
      if (displayName && displayName.trim()) {
        await updateProfile(cred.user, { displayName: displayName.trim() });
      }
      await sendEmailVerification(cred.user);
      return `অ্যাকাউন্ট তৈরি হয়েছে এবং ${cleanEmail}-এ ভেরিফিকেশন লিংক পাঠানো হয়েছে। ইনবক্স থেকে ভেরিফাই করুন।`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err);
      setAuthError(guidance);
      throw new Error(guidance);
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

  const completeFirebaseEmailAction = async (
    rawLinkOrCode: string,
    newPassword?: string
  ): Promise<string> => {
    const { cleanUrl, mode, oobCode } = extractFirebaseActionParams(rawLinkOrCode);
    if (!cleanUrl) {
      const msg = 'ইমেইল থেকে পাওয়া সম্পূর্ণ ভেরিফিকেশন বা রিসেট লিংকটি কপি করে বক্সে পেস্ট করুন।';
      setAuthError(msg);
      throw new Error(msg);
    }

    setAuthError(null);

    try {
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
        setPendingResetActionUrl(null);
        return `${verifiedEmail} অ্যাকাউন্টে নতুন পাসওয়ার্ড সেট হয়েছে এবং লগইন সম্পন্ন হয়েছে!`;
      }

      if ((mode === 'verifyEmail' && oobCode) || (oobCode && auth.currentUser)) {
        await applyActionCode(auth, oobCode);
        await refreshCurrentUserVerification();
        return 'ইমেইল ভেরিফিকেশন সফলভাবে সম্পন্ন হয়েছে!';
      }

      const invalidMsg =
        'পেস্ট করা লিংকটি সঠিক ভেরিফিকেশন বা পাসওয়ার্ড রিসেট লিংক নয়। ইমেইলের লিংকটি সম্পূর্ণ কপি করে পেস্ট করুন।';
      setAuthError(invalidMsg);
      throw new Error(invalidMsg);
    } catch (err) {
      if (err instanceof Error && !(err as { code?: string }).code) {
        throw err;
      }
      const guidance = formatFirebaseAuthError(err);
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
      if (code === 'auth/operation-not-allowed') {
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
    return `Password saved for ${current.email}.`;
  };

  const requestPasswordReset = async (email: string): Promise<string> => {
    const cleanEmail = email.trim().toLowerCase();
    if (!cleanEmail || !cleanEmail.includes('@')) {
      const msg = 'সঠিক ইমেইল ঠিকানা লিখুন। (Please enter a valid email address.)';
      setAuthError(msg);
      throw new Error(msg);
    }
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, cleanEmail);
      return `পাসওয়ার্ড রিসেট লিংক ${cleanEmail}-এ পাঠানো হয়েছে। ইমেইলের লিংকে ক্লিক করে নতুন পাসওয়ার্ড সেট করুন, অথবা লিংকটি কপি করে নিচে পেস্ট করুন।`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err);
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const sendVerificationToCurrentUser = async (): Promise<string> => {
    if (!auth.currentUser) throw new Error('No signed-in account found.');
    await sendEmailVerification(auth.currentUser);
    return `ভেরিফিকেশন লিংক ${auth.currentUser.email || 'আপনার ইমেইলে'} পাঠানো হয়েছে। ইনবক্স বা Spam খুলে লিংকে ক্লিক করুন এবং নিচে "I Verified My Email — Refresh" চাপুন।`;
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
    setPendingResetActionUrl(null);
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
        pendingResetActionUrl,
        clearAuthError: () => setAuthError(null),
        clearPendingResetAction: () => setPendingResetActionUrl(null),
        loginWithEmailPassword,
        registerWithEmailPassword,
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
