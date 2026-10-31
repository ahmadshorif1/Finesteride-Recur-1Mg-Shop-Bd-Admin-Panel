import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  AlertTriangle,
  Archive,
  Check,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Copy,
  Edit3,
  Eye,
  Package,
  Plus,
  RefreshCw,
  Search,
  Upload,
  X,
} from 'lucide-react';
import firestoreRulesRaw from '../../firestore.rules?raw';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { buildCustomerPanelEnvTemplate, getFirebaseProjectInfo } from '../lib/firebase';
import { formatBdt, formatTimestamp, isDateExpired } from '../lib/validation';
import {
  bootstrapReferenceStructure,
  bulkUpdateProductPublication,
  OFFICIAL_STOREFRONT_CATEGORIES,
  probeCustomerPanelCatalogFeed,
  saveProduct,
  syncCatalogToCustomerPanel,
  uploadCatalogAsset,
  VERIFIED_PHARMA_BRANDS,
  type CustomerPanelFeedProbeResult,
  type ProductFormInput,
} from '../services/pharmacyService';
import type { Product } from '../types/pharmacy';

const PAGE_SIZE = 10;

const EMPTY_PRODUCT_FORM: ProductFormInput = {
  name: '',
  slug: '',
  genericName: '',
  manufacturer: '',
  categoryId: '',
  categoryName: '',
  subcategory: '',
  description: '',
  images: [],
  unitSize: '30 tablets',
  sellingPrice: 0,
  previousPrice: 0,
  stockQuantity: 0,
  lowStockThreshold: 10,
  sku: '',
  prescriptionType: 'otc',
  usageInstructions: '',
  storageInstructions: 'Store below 30°C in a cool, dry place away from light and out of reach of children.',
  nearestExpiryDate: '',
  publicationStatus: 'published',
  featured: false,
  popular: false,
};

export function ProductsView() {
  const { permissions } = useAuth();
  const { actor, products, categories, siteSettings, deliveryZones, coupons } = useStoreData();

  const [searchQuery, setSearchQuery] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [companyFilter, setCompanyFilter] = useState('all');
  const [pubFilter, setPubFilter] = useState<'all' | Product['publicationStatus']>('all');
  const [stockFilter, setStockFilter] = useState<'all' | Product['availabilityStatus']>('all');
  const [offerOnly, setOfferOnly] = useState(false);
  const [sortBy, setSortBy] = useState<'newest' | 'price_asc' | 'price_desc' | 'stock_asc'>('newest');
  const [page, setPage] = useState(1);

  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [modalOpen, setModalOpen] = useState(false);
  const [detailProduct, setDetailProduct] = useState<Product | null>(null);
  const [editingProduct, setEditingProduct] = useState<Product | null>(null);
  const [form, setForm] = useState<ProductFormInput>(EMPTY_PRODUCT_FORM);
  const [imageUrlDraft, setImageUrlDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const [uploadingImg, setUploadingImg] = useState(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const [syncModalOpen, setSyncModalOpen] = useState(false);
  const [syncingCatalog, setSyncingCatalog] = useState(false);
  const [probingFeed, setProbingFeed] = useState(false);
  const [probeResult, setProbeResult] = useState<CustomerPanelFeedProbeResult | null>(null);
  const [copiedKey, setCopiedKey] = useState<string | null>(null);

  const projectInfo = getFirebaseProjectInfo();
  const draftProductsCount = useMemo(
    () => products.filter((p) => p.publicationStatus === 'draft').length,
    [products]
  );
  const unsyncedProductsCount = useMemo(
    () =>
      products.filter(
        (p) =>
          p.publicationStatus !== 'archived' &&
          (p.price === undefined || !p.categorySlug || !p.status)
      ).length,
    [products]
  );

  useEffect(() => {
    if (!permissions?.canManageCatalog) return;
    let cancelled = false;
    void probeCustomerPanelCatalogFeed().then((res) => {
      if (!cancelled) {
        setProbeResult(res);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [permissions?.canManageCatalog]);

  const uniqueCompanies = useMemo(() => {
    const s = new Set(products.map((p) => p.manufacturer).filter(Boolean));
    return Array.from(s).sort();
  }, [products]);

  const brandAutocompleteOptions = useMemo(() => {
    return Array.from(new Set([...uniqueCompanies, ...VERIFIED_PHARMA_BRANDS])).sort();
  }, [uniqueCompanies]);

  const subcategorySuggestions = useMemo(() => {
    const childCats = categories
      .filter((c) => c.parentCategoryId === form.categoryId)
      .map((c) => (c.nameBn ? `${c.nameBn} (${c.name})` : c.name));
    const selectedCat = categories.find((c) => c.id === form.categoryId);
    const preset = selectedCat
      ? OFFICIAL_STOREFRONT_CATEGORIES.find((pr) =>
          pr.aliases.includes(selectedCat.slug.trim().toLowerCase())
        )
      : undefined;
    const presetSubs = preset
      ? preset.suggestedSubcategories.map((s) => `${s.nameBn} (${s.name})`)
      : [];
    const existingSubs = products
      .filter((p) => p.categoryId === form.categoryId && p.subcategory)
      .map((p) => p.subcategory);
    return Array.from(new Set([...childCats, ...presetSubs, ...existingSubs]));
  }, [categories, form.categoryId, products]);

  const filteredProducts = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    const list = products.filter((p) => {
      if (categoryFilter !== 'all') {
        const selectedCat = categories.find((c) => c.id === categoryFilter);
        const matchesDirect = p.categoryId === categoryFilter;
        const matchesParent =
          selectedCat &&
          categories.some((child) => child.parentCategoryId === selectedCat.id && child.id === p.categoryId);
        if (!matchesDirect && !matchesParent) return false;
      }
      if (companyFilter !== 'all' && p.manufacturer !== companyFilter) return false;
      if (pubFilter !== 'all' && p.publicationStatus !== pubFilter) return false;
      if (stockFilter !== 'all' && p.availabilityStatus !== stockFilter) return false;
      if (offerOnly && !(p.previousPrice > p.sellingPrice || p.featured)) return false;
      if (q) {
        const hay = `${p.name} ${p.genericName} ${p.manufacturer} ${p.subcategory} ${p.sku}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });

    if (sortBy === 'price_asc') list.sort((a, b) => a.sellingPrice - b.sellingPrice);
    else if (sortBy === 'price_desc') list.sort((a, b) => b.sellingPrice - a.sellingPrice);
    else if (sortBy === 'stock_asc') list.sort((a, b) => a.stockQuantity - b.stockQuantity);
    return list;
  }, [products, categories, searchQuery, categoryFilter, companyFilter, pubFilter, stockFilter, offerOnly, sortBy]);

  const totalPages = Math.max(1, Math.ceil(filteredProducts.length / PAGE_SIZE));
  const currentPage = Math.min(page, totalPages);
  const paginatedProducts = filteredProducts.slice(
    (currentPage - 1) * PAGE_SIZE,
    currentPage * PAGE_SIZE
  );

  const openCreateModal = () => {
    setErrorMsg(null);
    setEditingProduct(null);
    const defaultCat = categories[0];
    setForm({
      ...EMPTY_PRODUCT_FORM,
      categoryId: defaultCat?.id || '',
      categoryName: defaultCat?.name || '',
      sku: `SKU-${Date.now().toString(36).slice(-5).toUpperCase()}`,
    });
    setModalOpen(true);
  };

  const openEditModal = (prod: Product) => {
    setErrorMsg(null);
    setEditingProduct(prod);
    setForm({
      id: prod.id,
      name: prod.name,
      slug: prod.slug,
      genericName: prod.genericName,
      manufacturer: prod.manufacturer,
      categoryId: prod.categoryId,
      categoryName: prod.categoryName,
      subcategory: prod.subcategory,
      description: prod.description,
      images: prod.images || [],
      unitSize: prod.unitSize,
      sellingPrice: prod.sellingPrice,
      previousPrice: prod.previousPrice,
      stockQuantity: prod.stockQuantity,
      lowStockThreshold: prod.lowStockThreshold,
      sku: prod.sku,
      prescriptionType: prod.prescriptionType,
      usageInstructions: prod.usageInstructions,
      storageInstructions: prod.storageInstructions,
      nearestExpiryDate: prod.nearestExpiryDate,
      publicationStatus: prod.publicationStatus,
      featured: prod.featured,
      popular: prod.popular,
    });
    setModalOpen(true);
  };

  const handleBulkStatus = async (status: Product['publicationStatus']) => {
    if (!actor || selectedIds.length === 0) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      const selectedProds = products.filter((p) => selectedIds.includes(p.id));
      await bulkUpdateProductPublication(actor, selectedProds, status);
      setSelectedIds([]);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bulk update failed.');
    } finally {
      setSaving(false);
    }
  };

  const handleInitOfficialCategories = async () => {
    if (!actor) return;
    setErrorMsg(null);
    setSaving(true);
    try {
      await bootstrapReferenceStructure(
        actor,
        categories,
        Boolean(siteSettings),
        deliveryZones,
        coupons,
        siteSettings
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize official categories.');
    } finally {
      setSaving(false);
    }
  };

  const handleSyncToCustomerPanel = async (publishDrafts = true) => {
    if (!actor) return;
    setErrorMsg(null);
    setSuccessMsg(null);
    setSyncingCatalog(true);
    try {
      const res = await syncCatalogToCustomerPanel(actor, {
        categories,
        products,
        siteSettings,
        deliveryZones,
        coupons,
        publishDrafts,
      });
      setSuccessMsg(
        `কাস্টমার প্যানেলে সফলভাবে সিঙ্ক হয়েছে (${res.syncedProducts}টি প্রোডাক্ট ও ${res.syncedCategories}টি ক্যাটাগরি আপডেট হয়েছে${
          res.publishedDrafts > 0 ? `, ${res.publishedDrafts}টি Draft প্রোডাক্ট পাবলিশ করা হয়েছে` : ''
        })।`
      );
      const probe = await probeCustomerPanelCatalogFeed();
      setProbeResult(probe);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Customer Panel sync failed.');
    } finally {
      setSyncingCatalog(false);
    }
  };

  const handleRunFeedProbe = async () => {
    setProbingFeed(true);
    setErrorMsg(null);
    try {
      const res = await probeCustomerPanelCatalogFeed();
      setProbeResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to test Customer Panel feed.');
    } finally {
      setProbingFeed(false);
    }
  };

  const handleCopyText = async (key: string, text: string) => {
    try {
      await navigator.clipboard.writeText(text);
      setCopiedKey(key);
      setTimeout(() => {
        setCopiedKey((prev) => (prev === key ? null : prev));
      }, 2500);
    } catch {
      setErrorMsg('Clipboard copy failed in this browser context.');
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Product Catalog Management
          </h1>
          <p className="text-sm text-[#64748B]">
            Manage verified medicines, herbal formulations, supplements, and healthcare products synced to the Customer Panel.
          </p>
        </div>

        {permissions?.canManageCatalog && (
          <div className="flex flex-wrap items-center gap-2.5 shrink-0 no-print">
            <button
              type="button"
              onClick={() => {
                setSyncModalOpen(true);
                void handleRunFeedProbe();
              }}
              className="inline-flex items-center gap-2 px-3.5 py-2.5 text-sm font-medium text-[#0D7E74] bg-white hover:bg-[#F2F8F4] border border-[#0D7E74] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-4 h-4 ${syncingCatalog ? 'animate-spin' : ''}`} />
              <span>Customer Panel Sync</span>
            </button>
            <button
              type="button"
              disabled={categories.length === 0}
              onClick={openCreateModal}
              className="inline-flex items-center gap-2 px-4 py-2.5 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          </div>
        )}
      </div>

      {permissions?.canManageCatalog && probeResult && !probeResult.unfilteredListAllowed && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 text-sm text-[#92400E] flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold">
                কাস্টমার প্যানেল Firestore Rules আপডেট প্রয়োজন ({projectInfo.projectId})
              </p>
              <p className="text-xs mt-0.5 leading-relaxed">
                আপনার কাস্টমার প্যানেল থেকে প্রোডাক্ট সরাসরি লোড হওয়ার জন্য আপডেটেড <span className="font-mono font-semibold">firestore.rules</span> কপি করে Firebase Console → Firestore Database → Rules-এ পেস্ট করে <strong>Publish</strong> করুন।
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void handleCopyText('banner_rules', firestoreRulesRaw)}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-white bg-[#D97706] hover:bg-[#B45309] rounded-lg whitespace-nowrap shrink-0"
          >
            {copiedKey === 'banner_rules' ? (
              <Check className="w-3.5 h-3.5" />
            ) : (
              <Copy className="w-3.5 h-3.5" />
            )}
            <span>
              {copiedKey === 'banner_rules' ? 'firestore.rules কপি হয়েছে!' : 'Copy Updated firestore.rules'}
            </span>
          </button>
        </div>
      )}

      {permissions?.canManageCatalog && (draftProductsCount > 0 || unsyncedProductsCount > 0) && (
        <div className="bg-[#F0FDFA] border border-[#99F6E4] rounded-xl p-4 text-sm text-[#0F172A] flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
          <div className="flex items-start gap-2.5">
            <AlertTriangle className="w-4 h-4 text-[#0D7E74] shrink-0 mt-0.5" />
            <div>
              <p className="font-semibold text-[#0F172A]">
                কাস্টমার প্যানেলে দৃশ্যমানতা সিঙ্ক (Customer Panel Visibility Notice)
              </p>
              <p className="text-xs text-[#475569] mt-0.5">
                {draftProductsCount > 0
                  ? `${draftProductsCount}টি প্রোডাক্ট বর্তমানে Draft অবস্থায় আছে (কাস্টমার প্যানেলে লুকানো)। `
                  : ''}
                {unsyncedProductsCount > 0
                  ? `${unsyncedProductsCount}টি প্রোডাক্টে কাস্টমার প্যানেল মিরর ফিল্ড সিঙ্ক করা প্রয়োজন। `
                  : ''}
                এক ক্লিকে সব প্রোডাক্ট কাস্টমার প্যানেলে সিঙ্ক ও পাবলিশ করতে পাশে ক্লিক করুন।
              </p>
            </div>
          </div>
          <button
            type="button"
            disabled={syncingCatalog}
            onClick={() => void handleSyncToCustomerPanel(true)}
            className="px-3.5 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
          >
            {syncingCatalog ? 'Syncing...' : 'Sync & Publish to Customer Panel'}
          </button>
        </div>
      )}

      {successMsg && (
        <div className="bg-[#F0FDF4] border border-[#BBF7D0] rounded-xl p-4 text-sm text-[#166534] flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-xs text-[#166534] hover:underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {categories.length === 0 && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 text-sm text-[#92400E] flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2.5">
            <AlertTriangle className="w-4 h-4 shrink-0" />
            <span>
              Create at least one category in <strong>Categories</strong> (or initialize official categories here) before adding products.
            </span>
          </div>
          {permissions?.canManageCatalog && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleInitOfficialCategories()}
              className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#D97706] hover:bg-[#B45309] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
            >
              {saving ? 'Initializing...' : 'Initialize Official Categories'}
            </button>
          )}
        </div>
      )}

      {errorMsg && (
        <div className="bg-[#FEF2F2] border border-[#FECACA] rounded-xl p-4 text-sm text-[#991B1B] flex items-start justify-between gap-3 no-print">
          <div className="flex items-start gap-2.5 min-w-0">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span className="min-w-0 break-all">{errorMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setErrorMsg(null)}
            className="text-xs text-[#991B1B] hover:underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Search & Multi-Facet Filter Bar */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 space-y-3 no-print">
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-6 gap-3">
          <div className="xl:col-span-2 relative">
            <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-3" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setPage(1);
              }}
              placeholder="Search name, generic, company, or SKU..."
              className="w-full pl-9 pr-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
            />
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => {
              setCategoryFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
          >
            <option value="all">All Categories</option>
            {categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name} {c.nameBn ? `(${c.nameBn})` : ''}
              </option>
            ))}
          </select>

          <select
            value={companyFilter}
            onChange={(e) => {
              setCompanyFilter(e.target.value);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
          >
            <option value="all">All Manufacturers</option>
            {uniqueCompanies.map((comp) => (
              <option key={comp} value={comp}>
                {comp}
              </option>
            ))}
          </select>

          <select
            value={stockFilter}
            onChange={(e) => {
              setStockFilter(e.target.value as typeof stockFilter);
              setPage(1);
            }}
            className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
          >
            <option value="all">All Stock States</option>
            <option value="in_stock">In Stock</option>
            <option value="low_stock">Low Stock</option>
            <option value="out_of_stock">Out of Stock</option>
            <option value="expired_restricted">Expired Restricted</option>
          </select>

          <select
            value={sortBy}
            onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
            className="px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
          >
            <option value="newest">Sort: Newest</option>
            <option value="price_asc">Price: Low to High</option>
            <option value="price_desc">Price: High to Low</option>
            <option value="stock_asc">Stock: Lowest First</option>
          </select>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-3 pt-2 border-t border-[#EEF2F6]">
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1 p-1 bg-[#EEF4F0] rounded-lg">
              {(['all', 'published', 'draft', 'archived'] as const).map((st) => (
                <button
                  key={st}
                  type="button"
                  onClick={() => {
                    setPubFilter(st);
                    setPage(1);
                  }}
                  className={`px-3 py-1 text-xs font-medium rounded-md capitalize transition-colors whitespace-nowrap shrink-0 ${
                    pubFilter === st
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {st}
                </button>
              ))}
            </div>

            <button
              type="button"
              onClick={() => {
                setOfferOnly((prev) => !prev);
                setPage(1);
              }}
              className={`px-3 py-1.5 text-xs font-medium rounded-lg border transition-colors whitespace-nowrap shrink-0 ${
                offerOnly
                  ? 'bg-[#F0FDFA] border-[#0D7E74] text-[#0D7E74]'
                  : 'bg-white border-[#E6ECEF] text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              On Offer · অফার ({products.filter((p) => p.previousPrice > p.sellingPrice || p.featured).length})
            </button>
          </div>

          {selectedIds.length > 0 && permissions?.canEditPricing && (
            <div className="flex items-center gap-2 text-xs">
              <span className="font-mono tabular-nums text-[#64748B]">
                {selectedIds.length} selected:
              </span>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleBulkStatus('published')}
                className="px-3 py-1.5 font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg hover:bg-[#F2F8F4] whitespace-nowrap shrink-0"
              >
                Publish Selected
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleBulkStatus('draft')}
                className="px-3 py-1.5 font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg hover:bg-[#F4F7F8] whitespace-nowrap shrink-0"
              >
                Unpublish (Draft)
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={() => void handleBulkStatus('archived')}
                className="px-3 py-1.5 font-medium text-[#991B1B] border border-[#FECACA] rounded-lg hover:bg-[#FEF2F2] whitespace-nowrap shrink-0"
              >
                Archive
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Product Data Table */}
      <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
        {paginatedProducts.length === 0 ? (
          <div className="p-12 text-center space-y-3">
            <Package className="w-8 h-8 text-[#64748B] mx-auto" />
            <h2 className="text-base font-semibold text-[#0F172A]">
              No Matching Products Found
            </h2>
            <p className="text-sm text-[#64748B] max-w-md mx-auto">
              Add verified healthcare products with manufacturer details, prescription classification, and accurate stock thresholds.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse">
              <thead>
                <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                  <th className="py-3 px-4 w-10 print-hide-col">
                    <input
                      type="checkbox"
                      aria-label="Select all visible products"
                      checked={
                        paginatedProducts.length > 0 &&
                        paginatedProducts.every((p) => selectedIds.includes(p.id))
                      }
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedIds(
                            Array.from(new Set([...selectedIds, ...paginatedProducts.map((p) => p.id)]))
                          );
                        } else {
                          const pageIds = new Set(paginatedProducts.map((p) => p.id));
                          setSelectedIds(selectedIds.filter((id) => !pageIds.has(id)));
                        }
                      }}
                    />
                  </th>
                  <th className="py-3 px-4">Product &amp; Generic</th>
                  <th className="py-3 px-4">Category &amp; Rx Class</th>
                  <th className="py-3 px-4 text-right">Price (BDT)</th>
                  <th className="py-3 px-4 text-right">Stock</th>
                  <th className="py-3 px-4">Publication</th>
                  <th className="py-3 px-4 text-right print-hide-col">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[#EEF2F6] text-sm">
                {paginatedProducts.map((prod) => {
                  const primaryImg = prod.images?.[0] || '';
                  return (
                    <tr key={prod.id} className="hover:bg-[#F7FAF8]">
                      <td className="py-3 px-4 print-hide-col">
                        <input
                          type="checkbox"
                          aria-label={`Select ${prod.name}`}
                          checked={selectedIds.includes(prod.id)}
                          onChange={(e) => {
                            if (e.target.checked) setSelectedIds([...selectedIds, prod.id]);
                            else setSelectedIds(selectedIds.filter((id) => id !== prod.id));
                          }}
                        />
                      </td>
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-3">
                          <div className="w-10 h-10 rounded-lg border border-[#E6ECEF] bg-[#F4F8F6] overflow-hidden flex items-center justify-center shrink-0 no-print">
                            {primaryImg ? (
                              <img
                                src={primaryImg}
                                alt={prod.name}
                                referrerPolicy="no-referrer"
                                onError={(e) => {
                                  (e.currentTarget as HTMLImageElement).style.display = 'none';
                                }}
                                className="w-full h-full object-cover"
                              />
                            ) : (
                              <Package className="w-4 h-4 text-[#0D7E74]" />
                            )}
                          </div>
                          <div className="min-w-0">
                            <p className="font-semibold text-[#0F172A] truncate max-w-xs">
                              {prod.name}
                            </p>
                            <p className="text-xs text-[#64748B] truncate max-w-xs">
                              {prod.genericName ? `${prod.genericName} · ` : ''}
                              {prod.manufacturer} · {prod.unitSize} ·{' '}
                              <span className="font-mono">{prod.sku}</span>
                            </p>
                          </div>
                        </div>
                      </td>
                      <td className="py-3 px-4 text-xs text-[#64748B]">
                        <p className="text-[#0F172A] font-medium">
                          {prod.categoryName}
                          {prod.subcategory ? ` · ${prod.subcategory}` : ''}
                        </p>
                        <p>
                          {prod.prescriptionType === 'prescription_required'
                            ? 'Rx Required'
                            : prod.prescriptionType === 'pharmacist_verified'
                            ? 'Pharmacist Verified'
                            : 'OTC Permitted'}
                          {prod.nearestExpiryDate ? ` · Exp ${prod.nearestExpiryDate}` : ''}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <p className="font-semibold text-[#0F172A]">{formatBdt(prod.sellingPrice)}</p>
                        {prod.previousPrice > prod.sellingPrice && (
                          <p className="text-xs text-[#0D7E74]">
                            <span className="text-[#64748B] line-through mr-1">
                              {formatBdt(prod.previousPrice)}
                            </span>
                            -{Math.round(((prod.previousPrice - prod.sellingPrice) / prod.previousPrice) * 100)}%
                          </p>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right font-mono tabular-nums">
                        <p className="font-semibold text-[#0F172A]">{prod.stockQuantity}</p>
                        <p
                          className={`text-xs ${
                            prod.availabilityStatus === 'in_stock'
                              ? 'text-[#0D7E74]'
                              : prod.availabilityStatus === 'low_stock'
                              ? 'text-[#D97706]'
                              : 'text-[#DC2626]'
                          }`}
                        >
                          {prod.availabilityStatus.replace(/_/g, ' ')}
                        </p>
                      </td>
                      <td className="py-3 px-4 text-xs">
                        {prod.publicationStatus === 'published' ? (
                          <span className="inline-flex items-center gap-1.5 text-[#0D7E74] font-medium">
                            <CheckCircle2 className="w-3.5 h-3.5" />
                            Published
                          </span>
                        ) : prod.publicationStatus === 'draft' ? (
                          <span className="text-[#64748B] font-medium">Draft</span>
                        ) : (
                          <span className="inline-flex items-center gap-1 text-[#991B1B] font-medium">
                            <Archive className="w-3.5 h-3.5" />
                            Archived
                          </span>
                        )}
                      </td>
                      <td className="py-3 px-4 text-right print-hide-col">
                        <div className="inline-flex items-center gap-2">
                          <button
                            type="button"
                            onClick={() => setDetailProduct(prod)}
                            className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-md"
                            title="View Details"
                          >
                            <Eye className="w-4 h-4" />
                          </button>
                          {permissions?.canManageCatalog && (
                            <button
                              type="button"
                              onClick={() => openEditModal(prod)}
                              className="p-1.5 text-[#0D7E74] hover:bg-[#EEF4F0] rounded-md"
                              title="Edit Product"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}

        {/* Pagination Footer */}
        <div className="px-6 py-3.5 border-t border-[#EEF2F6] flex items-center justify-between text-xs text-[#64748B]">
          <span className="font-mono tabular-nums">
            Showing {paginatedProducts.length} of {filteredProducts.length} product(s)
          </span>
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={currentPage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
              className="p-1.5 border border-[#E6ECEF] rounded-md disabled:opacity-40 no-print"
              aria-label="Previous page"
            >
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span className="font-mono tabular-nums">
              Page {currentPage} / {totalPages}
            </span>
            <button
              type="button"
              disabled={currentPage >= totalPages}
              onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
              className="p-1.5 border border-[#E6ECEF] rounded-md disabled:opacity-40 no-print"
              aria-label="Next page"
            >
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      </div>

      {/* Product Detail Drawer / Dialog */}
      {detailProduct && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#EEF2F6] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">{detailProduct.name}</h2>
                <p className="text-xs text-[#64748B]">
                  {detailProduct.genericName ? `${detailProduct.genericName} · ` : ''}
                  {detailProduct.manufacturer} · SKU <span className="font-mono">{detailProduct.sku}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setDetailProduct(null)}
                className="p-1 text-[#64748B] hover:text-[#0F172A]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
              <div>
                <p className="text-[#64748B]">Selling Price</p>
                <p className="font-mono font-semibold text-sm text-[#0F172A] mt-0.5">
                  {formatBdt(detailProduct.sellingPrice)}
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Sellable Stock</p>
                <p className="font-mono font-semibold text-sm text-[#0F172A] mt-0.5">
                  {detailProduct.stockQuantity} ({detailProduct.unitSize})
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Prescription Class</p>
                <p className="font-semibold text-sm text-[#0F172A] mt-0.5 capitalize">
                  {detailProduct.prescriptionType.replace(/_/g, ' ')}
                </p>
              </div>
              <div>
                <p className="text-[#64748B]">Nearest Expiry</p>
                <p className="font-mono font-semibold text-sm text-[#0F172A] mt-0.5">
                  {detailProduct.nearestExpiryDate || 'Tracked per batch'}
                </p>
              </div>
            </div>

            <div className="space-y-3 text-sm border-t border-[#EEF2F6] pt-4">
              <div>
                <p className="text-xs font-semibold text-[#0F172A]">Verified Product Description</p>
                <p className="text-sm text-[#64748B] mt-1 leading-relaxed">
                  {detailProduct.description || 'No description entered.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#0F172A]">Verified Usage Guidance</p>
                <p className="text-sm text-[#64748B] mt-1 leading-relaxed">
                  {detailProduct.usageInstructions || 'Consult registered physician or manufacturer leaflet.'}
                </p>
              </div>
              <div>
                <p className="text-xs font-semibold text-[#0F172A]">Storage Conditions</p>
                <p className="text-sm text-[#64748B] mt-1 leading-relaxed">
                  {detailProduct.storageInstructions || 'Standard pharmacy ambient storage.'}
                </p>
              </div>
              <p className="text-xs text-[#64748B] font-mono pt-2">
                Created: {formatTimestamp(detailProduct.createdAt)} · Updated: {formatTimestamp(detailProduct.updatedAt)}
              </p>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Product Modal */}
      {modalOpen && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-3xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  {editingProduct ? `Edit Product: ${editingProduct.name}` : 'Create Verified Pharmacy Product'}
                </h2>
                <p className="text-xs text-[#64748B]">
                  Enter only verified manufacturer details, strengths, and approved leaflet storage instructions.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-[#64748B] hover:text-[#0F172A]"
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
                  await saveProduct(actor, form, editingProduct || undefined);
                  setModalOpen(false);
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : 'Failed to save product.');
                } finally {
                  setSaving(false);
                }
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Product Name *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    maxLength={160}
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder="e.g., Recur 1mg Tablet"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Generic Name (Verified Source Only)
                  </label>
                  <input
                    type="text"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    maxLength={160}
                    value={form.genericName}
                    onChange={(e) => setForm({ ...form, genericName: e.target.value })}
                    placeholder="Optional verified generic name"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Manufacturer / Brand (ব্র্যান্ড) *
                  </label>
                  <input
                    type="text"
                    required
                    list="verified-pharma-brands-datalist"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    maxLength={120}
                    value={form.manufacturer}
                    onChange={(e) => setForm({ ...form, manufacturer: e.target.value })}
                    placeholder="e.g., Beximco Pharmaceuticals Ltd."
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                  <datalist id="verified-pharma-brands-datalist">
                    {brandAutocompleteOptions.map((brand) => (
                      <option key={brand} value={brand} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Category (ক্যাটাগরি) *
                  </label>
                  <select
                    required
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    value={form.categoryId}
                    onChange={(e) => {
                      const cat = categories.find((c) => c.id === e.target.value);
                      setForm({
                        ...form,
                        categoryId: e.target.value,
                        categoryName: cat?.name || '',
                      });
                    }}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white disabled:bg-[#F4F8F6]"
                  >
                    {categories.map((c) => (
                      <option key={c.id} value={c.id}>
                        {c.nameBn ? `${c.nameBn} (${c.name})` : c.name}
                      </option>
                    ))}
                  </select>
                </div>

                <div className="sm:col-span-2">
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Subcategory (সাব-ক্যাটাগরি, Optional)
                  </label>
                  <input
                    type="text"
                    list="product-subcategory-suggestions"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    maxLength={100}
                    value={form.subcategory}
                    onChange={(e) => setForm({ ...form, subcategory: e.target.value })}
                    placeholder="Select or type a subcategory (e.g., প্রেসক্রিপশন ঔষধ / Multivitamins)"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                  <datalist id="product-subcategory-suggestions">
                    {subcategorySuggestions.map((sub) => (
                      <option key={sub} value={sub} />
                    ))}
                  </datalist>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Unit / Package Size *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={80}
                    value={form.unitSize}
                    onChange={(e) => setForm({ ...form, unitSize: e.target.value })}
                    placeholder="e.g., Box of 30 Tablets"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Internal SKU *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={64}
                    value={form.sku}
                    onChange={(e) => setForm({ ...form, sku: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Selling Price (BDT) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    required
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    value={form.sellingPrice}
                    onChange={(e) => setForm({ ...form, sellingPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Previous Price (BDT, Optional)
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    value={form.previousPrice}
                    onChange={(e) => setForm({ ...form, previousPrice: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F8F6]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Sellable Stock Quantity *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    required
                    value={form.stockQuantity}
                    onChange={(e) => setForm({ ...form, stockQuantity: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Low-Stock Alert Threshold *
                  </label>
                  <input
                    type="number"
                    min={0}
                    step="1"
                    required
                    value={form.lowStockThreshold}
                    onChange={(e) => setForm({ ...form, lowStockThreshold: Number(e.target.value) })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Prescription Classification *
                  </label>
                  <select
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    value={form.prescriptionType}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        prescriptionType: e.target.value as Product['prescriptionType'],
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white disabled:bg-[#F4F8F6]"
                  >
                    <option value="otc">OTC — Permitted Without Prescription</option>
                    <option value="prescription_required">Prescription Required (Strict Review Gate)</option>
                    <option value="pharmacist_verified">Pharmacist Verified Before Dispatch</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Nearest Batch Expiry Date
                  </label>
                  <input
                    type="date"
                    value={form.nearestExpiryDate}
                    onChange={(e) => setForm({ ...form, nearestExpiryDate: e.target.value })}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                  {form.nearestExpiryDate && isDateExpired(form.nearestExpiryDate) && (
                    <p className="text-xs text-[#B45309] mt-1.5 leading-snug">
                      সতর্কতা: মেয়াদোত্তীর্ণ তারিখ দেওয়ার কারণে প্রোডাক্টটি স্বয়ংক্রিয়ভাবে Draft (Expired Restricted) হয়ে থাকবে এবং কাস্টমার প্যানেলে দেখাবে না। কাস্টমার প্যানেলে দেখাতে ভবিষ্যতের সঠিক মেয়াদ দিন।
                    </p>
                  )}
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Product Description
                </label>
                <textarea
                  rows={2}
                  maxLength={2000}
                  value={form.description}
                  onChange={(e) => setForm({ ...form, description: e.target.value })}
                  placeholder="Verified package overview without unapproved therapeutic claims..."
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Verified Usage Information
                  </label>
                  <textarea
                    rows={2}
                    maxLength={1000}
                    value={form.usageInstructions}
                    onChange={(e) => setForm({ ...form, usageInstructions: e.target.value })}
                    placeholder="Use strictly as directed by a registered physician."
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Storage Conditions
                  </label>
                  <textarea
                    rows={2}
                    maxLength={500}
                    value={form.storageInstructions}
                    onChange={(e) => setForm({ ...form, storageInstructions: e.target.value })}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              {/* Product Image Gallery Upload & URL Manager */}
              <div className="border-t border-[#EEF2F6] pt-4 space-y-2.5">
                <label className="block text-xs font-medium text-[#0F172A]">
                  Product Gallery (Up to 6 Images)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    value={imageUrlDraft}
                    onChange={(e) => setImageUrlDraft(e.target.value)}
                    placeholder="Paste HTTPS image URL or /assets/... path"
                    className="flex-1 min-w-[220px] px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      if (!imageUrlDraft.trim() || form.images.length >= 6) return;
                      setForm({ ...form, images: [...form.images, imageUrlDraft.trim()] });
                      setImageUrlDraft('');
                    }}
                    className="px-3 py-2 text-xs font-medium border border-[#E6ECEF] rounded-lg hover:bg-[#F4F8F6] whitespace-nowrap shrink-0"
                  >
                    Add URL
                  </button>
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg cursor-pointer hover:bg-[#F2F8F4] whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingImg ? 'Uploading...' : 'Upload File'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingImg || form.images.length >= 6}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingImg(true);
                        setErrorMsg(null);
                        try {
                          const url = await uploadCatalogAsset('catalog/products', file);
                          setForm((prev) => ({ ...prev, images: [...prev.images, url].slice(0, 6) }));
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : 'Firebase Storage upload failed.'
                          );
                        } finally {
                          setUploadingImg(false);
                        }
                      }}
                    />
                  </label>
                </div>

                {form.images.length > 0 && (
                  <div className="flex flex-wrap gap-2 pt-1">
                    {form.images.map((img, i) => (
                      <div
                        key={`${img}-${i}`}
                        className="flex items-center gap-2 px-2.5 py-1.5 bg-[#F4F8F6] border border-[#E6ECEF] rounded-lg text-xs"
                      >
                        <span className="truncate max-w-[180px] font-mono">{img}</span>
                        <button
                          type="button"
                          onClick={() =>
                            setForm({
                              ...form,
                              images: form.images.filter((_, idx) => idx !== i),
                            })
                          }
                          className="text-[#991B1B]"
                        >
                          <X className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Publication & Placement Controls */}
              <div className="grid grid-cols-1 sm:grid-cols-3 gap-4 border-t border-[#EEF2F6] pt-4 items-center">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Publication Status
                  </label>
                  <select
                    value={form.publicationStatus}
                    onChange={(e) =>
                      setForm({
                        ...form,
                        publicationStatus: e.target.value as Product['publicationStatus'],
                      })
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="published">Published (Visible on Storefront)</option>
                    <option value="draft">Draft (Hidden)</option>
                    <option value="archived">Archived</option>
                  </select>
                </div>

                <label className="flex items-center gap-2 text-sm text-[#0F172A] pt-4">
                  <input
                    type="checkbox"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    checked={form.featured}
                    onChange={(e) => setForm({ ...form, featured: e.target.checked })}
                  />
                  <span>Featured on Homepage</span>
                </label>

                <label className="flex items-center gap-2 text-sm text-[#0F172A] pt-4">
                  <input
                    type="checkbox"
                    disabled={Boolean(editingProduct && !permissions?.canEditPricing)}
                    checked={form.popular}
                    onChange={(e) => setForm({ ...form, popular: e.target.checked })}
                  />
                  <span>Popular Products Section</span>
                </label>
              </div>

              <div className="flex items-center justify-end gap-3 border-t border-[#EEF2F6] pt-4">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] hover:text-[#0F172A] whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-60 rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  {saving ? 'Saving...' : editingProduct ? 'Update Product' : 'Create Product'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Customer Panel Sync & Diagnostics Modal */}
      {syncModalOpen && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4 no-print">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-2xl w-full max-h-[90vh] overflow-y-auto p-6 space-y-5">
            <div className="flex items-start justify-between gap-4 border-b border-[#EEF2F6] pb-4">
              <div>
                <h2 className="text-lg font-bold text-[#0F172A]">
                  কাস্টমার প্যানেল সিঙ্ক ও ডায়াগনস্টিক (Customer Panel Sync)
                </h2>
                <p className="text-xs text-[#64748B] mt-0.5">
                  Active Firebase Project:{' '}
                  <span className="font-mono font-semibold text-[#0F172A]">{projectInfo.projectId}</span>{' '}
                  · Database:{' '}
                  <span className="font-mono font-semibold text-[#0F172A]">{projectInfo.databaseId}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSyncModalOpen(false)}
                className="p-1 text-[#64748B] hover:text-[#0F172A]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-4 rounded-xl bg-[#F8FAFB] border border-[#E6ECEF] space-y-3">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">
                    ১. কাস্টমার প্যানেলে সব প্রোডাক্ট ও ক্যাটাগরি সিঙ্ক করুন
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    সকল প্রোডাক্টে কাস্টমার প্যানেল ফিল্ড (`price`, `mrp`, `image`, `stock`, `inStock`, `status: &quot;active&quot;`, `published: true`, `categorySlug`) যুক্ত করে এবং Draft প্রোডাক্ট পাবলিশ করে।
                  </p>
                </div>
                <button
                  type="button"
                  disabled={syncingCatalog}
                  onClick={() => void handleSyncToCustomerPanel(true)}
                  className="inline-flex items-center gap-2 px-4 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  <RefreshCw className={`w-3.5 h-3.5 ${syncingCatalog ? 'animate-spin' : ''}`} />
                  <span>{syncingCatalog ? 'সিঙ্ক হচ্ছে...' : 'সিঙ্ক ও পাবলিশ করুন'}</span>
                </button>
              </div>
            </div>

            <div className="p-4 rounded-xl bg-white border border-[#E6ECEF] space-y-3">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-[#0F172A]">
                    ২. কাস্টমার প্যানেল লাইভ ডাটা রিড টেস্ট (Public Feed Check)
                  </h3>
                  <p className="text-xs text-[#64748B] mt-0.5">
                    লগইন ছাড়াই সাধারণ কাস্টমার ব্রাউজার থেকে Firebase প্রোডাক্ট দেখা যাচ্ছে কি না তা সরাসরি যাচাই করে।
                  </p>
                </div>
                <button
                  type="button"
                  disabled={probingFeed}
                  onClick={() => void handleRunFeedProbe()}
                  className="px-3 py-1.5 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] hover:bg-[#E2EEF0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  {probingFeed ? 'যাচাই হচ্ছে...' : 'পুনরায় টেস্ট করুন'}
                </button>
              </div>

              {probeResult && (
                <div
                  className={`p-3.5 rounded-lg border text-xs space-y-1.5 ${
                    probeResult.ok && probeResult.unfilteredListAllowed
                      ? 'bg-[#F0FDF4] border-[#BBF7D0] text-[#166534]'
                      : 'bg-[#FFFBEB] border-[#FDE68A] text-[#92400E]'
                  }`}
                >
                  <p className="font-semibold">
                    {probeResult.ok
                      ? `কাস্টমার প্যানেল থেকে সরাসরি ${probeResult.publishedProductsCount}টি Published প্রোডাক্ট এবং ${probeResult.publishedCategoriesCount}টি ক্যাটাগরি পড়া যাচ্ছে।`
                      : 'কাস্টমার প্যানেল রিড ব্লকড রয়েছে — নিচের firestore.rules কপি করে Firebase Console-এ Publish করুন।'}
                  </p>
                  {probeResult.sampleProductNames.length > 0 && (
                    <p className="font-mono text-[11px]">
                      দৃশ্যমান প্রোডাক্ট: {probeResult.sampleProductNames.join(', ')}
                    </p>
                  )}
                  {probeResult.errorMessage && <p>{probeResult.errorMessage}</p>}
                </div>
              )}
            </div>

            <div className="p-4 rounded-xl bg-[#F8FAFB] border border-[#E6ECEF] space-y-3">
              <div>
                <h3 className="text-sm font-semibold text-[#0F172A]">
                  ৩. কাস্টমার প্যানেলের Firebase সংযোগ মিলিয়ে নিন (.env ও Security Rules)
                </h3>
                <p className="text-xs text-[#64748B] mt-0.5">
                  কাস্টমার প্যানেল অ্যাপে অবশ্যই একই Firebase Project (<span className="font-mono">{projectInfo.projectId}</span>) এবং Database (<span className="font-mono">{projectInfo.databaseId}</span>) যুক্ত থাকতে হবে।
                </p>
              </div>

              <div className="flex flex-wrap items-center gap-2.5">
                <button
                  type="button"
                  onClick={() => void handleCopyText('env', buildCustomerPanelEnvTemplate())}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0F172A] bg-white hover:bg-[#EEF4F0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'env' ? (
                    <Check className="w-3.5 h-3.5 text-[#15803D]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#0D7E74]" />
                  )}
                  <span>
                    {copiedKey === 'env' ? 'Customer Panel .env কপি হয়েছে!' : 'Copy Customer Panel .env'}
                  </span>
                </button>

                <button
                  type="button"
                  onClick={() => void handleCopyText('rules', firestoreRulesRaw)}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium text-[#0F172A] bg-white hover:bg-[#EEF4F0] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  {copiedKey === 'rules' ? (
                    <Check className="w-3.5 h-3.5 text-[#15803D]" />
                  ) : (
                    <Copy className="w-3.5 h-3.5 text-[#0D7E74]" />
                  )}
                  <span>
                    {copiedKey === 'rules' ? 'firestore.rules কপি হয়েছে!' : 'Copy firestore.rules'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
