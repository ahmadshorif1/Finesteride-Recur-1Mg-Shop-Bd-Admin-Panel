import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  Clock,
  Download,
  Eye,
  FileWarning,
  Printer,
  Search,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { formatBdt, formatTimestamp } from '../lib/validation';
import {
  fetchOrderDetails,
  generateSanitizedCsvExport,
  recordPaymentDecision,
  transitionOrderStatus,
  type PaymentDecisionType,
} from '../services/pharmacyService';
import type {
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusHistory,
  PaymentMethod,
  PaymentStatus,
} from '../types/pharmacy';

const NEXT_STATUS_OPTIONS: Record<OrderStatus, OrderStatus[]> = {
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

export function OrdersView() {
  const { permissions } = useAuth();
  const { actor, orders } = useStoreData();

  const [searchQuery, setSearchQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | OrderStatus>('all');
  const [paymentFilter, setPaymentFilter] = useState<'all' | PaymentMethod>('all');
  const [paymentStatusFilter, setPaymentStatusFilter] = useState<'all' | PaymentStatus>('all');
  const [dateFrom, setDateFrom] = useState('');

  const [selectedOrder, setSelectedOrder] = useState<Order | null>(null);
  const [orderItems, setOrderItems] = useState<OrderItem[]>([]);
  const [orderHistory, setOrderHistory] = useState<OrderStatusHistory[]>([]);
  const [loadingDetails, setLoadingDetails] = useState(false);

  const [nextStatus, setNextStatus] = useState<OrderStatus>('confirmed');
  const [courierName, setCourierName] = useState('');
  const [trackingReference, setTrackingReference] = useState('');
  const [cancellationReason, setCancellationReason] = useState('');
  const [transitionNote, setTransitionNote] = useState('');

  const [paymentDecision, setPaymentDecision] = useState<PaymentDecisionType>('verify_paid');
  const [txnRefInput, setTxnRefInput] = useState('');
  const [paymentFailureReason, setPaymentFailureReason] = useState('');
  const [reconciliationConfirmed, setReconciliationConfirmed] = useState(false);

  const [busy, setBusy] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);

  const filteredOrders = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return orders.filter((o) => {
      if (statusFilter !== 'all' && o.orderStatus !== statusFilter) return false;
      if (paymentFilter !== 'all' && o.paymentMethod !== paymentFilter) return false;
      if (paymentStatusFilter !== 'all' && o.paymentStatus !== paymentStatusFilter) return false;
      if (dateFrom) {
        const orderIso = o.createdAt?.toDate ? o.createdAt.toDate().toISOString().slice(0, 10) : '';
        if (orderIso && orderIso < dateFrom) return false;
      }
      if (q) {
        const hay = `${o.orderNumber} ${o.customerId} ${o.customerName} ${o.customerPhone} ${o.transactionReference}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, searchQuery, statusFilter, paymentFilter, paymentStatusFilter, dateFrom]);

  const openOrderModal = async (order: Order) => {
    setErrorMsg(null);
    setSelectedOrder(order);
    const permitted = NEXT_STATUS_OPTIONS[order.orderStatus] || [];
    setNextStatus(permitted[0] || order.orderStatus);
    setCourierName(order.courierName || '');
    setTrackingReference(order.trackingReference || '');
    setCancellationReason(order.cancellationReason || '');
    setTransitionNote('');
    setPaymentDecision(
      order.paymentStatus === 'refund_pending' ? 'complete_refund' : 'verify_paid'
    );
    setTxnRefInput(order.transactionReference || '');
    setPaymentFailureReason('');
    setReconciliationConfirmed(false);

    setLoadingDetails(true);
    try {
      const details = await fetchOrderDetails(order.id);
      setOrderItems(details.items);
      setOrderHistory(details.history);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to load order subcollections.');
    } finally {
      setLoadingDetails(false);
    }
  };

  const handleExportOrdersCsv = async () => {
    if (!actor || filteredOrders.length === 0) return;
    setErrorMsg(null);
    setExportNotice(null);
    try {
      const rows = filteredOrders.map((o) => ({
        orderNumber: o.orderNumber,
        createdAt: o.createdAt?.toDate ? o.createdAt.toDate().toISOString() : '',
        customerId: o.customerId,
        customerName: o.customerName,
        customerPhone: o.customerPhone,
        shippingAddress: o.shippingAddress,
        deliveryZone: o.deliveryZone,
        itemsSummary: o.itemsSummary,
        subtotalBdt: o.subtotalBdt,
        discountBdt: o.discountBdt,
        deliveryFeeBdt: o.deliveryFeeBdt,
        totalAmountBdt: o.totalAmountBdt,
        paymentMethod: o.paymentMethod,
        paymentStatus: o.paymentStatus,
        transactionReference: o.transactionReference,
        paymentVerifiedAt: o.paymentVerifiedAt,
        requiresPrescription: o.requiresPrescription,
        prescriptionReviewStatus: o.prescriptionReviewStatus,
        orderStatus: o.orderStatus,
      }));

      const res = await generateSanitizedCsvExport(actor, rows, Boolean(permissions?.canExportPii));
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `orders-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      setExportNotice(
        res.piiRedacted
          ? `Exported ${res.rowCount} order(s) with customer PII automatically redacted for your role.`
          : `Exported ${res.rowCount} authorized order record(s) to CSV.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Order CSV export failed.');
    }
  };

  // Sync live updates into open modal
  const liveSelectedOrder = selectedOrder
    ? orders.find((o) => o.id === selectedOrder.id) || selectedOrder
    : null;

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 no-print">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Order &amp; Fulfillment Management
          </h1>
          <p className="text-sm text-[#64748B]">
            Manage customer orders, clinical review holds, gateway settlement verification, courier tracking, and printable invoices.
          </p>
        </div>

        {permissions?.canExportReports && filteredOrders.length > 0 && (
          <button
            type="button"
            onClick={() => void handleExportOrdersCsv()}
            className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-[#0D7E74] border border-[#0D7E74] bg-white hover:bg-[#F2F8F4] rounded-lg transition-colors whitespace-nowrap shrink-0"
          >
            <Download className="w-4 h-4" />
            <span>Export Orders CSV</span>
          </button>
        )}
      </div>

      {errorMsg && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#991B1B] flex items-start gap-2.5 no-print">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {exportNotice && (
        <div className="bg-[#ECFDF5] border border-[#A7F3D0] rounded-xl p-4 text-sm text-[#065F46] flex items-center gap-2.5 no-print">
          <CheckCircle2 className="w-4 h-4 shrink-0" />
          <span>{exportNotice}</span>
        </div>
      )}

      {/* Search & Filters */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-3 no-print">
        <div className="relative">
          <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Order #, TrxID, or customer..."
            className="w-full pl-9 pr-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
          />
        </div>

        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
          className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
        >
          <option value="all">All Order Statuses</option>
          <option value="pending">Pending</option>
          <option value="awaiting_review">Awaiting Prescription Review</option>
          <option value="confirmed">Confirmed</option>
          <option value="processing">Processing</option>
          <option value="ready_for_dispatch">Ready for Dispatch</option>
          <option value="shipped">Shipped</option>
          <option value="delivered">Delivered</option>
          <option value="cancelled">Cancelled</option>
          <option value="refund_pending">Refund Pending</option>
          <option value="refunded">Refunded</option>
        </select>

        <select
          value={paymentFilter}
          onChange={(e) => setPaymentFilter(e.target.value as typeof paymentFilter)}
          className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
        >
          <option value="all">All Payment Methods</option>
          <option value="cod">Cash on Delivery (COD)</option>
          <option value="bkash">bKash</option>
          <option value="nagad">Nagad</option>
        </select>

        <select
          value={paymentStatusFilter}
          onChange={(e) => setPaymentStatusFilter(e.target.value as typeof paymentStatusFilter)}
          className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
        >
          <option value="all">All Payment Statuses</option>
          <option value="pending_verification">Pending Verification</option>
          <option value="unpaid">Unpaid (COD)</option>
          <option value="verified_paid">Verified Paid</option>
          <option value="refund_pending">Refund Pending</option>
          <option value="refunded">Refunded</option>
          <option value="failed">Failed / Rejected</option>
        </select>

        <input
          type="date"
          value={dateFrom}
          onChange={(e) => setDateFrom(e.target.value)}
          className="px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
          title="Filter orders placed on or after date"
        />
      </div>

      {/* Orders Table */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden no-print">
        {filteredOrders.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <Clock className="w-8 h-8 text-[#64748B] mx-auto" />
            <h2 className="text-base font-semibold text-[#0F172A]">No Matching Orders</h2>
            <p className="text-sm text-[#64748B] max-w-md mx-auto">
              Real customer orders from the shared Firestore database appear here. You can also place a real atomic verification order in Reports &amp; QA.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                  <th className="py-3 px-6">Order # &amp; Date</th>
                  <th className="py-3 px-4">Customer &amp; Zone</th>
                  <th className="py-3 px-4">Items &amp; Rx Safety</th>
                  <th className="py-3 px-4">Payment</th>
                  <th className="py-3 px-4 text-right">Total (BDT)</th>
                  <th className="py-3 px-4">Workflow Status</th>
                  <th className="py-3 px-6 text-right">Inspect</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6] text-sm">
                {filteredOrders.map((order) => (
                  <tr key={order.id} className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <p className="font-mono font-semibold text-xs text-[#0F172A]">
                        {order.orderNumber}
                      </p>
                      <p className="text-[11px] font-mono text-[#64748B]">
                        {formatTimestamp(order.createdAt)}
                      </p>
                    </td>
                    <td className="py-3 px-4">
                      <p className="font-medium text-[#0F172A]">{order.customerName}</p>
                      <p className="text-xs text-[#64748B]">
                        {permissions?.canViewCustomerPii ? order.customerPhone : 'Phone Protected'} ·{' '}
                        {order.deliveryZone}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-xs text-[#64748B]">
                      <p className="text-[#0F172A] truncate max-w-[220px]">{order.itemsSummary}</p>
                      {order.requiresPrescription ? (
                        <p className="text-[#D97706] font-medium flex items-center gap-1 mt-0.5">
                          <FileWarning className="w-3.5 h-3.5" />
                          Rx: {order.prescriptionReviewStatus.replace(/_/g, ' ')}
                        </p>
                      ) : (
                        <p>OTC Only</p>
                      )}
                    </td>
                    <td className="py-3 px-4 text-xs">
                      <p className="uppercase font-mono font-semibold text-[#0F172A]">
                        {order.paymentMethod}
                      </p>
                      <p
                        className={
                          order.paymentStatus === 'verified_paid'
                            ? 'text-[#0D7E74] font-medium'
                            : order.paymentStatus === 'refunded'
                            ? 'text-[#991B1B]'
                            : 'text-[#64748B]'
                        }
                      >
                        {order.paymentStatus.replace(/_/g, ' ')}
                      </p>
                    </td>
                    <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#0F172A]">
                      {formatBdt(order.totalAmountBdt)}
                    </td>
                    <td className="py-3 px-4 text-xs font-medium capitalize text-[#0F172A]">
                      {order.orderStatus.replace(/_/g, ' ')}
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => void openOrderModal(order)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg hover:bg-[#F2F8F4] whitespace-nowrap shrink-0"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        Manage
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Order Detail, Fulfillment, Payment Verification & Printable Invoice Modal */}
      {liveSelectedOrder && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 print:static print:bg-white print:p-0">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-4xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-6 print:border-0 print:max-h-none">
            <div className="flex items-start justify-between gap-4 border-b border-[#EEF2F6] pb-4">
              <div>
                <h2 className="text-xl font-bold text-[#0F172A]">
                  Order Invoice &amp; Fulfillment —{' '}
                  <span className="font-mono">{liveSelectedOrder.orderNumber}</span>
                </h2>
                <p className="text-xs text-[#64748B]">
                  Finesteride Recur 1Mg Shop Bd · Placed {formatTimestamp(liveSelectedOrder.createdAt)} · Status:{' '}
                  <strong className="uppercase">{liveSelectedOrder.orderStatus.replace(/_/g, ' ')}</strong>
                </p>
              </div>
              <div className="flex items-center gap-2 no-print">
                <button
                  type="button"
                  onClick={() => window.print()}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0F172A] border border-[#E6ECEF] rounded-lg hover:bg-[#F4F8F6] whitespace-nowrap shrink-0"
                >
                  <Printer className="w-3.5 h-3.5" />
                  Print Invoice
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedOrder(null)}
                  className="p-1 text-[#64748B]"
                >
                  <X className="w-5 h-5" />
                </button>
              </div>
            </div>

            {/* Recipient & Delivery Details */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-6 text-sm">
              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#64748B]">Delivery Recipient</p>
                <p className="font-semibold text-[#0F172A]">{liveSelectedOrder.customerName}</p>
                <p className="text-xs font-mono text-[#64748B]">
                  Customer UID: {liveSelectedOrder.customerId}
                </p>
                {permissions?.canViewCustomerPii ? (
                  <>
                    <p className="text-xs font-mono text-[#0F172A]">
                      Phone: {liveSelectedOrder.customerPhone}
                    </p>
                    <p className="text-xs text-[#64748B]">{liveSelectedOrder.shippingAddress}</p>
                  </>
                ) : (
                  <p className="text-xs text-[#64748B]">
                    Contact address isolated by role privacy policy.
                  </p>
                )}
                <p className="text-xs text-[#64748B]">
                  Zone: {liveSelectedOrder.deliveryZone} · Courier: {liveSelectedOrder.courierName || 'Unassigned'}
                  {liveSelectedOrder.trackingReference
                    ? ` · Tracking: ${liveSelectedOrder.trackingReference}`
                    : ''}
                </p>
              </div>

              <div className="space-y-1">
                <p className="text-xs font-semibold text-[#64748B]">Settlement &amp; Clinical Gate</p>
                <p className="text-sm font-semibold text-[#0F172A] uppercase font-mono">
                  {liveSelectedOrder.paymentMethod} · {liveSelectedOrder.paymentStatus.replace(/_/g, ' ')}
                </p>
                {liveSelectedOrder.transactionReference && (
                  <p className="text-xs font-mono text-[#64748B]">
                    Ref: {liveSelectedOrder.transactionReference}
                  </p>
                )}
                {liveSelectedOrder.paymentVerifiedAt && (
                  <p className="text-xs font-mono text-[#0D7E74]">
                    Server Verified: {liveSelectedOrder.paymentVerifiedAt}
                  </p>
                )}
                <p className="text-xs text-[#64748B] pt-1">
                  Prescription Requirement:{' '}
                  <strong>
                    {liveSelectedOrder.requiresPrescription
                      ? `Required (${liveSelectedOrder.prescriptionReviewStatus.replace(/_/g, ' ')})`
                      : 'Not Required (OTC)'}
                  </strong>
                </p>
              </div>
            </div>

            {/* Historical Snapshot Line Items */}
            <div className="border border-[#E6ECEF] rounded-lg overflow-hidden">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-[#F9FBFA] border-b border-[#EEF2F6] text-[#64748B]">
                    <th className="py-2.5 px-4">Snapshot Product</th>
                    <th className="py-2.5 px-4">SKU &amp; Unit</th>
                    <th className="py-2.5 px-4 text-right">Unit Price</th>
                    <th className="py-2.5 px-4 text-right">Qty</th>
                    <th className="py-2.5 px-4 text-right">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {loadingDetails ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-center text-[#64748B]">
                        Loading item snapshots...
                      </td>
                    </tr>
                  ) : orderItems.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="p-4 text-[#0F172A]">
                        {liveSelectedOrder.itemsSummary}
                      </td>
                    </tr>
                  ) : (
                    orderItems.map((it) => (
                      <tr key={it.id}>
                        <td className="py-2.5 px-4 font-medium text-[#0F172A]">
                          {it.productName}
                          {it.genericName ? ` (${it.genericName})` : ''}
                        </td>
                        <td className="py-2.5 px-4 font-mono text-[#64748B]">
                          {it.sku} · {it.unitSize}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {formatBdt(it.unitPriceBdt)}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums">
                          {it.quantity}
                        </td>
                        <td className="py-2.5 px-4 text-right font-mono tabular-nums font-semibold">
                          {formatBdt(it.lineTotalBdt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
              <div className="bg-[#F9FBFA] px-4 py-3 border-t border-[#EEF2F6] flex flex-col items-end space-y-1 text-xs font-mono tabular-nums">
                <p>Subtotal: {formatBdt(liveSelectedOrder.subtotalBdt)}</p>
                {liveSelectedOrder.discountBdt > 0 && (
                  <p className="text-[#0D7E74]">
                    Discount ({liveSelectedOrder.couponCode}): -{formatBdt(liveSelectedOrder.discountBdt)}
                  </p>
                )}
                <p>Delivery Fee: {formatBdt(liveSelectedOrder.deliveryFeeBdt)}</p>
                <p className="text-sm font-bold text-[#0F172A] pt-1">
                  Total Payable: {formatBdt(liveSelectedOrder.totalAmountBdt)}
                </p>
              </div>
            </div>

            {/* Interactive Admin Controls (Hidden in Print) */}
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 no-print">
              {/* 1. Server-Validated Order Status Transition */}
              {permissions?.canManageOrders && actor && (
                <form
                  onSubmit={async (e) => {
                    e.preventDefault();
                    setBusy(true);
                    setErrorMsg(null);
                    try {
                      await transitionOrderStatus(actor, liveSelectedOrder, {
                        nextStatus,
                        courierName,
                        trackingReference,
                        cancellationReason,
                        note: transitionNote,
                      });
                      const details = await fetchOrderDetails(liveSelectedOrder.id);
                      setOrderHistory(details.history);
                    } catch (err) {
                      setErrorMsg(
                        err instanceof Error ? err.message : 'Order transition rejected.'
                      );
                    } finally {
                      setBusy(false);
                    }
                  }}
                  className="border border-[#E6ECEF] rounded-lg p-4 space-y-3"
                >
                  <h3 className="text-sm font-semibold text-[#0F172A]">
                    Update Permitted Workflow Status
                  </h3>

                  <div>
                    <label className="block text-xs text-[#64748B] mb-1">Target Status</label>
                    <select
                      value={nextStatus}
                      onChange={(e) => setNextStatus(e.target.value as OrderStatus)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white"
                    >
                      {(NEXT_STATUS_OPTIONS[liveSelectedOrder.orderStatus] || []).map((st) => (
                        <option key={st} value={st}>
                          {st.replace(/_/g, ' ').toUpperCase()}
                        </option>
                      ))}
                      {actor.role === 'super_admin' &&
                        !(NEXT_STATUS_OPTIONS[liveSelectedOrder.orderStatus] || []).includes(
                          liveSelectedOrder.orderStatus
                        ) && (
                          <option value={liveSelectedOrder.orderStatus}>
                            {liveSelectedOrder.orderStatus.toUpperCase()} (Current)
                          </option>
                        )}
                    </select>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <label className="block text-xs text-[#64748B] mb-1">Courier Partner</label>
                      <input
                        type="text"
                        value={courierName}
                        onChange={(e) => setCourierName(e.target.value)}
                        placeholder="Pathao / Steadfast"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#E6ECEF] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs text-[#64748B] mb-1">
                        Tracking Ref (Req for Shipped)
                      </label>
                      <input
                        type="text"
                        value={trackingReference}
                        onChange={(e) => setTrackingReference(e.target.value)}
                        placeholder="TRK-982341"
                        className="w-full px-2.5 py-1.5 text-xs font-mono border border-[#E6ECEF] rounded-lg"
                      />
                    </div>
                  </div>

                  {nextStatus === 'cancelled' && (
                    <div>
                      <label className="block text-xs text-[#991B1B] font-medium mb-1">
                        Policy Cancellation Reason (Restocks Reserved Inventory) *
                      </label>
                      <input
                        type="text"
                        required
                        minLength={5}
                        value={cancellationReason}
                        onChange={(e) => setCancellationReason(e.target.value)}
                        placeholder="e.g., Customer requested cancellation prior to dispatch"
                        className="w-full px-2.5 py-1.5 text-xs border border-[#FECACA] rounded-lg"
                      />
                    </div>
                  )}

                  <div>
                    <label className="block text-xs text-[#64748B] mb-1">Transition Note</label>
                    <input
                      type="text"
                      value={transitionNote}
                      onChange={(e) => setTransitionNote(e.target.value)}
                      placeholder="Optional internal fulfillment note"
                      className="w-full px-2.5 py-1.5 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>

                  <button
                    type="submit"
                    disabled={
                      busy || (NEXT_STATUS_OPTIONS[liveSelectedOrder.orderStatus] || []).length === 0
                    }
                    className="w-full px-4 py-2 text-xs font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                  >
                    {busy ? 'Validating on Server...' : 'Apply Status Transition'}
                  </button>
                </form>
              )}

              {/* 2. Trusted Payment Gateway Settlement, Anti-Spoofing & Refund Verification */}
              {permissions?.canVerifyPayments &&
                actor &&
                liveSelectedOrder.orderStatus !== 'refunded' &&
                !(
                  liveSelectedOrder.orderStatus === 'cancelled' &&
                  liveSelectedOrder.paymentStatus !== 'refund_pending'
                ) &&
                (liveSelectedOrder.paymentStatus !== 'verified_paid' ||
                  liveSelectedOrder.orderStatus === 'refund_pending') && (
                  <form
                    onSubmit={async (e) => {
                      e.preventDefault();
                      setBusy(true);
                      setErrorMsg(null);
                      try {
                        await recordPaymentDecision(actor, liveSelectedOrder, {
                          decision: paymentDecision,
                          transactionReference: txnRefInput,
                          reconciliationConfirmed,
                          reason: paymentFailureReason,
                        });
                        const details = await fetchOrderDetails(liveSelectedOrder.id);
                        setOrderHistory(details.history);
                      } catch (err) {
                        setErrorMsg(
                          err instanceof Error ? err.message : 'Gateway verification failed.'
                        );
                      } finally {
                        setBusy(false);
                      }
                    }}
                    className="border border-[#E6ECEF] rounded-lg p-4 space-y-3"
                  >
                    <h3 className="text-sm font-semibold text-[#0F172A] flex items-center gap-1.5">
                      <ShieldCheck className="w-4 h-4 text-[#0D7E74]" />
                      Server Payment Settlement &amp; Refund Control
                    </h3>
                    <p className="text-xs text-[#64748B] leading-relaxed">
                      Client-submitted references are never treated as proof of payment. Verify settlement in the{' '}
                      {liveSelectedOrder.paymentMethod.toUpperCase()} merchant portal, reject invalid TrxIDs, or record completed refunds.
                    </p>

                    <div>
                      <label className="block text-xs text-[#64748B] mb-1">
                        Payment Action
                      </label>
                      <select
                        value={paymentDecision}
                        onChange={(e) => setPaymentDecision(e.target.value as PaymentDecisionType)}
                        className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white"
                      >
                        {liveSelectedOrder.paymentStatus !== 'verified_paid' && (
                          <option value="verify_paid">
                            Verify Paid Settlement (verified_paid)
                          </option>
                        )}
                        {liveSelectedOrder.paymentMethod !== 'cod' &&
                          liveSelectedOrder.paymentStatus !== 'verified_paid' && (
                            <option value="mark_failed">
                              Reject Invalid / Unmatched TrxID (failed)
                            </option>
                          )}
                        <option value="complete_refund">
                          Record Completed Refund (refunded)
                        </option>
                      </select>
                    </div>

                    {paymentDecision !== 'mark_failed' && (
                      <div>
                        <label className="block text-xs text-[#64748B] mb-1">
                          {paymentDecision === 'complete_refund'
                            ? 'Refund Disbursement Reference *'
                            : 'Verified Gateway / Receipt Reference *'}
                        </label>
                        <input
                          type="text"
                          required
                          value={txnRefInput}
                          onChange={(e) => setTxnRefInput(e.target.value)}
                          placeholder={
                            paymentDecision === 'complete_refund'
                              ? 'RFD-BKASH-9021'
                              : liveSelectedOrder.paymentMethod === 'cod'
                              ? 'COD-RCPT-1001'
                              : 'BK98472ABC12'
                          }
                          className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg"
                        />
                      </div>
                    )}

                    {(paymentDecision === 'mark_failed' ||
                      paymentDecision === 'complete_refund') && (
                      <div>
                        <label className="block text-xs text-[#64748B] mb-1">
                          {paymentDecision === 'mark_failed'
                            ? 'Failure / TrxID Rejection Reason *'
                            : 'Refund Note (Optional)'}
                        </label>
                        <input
                          type="text"
                          required={paymentDecision === 'mark_failed'}
                          minLength={paymentDecision === 'mark_failed' ? 5 : undefined}
                          value={paymentFailureReason}
                          onChange={(e) => setPaymentFailureReason(e.target.value)}
                          placeholder={
                            paymentDecision === 'mark_failed'
                              ? 'e.g., TrxID not found in merchant ledger'
                              : 'e.g., Refunded via bKash'
                          }
                          className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                        />
                      </div>
                    )}

                    {(paymentDecision === 'complete_refund' ||
                      (paymentDecision === 'verify_paid' &&
                        liveSelectedOrder.paymentMethod !== 'cod')) && (
                      <label className="flex items-start gap-2 text-xs text-[#0F172A]">
                        <input
                          type="checkbox"
                          checked={reconciliationConfirmed}
                          onChange={(e) => setReconciliationConfirmed(e.target.checked)}
                          className="mt-0.5"
                        />
                        <span>
                          {paymentDecision === 'complete_refund'
                            ? `I confirm BDT ${liveSelectedOrder.totalAmountBdt} has been refunded to the customer.`
                            : `I have reconciled BDT ${liveSelectedOrder.totalAmountBdt} against the official ${liveSelectedOrder.paymentMethod.toUpperCase()} merchant settlement ledger.`}
                        </span>
                      </label>
                    )}

                    <button
                      type="submit"
                      disabled={busy}
                      className={`w-full px-4 py-2 text-xs font-medium text-white disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0 ${
                        paymentDecision === 'mark_failed'
                          ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                          : 'bg-[#0D7E74] hover:bg-[#086058]'
                      }`}
                    >
                      {busy
                        ? 'Verifying...'
                        : paymentDecision === 'mark_failed'
                        ? 'Confirm TrxID Rejection'
                        : paymentDecision === 'complete_refund'
                        ? 'Confirm Refund Completed'
                        : 'Record Verified Settlement'}
                    </button>
                  </form>
                )}
            </div>

            {/* Timestamped Status Transition History */}
            <div className="border-t border-[#EEF2F6] pt-4 space-y-2 no-print">
              <h3 className="text-xs font-semibold text-[#0F172A]">
                Timestamped Status History ({orderHistory.length})
              </h3>
              <div className="space-y-1.5 text-xs">
                {orderHistory.map((h) => (
                  <div
                    key={h.id}
                    className="flex flex-wrap items-center justify-between gap-2 py-1.5 border-b border-[#F1F5F3]"
                  >
                    <div>
                      <span className="font-mono font-semibold text-[#0F172A]">
                        {h.fromStatus ? `${h.fromStatus} -> ` : ''}
                        {h.toStatus}
                      </span>{' '}
                      <span className="text-[#64748B]">· {h.note}</span>
                    </div>
                    <span className="font-mono text-[11px] text-[#64748B]">
                      {h.changedByName} ({h.changedByRole}) · {formatTimestamp(h.createdAt)}
                    </span>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
