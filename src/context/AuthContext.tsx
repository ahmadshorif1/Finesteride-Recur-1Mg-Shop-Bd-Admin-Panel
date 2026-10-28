import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  EmailAuthProvider,
  getRedirectResult,
  linkWithCredential,
  multiFactor,
  onAuthStateChanged,
  reauthenticateWithPopup,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signInWithRedirect,
  signOut,
  updatePassword,
  updateProfile,
  type User,
} from 'firebase/auth';
import { doc, onSnapshot } from 'firebase/firestore';
import {
  auth,
  db,
  getFirebaseProjectInfo,
  googleProvider,
  isBootstrappedSuperAdminEmail,
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
  popupBlocked: boolean;
  clearAuthError: () => void;
  loginWithGoogle: () => Promise<void>;
  loginWithGoogleRedirect: () => Promise<void>;
  loginWithEmailPassword: (email: string, password: string) => Promise<void>;
  registerWithEmailPassword: (email: string, password: string, displayName?: string) => Promise<string>;
  linkPasswordViaGoogle: (expectedEmail: string, newPassword: string) => Promise<string>;
  setOrUpdateCurrentAccountPassword: (newPassword: string) => Promise<string>;
  requestPasswordReset: (email: string) => Promise<string>;
  sendVerificationToCurrentUser: () => Promise<string>;
  refreshCurrentUserVerification: () => Promise<boolean>;
  retrySessionVerification: () => Promise<void>;
  completeSuperAdminBootstrap: (displayName: string, licenseNumber: string) => Promise<void>;
  logoutAdmin: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function formatFirebaseAuthError(err: unknown, mode: 'google' | 'email' | 'reset'): string {
  const code = (err as { code?: string })?.code || '';
  const { projectId } = getFirebaseProjectInfo();
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain') {
    return `Domain "${host}" is not authorized in Firebase project "${projectId}". Open Firebase Console -> Authentication -> Settings -> Authorized domains -> Add domain "${host}".`;
  }

  if (code === 'auth/popup-closed-by-user' || code === 'auth/cancelled-popup-request') {
    return 'Google Sign-In popup was closed before completing authentication. Click "Sign In with Verified Google Account" and select your account.';
  }

  if (code === 'auth/popup-blocked') {
    return 'Your browser blocked the Google Sign-In popup. Click "Continue Without Popup (Redirect)" below, allow popups in your address bar, or sign in via the "Email & Password" tab.';
  }

  if (code === 'auth/operation-not-allowed') {
    if (mode === 'google') {
      return `Google Sign-In is disabled in Firebase project "${projectId}". Open Firebase Console -> Authentication -> Sign-in method -> Google -> Enable -> select Support email -> Save.`;
    }
    return `Email/Password Sign-In is disabled in Firebase project "${projectId}". Enable Email/Password in Firebase Console -> Authentication -> Sign-in method -> Email/Password -> Enable -> Save, or sign in via the "Google Workspace / SSO" tab.`;
  }

  if (code === 'auth/email-already-in-use') {
    return 'এই ইমেইলটি ইতিমধ্যে নিবন্ধিত আছে (যেমন Google Sign-In এর মাধ্যমে)। নিচে "Google দিয়ে যাচাই করে এই পাসওয়ার্ড সেট করুন" বাটনে ক্লিক করলে এই পাসওয়ার্ডটি আপনার অ্যাকাউন্টে যুক্ত হয়ে যাবে। (This email already exists in Firebase Auth—click "Verify via Google & Save Password" below to attach this password to your Google account.)';
  }

  if (code === 'auth/weak-password') {
    return 'পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters long.)';
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
    return 'ইমেইল বা পাসওয়ার্ড মেলেনি (auth/invalid-credential)। Gmail অ্যাকাউন্টে ডিফল্টভাবে আলাদা Firebase পাসওয়ার্ড থাকে না—নিচে "Google দিয়ে যাচাই করে এই পাসওয়ার্ড সেট করুন" ক্লিক করে পাসওয়ার্ড যুক্ত করুন, অথবা সরাসরি "Google Workspace / SSO" দিয়ে লগইন করুন।';
  }

  if (code === 'auth/too-many-requests') {
    return 'Too many unsuccessful login attempts. Wait a minute or sign in via the "Google Workspace / SSO" tab.';
  }

  if (code === 'auth/user-disabled') {
    return 'This Firebase Authentication account has been disabled by an administrator.';
  }

  return err instanceof Error ? err.message : 'Authentication failed.';
}

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [staffProfile, setStaffProfile] = useState<StaffMember | null>(null);
  const [staffLoading, setStaffLoading] = useState(false);
  const [serverVerified, setServerVerified] = useState(false);
  const [authError, setAuthError] = useState<string | null>(null);
  const [popupBlocked, setPopupBlocked] = useState(false);
  const staffUnsubRef = React.useRef<(() => void) | null>(null);
  const autoBootstrapAttemptedRef = React.useRef<Set<string>>(new Set());

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
    void getRedirectResult(auth).catch((err) => {
      if (err) {
        setAuthError(formatFirebaseAuthError(err, 'google'));
      }
    });

    const unsubAuth = onAuthStateChanged(auth, async (firebaseUser) => {
      if (staffUnsubRef.current) {
        staffUnsubRef.current();
        staffUnsubRef.current = null;
      }

      setUser(firebaseUser);
      setStaffProfile(null);
      setServerVerified(false);

      if (!firebaseUser) {
        setAuthError(null);
        setStaffLoading(false);
        setAuthReady(true);
        return;
      }

      if (!firebaseUser.emailVerified) {
        setAuthError(null);
        setStaffLoading(false);
        setAuthReady(true);
        return;
      }

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
    user && user.emailVerified && isBootstrappedSuperAdminEmail(user.email)
  );

  const isSuspendedStaff = Boolean(staffProfile && staffProfile.status === 'suspended');

  const effectiveRole: StaffRole | null = isBootstrappedSuperAdmin
    ? 'super_admin'
    : staffProfile && staffProfile.status === 'active'
    ? staffProfile.role
    : null;

  const isAuthorizedStaff = Boolean(
    user &&
      user.emailVerified &&
      serverVerified &&
      !isSuspendedStaff &&
      (isBootstrappedSuperAdmin || (staffProfile && staffProfile.status === 'active'))
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
    // Initiate popup synchronously on user gesture before React state updates
    const popupTask = signInWithPopup(auth, googleProvider);
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await popupTask;
    } catch (err) {
      const code = (err as { code?: string })?.code || '';
      if (code === 'auth/popup-blocked') {
        setPopupBlocked(true);
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
      await signInWithRedirect(auth, googleProvider);
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
    const popupTask = signInWithPopup(auth, googleProvider);
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
        await reauthenticateWithPopup(current, googleProvider);
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
    setAuthError(null);
    setPopupBlocked(false);
    try {
      await sendPasswordResetEmail(auth, email.trim());
      return `পাসওয়ার্ড সেটআপ / রিসেট লিংক ${email.trim()}-এ পাঠানো হয়েছে। আপনার ইমেইলের Inbox বা Spam ফোল্ডার চেক করে পাসওয়ার্ড সেট করুন।`;
    } catch (err) {
      const guidance = formatFirebaseAuthError(err, 'reset');
      setAuthError(guidance);
      throw new Error(guidance);
    }
  };

  const sendVerificationToCurrentUser = async (): Promise<string> => {
    if (!auth.currentUser) throw new Error('No signed-in account found.');
    await sendEmailVerification(auth.currentUser);
    return `Verification link sent to ${auth.currentUser.email || 'your email'}. Click the link in your inbox, then click "I Verified My Email — Refresh".`;
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
        email: user.email,
        displayName,
        licenseNumber,
      });
      attachStaffProfileListener(user.uid);
    } catch (err) {
      const rawMsg = err instanceof Error ? err.message : String(err);
      const { projectId, databaseId } = getFirebaseProjectInfo();
      if (rawMsg.includes('Missing or insufficient permissions') || rawMsg.includes('PERMISSION_DENIED')) {
        setAuthError(
          `Firestore Security Rules in project "${projectId}" blocked profile creation. Open Firebase Console -> Firestore Database -> Rules, paste the project's firestore.rules content (click "Copy firestore.rules" below), click Publish, and try again.`
        );
      } else if (
        rawMsg.includes('not found') ||
        rawMsg.includes('NOT_FOUND') ||
        rawMsg.includes('client is offline')
      ) {
        setAuthError(
          `Cloud Firestore database "${databaseId}" is not reachable in project "${projectId}". Open Firebase Console -> Build -> Firestore Database -> Create database (Standard/Default), publish firestore.rules, and try again.`
        );
      } else {
        setAuthError(rawMsg);
      }
    }
  };

  const logoutAdmin = async () => {
    setAuthError(null);
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
        clearAuthError: () => {
          setAuthError(null);
          setPopupBlocked(false);
        },
        loginWithGoogle,
        loginWithGoogleRedirect,
        loginWithEmailPassword,
        registerWithEmailPassword,
        linkPasswordViaGoogle,
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
