import React, { useState } from 'react';
import {
  AlertCircle,
  ArrowLeft,
  CheckCircle2,
  Copy,
  KeyRound,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  User,
} from 'lucide-react';
import firestoreRulesRaw from '../../firestore.rules?raw';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { getFirebaseProjectInfo } from '../lib/firebase';
import { PharmacyEmblem } from './BrandLogo';

export function AuthGate({ children }: { children: React.ReactNode }) {
  const {
    user,
    authReady,
    staffLoading,
    serverVerified,
    isAuthorizedStaff,
    isSuspendedStaff,
    isBootstrappedSuperAdmin,
    needsSuperAdminBootstrap,
    authError,
    pendingResetActionUrl,
    clearAuthError,
    clearPendingResetAction,
    logoutAdmin,
    loginWithEmailPassword,
    registerWithEmailPassword,
    completeFirebaseEmailAction,
    requestPasswordReset,
    sendVerificationToCurrentUser,
    refreshCurrentUserVerification,
    retrySessionVerification,
    completeSuperAdminBootstrap,
  } = useAuth();
  const { language, toggleLanguage, t } = useLanguage();

  const [emailMode, setEmailMode] = useState<'signin' | 'setup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');
  const [resetLinkSent, setResetLinkSent] = useState(false);
  const [pastedResetLink, setPastedResetLink] = useState('');
  const [newResetPassword, setNewResetPassword] = useState('');
  const [verifyEmailLinkInput, setVerifyEmailLinkInput] = useState('');
  const [statusMessage, setStatusMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const [adminDisplayName, setAdminDisplayName] = useState('');
  const [adminLicenseNo, setAdminLicenseNo] = useState('BPC-REG-0001');
  const [copiedUid, setCopiedUid] = useState(false);
  const [copiedRules, setCopiedRules] = useState(false);
  const [copiedConsoleUrl, setCopiedConsoleUrl] = useState(false);

  const projectInfo = getFirebaseProjectInfo();
  const firestoreConsoleUrl = `https://console.firebase.google.com/project/${projectInfo.projectId}/firestore`;

  const copyFirestoreRulesToClipboard = async () => {
    try {
      let rulesText = firestoreRulesRaw;
      try {
        const res = await fetch('/api/firebase/rules-bundle');
        if (res.ok) {
          const data = (await res.json()) as { firestoreRules?: string };
          if (data.firestoreRules && data.firestoreRules.trim().length > 0) {
            rulesText = data.firestoreRules;
          }
        }
      } catch {
        // Fallback to bundled raw firestore.rules
      }
      if (rulesText) {
        await navigator.clipboard.writeText(rulesText);
        setCopiedRules(true);
        setTimeout(() => setCopiedRules(false), 2500);
      }
    } catch {
      // Clipboard fallback ignored
    }
  };

  if (!authReady || staffLoading) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-md bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-4">
          <div className="flex items-center gap-3">
            <PharmacyEmblem className="w-9 h-9" />
            <div className="space-y-1.5 flex-1">
              <div className="h-4 w-48 bg-[#E6EFF0] rounded animate-pulse" />
              <div className="h-3 w-32 bg-[#EEF4F5] rounded animate-pulse" />
            </div>
          </div>
          <div className="h-10 w-full bg-[#EEF4F5] rounded-xl animate-pulse" />
          <p className="text-xs text-[#64748B]">
            Verifying Firebase identity, security rules, and server session...
          </p>
        </div>
      </div>
    );
  }

  // Signed-in user whose email is not yet verified (newly registered Email/Password account)
  if (user && !user.emailVerified) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-5">
          <div className="flex items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <Mail className="w-7 h-7 text-[#0D7E74] shrink-0 mt-0.5" />
              <div className="space-y-1">
                <h1 className="text-xl font-bold text-[#0F172A]">
                  {t('অ্যাডমিন ইমেইল ভেরিফাই করুন', 'Verify Your Administrator Email')}
                </h1>
                <p className="text-sm text-[#64748B] leading-relaxed">
                  {t(
                    'ইমেইল ভেরিফিকেশন সম্পন্ন না হওয়া পর্যন্ত অ্যাডমিন প্যানেল অ্যাক্সেস সক্রিয় হবে না। ইনবক্সে (বা Spam ফোল্ডারে) পাঠানো লিংকে ক্লিক করে নিচে রিফ্রেশ বাটন চাপুন—অথবা লিংকটি সরাসরি নিচে পেস্ট করুন।',
                    'Administrator access requires a verified email. Click the verification link sent to your inbox (or Spam folder) and press Refresh below, or paste the verification link directly.'
                  )}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={toggleLanguage}
              className="px-3 py-1.5 text-xs font-bold text-[#0D7E74] bg-[#F0FDFA] border border-[#CCFBF1] hover:bg-[#E0F7F5] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              {language === 'bn' ? 'English 🌐' : 'বাংলা 🌐'}
            </button>
          </div>

          <div className="p-4 bg-[#F4F7F8] border border-[#E6ECEF] rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">{t('লগইনকৃত ইমেইল', 'Signed-In Email')}</span>
              <span className="font-mono text-[#0F172A]">{user.email || 'Unverified'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">{t('ভেরিফিকেশন স্ট্যাটাস', 'Email Verified')}</span>
              <span className="font-mono text-[#B45309]">
                {t('ভেরিফিকেশন বাকি আছে', 'Pending Verification')}
              </span>
            </div>
          </div>

          <div className="p-3.5 bg-[#F8FAFC] border border-[#E6ECEF] rounded-xl space-y-2">
            <label className="block text-xs font-medium text-[#0F172A]">
              {t(
                'ইমেইলের ভেরিফিকেশন লিংক পেস্ট করে তাৎক্ষণিক ভেরিফাই করুন (ঐচ্ছিক)',
                'Paste verification link from email to verify instantly (optional)'
              )}
            </label>
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={verifyEmailLinkInput}
                onChange={(e) => setVerifyEmailLinkInput(e.target.value)}
                placeholder={t(
                  'ইমেইল থেকে ভেরিফিকেশন লিংক এখানে পেস্ট করুন...',
                  'Paste verification link from email...'
                )}
                className="flex-1 px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white text-[#0F172A] focus:outline-none focus:border-[#0D7E74]"
              />
              <button
                type="button"
                disabled={busy || !verifyEmailLinkInput.trim()}
                onClick={async () => {
                  setBusy(true);
                  setStatusMessage(null);
                  clearAuthError();
                  try {
                    const msg = await completeFirebaseEmailAction(verifyEmailLinkInput);
                    setVerifyEmailLinkInput('');
                    setStatusMessage(msg);
                  } catch {
                    // Error handled via authError in context
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-3 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {t('ভেরিফাই করুন', 'Verify Link')}
              </button>
            </div>
          </div>

          {authError && (
            <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2.5 leading-relaxed">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{authError}</span>
            </div>
          )}

          {statusMessage && (
            <div className="p-3.5 bg-[#F0FDFA] border border-[#99F6E4] rounded-xl text-xs text-[#0F766E] flex items-start gap-2.5 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => void logoutAdmin()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#64748B] hover:text-[#0F172A] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              {t('সাইন আউট', 'Sign Out')}
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setStatusMessage(null);
                  clearAuthError();
                  try {
                    const msg = await sendVerificationToCurrentUser();
                    setStatusMessage(msg);
                  } catch (err) {
                    setStatusMessage(
                      err instanceof Error ? err.message : 'Could not send verification email.'
                    );
                  } finally {
                    setBusy(false);
                  }
                }}
                className="px-3.5 py-2.5 text-xs font-medium bg-white border border-[#E6ECEF] text-[#0F172A] hover:bg-[#F4F7F8] rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                {t('পুনরায় লিংক পাঠান', 'Resend Verification Email')}
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  clearAuthError();
                  try {
                    const verified = await refreshCurrentUserVerification();
                    if (!verified) {
                      setStatusMessage(
                        t(
                          'ইমেইল এখনো ভেরিফাই হয়নি। আগে ইনবক্স বা Spam ফোল্ডারে গিয়ে ভেরিফিকেশন লিংকে ক্লিক করুন।',
                          'Email is not marked verified yet. Click the verification link in your inbox (or Spam folder) first.'
                        )
                      );
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {t('ভেরিফাই সম্পন্ন — রিফ্রেশ করুন', 'I Verified My Email — Refresh')}
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in verified user where server/database verification encountered an error
  if (
    user &&
    (!serverVerified ||
      (isBootstrappedSuperAdmin &&
        !isAuthorizedStaff &&
        !isSuspendedStaff &&
        !needsSuperAdminBootstrap))
  ) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-5">
          <div className="flex items-start gap-3">
            <AlertCircle className="w-7 h-7 text-[#D97706] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-[#0F172A]">
                Complete Firebase &amp; Session Setup
              </h1>
              <p className="text-sm text-[#64748B] leading-relaxed">
                আপনার অ্যাডমিন ইমেইল (<span className="font-mono text-[#0F172A]">{user.email}</span>) যাচাই হয়েছে। সংযোগ বা ডেটাবেস সেটআপ নিচে থেকে যাচাই করুন।
              </p>
            </div>
          </div>

          {authError && (
            <div className="p-4 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] space-y-3 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pl-6">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(firestoreConsoleUrl);
                    setCopiedConsoleUrl(true);
                    setTimeout(() => setCopiedConsoleUrl(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {copiedConsoleUrl ? 'Copied Console Link!' : 'Copy Firestore Console Link'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyFirestoreRulesToClipboard()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedRules ? 'Copied firestore.rules!' : 'Copy firestore.rules'}</span>
                </button>
              </div>
            </div>
          )}

          <div className="flex items-center justify-between gap-3 pt-2">
            <button
              type="button"
              onClick={() => void logoutAdmin()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#64748B] hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await retrySessionVerification();
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-2 px-5 py-2.5 text-sm font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
              {busy ? 'Checking...' : 'Retry Verification'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // First-time Super Admin Provisioning Screen for verified bootstrapped owner
  if (user && needsSuperAdminBootstrap) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-6">
          <div className="flex items-center gap-3">
            <PharmacyEmblem className="w-10 h-10" />
            <div>
              <h1 className="text-xl font-bold text-[#0F172A]">
                Provision Chief Administrator Profile
              </h1>
              <p className="text-sm text-[#64748B]">
                Finesteride Recur 1Mg Shop Bd · Smart Pharmacy Management
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#F4F9F9] border border-[#DCEAEB] rounded-xl space-y-1 text-sm">
            <p className="font-medium text-[#0F172A] flex items-center gap-2">
              <ShieldCheck className="w-4 h-4 text-[#0D7E74]" />
              Verified Identity Confirmed: <span className="font-mono">{user.email}</span>
            </p>
            <p className="text-xs text-[#64748B]">
              Initialize your authoritative Super Admin record in{' '}
              <code className="font-mono">/staffMembers/{user.uid}</code> to activate role-based store management and clinical review controls.
            </p>
          </div>

          {authError && (
            <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] space-y-2.5 leading-relaxed">
              <div className="flex items-start gap-2">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>
              <div className="flex flex-wrap items-center gap-2 pt-1 pl-6">
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(firestoreConsoleUrl);
                    setCopiedConsoleUrl(true);
                    setTimeout(() => setCopiedConsoleUrl(false), 2500);
                  }}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>
                    {copiedConsoleUrl ? 'Copied Console Link!' : 'Copy Firestore Console Link'}
                  </span>
                </button>
                <button
                  type="button"
                  onClick={() => void copyFirestoreRulesToClipboard()}
                  className="inline-flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedRules ? 'Copied firestore.rules!' : 'Copy firestore.rules'}</span>
                </button>
              </div>
            </div>
          )}

          <form
            onSubmit={async (e) => {
              e.preventDefault();
              setBusy(true);
              try {
                await completeSuperAdminBootstrap(
                  adminDisplayName.trim() || user.displayName || 'Chief Pharmacy Administrator',
                  adminLicenseNo.trim() || 'BPC-REG-0001'
                );
              } finally {
                setBusy(false);
              }
            }}
            className="space-y-4"
          >
            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">
                Administrator Full Name
              </label>
              <input
                type="text"
                required
                maxLength={120}
                defaultValue={user.displayName || 'Chief Pharmacy Administrator'}
                onChange={(e) => setAdminDisplayName(e.target.value)}
                placeholder="e.g., Chief Pharmacist & Store Director"
                className="w-full px-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl bg-white text-[#0F172A]"
              />
            </div>

            <div>
              <label className="block text-sm font-medium text-[#0F172A] mb-1">
                Pharmacy Council / Clinical Reviewer Registration ID
              </label>
              <input
                type="text"
                required
                maxLength={64}
                value={adminLicenseNo}
                onChange={(e) => setAdminLicenseNo(e.target.value)}
                placeholder="e.g., BPC-A-10482"
                className="w-full px-3.5 py-2.5 text-sm font-mono border border-[#E6ECEF] rounded-xl bg-white text-[#0F172A]"
              />
              <p className="text-xs text-[#64748B] mt-1">
                Recorded on clinical prescription review decisions to enforce regulatory accountability.
              </p>
            </div>

            <div className="flex items-center justify-between gap-4 pt-2">
              <button
                type="button"
                onClick={() => void logoutAdmin()}
                className="px-4 py-2.5 text-sm font-medium text-[#64748B] hover:text-[#0F172A] transition-colors whitespace-nowrap shrink-0"
              >
                Sign Out
              </button>
              <button
                type="submit"
                disabled={busy}
                className="px-5 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity whitespace-nowrap shrink-0"
              >
                {busy ? 'Provisioning...' : 'Activate Super Admin Access'}
              </button>
            </div>
          </form>
        </div>
      </div>
    );
  }

  // Authenticated user WITHOUT staff authorization or with suspended staff account
  if (user && !isAuthorizedStaff) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-5">
          <div className="flex items-start gap-3">
            <ShieldAlert className="w-7 h-7 text-[#DC2626] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-[#0F172A]">
                {isSuspendedStaff
                  ? 'Administrative Account Suspended'
                  : 'Access Pending Verification'}
              </h1>
              <p className="text-sm text-[#64748B] leading-relaxed">
                {isSuspendedStaff
                  ? 'Your pharmacy staff profile is currently suspended. Contact a Super Administrator to review your account standing.'
                  : 'আপনার অ্যাকাউন্টটি সিস্টেমের জন্য অনুমোদিত নয় অথবা এখনো ভেরিফিকেশন সম্পন্ন হয়নি। আপনার এক্সেস সক্রিয় করতে নিচের বাটনটি চাপুন অথবা সুপার অ্যাডমিনের সাথে যোগাযোগ করুন।'}
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#F4F7F8] border border-[#E6ECEF] rounded-xl space-y-2.5 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Signed-In Email</span>
              <span className="font-mono text-[#0F172A]">{user.email || 'Unverified'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Email Verified</span>
              <span className="font-mono text-[#0F172A]">
                {user.emailVerified ? 'Yes' : 'No (Required)'}
              </span>
            </div>
            <div className="pt-2 border-t border-[#E6ECEF] space-y-1.5">
              <div className="flex items-center justify-between gap-2">
                <span className="text-[#64748B]">Firebase Auth UID (For Staff Provisioning)</span>
                <button
                  type="button"
                  onClick={() => {
                    void navigator.clipboard.writeText(user.uid);
                    setCopiedUid(true);
                    setTimeout(() => setCopiedUid(false), 2000);
                  }}
                  className="inline-flex items-center gap-1.5 font-mono font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                >
                  <Copy className="w-3.5 h-3.5" />
                  <span>{copiedUid ? 'Copied Full UID!' : 'Copy Full UID'}</span>
                </button>
              </div>
              <div className="font-mono text-[11px] text-[#0F172A] bg-white border border-[#E6ECEF] rounded-lg px-2.5 py-1.5 select-all break-all">
                {user.uid}
              </div>
            </div>
          </div>

          <p className="text-xs text-[#64748B] leading-relaxed">
            Super Admin বা Store Admin{' '}
            <strong className="text-[#0F172A]">Staff &amp; Security → Provision Staff</strong> থেকে আপনার এই UID ও ইমেইল যুক্ত করার পর নিচে{' '}
            <strong className="text-[#0F172A]">Refresh Access</strong> ক্লিক করলেই ড্যাশবোর্ড খুলে যাবে।
          </p>

          <div className="pt-2 flex flex-wrap items-center justify-between gap-3">
            <button
              type="button"
              onClick={() => void logoutAdmin()}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#64748B] hover:text-[#0F172A] border border-[#E6ECEF] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <LogOut className="w-4 h-4" />
              Sign Out
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={async () => {
                setBusy(true);
                try {
                  await retrySessionVerification();
                } finally {
                  setBusy(false);
                }
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className="w-4 h-4" />
              {busy ? 'Checking...' : 'Refresh Access'}
            </button>
          </div>
        </div>
      </div>
    );
  }

  // Authorized Staff — render protected dashboard
  if (user && isAuthorizedStaff) {
    return <>{children}</>;
  }

  // Unauthenticated Email & Password Login / Registration / Password Reset View
  return (
    <div className="min-h-screen bg-[#F4F7F8] grid lg:grid-cols-12 items-stretch">
      {/* Left Minimal Brand Column */}
      <div className="lg:col-span-5 bg-gradient-to-br from-[#0F8F83] via-[#096A63] to-[#054541] text-white p-8 lg:p-14 flex flex-col items-center justify-center text-center relative overflow-hidden">
        <svg
          viewBox="0 0 220 220"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="hidden sm:block absolute -right-8 -bottom-10 w-64 h-64 text-white/10 pointer-events-none select-none"
          aria-hidden="true"
        >
          <g transform="rotate(32 110 110)">
            <rect
              x="68"
              y="22"
              width="84"
              height="176"
              rx="42"
              stroke="currentColor"
              strokeWidth="12"
            />
            <line x1="68" y1="110" x2="152" y2="110" stroke="currentColor" strokeWidth="12" />
          </g>
        </svg>

        <div className="space-y-4 relative z-10 flex flex-col items-center max-w-sm">
          <PharmacyEmblem className="w-14 h-14" />
          <div className="space-y-1.5">
            <h1 className="text-2xl lg:text-3xl font-bold tracking-tight [text-wrap:balance]">
              Finesteride Recur 1Mg Shop Bd
            </h1>
            <p className="text-sm text-white/85">
              Your Health Our Priority &middot; Admin Panel
            </p>
          </div>
        </div>
      </div>

      {/* Right Authentication Form Column */}
      <div className="lg:col-span-7 flex items-center justify-center p-6 lg:p-14">
        <div className="w-full max-w-md bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-6">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-1">
              <h2 className="text-2xl font-bold text-[#0F172A]">
                {t('অ্যাডমিন লগইন ও ভেরিফিকেশন', 'Administrator Sign In')}
              </h2>
              <p className="text-sm text-[#64748B]">
                {t(
                  'ইমেইল ও পাসওয়ার্ডের মাধ্যমে লগইন বা নতুন অ্যাডমিন অ্যাকাউন্ট তৈরি ও ভেরিফাই করুন।',
                  'Sign in or register and verify your pharmacy administrator account via email and password.'
                )}
              </p>
            </div>
            <button
              type="button"
              onClick={toggleLanguage}
              className="px-3 py-1.5 text-xs font-bold text-[#0D7E74] bg-[#F0FDFA] border border-[#CCFBF1] hover:bg-[#E0F7F5] rounded-xl transition-colors whitespace-nowrap shrink-0"
              title="Switch Language / ভাষা পরিবর্তন করুন"
            >
              {language === 'bn' ? 'English 🌐' : 'বাংলা 🌐'}
            </button>
          </div>

          {pendingResetActionUrl ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setStatusMessage(null);
                clearAuthError();
                try {
                  const msg = await completeFirebaseEmailAction(
                    pendingResetActionUrl,
                    newResetPassword
                  );
                  setNewResetPassword('');
                  setStatusMessage(msg);
                } catch {
                  // Handled via authError in context
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div className="p-3.5 bg-[#F0FDFA] border border-[#99F6E4] rounded-xl text-xs text-[#0F766E] leading-relaxed">
                {t(
                  'পাসওয়ার্ড রিসেট লিংক যাচাই হয়েছে। নিচে নতুন পাসওয়ার্ড দিন (কমপক্ষে ৬ অক্ষর)।',
                  'Password reset link detected. Enter your new password below (at least 6 characters).'
                )}
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  {t('নতুন পাসওয়ার্ড', 'New Password')} *
                </label>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    placeholder={t('কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড', 'At least 6 characters')}
                    className="w-full pl-9 pr-3.5 py-2.5 text-xs border border-[#E6ECEF] rounded-xl focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              {authError && (
                <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2.5 leading-relaxed">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{authError}</span>
                </div>
              )}

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    clearPendingResetAction();
                    clearAuthError();
                  }}
                  className="text-xs font-medium text-[#64748B] hover:text-[#0F172A]"
                >
                  {t('বাতিল করুন', 'Cancel')}
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-5 py-2.5 text-xs font-bold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity"
                >
                  {busy
                    ? t('প্রসেসিং হচ্ছে...', 'Saving...')
                    : t('নতুন পাসওয়ার্ড সেট ও লগইন করুন', 'Save Password & Sign In')}
                </button>
              </div>
            </form>
          ) : emailMode === 'reset' ? (
            <div className="space-y-4">
              <button
                type="button"
                onClick={() => {
                  setEmailMode('signin');
                  setResetLinkSent(false);
                  clearAuthError();
                  setStatusMessage(null);
                }}
                className="inline-flex items-center gap-1.5 text-xs font-semibold text-[#0D7E74] hover:underline"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>{t('লগইন পেজে ফিরে যান', 'Back to Sign In')}</span>
              </button>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  clearAuthError();
                  setStatusMessage(null);
                  try {
                    const msg = await requestPasswordReset(email);
                    setResetLinkSent(true);
                    setStatusMessage(msg);
                  } catch {
                    // Handled via authError in context
                  } finally {
                    setBusy(false);
                  }
                }}
                className="space-y-3.5"
              >
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    {t('আপনার নিবন্ধিত ইমেইল ঠিকানা', 'Registered Email Address')} *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@yourpharmacy.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-xs border border-[#E6ECEF] rounded-xl focus:outline-none focus:border-[#0D7E74]"
                    />
                  </div>
                </div>

                {authError && (
                  <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2.5 leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3.5 bg-[#F0FDFA] border border-[#99F6E4] rounded-xl text-xs text-[#0F766E] flex items-start gap-2.5 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full px-4 py-3 text-xs font-bold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity shadow-xs"
                >
                  {busy
                    ? t('লিংক পাঠানো হচ্ছে...', 'Sending Reset Link...')
                    : t('পাসওয়ার্ড রিসেট লিংক পাঠান', 'Send Password Reset Link')}
                </button>
              </form>

              {resetLinkSent && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    clearAuthError();
                    setStatusMessage(null);
                    try {
                      const msg = await completeFirebaseEmailAction(
                        pastedResetLink,
                        newResetPassword
                      );
                      setPastedResetLink('');
                      setNewResetPassword('');
                      setStatusMessage(msg);
                    } catch {
                      // Handled via authError in context
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="p-3.5 bg-[#F8FAFC] border border-[#E6ECEF] rounded-xl space-y-2.5"
                >
                  <p className="text-xs font-semibold text-[#0F172A]">
                    {t(
                      'অথবা ইমেইলের রিসেট লিংক এখানে পেস্ট করে সরাসরি নতুন পাসওয়ার্ড দিন (ঐচ্ছিক):',
                      'Or paste the reset link from your email to set your password directly:'
                    )}
                  </p>
                  <input
                    type="text"
                    required
                    value={pastedResetLink}
                    onChange={(e) => setPastedResetLink(e.target.value)}
                    placeholder={t('ইমেইল থেকে রিসেট লিংক পেস্ট করুন...', 'Paste reset link from email...')}
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white text-[#0F172A]"
                  />
                  <input
                    type="password"
                    required
                    minLength={6}
                    value={newResetPassword}
                    onChange={(e) => setNewResetPassword(e.target.value)}
                    placeholder={t('নতুন পাসওয়ার্ড (৬+ অক্ষর)', 'New password (6+ characters)')}
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white text-[#0F172A]"
                  />
                  <button
                    type="submit"
                    disabled={busy || !pastedResetLink.trim() || newResetPassword.length < 6}
                    className="w-full px-3 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] disabled:opacity-50 rounded-lg transition-colors"
                  >
                    {t('পাসওয়ার্ড আপডেট ও লগইন করুন', 'Reset Password & Sign In')}
                  </button>
                </form>
              )}
            </div>
          ) : (
            <div className="space-y-4">
              <div className="grid grid-cols-2 border-b border-[#EEF2F6]">
                <button
                  type="button"
                  onClick={() => {
                    setEmailMode('signin');
                    clearAuthError();
                    setStatusMessage(null);
                  }}
                  className={`text-xs font-bold pb-2.5 border-b-2 transition-colors ${
                    emailMode === 'signin'
                      ? 'border-[#0D7E74] text-[#0D7E74]'
                      : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {t('লগইন করুন', 'Sign In')}
                </button>
                <button
                  type="button"
                  onClick={() => {
                    setEmailMode('setup');
                    clearAuthError();
                    setStatusMessage(null);
                  }}
                  className={`text-xs font-bold pb-2.5 border-b-2 transition-colors ${
                    emailMode === 'setup'
                      ? 'border-[#0D7E74] text-[#0D7E74]'
                      : 'border-transparent text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {t('নতুন সাইনআপ / রেজিস্ট্রেশন', 'Sign Up & Verify')}
                </button>
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  clearAuthError();
                  setStatusMessage(null);
                  try {
                    if (emailMode === 'signin') {
                      await loginWithEmailPassword(email, password);
                    } else {
                      const msg = await registerWithEmailPassword(
                        email,
                        password,
                        setupDisplayName
                      );
                      setStatusMessage(msg);
                    }
                  } catch {
                    // Handled via authError in context
                  } finally {
                    setBusy(false);
                  }
                }}
                className="space-y-3.5"
              >
                {emailMode === 'setup' && (
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      {t('আপনার নাম', 'Full Name')}
                    </label>
                    <div className="relative">
                      <User className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                      <input
                        type="text"
                        maxLength={120}
                        value={setupDisplayName}
                        onChange={(e) => setSetupDisplayName(e.target.value)}
                        placeholder={t('যেমন: Chief Administrator', 'e.g. Chief Administrator')}
                        className="w-full pl-9 pr-3.5 py-2.5 text-xs border border-[#E6ECEF] rounded-xl focus:outline-none focus:border-[#0D7E74]"
                      />
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    {t('ইমেইল ঠিকানা', 'Email Address')} *
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="admin@yourpharmacy.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-xs border border-[#E6ECEF] rounded-xl focus:outline-none focus:border-[#0D7E74]"
                    />
                  </div>
                </div>

                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="text-xs font-semibold text-[#0F172A]">
                      {t('পাসওয়ার্ড', 'Password')} *
                    </label>
                    {emailMode === 'signin' && (
                      <button
                        type="button"
                        onClick={() => {
                          setEmailMode('reset');
                          clearAuthError();
                          setStatusMessage(null);
                        }}
                        className="text-xs font-medium text-[#0D7E74] hover:underline"
                      >
                        {t('পাসওয়ার্ড ভুলে গেছেন?', 'Forgot Password?')}
                      </button>
                    )}
                  </div>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder={
                        emailMode === 'setup'
                          ? t('কমপক্ষে ৬ অক্ষরের পাসওয়ার্ড', 'At least 6 characters')
                          : t('আপনার পাসওয়ার্ড লিখুন', 'Enter password')
                      }
                      className="w-full pl-9 pr-3.5 py-2.5 text-xs border border-[#E6ECEF] rounded-xl focus:outline-none focus:border-[#0D7E74]"
                    />
                  </div>
                </div>

                {authError && (
                  <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] flex items-start gap-2.5 leading-relaxed">
                    <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{authError}</span>
                  </div>
                )}

                {statusMessage && (
                  <div className="p-3.5 bg-[#F0FDFA] border border-[#99F6E4] rounded-xl text-xs text-[#0F766E] flex items-start gap-2.5 leading-relaxed">
                    <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                    <span>{statusMessage}</span>
                  </div>
                )}

                <button
                  type="submit"
                  disabled={busy}
                  className="w-full px-4 py-3 text-xs font-bold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity shadow-xs"
                >
                  {busy
                    ? t('প্রসেসিং হচ্ছে...', 'Processing...')
                    : emailMode === 'signin'
                    ? t('ইমেইল ও পাসওয়ার্ড দিয়ে লগইন করুন', 'Sign In with Email & Password')
                    : t('অ্যাকাউন্ট তৈরি ও ভেরিফিকেশন ইমেইল পাঠান', 'Create Account & Send Verification')}
                </button>
              </form>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
