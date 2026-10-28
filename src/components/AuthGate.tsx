import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Copy,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldAlert,
  ShieldCheck,
  UserPlus,
} from 'lucide-react';
import firestoreRulesRaw from '../../firestore.rules?raw';
import { useAuth } from '../context/AuthContext';
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
    popupBlocked,
    clearAuthError,
    loginWithGoogle,
    loginWithGoogleRedirect,
    loginWithEmailPassword,
    registerWithEmailPassword,
    linkPasswordViaGoogle,
    requestPasswordReset,
    sendVerificationToCurrentUser,
    refreshCurrentUserVerification,
    retrySessionVerification,
    completeSuperAdminBootstrap,
    logoutAdmin,
  } = useAuth();

  const [authTab, setAuthTab] = useState<'google' | 'email'>('google');
  const [emailMode, setEmailMode] = useState<'signin' | 'setup' | 'reset'>('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [setupDisplayName, setSetupDisplayName] = useState('');
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

  // Signed-in user whose email is not yet verified (e.g., newly registered Email/Password account)
  if (user && !user.emailVerified) {
    return (
      <div className="min-h-screen bg-[#F4F7F8] flex items-center justify-center p-6">
        <div className="w-full max-w-lg bg-white border border-[#E6ECEF] rounded-2xl p-8 space-y-5">
          <div className="flex items-start gap-3">
            <Mail className="w-7 h-7 text-[#0D7E74] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h1 className="text-xl font-bold text-[#0F172A]">
                Verify Your Administrator Email
              </h1>
              <p className="text-sm text-[#64748B] leading-relaxed">
                ইমেইল ভেরিফিকেশন সম্পন্ন না হওয়া পর্যন্ত অ্যাডমিন প্যানেল অ্যাক্সেস সক্রিয় হবে না। ইনবক্সে পাঠানো লিংকে ক্লিক করে নিচে রিফ্রেশ বাটন চাপুন।
              </p>
            </div>
          </div>

          <div className="p-4 bg-[#F4F7F8] border border-[#E6ECEF] rounded-xl space-y-2 text-xs">
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Signed-In Email</span>
              <span className="font-mono text-[#0F172A]">{user.email || 'Unverified'}</span>
            </div>
            <div className="flex items-center justify-between gap-2">
              <span className="text-[#64748B]">Email Verified</span>
              <span className="font-mono text-[#B45309]">Pending Verification</span>
            </div>
          </div>

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
              Sign Out
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  setStatusMessage(null);
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
                Resend Verification Email
              </button>
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  setBusy(true);
                  try {
                    const verified = await refreshCurrentUserVerification();
                    if (!verified) {
                      setStatusMessage(
                        'Email is not marked verified yet. Click the verification link in your inbox (or Spam folder) first.'
                      );
                    }
                  } finally {
                    setBusy(false);
                  }
                }}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                I Verified My Email — Refresh
              </button>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Signed-in verified user where server/database verification encountered an error
  if (user && (!serverVerified || (isBootstrappedSuperAdmin && !isAuthorizedStaff && !isSuspendedStaff && !needsSuperAdminBootstrap))) {
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
                  <span>{copiedConsoleUrl ? 'Copied Console Link!' : 'Copy Firestore Console Link'}</span>
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
                  <span>{copiedConsoleUrl ? 'Copied Console Link!' : 'Copy Firestore Console Link'}</span>
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
                  : 'Unauthorized Storefront Account'}
              </h1>
              <p className="text-sm text-[#64748B] leading-relaxed">
                {isSuspendedStaff
                  ? 'Your pharmacy staff profile is currently suspended. Contact a Super Administrator to review your account standing.'
                  : 'এই অ্যাকাউন্টে এখনো স্টাফ বা অ্যাডমিন অনুমতি দেওয়া হয়নি। নিচে আপনার Firebase Auth UID কপি করে Super Admin-এর মাধ্যমে Staff Management-এ যুক্ত করুন।'}
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
            Super Admin বা Store Admin <strong className="text-[#0F172A]">Staff &amp; Security → Provision Staff</strong> থেকে আপনার এই UID ও ইমেইল যুক্ত করার পর নিচে <strong className="text-[#0F172A]">Refresh Access</strong> ক্লিক করলেই ড্যাশবোর্ড খুলে যাবে।
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

  const showGooglePasswordLinkActions =
    authTab === 'email' &&
    Boolean(authError) &&
    (authError?.includes('invalid-credential') || authError?.includes('ইতিমধ্যে নিবন্ধিত'));

  // Unauthenticated Login View
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
          <div className="space-y-1">
            <h2 className="text-2xl font-bold text-[#0F172A]">Administrator Sign In</h2>
            <p className="text-sm text-[#64748B]">
              Sign in with your authorized pharmacy administrator account.
            </p>
          </div>

          {/* Interactive Auth Method Switcher */}
          <div className="flex items-center gap-1 p-1 bg-[#F1F6F7] rounded-xl">
            <button
              type="button"
              onClick={() => {
                setAuthTab('google');
                setEmailMode('signin');
                clearAuthError();
                setStatusMessage(null);
              }}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                authTab === 'google'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Google Workspace / SSO
            </button>
            <button
              type="button"
              onClick={() => {
                setAuthTab('email');
                clearAuthError();
                setStatusMessage(null);
              }}
              className={`flex-1 px-3 py-2 text-xs font-medium rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                authTab === 'email'
                  ? 'bg-white text-[#0F172A] shadow-xs'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Email &amp; Password
            </button>
          </div>

          {authError && (
            <div className="p-3.5 bg-[#FEF2F2] border border-[#FECACA] rounded-xl text-xs text-[#991B1B] space-y-2.5 leading-relaxed">
              <div className="flex items-start gap-2.5">
                <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                <span>{authError}</span>
              </div>

              {popupBlocked && (
                <div className="flex flex-wrap items-center gap-2 pt-1 pl-6">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        await loginWithGoogleRedirect();
                      } catch {
                        setBusy(false);
                      }
                    }}
                    className="px-3 py-1.5 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Continue Without Popup (Redirect)
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setAuthTab('email');
                      clearAuthError();
                    }}
                    className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                  >
                    Use Email &amp; Password
                  </button>
                </div>
              )}

              {showGooglePasswordLinkActions && (
                <div className="pt-1.5 pl-6 flex flex-col gap-2">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const task = linkPasswordViaGoogle(email, password);
                      setBusy(true);
                      setStatusMessage(null);
                      try {
                        const msg = await task;
                        clearAuthError();
                        setStatusMessage(msg);
                      } catch {
                        // Error state set in AuthContext
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full px-3 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-lg transition-colors text-center"
                  >
                    Google দিয়ে যাচাই করে এই পাসওয়ার্ড সেট করুন
                  </button>

                  <div className="flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      disabled={busy}
                      onClick={async () => {
                        const signInTask = loginWithGoogle();
                        setBusy(true);
                        try {
                          await signInTask;
                        } catch {
                          // Error state set in AuthContext
                        } finally {
                          setBusy(false);
                        }
                      }}
                      className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#0F172A] hover:bg-[#F8FAFC] rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      Sign In with Google
                    </button>

                    {email.trim() && (
                      <button
                        type="button"
                        disabled={busy}
                        onClick={async () => {
                          setBusy(true);
                          setStatusMessage(null);
                          try {
                            const msg = await requestPasswordReset(email);
                            clearAuthError();
                            setStatusMessage(msg);
                          } catch {
                            // Handled in context
                          } finally {
                            setBusy(false);
                          }
                        }}
                        className="px-2.5 py-1.5 text-xs font-medium bg-white border border-[#FECACA] text-[#991B1B] hover:bg-[#FEE2E2] rounded-lg transition-colors whitespace-nowrap shrink-0"
                      >
                        Send Password Link to Email
                      </button>
                    )}
                  </div>
                </div>
              )}
            </div>
          )}

          {statusMessage && (
            <div className="p-3.5 bg-[#F0FDFA] border border-[#99F6E4] rounded-xl text-xs text-[#0F766E] flex items-start gap-2.5 leading-relaxed">
              <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
              <span>{statusMessage}</span>
            </div>
          )}

          {authTab === 'google' ? (
            <div className="space-y-4">
              <button
                type="button"
                disabled={busy}
                onClick={async () => {
                  const signInTask = loginWithGoogle();
                  setBusy(true);
                  try {
                    await signInTask;
                  } catch {
                    // Handled in context
                  } finally {
                    setBusy(false);
                  }
                }}
                className="w-full flex items-center justify-center gap-3 px-4 py-3 text-sm font-semibold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity whitespace-nowrap shrink-0"
              >
                <Lock className="w-4 h-4" />
                <span>{busy ? 'Authenticating...' : 'Sign In with Verified Google Account'}</span>
              </button>
              <p className="text-xs text-[#64748B] leading-relaxed">
                অনুমোদিত অ্যাডমিন অ্যাকাউন্টের জন্য Google Sign-In সবচেয়ে দ্রুত ও নিরাপদ। লগইনের পর চাইলে Staff &amp; Security থেকে Email পাসওয়ার্ডও যুক্ত করতে পারবেন।
              </p>
            </div>
          ) : emailMode === 'reset' ? (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                setStatusMessage(null);
                try {
                  const msg = await requestPasswordReset(email);
                  setStatusMessage(msg);
                } catch {
                  // Handled in context
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Staff Email Address
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="admin@finesterideshopbd.example"
                    className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between gap-3">
                <button
                  type="button"
                  onClick={() => {
                    setEmailMode('signin');
                    clearAuthError();
                  }}
                  className="text-xs font-medium text-[#64748B] hover:text-[#0F172A] whitespace-nowrap shrink-0"
                >
                  Back to Sign In
                </button>
                <button
                  type="submit"
                  disabled={busy}
                  className="px-4 py-2.5 text-sm font-semibold text-white bg-[#0D7E74] hover:bg-[#09635B] disabled:opacity-60 rounded-xl transition-colors whitespace-nowrap shrink-0"
                >
                  {busy ? 'Sending...' : 'Send Password Reset'}
                </button>
              </div>
            </form>
          ) : emailMode === 'setup' ? (
            <div className="space-y-4">
              <div className="p-3 bg-[#F8FAFC] border border-[#E6ECEF] rounded-xl text-xs text-[#475569] leading-relaxed">
                Gmail অ্যাকাউন্ট হলে ইমেইল ও নতুন পাসওয়ার্ড লিখে <strong>Google দিয়ে যাচাই করে পাসওয়ার্ড সেট করুন</strong> চাপুন, অথবা নতুন স্টাফ ইমেইল হলে <strong>Create Email Account</strong> চাপুন।
              </div>

              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setBusy(true);
                  setStatusMessage(null);
                  try {
                    const msg = await registerWithEmailPassword(email, password, setupDisplayName);
                    setStatusMessage(msg);
                  } catch {
                    // Handled in context
                  } finally {
                    setBusy(false);
                  }
                }}
                className="space-y-3.5"
              >
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Full Name (Optional)
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={setupDisplayName}
                    onChange={(e) => setSetupDisplayName(e.target.value)}
                    placeholder="Administrator / Pharmacist Name"
                    className="w-full px-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Staff / Admin Email
                  </label>
                  <div className="relative">
                    <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                    <input
                      type="email"
                      required
                      value={email}
                      onChange={(e) => setEmail(e.target.value)}
                      placeholder="ventegksy@gmail.com"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    New Password (কমপক্ষে ৬ অক্ষর)
                  </label>
                  <div className="relative">
                    <KeyRound className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                    <input
                      type="password"
                      required
                      minLength={6}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="Create 6+ character password"
                      className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                    />
                  </div>
                </div>

                <div className="space-y-2 pt-1">
                  <button
                    type="button"
                    disabled={busy}
                    onClick={async () => {
                      const task = linkPasswordViaGoogle(email, password);
                      setBusy(true);
                      setStatusMessage(null);
                      try {
                        const msg = await task;
                        setStatusMessage(msg);
                      } catch {
                        // Handled in context
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity"
                  >
                    <Lock className="w-4 h-4 shrink-0" />
                    <span>Google দিয়ে যাচাই করে পাসওয়ার্ড সেট করুন</span>
                  </button>

                  <button
                    type="submit"
                    disabled={busy}
                    className="w-full flex items-center justify-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F8FAFC] disabled:opacity-60 rounded-xl transition-colors"
                  >
                    <UserPlus className="w-3.5 h-3.5 shrink-0" />
                    <span>Create Non-Google Email Account</span>
                  </button>
                </div>

                <div className="pt-1 text-center">
                  <button
                    type="button"
                    onClick={() => {
                      setEmailMode('signin');
                      clearAuthError();
                    }}
                    className="text-xs font-medium text-[#64748B] hover:text-[#0F172A]"
                  >
                    Back to Email Sign In
                  </button>
                </div>
              </form>
            </div>
          ) : (
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setBusy(true);
                try {
                  await loginWithEmailPassword(email, password);
                } catch {
                  // Handled in context
                } finally {
                  setBusy(false);
                }
              }}
              className="space-y-4"
            >
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Staff Email
                </label>
                <div className="relative">
                  <Mail className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                  <input
                    type="email"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="staff@finesterideshopbd.example"
                    className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-xs font-medium text-[#0F172A]">Password</label>
                  <button
                    type="button"
                    onClick={() => {
                      setEmailMode('reset');
                      clearAuthError();
                    }}
                    className="text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                  >
                    Reset Password
                  </button>
                </div>
                <div className="relative">
                  <KeyRound className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
                  <input
                    type="password"
                    required
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="Enter staff password"
                    className="w-full pl-9 pr-3.5 py-2.5 text-sm border border-[#E6ECEF] rounded-xl"
                  />
                </div>
              </div>

              <button
                type="submit"
                disabled={busy}
                className="w-full px-4 py-2.5 text-sm font-semibold text-white bg-gradient-to-r from-[#0E877C] to-[#064E49] hover:opacity-95 disabled:opacity-60 rounded-xl transition-opacity whitespace-nowrap shrink-0"
              >
                {busy ? 'Signing In...' : 'Sign In with Email'}
              </button>

              <div className="pt-1 border-t border-[#EEF2F6] flex items-center justify-between gap-2 text-xs">
                <span className="text-[#64748B]">এখনো পাসওয়ার্ড সেট করা নেই?</span>
                <button
                  type="button"
                  onClick={() => {
                    setEmailMode('setup');
                    clearAuthError();
                    setStatusMessage(null);
                  }}
                  className="font-semibold text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                >
                  Set / Create Password
                </button>
              </div>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
