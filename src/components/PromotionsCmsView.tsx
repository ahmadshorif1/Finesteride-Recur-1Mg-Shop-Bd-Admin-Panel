import React, { useEffect, useMemo, useState } from 'react';
import {
  AlertCircle,
  Calculator,
  CheckCircle2,
  Edit3,
  Globe,
  Percent,
  Plus,
  RefreshCw,
  Tag,
  Trash2,
  Upload,
  X,
} from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useStoreData } from '../context/StoreDataContext';
import { formatBdt } from '../lib/validation';
import {
  buildDefaultStorefrontSettingsPayload,
  calculateDiscountViaBackend,
  deleteCouponRecord,
  ensureDefaultStorefrontCoupons,
  saveCouponRecord,
  saveProduct,
  saveSiteSettingsConfig,
  uploadCatalogAsset,
} from '../services/pharmacyService';
import type { Coupon, PaymentMethod, Product } from '../types/pharmacy';

const DEFAULT_HERO_BANNER =
  '/assets/aistudio/867081142_122283788462156715_1316202229849569188_n_60369be3.jpg';

const STANDARD_NAV_LINKS = [
  'হোম|/',
  'ব্র্যান্ড|/brands',
  'অফার|/offers',
  'আমাদের সম্পর্কে|/about',
  'যোগাযোগ|/contact',
  'অর্ডার ট্র্যাকিং|/track-order',
];

export function PromotionsCmsView() {
  const { permissions } = useAuth();
  const { actor, coupons, categories, products, siteSettings } = useStoreData();

  const [tab, setTab] = useState<'coupons' | 'offers' | 'cms'>('coupons');
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [successMsg, setSuccessMsg] = useState<string | null>(null);

  // Coupon Modal State
  const [couponModalOpen, setCouponModalOpen] = useState(false);
  const [editingCoupon, setEditingCoupon] = useState<Coupon | null>(null);
  const [code, setCode] = useState('');
  const [couponDesc, setCouponDesc] = useState('');
  const [discountType, setDiscountType] = useState<'percentage' | 'fixed_bdt'>('percentage');
  const [discountValue, setDiscountValue] = useState(10);
  const [minOrderAmountBdt, setMinOrderAmountBdt] = useState(500);
  const [maxDiscountBdt, setMaxDiscountBdt] = useState(250);
  const [startDate, setStartDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [endDate, setEndDate] = useState(() => {
    const d = new Date();
    d.setDate(d.getDate() + 60);
    return d.toISOString().slice(0, 10);
  });
  const [usageLimit, setUsageLimit] = useState(200);
  const [applicableCategory, setApplicableCategory] = useState('all');
  const [couponStatus, setCouponStatus] = useState<'active' | 'inactive'>('active');
  const [savingCoupon, setSavingCoupon] = useState(false);
  const [confirmDeleteCouponId, setConfirmDeleteCouponId] = useState<string | null>(null);

  // Quick Offer Product Editor State
  const [selectedOfferProdId, setSelectedOfferProdId] = useState('');
  const [offerSellingPrice, setOfferSellingPrice] = useState(0);
  const [offerPreviousPrice, setOfferPreviousPrice] = useState(0);
  const [offerFeatured, setOfferFeatured] = useState(true);
  const [savingOffer, setSavingOffer] = useState(false);

  // Backend Discount Tester State
  const [testCouponId, setTestCouponId] = useState('');
  const [testSubtotal, setTestSubtotal] = useState(1200);
  const [testDeliveryFee, setTestDeliveryFee] = useState(60);
  const [testCategory, setTestCategory] = useState('all');
  const [testResult, setTestResult] = useState<{
    subtotalBdt: number;
    discountBdt: number;
    deliveryFeeBdt: number;
    totalAmountBdt: number;
  } | null>(null);
  const [testingCalc, setTestingCalc] = useState(false);

  // CMS Form State initialized from storefront defaults matching Image 2
  const initialDefaults = useMemo(() => buildDefaultStorefrontSettingsPayload(siteSettings), [siteSettings]);

  const [siteName, setSiteName] = useState(initialDefaults.siteName);
  const [tagline, setTagline] = useState(initialDefaults.tagline);
  const [taglineBn, setTaglineBn] = useState(initialDefaults.taglineBn);
  const [logoUrl, setLogoUrl] = useState(initialDefaults.logoUrl);
  const [faviconUrl, setFaviconUrl] = useState(initialDefaults.faviconUrl);
  const [heroTitle, setHeroTitle] = useState(initialDefaults.heroTitle);
  const [heroSubtitle, setHeroSubtitle] = useState(initialDefaults.heroSubtitle);
  const [heroBannerUrl, setHeroBannerUrl] = useState(initialDefaults.heroBannerUrl || DEFAULT_HERO_BANNER);
  const [heroCtaText, setHeroCtaText] = useState(initialDefaults.heroCtaText);
  const [promoBannerText, setPromoBannerText] = useState(initialDefaults.promoBannerText);
  const [featuredSlugsInput, setFeaturedSlugsInput] = useState(
    (initialDefaults.featuredCategorySlugs || []).join(', ')
  );
  const [sectionOrderInput, setSectionOrderInput] = useState(
    (initialDefaults.homepageSectionOrder || []).join(', ')
  );
  const [navLinksInput, setNavLinksInput] = useState(
    (initialDefaults.navigationLinks || STANDARD_NAV_LINKS).join('\n')
  );
  const [supportPhone, setSupportPhone] = useState(initialDefaults.supportPhone);
  const [supportEmail, setSupportEmail] = useState(initialDefaults.supportEmail);
  const [supportHours, setSupportHours] = useState(initialDefaults.supportHours);
  const [pharmacyLicenseNo, setPharmacyLicenseNo] = useState(initialDefaults.pharmacyLicenseNo);
  const [deliveryInfoPolicy, setDeliveryInfoPolicy] = useState(initialDefaults.deliveryInfoPolicy);
  const [paymentInfoPolicy, setPaymentInfoPolicy] = useState(initialDefaults.paymentInfoPolicy);
  const [enabledPaymentMethods, setEnabledPaymentMethods] = useState<string[]>(
    initialDefaults.enabledPaymentMethods || ['cod', 'bkash', 'nagad']
  );
  const [faqContent, setFaqContent] = useState(initialDefaults.faqContent);
  const [termsAndConditions, setTermsAndConditions] = useState(initialDefaults.termsAndConditions);
  const [privacyPolicy, setPrivacyPolicy] = useState(initialDefaults.privacyPolicy);
  const [returnRefundPolicy, setReturnRefundPolicy] = useState(initialDefaults.returnRefundPolicy);
  const [savingCms, setSavingCms] = useState(false);
  const [uploadingAsset, setUploadingAsset] = useState<'logo' | 'hero' | null>(null);

  useEffect(() => {
    const next = buildDefaultStorefrontSettingsPayload(siteSettings);
    setSiteName(next.siteName);
    setTagline(next.tagline);
    setTaglineBn(next.taglineBn);
    setLogoUrl(next.logoUrl);
    setFaviconUrl(next.faviconUrl);
    setHeroTitle(next.heroTitle);
    setHeroSubtitle(next.heroSubtitle);
    setHeroBannerUrl(next.heroBannerUrl || DEFAULT_HERO_BANNER);
    setHeroCtaText(next.heroCtaText);
    setPromoBannerText(next.promoBannerText);
    setFeaturedSlugsInput((next.featuredCategorySlugs || []).join(', '));
    setSectionOrderInput((next.homepageSectionOrder || []).join(', '));
    setNavLinksInput((next.navigationLinks || STANDARD_NAV_LINKS).join('\n'));
    setSupportPhone(next.supportPhone);
    setSupportEmail(next.supportEmail);
    setSupportHours(next.supportHours);
    setPharmacyLicenseNo(next.pharmacyLicenseNo);
    setDeliveryInfoPolicy(next.deliveryInfoPolicy);
    setPaymentInfoPolicy(next.paymentInfoPolicy);
    setEnabledPaymentMethods(next.enabledPaymentMethods || ['cod', 'bkash', 'nagad']);
    setFaqContent(next.faqContent);
    setTermsAndConditions(next.termsAndConditions);
    setPrivacyPolicy(next.privacyPolicy);
    setReturnRefundPolicy(next.returnRefundPolicy);
  }, [siteSettings]);

  const missingDefaultCoupons = useMemo(() => {
    const existing = new Set(coupons.map((c) => c.code.trim().toUpperCase()));
    return !existing.has('HEALTH50') || !existing.has('CARE10');
  }, [coupons]);

  const offerProducts = useMemo(() => {
    return products.filter(
      (p) =>
        p.publicationStatus !== 'archived' &&
        ((p.previousPrice > 0 && p.previousPrice > p.sellingPrice) || p.featured)
    );
  }, [products]);

  const parsedFeaturedSlugs = useMemo(() => {
    return featuredSlugsInput
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean);
  }, [featuredSlugsInput]);

  const toggleFeaturedSlugCheckbox = (slug: string) => {
    const exists = parsedFeaturedSlugs.includes(slug);
    let next: string[];
    if (exists) {
      next = parsedFeaturedSlugs.filter((s) => s !== slug);
    } else {
      if (parsedFeaturedSlugs.length >= 8) {
        setErrorMsg('Maximum 8 category slugs can be pinned to the top navigation bar.');
        return;
      }
      next = [...parsedFeaturedSlugs, slug];
    }
    setFeaturedSlugsInput(next.join(', '));
  };

  const openCreateCoupon = () => {
    setErrorMsg(null);
    setEditingCoupon(null);
    setCode('');
    setCouponDesc('');
    setDiscountType('percentage');
    setDiscountValue(10);
    setMinOrderAmountBdt(500);
    setMaxDiscountBdt(250);
    setStartDate(new Date().toISOString().slice(0, 10));
    const end = new Date();
    end.setDate(end.getDate() + 60);
    setEndDate(end.toISOString().slice(0, 10));
    setUsageLimit(200);
    setApplicableCategory('all');
    setCouponStatus('active');
    setCouponModalOpen(true);
  };

  const openEditCoupon = (c: Coupon) => {
    setErrorMsg(null);
    setEditingCoupon(c);
    setCode(c.code);
    setCouponDesc(c.description);
    setDiscountType(c.discountType);
    setDiscountValue(c.discountValue);
    setMinOrderAmountBdt(c.minOrderAmountBdt);
    setMaxDiscountBdt(c.maxDiscountBdt);
    setStartDate(c.startDate);
    setEndDate(c.endDate);
    setUsageLimit(c.usageLimit);
    setApplicableCategory(c.applicableCategory || 'all');
    setCouponStatus(c.status);
    setCouponModalOpen(true);
  };

  const handleSyncDefaultCoupons = async () => {
    if (!actor || !permissions?.canManageCoupons) return;
    setSavingCoupon(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      const created = await ensureDefaultStorefrontCoupons(actor, coupons);
      setSuccessMsg(
        created > 0
          ? `Initialized ${created} storefront banner coupon(s) (HEALTH50 / CARE10).`
          : 'HEALTH50 and CARE10 coupons are already active.'
      );
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to initialize default coupons.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleSaveCoupon = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canManageCoupons) return;
    if (!code.trim() || !couponDesc.trim()) {
      setErrorMsg('Coupon code and promotional description are required.');
      return;
    }
    setSavingCoupon(true);
    setErrorMsg(null);
    try {
      await saveCouponRecord(actor, {
        id: editingCoupon?.id,
        code,
        description: couponDesc,
        discountType,
        discountValue,
        minOrderAmountBdt,
        maxDiscountBdt,
        startDate,
        endDate,
        usageLimit,
        usedCount: editingCoupon?.usedCount || 0,
        applicableCategory,
        status: couponStatus,
      });
      setCouponModalOpen(false);
      setSuccessMsg(`Saved coupon ${code.toUpperCase()}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save coupon.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleToggleCouponStatus = async (c: Coupon) => {
    if (!actor || !permissions?.canManageCoupons) return;
    setSavingCoupon(true);
    setErrorMsg(null);
    try {
      const nextStatus = c.status === 'active' ? 'inactive' : 'active';
      await saveCouponRecord(actor, {
        id: c.id,
        code: c.code,
        description: c.description,
        discountType: c.discountType,
        discountValue: c.discountValue,
        minOrderAmountBdt: c.minOrderAmountBdt,
        maxDiscountBdt: c.maxDiscountBdt,
        startDate: c.startDate,
        endDate: c.endDate,
        usageLimit: c.usageLimit,
        usedCount: c.usedCount,
        applicableCategory: c.applicableCategory,
        status: nextStatus,
      });
      setSuccessMsg(`Coupon ${c.code} marked ${nextStatus}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to toggle coupon status.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const handleDeleteCoupon = async (c: Coupon) => {
    if (!actor || !permissions?.canManageCoupons) return;
    setSavingCoupon(true);
    setErrorMsg(null);
    try {
      await deleteCouponRecord(actor, c);
      setConfirmDeleteCouponId(null);
      setSuccessMsg(`Deleted coupon ${c.code}.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to delete coupon.');
    } finally {
      setSavingCoupon(false);
    }
  };

  const toggleCmsPaymentMethod = (method: PaymentMethod) => {
    const exists = enabledPaymentMethods.includes(method);
    const next = exists
      ? enabledPaymentMethods.filter((m) => m !== method)
      : [...enabledPaymentMethods, method];
    if (next.length === 0) {
      setErrorMsg('At least one storefront payment method must remain enabled.');
      return;
    }
    setErrorMsg(null);
    setEnabledPaymentMethods(next);
  };

  const handleApplyProductOffer = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canEditPricing) return;
    const target = products.find((p) => p.id === selectedOfferProdId);
    if (!target) {
      setErrorMsg('Select a product from the catalog first.');
      return;
    }
    setSavingOffer(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await saveProduct(
        actor,
        {
          id: target.id,
          name: target.name,
          slug: target.slug,
          genericName: target.genericName,
          manufacturer: target.manufacturer,
          categoryId: target.categoryId,
          categoryName: target.categoryName,
          subcategory: target.subcategory,
          description: target.description,
          images: target.images,
          unitSize: target.unitSize,
          sellingPrice: offerSellingPrice,
          previousPrice: offerPreviousPrice,
          stockQuantity: target.stockQuantity,
          lowStockThreshold: target.lowStockThreshold,
          sku: target.sku,
          prescriptionType: target.prescriptionType,
          usageInstructions: target.usageInstructions,
          storageInstructions: target.storageInstructions,
          nearestExpiryDate: target.nearestExpiryDate,
          publicationStatus: target.publicationStatus,
          featured: offerFeatured,
          popular: target.popular,
        },
        target
      );
      setSuccessMsg(`Updated অফার pricing for "${target.name}".`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to update product offer.');
    } finally {
      setSavingOffer(false);
    }
  };

  const handleRemoveFromOffer = async (prod: Product) => {
    if (!actor || !permissions?.canEditPricing) return;
    setSavingOffer(true);
    setErrorMsg(null);
    try {
      await saveProduct(
        actor,
        {
          id: prod.id,
          name: prod.name,
          slug: prod.slug,
          genericName: prod.genericName,
          manufacturer: prod.manufacturer,
          categoryId: prod.categoryId,
          categoryName: prod.categoryName,
          subcategory: prod.subcategory,
          description: prod.description,
          images: prod.images,
          unitSize: prod.unitSize,
          sellingPrice: prod.sellingPrice,
          previousPrice: 0,
          stockQuantity: prod.stockQuantity,
          lowStockThreshold: prod.lowStockThreshold,
          sku: prod.sku,
          prescriptionType: prod.prescriptionType,
          usageInstructions: prod.usageInstructions,
          storageInstructions: prod.storageInstructions,
          nearestExpiryDate: prod.nearestExpiryDate,
          publicationStatus: prod.publicationStatus,
          featured: false,
          popular: prod.popular,
        },
        prod
      );
      setSuccessMsg(`Removed "${prod.name}" from active অফার highlights.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Could not update offer status.');
    } finally {
      setSavingOffer(false);
    }
  };

  const handleRunBackendDiscountTest = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg(null);
    setTestResult(null);
    setTestingCalc(true);
    try {
      const selectedCoupon = coupons.find((c) => c.id === testCouponId) || null;
      const res = await calculateDiscountViaBackend({
        subtotalBdt: testSubtotal,
        deliveryFeeBdt: testDeliveryFee,
        coupon: selectedCoupon,
        itemCategories: testCategory === 'all' ? [] : [testCategory],
      });
      setTestResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Server discount calculation rejected.');
    } finally {
      setTestingCalc(false);
    }
  };

  const handleUploadBrandingImage = async (
    target: 'logo' | 'hero',
    file: File | undefined
  ) => {
    if (!file) return;
    setErrorMsg(null);
    setUploadingAsset(target);
    try {
      const url = await uploadCatalogAsset('branding', file);
      if (target === 'logo') setLogoUrl(url);
      else setHeroBannerUrl(url);
      setSuccessMsg(`Uploaded ${target === 'logo' ? 'storefront logo' : 'hero banner'} to Firebase Storage.`);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Asset upload failed.');
    } finally {
      setUploadingAsset(null);
    }
  };

  const handleSaveCms = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!actor || !permissions?.canManageCms) return;
    setSavingCms(true);
    setErrorMsg(null);
    setSuccessMsg(null);
    try {
      await saveSiteSettingsConfig(
        actor,
        {
          siteName,
          tagline,
          taglineBn,
          logoUrl,
          faviconUrl,
          heroTitle,
          heroSubtitle,
          heroBannerUrl,
          heroCtaText,
          promoBannerText,
          featuredCategorySlugs: featuredSlugsInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
          homepageSectionOrder: sectionOrderInput
            .split(',')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
          navigationLinks: navLinksInput
            .split('\n')
            .map((s) => s.trim())
            .filter(Boolean)
            .slice(0, 8),
          supportPhone,
          supportEmail,
          supportHours,
          pharmacyLicenseNo,
          deliveryInfoPolicy,
          paymentInfoPolicy,
          enabledPaymentMethods:
            enabledPaymentMethods.length > 0 ? enabledPaymentMethods : ['cod', 'bkash', 'nagad'],
          faqContent,
          termsAndConditions,
          privacyPolicy,
          returnRefundPolicy,
        },
        Boolean(siteSettings)
      );
      setSuccessMsg('Published storefront CMS configuration to siteSettings/storefront_config.');
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : 'Failed to save CMS configuration.');
    } finally {
      setSavingCms(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold text-[#0F172A] tracking-tight">
            Offers (অফার), Coupons &amp; Storefront CMS
          </h1>
          <p className="text-sm text-[#64748B]">
            Control চলমান ফার্মেসি অফার, HEALTH50 &amp; CARE10 coupons, discounted অফার products, navigation links, আমাদের সম্পর্কে, and যোগাযোগ settings.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 no-print">
          <div className="inline-flex bg-white border border-[#E6ECEF] rounded-lg p-1">
            <button
              type="button"
              onClick={() => setTab('coupons')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'coupons'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              Coupons ({coupons.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('offers')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'offers'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Percent className="w-3.5 h-3.5" />
              Offer Products · অফার ({offerProducts.length})
            </button>
            <button
              type="button"
              onClick={() => setTab('cms')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium rounded-md transition-colors whitespace-nowrap shrink-0 ${
                tab === 'cms'
                  ? 'bg-[#0D7E74] text-white'
                  : 'text-[#64748B] hover:text-[#0F172A]'
              }`}
            >
              <Globe className="w-3.5 h-3.5" />
              Storefront CMS
            </button>
          </div>

          {tab === 'coupons' && permissions?.canManageCoupons && (
            <>
              {missingDefaultCoupons && (
                <button
                  type="button"
                  disabled={savingCoupon}
                  onClick={() => void handleSyncDefaultCoupons()}
                  className="inline-flex items-center gap-1.5 px-3.5 py-2 text-xs font-semibold text-[#0D7E74] bg-white border border-[#0D7E74] hover:bg-[#F0FDFA] rounded-lg transition-colors whitespace-nowrap shrink-0"
                >
                  <RefreshCw className="w-3.5 h-3.5" />
                  Sync HEALTH50 &amp; CARE10
                </button>
              )}
              <button
                type="button"
                onClick={openCreateCoupon}
                className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                <Plus className="w-4 h-4" />
                New Coupon
              </button>
            </>
          )}
        </div>
      </div>

      {errorMsg && (
        <div className="bg-white border border-[#FCA5A5] rounded-xl p-4 flex items-start gap-3 no-print">
          <AlertCircle className="w-5 h-5 text-[#DC2626] shrink-0 mt-0.5" />
          <p className="text-sm text-[#991B1B]">{errorMsg}</p>
        </div>
      )}

      {successMsg && (
        <div className="bg-white border border-[#E6ECEF] rounded-xl p-4 flex items-center justify-between gap-3 no-print">
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

      {tab === 'coupons' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          {/* Coupons Table */}
          <div className="xl:col-span-8 bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 className="text-base font-semibold text-[#0F172A]">
                Promotional Coupon Codes
              </h2>
              <span className="text-xs font-mono tabular-nums text-[#64748B]">
                {coupons.length} configured
              </span>
            </div>

            {coupons.length === 0 ? (
              <div className="p-8 text-center space-y-3">
                <p className="text-sm font-medium text-[#0F172A]">
                  No promotional coupons created yet
                </p>
                <p className="text-xs text-[#64748B] max-w-md mx-auto">
                  Initialize the storefront banner coupons (HEALTH50 &amp; CARE10) or create custom percentage and fixed BDT discount codes.
                </p>
                {permissions?.canManageCoupons && (
                  <button
                    type="button"
                    disabled={savingCoupon}
                    onClick={() => void handleSyncDefaultCoupons()}
                    className="px-4 py-2 text-xs font-semibold text-white bg-[#0D7E74] hover:bg-[#086058] rounded-lg"
                  >
                    Initialize HEALTH50 &amp; CARE10
                  </button>
                )}
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse">
                  <thead>
                    <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-[11px] font-semibold uppercase tracking-wider text-[#64748B]">
                      <th className="py-3 px-6">Code &amp; Scope</th>
                      <th className="py-3 px-4">Rule</th>
                      <th className="py-3 px-4">Validity</th>
                      <th className="py-3 px-4 text-right">Usage</th>
                      <th className="py-3 px-4">Status</th>
                      <th className="py-3 px-6 text-right print-hide-col">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F6] text-sm">
                    {coupons.map((c) => (
                      <tr key={c.id} className="hover:bg-[#F8FAFB] transition-colors">
                        <td className="py-3.5 px-6">
                          <div className="font-mono font-semibold text-[#0F172A]">{c.code}</div>
                          <div className="text-xs text-[#64748B] line-clamp-1">{c.description}</div>
                          <div className="text-[11px] text-[#64748B] mt-0.5">
                            Scope: {c.applicableCategory === 'all' ? 'All Categories' : c.applicableCategory}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-[#0F172A]">
                          <div>
                            {c.discountType === 'percentage'
                              ? `${c.discountValue}% off`
                              : `${formatBdt(c.discountValue)} off`}
                          </div>
                          <div className="text-[#64748B]">
                            Min {formatBdt(c.minOrderAmountBdt)}
                            {c.maxDiscountBdt > 0 ? ` · Cap ${formatBdt(c.maxDiscountBdt)}` : ''}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 font-mono tabular-nums text-xs text-[#64748B]">
                          {c.startDate} → {c.endDate}
                        </td>
                        <td className="py-3.5 px-4 text-right font-mono tabular-nums text-xs text-[#0F172A]">
                          {c.usedCount} / {c.usageLimit}
                        </td>
                        <td className="py-3.5 px-4">
                          {permissions?.canManageCoupons ? (
                            <button
                              type="button"
                              disabled={savingCoupon}
                              onClick={() => void handleToggleCouponStatus(c)}
                              className={`text-xs font-medium hover:underline ${
                                c.status === 'active' ? 'text-[#15803D]' : 'text-[#64748B]'
                              }`}
                            >
                              {c.status === 'active' ? 'Active' : 'Inactive'}
                            </button>
                          ) : (
                            <span
                              className={`text-xs font-medium ${
                                c.status === 'active' ? 'text-[#15803D]' : 'text-[#64748B]'
                              }`}
                            >
                              {c.status === 'active' ? 'Active' : 'Inactive'}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-6 text-right print-hide-col">
                          {permissions?.canManageCoupons ? (
                            <div className="inline-flex items-center justify-end gap-1.5">
                              <button
                                type="button"
                                onClick={() => openEditCoupon(c)}
                                className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-[#0F172A] bg-white border border-[#E6ECEF] hover:bg-[#F4F7F8] rounded-lg whitespace-nowrap shrink-0"
                              >
                                <Edit3 className="w-3.5 h-3.5" />
                                Edit
                              </button>
                              {confirmDeleteCouponId === c.id ? (
                                <>
                                  <button
                                    type="button"
                                    disabled={savingCoupon}
                                    onClick={() => void handleDeleteCoupon(c)}
                                    className="px-2.5 py-1.5 text-xs font-medium text-white bg-[#DC2626] hover:bg-[#B91C1C] rounded-lg whitespace-nowrap shrink-0"
                                  >
                                    Confirm
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => setConfirmDeleteCouponId(null)}
                                    className="px-2 py-1.5 text-xs text-[#64748B] hover:text-[#0F172A]"
                                  >
                                    Cancel
                                  </button>
                                </>
                              ) : (
                                <button
                                  type="button"
                                  onClick={() => setConfirmDeleteCouponId(c.id)}
                                  className="p-1.5 text-[#64748B] hover:text-[#DC2626] border border-[#E6ECEF] rounded-lg"
                                  title="Delete coupon"
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
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>

          {/* Trusted Backend Discount Validator */}
          <div className="xl:col-span-4 bg-white border border-[#E6ECEF] rounded-xl p-6 space-y-4 no-print">
            <div className="flex items-center gap-2">
              <Calculator className="w-4 h-4 text-[#0D7E74]" />
              <h2 className="text-base font-semibold text-[#0F172A]">
                Server Discount Validator
              </h2>
            </div>
            <p className="text-xs text-[#64748B] leading-relaxed">
              Test how <span className="font-mono text-[#0F172A]">/api/discounts/calculate</span> validates coupon eligibility, date windows, usage limits, and prevents negative checkout totals.
            </p>

            <form onSubmit={handleRunBackendDiscountTest} className="space-y-3">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Coupon to Validate
                </label>
                <select
                  value={testCouponId}
                  onChange={(e) => setTestCouponId(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                >
                  <option value="">No Coupon (Baseline Total)</option>
                  {coupons.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.code} ({c.status})
                    </option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Cart Subtotal (BDT)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={testSubtotal}
                    onChange={(e) => setTestSubtotal(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Delivery Fee (BDT)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={testDeliveryFee}
                    onChange={(e) => setTestDeliveryFee(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Simulated Cart Category
                </label>
                <select
                  value={testCategory}
                  onChange={(e) => setTestCategory(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white focus:outline-none focus:border-[#0D7E74]"
                >
                  <option value="all">General Cart</option>
                  {categories.map((cat) => (
                    <option key={cat.id} value={cat.id}>
                      {cat.nameBn ? `${cat.nameBn} (${cat.name})` : cat.name}
                    </option>
                  ))}
                </select>
              </div>

              <button
                type="submit"
                disabled={testingCalc}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
              >
                {testingCalc ? 'Validating on Server...' : 'Verify Server Calculation'}
              </button>
            </form>

            {testResult && (
              <div className="pt-3 border-t border-[#EEF2F6] space-y-1.5 text-xs">
                <div className="flex justify-between text-[#64748B]">
                  <span>Subtotal</span>
                  <span className="font-mono tabular-nums text-[#0F172A]">
                    {formatBdt(testResult.subtotalBdt)}
                  </span>
                </div>
                <div className="flex justify-between text-[#15803D]">
                  <span>Validated Discount</span>
                  <span className="font-mono tabular-nums">
                    - {formatBdt(testResult.discountBdt)}
                  </span>
                </div>
                <div className="flex justify-between text-[#64748B]">
                  <span>Delivery Fee</span>
                  <span className="font-mono tabular-nums text-[#0F172A]">
                    {formatBdt(testResult.deliveryFeeBdt)}
                  </span>
                </div>
                <div className="pt-1.5 border-t border-[#EEF2F6] flex justify-between font-semibold text-sm text-[#0F172A]">
                  <span>Net Payable</span>
                  <span className="font-mono tabular-nums">
                    {formatBdt(testResult.totalAmountBdt)}
                  </span>
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      {/* TAB 2: OFFER PRODUCTS (অফার মেনু পরিচালনা) */}
      {tab === 'offers' && (
        <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
          <div className="xl:col-span-8 bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Storefront Offer Section Products (অফার)
                </h2>
                <p className="text-xs text-[#64748B]">
                  Products with a discounted Selling Price below Previous Price or marked Featured appear automatically in the Customer Storefront &ldquo;অফার&rdquo; section.
                </p>
              </div>
              <span className="text-xs font-mono tabular-nums text-[#64748B]">
                {offerProducts.length} item(s)
              </span>
            </div>

            {offerProducts.length === 0 ? (
              <div className="p-10 text-center space-y-2">
                <p className="text-sm font-medium text-[#0F172A]">
                  No products are currently assigned to অফার
                </p>
                <p className="text-xs text-[#64748B] max-w-md mx-auto">
                  Use the Quick Offer Price Editor on the right to assign a discounted price or feature any medicine in the অফার tab.
                </p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left border-collapse text-sm">
                  <thead>
                    <tr className="border-b border-[#EEF2F6] bg-[#F8FAFB] text-xs font-medium text-[#64748B]">
                      <th className="py-3 px-6">Product &amp; Brand</th>
                      <th className="py-3 px-4">Category</th>
                      <th className="py-3 px-4 text-right">Offer Price</th>
                      <th className="py-3 px-4 text-right">Previous MRP</th>
                      <th className="py-3 px-6 text-right print-hide-col">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF2F6]">
                    {offerProducts.map((prod) => {
                      const pct =
                        prod.previousPrice > prod.sellingPrice
                          ? Math.round(
                              ((prod.previousPrice - prod.sellingPrice) / prod.previousPrice) * 100
                            )
                          : 0;
                      return (
                        <tr key={prod.id} className="hover:bg-[#F8FAFB]">
                          <td className="py-3 px-6">
                            <div className="font-semibold text-[#0F172A]">{prod.name}</div>
                            <div className="text-xs text-[#64748B]">
                              {prod.manufacturer} · {prod.unitSize}
                            </div>
                          </td>
                          <td className="py-3 px-4 text-xs text-[#475569]">{prod.categoryName}</td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums font-semibold text-[#0D7E74]">
                            {formatBdt(prod.sellingPrice)}
                            {pct > 0 ? ` (-${pct}%)` : ''}
                          </td>
                          <td className="py-3 px-4 text-right font-mono tabular-nums text-xs text-[#64748B]">
                            {prod.previousPrice > 0 ? formatBdt(prod.previousPrice) : 'Featured'}
                          </td>
                          <td className="py-3 px-6 text-right print-hide-col">
                            {permissions?.canEditPricing && (
                              <div className="inline-flex items-center gap-2">
                                <button
                                  type="button"
                                  onClick={() => {
                                    setSelectedOfferProdId(prod.id);
                                    setOfferSellingPrice(prod.sellingPrice);
                                    setOfferPreviousPrice(
                                      prod.previousPrice > prod.sellingPrice
                                        ? prod.previousPrice
                                        : prod.sellingPrice
                                    );
                                    setOfferFeatured(prod.featured);
                                  }}
                                  className="px-2.5 py-1 text-xs font-medium text-[#0F172A] border border-[#E6ECEF] rounded-md hover:bg-[#F4F7F8]"
                                >
                                  Edit Offer
                                </button>
                                <button
                                  type="button"
                                  disabled={savingOffer}
                                  onClick={() => void handleRemoveFromOffer(prod)}
                                  className="px-2.5 py-1 text-xs font-medium text-[#991B1B] border border-[#FECACA] rounded-md hover:bg-[#FEF2F2]"
                                >
                                  Remove
                                </button>
                              </div>
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

          {/* Quick Offer Campaign Price Editor */}
          <div className="xl:col-span-4 bg-white border border-[#E6ECEF] rounded-xl p-6 space-y-4">
            <h2 className="text-base font-semibold text-[#0F172A]">
              Assign / Update Product Offer (অফার)
            </h2>
            <p className="text-xs text-[#64748B]">
              Select any catalog item and set its Offer Selling Price below Previous Price to publish it in the অফার section.
            </p>

            <form onSubmit={handleApplyProductOffer} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Select Catalog Product *
                </label>
                <select
                  required
                  value={selectedOfferProdId}
                  onChange={(e) => {
                    const p = products.find((item) => item.id === e.target.value);
                    setSelectedOfferProdId(e.target.value);
                    if (p) {
                      setOfferSellingPrice(p.sellingPrice);
                      setOfferPreviousPrice(
                        p.previousPrice > p.sellingPrice ? p.previousPrice : p.sellingPrice
                      );
                      setOfferFeatured(true);
                    }
                  }}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                >
                  <option value="">Choose a product...</option>
                  {products
                    .filter((p) => p.publicationStatus !== 'archived')
                    .map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name} ({formatBdt(p.sellingPrice)})
                      </option>
                    ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Offer Price (BDT) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={offerSellingPrice}
                    onChange={(e) => setOfferSellingPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Regular MRP (BDT) *
                  </label>
                  <input
                    type="number"
                    min={0}
                    required
                    value={offerPreviousPrice}
                    onChange={(e) => setOfferPreviousPrice(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs text-[#0F172A]">
                <input
                  type="checkbox"
                  checked={offerFeatured}
                  onChange={(e) => setOfferFeatured(e.target.checked)}
                />
                <span>Highlight on Homepage Featured Offers</span>
              </label>

              <button
                type="submit"
                disabled={savingOffer || !permissions?.canEditPricing}
                className="w-full px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors"
              >
                {savingOffer ? 'Saving Offer...' : 'Publish to অফার Section'}
              </button>
            </form>
          </div>
        </div>
      )}

      {/* TAB 3: STOREFRONT CMS */}
      {tab === 'cms' && (
        <form onSubmit={handleSaveCms} className="space-y-6">
          <div className="grid grid-cols-1 xl:grid-cols-12 gap-6">
            <div className="xl:col-span-7 bg-white border border-[#E6ECEF] rounded-xl p-6 space-y-5">
              <div>
                <h2 className="text-base font-semibold text-[#0F172A]">
                  Header, Top Green Navigation Bar &amp; Offer Hero Banner
                </h2>
                <p className="text-xs text-[#64748B]">
                  Synced directly to <span className="font-mono text-[#0F172A]">/siteSettings/storefront_config</span> for the Customer Storefront.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Storefront Name *
                  </label>
                  <input
                    type="text"
                    required
                    value={siteName}
                    onChange={(e) => setSiteName(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    DGDA / Pharmacy License No *
                  </label>
                  <input
                    type="text"
                    required
                    value={pharmacyLicenseNo}
                    onChange={(e) => setPharmacyLicenseNo(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Header Subtitle (Your Health Our Priority)
                  </label>
                  <input
                    type="text"
                    value={tagline}
                    onChange={(e) => setTagline(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Bengali Tagline (বাংলা ট্যাগলাইন)
                  </label>
                  <input
                    type="text"
                    value={taglineBn}
                    onChange={(e) => setTaglineBn(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Top Dark-Green Strip Text (সারা বাংলাদেশে হোম ডেলিভারি...)
                </label>
                <input
                  type="text"
                  value={promoBannerText}
                  onChange={(e) => setPromoBannerText(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Offer Banner Headline *
                  </label>
                  <input
                    type="text"
                    required
                    value={heroTitle}
                    onChange={(e) => setHeroTitle(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Coupon Highlight Badge Label
                  </label>
                  <input
                    type="text"
                    value={heroCtaText}
                    onChange={(e) => setHeroCtaText(e.target.value)}
                    placeholder="কুপন উদাহরণ: HEALTH50 · CARE10"
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Offer Banner Subtitle (৳1500+ ফ্রি ডেলিভারি বিবরণ)
                </label>
                <textarea
                  rows={2}
                  value={heroSubtitle}
                  onChange={(e) => setHeroSubtitle(e.target.value)}
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Hero Banner Image URL (Optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={heroBannerUrl}
                      onChange={(e) => setHeroBannerUrl(e.target.value)}
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                    />
                    {permissions?.canManageCms && (
                      <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] border border-[#E6ECEF] rounded-lg cursor-pointer hover:bg-[#E2EEF0] whitespace-nowrap shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingAsset === 'hero' ? '...' : 'Upload'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => handleUploadBrandingImage('hero', e.target.files?.[0])}
                        />
                      </label>
                    )}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Brand Logo URL (Optional)
                  </label>
                  <div className="flex gap-2">
                    <input
                      type="text"
                      value={logoUrl}
                      onChange={(e) => setLogoUrl(e.target.value)}
                      placeholder="https://... or upload"
                      className="flex-1 min-w-0 px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                    />
                    {permissions?.canManageCms && (
                      <label className="inline-flex items-center gap-1.5 px-3 py-2 text-xs font-medium text-[#0F172A] bg-[#F4F7F8] border border-[#E6ECEF] rounded-lg cursor-pointer hover:bg-[#E2EEF0] whitespace-nowrap shrink-0">
                        <Upload className="w-3.5 h-3.5" />
                        {uploadingAsset === 'logo' ? '...' : 'Upload'}
                        <input
                          type="file"
                          accept="image/jpeg,image/png,image/webp"
                          className="hidden"
                          onChange={(e) => handleUploadBrandingImage('logo', e.target.files?.[0])}
                        />
                      </label>
                    )}
                  </div>
                </div>
              </div>

              {/* Interactive Top Bar Category Selector */}
              <div className="space-y-2 border-t border-[#EEF2F6] pt-4">
                <div className="flex items-center justify-between">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Pinned Green Navbar Categories (Up to 8 Slugs)
                  </label>
                  <span className="text-[11px] font-mono text-[#64748B]">
                    {parsedFeaturedSlugs.length} / 8 selected
                  </span>
                </div>
                {categories.filter((c) => !c.parentCategoryId).length > 0 && (
                  <div className="flex flex-wrap gap-2 pb-1">
                    {categories
                      .filter((c) => !c.parentCategoryId)
                      .map((cat) => {
                        const checked = parsedFeaturedSlugs.includes(cat.slug);
                        return (
                          <button
                            key={cat.id}
                            type="button"
                            onClick={() => toggleFeaturedSlugCheckbox(cat.slug)}
                            className={`px-2.5 py-1 text-xs font-medium rounded-md border transition-colors ${
                              checked
                                ? 'bg-[#F0FDFA] border-[#0D7E74] text-[#0D7E74]'
                                : 'bg-white border-[#E6ECEF] text-[#64748B]'
                            }`}
                          >
                            {checked ? '✓ ' : '+ '}
                            {cat.nameBn || cat.name}
                          </button>
                        );
                      })}
                  </div>
                )}
                <input
                  type="text"
                  value={featuredSlugsInput}
                  onChange={(e) => setFeaturedSlugsInput(e.target.value)}
                  className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <div className="flex items-center justify-between mb-1">
                    <label className="block text-xs font-semibold text-[#0F172A]">
                      Storefront Page Links (Max 8: Label|Path)
                    </label>
                    <button
                      type="button"
                      onClick={() => setNavLinksInput(STANDARD_NAV_LINKS.join('\n'))}
                      className="text-[11px] font-medium text-[#0D7E74] hover:underline"
                    >
                      Reset Standard Links
                    </button>
                  </div>
                  <textarea
                    rows={5}
                    value={navLinksInput}
                    onChange={(e) => setNavLinksInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Homepage Section Order (comma-separated)
                  </label>
                  <textarea
                    rows={5}
                    value={sectionOrderInput}
                    onChange={(e) => setSectionOrderInput(e.target.value)}
                    className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg focus:outline-none focus:border-[#0D7E74]"
                  />
                </div>
              </div>
            </div>

            {/* Live Storefront Header/Banner Preview + Contact & Legal Policies */}
            <div className="xl:col-span-5 space-y-6">
              <div className="bg-white border border-[#E6ECEF] rounded-xl overflow-hidden">
                <div className="px-4 py-2 bg-[#064E3B] text-white text-[11px] flex items-center justify-between gap-2">
                  <span className="truncate">{promoBannerText}</span>
                  <span className="font-mono shrink-0">{supportPhone}</span>
                </div>
                <div className="p-4 space-y-3">
                  <div>
                    <div className="text-base font-bold text-[#0F172A]">{siteName}</div>
                    <div className="text-xs text-[#64748B]">{tagline}</div>
                  </div>
                  <div className="rounded-xl bg-[#16795B] text-white p-4 space-y-1.5">
                    <div className="text-sm font-bold">{heroTitle}</div>
                    <p className="text-xs text-white/90 leading-relaxed">{heroSubtitle}</p>
                    {heroCtaText && (
                      <div className="pt-1">
                        <span className="inline-block px-2.5 py-1 text-[11px] font-mono bg-white/15 border border-white/25 rounded-md">
                          {heroCtaText}
                        </span>
                      </div>
                    )}
                  </div>
                </div>
              </div>

              <div className="bg-white border border-[#E6ECEF] rounded-xl p-6 space-y-4">
                <h2 className="text-base font-semibold text-[#0F172A]">
                  যোগাযোগ, আমাদের সম্পর্কে &amp; অর্ডার ট্র্যাকিং নীতিমালা
                </h2>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Hotline (যোগাযোগ নম্বর)
                    </label>
                    <input
                      type="text"
                      value={supportPhone}
                      onChange={(e) => setSupportPhone(e.target.value)}
                      className="w-full px-3 py-2 text-xs font-mono border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Support Email
                    </label>
                    <input
                      type="email"
                      value={supportEmail}
                      onChange={(e) => setSupportEmail(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Service Hours
                    </label>
                    <input
                      type="text"
                      value={supportHours}
                      onChange={(e) => setSupportHours(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Delivery &amp; Order Tracking Policy (ফ্রি ডেলিভারি ও অর্ডার ট্র্যাকিং)
                  </label>
                  <textarea
                    rows={2}
                    value={deliveryInfoPolicy}
                    onChange={(e) => setDeliveryInfoPolicy(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div className="space-y-2">
                  <label className="block text-xs font-semibold text-[#0F172A]">
                    Enabled Checkout Payment Options (নিরাপদ পেমেন্ট অপশন)
                  </label>
                  <div className="flex flex-wrap gap-2.5">
                    {(
                      [
                        { id: 'cod', label: 'Cash on Delivery (COD)' },
                        { id: 'bkash', label: 'bKash Payment (বিকাশ)' },
                        { id: 'nagad', label: 'Nagad Payment (নগদ)' },
                      ] as Array<{ id: PaymentMethod; label: string }>
                    ).map((opt) => {
                      const checked = enabledPaymentMethods.includes(opt.id);
                      return (
                        <label
                          key={opt.id}
                          className={`inline-flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg border cursor-pointer transition-colors ${
                            checked
                              ? 'border-[#0D7E74] bg-[#F0FDFA] text-[#0D7E74]'
                              : 'border-[#E6ECEF] bg-white text-[#64748B]'
                          }`}
                        >
                          <input
                            type="checkbox"
                            disabled={!permissions?.canManageCms}
                            checked={checked}
                            onChange={() => toggleCmsPaymentMethod(opt.id)}
                          />
                          <span>{opt.label}</span>
                        </label>
                      );
                    })}
                  </div>
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Safe Payment Policy &amp; Merchant Instructions (COD + bKash/Nagad)
                  </label>
                  <textarea
                    rows={3}
                    value={paymentInfoPolicy}
                    onChange={(e) => setPaymentInfoPolicy(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    About Us &amp; FAQ (আমাদের সম্পর্কে ও সাধারণ প্রশ্নোত্তর)
                  </label>
                  <textarea
                    rows={3}
                    value={faqContent}
                    onChange={(e) => setFaqContent(e.target.value)}
                    className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                  />
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Terms &amp; Conditions
                    </label>
                    <textarea
                      rows={3}
                      value={termsAndConditions}
                      onChange={(e) => setTermsAndConditions(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Privacy Policy
                    </label>
                    <textarea
                      rows={3}
                      value={privacyPolicy}
                      onChange={(e) => setPrivacyPolicy(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                      Return &amp; Refund Policy
                    </label>
                    <textarea
                      rows={3}
                      value={returnRefundPolicy}
                      onChange={(e) => setReturnRefundPolicy(e.target.value)}
                      className="w-full px-3 py-2 text-xs border border-[#E6ECEF] rounded-lg"
                    />
                  </div>
                </div>

                {permissions?.canManageCms && (
                  <div className="pt-2 flex justify-end">
                    <button
                      type="submit"
                      disabled={savingCms}
                      className="px-5 py-2.5 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg transition-colors whitespace-nowrap shrink-0"
                    >
                      {savingCms ? 'Publishing Storefront CMS...' : 'Publish Storefront Settings'}
                    </button>
                  </div>
                )}
              </div>
            </div>
          </div>
        </form>
      )}

      {/* Create / Edit Coupon Modal */}
      {couponModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-[#0F172A]/40 flex items-center justify-center p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="coupon-modal-title"
        >
          <div className="bg-white border border-[#E6ECEF] rounded-xl max-w-lg w-full max-h-[90vh] overflow-y-auto">
            <div className="px-6 py-4 border-b border-[#EEF2F6] flex items-center justify-between">
              <h2 id="coupon-modal-title" className="text-lg font-semibold text-[#0F172A]">
                {editingCoupon ? `Edit Coupon ${editingCoupon.code}` : 'Create Promotional Coupon'}
              </h2>
              <button
                type="button"
                onClick={() => setCouponModalOpen(false)}
                className="p-1.5 text-[#64748B] hover:text-[#0F172A] rounded-lg"
                aria-label="Close modal"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSaveCoupon} className="p-6 space-y-4">
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Coupon Code *
                  </label>
                  <input
                    type="text"
                    required
                    disabled={Boolean(editingCoupon)}
                    value={code}
                    onChange={(e) => setCode(e.target.value.toUpperCase())}
                    placeholder="HEALTH50"
                    className="w-full px-3 py-2 text-sm font-mono uppercase border border-[#E6ECEF] rounded-lg disabled:bg-[#F4F7F8]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Status
                  </label>
                  <select
                    value={couponStatus}
                    onChange={(e) => setCouponStatus(e.target.value as 'active' | 'inactive')}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                  Description *
                </label>
                <input
                  type="text"
                  required
                  value={couponDesc}
                  onChange={(e) => setCouponDesc(e.target.value)}
                  placeholder="৳50 flat pharmacy discount on orders of ৳500 or above"
                  className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg"
                />
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Discount Type
                  </label>
                  <select
                    value={discountType}
                    onChange={(e) => setDiscountType(e.target.value as 'percentage' | 'fixed_bdt')}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="percentage">Percentage (%)</option>
                    <option value="fixed_bdt">Fixed Amount (BDT)</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Discount Value *
                  </label>
                  <input
                    type="number"
                    min={1}
                    max={discountType === 'percentage' ? 90 : 100000}
                    required
                    value={discountValue}
                    onChange={(e) => setDiscountValue(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Minimum Order Subtotal (BDT)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={minOrderAmountBdt}
                    onChange={(e) => setMinOrderAmountBdt(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Max Discount Cap (BDT, 0 = none)
                  </label>
                  <input
                    type="number"
                    min={0}
                    value={maxDiscountBdt}
                    onChange={(e) => setMaxDiscountBdt(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Start Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Expiry Date *
                  </label>
                  <input
                    type="date"
                    required
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    className="w-full px-3 py-2 text-sm font-mono border border-[#E6ECEF] rounded-lg"
                  />
                </div>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Total Usage Limit *
                  </label>
                  <input
                    type="number"
                    min={1}
                    required
                    value={usageLimit}
                    onChange={(e) => setUsageLimit(Number(e.target.value))}
                    className="w-full px-3 py-2 text-sm font-mono tabular-nums border border-[#E6ECEF] rounded-lg"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-[#0F172A] mb-1">
                    Applicable Category Scope
                  </label>
                  <select
                    value={applicableCategory}
                    onChange={(e) => setApplicableCategory(e.target.value)}
                    className="w-full px-3 py-2 text-sm border border-[#E6ECEF] rounded-lg bg-white"
                  >
                    <option value="all">All Categories</option>
                    {categories.map((cat) => (
                      <option key={cat.id} value={cat.id}>
                        {cat.nameBn ? `${cat.nameBn} (${cat.name})` : cat.name}
                      </option>
                    ))}
                  </select>
                </div>
              </div>

              <div className="pt-3 border-t border-[#EEF2F6] flex justify-end gap-3">
                <button
                  type="button"
                  onClick={() => setCouponModalOpen(false)}
                  className="px-4 py-2 text-sm font-medium text-[#64748B] border border-[#E6ECEF] rounded-lg whitespace-nowrap shrink-0"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savingCoupon}
                  className="px-4 py-2 text-sm font-medium text-white bg-[#0D7E74] hover:bg-[#086058] disabled:opacity-50 rounded-lg whitespace-nowrap shrink-0"
                >
                  {savingCoupon ? 'Saving...' : editingCoupon ? 'Update Coupon' : 'Create Coupon'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
