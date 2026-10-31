import React, { useMemo, useState } from 'react';
import {
  AlertCircle,
  ArrowDown,
  ArrowRight,
  ArrowUp,
  Building2,
  CheckCircle2,
  Edit3,
  EyeOff,
  FolderTree,
  LayoutList,
  Pin,
  Plus,
  RefreshCw,
  Search,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import {
  bootstrapReferenceStructure,
  bulkUpdateProductPublication,
  deleteCategorySafely,
  OFFICIAL_STOREFRONT_CATEGORIES,
  reconcileCategoryProductCounts,
  renameBrandAcrossProducts,
  saveCategory,
  swapCategoryDisplayOrder,
  toggleCategoryInStorefrontNavbar,
  toggleCategoryPublication,
  uploadCatalogAsset,
  VERIFIED_PHARMA_BRANDS,
} from '../services/pharmacyService';
import type { AdminModuleKey, Category } from '../types/pharmacy';

const ICON_OPTIONS = [
  'Pill',
  'Leaf',
  'ShieldPlus',
  'Stethoscope',
  'Sparkles',
  'Building2',
  'HeartPulse',
];

interface CategoriesViewProps {
  onNavigate?: (module: AdminModuleKey) => void;
}

type CategoryTab = 'categories' | 'brands' | 'storefront_audit';
type CategoryFilter = 'all' | 'top_level' | 'subcategories' | 'published' | 'hidden';

export function CategoriesView({ onNavigate }: CategoriesViewProps) {
  const { permissions } = useAuth();
  const { actor, categories, products, siteSettings, deliveryZones, coupons } = useStoreData();

  const [activeTab, setActiveTab] = useState<CategoryTab>('categories');
  const [searchQuery, setSearchQuery] = useState('');
  const [filterMode, setFilterMode] = useState<CategoryFilter>('all');

  // Category Create/Edit Modal State
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<Category | null>(null);
  const [name, setName] = useState('');
  const [nameBn, setNameBn] = useState('');
  const [slug, setSlug] = useState('');
  const [description, setDescription] = useState('');
  const [iconName, setIconName] = useState('Pill');
  const [imageUrl, setImageUrl] = useState('');
  const [parentCategoryId, setParentCategoryId] = useState('');
  const [displayOrder, setDisplayOrder] = useState(1);
  const [publicationStatus, setPublicationStatus] = useState<'published' | 'hidden'>('published');
  const [uploadingImg, setUploadingImg] = useState(false);

  // Brand Management State
  const [brandSearch, setBrandSearch] = useState('');
  const [showUnstockedBrands, setShowUnstockedBrands] = useState(false);
  const [renamingBrand, setRenamingBrand] = useState<string | null>(null);
  const [newBrandName, setNewBrandName] = useState('');

  // Action & Feedback State
  const [confirmDelete, setConfirmDelete] = useState<Category | null>(null);
  const [saving, setSaving] = useState(false);
  const [busyActionId, setBusyActionId] = useState<string | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  const featuredSlugsSet = useMemo(() => {
    const slugs =
      siteSettings?.featuredCategorySlugs && siteSettings.featuredCategorySlugs.length > 0
        ? siteSettings.featuredCategorySlugs
        : OFFICIAL_STOREFRONT_CATEGORIES.map((c) => c.slug);
    return new Set(slugs.map((s) => s.trim().toLowerCase()));
  }, [siteSettings]);

  const liveCountsByCategoryId = useMemo(() => {
    const map = new Map<string, number>();
    for (const cat of categories) {
      const count = products.filter((p) => {
        if (p.publicationStatus === 'archived') return false;
        if (p.categoryId === cat.id) return true;
        if (cat.parentCategoryId && p.subcategory) {
          const normSub = p.subcategory.trim().toLowerCase();
          return (
            normSub === cat.name.trim().toLowerCase() ||
            (Boolean(cat.nameBn) && normSub === cat.nameBn.trim().toLowerCase()) ||
            normSub === cat.slug.trim().toLowerCase()
          );
        }
        return false;
      }).length;
      map.set(cat.id, count);
    }
    return map;
  }, [categories, products]);

  const hasCountMismatch = useMemo(() => {
    return categories.some((c) => (liveCountsByCategoryId.get(c.id) ?? 0) !== c.activeProductCount);
  }, [categories, liveCountsByCategoryId]);

  const sortedCategories = useMemo(() => {
    return [...categories].sort((a, b) => {
      if (a.displayOrder !== b.displayOrder) return a.displayOrder - b.displayOrder;
      return a.name.localeCompare(b.name);
    });
  }, [categories]);

  const filteredCategories = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    return sortedCategories.filter((cat) => {
      if (filterMode === 'top_level' && cat.parentCategoryId) return false;
      if (filterMode === 'subcategories' && !cat.parentCategoryId) return false;
      if (filterMode === 'published' && cat.publicationStatus !== 'published') return false;
      if (filterMode === 'hidden' && cat.publicationStatus !== 'hidden') return false;
      if (q) {
        const hay = `${cat.name} ${cat.nameBn} ${cat.slug} ${cat.description}`.toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
  }, [sortedCategories, filterMode, searchQuery]);

  const brandRows = useMemo(() => {
    const map = new Map<
      string,
      {
        manufacturer: string;
        totalSkus: number;
        publishedSkus: number;
        totalUnits: number;
        categoriesSet: Set<string>;
      }
    >();

    for (const prod of products) {
      const brand = (prod.manufacturer || '').trim();
      if (!brand) continue;
      const existing = map.get(brand) || {
        manufacturer: brand,
        totalSkus: 0,
        publishedSkus: 0,
        totalUnits: 0,
        categoriesSet: new Set<string>(),
      };
      existing.totalSkus += 1;
      if (prod.publicationStatus === 'published') existing.publishedSkus += 1;
      existing.totalUnits += Math.max(0, prod.stockQuantity || 0);
      if (prod.categoryName) existing.categoriesSet.add(prod.categoryName);
      map.set(brand, existing);
    }

    if (showUnstockedBrands) {
      for (const refBrand of VERIFIED_PHARMA_BRANDS) {
        const alreadyExists = Array.from(map.keys()).some(
          (k) => k.toLowerCase() === refBrand.toLowerCase()
        );
        if (!alreadyExists) {
          map.set(refBrand, {
            manufacturer: refBrand,
            totalSkus: 0,
            publishedSkus: 0,
            totalUnits: 0,
            categoriesSet: new Set<string>(),
          });
        }
      }
    }

    const q = brandSearch.trim().toLowerCase();
    return Array.from(map.values())
      .filter((b) => !q || b.manufacturer.toLowerCase().includes(q))
      .sort((a, b) => b.totalSkus - a.totalSkus || a.manufacturer.localeCompare(b.manufacturer));
  }, [products, showUnstockedBrands, brandSearch]);

  const missingOfficialCount = useMemo(() => {
    return OFFICIAL_STOREFRONT_CATEGORIES.filter(
      (preset) =>
        !categories.some((c) => preset.aliases.includes(c.slug.trim().toLowerCase()))
    ).length;
  }, [categories]);

  const offerProductsCount = useMemo(() => {
    return products.filter(
      (p) =>
        p.publicationStatus === 'published' &&
        ((p.previousPrice > 0 && p.previousPrice > p.sellingPrice) || p.featured)
    ).length;
  }, [products]);

  const activeCoupons = useMemo(
    () => coupons.filter((c) => c.status === 'active'),
    [coupons]
  );

  const selectedParentPreset = useMemo(() => {
    if (!parentCategoryId) return null;
    const parentCat = categories.find((c) => c.id === parentCategoryId);
    if (!parentCat) return null;
    return (
      OFFICIAL_STOREFRONT_CATEGORIES.find((preset) =>
        preset.aliases.includes(parentCat.slug.trim().toLowerCase())
      ) || null
    );
  }, [parentCategoryId, categories]);

  const openCreate = (presetParentId = '') => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setEditing(null);
    setName('');
    setNameBn('');
    setSlug('');
    setDescription('');
    setIconName('Pill');
    setImageUrl('');
    setParentCategoryId(presetParentId);
    setDisplayOrder(categories.length + 1);
    setPublicationStatus('published');
    setModalOpen(true);
  };

  const openEdit = (cat: Category) => {
    setErrorMsg(null);
    setSuccessMsg(null);
    setEditing(cat);
    setName(cat.name);
    setNameBn(cat.nameBn);
    setSlug(cat.slug);
    setDescription(cat.description);
    setIconName(cat.iconName || 'Pill');
    setImageUrl(cat.imageUrl || '');
    setParentCategoryId(cat.parentCategoryId || '');
    setDisplayOrder(cat.displayOrder);
    setPublicationStatus(cat.publicationStatus);
    setModalOpen(true);
  };

  const handleSyncOfficialStorefront = async () => {
    if (!actor || !permissions?.canManageCategories) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await bootstrapReferenceStructure(
        actor,
        categories,
        Boolean(siteSettings),
        deliveryZones,
        coupons,
        siteSettings
      );
      setSuccessMsg(
        'Synced all 5 official storefront categories (ঔষধ, হারবাল পণ্য, ভিটামিন ও সাপ্লিমেন্ট, স্বাস্থ্যসামগ্রী, স্কিন কেয়ার), coupons, and navigation defaults.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to sync storefront structure.');
    } finally {
      setSaving(false);
    }
  };

  const handleReconcileCounts = async () => {
    if (!actor || !permissions?.canManageCategories) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const updated = await reconcileCategoryProductCounts(actor, categories, products);
      setSuccessMsg(
        updated > 0
          ? `Updated active product counts across ${updated} category record(s).`
          : 'All category product counts are already in exact sync with the live catalog.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to recalculate category counts.');
    } finally {
      setSaving(false);
    }
  };

  const handleQuickVisibilityToggle = async (cat: Category) => {
    if (!actor || !permissions?.canManageCategories) return;
    setBusyActionId(cat.id);
    setErrorMsg(null);
    try {
      await toggleCategoryPublication(actor, cat);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update category visibility.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleNavbarPinToggle = async (cat: Category) => {
    if (!actor || !permissions?.canManageCms) return;
    setBusyActionId(`pin_${cat.id}`);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const pinned = await toggleCategoryInStorefrontNavbar(actor, cat.slug, siteSettings);
      setSuccessMsg(
        pinned
          ? `Pinned "${cat.nameBn || cat.name}" to the Storefront Top Green Navigation Bar.`
          : `Unpinned "${cat.nameBn || cat.name}" from the Top Bar (remains accessible under সব ক্যাটাগরি).`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update storefront navigation bar.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleSwapOrder = async (indexInFiltered: number, direction: -1 | 1) => {
    if (!actor || !permissions?.canManageCategories) return;
    const current = filteredCategories[indexInFiltered];
    const target = filteredCategories[indexInFiltered + direction];
    if (!current || !target) return;
    setBusyActionId(`ord_${current.id}`);
    setErrorMsg(null);
    try {
      await swapCategoryDisplayOrder(actor, current, target);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not reorder categories.');
    } finally {
      setBusyActionId(null);
    }
  };

  const handleRenameBrandSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !renamingBrand || !newBrandName.trim()) return;
    setSaving(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const count = await renameBrandAcrossProducts(actor, renamingBrand, newBrandName, products);
      setRenamingBrand(null);
      setNewBrandName('');
      setSuccessMsg(`Updated brand name to "${newBrandName.trim()}" across ${count} product(s).`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to standardize brand name.');
    } finally {
      setSaving(false);
    }
  };

  const handleBrandBulkPublish = async (
    manufacturer: string,
    targetStatus: 'published' | 'draft'
  ) => {
    if (!actor || !permissions?.canEditPricing) return;
    const matching = products.filter(
      (p) => p.manufacturer.trim().toLowerCase() === manufacturer.trim().toLowerCase()
    );
    if (matching.length === 0) return;
    setBusyActionId(`brand_${manufacturer}`);
    setErrorMsg(null);
    try {
      await bulkUpdateProductPublication(actor, matching, targetStatus);
      setSuccessMsg(
        `Set ${matching.length} product(s) under "${manufacturer}" to ${targetStatus}.`
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Bulk brand update failed.');
    } finally {
      setBusyActionId(null);
    }
  };

  const topLevelCount = categories.filter((c) => !c.parentCategoryId).length;
  const subCategoryCount = categories.filter((c) => Boolean(c.parentCategoryId)).length;

  return (
    <div className="space-y-6">
      {/* Header & Primary Controls */}
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Categories, Brands &amp; Storefront Navigation
          </h1>
          <p className="text-sm text-[#64748B]">
            Control সব ক্যাটাগরি, top green navigation categories (ঔষধ, হারবাল পণ্য, ভিটামিন ও সাপ্লিমেন্ট, স্বাস্থ্যসামগ্রী, স্কিন কেয়ার), subcategories, and ব্র্যান্ড listings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2.5 no-print">
          {permissions?.canManageCategories && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleSyncOfficialStorefront()}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0D7E74] bg-white border border-[#0D7E74] hover:bg-[#F0FDFA] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${saving ? 'animate-spin' : ''}`} />
              <span>Sync Storefront Categories</span>
            </button>
          )}

          {permissions?.canManageCategories && categories.length > 0 && (
            <button
              type="button"
              disabled={saving}
              onClick={() => void handleReconcileCounts()}
              className={`inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-medium bg-white border rounded-lg transition-colors whitespace-nowrap shrink-0 ${
                hasCountMismatch
                  ? 'border-[#F59E0B] text-[#B45309] hover:bg-[#FFFBEB]'
                  : 'border-[#E6ECEF] text-[#334155] hover:bg-[#F8FAFB]'
              }`}
            >
              <CheckCircle2 className="w-3.5 h-3.5" />
              <span>{hasCountMismatch ? 'Sync Product Counts' : 'Counts Verified'}</span>
            </button>
          )}

          {permissions?.canManageCategories && (
            <button
              type="button"
              onClick={() => openCreate('')}
              className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg transition-colors whitespace-nowrap shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Category</span>
            </button>
          )}
        </div>
      </div>

      {/* Missing Official Category Notice */}
      {missingOfficialCount > 0 && permissions?.canManageCategories && (
        <div className="bg-[#FFFBEB] border border-[#FDE68A] rounded-xl p-4 flex flex-col sm:flex-row sm:items-center justify-between gap-3 no-print">
          <div className="text-xs text-[#92400E] leading-relaxed">
            <strong>Storefront Category Sync Needed:</strong> {missingOfficialCount} of the 5 core storefront categories (ঔষধ, হারবাল পণ্য, ভিটামিন ও সাপ্লিমেন্ট, স্বাস্থ্যসামগ্রী, স্কিন কেয়ার) are not yet initialized in Firestore.
          </div>
          <button
            type="button"
            disabled={saving}
            onClick={() => void handleSyncOfficialStorefront()}
            className="px-3.5 py-1.5 text-xs font-semibold text-white bg-[#D97706] hover:bg-[#B45309] rounded-lg whitespace-nowrap shrink-0"
          >
            Initialize Missing Categories
          </button>
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

      {successMsg && (
        <div className="bg-[#F0FDFA] border border-[#99F6E4] rounded-xl p-4 text-sm text-[#0F766E] flex items-center justify-between gap-3 no-print">
          <div className="flex items-center gap-2.5">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{successMsg}</span>
          </div>
          <button
            type="button"
            onClick={() => setSuccessMsg(null)}
            className="text-xs text-[#0F766E] hover:underline whitespace-nowrap shrink-0"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Module Sub-Navigation Tabs */}
      <div className="flex flex-wrap items-center justify-between gap-3 bg-white border border-[#E6ECEF] rounded-xl p-2 no-print">
        <div className="flex flex-wrap items-center gap-1">
          <button
            type="button"
            onClick={() => setActiveTab('categories')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'categories'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F4F7F8]'
            }`}
          >
            <FolderTree className="w-3.5 h-3.5" />
            <span>Categories &amp; সব ক্যাটাগরি</span>
            <span className="font-mono tabular-nums opacity-85">
              ({topLevelCount}+{subCategoryCount})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('brands')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'brands'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F4F7F8]'
            }`}
          >
            <Building2 className="w-3.5 h-3.5" />
            <span>Brands (ব্র্যান্ড ⌄)</span>
            <span className="font-mono tabular-nums opacity-85">
              ({brandRows.filter((b) => b.totalSkus > 0).length})
            </span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('storefront_audit')}
            className={`inline-flex items-center gap-2 px-3.5 py-2 text-xs font-semibold rounded-lg transition-colors whitespace-nowrap shrink-0 ${
              activeTab === 'storefront_audit'
                ? 'bg-[#0D7E74] text-white'
                : 'text-[#475569] hover:text-[#0F172A] hover:bg-[#F4F7F8]'
            }`}
          >
            <LayoutList className="w-3.5 h-3.5" />
            <span>Storefront Menu Check (নেভিগেশন পর্যবেক্ষণ)</span>
          </button>
        </div>

        <div className="px-2 text-xs text-[#64748B] font-mono tabular-nums">
          Navbar Pinned: {featuredSlugsSet.size} / 8 max
        </div>
      </div>

      {/* TAB 1: CATEGORIES & SUBCATEGORIES TABLE */}
      {activeTab === 'categories' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#EEF2F6] flex flex-col md:flex-row md:items-center justify-between gap-3 no-print">
            <div className="relative flex-1 max-w-md">
              <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search category by English, বাংলা নাম, or slug..."
                className="w-full pl-9 pr-3 py-1.5 text-sm border border-[#E6ECEF] rounded-lg"
              />
            </div>

            <div className="flex flex-wrap items-center gap-1 bg-[#F4F7F8] p-1 rounded-lg">
              {(
                [
                  { key: 'all', label: 'All' },
                  { key: 'top_level', label: 'Top-Level' },
                  { key: 'subcategories', label: 'Subcategories' },
                  { key: 'published', label: 'Published' },
                  { key: 'hidden', label: 'Hidden' },
                ] as const
              ).map((item) => (
                <button
                  key={item.key}
                  type="button"
                  onClick={() => setFilterMode(item.key)}
                  className={`px-2.5 py-1 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                    filterMode === item.key
                      ? 'bg-white text-[#0F172A] shadow-xs'
                      : 'text-[#64748B] hover:text-[#0F172A]'
                  }`}
                >
                  {item.label}
                </button>
              ))}
            </div>
          </div>

          {filteredCategories.length === 0 ? (
            <div className="p-12 text-center space-y-3">
              <FolderTree className="w-8 h-8 text-[#64748B] mx-auto" />
              <h2 className="text-base font-semibold text-[#0F172A]">No Matching Categories</h2>
              <p className="text-sm text-[#64748B] max-w-md mx-auto">
                Click &ldquo;Sync Storefront Categories&rdquo; above to initialize ঔষধ, হারবাল পণ্য, ভিটামিন ও সাপ্লিমেন্ট, স্বাস্থ্যসামগ্রী, and স্কিন কেয়ার, or add a custom category.
              </p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-4">Order</th>
                    <th className="py-3 px-4">Category (EN / বাংলা)</th>
                    <th className="py-3 px-4">Slug &amp; Hierarchy</th>
                    <th className="py-3 px-4">Green Navbar Placement</th>
                    <th className="py-3 px-4 text-right">Products</th>
                    <th className="py-3 px-4">Visibility</th>
                    <th className="py-3 px-6 text-right print-hide-col">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {filteredCategories.map((cat, idx) => {
                    const parent = categories.find((p) => p.id === cat.parentCategoryId);
                    const subCount = categories.filter((c) => c.parentCategoryId === cat.id).length;
                    const isPinned =
                      !cat.parentCategoryId &&
                      featuredSlugsSet.has(cat.slug.trim().toLowerCase());
                    const liveCount = liveCountsByCategoryId.get(cat.id) ?? 0;

                    return (
                      <tr key={cat.id} className="hover:bg-[#F7FAF8]">
                        <td className="py-3 px-4 font-mono tabular-nums text-xs text-[#64748B]">
                          <div className="flex items-center gap-1.5">
                            <span className="w-7">#{cat.displayOrder}</span>
                            {permissions?.canManageCategories && (
                              <div className="inline-flex items-center gap-0.5 no-print">
                                <button
                                  type="button"
                                  disabled={idx === 0 || busyActionId === `ord_${cat.id}`}
                                  onClick={() => void handleSwapOrder(idx, -1)}
                                  className="p-1 text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 rounded"
                                  title="Move earlier in menu"
                                >
                                  <ArrowUp className="w-3.5 h-3.5" />
                                </button>
                                <button
                                  type="button"
                                  disabled={
                                    idx === filteredCategories.length - 1 ||
                                    busyActionId === `ord_${cat.id}`
                                  }
                                  onClick={() => void handleSwapOrder(idx, 1)}
                                  className="p-1 text-[#64748B] hover:text-[#0F172A] disabled:opacity-30 rounded"
                                  title="Move later in menu"
                                >
                                  <ArrowDown className="w-3.5 h-3.5" />
                                </button>
                              </div>
                            )}
                          </div>
                        </td>

                        <td className="py-3 px-4">
                          <div className="flex items-center gap-3">
                            {cat.imageUrl ? (
                              <img
                                src={cat.imageUrl}
                                alt={cat.name}
                                referrerPolicy="no-referrer"
                                className="w-9 h-9 rounded-lg object-cover border border-[#E6ECEF] shrink-0 no-print"
                              />
                            ) : (
                              <div className="w-9 h-9 rounded-lg bg-[#F0FDFA] border border-[#CCFBF1] text-[#0D7E74] text-[11px] font-mono font-semibold flex items-center justify-center shrink-0 no-print">
                                {(cat.iconName || 'CAT').slice(0, 3).toUpperCase()}
                              </div>
                            )}
                            <div className="min-w-0">
                              <p className="font-semibold text-[#0F172A]">
                                {cat.nameBn ? `${cat.nameBn} · ${cat.name}` : cat.name}
                              </p>
                              <p className="text-xs text-[#64748B] truncate max-w-xs">
                                {cat.description || 'No category description'}
                              </p>
                            </div>
                          </div>
                        </td>

                        <td className="py-3 px-4 text-xs text-[#64748B]">
                          <div className="font-mono text-[#0F172A]">{cat.slug}</div>
                          {parent ? (
                            <div className="text-[#0D7E74]">
                              Subcategory of {parent.nameBn || parent.name}
                            </div>
                          ) : (
                            <div>
                              Top-Level {subCount > 0 ? `· ${subCount} subcategor${subCount === 1 ? 'y' : 'ies'}` : ''}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-xs">
                          {cat.parentCategoryId ? (
                            <span className="text-[#64748B]">Inside সব ক্যাটাগরি dropdown</span>
                          ) : permissions?.canManageCms ? (
                            <button
                              type="button"
                              disabled={busyActionId === `pin_${cat.id}`}
                              onClick={() => void handleNavbarPinToggle(cat)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors whitespace-nowrap shrink-0 ${
                                isPinned
                                  ? 'bg-[#F0FDFA] border-[#99F6E4] text-[#0F766E]'
                                  : 'bg-white border-[#E6ECEF] text-[#64748B] hover:text-[#0F172A]'
                              }`}
                              title="Toggle visibility directly on the Storefront Green Top Bar"
                            >
                              <Pin className="w-3 h-3" />
                              <span>{isPinned ? 'Pinned in Green Bar' : 'Dropdown Only'}</span>
                            </button>
                          ) : (
                            <span className={isPinned ? 'text-[#0F766E] font-medium' : 'text-[#64748B]'}>
                              {isPinned ? 'Pinned in Green Bar' : 'Dropdown Only'}
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-4 text-right font-mono tabular-nums">
                          <span className="font-semibold text-[#0F172A]">
                            {cat.activeProductCount}
                          </span>
                          {liveCount !== cat.activeProductCount && (
                            <div className="text-[11px] text-[#D97706]">
                              Live: {liveCount}
                            </div>
                          )}
                        </td>

                        <td className="py-3 px-4 text-xs">
                          {permissions?.canManageCategories ? (
                            <button
                              type="button"
                              disabled={busyActionId === cat.id}
                              onClick={() => void handleQuickVisibilityToggle(cat)}
                              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-md border font-medium transition-colors whitespace-nowrap shrink-0 ${
                                cat.publicationStatus === 'published'
                                  ? 'border-[#CCFBF1] bg-[#F0FDFA] text-[#0D7E74]'
                                  : 'border-[#E6ECEF] bg-[#F8FAFB] text-[#64748B]'
                              }`}
                            >
                              {cat.publicationStatus === 'published' ? (
                                <>
                                  <CheckCircle2 className="w-3.5 h-3.5" />
                                  <span>Published</span>
                                </>
                              ) : (
                                <>
                                  <EyeOff className="w-3.5 h-3.5" />
                                  <span>Hidden</span>
                                </>
                              )}
                            </button>
                          ) : cat.publicationStatus === 'published' ? (
                            <span className="inline-flex items-center gap-1.5 text-[#0D7E74] font-medium">
                              <CheckCircle2 className="w-3.5 h-3.5" />
                              Published
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1.5 text-[#64748B] font-medium">
                              <EyeOff className="w-3.5 h-3.5" />
                              Hidden
                            </span>
                          )}
                        </td>

                        <td className="py-3 px-6 text-right print-hide-col">
                          <div className="inline-flex items-center gap-1.5">
                            {!cat.parentCategoryId && permissions?.canManageCategories && (
                              <button
                                type="button"
                                onClick={() => openCreate(cat.id)}
                                className="px-2 py-1 text-xs font-medium text-[#0D7E74] border border-[#CCFBF1] hover:bg-[#F0FDFA] rounded-md whitespace-nowrap shrink-0"
                                title={`Add Subcategory under ${cat.name}`}
                              >
                                + Sub
                              </button>
                            )}
                            {permissions?.canManageCategories && (
                              <button
                                type="button"
                                onClick={() => openEdit(cat)}
                                className="p-1.5 text-[#0D7E74] hover:bg-[#EEF4F0] rounded-md"
                                title="Edit Category"
                              >
                                <Edit3 className="w-4 h-4" />
                              </button>
                            )}
                            {permissions?.canEditPricing && (
                              <button
                                type="button"
                                disabled={cat.activeProductCount > 0}
                                onClick={() => setConfirmDelete(cat)}
                                className="p-1.5 text-[#991B1B] disabled:opacity-30 hover:bg-[#FEF2F2] rounded-md"
                                title={
                                  cat.activeProductCount > 0
                                    ? 'Cannot delete category containing active products'
                                    : 'Delete Empty Category'
                                }
                              >
                                <Trash2 className="w-4 h-4" />
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
        </div>
      )}

      {/* TAB 2: BRANDS / MANUFACTURERS (ব্র্যান্ড ⌄) */}
      {activeTab === 'brands' && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
          <div className="p-4 border-b border-[#EEF2F6] flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Storefront Brand Directory (ব্র্যান্ড ⌄)
              </h2>
              <p className="text-xs text-[#64748B]">
                Every product manufacturer automatically populates the Customer Storefront &ldquo;ব্র্যান্ড ⌄&rdquo; filter. Standardize brand names or toggle brand-wide publication here.
              </p>
            </div>

            <div className="flex flex-wrap items-center gap-3 no-print">
              <label className="inline-flex items-center gap-2 text-xs text-[#475569] cursor-pointer">
                <input
                  type="checkbox"
                  checked={showUnstockedBrands}
                  onChange={(e) => setShowUnstockedBrands(e.target.checked)}
                />
                <span>Show Reference Pharma Brands</span>
              </label>

              <div className="relative w-64">
                <Search className="w-4 h-4 text-[#64748B] absolute left-3 top-2.5" />
                <input
                  type="text"
                  value={brandSearch}
                  onChange={(e) => setBrandSearch(e.target.value)}
                  placeholder="Search brand / company..."
                  className="w-full pl-9 pr-3 py-1.5 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>
            </div>
          </div>

          {brandRows.length === 0 ? (
            <div className="p-10 text-center space-y-3">
              <Building2 className="w-8 h-8 text-[#64748B] mx-auto" />
              <h3 className="text-sm font-semibold text-[#0F172A]">
                No Active Brands in Catalog Yet
              </h3>
              <p className="text-xs text-[#64748B] max-w-md mx-auto">
                Add products with a Manufacturer / Brand name in Medicine Catalog (or check &ldquo;Show Reference Pharma Brands&rdquo; above) to populate the ব্র্যান্ড dropdown.
              </p>
              {onNavigate && (
                <button
                  type="button"
                  onClick={() => onNavigate('products')}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg whitespace-nowrap shrink-0 no-print"
                >
                  Open Medicine Catalog
                </button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-6">Brand / Manufacturer Name</th>
                    <th className="py-3 px-4">Assigned Categories</th>
                    <th className="py-3 px-4 text-right">Published / Total SKUs</th>
                    <th className="py-3 px-4 text-right">Sellable Units</th>
                    <th className="py-3 px-6 text-right print-hide-col">Brand Controls</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6] text-sm">
                  {brandRows.map((row) => (
                    <tr key={row.manufacturer} className="hover:bg-[#F7FAF8]">
                      <td className="py-3.5 px-6 font-semibold text-[#0F172A]">
                        {row.manufacturer}
                      </td>
                      <td className="py-3.5 px-4 text-xs text-[#64748B]">
                        {row.categoriesSet.size > 0
                          ? Array.from(row.categoriesSet).join(', ')
                          : 'No products assigned yet'}
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs">
                        <span className="font-semibold text-[#0F172A]">{row.publishedSkus}</span>
                        <span className="text-[#64748B]"> / {row.totalSkus}</span>
                      </td>
                      <td className="py-3.5 px-4 text-right font-mono tabular-nums font-semibold text-[#0F172A]">
                        {row.totalUnits.toLocaleString('en-BD')}
                      </td>
                      <td className="py-3.5 px-6 text-right print-hide-col">
                        <div className="inline-flex items-center gap-2">
                          {row.totalSkus > 0 && permissions?.canEditPricing && (
                            <>
                              <button
                                type="button"
                                onClick={() => {
                                  setRenamingBrand(row.manufacturer);
                                  setNewBrandName(row.manufacturer);
                                }}
                                className="px-2.5 py-1 text-xs font-medium text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F4F7F8] rounded-md whitespace-nowrap shrink-0"
                              >
                                Rename
                              </button>
                              <button
                                type="button"
                                disabled={busyActionId === `brand_${row.manufacturer}`}
                                onClick={() =>
                                  void handleBrandBulkPublish(
                                    row.manufacturer,
                                    row.publishedSkus === row.totalSkus ? 'draft' : 'published'
                                  )
                                }
                                className="px-2.5 py-1 text-xs font-medium text-[#0D7E74] bg-white border border-[#CCFBF1] hover:bg-[#F0FDFA] rounded-md whitespace-nowrap shrink-0"
                              >
                                {row.publishedSkus === row.totalSkus ? 'Hide All' : 'Publish All'}
                              </button>
                            </>
                          )}
                          {onNavigate && (
                            <button
                              type="button"
                              onClick={() => onNavigate('products')}
                              className="px-2.5 py-1 text-xs font-medium text-[#475569] hover:text-[#0F172A] whitespace-nowrap shrink-0"
                            >
                              Catalog →
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
      )}

      {/* TAB 3: STOREFRONT NAVIGATION & SECTION ALIGNMENT CHECK (IMAGE 2 VERIFICATION) */}
      {activeTab === 'storefront_audit' && (
        <div className="space-y-5">
          {/* Live Storefront Bar Visual Replica */}
          <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-5 py-2.5 bg-[#064E3B] text-white text-xs flex flex-wrap items-center justify-between gap-2">
              <span>
                {siteSettings?.promoBannerText ||
                  'সারা বাংলাদেশে হোম ডেলিভারি · নিবন্ধিত সরবরাহকারী থেকে সংগৃহীত পণ্য'}
              </span>
              <span className="font-mono">
                {siteSettings?.supportPhone || '+880 1700-000000'}
              </span>
            </div>

            <div className="px-5 py-3 bg-[#0D6E52] text-white text-xs flex flex-wrap items-center gap-3">
              <span className="px-2.5 py-1 bg-[#064E3B] rounded font-semibold">
                ☰ সব ক্যাটাগরি ⌄ ({categories.filter((c) => c.publicationStatus === 'published').length})
              </span>
              <span>হোম</span>
              {OFFICIAL_STOREFRONT_CATEGORIES.map((preset) => {
                const matched = categories.find((c) =>
                  preset.aliases.includes(c.slug.trim().toLowerCase())
                );
                return (
                  <span
                    key={preset.slug}
                    className={
                      matched && matched.publicationStatus === 'published'
                        ? 'font-medium text-white'
                        : 'text-white/50 line-through'
                    }
                  >
                    {matched?.nameBn || preset.nameBn}
                  </span>
                );
              })}
              <span>ব্র্যান্ড ⌄ ({brandRows.filter((b) => b.publishedSkus > 0).length})</span>
              <span>অফার ({offerProductsCount})</span>
              <span>আমাদের সম্পর্কে</span>
              <span>যোগাযোগ</span>
              <span className="ml-auto font-medium">অর্ডার ট্র্যাকিং</span>
            </div>

            <div className="p-5 bg-[#F8FAFB] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div>
                <div className="text-sm font-bold text-[#0F172A]">
                  {siteSettings?.heroTitle || 'চলমান ফার্মেসি অফার ও ফ্রি ডেলিভারি'}
                </div>
                <p className="text-xs text-[#64748B] mt-0.5">
                  {siteSettings?.heroSubtitle ||
                    '৳1500+ অর্ডারে সারা বাংলাদেশে ডেলিভারি চার্জ সম্পূর্ণ ফ্রি! এছাড়া চেকআউটে অনুমোদিত কুপন কোড ব্যবহার করুন।'}
                </p>
              </div>
              <div className="text-xs font-mono text-[#0D7E74] bg-white border border-[#CCFBF1] px-3 py-1.5 rounded-lg shrink-0">
                {siteSettings?.heroCtaText || 'কুপন উদাহরণ: HEALTH50 · CARE10'}
              </div>
            </div>
          </div>

          {/* Detailed Control Matrix for Every Storefront Navigation Item */}
          <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6]">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Storefront Navigation &amp; Category Control Matrix
              </h2>
              <p className="text-xs text-[#64748B]">
                Live status of every category and menu item displayed on the Customer Storefront, with direct management links.
              </p>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-sm">
                <thead>
                  <tr className="border-b border-[#EEF2F6] bg-[#F9FBFA] text-xs font-medium text-[#64748B]">
                    <th className="py-3 px-6">Storefront Menu Item</th>
                    <th className="py-3 px-4">Firestore Data Source</th>
                    <th className="py-3 px-4">Live Status</th>
                    <th className="py-3 px-6 text-right">Manage Control</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[#EEF2F6]">
                  {OFFICIAL_STOREFRONT_CATEGORIES.map((preset) => {
                    const matched = categories.find((c) =>
                      preset.aliases.includes(c.slug.trim().toLowerCase())
                    );
                    const liveCount = matched ? liveCountsByCategoryId.get(matched.id) ?? 0 : 0;

                    return (
                      <tr key={preset.slug} className="hover:bg-[#F7FAF8]">
                        <td className="py-3 px-6">
                          <span className="font-semibold text-[#0F172A]">{preset.nameBn}</span>
                          <span className="text-xs text-[#64748B]"> ({preset.name})</span>
                        </td>
                        <td className="py-3 px-4 text-xs font-mono text-[#475569]">
                          /categories/{matched?.id || `cat_${preset.slug}`}
                        </td>
                        <td className="py-3 px-4 text-xs">
                          {matched ? (
                            <span className="text-[#0D7E74] font-medium font-mono tabular-nums">
                              {matched.publicationStatus === 'published' ? 'Published' : 'Hidden'} ·{' '}
                              {liveCount} product(s)
                            </span>
                          ) : (
                            <span className="text-[#D97706] font-medium">
                              Not Initialized Yet
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-6 text-right">
                          {matched ? (
                            <button
                              type="button"
                              onClick={() => openEdit(matched)}
                              className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                            >
                              Edit Category
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          ) : (
                            <button
                              type="button"
                              disabled={saving}
                              onClick={() => void handleSyncOfficialStorefront()}
                              className="inline-flex items-center gap-1 text-xs font-semibold text-[#D97706] hover:underline whitespace-nowrap shrink-0"
                            >
                              Initialize Now
                              <ArrowRight className="w-3.5 h-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}

                  <tr className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <span className="font-semibold text-[#0F172A]">ব্র্যান্ড ⌄</span>
                      <span className="text-xs text-[#64748B]"> (Pharmaceutical Brands)</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#475569]">
                      /products (manufacturer)
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-[#0F172A]">
                      {brandRows.filter((b) => b.publishedSkus > 0).length} active brand(s)
                    </td>
                    <td className="py-3 px-6 text-right">
                      <button
                        type="button"
                        onClick={() => setActiveTab('brands')}
                        className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                      >
                        Manage Brands
                        <ArrowRight className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>

                  <tr className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <span className="font-semibold text-[#0F172A]">অফার &amp; কুপন</span>
                      <span className="text-xs text-[#64748B]"> (Offers &amp; HEALTH50 / CARE10)</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#475569]">
                      /products + /coupons
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-[#0F172A]">
                      {offerProductsCount} offer item(s) · {activeCoupons.length} active coupon(s)
                    </td>
                    <td className="py-3 px-6 text-right">
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('promotions_cms')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                        >
                          Manage Offers &amp; Coupons
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>

                  <tr className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <span className="font-semibold text-[#0F172A]">
                        ফ্রি ডেলিভারি &amp; নিরাপদ পেমেন্ট
                      </span>
                      <span className="text-xs text-[#64748B]"> (৳1500+ Free Delivery &amp; COD/bKash/Nagad)</span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#475569]">
                      /deliveryZones + /siteSettings
                    </td>
                    <td className="py-3 px-4 text-xs font-mono tabular-nums text-[#0F172A]">
                      {deliveryZones.filter((z) => z.status === 'active').length} active zone(s) ·{' '}
                      {(siteSettings?.enabledPaymentMethods || ['cod', 'bkash', 'nagad']).join(', ').toUpperCase()}
                    </td>
                    <td className="py-3 px-6 text-right">
                      {onNavigate && (
                        <button
                          type="button"
                          onClick={() => onNavigate('payments_delivery')}
                          className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                        >
                          Payments &amp; Delivery
                          <ArrowRight className="w-3.5 h-3.5" />
                        </button>
                      )}
                    </td>
                  </tr>

                  <tr className="hover:bg-[#F7FAF8]">
                    <td className="py-3 px-6">
                      <span className="font-semibold text-[#0F172A]">
                        আমাদের সম্পর্কে · যোগাযোগ · অর্ডার ট্র্যাকিং
                      </span>
                    </td>
                    <td className="py-3 px-4 text-xs font-mono text-[#475569]">
                      /siteSettings/storefront_config + /orders
                    </td>
                    <td className="py-3 px-4 text-xs text-[#0D7E74] font-medium">
                      {siteSettings ? 'Configured & Live' : 'Using Default Template'}
                    </td>
                    <td className="py-3 px-6 text-right">
                      {onNavigate && (
                        <div className="inline-flex items-center gap-3">
                          <button
                            type="button"
                            onClick={() => onNavigate('promotions_cms')}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#0D7E74] hover:underline whitespace-nowrap shrink-0"
                          >
                            Edit CMS Pages
                          </button>
                          <button
                            type="button"
                            onClick={() => onNavigate('orders')}
                            className="inline-flex items-center gap-1 text-xs font-medium text-[#475569] hover:text-[#0F172A] whitespace-nowrap shrink-0"
                          >
                            Orders →
                          </button>
                        </div>
                      )}
                    </td>
                  </tr>
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Create / Edit Category Modal */}
      {modalOpen && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-xl w-full max-h-[92vh] overflow-y-auto p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-3">
              <h2 className="text-lg font-bold text-[#0F172A]">
                {editing ? `Edit Category: ${editing.name}` : 'Create Storefront Category'}
              </h2>
              <button
                type="button"
                onClick={() => setModalOpen(false)}
                className="p-1 text-[#64748B] hover:text-[#0F172A]"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Quick Official Category / Subcategory Presets */}
            {!editing && !parentCategoryId && (
              <div className="bg-[#F8FAFB] border border-[#EEF2F6] rounded-lg p-3 space-y-2">
                <div className="text-xs font-medium text-[#475569]">
                  Quick Fill Official Storefront Category:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {OFFICIAL_STOREFRONT_CATEGORIES.map((preset) => (
                    <button
                      key={preset.slug}
                      type="button"
                      onClick={() => {
                        setName(preset.name);
                        setNameBn(preset.nameBn);
                        setSlug(preset.slug);
                        setDescription(preset.desc);
                        setIconName(preset.iconName);
                        setDisplayOrder(preset.order);
                      }}
                      className="px-2.5 py-1 text-xs font-medium bg-white border border-[#E6ECEF] hover:border-[#0D7E74] text-[#0F172A] rounded-md transition-colors"
                    >
                      {preset.nameBn} ({preset.name})
                    </button>
                  ))}
                </div>
              </div>
            )}

            {!editing && selectedParentPreset && (
              <div className="bg-[#F8FAFB] border border-[#EEF2F6] rounded-lg p-3 space-y-2">
                <div className="text-xs font-medium text-[#475569]">
                  Suggested Subcategories for {selectedParentPreset.nameBn}:
                </div>
                <div className="flex flex-wrap gap-1.5">
                  {selectedParentPreset.suggestedSubcategories.map((sub) => (
                    <button
                      key={sub.slug}
                      type="button"
                      onClick={() => {
                        setName(sub.name);
                        setNameBn(sub.nameBn);
                        setSlug(sub.slug);
                      }}
                      className="px-2.5 py-1 text-xs font-medium bg-white border border-[#E6ECEF] hover:border-[#0D7E74] text-[#0F172A] rounded-md transition-colors"
                    >
                      {sub.nameBn} ({sub.name})
                    </button>
                  ))}
                </div>
              </div>
            )}

            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setSaving(true);
                setErrorMsg(null);
                try {
                  await saveCategory(
                    actor,
                    {
                      id: editing?.id,
                      name,
                      nameBn,
                      slug,
                      description,
                      iconName,
                      imageUrl,
                      parentCategoryId,
                      displayOrder,
                      publicationStatus,
                      activeProductCount: editing?.activeProductCount || 0,
                    },
                    products
                  );
                  setModalOpen(false);
                  setSuccessMsg(
                    editing
                      ? `Updated category "${name}" (${nameBn || slug}).`
                      : `Created category "${name}" (${nameBn || slug}).`
                  );
                } catch (err) {
                  setErrorMsg(err instanceof Error ? err.message : 'Failed to save category.');
                } finally {
                  setSaving(false);
                }
              }}
              className="space-y-4"
            >
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    English Name *
                  </label>
                  <input
                    type="text"
                    required
                    maxLength={100}
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="e.g., Medicine"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Bengali Label (বাংলা নাম) *
                  </label>
                  <input
                    type="text"
                    maxLength={120}
                    value={nameBn}
                    onChange={(e) => setNameBn(e.target.value)}
                    placeholder="e.g., ঔষধ"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Stable URL Slug
                  </label>
                  <input
                    type="text"
                    maxLength={100}
                    value={slug}
                    onChange={(e) => setSlug(e.target.value)}
                    placeholder="auto-generated if blank"
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Hierarchy Level (Parent Category)
                  </label>
                  <select
                    value={parentCategoryId}
                    onChange={(e) => setParentCategoryId(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="">Top-Level Primary Category</option>
                    {categories
                      .filter((c) => c.id !== editing?.id && !c.parentCategoryId)
                      .map((c) => (
                        <option key={c.id} value={c.id}>
                          Subcategory under: {c.nameBn ? `${c.nameBn} (${c.name})` : c.name}
                        </option>
                      ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Category Banner / Thumbnail Image (Optional)
                </label>
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    type="text"
                    maxLength={500}
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    placeholder="https://... or upload image"
                    className="flex-1 min-w-[200px] px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg"
                  />
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0D7E74] border border-[#0D7E74] rounded-lg cursor-pointer hover:bg-[#F0FDFA] whitespace-nowrap shrink-0">
                    <Upload className="w-3.5 h-3.5" />
                    <span>{uploadingImg ? 'Uploading...' : 'Upload'}</span>
                    <input
                      type="file"
                      accept="image/jpeg,image/png,image/webp"
                      className="hidden"
                      disabled={uploadingImg}
                      onChange={async (e) => {
                        const file = e.target.files?.[0];
                        if (!file) return;
                        setUploadingImg(true);
                        setErrorMsg(null);
                        try {
                          const url = await uploadCatalogAsset('catalog/categories', file);
                          setImageUrl(url);
                        } catch (err) {
                          setErrorMsg(
                            err instanceof Error ? err.message : 'Category image upload failed.'
                          );
                        } finally {
                          setUploadingImg(false);
                        }
                      }}
                    />
                  </label>
                </div>
              </div>

              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  Description
                </label>
                <textarea
                  rows={2}
                  maxLength={500}
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Healthcare Icon
                  </label>
                  <select
                    value={iconName}
                    onChange={(e) => setIconName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    {ICON_OPTIONS.map((ic) => (
                      <option key={ic} value={ic}>
                        {ic}
                      </option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Display Order
                  </label>
                  <input
                    type="number"
                    min={0}
                    max={999}
                    value={displayOrder}
                    onChange={(e) => setDisplayOrder(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[#0F172A] mb-1">
                    Storefront Visibility
                  </label>
                  <select
                    value={publicationStatus}
                    onChange={(e) =>
                      setPublicationStatus(e.target.value as 'published' | 'hidden')
                    }
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="published">Published</option>
                    <option value="hidden">Hidden</option>
                  </select>
                </div>
              </div>

              <div className="flex justify-end gap-3 pt-3 border-t border-[#EEF2F6]">
                <button
                  type="button"
                  onClick={() => setModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-5 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-60 rounded-lg whitespace-nowrap shrink-0"
                >
                  {saving ? 'Saving...' : 'Save Category'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Brand Rename / Standardization Modal */}
      {renamingBrand && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full p-6 space-y-4">
            <div className="flex items-center justify-between border-b border-[#EEF2F6] pb-3">
              <h3 className="text-base font-bold text-[#0F172A]">
                Standardize Brand Name (ব্র্যান্ড)
              </h3>
              <button
                type="button"
                onClick={() => setRenamingBrand(null)}
                className="p-1 text-[#64748B]"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleRenameBrandSubmit} className="space-y-4">
              <p className="text-xs text-[#64748B]">
                Updating <strong className="text-[#0F172A]">{renamingBrand}</strong> will synchronize the manufacturer label across all matching products in the storefront ব্র্যান্ড filter.
              </p>
              <div>
                <label className="block text-xs font-medium text-[#0F172A] mb-1">
                  New Manufacturer / Brand Label *
                </label>
                <input
                  type="text"
                  required
                  maxLength={120}
                  list="verified-brand-rename-list"
                  value={newBrandName}
                  onChange={(e) => setNewBrandName(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
                <datalist id="verified-brand-rename-list">
                  {VERIFIED_PHARMA_BRANDS.map((b) => (
                    <option key={b} value={b} />
                  ))}
                </datalist>
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button
                  type="button"
                  onClick={() => setRenamingBrand(null)}
                  className="px-4 py-2 text-xs font-medium text-[#64748B]"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="px-4 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg"
                >
                  {saving ? 'Updating...' : 'Apply Brand Name'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Safe Deletion Confirmation Dialog */}
      {confirmDelete && actor && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-md w-full p-6 space-y-4">
            <h3 className="text-base font-bold text-[#0F172A]">
              Delete Category &ldquo;{confirmDelete.name}&rdquo;?
            </h3>
            <p className="text-sm text-[#64748B]">
              This category currently has 0 active products assigned and can be safely removed from the shared catalog.
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setConfirmDelete(null)}
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
                    await deleteCategorySafely(actor, confirmDelete);
                    setConfirmDelete(null);
                  } catch (err) {
                    setErrorMsg(err instanceof Error ? err.message : 'Delete failed.');
                    setConfirmDelete(null);
                  } finally {
                    setSaving(false);
                  }
                }}
                className="px-4 py-2 text-sm font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg whitespace-nowrap shrink-0"
              >
                Confirm Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
