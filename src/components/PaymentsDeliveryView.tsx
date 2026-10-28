import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  CreditCard,
  Edit3,
  Plus,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Trash2,
  Truck,
  Wallet,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { formatBdt, formatTimestamp } from '../lib/validation';
import {
  buildDefaultStorefrontSettingsPayload,
  deleteDeliveryZoneRecord,
  ensureDefaultDeliveryZones,
  parsePaymentGatewayConfig,
  recordPaymentDecision,
  saveDeliveryZoneRecord,
  saveSiteSettingsConfig,
  serializePaymentGatewayConfig,
  type PaymentDecisionType,
} from '../services/pharmacyService';
import type { DeliveryZone, Order, PaymentMethod, PaymentStatus } from '../types/pharmacy';

const SUPPORTED_PAYMENT_CHANNELS: Array<{
  id: PaymentMethod;
  label: string;
  labelBn: string;
  subtitle: string;
  settlementPolicy: string;
}> = [
  {
    id: 'cod',
    label: 'Cash on Delivery (COD)',
    labelBn: 'ক্যাশ অন ডেলিভারি',
    subtitle: 'Collected upon sealed courier handoff across Bangladesh',
    settlementPolicy:
      'Marked Unpaid until courier cash-collection remittance is verified by authorized staff.',
  },
  {
    id: 'bkash',
    label: 'bKash Payment',
    labelBn: 'বিকাশ পেমেন্ট',
    subtitle: 'Mobile financial services merchant / send-money checkout',
    settlementPolicy:
      'Client-submitted TrxID enters Pending Verification; never marked paid until verified against bKash settlement.',
  },
  {
    id: 'nagad',
    label: 'Nagad Payment',
    labelBn: 'নগদ পেমেন্ট',
    subtitle: 'Mobile financial services merchant / send-money checkout',
    settlementPolicy:
      'Client-submitted issuer reference enters Pending Verification; verified server-side prior to paid reconciliation.',
  },
];

type PaymentQueueFilter = 'action_needed' | 'all' | PaymentStatus;

export function PaymentsDeliveryView() {
  const { permissions } = useAuth();
  const { actor, orders, deliveryZones, siteSettings } = useStoreData();

  const [activeTab, setActiveTab] = useState<'gateways' | 'verification' | 'zones'>('gateways');

  // Merchant Payment Gateway Form State
  const parsedGateway = useMemo(
    () => parsePaymentGatewayConfig(siteSettings?.paymentInfoPolicy),
    [siteSettings?.paymentInfoPolicy]
  );

  const [bkashNumber, setBkashNumber] = useState(parsedGateway.bkashNumber);
  const [bkashAccountType, setBkashAccountType] = useState<
    'Merchant Payment' | 'Personal Send Money'
  >(parsedGateway.bkashAccountType);
  const [nagadNumber, setNagadNumber] = useState(parsedGateway.nagadNumber);
  const [nagadAccountType, setNagadAccountType] = useState<
    'Merchant Payment' | 'Personal Send Money'
  >(parsedGateway.nagadAccountType);
  const [rocketNumber, setRocketNumber] = useState(parsedGateway.rocketNumber);
  const [codTerms, setCodTerms] = useState(parsedGateway.codTerms);
  const [checkoutSafetyNotice, setCheckoutSafetyNotice] = useState(
    parsedGateway.checkoutSafetyNotice
  );
  const [savingGatewayForm, setSavingGatewayForm] = useState(false);

  useEffect(() => {
    setBkashNumber(parsedGateway.bkashNumber);
    setBkashAccountType(parsedGateway.bkashAccountType);
    setNagadNumber(parsedGateway.nagadNumber);
    setNagadAccountType(parsedGateway.nagadAccountType);
    setRocketNumber(parsedGateway.rocketNumber);
    setCodTerms(parsedGateway.codTerms);
    setCheckoutSafetyNotice(parsedGateway.checkoutSafetyNotice);
  }, [parsedGateway]);

  // Payment Verification Queue State
  const [queueFilter, setQueueFilter] = useState<PaymentQueueFilter>('action_needed');
  const [methodFilter, setMethodFilter] = useState<'all' | PaymentMethod>('all');
  const [queueSearch, setQueueSearch] = useState('');
  const [selectedOrderForPayment, setSelectedOrderForPayment] = useState<Order | null>(null);
  const [decisionType, setDecisionType] = useState<PaymentDecisionType>('verify_paid');
  const [txnRefInput, setTxnRefInput] = useState('');
  const [decisionReason, setDecisionReason] = useState('');
  const [reconciliationConfirmed, setReconciliationConfirmed] = useState(false);
  const [submittingDecision, setSubmittingDecision] = useState(false);

  // Delivery Zone Modal & Delete State
  const [zoneModalOpen, setZoneModalOpen] = useState(false);
  const [editingZone, setEditingZone] = useState<DeliveryZone | null>(null);
  const [confirmDeleteZoneId, setConfirmDeleteZoneId] = useState<string | null>(null);

  const [zoneName, setZoneName] = useState('');
  const [coverageAreas, setCoverageAreas] = useState('');
  const [deliveryFeeBdt, setDeliveryFeeBdt] = useState(60);
  const [freeDeliveryMinOrderBdt, setFreeDeliveryMinOrderBdt] = useState(1500);
  const [estimatedDeliveryText, setEstimatedDeliveryText] = useState('1–2 Days Inside Dhaka');
  const [courierPartner, setCourierPartner] = useState('Own Pharmacy Dispatch / Pathao Pharma');
  const [instructions, setInstructions] = useState('');
  const [zoneStatus, setZoneStatus] = useState<'active' | 'inactive'>('active');

  const [savingPaymentToggle, setSavingPaymentToggle] = useState(false);
  const [savingZone, setSavingZone] = useState(false);
  const [syncingDefaults, setSyncingDefaults] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const enabledMethods = useMemo(() => {
    if (siteSettings?.enabledPaymentMethods && siteSettings.enabledPaymentMethods.length > 0) {
      return siteSettings.enabledPaymentMethods;
    }
    return ['cod', 'bkash', 'nagad'];
  }, [siteSettings]);

  const paymentKpis = useMemo(() => {
    let verifiedTotalBdt = 0;
    let pendingVerificationCount = 0;
    let pendingVerificationBdt = 0;
    let unpaidCodCount = 0;
    let unpaidCodBdt = 0;
    let refundPendingCount = 0;
    let refundedOrPendingBdt = 0;

    for (const o of orders) {
      if (o.orderStatus === 'cancelled' && o.paymentStatus !== 'refund_pending' && o.paymentStatus !== 'refunded') {
        continue;
      }
      if (o.paymentStatus === 'verified_paid') {
        verifiedTotalBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'pending_verification') {
        pendingVerificationCount += 1;
        pendingVerificationBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'unpaid') {
        unpaidCodCount += 1;
        unpaidCodBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'refund_pending') {
        refundPendingCount += 1;
        refundedOrPendingBdt += o.totalAmountBdt;
      } else if (o.paymentStatus === 'refunded') {
        refundedOrPendingBdt += o.totalAmountBdt;
      }
    }

    return {
      verifiedTotalBdt,
      pendingVerificationCount,
      pendingVerificationBdt,
      unpaidCodCount,
      unpaidCodBdt,
      refundPendingCount,
      refundedOrPendingBdt,
      actionNeededCount: pendingVerificationCount + refundPendingCount,
    };
  }, [orders]);

  const settlementSummary = useMemo(() => {
    return SUPPORTED_PAYMENT_CHANNELS.map((channel) => {
      const channelOrders = orders.filter((o) => o.paymentMethod === channel.id);
      let verifiedBdt = 0;
      let pendingBdt = 0;
      let refundedBdt = 0;
      let failedCount = 0;

      for (const ord of channelOrders) {
        if (ord.paymentStatus === 'failed') {
          failedCount += 1;
        }
        if (
          ord.orderStatus === 'cancelled' &&
          ord.paymentStatus !== 'refunded' &&
          ord.paymentStatus !== 'refund_pending'
        ) {
          continue;
        }
        if (ord.paymentStatus === 'verified_paid') {
          verifiedBdt += ord.totalAmountBdt;
        } else if (ord.paymentStatus === 'refunded' || ord.orderStatus === 'refunded') {
          refundedBdt += ord.totalAmountBdt;
        } else if (
          ord.paymentStatus === 'unpaid' ||
          ord.paymentStatus === 'pending_verification' ||
          ord.paymentStatus === 'refund_pending'
        ) {
          pendingBdt += ord.totalAmountBdt;
        }
      }

      return {
        ...channel,
        orderCount: channelOrders.length,
        verifiedBdt,
        pendingBdt,
        refundedBdt,
        failedCount,
      };
    });
  }, [orders]);

  const filteredPaymentOrders = useMemo(() => {
    const q = queueSearch.trim().toLowerCase();
    return orders.filter((o) => {
      if (methodFilter !== 'all' && o.paymentMethod !== methodFilter) return false;
      if (queueFilter === 'action_needed') {
        const needsAction =
          (o.paymentStatus === 'pending_verification' && o.orderStatus !== 'cancelled') ||
          o.paymentStatus === 'refund_pending' ||
          (o.paymentStatus === 'unpaid' &&
            o.orderStatus !== 'cancelled' &&
            (o.orderStatus === 'shipped' || o.orderStatus === 'delivered'));
        if (!needsAction) return false;
      } else if (queueFilter !== 'all' && o.paymentStatus !== queueFilter) {
        return false;
      }

      if (q) {
        const hay = `${o.orderNumber} ${o.transactionReference} ${o.customerName} ${o.customerPhone} ${o.paymentMethod}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [orders, methodFilter, queueFilter, queueSearch]);

  const handleTogglePaymentChannel = async (methodId: PaymentMethod) => {
    if (!actor || !permissions?.canManageCms) return;
    setErrorMsg(null);
    setSuccessMsg(null);

    const exists = enabledMethods.includes(methodId);
    const nextMethods = exists
      ? enabledMethods.filter((m) => m !== methodId)
      : [...enabledMethods, methodId];

    if (nextMethods.length === 0) {
      setErrorMsg('At least one storefront payment method must remain enabled.');
      return;
    }

    setSavingPaymentToggle(true);
    try {
      const basePayload = buildDefaultStorefrontSettingsPayload(siteSettings);
      await saveSiteSettingsConfig(
        actor,
        {
          ...basePayload,
          enabledPaymentMethods: nextMethods,
        },
        Boolean(siteSettings)
      );
      setSuccessMsg(
        `Storefront payment options updated (${nextMethods.map((m) => m.toUpperCase()).join(' · ')}).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update payment channels.');
    } finally {
      setSavingPaymentToggle(false);
    }
  };

  const handleSaveMerchantGatewaySettings = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canManageCms) return;
    setSavingGatewayForm(true);
    setErrorMsg(null);
    setSuccessMsg(null);

    try {
      const basePayload = buildDefaultStorefrontSettingsPayload(siteSettings);
      const serializedPolicy = serializePaymentGatewayConfig({
        bkashNumber,
        bkashAccountType,
        nagadNumber,
        nagadAccountType,
        rocketNumber,
        codTerms,
        checkoutSafetyNotice,
      });

      await saveSiteSettingsConfig(
        actor,
        {
          ...basePayload,
          enabledPaymentMethods: enabledMethods,
          paymentInfoPolicy: serializedPolicy,
        },
        Boolean(siteSettings)
      );
      setSuccessMsg('Saved merchant payment numbers & checkout policy to Customer Storefront.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save merchant payment settings.');
    } finally {
      setSavingGatewayForm(false);
    }
  };

  const handleSyncDefaultPaymentsAndZones = async () => {
    if (!actor) return;
    setSyncingDefaults(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      let zoneCount = 0;
      if (permissions?.canManageDelivery) {
        zoneCount = await ensureDefaultDeliveryZones(actor, deliveryZones);
      }
      if (permissions?.canManageCms && !siteSettings) {
        await saveSiteSettingsConfig(
          actor,
          buildDefaultStorefrontSettingsPayload(null),
          false
        );
      }
      setSuccessMsg(
        zoneCount > 0
          ? `Synchronized ${zoneCount} default delivery zone(s) and storefront payment configuration.`
          : 'Default payment channels (COD, bKash, Nagad) and delivery zones are synchronized.'
      );
    } catch (err) {
      setErrorMsg(
        err instanceof Error ? err.message : 'Failed to synchronize default payment and zone settings.'
      );
    } finally {
      setSyncingDefaults(false);
    }
  };

  const openPaymentDecisionModal = (order: Order, initialDecision?: PaymentDecisionType) => {
    setErrorMsg(null);
    setSelectedOrderForPayment(order);
    const defaultDecision: PaymentDecisionType =
      initialDecision ||
      (order.paymentStatus === 'refund_pending' ? 'complete_refund' : 'verify_paid');
    setDecisionType(defaultDecision);
    setTxnRefInput(order.transactionReference || '');
    setDecisionReason('');
    setReconciliationConfirmed(false);
  };

  const handleApplyPaymentDecision = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !selectedOrderForPayment || !permissions?.canVerifyPayments) return;
    setSubmittingDecision(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await recordPaymentDecision(actor, selectedOrderForPayment, {
        decision: decisionType,
        transactionReference: txnRefInput,
        reconciliationConfirmed,
        reason: decisionReason,
      });
      setSuccessMsg(
        decisionType === 'verify_paid'
          ? `Verified ${selectedOrderForPayment.paymentMethod.toUpperCase()} payment for order ${selectedOrderForPayment.orderNumber}.`
          : decisionType === 'complete_refund'
          ? `Recorded completed refund for order ${selectedOrderForPayment.orderNumber}.`
          : `Marked payment as failed/rejected for order ${selectedOrderForPayment.orderNumber}.`
      );
      setSelectedOrderForPayment(null);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Payment decision rejected.');
    } finally {
      setSubmittingDecision(false);
    }
  };

  const openCreateZone = () => {
    setErrorMsg(null);
    setEditingZone(null);
    setZoneName('');
    setCoverageAreas('');
    setDeliveryFeeBdt(60);
    setFreeDeliveryMinOrderBdt(1500);
    setEstimatedDeliveryText('1–2 Days Inside Dhaka');
    setCourierPartner('Own Pharmacy Dispatch / Pathao Pharma');
    setInstructions('Temperature-controlled insulated pouch used for heat-sensitive medicines.');
    setZoneStatus('active');
    setZoneModalOpen(true);
  };

  const openEditZone = (zone: DeliveryZone) => {
    setErrorMsg(null);
    setEditingZone(zone);
    setZoneName(zone.zoneName);
    setCoverageAreas(zone.coverageAreas);
    setDeliveryFeeBdt(zone.deliveryFeeBdt);
    setFreeDeliveryMinOrderBdt(zone.freeDeliveryMinOrderBdt);
    setEstimatedDeliveryText(zone.estimatedDeliveryText);
    setCourierPartner(zone.courierPartner);
    setInstructions(zone.instructions);
    setZoneStatus(zone.status);
    setZoneModalOpen(true);
  };

  const handleSaveZone = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canManageDelivery) return;
    if (!zoneName.trim() || !coverageAreas.trim()) {
      setErrorMsg('Zone name and coverage areas are required.');
      return;
    }
    setSavingZone(true);
    setErrorMsg(null);
    try {
      await saveDeliveryZoneRecord(actor, {
        id: editingZone?.id,
        zoneName,
        coverageAreas,
        deliveryFeeBdt,
        freeDeliveryMinOrderBdt,
        estimatedDeliveryText,
        courierPartner,
        instructions,
        status: zoneStatus,
      });
      setZoneModalOpen(false);
      setSuccessMsg(`Saved delivery zone "${zoneName}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save delivery zone.');
    } finally {
      setSavingZone(false);
    }
  };

  const handleToggleZoneStatus = async (zone: DeliveryZone) => {
    if (!actor || !permissions?.canManageDelivery) return;
    setSavingZone(true);
    setErrorMsg(null);
    try {
      const next = zone.status === 'active' ? 'inactive' : 'active';
      await saveDeliveryZoneRecord(actor, {
        id: zone.id,
        zoneName: zone.zoneName,
        coverageAreas: zone.coverageAreas,
        deliveryFeeBdt: zone.deliveryFeeBdt,
        freeDeliveryMinOrderBdt: zone.freeDeliveryMinOrderBdt,
        estimatedDeliveryText: zone.estimatedDeliveryText,
        courierPartner: zone.courierPartner,
        instructions: zone.instructions,
        status: next,
      });
      setSuccessMsg(`Zone "${zone.zoneName}" marked ${next}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not toggle zone status.');
    } finally {
      setSavingZone(false);
    }
  };

  const handleDeleteZone = async (zone: DeliveryZone) => {
    if (!actor || !permissions?.canManageDelivery) return;
    setSavingZone(true);
    setErrorMsg(null);
    try {
      await deleteDeliveryZoneRecord(actor, zone);
      setConfirmDeleteZoneId(null);
      setSuccessMsg(`Deleted delivery zone "${zone.zoneName}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete delivery zone.');
    } finally {
      setSavingZone(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Header & Sub-Navigation */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Payments, Merchant Gateways &amp; Delivery Zones
          </h1>
          <p className="text-sm text-[#64748B]">
            Configure COD, bKash &amp; Nagad payment options, merchant numbers, TrxID settlement verification, refunds, and nationwide courier zones.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex bg-white border border-[#E6ECEF] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setActiveTab('gateways')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'gateways'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <CreditCard className="w-3.5 h-3.5" />
              Payment Options ({enabledMethods.length}/3)
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('verification')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'verification'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Wallet className="w-3.5 h-3.5" />
              TrxID &amp; Refunds ({paymentKpis.actionNeededCount})
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('zones')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                activeTab === 'zones'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Truck className="w-3.5 h-3.5" />
              Delivery Zones ({deliveryZones.length})
            </button>
          </div>

          {(permissions?.canManageDelivery || permissions?.canManageCms) &&
            (deliveryZones.length === 0 || !siteSettings) && (
              <button
                type="button"
                disabled={syncingDefaults}
                onClick={() => void handleSyncDefaultPaymentsAndZones()}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0D7E74] bg-white border border-[#0D7E74] hover:bg-[#F0FDFA] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                {syncingDefaults ? 'Syncing...' : 'Sync Default Payments & Zones'}
              </button>
            )}

          {permissions?.canManageDelivery && (
            <button
              type="button"
              onClick={() => {
                setActiveTab('zones');
                openCreateZone();
              }}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              Add Delivery Zone
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

      {/* Financial Reconciliation KPI Strip */}
      <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-4 gap-4">
        <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 space-y-1">
          <div className="text-xs font-medium text-[#64748B]">Verified Paid Revenue</div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#15803D]">
            {formatBdt(paymentKpis.verifiedTotalBdt)}
          </div>
          <div className="text-[11px] text-[#64748B]">
            Server-reconciled COD, bKash &amp; Nagad
          </div>
        </div>

        <button
          type="button"
          onClick={() => {
            setActiveTab('verification');
            setQueueFilter('pending_verification');
          }}
          className="text-left bg-white border border-[#E6ECEF] hover:border-[#0D7E74] rounded-xl p-4 space-y-1 transition-colors"
        >
          <div className="text-xs font-medium text-[#64748B]">
            Pending TrxID Verification ({paymentKpis.pendingVerificationCount})
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#B45309]">
            {formatBdt(paymentKpis.pendingVerificationBdt)}
          </div>
          <div className="text-[11px] text-[#0D7E74] font-medium">
            Review bKash / Nagad TrxIDs →
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('verification');
            setQueueFilter('unpaid');
          }}
          className="text-left bg-white border border-[#E6ECEF] hover:border-[#0D7E74] rounded-xl p-4 space-y-1 transition-colors"
        >
          <div className="text-xs font-medium text-[#64748B]">
            Unpaid Cash on Delivery ({paymentKpis.unpaidCodCount})
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#0F172A]">
            {formatBdt(paymentKpis.unpaidCodBdt)}
          </div>
          <div className="text-[11px] text-[#64748B]">
            Awaiting courier cash remittance
          </div>
        </button>

        <button
          type="button"
          onClick={() => {
            setActiveTab('verification');
            setQueueFilter('refund_pending');
          }}
          className="text-left bg-white border border-[#E6ECEF] hover:border-[#0D7E74] rounded-xl p-4 space-y-1 transition-colors"
        >
          <div className="text-xs font-medium text-[#64748B]">
            Refund Queue ({paymentKpis.refundPendingCount} pending)
          </div>
          <div className="text-xl font-bold font-mono tabular-nums text-[#991B1B]">
            {formatBdt(paymentKpis.refundedOrPendingBdt)}
          </div>
          <div className="text-[11px] text-[#64748B]">
            Total pending &amp; completed refunds
          </div>
        </button>
      </div>

      {/* TAB 1: PAYMENT OPTIONS & MERCHANT CONFIGURATION */}
      {activeTab === 'gateways' && (
        <div className="space-y-6">
          {/* Payment Security Notice */}
          <div className="bg-white border border-[#E6ECEF] rounded-xl p-5 flex items-start gap-3.5">
            <ShieldCheck className="w-5 h-5 text-[#0D7E74] shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Zero-Trust Payment Security &amp; Anti-Spoofing Controls
              </h2>
              <p className="text-xs text-[#64748B] leading-relaxed">
                Neither the Customer Storefront nor Admin Panel ever asks for customer bKash/Nagad PINs, OTPs, or card secrets. Client-submitted transaction references enter{' '}
                <span className="font-mono text-[#0F172A]">pending_verification</span> and require staff &amp; server validation (<span className="font-mono text-[#0F172A]">/api/payments/verify-gateway</span>) before transitioning to{' '}
                <span className="font-mono text-[#0F172A]">verified_paid</span>.
              </p>
            </div>
          </div>

          {/* Storefront Payment Channels Table */}
          <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between gap-4">
              <div className="flex items-center gap-2.5">
                <CreditCard className="w-4 h-4 text-[#0D7E74]" />
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Storefront Payment Channels (COD · bKash · Nagad)
                </h2>
              </div>
              <span className="text-xs text-[#64748B] font-mono tabular-nums">
                {enabledMethods.length} of 3 active on checkout
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-3 px-6">Channel</th>
                    <th className="py-3 px-4">Verification Policy</th>
                    <th className="py-3 px-4 text-right">Orders</th>
                    <th className="py-3 px-4 text-right">Verified Paid</th>
                    <th className="py-3 px-4 text-right">Pending / Unpaid</th>
                    <th className="py-3 px-4 text-right">Refunded</th>
                    <th className="py-3 px-6 text-right">Storefront Availability</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {settlementSummary.map((row) => {
                    const isEnabled = enabledMethods.includes(row.id);
                    return (
                      <tr key={row.id} className="hover:bg-[#F8FAFB] transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-semibold text-[#0F172A]">
                            {row.label}{' '}
                            <span className="text-xs font-normal text-[#64748B]">
                              ({row.labelBn})
                            </span>
                          </div>
                          <div className="text-xs text-[#64748B]">{row.subtitle}</div>
                          {row.failedCount > 0 && (
                            <div className="text-[11px] font-mono text-[#DC2626] mt-0.5">
                              {row.failedCount} rejected TrxID(s)
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 max-w-xs text-xs text-[#64748B] leading-relaxed">
                          {row.settlementPolicy}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums text-[#0F172A]">
                          {row.orderCount}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums font-medium text-[#15803D]">
                          {formatBdt(row.verifiedBdt)}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums text-[#B45309]">
                          {formatBdt(row.pendingBdt)}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums text-[#64748B]">
                          {formatBdt(row.refundedBdt)}
                        </td>
                        <td className="py-4 px-6 text-right">
                          {permissions?.canManageCms ? (
                            <button
                              type="button"
                              disabled={savingPaymentToggle}
                              onClick={() => void handleTogglePaymentChannel(row.id)}
                              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                                isEnabled
                                  ? 'border-[#0D7E74] text-[#0D7E74] bg-[#F0FDFA] hover:bg-[#E4F1EA]'
                                  : 'border-[#E6ECEF] text-[#64748B] bg-white hover:bg-[#F4F7F8]'
                              }`}
                            >
                              {isEnabled ? 'Enabled · Disable' : 'Disabled · Enable'}
                            </button>
                          ) : (
                            <span className="text-xs font-medium text-[#64748B]">
                              {isEnabled ? 'Enabled' : 'Disabled'}
                            </span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* Merchant Account Numbers & Checkout Payment Instructions */}
          <form
            onSubmit={handleSaveMerchantGatewaySettings}
            className="bg-white border border-[#E6ECEF] rounded-xl p-6 space-y-5"
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-[#EEF2F6] pb-4">
              <div className="flex items-center gap-2.5">
                <Smartphone className="w-4 h-4 text-[#0D7E74]" />
                <div>
                  <h2 className="text-base font-semibold text-[#0F172A]">
                    Merchant Payment Accounts &amp; Checkout Instructions (বিকাশ / নগদ নম্বর ও নীতিমালা)
                  </h2>
                  <p className="text-xs text-[#64748B]">
                    Synchronized directly with <span className="font-mono">siteSettings/storefront_config</span> so customers see accurate payment numbers and safety instructions during checkout.
                  </p>
                </div>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div className="space-y-2 border border-[#EEF2F6] rounded-lg p-3.5 bg-[#FAFCFC]">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  bKash Account Number (বিকাশ নম্বর)
                </label>
                <input
                  type="text"
                  disabled={!permissions?.canManageCms}
                  value={bkashNumber}
                  onChange={(e) => setBkashNumber(e.target.value)}
                  placeholder="e.g., 017XX-XXXXXX"
                  className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                />
                <select
                  disabled={!permissions?.canManageCms}
                  value={bkashAccountType}
                  onChange={(e) =>
                    setBkashAccountType(
                      e.target.value as 'Merchant Payment' | 'Personal Send Money'
                    )
                  }
                  className="w-full px-2.5 py-1.5 text-xs border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="Merchant Payment">Merchant Payment (Make Payment)</option>
                  <option value="Personal Send Money">Personal Account (Send Money)</option>
                </select>
              </div>

              <div className="space-y-2 border border-[#EEF2F6] rounded-lg p-3.5 bg-[#FAFCFC]">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Nagad Account Number (নগদ নম্বর)
                </label>
                <input
                  type="text"
                  disabled={!permissions?.canManageCms}
                  value={nagadNumber}
                  onChange={(e) => setNagadNumber(e.target.value)}
                  placeholder="e.g., 018XX-XXXXXX"
                  className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                />
                <select
                  disabled={!permissions?.canManageCms}
                  value={nagadAccountType}
                  onChange={(e) =>
                    setNagadAccountType(
                      e.target.value as 'Merchant Payment' | 'Personal Send Money'
                    )
                  }
                  className="w-full px-2.5 py-1.5 text-xs border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="Merchant Payment">Merchant Payment (Make Payment)</option>
                  <option value="Personal Send Money">Personal Account (Send Money)</option>
                </select>
              </div>

              <div className="space-y-2 border border-[#EEF2F6] rounded-lg p-3.5 bg-[#FAFCFC]">
                <label className="block text-xs font-semibold text-[#0F172A]">
                  Optional Helpline / Alternative MFS (রকেট / হেল্পলাইন)
                </label>
                <input
                  type="text"
                  disabled={!permissions?.canManageCms}
                  value={rocketNumber}
                  onChange={(e) => setRocketNumber(e.target.value)}
                  placeholder="Optional Rocket / Billing Support #"
                  className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                />
                <p className="text-[11px] text-[#64748B] leading-snug pt-0.5">
                  Shown inside customer payment instructions if customers need assisted billing support.
                </p>
              </div>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Cash on Delivery (COD) Terms
                </label>
                <textarea
                  rows={2}
                  disabled={!permissions?.canManageCms}
                  value={codTerms}
                  onChange={(e) => setCodTerms(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Customer Checkout Safety &amp; OTP Policy
                </label>
                <textarea
                  rows={2}
                  disabled={!permissions?.canManageCms}
                  value={checkoutSafetyNotice}
                  onChange={(e) => setCheckoutSafetyNotice(e.target.value)}
                  className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>
            </div>

            {permissions?.canManageCms && (
              <div className="flex justify-end pt-2 border-t border-[#EEF2F6]">
                <button
                  type="submit"
                  disabled={savingGatewayForm}
                  className="px-5 py-2.5 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {savingGatewayForm
                    ? 'Saving Payment Configuration...'
                    : 'Save Merchant Payment Settings'}
                </button>
              </div>
            )}
          </form>
        </div>
      )}

      {/* TAB 2: LIVE PAYMENT VERIFICATION, COD COLLECTION & REFUND QUEUE */}
      {activeTab === 'verification' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="relative">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
              <input
                type="text"
                value={queueSearch}
                onChange={(e) => setQueueSearch(e.target.value)}
                placeholder="Search Order #, TrxID, or customer..."
                className="w-full pl-9 pr-3 py-2 text-xs border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
              />
            </div>

            <select
              value={queueFilter}
              onChange={(e) => setQueueFilter(e.target.value as PaymentQueueFilter)}
              className="px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white"
            >
              <option value="action_needed">Action Needed (Pending TrxID / COD / Refund)</option>
              <option value="all">All Order Payments</option>
              <option value="pending_verification">Pending Verification (bKash / Nagad)</option>
              <option value="unpaid">Unpaid (Cash on Delivery)</option>
              <option value="refund_pending">Refund Pending</option>
              <option value="verified_paid">Verified Paid</option>
              <option value="refunded">Refunded</option>
              <option value="failed">Failed / Rejected TrxID</option>
            </select>

            <select
              value={methodFilter}
              onChange={(e) => setMethodFilter(e.target.value as 'all' | PaymentMethod)}
              className="px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white"
            >
              <option value="all">All Payment Channels (COD + bKash + Nagad)</option>
              <option value="bkash">bKash Only</option>
              <option value="nagad">Nagad Only</option>
              <option value="cod">Cash on Delivery (COD) Only</option>
            </select>
          </div>

          <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Payment Settlement &amp; Refund Ledger
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#64748B]">
                {filteredPaymentOrders.length} matching record(s)
              </span>
            </div>

            {filteredPaymentOrders.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <CheckCircle2 className="w-7 h-7 text-[#0D7E74] mx-auto" />
                <p className="text-sm font-semibold text-[#0F172A]">
                  No orders match this payment filter
                </p>
                <p className="text-xs text-[#64748B]">
                  Switch filter to &ldquo;All Order Payments&rdquo; to inspect historical settlements.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      <th className="py-3 px-6">Order # &amp; Date</th>
                      <th className="py-3 px-4">Customer</th>
                      <th className="py-3 px-4">Channel</th>
                      <th className="py-3 px-4">Submitted / Verified Reference</th>
                      <th className="py-3 px-4 text-right">Amount</th>
                      <th className="py-3 px-4">Payment Status</th>
                      <th className="py-3 px-6 text-right">Settlement Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F6] text-sm">
                    {filteredPaymentOrders.map((ord) => (
                      <tr key={ord.id} className="hover:bg-[#F8FAFB] transition-colors">
                        <td className="py-3.5 px-6">
                          <div className="font-mono font-semibold text-xs text-[#0F172A]">
                            {ord.orderNumber}
                          </div>
                          <div className="text-[11px] font-mono text-[#64748B]">
                            {formatTimestamp(ord.createdAt)}
                          </div>
                          <div className="text-[11px] text-[#64748B] capitalize">
                            Order: {ord.orderStatus.replace(/_/g, ' ')}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-medium text-xs text-[#0F172A]">
                            {ord.customerName}
                          </div>
                          <div className="text-[11px] font-mono text-[#64748B]">
                            {permissions?.canViewCustomerPii ? ord.customerPhone : 'Phone Protected'}
                          </div>
                        </td>
                        <td className="py-3.5 px-4">
                          <span className="font-mono uppercase text-xs font-semibold text-[#0F172A]">
                            {ord.paymentMethod}
                          </span>
                        </td>
                        <td className="py-3.5 px-4">
                          <div className="font-mono text-xs text-[#0F172A] break-all max-w-[230px]">
                            {ord.transactionReference || '—'}
                          </div>
                          {ord.paymentVerifiedAt && (
                            <div className="text-[11px] font-mono text-[#15803D]">
                              Verified: {ord.paymentVerifiedAt.slice(0, 19).replace('T', ' ')}
                            </div>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0F172A]">
                          {formatBdt(ord.totalAmountBdt)}
                        </td>
                        <td className="py-3.5 px-4 text-xs font-medium">
                          <span
                            className={
                              ord.paymentStatus === 'verified_paid'
                                ? 'text-[#15803D]'
                                : ord.paymentStatus === 'pending_verification'
                                ? 'text-[#B45309]'
                                : ord.paymentStatus === 'failed' ||
                                  ord.paymentStatus === 'refund_pending'
                                ? 'text-[#DC2626]'
                                : 'text-[#64748B]'
                            }
                          >
                            {ord.paymentStatus.replace(/_/g, ' ')}
                          </span>
                        </td>
                        <td className="py-3.5 px-6 text-right">
                          {permissions?.canVerifyPayments &&
                          ord.orderStatus !== 'refunded' &&
                          !(ord.orderStatus === 'cancelled' && ord.paymentStatus !== 'refund_pending') ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              {ord.paymentStatus === 'refund_pending' ? (
                                <button
                                  type="button"
                                  onClick={() => openPaymentDecisionModal(ord, 'complete_refund')}
                                  className="px-3 py-1.5 text-xs font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg whitespace-nowrap shrink-0"
                                >
                                  Complete Refund
                                </button>
                              ) : ord.paymentStatus !== 'verified_paid' ? (
                                <>
                                  <button
                                    type="button"
                                    onClick={() => openPaymentDecisionModal(ord, 'verify_paid')}
                                    className="px-3 py-1.5 text-xs font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg whitespace-nowrap shrink-0"
                                  >
                                    Verify Paid
                                  </button>
                                  {ord.paymentMethod !== 'cod' && ord.paymentStatus !== 'failed' && (
                                    <button
                                      type="button"
                                      onClick={() => openPaymentDecisionModal(ord, 'mark_failed')}
                                      className="px-2.5 py-1.5 text-xs font-medium text-[#DC2626] border border-[#FECACA] hover:bg-[#FEF2F2] rounded-lg whitespace-nowrap shrink-0"
                                    >
                                      Reject TrxID
                                    </button>
                                  )}
                                </>
                              ) : (
                                <span className="text-xs font-mono text-[#15803D]">Settled</span>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-[#64748B]">
                              {ord.paymentStatus === 'verified_paid' ? 'Settled' : 'Closed'}
                            </span>
                          )}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 3: CONFIGURABLE DELIVERY ZONES */}
      {activeTab === 'zones' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between gap-4">
            <div className="flex items-center gap-2.5">
              <Truck className="w-4 h-4 text-[#0D7E74]" />
              <h2 className="text-base font-semibold text-[#0F172A]">
                Nationwide Pharmacy Delivery Zones
              </h2>
            </div>
            <span className="text-xs text-[#64748B] font-mono tabular-nums">
              {deliveryZones.length} configured
            </span>
          </div>

          {deliveryZones.length === 0 ? (
            <div className="p-8 text-center space-y-3">
              <p className="text-sm font-medium text-[#0F172A]">
                No delivery zones configured yet
              </p>
              <p className="text-xs text-[#64748B] max-w-md mx-auto">
                Initialize Inside Dhaka (৳60) and Outside Dhaka (৳120) with ৳1500+ free shipping so Customer Storefront checkout calculates shipping fees accurately.
              </p>
              {permissions?.canManageDelivery && (
                <button
                  type="button"
                  disabled={syncingDefaults}
                  onClick={() => void handleSyncDefaultPaymentsAndZones()}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg"
                >
                  {syncingDefaults ? 'Initializing...' : 'Initialize Default Delivery Zones'}
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                    <th className="py-3 px-6">Zone &amp; Coverage</th>
                    <th className="py-3 px-4">Courier &amp; Handling</th>
                    <th className="py-3 px-4">Estimated SLA</th>
                    <th className="py-3 px-4 text-right">Delivery Fee</th>
                    <th className="py-3 px-4 text-right">Free Above</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {deliveryZones.map((zone) => {
                    const zoneOrders = orders.filter((o) => o.deliveryZone === zone.zoneName).length;
                    const isConfirmingDelete = confirmDeleteZoneId === zone.id;
                    return (
                      <tr key={zone.id} className="hover:bg-[#F8FAFB] transition-colors">
                        <td className="py-4 px-6">
                          <div className="font-semibold text-[#0F172A]">{zone.zoneName}</div>
                          <div className="text-xs text-[#64748B] max-w-xs line-clamp-2">
                            {zone.coverageAreas}
                          </div>
                          <div className="text-[11px] text-[#64748B] font-mono tabular-nums mt-0.5">
                            {zoneOrders} historical order(s)
                          </div>
                        </td>
                        <td className="py-4 px-4 max-w-xs">
                          <div className="text-xs font-medium text-[#0F172A]">
                            {zone.courierPartner || 'Standard Dispatch'}
                          </div>
                          {zone.instructions && (
                            <div className="text-xs text-[#64748B] line-clamp-2 mt-0.5">
                              {zone.instructions}
                            </div>
                          )}
                        </td>
                        <td className="py-4 px-4 text-xs text-[#0F172A]">
                          {zone.estimatedDeliveryText}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums font-semibold text-[#0F172A]">
                          {formatBdt(zone.deliveryFeeBdt)}
                        </td>
                        <td className="py-4 px-4 text-right font-mono tabular-nums text-[#64748B]">
                          {zone.freeDeliveryMinOrderBdt > 0
                            ? formatBdt(zone.freeDeliveryMinOrderBdt)
                            : 'No threshold'}
                        </td>
                        <td className="py-4 px-4">
                          {permissions?.canManageDelivery ? (
                            <button
                              type="button"
                              disabled={savingZone}
                              onClick={() => void handleToggleZoneStatus(zone)}
                              className={`inline-flex items-center gap-1.5 text-xs font-medium hover:underline ${
                                zone.status === 'active' ? 'text-[#15803D]' : 'text-[#64748B]'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {zone.status === 'active' ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span
                              className={`inline-flex items-center gap-1.5 text-xs font-medium ${
                                zone.status === 'active' ? 'text-[#15803D]' : 'text-[#64748B]'
                              }`}
                            >
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              {zone.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>
                        <td className="py-4 px-6 text-right">
                          {permissions?.canManageDelivery ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditZone(zone)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F4F7F8] rounded-lg transition-colors whitespace-nowrap shrink-0"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              {isConfirmingDelete ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={savingZone}
                                    onClick={() => void handleDeleteZone(zone)}
                                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg whitespace-nowrap shrink-0"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteZoneId(null)}
                                    className="px-2 py-1.5 text-xs text-[#64748B] hover:text-[#0F172A]"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteZoneId(zone.id)}
                                  className="p-1.5 text-[#64748B] hover:text-[#DC2626] border border-[#E6ECEF] rounded-lg"
                                  title="Delete delivery zone"
                                >
                                  <Trash2 className="w-3.5 h-3.5" />
                                </button>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-[#64748B]">Read-only</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Payment Verification / Rejection / Refund Modal */}
      {selectedOrderForPayment && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-lg w-full overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Payment Settlement Decision —{' '}
                  <span className="font-mono">{selectedOrderForPayment.orderNumber}</span>
                </h2>
                <p className="text-xs text-[#64748B]">
                  Channel:{' '}
                  <strong className="uppercase font-mono">
                    {selectedOrderForPayment.paymentMethod}
                  </strong>{' '}
                  · Amount:{' '}
                  <strong className="font-mono">
                    {formatBdt(selectedOrderForPayment.totalAmountBdt)}
                  </strong>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedOrderForPayment(null)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleApplyPaymentDecision} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Settlement Action
                </label>
                <select
                  value={decisionType}
                  onChange={(e) => setDecisionType(e.target.value as PaymentDecisionType)}
                  className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="verify_paid">
                    Verify Paid Settlement (verified_paid)
                  </option>
                  {selectedOrderForPayment.paymentMethod !== 'cod' && (
                    <option value="mark_failed">
                      Reject Invalid / Unmatched TrxID (failed)
                    </option>
                  )}
                  <option value="complete_refund">
                    Record Completed Refund Disbursement (refunded)
                  </option>
                </select>
              </div>

              {decisionType !== 'mark_failed' && (
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    {decisionType === 'complete_refund'
                      ? 'Refund Disbursement Reference *'
                      : selectedOrderForPayment.paymentMethod === 'cod'
                      ? 'Courier Cash Receipt Reference *'
                      : `Verified ${selectedOrderForPayment.paymentMethod.toUpperCase()} TrxID / Issuer Ref *`}
                  </label>
                  <input
                    type="text"
                    required
                    value={txnRefInput}
                    onChange={(e) => setTxnRefInput(e.target.value)}
                    placeholder={
                      decisionType === 'complete_refund'
                        ? 'RFD-BKASH-9021'
                        : selectedOrderForPayment.paymentMethod === 'cod'
                        ? 'COD-RCPT-1001'
                        : 'BK98472ABC12'
                    }
                    className="w-full px-3 py-2 text-xs font-mono uppercase border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              )}

              {(decisionType === 'mark_failed' || decisionType === 'complete_refund') && (
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    {decisionType === 'mark_failed'
                      ? 'Failure / Anti-Spoofing Rejection Reason *'
                      : 'Refund Note (Optional)'}
                  </label>
                  <input
                    type="text"
                    required={decisionType === 'mark_failed'}
                    minLength={decisionType === 'mark_failed' ? 5 : undefined}
                    value={decisionReason}
                    onChange={(e) => setDecisionReason(e.target.value)}
                    placeholder={
                      decisionType === 'mark_failed'
                        ? 'e.g., Submitted TrxID not found in bKash merchant statement'
                        : 'e.g., Full amount refunded to customer bKash wallet'
                    }
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              )}

              {(decisionType === 'complete_refund' ||
                (decisionType === 'verify_paid' &&
                  selectedOrderForPayment.paymentMethod !== 'cod')) && (
                <label className="flex items-start gap-2 text-xs text-[#0F172A]">
                  <input
                    type="checkbox"
                    checked={reconciliationConfirmed}
                    onChange={(e) => setReconciliationConfirmed(e.target.checked)}
                    className="mt-0.5"
                  />
                  <span>
                    {decisionType === 'complete_refund'
                      ? `I confirm ${formatBdt(selectedOrderForPayment.totalAmountBdt)} has been refunded to the customer.`
                      : `I have reconciled ${formatBdt(selectedOrderForPayment.totalAmountBdt)} against the official ${selectedOrderForPayment.paymentMethod.toUpperCase()} merchant statement.`}
                  </span>
                </label>
              )}

              <div className="pt-3 border-t border-[#EEF2F6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setSelectedOrderForPayment(null)}
                  className="px-4 py-2 text-xs font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={submittingDecision}
                  className={`px-4 py-2 text-xs font-medium text-white rounded-lg disabled:opacity-50 ${
                    decisionType === 'mark_failed'
                      ? 'bg-[#DC2626] hover:bg-[#B91C1C]'
                      : 'bg-[#0D7E74] hover:bg-[#086058]'
                  }`}
                >
                  {submittingDecision
                    ? 'Validating on Server...'
                    : decisionType === 'mark_failed'
                    ? 'Confirm TrxID Rejection'
                    : decisionType === 'complete_refund'
                    ? 'Confirm Refund Completed'
                    : 'Confirm Verified Settlement'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Add / Edit Delivery Zone Modal */}
      {zoneModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="zone-modal-title"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-xl w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 id="zone-modal-title" className="text-lg font-semibold text-[#0F172A]">
                {editingZone ? 'Edit Delivery Zone' : 'Create Delivery Zone'}
              </h2>
              <button
                type="button"
                onClick={() => setZoneModalOpen(false)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveZone} className="p-6 space-y-4">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Zone Name *
                </label>
                <input
                  type="text"
                  required
                  value={zoneName}
                  onChange={(e) => setZoneName(e.target.value)}
                  placeholder="e.g., Inside Dhaka Metro"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Coverage Areas / Thanas / Districts *
                </label>
                <textarea
                  rows={2}
                  required
                  value={coverageAreas}
                  onChange={(e) => setCoverageAreas(e.target.value)}
                  placeholder="Dhanmondi, Gulshan, Uttara, Mirpur..."
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Delivery Fee (BDT) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={deliveryFeeBdt}
                    onChange={(e) => setDeliveryFeeBdt(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Free Shipping Min Order (BDT, 0 = disabled)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={freeDeliveryMinOrderBdt}
                    onChange={(e) => setFreeDeliveryMinOrderBdt(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Estimated Delivery SLA *
                  </label>
                  <input
                    type="text"
                    required
                    value={estimatedDeliveryText}
                    onChange={(e) => setEstimatedDeliveryText(e.target.value)}
                    placeholder="1–2 Days Inside Dhaka"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Assigned Courier Partner
                  </label>
                  <input
                    type="text"
                    value={courierPartner}
                    onChange={(e) => setCourierPartner(e.target.value)}
                    placeholder="Steadfast / Pathao Pharma"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Pharmaceutical Packaging &amp; Cold-Chain Instructions
                </label>
                <textarea
                  rows={2}
                  value={instructions}
                  onChange={(e) => setInstructions(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Zone Status
                </label>
                <select
                  value={zoneStatus}
                  onChange={(e) => setZoneStatus(e.target.value as 'active' | 'inactive')}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                >
                  <option value="active">Active (Selectable in Customer Checkout)</option>
                  <option value="inactive">Inactive (Hidden from Checkout)</option>
                </select>
              </div>

              <div className="pt-3 border-t border-[#EEF2F6] flex items-center justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setZoneModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] hover:text-[#0F172A] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingZone}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {savingZone ? 'Saving...' : editingZone ? 'Update Zone' : 'Create Zone'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
