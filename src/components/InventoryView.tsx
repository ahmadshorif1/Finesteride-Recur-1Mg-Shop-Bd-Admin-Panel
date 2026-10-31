import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  ArrowDownUp,
  Boxes,
  History,
  Plus,
  ShieldAlert,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { daysUntilExpiry, formatBdt, formatTimestamp } from '../lib/validation';
import {
  adjustInventoryAtomically,
  quarantineBatchStock,
  receiveIncomingBatch,
} from '../services/pharmacyService';
import type { Product, ProductBatch } from '../types/pharmacy';

export function InventoryView() {
  const { permissions } = useAuth();
  const { actor, products, productBatches, inventoryMovements } = useStoreData();

  const [tab, setTab] = useState<'batches' | 'alerts' | 'ledger'>('batches');
  const [batchModalOpen, setBatchModalOpen] = useState(false);
  const [adjustModalProduct, setAdjustModalProduct] = useState<Product | null>(null);
  const [quarantineConfirm, setQuarantineConfirm] = useState<ProductBatch | null>(null);

  // Batch Receipt State
  const [selectedProductId, setSelectedProductId] = useState('');
  const [batchNumber, setBatchNumber] = useState('');
  const [supplierName, setSupplierName] = useState('');
  const [supplierContact, setSupplierContact] = useState('');
  const [unitCostPrice, setUnitCostPrice] = useState(0);
  const [quantityReceived, setQuantityReceived] = useState(50);
  const [manufacturingDate, setManufacturingDate] = useState('');
  const [expiryDate, setExpiryDate] = useState('');
  const [batchNotes, setBatchNotes] = useState('');

  // Stock Adjustment State
  const [adjustDelta, setAdjustDelta] = useState(10);
  const [adjustReason, setAdjustReason] = useState('');

  const [saving, setSaving] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);

  const alertProducts = useMemo(
    () =>
      products.filter(
        (p) =>
          p.availabilityStatus === 'low_stock' ||
          p.availabilityStatus === 'out_of_stock' ||
          p.availabilityStatus === 'expired_restricted'
      ),
    [products]
  );

  const alertBatches = useMemo(
    () =>
      productBatches.filter((b) => {
        if (b.quantityRemaining <= 0 || b.status === 'expired_quarantined') return false;
        const d = daysUntilExpiry(b.expiryDate);
        return d !== null && d <= 60;
      }),
    [productBatches]
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Inventory, Batches &amp; Expiry Control
          </h1>
          <p className="text-sm text-[#64748B]">
            Lot-level traceability, confidential wholesale costs, near-expiry alerts, and atomic movement ledgers.
          </p>
        </div>

        {permissions?.canManageInventory && (
          <div className="flex items-center gap-2.5 no-print">
            <button
              type="button"
              disabled={products.length === 0}
              onClick={() => {
                setErrorMsg(null);
                setSelectedProductId(products[0]?.id || '');
                setBatchNumber(`LOT-${Date.now().toString(36).slice(-4).toUpperCase()}`);
                setBatchModalOpen(true);
              }}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Receive Incoming Batch</span>
            </button>
          </div>
        )}
      </div>

      {errorMsg && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#991B1B] flex items-start gap-2.5 no-print">
          <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Segmented View Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 no-print">
        <div className="flex items-center gap-1 p-1 bg-[#EEF4F0] rounded-lg">
          <button
            type="button"
            onClick={() => setTab('batches')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'batches' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
            }`}
          >
            Pharmaceutical Batches ({productBatches.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('alerts')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'alerts' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
            }`}
          >
            Low-Stock &amp; Expiry Alerts ({alertProducts.length + alertBatches.length})
          </button>
          <button
            type="button"
            onClick={() => setTab('ledger')}
            className={`px-3.5 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
              tab === 'ledger' ? 'bg-white text-[#0F172A] shadow-xs' : 'text-[#64748B]'
            }`}
          >
            Auditable Movement History ({inventoryMovements.length})
          </button>
        </div>

        {permissions?.canManageInventory && products.length > 0 && (
          <div className="flex items-center gap-2 text-xs">
            <span className="text-[#64748B]">Quick Stock Adjust:</span>
            <select
              defaultValue=""
              onChange={(e) => {
                const p = products.find((x) => x.id === e.target.value);
                if (p) {
                  setAdjustDelta(10);
                  setAdjustReason('');
                  setAdjustModalProduct(p);
                }
                e.currentTarget.value = '';
              }}
              className="px-3 py-1.5 border border-[#E6ECEF] rounded-lg bg-white text-[#0F172A]"
            >
              <option value="" disabled>
                Select product...
              </option>
              {products.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name} (Stock: {p.stockQuantity})
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      {/* TAB 1: BATCHES */}
      {tab === 'batches' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          {productBatches.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <Boxes className="w-8 h-8 text-[#64748B] mx-auto" />
              <h2 className="text-base font-semibold text-[#0F172A]">
                No Pharmaceutical Batches Logged
              </h2>
              <p className="text-sm text-[#64748B] max-w-md mx-auto">
                Receive incoming batches to record manufacturer lot numbers, supplier references, confidential unit costs, and mandatory expiry dates.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-6">Batch / Lot #</th>
                    <th className="py-3 px-4">Product</th>
                    <th className="py-3 px-4">Supplier</th>
                    {permissions?.canViewWholesaleCosts && (
                      <th className="py-3 px-4 text-right">Wholesale Cost</th>
                    )}
                    <th className="py-3 px-4 text-right">Remaining / Recv</th>
                    <th className="py-3 px-4">Expiry Date</th>
                    <th className="py-3 px-4">Status</th>
                    <th className="py-3 px-6 text-right print-hide-col">Safety Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {productBatches.map((b) => {
                    const days = daysUntilExpiry(b.expiryDate);
                    const isExpiredOrNear = days !== null && days <= 60;
                    return (
                      <tr key={b.id} className="hover:bg-[#F7FAF8]">
                        <td className="py-3 px-6 font-mono text-xs font-semibold text-[#0F172A]">
                          {b.batchNumber}
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-[#0F172A]">{b.productName}</p>
                          <p className="text-xs font-mono text-[#64748B]">{b.sku}</p>
                        </td>
                        <td className="py-3 px-4 text-xs text-[#64748B]">
                          <p className="text-[#0F172A]">{b.supplierName}</p>
                          {b.supplierContact && <p>{b.supplierContact}</p>}
                        </td>
                        {permissions?.canViewWholesaleCosts && (
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-[#0F172A]">
                            {formatBdt(b.unitCostPrice)}
                          </td>
                        )}
                        <td className="py-3 px-4 text-right font-mono tabular-nums text-xs">
                          <span className="font-semibold text-[#0F172A]">{b.quantityRemaining}</span> /{' '}
                          <span className="text-[#64748B]">{b.quantityReceived}</span>
                        </td>
                        <td className="py-3 px-4 font-mono tabular-nums text-xs">
                          <span
                            className={
                              days !== null && days < 0
                                ? 'text-[#DC2626] font-semibold'
                                : isExpiredOrNear
                                ? 'text-[#D97706] font-semibold'
                                : 'text-[#0F172A]'
                            }
                          >
                            {b.expiryDate}
                          </span>
                          {days !== null && (
                            <span className="block text-[11px] text-[#64748B]">
                              {days < 0 ? `Expired ${Math.abs(days)}d ago` : `${days}d remaining`}
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-xs capitalize text-[#64748B]">
                          {b.status.replace(/_/g, ' ')}
                        </td>
                        <td className="py-3 px-6 text-right print-hide-col">
                          {permissions?.canManageInventory &&
                            b.status !== 'expired_quarantined' &&
                            b.quantityRemaining > 0 && (
                              <button
                                type="button"
                                onClick={() => setQuarantineConfirm(b)}
                                className="inline-flex items-center gap-1 px-2.5 py-1 text-xs font-medium text-[#991B1B] border border-[#FECACA] hover:bg-[#FEF2F2] rounded-md whitespace-nowrap shrink-0"
                              >
                                <ShieldAlert className="w-3.5 h-3.5" />
                                Quarantine
                              </button>
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

      {/* TAB 2: ALERTS */}
      {tab === 'alerts' && (
        <div className="space-y-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl divide-y divide-[#EEF2F6]">
            <div className="px-6 py-4">
              <h2 className="text-sm font-semibold text-[#0F172A]">
                Low-Stock, Out-of-Stock &amp; Restricted Products
              </h2>
            </div>
            {alertProducts.length === 0 ? (
              <div className="p-8 text-center text-sm text-[#64748B]">
                All catalog items are currently above their low-stock thresholds and clear of expiry blocks.
              </div>
            ) : (
              alertProducts.map((p) => (
                <div key={p.id} className="px-6 py-3.5 flex items-center justify-between gap-4">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle
                      className={`w-4 h-4 shrink-0 mt-0.5 ${
                        p.availabilityStatus === 'low_stock' ? 'text-[#D97706]' : 'text-[#DC2626]'
                      }`}
                    />
                    <div>
                      <p className="text-sm font-semibold text-[#0F172A]">{p.name}</p>
                      <p className="text-xs text-[#64748B] font-mono tabular-nums">
                        SKU {p.sku} · Current Stock: {p.stockQuantity} · Threshold: {p.lowStockThreshold} · State:{' '}
                        {p.availabilityStatus.replace(/_/g, ' ')}
                      </p>
                    </div>
                  </div>
                  {permissions?.canManageInventory && (
                    <button
                      type="button"
                      onClick={() => {
                        setAdjustDelta(20);
                        setAdjustReason('Replenishing low stock alert');
                        setAdjustModalProduct(p);
                      }}
                      className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg hover:bg-[#F2F8F4] whitespace-nowrap shrink-0 no-print"
                    >
                      <ArrowDownUp className="w-3.5 h-3.5" />
                      Adjust Stock
                    </button>
                  )}
                </div>
              ))
            )}
          </div>
        </div>
      )}

      {/* TAB 3: MOVEMENT LEDGER */}
      {tab === 'ledger' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          {inventoryMovements.length === 0 ? (
            <div className="p-12 text-center space-y-2">
              <History className="w-8 h-8 text-[#64748B] mx-auto" />
              <p className="text-sm text-[#64748B]">No stock movements recorded yet.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-6">Timestamp</th>
                    <th className="py-3 px-4">Product &amp; Batch</th>
                    <th className="py-3 px-4">Movement Type</th>
                    <th className="py-3 px-4 text-right">Delta</th>
                    <th className="py-3 px-4 text-right">Stock After</th>
                    <th className="py-3 px-4">Audit Reason &amp; Actor</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {inventoryMovements.map((m) => (
                    <tr key={m.id} className="hover:bg-[#F7FAF8]">
                      <td className="py-2.5 px-6 font-mono tabular-nums text-xs text-[#64748B] whitespace-nowrap">
                        {formatTimestamp(m.createdAt)}
                      </td>
                      <td className="py-2.5 px-4">
                        <p className="text-xs font-semibold text-[#0F172A]">{m.productName}</p>
                        <p className="text-[11px] font-mono text-[#64748B]">
                          {m.sku} · {m.batchNumber}
                        </p>
                      </td>
                      <td className="py-2.5 px-4 text-xs capitalize text-[#0F172A]">
                        {m.movementType.replace(/_/g, ' ')}
                      </td>
                      <td
                        className={`py-2.5 px-4 text-right font-mono tabular-nums text-xs font-semibold ${
                          m.quantityDelta > 0 ? 'text-[#0D7E74]' : 'text-[#DC2626]'
                        }`}
                      >
                        {m.quantityDelta > 0 ? `+${m.quantityDelta}` : m.quantityDelta}
                      </td>
                      <td className="py-2.5 px-4 text-right font-mono tabular-nums text-xs text-[#0F172A]">
                        {m.previousStock} &rarr; <strong>{m.newStock}</strong>
                      </td>
                      <td className="py-2.5 px-4 text-xs text-[#64748B]">
                        <p className="text-[#0F172A]">{m.reason}</p>
                        <p className="font-mono text-[11px]">{m.performedByEmail}</p>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Receive Incoming Batch Modal */}
      {batchModalOpen && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-xl w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-3">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">Receive Pharmaceutical Batch</h2>
                <p className="text-xs text-[#64748B]">
                  Wholesale costs are stored strictly in <code className="font-mono">/productBatches</code> and never exposed to storefront customers.
                </p>
              </div>
              <button type="button" onClick={() => setBatchModalOpen(false)} className="p-1 text-[#64748B]">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                const prod = products.find((p) => p.id === selectedProductId);
                if (!prod) return;
                setSaving(true);
                setErrorMsg(null);
                try {
                  await receiveIncomingBatch(actor, prod, {
                    batchNumber,
                    supplierName,
                    supplierContact,
                    unitCostPrice,
                    quantityReceived,
                    manufacturingDate,
                    expiryDate,
                    notes: batchNotes,
                  });
                  setBatchModalOpen(false);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : 'Failed to receive batch.');
                } finally {
                  setSaving(false);
                }
              }}
              className="space-y-3.5"
            >
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">Product *</label>
                <select
                  required
                  value={selectedProductId}
                  onChange={(e) => setSelectedProductId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                >
                  {products.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.sku} · Current Stock: {p.stockQuantity})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Batch / Lot Number *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    value={batchNumber}
                    onChange={(e) => setBatchNumber(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Supplier / Distributor *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={120}
                    value={supplierName}
                    onChange={(e) => setSupplierName(e.target.value)}
                    placeholder="e.g., Beximco Depot Dhaka"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Quantity Received *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={quantityReceived}
                    onChange={(e) => setQuantityReceived(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Confidential Unit Cost (BDT) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={unitCostPrice}
                    onChange={(e) => setUnitCostPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Manufacturing Date
                  </label>
                  <input
                    type="date"
                    value={manufacturingDate}
                    onChange={(e) => setManufacturingDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Mandatory Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Supplier Invoice / Inspection Notes
                </label>
                <input
                  type="text"
                  maxLength={500}
                  value={batchNotes}
                  onChange={(e) => setBatchNotes(e.target.value)}
                  placeholder="Invoice # or cold-chain seal inspection status"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#EEF2F6]">
                <button
                  type="button"
                  onClick={() => setBatchModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  {saving ? 'Recording...' : 'Commit Batch & Update Stock'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manual Atomic Stock Adjustment Modal */}
      {adjustModalProduct && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-3">
              <h3 className="text-base font-bold text-[#0F172A]">
                Atomic Stock Adjustment: {adjustModalProduct.name}
              </h3>
              <button
                type="button"
                onClick={() => setAdjustModalProduct(null)}
                className="p-1 text-[#64748B]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setErrorMsg(null);
                try {
                  await adjustInventoryAtomically(
                    actor,
                    adjustModalProduct.id,
                    adjustDelta,
                    adjustReason
                  );
                  setAdjustModalProduct(null);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : 'Stock adjustment failed.');
                } finally {
                  setSaving(false);
                }
              }}
              className="space-y-4"
            >
              <p className="text-xs font-mono text-[#64748B]">
                Current Stock: {adjustModalProduct.stockQuantity} &rarr; Resulting Stock:{' '}
                <strong>{Math.max(0, adjustModalProduct.stockQuantity + adjustDelta)}</strong>
              </p>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Signed Quantity Delta (+ to add, - to deduct) *
                </label>
                <input
                  type="number"
                  required
                  value={adjustDelta}
                  onChange={(e) => setAdjustDelta(Number(e.target.value))}
                  className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Mandatory Audit Reason *
                </label>
                <input
                  type="text"
                  required
                  minLength={3}
                  maxLength={400}
                  value={adjustReason}
                  onChange={(e) => setAdjustReason(e.target.value)}
                  placeholder="e.g., Physical cycle count reconciliation"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setAdjustModalProduct(null)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving || adjustDelta === 0}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  {saving ? 'Updating...' : 'Apply Atomic Adjustment'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Quarantine Confirmation Dialog */}
      {quarantineConfirm && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F172A]">
              Quarantine Batch {quarantineConfirm.batchNumber}?
            </h3>
            <p className="text-sm text-[#64748B]">
              This will immediately remove <strong className="font-mono">{quarantineConfirm.quantityRemaining}</strong> remaining unit(s) of <strong>{quarantineConfirm.productName}</strong> from sellable inventory and log an immutable quarantine movement.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setQuarantineConfirm(null)}
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
                    await quarantineBatchStock(actor, quarantineConfirm);
                    setQuarantineConfirm(null);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Quarantine failed.');
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg whitespace-nowrap shrink-0"
              >
                Confirm Quarantine
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
