import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ClipboardCheck,
  Database,
  Download,
  FileSpreadsheet,
  FlaskConical,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { getFirebaseProjectInfo } from '../lib/firebase';
import { formatBdt, formatTimestamp } from '../lib/validation';
import {
  generateSanitizedCsvExport,
  placeVerificationOrder,
} from '../services/pharmacyService';
import type { PaymentMethod } from '../types/pharmacy';

export function ReportsQaView() {
  const { permissions } = useAuth();
  const {
    actor,
    products,
    productBatches,
    orders,
    customers,
    deliveryZones,
    coupons,
    categories,
    siteSettings,
  } = useStoreData();

  const [tab, setTab] = useState<'reports' | 'simulator' | 'checklist'>('reports');
  const [dateRangeDays, setDateRangeDays] = useState<number>(30);
  const [includePiiExport, setIncludePiiExport] = useState(false);
  const [exportingKey, setExportingKey] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // QA Atomic Checkout Simulator State
  const [simProductId, setSimProductId] = useState('');
  const [simQty, setSimQty] = useState(1);
  const [simCustomerName, setSimCustomerName] = useState('Tanvir Hasan (Verification Order)');
  const [simPhone, setSimPhone] = useState('+8801711000000');
  const [simAddress, setSimAddress] = useState('House 14, Road 7, Dhanmondi, Dhaka 1205');
  const [simZoneId, setSimZoneId] = useState('');
  const [simPayment, setSimPayment] = useState<PaymentMethod>('cod');
  const [simTxnRef, setSimTxnRef] = useState('');
  const [simCouponId, setSimCouponId] = useState('');
  const [simPrescriber, setSimPrescriber] = useState('Dr. Mahmudul Islam (BMDC Reg #A-49201)');
  const [simClinic, setSimClinic] = useState('Square Hospital Outpatient Dermatology');
  const [simDocUrl, setSimDocUrl] = useState(
    '/assets/aistudio/867081142_122283788462156715_1316202229849569188_n_60369be3.jpg'
  );
  const [placingSimOrder, setPlacingSimOrder] = useState(false);

  const projectInfo = getFirebaseProjectInfo();

  const rangeOrders = useMemo(() => {
    if (dateRangeDays === 0) return orders;
    const cutoff = Date.now() - dateRangeDays * 24 * 60 * 60 * 1000;
    return orders.filter((o) => (o.createdAt?.toMillis?.() || Date.now()) >= cutoff);
  }, [orders, dateRangeDays]);

  const reportSummaries = useMemo(() => {
    let verifiedRevenueBdt = 0;
    let pendingRevenueBdt = 0;
    let refundedBdt = 0;
    const statusCounts: Record<string, number> = {};
    const paymentCounts: Record<string, { count: number; totalBdt: number }> = {};
    const zoneCounts: Record<string, { count: number; totalBdt: number }> = {};

    for (const o of rangeOrders) {
      statusCounts[o.orderStatus] = (statusCounts[o.orderStatus] || 0) + 1;
      if (!paymentCounts[o.paymentMethod]) {
        paymentCounts[o.paymentMethod] = { count: 0, totalBdt: 0 };
      }
      paymentCounts[o.paymentMethod].count += 1;
      paymentCounts[o.paymentMethod].totalBdt += o.totalAmountBdt;

      const zKey = o.deliveryZone || 'Unassigned';
      if (!zoneCounts[zKey]) zoneCounts[zKey] = { count: 0, totalBdt: 0 };
      zoneCounts[zKey].count += 1;
      zoneCounts[zKey].totalBdt += o.totalAmountBdt;

      if (o.orderStatus !== 'cancelled' && (o.paymentStatus === 'verified_paid' || o.orderStatus === 'delivered')) {
        verifiedRevenueBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'refunded' || o.orderStatus === 'refunded') {
        refundedBdt += o.totalAmountBdt;
      } else if (o.orderStatus !== 'cancelled') {
        pendingRevenueBdt += o.totalAmountBdt;
      }
    }

    const lowOrExpiredProducts = products.filter(
      (p) =>
        p.availabilityStatus === 'low_stock' ||
        p.availabilityStatus === 'out_of_stock' ||
        p.availabilityStatus === 'expired_restricted'
    );

    const expiredOrNearBatches = productBatches.filter(
      (b) => b.status === 'near_expiry' || b.status === 'expired_quarantined'
    );

    return {
      verifiedRevenueBdt,
      pendingRevenueBdt,
      refundedBdt,
      statusCounts,
      paymentCounts,
      zoneCounts,
      lowOrExpiredProducts,
      expiredOrNearBatches,
    };
  }, [rangeOrders, products, productBatches]);

  const triggerCsvDownload = async (
    reportKey: string,
    filename: string,
    rows: Array<Record<string, unknown>>
  ) => {
    if (!actor || !permissions?.canExportReports) return;
    if (rows.length === 0) {
      setErrorMsg('No records available to export for the selected report.');
      return;
    }
    setExportingKey(reportKey);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const res = await generateSanitizedCsvExport(
        actor,
        rows,
        Boolean(includePiiExport && permissions.canExportPii)
      );
      const blob = new Blob([res.csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.setAttribute('download', filename);
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
      setSuccessMsg(
        `Exported ${res.rowCount} sanitized row(s) to ${filename}${
          res.piiRedacted ? ' (PII automatically redacted)' : ''
        }.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to generate CSV report.');
    } finally {
      setExportingKey(null);
    }
  };

  const selectedSimProduct = products.find((p) => p.id === simProductId) || products[0] || null;
  const selectedSimZone =
    deliveryZones.find((z) => z.id === simZoneId) ||
    deliveryZones.find((z) => z.status === 'active') ||
    null;

  const handlePlaceSimOrder = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor) return;
    if (!selectedSimProduct) {
      setErrorMsg('Create at least one published product in Products first before running checkout verification.');
      return;
    }
    if (!selectedSimZone) {
      setErrorMsg('Configure at least one active delivery zone first.');
      return;
    }
    setPlacingSimOrder(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const chosenCoupon = coupons.find((c) => c.id === simCouponId) || null;
      const orderNumber = await placeVerificationOrder(actor, {
        product: selectedSimProduct,
        quantity: simQty,
        customerName: simCustomerName,
        customerPhone: simPhone,
        shippingAddress: simAddress,
        deliveryZone: selectedSimZone,
        paymentMethod: simPayment,
        clientTxnRef: simPayment === 'cod' ? '' : simTxnRef || 'TRX-CLIENT-SUBMITTED',
        coupon: chosenCoupon,
        prescriberName: simPrescriber,
        clinicOrHospital: simClinic,
        prescriptionDocumentUrl: simDocUrl,
      });
      setSuccessMsg(
        `Created real atomic Firestore order ${orderNumber}. Stock decremented, inventoryMovement recorded, and ${
          selectedSimProduct.prescriptionType !== 'otc'
            ? 'order locked in awaiting_review with linked Prescription Review.'
            : 'order ready in Orders queue.'
        }`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Verification order failed.');
    } finally {
      setPlacingSimOrder(false);
    }
  };

  const readinessChecks = [
    {
      label: 'Shared Firebase Project Connected',
      ok: Boolean(projectInfo.projectId),
      detail: `projectId: ${projectInfo.projectId} · databaseId: ${projectInfo.databaseId}`,
    },
    {
      label: 'Shared Storefront Tenant Identifier Standardized',
      ok: projectInfo.storeId === 'finesteride-recur-bd',
      detail: `storeId: "${projectInfo.storeId}" enforced in Firestore Security Rules`,
    },
    {
      label: 'Storefront Categories Initialized',
      ok: categories.length > 0,
      detail: `${categories.length} category record(s) in /categories`,
    },
    {
      label: 'Storefront CMS Settings Published',
      ok: Boolean(siteSettings),
      detail: siteSettings
        ? `Published (${siteSettings.siteName})`
        : 'Pending initial publish in Promotions & CMS or Overview initializer',
    },
    {
      label: 'Active Delivery Zones Configured',
      ok: deliveryZones.some((z) => z.status === 'active'),
      detail: `${deliveryZones.filter((z) => z.status === 'active').length} active zone(s) in /deliveryZones`,
    },
    {
      label: 'Web Push Certificate Key Pair (FCM VAPID) Connected',
      ok: Boolean(projectInfo.vapidKey && projectInfo.vapidKey.length >= 60),
      detail: projectInfo.vapidKey
        ? `Key pair: ${projectInfo.vapidKey.slice(0, 12)}...${projectInfo.vapidKey.slice(-8)} · Sender ID: ${projectInfo.messagingSenderId || '—'}`
        : 'Configure VITE_FIREBASE_VAPID_KEY in environment settings',
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Reports, CSV Exports &amp; Storefront QA
          </h1>
          <p className="text-sm text-[#64748B]">
            Export formula-sanitized pharmacy reports, test end-to-end atomic order and prescription workflows, and verify Customer Panel readiness.
          </p>
        </div>

        <div className="inline-flex bg-white border border-[#E6ECEF] rounded-lg p-1 self-start">
          <button
            type="button"
            onClick={() => setTab('reports')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'reports'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <FileSpreadsheet className="w-3.5 h-3.5" />
            Reports &amp; CSV
          </button>
          <button
            type="button"
            onClick={() => setTab('simulator')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'simulator'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <FlaskConical className="w-3.5 h-3.5" />
            Atomic Checkout QA
          </button>
          <button
            type="button"
            onClick={() => setTab('checklist')}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'checklist'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#64748B] hover:text-[#0F172A]'
            }`}
          >
            <ClipboardCheck className="w-3.5 h-3.5" />
            Shared Firebase Checklist
          </button>
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

      {tab === 'reports' && (
        <div className="space-y-6">
          {/* Controls Strip */}
          <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div className="flex items-center gap-3 flex-wrap">
              <span className="text-xs font-semibold text-[#0F172A]">Report Window:</span>
              {[
                { label: 'Last 7 Days', val: 7 },
                { label: 'Last 30 Days', val: 30 },
                { label: 'Last 90 Days', val: 90 },
                { label: 'All Time', val: 0 },
              ].map((opt) => (
                <button
                  key={opt.val}
                  type="button"
                  onClick={() => setDateRangeDays(opt.val)}
                  className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                    dateRangeDays === opt.val
                      ? 'border-[#0D7E74] bg-[#F0FDFA] text-[#0D7E74]'
                      : 'border-[#E6ECEF] text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {opt.label}
                </button>
              ))}
            </div>

            {permissions?.canExportPii && (
              <label className="inline-flex items-center gap-2 text-xs text-[#64748B] cursor-pointer">
                <input
                  type="checkbox"
                  checked={includePiiExport}
                  onChange={(e) => setIncludePiiExport(e.target.checked)}
                  className="rounded border-[#E6ECEF] text-[#0D7E74]"
                />
                Include Customer Phone/Address in Order Exports (Super/Store Admin Only)
              </label>
            )}
          </div>

          {/* Summary KPI Strip */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 space-y-1">
              <div className="text-xs font-medium text-[#64748B]">Verified Sales Revenue</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#0F172A]">
                {formatBdt(reportSummaries.verifiedRevenueBdt)}
              </div>
              <div className="text-xs text-[#64748B]">
                Excludes unverified, cancelled, and refunded orders
              </div>
            </div>
            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 space-y-1">
              <div className="text-xs font-medium text-[#64748B]">Pending Collection / Verification</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#B45309]">
                {formatBdt(reportSummaries.pendingRevenueBdt)}
              </div>
              <div className="text-xs text-[#64748B]">
                COD in-transit or unverified MFS references
              </div>
            </div>
            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 space-y-1">
              <div className="text-xs font-medium text-[#64748B]">Refunded Volume</div>
              <div className="text-2xl font-bold font-mono tabular-nums text-[#64748B]">
                {formatBdt(reportSummaries.refundedBdt)}
              </div>
              <div className="text-xs text-[#64748B]">
                Completed customer refunds in selected window
              </div>
            </div>
          </div>

          {/* Exportable Report Cards */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  1. Sales &amp; Order Status Summary CSV
                </h2>
                <p className="text-xs text-[#64748B]">
                  {rangeOrders.length} order(s) in window · Sanitized against spreadsheet formula injection (<span className="font-mono">= + - @</span>).
                </p>
              </div>
              {permissions?.canExportReports && (
                <button
                  type="button"
                  disabled={exportingKey === 'orders'}
                  onClick={() =>
                    triggerCsvDownload(
                      'orders',
                      `finesteride-orders-${new Date().toISOString().slice(0, 10)}.csv`,
                      rangeOrders.map((o) => ({
                        orderNumber: o.orderNumber,
                        createdAt: formatTimestamp(o.createdAt),
                        orderStatus: o.orderStatus,
                        paymentMethod: o.paymentMethod,
                        paymentStatus: o.paymentStatus,
                        prescriptionStatus: o.prescriptionReviewStatus,
                        subtotalBdt: o.subtotalBdt,
                        discountBdt: o.discountBdt,
                        deliveryFeeBdt: o.deliveryFeeBdt,
                        totalAmountBdt: o.totalAmountBdt,
                        deliveryZone: o.deliveryZone,
                        customerName: o.customerName,
                        customerPhone: o.customerPhone,
                        shippingAddress: o.shippingAddress,
                      }))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E2EEF0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingKey === 'orders' ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  2. Catalog Performance &amp; Stock Valuation CSV
                </h2>
                <p className="text-xs text-[#64748B]">
                  {products.length} total product(s) · {reportSummaries.lowOrExpiredProducts.length} low/out/expired item(s).
                </p>
              </div>
              {permissions?.canExportReports && (
                <button
                  type="button"
                  disabled={exportingKey === 'products'}
                  onClick={() =>
                    triggerCsvDownload(
                      'products',
                      `finesteride-catalog-stock-${new Date().toISOString().slice(0, 10)}.csv`,
                      products.map((p) => ({
                        sku: p.sku,
                        name: p.name,
                        genericName: p.genericName,
                        manufacturer: p.manufacturer,
                        categoryName: p.categoryName,
                        sellingPriceBdt: p.sellingPrice,
                        stockQuantity: p.stockQuantity,
                        lowStockThreshold: p.lowStockThreshold,
                        availabilityStatus: p.availabilityStatus,
                        nearestExpiryDate: p.nearestExpiryDate,
                        prescriptionType: p.prescriptionType,
                        publicationStatus: p.publicationStatus,
                      }))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E2EEF0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingKey === 'products' ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  3. Pharmaceutical Batches &amp; Expiry Audit CSV
                </h2>
                <p className="text-xs text-[#64748B]">
                  {productBatches.length} batch lot(s) · {reportSummaries.expiredOrNearBatches.length} near-expiry or quarantined.
                </p>
              </div>
              {permissions?.canExportReports && (
                <button
                  type="button"
                  disabled={exportingKey === 'batches'}
                  onClick={() =>
                    triggerCsvDownload(
                      'batches',
                      `finesteride-batches-expiry-${new Date().toISOString().slice(0, 10)}.csv`,
                      productBatches.map((b) => ({
                        batchNumber: b.batchNumber,
                        sku: b.sku,
                        productName: b.productName,
                        supplierName: b.supplierName,
                        quantityReceived: b.quantityReceived,
                        quantityRemaining: b.quantityRemaining,
                        manufacturingDate: b.manufacturingDate,
                        expiryDate: b.expiryDate,
                        status: b.status,
                      }))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E2EEF0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingKey === 'batches' ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
            </div>

            <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex items-start justify-between gap-4">
              <div className="space-y-1">
                <h2 className="text-sm font-semibold text-[#0F172A]">
                  4. Customer Registrations &amp; Retention CSV
                </h2>
                <p className="text-xs text-[#64748B]">
                  {customers.length} customer account(s) · Aggregated spend &amp; standing (isolated from private PII).
                </p>
              </div>
              {permissions?.canExportReports && (
                <button
                  type="button"
                  disabled={exportingKey === 'customers'}
                  onClick={() =>
                    triggerCsvDownload(
                      'customers',
                      `finesteride-customers-${new Date().toISOString().slice(0, 10)}.csv`,
                      customers.map((c) => ({
                        uid: c.uid,
                        displayName: c.displayName,
                        accountStatus: c.accountStatus,
                        orderCount: c.orderCount,
                        totalSpentBdt: c.totalSpentBdt,
                        registeredAt: formatTimestamp(c.createdAt),
                      }))
                    )
                  }
                  className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E2EEF0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  <Download className="w-3.5 h-3.5" />
                  {exportingKey === 'customers' ? 'Exporting...' : 'Export CSV'}
                </button>
              )}
            </div>
          </div>

          {/* Payment & Delivery Zone Breakdown Tables */}
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
            <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#EEF2F6]">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Payment Method Breakdown
                </h3>
              </div>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-2.5 px-6">Method</th>
                    <th className="py-2.5 px-4 text-right">Orders</th>
                    <th className="py-2.5 px-6 text-right">Gross Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {Object.keys(reportSummaries.paymentCounts).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 px-6 text-center text-xs text-[#64748B]">
                        No orders recorded in this date window.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(reportSummaries.paymentCounts).map(([method, stats]) => (
                      <tr key={method}>
                        <td className="py-3 px-6 font-mono uppercase text-xs font-semibold text-[#0F172A]">
                          {method}
                        </td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {stats.count}
                        </td>
                        <td className="py-3 px-6 text-right font-mono tabular-nums font-medium">
                          {formatBdt(stats.totalBdt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>

            <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
              <div className="px-6 py-4 border-b border-[#EEF2F6]">
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  Delivery Zone Performance
                </h3>
              </div>
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-2.5 px-6">Delivery Zone</th>
                    <th className="py-2.5 px-4 text-right">Orders</th>
                    <th className="py-2.5 px-6 text-right">Order Volume</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {Object.keys(reportSummaries.zoneCounts).length === 0 ? (
                    <tr>
                      <td colSpan={3} className="py-6 px-6 text-center text-xs text-[#64748B]">
                        No zone shipments recorded in this date window.
                      </td>
                    </tr>
                  ) : (
                    Object.entries(reportSummaries.zoneCounts).map(([zone, stats]) => (
                      <tr key={zone}>
                        <td className="py-3 px-6 text-xs font-semibold text-[#0F172A]">{zone}</td>
                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          {stats.count}
                        </td>
                        <td className="py-3 px-6 text-right font-mono tabular-nums font-medium">
                          {formatBdt(stats.totalBdt)}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {tab === 'simulator' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl p-6 max-w-3xl space-y-5">
          <div>
            <h2 className="text-base font-semibold text-[#0F172A]">
              End-to-End Atomic Order &amp; Prescription Gate Verification
            </h2>
            <p className="text-xs text-[#64748B] leading-relaxed mt-1">
              Executes the exact shared Firestore checkout transaction used by the Customer Panel: validates coupons on <span className="font-mono text-[#0F172A]">/api/discounts/calculate</span>, decrements <span className="font-mono text-[#0F172A]">/products</span> stock atomically, writes an <span className="font-mono text-[#0F172A]">/inventoryMovements</span> reservation, creates immutable <span className="font-mono text-[#0F172A]">/orders/{'{id}'}/items</span> snapshots, and holds prescription medicines in <span className="font-mono text-[#0F172A]">awaiting_review</span>.
            </p>
          </div>

          {products.length === 0 || deliveryZones.length === 0 ? (
            <div className="p-4 rounded-lg bg-[#F4F7F8] border border-[#E6ECEF] text-xs text-[#64748B]">
              Initialize official categories &amp; delivery zones on the Overview screen and add at least one product with sellable stock in Products to run a live checkout verification.
            </div>
          ) : (
            <form onSubmit={handlePlaceSimOrder} className="space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Product to Order *
                  </label>
                  <select
                    value={selectedSimProduct?.id || ''}
                    onChange={(e) => setSimProductId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} — {formatBdt(p.sellingPrice)} (Stock: {p.stockQuantity} · {p.prescriptionType})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Quantity *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={Math.max(1, selectedSimProduct?.stockQuantity || 1)}
                    value={simQty}
                    onChange={(e) => setSimQty(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Customer Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={simCustomerName}
                    onChange={(e) => setSimCustomerName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Recipient Phone *
                  </label>
                  <input
                    type="text"
                    required
                    value={simPhone}
                    onChange={(e) => setSimPhone(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Delivery Address *
                </label>
                <input
                  type="text"
                  required
                  value={simAddress}
                  onChange={(e) => setSimAddress(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Delivery Zone
                  </label>
                  <select
                    value={selectedSimZone?.id || ''}
                    onChange={(e) => setSimZoneId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    {deliveryZones.map((z) => (
                      <option key={z.id} value={z.id}>
                        {z.zoneName} ({formatBdt(z.deliveryFeeBdt)})
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Payment Channel
                  </label>
                  <select
                    value={simPayment}
                    onChange={(e) => setSimPayment(e.target.value as PaymentMethod)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="cod">Cash on Delivery (COD)</option>
                    <option value="bkash">bKash Merchant</option>
                    <option value="nagad">Nagad Merchant</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Apply Coupon
                  </label>
                  <select
                    value={simCouponId}
                    onChange={(e) => setSimCouponId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="">None</option>
                    {coupons
                      .filter((c) => c.status === 'active')
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.code}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              {simPayment !== 'cod' && (
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Simulated Client TrxID (Enters pending_verification)
                  </label>
                  <input
                    type="text"
                    value={simTxnRef}
                    onChange={(e) => setSimTxnRef(e.target.value)}
                    placeholder="e.g., BKS9847201A"
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              )}

              {selectedSimProduct && selectedSimProduct.prescriptionType !== 'otc' && (
                <div className="p-4 rounded-xl bg-[#F4F7F8] border border-[#E6ECEF] space-y-3">
                  <div className="text-xs font-semibold text-[#0F172A]">
                    Clinical Prescription Submission Required ({selectedSimProduct.prescriptionType})
                  </div>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs font-medium text-[#64748B] mb-1">
                        Prescribing Doctor &amp; BMDC Reg *
                      </label>
                      <input
                        type="text"
                        required
                        value={simPrescriber}
                        onChange={(e) => setSimPrescriber(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E6ECEF] rounded-lg"
                      />
                    </div>
                    <div>
                      <label className="block text-xs font-medium text-[#64748B] mb-1">
                        Hospital / Chamber
                      </label>
                      <input
                        type="text"
                        value={simClinic}
                        onChange={(e) => setSimClinic(e.target.value)}
                        className="w-full px-3 py-2 text-xs bg-white border border-[#E6ECEF] rounded-lg"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-[#64748B] mb-1">
                      Prescription Scan Document URL *
                    </label>
                    <input
                      type="text"
                      required
                      value={simDocUrl}
                      onChange={(e) => setSimDocUrl(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono bg-white border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                </div>
              )}

              <div className="pt-2 flex justify-end">
                <button
                  type="submit"
                  disabled={placingSimOrder}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {placingSimOrder ? 'Executing Atomic Transaction...' : 'Place Real Verification Order'}
                </button>
              </div>
            </form>
          )}
        </div>
      )}

      {tab === 'checklist' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center gap-2.5">
            <Database className="w-4 h-4 text-[#0D7E74]" />
            <div>
              <h2 className="text-base font-semibold text-[#0F172A]">
                Shared Firebase &amp; Customer Panel Connection Checklist
              </h2>
              <p className="text-xs text-[#64748B]">
                Provide these exact coordinates to the separate Customer Storefront application (see <span className="font-mono text-[#0F172A]">SHARED_ARCHITECTURE.md</span>).
              </p>
            </div>
          </div>

          <div className="p-6 space-y-6">
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 text-xs">
              <div className="p-3.5 rounded-lg border border-[#EEF2F6] bg-[#F8FAFB]">
                <div className="text-[#64748B]">VITE_FIREBASE_PROJECT_ID</div>
                <div className="font-mono font-semibold text-[#0F172A] mt-1 break-all">
                  {projectInfo.projectId}
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-[#EEF2F6] bg-[#F8FAFB]">
                <div className="text-[#64748B]">VITE_FIREBASE_DATABASE_ID</div>
                <div className="font-mono font-semibold text-[#0F172A] mt-1 break-all">
                  {projectInfo.databaseId}
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-[#EEF2F6] bg-[#F8FAFB]">
                <div className="text-[#64748B]">SHARED_STORE_ID</div>
                <div className="font-mono font-semibold text-[#0F172A] mt-1">
                  {projectInfo.storeId}
                </div>
              </div>
              <div className="p-3.5 rounded-lg border border-[#EEF2F6] bg-[#F8FAFB]">
                <div className="text-[#64748B]">VITE_FIREBASE_VAPID_KEY</div>
                <div className="font-mono font-semibold text-[#0F172A] mt-1 break-all">
                  {projectInfo.vapidKey
                    ? `${projectInfo.vapidKey.slice(0, 10)}...${projectInfo.vapidKey.slice(-8)}`
                    : 'Not configured'}
                </div>
              </div>
            </div>

            <div className="divide-y divide-[#EEF2F6] border border-[#EEF2F6] rounded-xl">
              {readinessChecks.map((item) => (
                <div key={item.label} className="p-4 flex items-start justify-between gap-4">
                  <div className="space-y-0.5">
                    <div className="text-sm font-medium text-[#0F172A]">{item.label}</div>
                    <div className="text-xs font-mono text-[#64748B]">{item.detail}</div>
                  </div>
                  <span
                    className={`inline-flex items-center gap-1.5 text-xs font-medium whitespace-nowrap shrink-0 ${
                      item.ok ? 'text-[#15803D]' : 'text-[#B45309]'
                    }`}
                  >
                    <CheckCircle2 className="w-4 h-4" />
                    {item.ok ? 'Verified' : 'Action Needed'}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
