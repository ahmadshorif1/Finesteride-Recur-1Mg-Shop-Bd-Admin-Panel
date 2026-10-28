import React, { useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ExternalLink,
  FileCheck2,
  HelpCircle,
  ShieldAlert,
  X,
  XCircle,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { formatTimestamp } from '../lib/validation';
import { reviewPrescriptionSubmission } from '../services/pharmacyService';
import type { PrescriptionReview } from '../types/pharmacy';

export function PrescriptionsView() {
  const { permissions } = useAuth();
  const { actor, prescriptionReviews, orders } = useStoreData();

  const [filter, setFilter] = useState<'all' | PrescriptionReview['reviewStatus']>('all');
  const [activeReview, setActiveReview] = useState<PrescriptionReview | null>(null);
  const [decisionStatus, setDecisionStatus] =
    useState<PrescriptionReview['reviewStatus']>('approved');
  const [reviewerLicense, setReviewerLicense] = useState(actor?.licenseNumber || '');
  const [reviewNotes, setReviewNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const visibleReviews = prescriptionReviews.filter(
    (r) => filter === 'all' || r.reviewStatus === filter
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Clinical Prescription &amp; Medicine Safety Review
          </h1>
          <p className="text-sm text-[#64748B]">
            Orders containing prescription-only medicines are strictly locked until approved by an authorized reviewer with recorded registration credentials.
          </p>
        </div>

        <div className="flex items-center gap-1 p-1 bg-[#EEF4F0] rounded-lg self-start">
          {(['all', 'pending_review', 'approved', 'more_info_requested', 'rejected'] as const).map(
            (st) => (
              <button
                key={st}
                type="button"
                onClick={() => setFilter(st)}
                className={`px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                  filter === st
                    ? 'bg-white text-[#0F172A] shadow-xs'
                    : 'text-[#64748B] hover:text-[#0F172A]'
                }`}
              >
                {st === 'all'
                  ? 'All'
                  : st === 'pending_review'
                  ? 'Pending'
                  : st === 'more_info_requested'
                  ? 'More Info'
                  : st.charAt(0).toUpperCase() + st.slice(1)}
              </button>
            )
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#991B1B] flex items-start gap-2.5">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
        {visibleReviews.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <FileCheck2 className="w-8 h-8 text-[#64748B] mx-auto" />
            <h2 className="text-base font-semibold text-[#0F172A]">
              No Prescription Submissions in Queue
            </h2>
            <p className="text-sm text-[#64748B] max-w-md mx-auto">
              Prescription files are isolated from public access and appear here when a customer places an order containing a Prescription Required item.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                  <th className="py-3 px-6">Order # &amp; Submitted</th>
                  <th className="py-3 px-4">Patient / Customer</th>
                  <th className="py-3 px-4">Prescriber &amp; Chamber</th>
                  <th className="py-3 px-4">Gated Medicine(s)</th>
                  <th className="py-3 px-4">Review Status</th>
                  <th className="py-3 px-6 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6] text-sm">
                {visibleReviews.map((rev) => (
                  <tr key={rev.id} className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <p className="font-mono font-semibold text-xs text-[#0F172A]">
                        {rev.orderNumber}
                      </p>
                      <p className="text-[11px] font-mono text-[#64748B]">
                        {formatTimestamp(rev.createdAt)}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="font-medium text-[#0F172A]">{rev.customerName}</p>
                      <p className="font-mono text-[#64748B]">Issued: {rev.prescriptionIssueDate}</p>
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="font-medium text-[#0F172A]">{rev.prescriberName}</p>
                      <p className="text-[#64748B]">{rev.clinicOrHospital || '—'}</p>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#0F172A] max-w-xs truncate">
                      {rev.medicineSummary}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      {rev.reviewStatus === 'approved' ? (
                        <span className="inline-flex items-center gap-1 text-[#0D7E74] font-medium">
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          Approved ({rev.reviewerLicense})
                        </span>
                      ) : rev.reviewStatus === 'rejected' ? (
                        <span className="inline-flex items-center gap-1 text-[#DC2626] font-medium">
                          <XCircle className="w-3.5 h-3.5" />
                          Rejected
                        </span>
                      ) : rev.reviewStatus === 'more_info_requested' ? (
                        <span className="inline-flex items-center gap-1 text-[#D97706] font-medium">
                          <HelpCircle className="w-3.5 h-3.5" />
                          Info Requested
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 text-[#D97706] font-medium">
                          <ShieldAlert className="w-3.5 h-3.5" />
                          Pending Review
                        </span>
                      )}
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => {
                          setErrorMsg(null);
                          setActiveReview(rev);
                          setDecisionStatus(
                            rev.reviewStatus === 'pending_review' ? 'approved' : rev.reviewStatus
                          );
                          setReviewerLicense(rev.reviewerLicense || actor?.licenseNumber || '');
                          setReviewNotes(rev.reviewNotes || '');
                        }}
                        className="px-3 py-1.5 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg hover:bg-[#F2F8F4] whitespace-nowrap shrink-0"
                      >
                        {permissions?.canReviewPrescriptions ? 'Clinical Review' : 'Inspect'}
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Clinical Review Modal */}
      {activeReview && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between border-b border-[#EEF2F6] pb-3">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  Prescription Verification — Order{' '}
                  <span className="font-mono">{activeReview.orderNumber}</span>
                </h2>
                <p className="text-xs text-[#64748B]">
                  Bangladesh regulatory compliance: verify prescriber registration, issue date, dosage match, and patient identity before approval.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setActiveReview(null)}
                className="p-1 text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 bg-[#F4F8F6] border border-[#E6ECEF] rounded-lg space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-[#64748B]">Patient / Customer</span>
                <span className="font-semibold text-[#0F172A]">{activeReview.customerName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Prescribing Physician</span>
                <span className="font-semibold text-[#0F172A]">
                  {activeReview.prescriberName} ({activeReview.clinicOrHospital})
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Prescription Issue Date</span>
                <span className="font-mono text-[#0F172A]">{activeReview.prescriptionIssueDate}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[#64748B]">Requested Medicine(s)</span>
                <span className="font-semibold text-[#0F172A]">{activeReview.medicineSummary}</span>
              </div>
              <div className="pt-2 border-t border-[#E6ECEF] flex items-center justify-between">
                <span className="text-[#64748B]">Protected Document Reference</span>
                <a
                  href={activeReview.documentUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1 font-mono text-[#0D7E74] hover:underline"
                >
                  Open Protected Document <ExternalLink className="w-3.5 h-3.5" />
                </a>
              </div>
            </div>

            {permissions?.canReviewPrescriptions && actor ? (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  if (decisionStatus === 'pending_review') return;
                  setSaving(true);
                  setErrorMsg(null);
                  try {
                    const linkedOrder = orders.find((o) => o.id === activeReview.orderId);
                    await reviewPrescriptionSubmission(actor, activeReview, linkedOrder, {
                      reviewStatus: decisionStatus,
                      reviewerLicense,
                      reviewNotes,
                    });
                    setActiveReview(null);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Prescription review failed.');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="space-y-4"
              >
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-[#0F172A] mb-1">
                      Clinical Decision *
                    </label>
                    <select
                      value={decisionStatus}
                      onChange={(e) =>
                        setDecisionStatus(
                          e.target.value as 'approved' | 'rejected' | 'more_info_requested'
                        )
                      }
                      className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                    >
                      <option value="approved">Approve &amp; Unlock Order Confirmation</option>
                      <option value="more_info_requested">
                        Request Clearer Scan / Additional Info
                      </option>
                      <option value="rejected">Reject Prescription (Keep Order Blocked)</option>
                    </select>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-[#0F172A] mb-1">
                      Reviewer Pharmacy Council License *
                    </label>
                    <input
                      type="text"
                      required
                      minLength={3}
                      maxLength={64}
                      value={reviewerLicense}
                      onChange={(e) => setReviewerLicense(e.target.value)}
                      placeholder="e.g., BPC-A-10482"
                      className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Clinical Verification Notes *
                  </label>
                  <textarea
                    rows={3}
                    required
                    minLength={5}
                    maxLength={600}
                    value={reviewNotes}
                    onChange={(e) => setReviewNotes(e.target.value)}
                    placeholder="Verified BMDC reg, dosage strength matches Recur 1mg 30 tablets, valid within 6 months..."
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div className="flex justify-end gap-3 pt-2 border-t border-[#EEF2F6]">
                  <button
                    type="button"
                    onClick={() => setActiveReview(null)}
                    className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={saving}
                    className="px-5 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {saving ? 'Recording Decision...' : 'Record Clinical Decision'}
                  </button>
                </div>
              </form>
            ) : (
              <p className="text-xs text-[#64748B]">
                Only qualified Super Admin / Store Admin personnel with a Pharmacy Council registration number can approve or reject prescriptions.
              </p>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
