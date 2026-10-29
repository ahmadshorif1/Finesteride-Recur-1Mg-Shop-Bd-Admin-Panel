import React, { useMemo, useState } from 'react';
import {
  Activity,
  AlertTriangle,
  ArrowRight,
  Bot,
  CalendarClock,
  CheckCircle2,
  FileCheck2,
  FileSpreadsheet,
  Package,
  Plus,
  RefreshCw,
  ShieldCheck,
  ShoppingCart,
  Sparkles,
  TrendingUp,
} from 'lucide-react';
import {
  Area,
  AreaChart,
  CartesianGrid,
  Cell,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { useAuth } from '../context/AuthContext';
import { useLanguage } from '../context/LanguageContext';
import { useStoreData } from '../context/StoreDataContext';
import { daysUntilExpiry, formatBdt, formatTimestamp } from '../lib/validation';
import {
  bootstrapReferenceStructure,
  OFFICIAL_STOREFRONT_CATEGORIES,
} from '../services/pharmacyService';
import type { AdminModuleKey } from '../types/pharmacy';

interface OverviewProps {
  onNavigate: (module: AdminModuleKey) => void;
}

type DateRangeKey = '7d' | '30d' | '90d' | 'all';

const DONUT_PALETTE = ['#2563EB', '#0D9488', '#16A34A', '#F59E0B', '#8B5CF6', '#EC4899'];

function MiniSparkline({ values, color }: { values: number[]; color: string }) {
  const safe = values.length >= 2 ? values : [0, 0, 0, 0, 0, 0];
  const max = Math.max(...safe, 1);
  const min = Math.min(...safe, 0);
  const span = Math.max(max - min, 1);
  const width = 120;
  const height = 26;

  const points = safe.map((v, i) => {
    const x = (i / (safe.length - 1)) * width;
    const y = height - 4 - ((v - min) / span) * (height - 8);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const linePath = `M ${points.join(' L ')}`;
  const areaPath = `${linePath} L ${width},${height} L 0,${height} Z`;
  const gradId = `spark_${color.replace('#', '')}`;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-7 overflow-visible" aria-hidden="true">
      <defs>
        <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity="0.22" />
          <stop offset="100%" stopColor={color} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradId})`} />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OverviewView({ onNavigate }: OverviewProps) {
  const { user, staffProfile, permissions } = useAuth();
  const { t, language } = useLanguage();
  const {
    loading,
    syncError,
    retrySync,
    actor,
    categories,
    products,
    productBatches,
    orders,
    prescriptionReviews,
    customers,
    coupons,
    deliveryZones,
    siteSettings,
    auditLogs,
  } = useStoreData();

  const [dateRange, setDateRange] = useState<DateRangeKey>('30d');
  const [bootstrapping, setBootstrapping] = useState(false);
  const [bootstrapFeedback, setBootstrapFeedback] = useState<string | null>(null);

  const greetingText = useMemo(() => {
    const hour = new Date().getHours();
    if (hour < 12) return 'Good Morning';
    if (hour < 17) return 'Good Afternoon';
    return 'Good Evening';
  }, []);

  const firstName = useMemo(() => {
    const raw =
      staffProfile?.displayName ||
      user?.displayName ||
      user?.email?.split('@')[0] ||
      'Administrator';
    return raw.trim().split(/\s+/)[0] || 'Admin';
  }, [staffProfile, user]);

  const rangeCutoffMs = useMemo(() => {
    if (dateRange === 'all') return 0;
    const days = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : 90;
    return Date.now() - days * 24 * 60 * 60 * 1000;
  }, [dateRange]);

  const filteredOrders = useMemo(() => {
    if (rangeCutoffMs === 0) return orders;
    return orders.filter((o) => (o.createdAt?.toMillis?.() || Date.now()) >= rangeCutoffMs);
  }, [orders, rangeCutoffMs]);

  const todayStats = useMemo(() => {
    const startOfToday = new Date();
    startOfToday.setHours(0, 0, 0, 0);
    const startMs = startOfToday.getTime();
    let count = 0;
    let salesBdt = 0;
    for (const o of orders) {
      const ms = o.createdAt?.toMillis?.() || 0;
      if (ms >= startMs) {
        count += 1;
        if (o.orderStatus !== 'cancelled' && o.orderStatus !== 'refunded') {
          salesBdt += o.totalAmountBdt;
        }
      }
    }
    return { count, salesBdt };
  }, [orders]);

  const productMetrics = useMemo(() => {
    const published = products.filter((p) => p.publicationStatus === 'published').length;
    const unpublished = products.filter((p) => p.publicationStatus !== 'published').length;
    const lowStock = products.filter((p) => p.availabilityStatus === 'low_stock').length;
    const outOfStock = products.filter((p) => p.availabilityStatus === 'out_of_stock').length;
    const expiredRestricted = products.filter(
      (p) => p.availabilityStatus === 'expired_restricted'
    ).length;
    const totalUnits = products.reduce((sum, p) => sum + (p.stockQuantity || 0), 0);
    return {
      total: products.length,
      published,
      unpublished,
      lowStock,
      outOfStock,
      expiredRestricted,
      totalUnits,
    };
  }, [products]);

  const orderMetrics = useMemo(() => {
    let pending = 0;
    let processing = 0;
    let delivered = 0;
    let cancelled = 0;
    let verifiedSalesBdt = 0;
    let pendingSalesBdt = 0;
    let refundedSalesBdt = 0;

    for (const o of filteredOrders) {
      if (o.orderStatus === 'pending' || o.orderStatus === 'awaiting_review') pending += 1;
      else if (['confirmed', 'processing', 'ready_for_dispatch'].includes(o.orderStatus))
        processing += 1;
      else if (['shipped', 'delivered'].includes(o.orderStatus)) delivered += 1;
      else if (o.orderStatus === 'cancelled') cancelled += 1;

      if (
        o.orderStatus !== 'cancelled' &&
        (o.paymentStatus === 'verified_paid' || o.orderStatus === 'delivered')
      ) {
        verifiedSalesBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'refunded' || o.orderStatus === 'refunded') {
        refundedSalesBdt += o.totalAmountBdt;
      } else if (o.orderStatus !== 'cancelled') {
        pendingSalesBdt += o.totalAmountBdt;
      }
    }

    return {
      total: filteredOrders.length,
      pending,
      processing,
      delivered,
      cancelled,
      verifiedSalesBdt,
      pendingSalesBdt,
      refundedSalesBdt,
    };
  }, [filteredOrders]);

  const batchProcurementCostBdt = useMemo(() => {
    return productBatches.reduce(
      (sum, b) => sum + (b.unitCostPrice || 0) * (b.quantityReceived || 0),
      0
    );
  }, [productBatches]);

  const pendingPrescriptions = useMemo(
    () => prescriptionReviews.filter((r) => r.reviewStatus === 'pending_review'),
    [prescriptionReviews]
  );

  const rxComplianceLabel = useMemo(() => {
    if (prescriptionReviews.length === 0) return '100% (0 pending)';
    const reviewed = prescriptionReviews.filter((r) => r.reviewStatus !== 'pending_review').length;
    const pct = Math.round((reviewed / prescriptionReviews.length) * 100);
    return `${pct}% reviewed`;
  }, [prescriptionReviews]);

  const expiringOrExpiredBatches = useMemo(() => {
    return productBatches.filter((b) => {
      if (b.quantityRemaining <= 0 && b.status === 'depleted') return false;
      const days = daysUntilExpiry(b.expiryDate);
      return b.status === 'expired_quarantined' || (days !== null && days <= 60);
    });
  }, [productBatches]);

  // Real 7-bucket time series for AreaChart & MiniSparklines
  const revenueTimeline = useMemo(() => {
    const bucketCount = 7;
    const spanDays = dateRange === '7d' ? 7 : dateRange === '30d' ? 30 : dateRange === '90d' ? 90 : 30;
    const stepMs = (spanDays * 24 * 60 * 60 * 1000) / bucketCount;
    const now = Date.now();

    const buckets = Array.from({ length: bucketCount }, (_, idx) => {
      const start = now - (bucketCount - idx) * stepMs;
      const end = start + stepMs;
      const label = new Date(end).toLocaleDateString('en-GB', {
        day: '2-digit',
        month: 'short',
      });
      return {
        label,
        start,
        end,
        verifiedBdt: 0,
        pendingBdt: 0,
        ordersCount: 0,
      };
    });

    for (const o of filteredOrders) {
      const ms = o.createdAt?.toMillis?.() || now;
      const bucket = buckets.find((b) => ms >= b.start && ms <= b.end) || buckets[buckets.length - 1];
      if (!bucket) continue;
      bucket.ordersCount += 1;
      if (
        o.orderStatus !== 'cancelled' &&
        (o.paymentStatus === 'verified_paid' || o.orderStatus === 'delivered')
      ) {
        bucket.verifiedBdt += o.totalAmountBdt;
      } else if (o.orderStatus !== 'cancelled' && o.orderStatus !== 'refunded') {
        bucket.pendingBdt += o.totalAmountBdt;
      }
    }

    return buckets;
  }, [filteredOrders, dateRange]);

  // Inventory Distribution by Category for Donut Chart
  const categoryStockBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const p of products) {
      const key = p.categoryName || 'Uncategorized';
      map.set(key, (map.get(key) || 0) + Math.max(0, p.stockQuantity || 0));
    }
    const entries = Array.from(map.entries())
      .map(([name, units]) => ({ name, units }))
      .sort((a, b) => b.units - a.units)
      .slice(0, 6);

    const total = entries.reduce((s, e) => s + e.units, 0);
    return entries.map((item, idx) => ({
      ...item,
      pct: total > 0 ? Math.round((item.units / total) * 100) : 0,
      color: DONUT_PALETTE[idx % DONUT_PALETTE.length],
    }));
  }, [products]);

  const needsReferenceBootstrap = useMemo(() => {
    if (!siteSettings) return true;
    return OFFICIAL_STOREFRONT_CATEGORIES.some(
      (preset) => !categories.some((c) => preset.aliases.includes(c.slug.trim().toLowerCase()))
    );
  }, [categories, siteSettings]);

  const handleBootstrapStructure = async () => {
    if (!actor || !permissions?.canManageCms) return;
    setBootstrapping(true);
    setBootstrapFeedback(null);
    try {
      await bootstrapReferenceStructure(
        actor,
        categories,
        Boolean(siteSettings),
        deliveryZones,
        coupons,
        siteSettings
      );
      setBootstrapFeedback(
        'Synced all 5 official storefront categories (ঔষধ, হারবাল পণ্য, ভিটামিন ও সাপ্লিমেন্ট, স্বাস্থ্যসামগ্রী, স্কিন কেয়ার), coupons (HEALTH50 & CARE10), delivery zones, and CMS settings.'
      );
    } catch (err) {
      setBootstrapFeedback(
        err instanceof Error ? err.message : 'Failed to initialize reference structure.'
      );
    } finally {
      setBootstrapping(false);
    }
  };

  if (loading) {
    return (
      <div className="space-y-6">
        <div className="h-44 bg-white border border-[#E6ECEF] rounded-2xl animate-pulse" />
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-40 bg-white border border-[#E6ECEF] rounded-2xl animate-pulse"
            />
          ))}
        </div>
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 h-80 bg-white border border-[#E6ECEF] rounded-2xl animate-pulse" />
          <div className="xl:col-span-4 h-80 bg-white border border-[#E6ECEF] rounded-2xl animate-pulse" />
        </div>
      </div>
    );
  }

  const revenueSpark = revenueTimeline.map((b) => b.verifiedBdt);
  const orderSpark = revenueTimeline.map((b) => b.ordersCount);
  const stockSpark = [
    productMetrics.published,
    productMetrics.totalUnits,
    productMetrics.totalUnits,
    productMetrics.totalUnits,
  ];
  const rxSpark = [
    prescriptionReviews.length,
    pendingPrescriptions.length,
    prescriptionReviews.length,
  ];
  const lowStockSpark = [
    productMetrics.lowStock,
    productMetrics.outOfStock,
    productMetrics.lowStock + productMetrics.outOfStock,
  ];
  const expirySpark = [
    expiringOrExpiredBatches.length,
    productMetrics.expiredRestricted,
    expiringOrExpiredBatches.length,
  ];

  const kpiCards: Array<{
    title: string;
    value: string;
    subtitle: string;
    metaRight: string;
    accentColor: string;
    iconBg: string;
    iconColor: string;
    icon: React.ComponentType<{ className?: string }>;
    spark: number[];
    targetModule: AdminModuleKey;
  }> = [
    {
      title: 'Total Revenue',
      value: formatBdt(orderMetrics.verifiedSalesBdt),
      subtitle: `${orderMetrics.delivered} delivered · ${customers.length} customers`,
      metaRight: `${orderMetrics.total} orders`,
      accentColor: '#3B82F6',
      iconBg: 'bg-[#EFF6FF]',
      iconColor: 'text-[#2563EB]',
      icon: TrendingUp,
      spark: revenueSpark,
      targetModule: 'orders',
    },
    {
      title: 'Medicines in Stock',
      value: productMetrics.totalUnits.toLocaleString('en-BD'),
      subtitle: `${productMetrics.published} published · ${productMetrics.unpublished} draft`,
      metaRight: `${productMetrics.total} SKUs`,
      accentColor: '#0D9488',
      iconBg: 'bg-[#F0FDFA]',
      iconColor: 'text-[#0D9488]',
      icon: Package,
      spark: stockSpark,
      targetModule: 'products',
    },
    {
      title: 'Active Prescriptions',
      value: prescriptionReviews.length.toLocaleString('en-BD'),
      subtitle: `${pendingPrescriptions.length} awaiting clinical review`,
      metaRight: pendingPrescriptions.length > 0 ? `${pendingPrescriptions.length} pending` : 'Clear',
      accentColor: '#16A34A',
      iconBg: 'bg-[#F0FDF4]',
      iconColor: 'text-[#16A34A]',
      icon: FileCheck2,
      spark: rxSpark,
      targetModule: 'prescriptions',
    },
    {
      title: 'Low Stock Alerts',
      value: (productMetrics.lowStock + productMetrics.outOfStock).toLocaleString('en-BD'),
      subtitle: `${productMetrics.outOfStock} out of stock`,
      metaRight: productMetrics.lowStock + productMetrics.outOfStock > 0 ? 'Needs attention' : 'Nominal',
      accentColor: '#F59E0B',
      iconBg: 'bg-[#FFFBEB]',
      iconColor: 'text-[#D97706]',
      icon: AlertTriangle,
      spark: lowStockSpark,
      targetModule: 'inventory',
    },
    {
      title: 'Expiring Soon',
      value: expiringOrExpiredBatches.length.toLocaleString('en-BD'),
      subtitle: 'Review batches ≤ 60 days',
      metaRight: '60d window',
      accentColor: '#EF4444',
      iconBg: 'bg-[#FEF2F2]',
      iconColor: 'text-[#DC2626]',
      icon: CalendarClock,
      spark: expirySpark,
      targetModule: 'inventory',
    },
    {
      title: "Today's Sales",
      value: formatBdt(todayStats.salesBdt),
      subtitle: `${todayStats.count} order(s) placed today`,
      metaRight: 'Today',
      accentColor: '#2563EB',
      iconBg: 'bg-[#EFF6FF]',
      iconColor: 'text-[#2563EB]',
      icon: ShoppingCart,
      spark: orderSpark,
      targetModule: 'orders',
    },
  ];

  return (
    <div className="space-y-6">
      {syncError && (
        <div className="bg-white border border-[#FCA5A5] rounded-2xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="text-xs text-[#991B1B] break-all">
            <strong>Firestore Sync Interrupted:</strong> {syncError}
          </div>
          <button
            type="button"
            onClick={retrySync}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-white bg-[#DC2626] rounded-lg whitespace-nowrap shrink-0"
          >
            <RefreshCw className="w-3.5 h-3.5" />
            Retry Connection
          </button>
        </div>
      )}

      {/* TIER 1: Deep-Teal Hero Welcome Banner matching uploaded reference image */}
      <section className="relative overflow-hidden rounded-2xl bg-gradient-to-r from-[#0F8F83] via-[#0A6E67] to-[#064A46] p-6 sm:p-7 text-white">
        {/* Subtle Tilted Pharmaceutical Capsule Illustration on Right */}
        <svg
          viewBox="0 0 220 220"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          className="hidden md:block absolute right-6 -bottom-6 w-52 h-52 text-white/12 pointer-events-none select-none"
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

        <div className="relative z-10 max-w-3xl space-y-4">
          <div className="inline-flex items-center gap-2 text-xs text-white/90 bg-white/12 border border-white/20 rounded-lg px-3 py-1">
            <ShieldCheck className="w-3.5 h-3.5 text-[#6EE7B7]" />
            <span>
              All systems operational · Shared Storefront ({categories.length} categories ·{' '}
              {products.length} products)
            </span>
          </div>

          <div className="space-y-1.5">
            <h2 className="text-2xl sm:text-3xl font-bold tracking-tight [text-wrap:balance]">
              {greetingText}, {firstName}
            </h2>
            <p className="text-sm text-white/85 leading-relaxed max-w-2xl">
              Monitor inventory levels, track verified medicine sales, review clinical prescriptions, and manage Finesteride Recur 1Mg Shop Bd from one centralized dashboard.
            </p>
          </div>

          <div className="pt-1 flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => onNavigate('reports_qa')}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-xs font-semibold text-[#07534E] bg-white hover:bg-[#F0FAF9] rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <FileSpreadsheet className="w-4 h-4" />
              Generate Report
            </button>

            <button
              type="button"
              onClick={() => onNavigate('products')}
              className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-white/12 hover:bg-white/20 border border-white/25 rounded-xl transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Medicine
            </button>

            {needsReferenceBootstrap && permissions?.canManageCms && (
              <button
                type="button"
                disabled={bootstrapping}
                onClick={() => void handleBootstrapStructure()}
                className="inline-flex items-center gap-1.5 px-4 py-2.5 text-xs font-semibold text-white bg-[#053B38]/70 hover:bg-[#053B38] border border-white/25 rounded-xl transition-colors whitespace-nowrap shrink-0"
              >
                <CheckCircle2 className="w-4 h-4 text-[#6EE7B7]" />
                {bootstrapping ? 'Initializing...' : 'Initialize Categories & CMS'}
              </button>
            )}

            <div className="hidden sm:flex items-center gap-4 pl-3 ml-1 border-l border-white/20 text-xs text-white/90 font-mono tabular-nums">
              <span className="inline-flex items-center gap-1.5">
                <Activity className="w-3.5 h-3.5 text-[#6EE7B7]" />
                {todayStats.count} transactions today
              </span>
              <span>·</span>
              <span>Compliance: {rxComplianceLabel}</span>
            </div>
          </div>

          {bootstrapFeedback && (
            <p className="text-xs text-[#A7F3D0] pt-1">{bootstrapFeedback}</p>
          )}
        </div>
      </section>

      {/* AI Proactive Stock Intelligence & Depletion Alert Card */}
      <section className="bg-gradient-to-r from-[#F0FDFA] via-[#E6FFFA] to-[#F4F7F8] border border-[#0D7E74]/25 rounded-2xl p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-xs">
        <div className="flex items-start sm:items-center gap-3.5 min-w-0">
          <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-[#0E877C] to-[#064E49] text-white flex items-center justify-center shrink-0 shadow-xs">
            <Bot className="w-5 h-5 text-[#6EE7B7]" />
          </div>
          <div className="space-y-0.5 min-w-0">
            <div className="flex items-center gap-2">
              <span className="text-xs font-bold text-[#0F172A] tracking-tight">
                {t('AI ইনভেন্টরি পূর্বাভাস ও অ্যালার্ট', 'AI Proactive Stock Assistant')}
              </span>
              <span className="inline-flex items-center gap-1 text-[10px] font-bold px-2 py-0.5 rounded-full bg-[#0D7E74]/15 text-[#0D7E74]">
                <Sparkles className="w-3 h-3 text-[#D97706]" />
                Gemini 3.8 Flash
              </span>
            </div>
            <p className="text-xs text-[#334155] leading-relaxed truncate">
              {productMetrics.lowStock + productMetrics.outOfStock > 0
                ? t(
                    `${productMetrics.lowStock + productMetrics.outOfStock}টি পণ্যের স্টক ফুরিয়ে আসার পূর্বাভাস রয়েছে! স্টক শেষ হওয়ার আগেই সতর্ক হতে বিশ্লেষণ দেখুন।`,
                    `${productMetrics.lowStock + productMetrics.outOfStock} product(s) predicted to run out soon. Review AI reorder analysis before stock depletion.`
                  )
                : t(
                    'সকল ওষুধের স্টক ও ব্যাচ মেয়াদ নিরাপদ পর্যায়ে আছে। AI প্রতিনিয়ত স্টক পূর্বাভাস পর্যবেক্ষণ করছে।',
                    'All medicine stock & batch expiry dates are nominal. AI continually monitors depletion risk.'
                  )}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 shrink-0 self-end sm:self-center">
          <button
            type="button"
            onClick={() => onNavigate('inventory')}
            className="px-3.5 py-2 text-xs font-bold text-[#0D7E74] bg-white border border-[#CCFBF1] hover:bg-[#F0FDFA] rounded-xl transition-colors whitespace-nowrap shadow-2xs"
          >
            AI বিশ্লেষণ দেখুন
          </button>
        </div>
      </section>

      {/* TIER 2: 6-Card KPI Row with Top Color Strip + Icon Tile + Tabular Metric + Sparkline */}
      <section className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4">
        {kpiCards.map((card) => {
          const Icon = card.icon;
          return (
            <button
              key={card.title}
              type="button"
              onClick={() => onNavigate(card.targetModule)}
              className="text-left bg-white border border-[#E6ECEF] hover:border-[#CBD5E1] rounded-2xl overflow-hidden transition-colors flex flex-col justify-between group"
            >
              <div className="h-[3px] w-full" style={{ backgroundColor: card.accentColor }} />
              <div className="p-4 space-y-3 flex-1 flex flex-col justify-between">
                <div className="flex items-center justify-between gap-2">
                  <div
                    className={`w-8 h-8 rounded-lg ${card.iconBg} ${card.iconColor} flex items-center justify-center shrink-0`}
                  >
                    <Icon className="w-4 h-4" />
                  </div>
                  <span className="text-[11px] font-mono tabular-nums text-[#64748B] truncate">
                    {card.metaRight}
                  </span>
                </div>

                <div className="space-y-0.5">
                  <div className="text-xs text-[#64748B] truncate">{card.title}</div>
                  <div className="text-xl font-bold font-mono tabular-nums text-[#0F172A] tracking-tight truncate">
                    {card.value}
                  </div>
                  <div className="text-[11px] text-[#94A3B8] truncate">{card.subtitle}</div>
                </div>

                <div className="pt-1">
                  <MiniSparkline values={card.spark} color={card.accentColor} />
                </div>
              </div>
            </button>
          );
        })}
      </section>

      {/* TIER 3: 2-Column Analytics Section (AreaChart + Inventory Distribution Donut) */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6 items-stretch">
        {/* Left: Revenue & Order Performance */}
        <div className="xl:col-span-8 bg-white border border-[#E6ECEF] rounded-2xl p-6 flex flex-col justify-between space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div>
              <h3 className="text-base font-bold text-[#0F172A]">
                Revenue &amp; Order Performance
              </h3>
              <p className="text-xs text-[#64748B]">
                Verified settlements, pending collections, batch procurement cost, and online orders
              </p>
            </div>

            <div className="flex items-center gap-2 self-start">
              <select
                value={dateRange}
                onChange={(e) => setDateRange(e.target.value as DateRangeKey)}
                aria-label="Select analytics timeframe"
                className="px-3 py-1.5 text-xs font-medium bg-[#F4F7F8] border border-[#E6ECEF] rounded-lg text-[#334155] focus:outline-none focus:border-[#0D7E74]"
              >
                <option value="7d">Last 7 days</option>
                <option value="30d">Last 30 days</option>
                <option value="90d">Last 90 days</option>
                <option value="all">All time</option>
              </select>
            </div>
          </div>

          {/* 4 Clean Sub-Metric Blocks */}
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
            <div className="bg-[#F8FAFB] rounded-xl p-3.5 space-y-1">
              <div className="text-xs text-[#64748B]">Verified Revenue</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">
                {formatBdt(orderMetrics.verifiedSalesBdt)}
              </div>
              <div className="text-[11px] text-[#0D9488] font-mono tabular-nums">
                {orderMetrics.delivered} completed
              </div>
            </div>

            <div className="bg-[#F8FAFB] rounded-xl p-3.5 space-y-1">
              <div className="text-xs text-[#64748B]">Pending Collection</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">
                {formatBdt(orderMetrics.pendingSalesBdt)}
              </div>
              <div className="text-[11px] text-[#D97706] font-mono tabular-nums">
                {orderMetrics.pending + orderMetrics.processing} active
              </div>
            </div>

            <div className="bg-[#F8FAFB] rounded-xl p-3.5 space-y-1">
              <div className="text-xs text-[#64748B]">
                {permissions?.canViewWholesaleCosts ? 'Batch Stock Cost' : 'Refunded Volume'}
              </div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">
                {permissions?.canViewWholesaleCosts
                  ? formatBdt(batchProcurementCostBdt)
                  : formatBdt(orderMetrics.refundedSalesBdt)}
              </div>
              <div className="text-[11px] text-[#64748B] font-mono tabular-nums">
                {permissions?.canViewWholesaleCosts
                  ? `${productBatches.length} batch lot(s)`
                  : `${orderMetrics.cancelled} cancelled`}
              </div>
            </div>

            <div className="bg-[#F8FAFB] rounded-xl p-3.5 space-y-1">
              <div className="text-xs text-[#64748B]">Online Orders</div>
              <div className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">
                {orderMetrics.total.toLocaleString('en-BD')}
              </div>
              <div className="text-[11px] text-[#2563EB] font-mono tabular-nums">
                {customers.length} customer(s)
              </div>
            </div>
          </div>

          {/* Smooth Teal AreaChart */}
          <div className="h-56 w-full pt-2">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={revenueTimeline} margin={{ top: 8, right: 8, left: 0, bottom: 0 }}>
                <defs>
                  <linearGradient id="tealRevenueArea" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0D9488" stopOpacity={0.26} />
                    <stop offset="100%" stopColor="#0D9488" stopOpacity={0.01} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#EEF2F6" />
                <XAxis
                  dataKey="label"
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                />
                <YAxis
                  tick={{ fontSize: 11, fill: '#64748B' }}
                  axisLine={false}
                  tickLine={false}
                  width={54}
                />
                <Tooltip
                  contentStyle={{
                    borderRadius: '12px',
                    border: '1px solid #E6ECEF',
                    fontSize: '12px',
                  }}
                  formatter={(val, name) => [
                    formatBdt(Number(val) || 0),
                    name === 'verifiedBdt' ? 'Verified Revenue' : 'Pending Settlement',
                  ]}
                />
                <Area
                  type="monotone"
                  dataKey="verifiedBdt"
                  stroke="#0D9488"
                  strokeWidth={2.4}
                  fill="url(#tealRevenueArea)"
                />
                <Area
                  type="monotone"
                  dataKey="pendingBdt"
                  stroke="#3B82F6"
                  strokeWidth={1.6}
                  fillOpacity={0}
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Right: Inventory Distribution Donut Card */}
        <div className="xl:col-span-4 bg-white border border-[#E6ECEF] rounded-2xl p-6 flex flex-col justify-between space-y-4">
          <div className="flex items-start justify-between gap-2">
            <div>
              <h3 className="text-base font-bold text-[#0F172A]">Inventory Distribution</h3>
              <p className="text-xs text-[#64748B]">Stock breakdown by category</p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('categories')}
              className="text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
            >
              Manage
            </button>
          </div>

          {categoryStockBreakdown.length === 0 || productMetrics.totalUnits === 0 ? (
            <div className="flex-1 flex flex-col items-center justify-center text-center py-8 space-y-3">
              <div className="w-32 h-32 rounded-full border-[14px] border-[#EEF2F6] flex flex-col items-center justify-center">
                <span className="text-[11px] text-[#64748B]">Total Stock</span>
                <span className="text-lg font-bold font-mono tabular-nums text-[#0F172A]">0</span>
              </div>
              <p className="text-xs text-[#64748B] max-w-[220px]">
                Add medicines or receive batches to visualize live category stock shares.
              </p>
              <button
                type="button"
                onClick={() => onNavigate('products')}
                className="px-3.5 py-1.5 text-xs font-medium text-white bg-[#0D7E74] hover:bg-[#09635B] rounded-lg whitespace-nowrap shrink-0"
              >
                Add First Medicine
              </button>
            </div>
          ) : (
            <>
              <div className="relative h-48 w-full flex items-center justify-center">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={categoryStockBreakdown}
                      dataKey="units"
                      nameKey="name"
                      cx="50%"
                      cy="50%"
                      innerRadius={58}
                      outerRadius={82}
                      paddingAngle={2}
                      stroke="none"
                    >
                      {categoryStockBreakdown.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} />
                      ))}
                    </Pie>
                    <Tooltip
                      contentStyle={{
                        borderRadius: '10px',
                        border: '1px solid #E6ECEF',
                        fontSize: '12px',
                      }}
                      formatter={(val) => [
                        `${(Number(val) || 0).toLocaleString('en-BD')} units`,
                        'Stock',
                      ]}
                    />
                  </PieChart>
                </ResponsiveContainer>
                <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
                  <span className="text-[11px] text-[#64748B]">Total Stock</span>
                  <span className="text-xl font-bold font-mono tabular-nums text-[#0F172A]">
                    {productMetrics.totalUnits.toLocaleString('en-BD')}
                  </span>
                </div>
              </div>

              <div className="space-y-2 pt-1 border-t border-[#EEF2F6]">
                {categoryStockBreakdown.map((row) => (
                  <div
                    key={row.name}
                    className="flex items-center justify-between gap-2 text-xs"
                  >
                    <div className="flex items-center gap-2 min-w-0">
                      <span
                        className="w-2.5 h-2.5 rounded-xs shrink-0"
                        style={{ backgroundColor: row.color }}
                        aria-hidden="true"
                      />
                      <span className="text-[#334155] truncate">{row.name}</span>
                    </div>
                    <div className="flex items-center gap-3 font-mono tabular-nums shrink-0">
                      <span className="text-[#64748B]">
                        {row.units.toLocaleString('en-BD')}
                      </span>
                      <span className="font-semibold text-[#0F172A] w-9 text-right">
                        {row.pct}%
                      </span>
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      </section>

      {/* TIER 4: Clinical Safety & Batch Expiry Action Queues + Recent Audit Log */}
      <section className="grid grid-cols-1 xl:grid-cols-12 gap-6">
        {/* Clinical & Expiry Priority Queue */}
        <div className="xl:col-span-5 bg-white border border-[#E6ECEF] rounded-2xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0F172A]">
                Clinical &amp; Batch Safety Queue
              </h3>
              <p className="text-xs text-[#64748B]">
                Pending Rx reviews and near-expiry lot alerts
              </p>
            </div>
            <button
              type="button"
              onClick={() => onNavigate('prescriptions')}
              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
            >
              Review All
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="divide-y divide-[#EEF2F6] flex-1">
            {pendingPrescriptions.length === 0 && expiringOrExpiredBatches.length === 0 ? (
              <div className="p-6 text-center text-xs text-[#64748B]">
                No pending clinical prescriptions or expiring pharmaceutical batches require immediate intervention.
              </div>
            ) : (
              <>
                {pendingPrescriptions.slice(0, 3).map((rx) => (
                  <div
                    key={rx.id}
                    className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8FAFB]"
                  >
                    <div className="min-w-0">
                      <div className="text-xs font-semibold text-[#0F172A] truncate">
                        Rx Review · {rx.orderNumber} · {rx.customerName}
                      </div>
                      <div className="text-[11px] text-[#64748B] truncate">
                        {rx.medicineSummary} · Dr. {rx.prescriberName}
                      </div>
                    </div>
                    <button
                      type="button"
                      onClick={() => onNavigate('prescriptions')}
                      className="px-2.5 py-1 text-xs font-medium text-[#0D7E74] bg-[#F0FDFA] hover:bg-[#CCFBF1] rounded-lg whitespace-nowrap shrink-0"
                    >
                      Verify Rx
                    </button>
                  </div>
                ))}

                {expiringOrExpiredBatches.slice(0, 3).map((bat) => {
                  const days = daysUntilExpiry(bat.expiryDate);
                  return (
                    <div
                      key={bat.id}
                      className="px-6 py-3.5 flex items-center justify-between gap-3 hover:bg-[#F8FAFB]"
                    >
                      <div className="min-w-0">
                        <div className="text-xs font-semibold text-[#0F172A] truncate">
                          Batch {bat.batchNumber} · {bat.productName}
                        </div>
                        <div className="text-[11px] text-[#DC2626] font-mono tabular-nums">
                          Exp: {bat.expiryDate} ({days !== null ? `${days}d` : bat.status}) · Rem:{' '}
                          {bat.quantityRemaining}
                        </div>
                      </div>
                      <button
                        type="button"
                        onClick={() => onNavigate('inventory')}
                        className="px-2.5 py-1 text-xs font-medium text-[#DC2626] bg-[#FEF2F2] hover:bg-[#FEE2E2] rounded-lg whitespace-nowrap shrink-0"
                      >
                        Inspect
                      </button>
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Recent Administrative Activity Stream */}
        <div className="xl:col-span-7 bg-white border border-[#E6ECEF] rounded-2xl overflow-hidden flex flex-col">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
            <div>
              <h3 className="text-sm font-bold text-[#0F172A]">
                Recent Administrative Activity
              </h3>
              <p className="text-xs text-[#64748B]">
                Live append-only audit trail from shared Firestore
              </p>
            </div>
            {permissions?.canViewAuditLogs && (
              <button
                type="button"
                onClick={() => onNavigate('staff_security')}
                className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
              >
                Full Audit Log
                <ArrowRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {auditLogs.length === 0 ? (
            <div className="p-6 text-center text-xs text-[#64748B]">
              Administrative actions (catalog edits, batch receipts, Rx reviews, and order transitions) will appear here in real time.
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold text-[#64748B]">
                    <th className="py-2.5 px-6">Time</th>
                    <th className="py-2.5 px-4">Module · Action</th>
                    <th className="py-2.5 px-4">Target</th>
                    <th className="py-2.5 px-6">Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {auditLogs.slice(0, 6).map((log) => (
                    <tr key={log.id} className="hover:bg-[#F8FAFB]">
                      <td className="py-2.5 px-6 font-mono tabular-nums text-[#64748B] whitespace-nowrap">
                        {formatTimestamp(log.createdAt)}
                      </td>
                      <td className="py-2.5 px-4 font-mono text-[#0F172A]">
                        {log.module.toUpperCase()} · {log.action}
                      </td>
                      <td className="py-2.5 px-4 text-[#334155] truncate max-w-[180px]">
                        {log.targetLabel}
                      </td>
                      <td className="py-2.5 px-6 text-[#64748B] truncate max-w-[160px]">
                        {log.actorEmail}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
