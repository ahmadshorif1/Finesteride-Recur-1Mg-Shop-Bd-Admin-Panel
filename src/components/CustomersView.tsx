import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  Eye,
  LifeBuoy,
  Lock,
  Search,
  UserCheck,
  Users,
  UserX,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { formatBdt, formatTimestamp } from '../lib/validation';
import {
  fetchCustomerPrivatePii,
  updateCustomerStanding,
  updateSupportTicketStatus,
} from '../services/pharmacyService';
import type { SupportTicket, UserAccount, UserPrivateProfile } from '../types/pharmacy';

export function CustomersView() {
  const { permissions } = useAuth();
  const { actor, customers, orders, supportTickets } = useStoreData();

  const [tab, setTab] = useState<'directory' | 'support'>('directory');
  const [searchQuery, setSearchQuery] = useState('');

  const [selectedCustomer, setSelectedCustomer] = useState<UserAccount | null>(null);
  const [customerPii, setCustomerPii] = useState<UserPrivateProfile | null>(null);
  const [loadingPii, setLoadingPii] = useState(false);

  const [standingTarget, setStandingTarget] = useState<{
    customer: UserAccount;
    nextStatus: UserAccount['accountStatus'];
  } | null>(null);
  const [standingReason, setStandingReason] = useState('');

  const [activeTicket, setActiveTicket] = useState<SupportTicket | null>(null);
  const [ticketPriority, setTicketPriority] = useState<SupportTicket['priority']>('medium');
  const [ticketStatus, setTicketStatus] = useState<SupportTicket['status']>('in_progress');
  const [ticketNote, setTicketNote] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const filteredCustomers = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return customers.filter((c) => {
      if (!q) return true;
      return `${c.displayName} ${c.uid} ${c.accountStatus}`.toLowerCase().includes(q);
    });
  }, [customers, searchQuery]);

  const inspectCustomer = async (cust: UserAccount) => {
    setErrorMsg(null);
    setSelectedCustomer(cust);
    setCustomerPii(null);
    if (permissions?.canViewCustomerPii) {
      setLoadingPii(true);
      try {
        const pii = await fetchCustomerPrivatePii(cust.uid);
        setCustomerPii(pii);
      } catch (err) {
        setErrorMsg(err instanceof Error ? err.message : 'Unable to read isolated PII profile.');
      } finally {
        setLoadingPii(false);
      }
    }
  };

  const customerOrders = useMemo(() => {
    if (!selectedCustomer) return [];
    return orders.filter((o) => o.customerId === selectedCustomer.uid);
  }, [orders, selectedCustomer]);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Customer Accounts &amp; Support Desk
          </h1>
          <p className="text-sm text-[#64748B]">
            Manage customer standing, inspect role-isolated PII subcollections, review order histories, and resolve support or deletion requests.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EEF4F0] rounded-lg self-start">
          <button
            type="button"
            onClick={() => setTab('directory')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'directory' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
            }`}
          >
            Customers ({customers.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('support')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'support' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
            }`}
          >
            Support &amp; Deletion Requests ({supportTickets.length})
          </button>
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#991B1B] flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {tab === 'directory' ? (
        <>
          <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 flex flex-col sm:flex-row items-center justify-between gap-4">
            <div className="relative w-full sm:max-w-sm">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search customer name or UID..."
                className="w-full pl-9 pr-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
              />
            </div>
            <p className="text-xs text-[#64748B] flex items-center gap-1.5">
              <Lock className="w-3.5 h-3.5 text-[#0D7E74]" />
              Personal contact details are isolated in <code className="font-mono">/users/&#123;uid&#125;/privateProfile/pii</code>
            </p>
          </div>

          <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            {filteredCustomers.length === 0 ? (
              <div className="p-12 text-center space-y-2">
                <Users className="w-8 h-8 text-[#64748B] mx-auto" />
                <h2 className="text-base font-semibold text-[#0F172A]">
                  No Customer Profiles Registered Yet
                </h2>
                <p className="text-sm text-[#64748B] max-w-md mx-auto">
                  Customer accounts created through the Customer Panel (or via atomic checkout verification) appear here automatically.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                      <th className="py-3 px-6">Customer Name &amp; UID</th>
                      <th className="py-3 px-4 text-right">Orders</th>
                      <th className="py-3 px-4 text-right">Total Spend</th>
                      <th className="py-3 px-4">Account Standing</th>
                      <th className="py-3 px-4">Registered</th>
                      <th className="py-3 px-6 text-right">Actions</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F6] text-sm">
                    {filteredCustomers.map((c) => (
                      <tr key={c.id} className="hover:bg-[#F7FAF8]">
                        <td className="py-3 px-6">
                          <p className="font-semibold text-[#0F172A]">{c.displayName}</p>
                          <p className="text-xs font-mono text-[#64748B]">{c.uid}</p>
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                          {c.orderCount}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs font-semibold">
                          {formatBdt(c.totalSpentBdt)}
                        </td>
                        <td className="py-3 px-4 text-xs capitalize">
                          <span
                            className={
                              c.accountStatus === 'active'
                                ? 'text-[#0D7E74] font-medium'
                                : c.accountStatus === 'deletion_requested'
                                ? 'text-[#D97706] font-medium'
                                : 'text-[#DC2626] font-medium'
                            }
                          >
                            {c.accountStatus.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#64748B]">
                          {formatTimestamp(c.createdAt)}
                        </td>
                        <td className="py-3 px-6 text-right">
                          <div className="inline-flex items-center gap-2">
                            <button
                              type="button"
                              onClick={() => void inspectCustomer(c)}
                              className="p-1.5 text-[#0D7E74] hover:bg-[#EEF4F0] rounded-md"
                              title="Inspect Profile & Orders"
                            >
                              <Eye className="w-4 h-4" />
                            </button>
                            {permissions?.canManageCustomers && (
                              <button
                                type="button"
                                onClick={() => {
                                  setStandingReason('');
                                  setStandingTarget({
                                    customer: c,
                                    nextStatus:
                                      c.accountStatus === 'suspended' ? 'active' : 'suspended',
                                  });
                                }}
                                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-md"
                                title={
                                  c.accountStatus === 'suspended'
                                    ? 'Reactivate Customer Account'
                                    : 'Suspend Customer Account'
                                }
                              >
                                {c.accountStatus === 'suspended' ? (
                                  <UserCheck className="w-4 h-4 text-[#0D7E74]" />
                                ) : (
                                  <UserX className="w-4 h-4 text-[#DC2626]" />
                                )}
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      ) : (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          {supportTickets.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <LifeBuoy className="w-8 h-8 text-[#64748B] mx-auto" />
              <h2 className="text-base font-semibold text-[#0F172A]">
                No Open Customer Support or Deletion Requests
              </h2>
              <p className="text-sm text-[#64748B] max-w-md mx-auto">
                Support tickets and GDPR/policy account deletion requests submitted from the Customer Panel appear here.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-6">Ticket #</th>
                    <th className="py-3 px-4">Customer</th>
                    <th className="py-3 px-4">Subject &amp; Category</th>
                    <th className="py-3 px-4">Priority</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right">Manage</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {supportTickets.map((t) => (
                    <tr key={t.id} className="hover:bg-[#F7FAF8]">
                      <td className="py-3 px-6 font-mono text-xs font-semibold text-[#0F172A]">
                        {t.ticketNumber}
                      </td>
                      <td className="py-3 px-4 text-xs text-[#0F172A]">{t.customerName}</td>
                      <td className="py-3 px-4 text-xs">
                        <p className="font-medium text-[#0F172A]">{t.subject}</p>
                        <p className="text-[#64748B] capitalize">{t.category.replace(/_/g, ' ')}</p>
                      </td>
                      <td className="py-3 px-4 text-xs capitalize text-[#64748B]">{t.priority}</td>
                      <td className="py-3 px-4 text-xs capitalize font-medium text-[#0F172A]">
                        {t.status.replace(/_/g, ' ')}
                      </td>
                      <td className="py-3 px-6 text-right">
                        {permissions?.canManageSupport && (
                          <button
                            type="button"
                            onClick={() => {
                              setActiveTicket(t);
                              setTicketPriority(t.priority);
                              setTicketStatus(t.status);
                              setTicketNote(t.staffResolutionNote);
                            }}
                            className="px-3 py-1.5 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg whitespace-nowrap shrink-0"
                          >
                            Resolve
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Customer Profile & Order History Modal */}
      {selectedCustomer && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-[#EEF2F6] pb-3">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  {selectedCustomer.displayName}
                </h2>
                <p className="text-xs font-mono text-[#64748B]">
                  UID: {selectedCustomer.uid} · Standing: {selectedCustomer.accountStatus}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedCustomer(null)}
                className="p-1 text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-[#F4F8F6] border border-[#E6ECEF] rounded-lg space-y-1.5 text-xs">
              <p className="font-semibold text-[#0F172A]">Isolated PII Record</p>
              {!permissions?.canViewCustomerPii ? (
                <p className="text-[#64748B]">
                  Your role ({actor?.role}) does not include permission to inspect customer PII.
                </p>
              ) : loadingPii ? (
                <p className="text-[#64748B]">Loading isolated PII subcollection...</p>
              ) : customerPii ? (
                <div className="space-y-1 font-mono text-[#0F172A]">
                  <p>Email: {customerPii.email}</p>
                  <p>Phone: {customerPii.phone}</p>
                  <p>Address: {customerPii.deliveryAddress}</p>
                  <p>Zone: {customerPii.deliveryZone}</p>
                </div>
              ) : (
                <p className="text-[#64748B]">No private PII subdocument stored yet.</p>
              )}
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-[#0F172A]">
                Customer Order History ({customerOrders.length})
              </h3>
              {customerOrders.length === 0 ? (
                <p className="text-xs text-[#64748B]">No orders found for this customer.</p>
              ) : (
                <div className="divide-y divide-[#EEF2F6] border border-[#E6ECEF] rounded-lg">
                  {customerOrders.map((o) => (
                    <div
                      key={o.id}
                      className="p-3 flex items-center justify-between text-xs"
                    >
                      <div>
                        <p className="font-mono font-semibold text-[#0F172A]">
                          {o.orderNumber} · {o.itemsSummary}
                        </p>
                        <p className="text-[#64748B]">{formatTimestamp(o.createdAt)}</p>
                      </div>
                      <div className="text-right font-mono tabular-nums">
                        <p className="font-semibold text-[#0F172A]">{formatBdt(o.totalAmountBdt)}</p>
                        <p className="capitalize text-[#64748B]">{o.orderStatus.replace(/_/g, ' ')}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <p className="text-[11px] text-[#64748B] leading-relaxed border-t border-[#EEF2F6] pt-3">
              Account Deletion Policy Note: Suspending or deleting a Firestore profile document does not automatically delete the underlying Firebase Authentication user record. Firebase Auth account deletion must be completed via Firebase Identity Toolkit Admin API after statutory pharmacy prescription retention periods expire.
            </p>
          </div>
        </div>
      )}

      {/* Suspend / Reactivate Confirmation Dialog */}
      {standingTarget && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F172A]">
              {standingTarget.nextStatus === 'suspended' ? 'Suspend' : 'Reactivate'} Account:{' '}
              {standingTarget.customer.displayName}?
            </h3>
            <div>
              <label className="block text-xs font-medium text-[#0F172A] mb-1">
                Audit Reason *
              </label>
              <input
                type="text"
                required
                value={standingReason}
                onChange={(e) => setStandingReason(e.target.value)}
                placeholder="Documented policy reason..."
                className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
              />
            </div>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setStandingTarget(null)}
                className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving || standingReason.trim().length < 3}
                onClick={async () => {
                  setSaving(true);
                  setErrorMsg(null);
                  try {
                    await updateCustomerStanding(
                      actor,
                      standingTarget.customer,
                      standingTarget.nextStatus,
                      standingReason
                    );
                    setStandingTarget(null);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Update failed.');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
              >
                Confirm Change
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Support Ticket Resolution Modal */}
      {activeTicket && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-lg w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-3">
              <h3 className="text-base font-bold text-[#0F172A]">
                Ticket {activeTicket.ticketNumber}
              </h3>
              <button
                type="button"
                onClick={() => setActiveTicket(null)}
                className="p-1 text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <p className="text-xs text-[#64748B] bg-[#F4F8F6] p-3 rounded-lg">
              {activeTicket.message}
            </p>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">Priority</label>
                <select
                  value={ticketPriority}
                  onChange={(e) => setTicketPriority(e.target.value as SupportTicket['priority'])}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                </select>
              </div>
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">Status</label>
                <select
                  value={ticketStatus}
                  onChange={(e) => setTicketStatus(e.target.value as SupportTicket['status'])}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="open">Open</option>
                  <option value="in_progress">In Progress</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed (Terminal)</option>
                </select>
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-[#0F172A] mb-1">
                Staff Resolution Note
              </label>
              <textarea
                rows={3}
                value={ticketNote}
                onChange={(e) => setTicketNote(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
              />
            </div>

            <div className="flex justify-end gap-3">
              <button
                type="button"
                onClick={() => setActiveTicket(null)}
                className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={async () => {
                  setSaving(true);
                  setErrorMsg(null);
                  try {
                    await updateSupportTicketStatus(actor, activeTicket, {
                      priority: ticketPriority,
                      status: ticketStatus,
                      staffResolutionNote: ticketNote,
                    });
                    setActiveTicket(null);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Ticket update failed.');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] rounded-lg whitespace-nowrap shrink-0"
              >
                Save Resolution
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
