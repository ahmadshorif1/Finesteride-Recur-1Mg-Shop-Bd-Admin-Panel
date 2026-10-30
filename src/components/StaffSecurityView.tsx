import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Bell,
  BellOff,
  CheckCircle2,
  Copy,
  Edit3,
  KeyRound,
  Lock,
  Plus,
  Search,
  Send,
  ShieldCheck,
  UserCheck,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import {
  disableStaffWebPush,
  enableStaffWebPush,
  getPushEnvironmentStatus,
  sendLocalVerificationNotification,
  type PushEnvironmentStatus,
} from '../lib/pushNotifications';
import { formatTimestamp } from '../lib/validation';
import {
  provisionStaffAccount,
  updateStaffMemberRecord,
} from '../services/pharmacyService';
import {
  ROLE_PERMISSIONS,
  type AdminAuditLog,
  type StaffMember,
  type StaffRole,
} from '../types/pharmacy';

const ALL_ROLES: StaffRole[] = [
  'super_admin',
  'store_admin',
  'inventory_manager',
  'order_manager',
  'customer_support',
  'analyst',
];

export function StaffSecurityView() {
  const {
    user,
    permissions,
    effectiveRole,
    mfaEnrolledCount,
    hasPasswordProvider,
    setOrUpdateCurrentAccountPassword,
  } = useAuth();
  const { actor, staffMembers, auditLogs } = useStoreData();

  const [tab, setTab] = useState<'directory' | 'matrix' | 'audit'>('directory');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // My Login Password Modal/Inline State
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const [myNewPassword, setMyNewPassword] = useState('');
  const [myConfirmPassword, setMyConfirmPassword] = useState('');
  const [savingMyPassword, setSavingMyPassword] = useState(false);

  // Provision Modal State
  const [provisionOpen, setProvisionOpen] = useState(false);
  const [newUid, setNewUid] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<StaffRole>('order_manager');
  const [newDept, setNewDept] = useState('Pharmacy Operations');
  const [newLicense, setNewLicense] = useState('');
  const [savingStaff, setSavingStaff] = useState(false);

  // Edit Staff Modal State
  const [editingStaff, setEditingStaff] = useState<StaffMember | null>(null);
  const [editName, setEditName] = useState('');
  const [editRole, setEditRole] = useState<StaffRole>('order_manager');
  const [editStatus, setEditStatus] = useState<'active' | 'suspended'>('active');
  const [editDept, setEditDept] = useState('');
  const [editLicense, setEditLicense] = useState('');

  // Audit Filter State
  const [auditSearch, setAuditSearch] = useState('');
  const [auditModuleFilter, setAuditModuleFilter] = useState<'all' | AdminAuditLog['module']>('all');

  // Web Push (FCM VAPID Key Pair) State
  const [pushEnv, setPushEnv] = useState<PushEnvironmentStatus | null>(null);
  const [pushBusy, setPushBusy] = useState(false);
  const [copiedFcmToken, setCopiedFcmToken] = useState(false);

  const refreshPushState = useCallback(async () => {
    const status = await getPushEnvironmentStatus();
    setPushEnv(status);
  }, []);

  useEffect(() => {
    void refreshPushState();
  }, [refreshPushState]);

  const handleEnablePush = async () => {
    if (!user?.uid || !user?.email) return;
    setPushBusy(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const activeUids = actor?.activeStaffUids || staffMembers.map((m) => m.uid);
      const res = await enableStaffWebPush({
        staffUid: user.uid,
        staffEmail: user.email,
        activeStaffUids: activeUids,
      });
      await refreshPushState();
      setSuccessMsg(res.notice);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to enable Web Push notifications.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleDisablePush = async () => {
    if (!user?.uid || !user?.email) return;
    setPushBusy(true);
    setErrorMsg(null);
    try {
      const activeUids = actor?.activeStaffUids || staffMembers.map((m) => m.uid);
      await disableStaffWebPush({
        staffUid: user.uid,
        staffEmail: user.email,
        activeStaffUids: activeUids,
      });
      await refreshPushState();
      setSuccessMsg('এই ব্রাউজারের জন্য Web Push Notification নিষ্ক্রিয় করা হয়েছে।');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to disable Web Push notifications.');
    } finally {
      setPushBusy(false);
    }
  };

  const handleTestPushNotification = async () => {
    setErrorMsg(null);
    try {
      await sendLocalVerificationNotification();
      setSuccessMsg('পরীক্ষামূলক Push Notification পাঠানো হয়েছে (আপনার ব্রাউজার নোটিফিকেশন ট্রে দেখুন)।');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not send test notification.');
    }
  };

  const handleCopyFcmToken = async () => {
    if (!pushEnv?.savedToken) return;
    try {
      await navigator.clipboard.writeText(pushEnv.savedToken);
      setCopiedFcmToken(true);
      window.setTimeout(() => setCopiedFcmToken(false), 2500);
    } catch {
      // Clipboard fallback ignored
    }
  };

  const grantableRoles = useMemo(() => {
    if (effectiveRole === 'super_admin') return ALL_ROLES;
    return ALL_ROLES.filter((r) => r !== 'super_admin');
  }, [effectiveRole]);

  const filteredAuditLogs = useMemo(() => {
    const q = auditSearch.trim().toLowerCase();
    return auditLogs.filter((log) => {
      if (auditModuleFilter !== 'all' && log.module !== auditModuleFilter) return false;
      if (!q) return true;
      return (
        log.action.toLowerCase().includes(q) ||
        log.actorEmail.toLowerCase().includes(q) ||
        log.targetLabel.toLowerCase().includes(q) ||
        log.details.toLowerCase().includes(q)
      );
    });
  }, [auditLogs, auditSearch, auditModuleFilter]);

  const openProvisionModal = () => {
    setErrorMsg(null);
    setNewUid('');
    setNewEmail('');
    setNewName('');
    setNewRole('order_manager');
    setNewDept('Pharmacy Operations');
    setNewLicense('');
    setProvisionOpen(true);
  };

  const openEditModal = (member: StaffMember) => {
    setErrorMsg(null);
    setEditingStaff(member);
    setEditName(member.displayName);
    setEditRole(member.role);
    setEditStatus(member.status);
    setEditDept(member.department);
    setEditLicense(member.licenseNumber);
  };

  const handleSaveMyPassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    if (myNewPassword.length < 6) {
      setErrorMsg('পাসওয়ার্ড কমপক্ষে ৬ অক্ষরের হতে হবে। (Password must be at least 6 characters.)');
      return;
    }
    if (myNewPassword !== myConfirmPassword) {
      setErrorMsg('দুই ঘরের পাসওয়ার্ড মিলছে না। (Passwords do not match.)');
      return;
    }
    setSavingMyPassword(true);
    try {
      const msg = await setOrUpdateCurrentAccountPassword(myNewPassword);
      setPasswordModalOpen(false);
      setMyNewPassword('');
      setMyConfirmPassword('');
      setSuccessMsg(msg);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save login password.');
    } finally {
      setSavingMyPassword(false);
    }
  };

  const handleProvisionStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canManageStaff) return;
    if (!newUid.trim() || !newEmail.trim() || !newName.trim()) {
      setErrorMsg('Firebase Auth UID, verified email, and display name are required.');
      return;
    }
    if (effectiveRole !== 'super_admin' && newRole === 'super_admin') {
      setErrorMsg('Only a Super Admin can grant the super_admin role.');
      return;
    }
    setSavingStaff(true);
    setErrorMsg(null);
    try {
      await provisionStaffAccount(actor, {
        uid: newUid,
        email: newEmail,
        displayName: newName,
        role: newRole,
        department: newDept,
        licenseNumber: newLicense,
      });
      setProvisionOpen(false);
      setSuccessMsg(`Provisioned staff member ${newEmail} (${ROLE_PERMISSIONS[newRole].label}).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to provision staff account.');
    } finally {
      setSavingStaff(false);
    }
  };

  const handleUpdateStaff = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !editingStaff || !permissions?.canManageStaff) return;
    if (effectiveRole !== 'super_admin' && (editingStaff.role === 'super_admin' || editRole === 'super_admin')) {
      setErrorMsg('Store Administrators cannot modify or promote Super Admin accounts.');
      return;
    }
    setSavingStaff(true);
    setErrorMsg(null);
    try {
      await updateStaffMemberRecord(actor, editingStaff, {
        displayName: editName,
        role: editRole,
        status: editStatus,
        department: editDept,
        licenseNumber: editLicense,
      });
      setEditingStaff(null);
      setSuccessMsg(`Updated staff profile for ${editingStaff.email}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update staff record.');
    } finally {
      setSavingStaff(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Staff Roles, RBAC &amp; Audit Trail
          </h1>
          <p className="text-sm text-[#64748B]">
            Manage verified pharmacy personnel, role-based access rules, multi-factor authentication posture, and append-only administrative logs.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <div className="inline-flex bg-white border border-[#E6ECEF] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setTab('directory')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'directory'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              Staff Directory
            </button>
            <button
              type="button"
              onClick={() => setTab('matrix')}
              className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'matrix'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              RBAC Matrix
            </button>
            {permissions?.canViewAuditLogs && (
              <button
                type="button"
                onClick={() => setTab('audit')}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  tab === 'audit'
                    ? 'bg-[#0D7E74] text-white'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                Audit Logs ({auditLogs.length})
              </button>
            )}
          </div>

          <button
            type="button"
            onClick={() => {
              setErrorMsg(null);
              setMyNewPassword('');
              setMyConfirmPassword('');
              setPasswordModalOpen(true);
            }}
            className="inline-flex items-center gap-2 px-3.5 py-2 text-xs font-medium text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F4F7F8] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <KeyRound className="w-3.5 h-3.5 text-[#0D7E74]" />
            <span>{hasPasswordProvider ? 'Change Login Password' : 'Set Email Password'}</span>
          </button>

          {permissions?.canManageStaff && (
            <button
              type="button"
              onClick={openProvisionModal}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Provision Staff
            </button>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-white border border-[#FCA5A5] rounded-xl p-4 flex items-start gap-3">
          <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
          <p className="text-sm text-[#991B1B]">{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5 text-sm text-[#15803D]">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-xs text-[#64748B] hover:text-[#0F172A] whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Security, Login Methods & MFA Posture Banner */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="flex items-start gap-3">
          <ShieldCheck className="w-5 h-5 text-[#0D7E74] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Privileged Provisioning &amp; Zero Self-Escalation
            </h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Customer accounts in <span className="font-mono text-[#0F172A]">/users</span> cannot self-escalate to staff. Only verified Super Admins or Store Admins can create <span className="font-mono text-[#0F172A]">/staffMembers/{'{uid}'}</span> records.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <Lock className="w-5 h-5 text-[#0D7E74] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              Email &amp; Password Login ·{' '}
              <span className="font-mono tabular-nums text-[#0D7E74]">
                {hasPasswordProvider ? 'Verified & Active' : 'Active'}
              </span>
            </h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Signed in as <span className="font-mono text-[#0F172A]">{user?.email}</span>. Email verification is enforced before any administrative session is authorized.
            </p>
          </div>
        </div>
        <div className="flex items-start gap-3">
          <KeyRound className="w-5 h-5 text-[#0D7E74] shrink-0 mt-0.5" />
          <div className="space-y-1">
            <h2 className="text-sm font-semibold text-[#0F172A]">
              MFA Posture ·{' '}
              <span className="font-mono tabular-nums">
                {mfaEnrolledCount > 0 ? `${mfaEnrolledCount} factor(s) active` : 'Verified Email Auth'}
              </span>
            </h2>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Mandatory Firebase email verification is active. Enable Identity Platform MFA in Firebase Console for SMS/TOTP second factors.
            </p>
          </div>
        </div>
      </div>

      {/* Firebase Cloud Messaging Web Push (VAPID Key Pair) Card */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div className="flex items-start gap-3 min-w-0">
          <Bell className="w-5 h-5 text-[#0D7E74] shrink-0 mt-0.5" />
          <div className="space-y-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Firebase Cloud Messaging (Web Push Certificate Key Pair)
              </h2>
              <span
                className={`text-xs font-mono tabular-nums font-semibold ${
                  pushEnv?.savedToken && pushEnv.permission === 'granted'
                    ? 'text-[#15803D]'
                    : pushEnv?.vapidKey
                    ? 'text-[#0D7E74]'
                    : 'text-[#B45309]'
                }`}
              >
                {pushEnv?.savedToken && pushEnv.permission === 'granted'
                  ? 'Active on This Browser'
                  : pushEnv?.vapidKey
                  ? 'Key Pair Connected'
                  : 'Key Pair Missing'}
              </span>
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Public VAPID Key Pair:{' '}
              <span className="font-mono text-[#0F172A]">
                {pushEnv?.vapidKeyMasked || 'Loading...'}
              </span>
              {pushEnv?.messagingSenderId ? (
                <>
                  {' '}
                  · Sender ID:{' '}
                  <span className="font-mono text-[#0F172A]">{pushEnv.messagingSenderId}</span>
                </>
              ) : null}
              {' · '}
              Browser Permission:{' '}
              <span className="font-mono text-[#0F172A]">{pushEnv?.permission || 'checking'}</span>
            </p>
            {pushEnv?.reasonIfUnsupported && (
              <p className="text-[11px] text-[#64748B] leading-relaxed">
                {pushEnv.reasonIfUnsupported}
              </p>
            )}
          </div>
        </div>

        <div className="flex items-center gap-2 flex-wrap shrink-0">
          {pushEnv?.savedToken && (
            <>
              <button
                type="button"
                onClick={handleCopyFcmToken}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E7F1F0] border border-[#E6ECEF] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Copy className="w-3.5 h-3.5 text-[#0D7E74]" />
                <span>{copiedFcmToken ? 'Token Copied' : 'Copy FCM Token'}</span>
              </button>
              <button
                type="button"
                onClick={handleTestPushNotification}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-white hover:bg-[#F4F7F8] border border-[#E6ECEF] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Send className="w-3.5 h-3.5 text-[#0D7E74]" />
                <span>Send Test Alert</span>
              </button>
              <button
                type="button"
                disabled={pushBusy}
                onClick={handleDisablePush}
                className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#DC2626] bg-white hover:bg-[#FEF2F2] border border-[#E6ECEF] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <BellOff className="w-3.5 h-3.5" />
                <span>Disable</span>
              </button>
            </>
          )}

          <button
            type="button"
            disabled={pushBusy || Boolean(pushEnv && !pushEnv.supported)}
            onClick={handleEnablePush}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Bell className="w-3.5 h-3.5" />
            <span>
              {pushBusy
                ? 'Connecting...'
                : pushEnv?.savedToken
                ? 'Refresh Push Token'
                : 'Enable Push Alerts'}
            </span>
          </button>
        </div>
      </div>

      {passwordModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="set-password-title"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 id="set-password-title" className="text-base font-semibold text-[#0F172A]">
                {hasPasswordProvider ? 'Update Email Login Password' : 'Set Password for Email Login'}
              </h2>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveMyPassword} className="p-6 space-y-4">
              <p className="text-xs text-[#64748B] leading-relaxed">
                আপনার <span className="font-mono text-[#0F172A]">{user?.email}</span> অ্যাডমিন অ্যাকাউন্টের লগইন পাসওয়ার্ড নিচে থেকে পরিবর্তন বা আপডেট করুন।
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  New Password (কমপক্ষে ৬ অক্ষর) *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={myNewPassword}
                  onChange={(e) => setMyNewPassword(e.target.value)}
                  placeholder="Enter 6+ character password"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Confirm Password *
                </label>
                <input
                  type="password"
                  required
                  minLength={6}
                  value={myConfirmPassword}
                  onChange={(e) => setMyConfirmPassword(e.target.value)}
                  placeholder="Re-enter password"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-[#EEF2F6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingMyPassword}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {savingMyPassword ? 'Saving...' : 'Save Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {tab === 'directory' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Authorized Pharmacy Staff Directory
            </h2>
            <span className="text-xs font-mono tabular-nums text-[#64748B]">
              {staffMembers.length} staff record(s)
            </span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <th className="py-3 px-6">Staff Member</th>
                  <th className="py-3 px-4">Role &amp; Department</th>
                  <th className="py-3 px-4">Clinical License</th>
                  <th className="py-3 px-4">Standing</th>
                  <th className="py-3 px-4">Updated</th>
                  <th className="py-3 px-6 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6] text-sm">
                {staffMembers.map((m) => {
                  const canEditRow =
                    permissions?.canManageStaff &&
                    (effectiveRole === 'super_admin' || m.role !== 'super_admin');
                  return (
                    <tr key={m.id} className="hover:bg-[#F8FAFB] transition-colors">
                      <td className="py-4 px-6">
                        <div className="font-semibold text-[#0F172A]">{m.displayName}</div>
                        <div className="text-xs text-[#64748B]">{m.email}</div>
                        <div className="text-[11px] font-mono text-[#64748B] mt-0.5">
                          UID: {m.uid}
                        </div>
                      </td>
                      <td className="py-4 px-4">
                        <div className="font-medium text-[#0F172A]">
                          {ROLE_PERMISSIONS[m.role]?.label || m.role}
                        </div>
                        <div className="text-xs text-[#64748B]">{m.department}</div>
                      </td>
                      <td className="py-4 px-4 font-mono text-xs text-[#0F172A]">
                        {m.licenseNumber || '—'}
                      </td>
                      <td className="py-4 px-4">
                        {m.status === 'active' ? (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#15803D]">
                            <UserCheck className="w-3.5 h-3.5" />
                            Active
                          </span>
                        ) : (
                          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-[#DC2626]">
                            <UserX className="w-3.5 h-3.5" />
                            Suspended
                          </span>
                        )}
                      </td>
                      <td className="py-4 px-4 text-xs font-mono tabular-nums text-[#64748B]">
                        {formatTimestamp(m.updatedAt)}
                      </td>
                      <td className="py-4 px-6 text-right">
                        {canEditRow ? (
                          <button
                            type="button"
                            onClick={() => openEditModal(m)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F4F7F8] rounded-lg whitespace-nowrap shrink-0"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            Manage
                          </button>
                        ) : (
                          <span className="text-xs text-[#64748B]">Protected</span>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'matrix' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF2F6]">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Role-Based Access Control (RBAC) Capability Matrix
            </h2>
            <p className="text-xs text-[#64748B]">
              Enforced across UI controls, Express server routes, and Firestore/Storage Security Rules.
            </p>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                  <th className="py-3 px-6">Role</th>
                  <th className="py-3 px-3 text-center">Catalog</th>
                  <th className="py-3 px-3 text-center">Pricing</th>
                  <th className="py-3 px-3 text-center">Batches &amp; Cost</th>
                  <th className="py-3 px-3 text-center">Orders</th>
                  <th className="py-3 px-3 text-center">Clinical Rx</th>
                  <th className="py-3 px-3 text-center">Customer PII</th>
                  <th className="py-3 px-3 text-center">CMS &amp; Coupons</th>
                  <th className="py-3 px-3 text-center">Staff &amp; Audit</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6]">
                {ALL_ROLES.map((roleKey) => {
                  const r = ROLE_PERMISSIONS[roleKey];
                  const mark = (ok: boolean) =>
                    ok ? (
                      <span className="font-semibold text-[#15803D]">Allowed</span>
                    ) : (
                      <span className="text-[#9CA8A1]">—</span>
                    );
                  return (
                    <tr key={roleKey} className="hover:bg-[#F8FAFB]">
                      <td className="py-3.5 px-6">
                        <div className="font-semibold text-[#0F172A]">{r.label}</div>
                        <div className="text-[11px] text-[#64748B] max-w-xs">{r.description}</div>
                      </td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canManageCatalog)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canEditPricing)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canViewWholesaleCosts)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canManageOrders)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canReviewPrescriptions)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canViewCustomerPii)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canManageCms)}</td>
                      <td className="py-3.5 px-3 text-center">{mark(r.canManageStaff)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'audit' && permissions?.canViewAuditLogs && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Lock className="w-4 h-4 text-[#0D7E74]" />
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Immutable Administrative Audit Stream
                </h2>
                <p className="text-xs text-[#64748B]">
                  Protected by <span className="font-mono text-[#0F172A]">allow update, delete: if false;</span> in Firestore Security Rules.
                </p>
              </div>
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <div className="relative">
                <Search className="w-3.5 h-3.5 text-[#64748B] absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={auditSearch}
                  onChange={(e) => setAuditSearch(e.target.value)}
                  placeholder="Search actor, action, target..."
                  className="pl-8 pr-3 py-1.5 text-xs border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>
              <select
                value={auditModuleFilter}
                onChange={(e) =>
                  setAuditModuleFilter(e.target.value as 'all' | AdminAuditLog['module'])
                }
                className="px-3 py-1.5 text-xs border border-[#E6ECEF] rounded-lg bg-white"
              >
                <option value="all">All Modules</option>
                <option value="auth">Auth</option>
                <option value="products">Products</option>
                <option value="categories">Categories</option>
                <option value="inventory">Inventory</option>
                <option value="orders">Orders</option>
                <option value="prescriptions">Prescriptions</option>
                <option value="customers">Customers</option>
                <option value="payments">Payments &amp; Delivery</option>
                <option value="cms">CMS</option>
                <option value="coupons">Coupons</option>
                <option value="staff">Staff</option>
              </select>
            </div>
          </div>

          {filteredAuditLogs.length === 0 ? (
            <div className="p-8 text-center text-sm text-[#64748B]">
              No administrative audit entries match the current filter.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-3 px-6">Timestamp</th>
                    <th className="py-3 px-4">Actor</th>
                    <th className="py-3 px-4">Module · Action</th>
                    <th className="py-3 px-4">Target</th>
                    <th className="py-3 px-6">Recorded Details</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {filteredAuditLogs.slice(0, 100).map((log) => (
                    <tr key={log.id} className="hover:bg-[#F8FAFB]">
                      <td className="py-3 px-6 text-xs font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-3 px-4 text-xs">
                        <div className="font-medium text-[#0F172A]">{log.actorEmail}</div>
                        <div className="text-[#64748B] font-mono">{log.actorRole}</div>
                      </td>
                      <td className="py-3 px-4 text-xs font-mono text-[#0F172A]">
                        {log.module.toUpperCase()} · {log.action}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#0F172A]">{log.targetLabel}</td>
                      <td className="py-3 px-6 text-xs text-[#64748B] max-w-md">{log.details}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Provision Staff Modal */}
      {provisionOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="provision-staff-title"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 id="provision-staff-title" className="text-lg font-semibold text-[#0F172A]">
                Provision Authorized Staff Account
              </h2>
              <button
                type="button"
                onClick={() => setProvisionOpen(false)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleProvisionStaff} className="p-6 space-y-4">
              <p className="text-xs text-[#64748B] leading-relaxed">
                Have the staff member sign in once on the Admin Login screen to copy their verified Firebase Auth UID, then register their UID and role below.
              </p>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Firebase Auth UID *
                </label>
                <input
                  type="text"
                  required
                  value={newUid}
                  onChange={(e) => setNewUid(e.target.value)}
                  placeholder="Paste 28-character Firebase UID"
                  className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Verified Email *
                  </label>
                  <input
                    type="email"
                    required
                    value={newEmail}
                    onChange={(e) => setNewEmail(e.target.value)}
                    placeholder="pharmacist@domain.com"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Full Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={newName}
                    onChange={(e) => setNewName(e.target.value)}
                    placeholder="Dr. / Pharmacist Name"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Assigned Role *
                  </label>
                  <select
                    value={newRole}
                    onChange={(e) => setNewRole(e.target.value as StaffRole)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    {grantableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_PERMISSIONS[r].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={newDept}
                    onChange={(e) => setNewDept(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Pharmacy Council / BMDC License Number (Required for Prescription Reviewers)
                </label>
                <input
                  type="text"
                  value={newLicense}
                  onChange={(e) => setNewLicense(e.target.value)}
                  placeholder="e.g., BPC-A-10492"
                  className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="pt-3 border-t border-[#EEF2F6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setProvisionOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {savingStaff ? 'Provisioning...' : 'Provision Staff'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit Staff Modal */}
      {editingStaff && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="edit-staff-title"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-lg w-full">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 id="edit-staff-title" className="text-lg font-semibold text-[#0F172A]">
                Manage Staff Profile · {editingStaff.email}
              </h2>
              <button
                type="button"
                onClick={() => setEditingStaff(null)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleUpdateStaff} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Display Name *
                </label>
                <input
                  type="text"
                  required
                  value={editName}
                  onChange={(e) => setEditName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Role
                  </label>
                  <select
                    value={editRole}
                    onChange={(e) => setEditRole(e.target.value as StaffRole)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    {grantableRoles.map((r) => (
                      <option key={r} value={r}>
                        {ROLE_PERMISSIONS[r].label}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Account Standing
                  </label>
                  <select
                    value={editStatus}
                    onChange={(e) => setEditStatus(e.target.value as 'active' | 'suspended')}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="suspended">Suspended (Immediate Revocation)</option>
                  </select>
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Department
                  </label>
                  <input
                    type="text"
                    value={editDept}
                    onChange={(e) => setEditDept(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Clinical License Number
                  </label>
                  <input
                    type="text"
                    value={editLicense}
                    onChange={(e) => setEditLicense(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="pt-3 border-t border-[#EEF2F6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setEditingStaff(null)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingStaff}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {savingStaff ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
