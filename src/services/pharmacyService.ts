import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  orderBy,
  query,
  runTransaction,
  serverTimestamp,
  setDoc,
  updateDoc,
  where,
  writeBatch,
} from 'firebase/firestore';
import { getDownloadURL, ref, uploadBytes } from 'firebase/storage';
import {
  auth,
  db,
  getActiveFirebaseApiKey,
  getFirebaseProjectInfo,
  handleFirestoreError,
  isBootstrappedSuperAdminEmail,
  OperationType,
  SHARED_STORE_ID,
  storage,
} from '../lib/firebase';
import {
  computeBatchExpiryState,
  computeProductAvailability,
  isDateExpired,
  makeSafeDocId,
  sanitizeSafeUrl,
  sanitizeText,
  toSlug,
} from '../lib/validation';
import type {
  AdminAuditLog,
  Category,
  Coupon,
  DeliveryZone,
  Order,
  OrderItem,
  OrderStatus,
  OrderStatusHistory,
  PaymentMethod,
  PaymentStatus,
  PrescriptionReview,
  Product,
  ProductBatch,
  SiteSettings,
  StaffMember,
  StaffRole,
  SupportTicket,
  UserAccount,
  UserPrivateProfile,
} from '../types/pharmacy';

export interface ActorContext {
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  licenseNumber: string;
  activeStaffUids: string[];
}

function boundedStaffUids(uids: string[], extraUid?: string): string[] {
  const merged = Array.from(new Set([...uids, ...(extraUid ? [extraUid] : [])].filter(Boolean)));
  return merged.slice(0, 20);
}

async function getBearerHeaders(): Promise<Record<string, string>> {
  const user = auth.currentUser;
  if (!user) throw new Error('User is not authenticated.');
  const token = await user.getIdToken();
  const projectInfo = getFirebaseProjectInfo();
  const webApiKey = getActiveFirebaseApiKey();
  return {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`,
    ...(webApiKey ? { 'X-Firebase-Web-Api-Key': webApiKey } : {}),
    ...(projectInfo.projectId ? { 'X-Firebase-Project-Id': projectInfo.projectId } : {}),
  };
}

async function parseJsonOrNull<T>(res: Response): Promise<T | null> {
  const contentType = (res.headers.get('content-type') || '').toLowerCase();
  if (!contentType.includes('application/json')) {
    return null;
  }
  try {
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function verifyServerSession(): Promise<{
  verified: boolean;
  user: {
    uid: string;
    email: string;
    emailVerified: boolean;
    displayName: string;
    isBootstrappedSuperAdmin: boolean;
  };
}> {
  const currentUser = auth.currentUser;
  if (!currentUser) {
    throw new Error('User is not authenticated.');
  }

  try {
    const headers = await getBearerHeaders();
    const res = await fetch('/api/auth/verify-session', {
      method: 'POST',
      headers,
    });
    const body = await parseJsonOrNull<{
      verified: boolean;
      error?: string;
      user: {
        uid: string;
        email: string;
        emailVerified: boolean;
        displayName: string;
        isBootstrappedSuperAdmin: boolean;
      };
    }>(res);

    if (body) {
      if (res.ok && body.verified) {
        return body;
      }
      const serverErr = body.error || '';
      const isHardAccountRejection =
        serverErr.includes('account has been disabled') ||
        serverErr.includes('Verified email address is required') ||
        serverErr.includes('not found in Firebase Identity Toolkit');
      if (isHardAccountRejection) {
        throw new Error(serverErr);
      }
      // If serverless env vars were missing or project API key differed on Vercel, verify directly via Firebase Auth below
    }
  } catch (err) {
    if (
      err instanceof Error &&
      (err.message.includes('account has been disabled') ||
        err.message.includes('Verified email address is required') ||
        err.message.includes('not found in Firebase Identity Toolkit'))
    ) {
      throw err;
    }
  }

  // Direct Firebase Identity Toolkit / Auth token verification fallback
  await currentUser.reload();
  await currentUser.getIdTokenResult(true);
  if (!currentUser.emailVerified) {
    throw new Error('Verified email address is required for administrative operations.');
  }
  const normalizedEmail = (currentUser.email || '').trim().toLowerCase();
  return {
    verified: true,
    user: {
      uid: currentUser.uid,
      email: normalizedEmail,
      emailVerified: Boolean(currentUser.emailVerified),
      displayName: currentUser.displayName || normalizedEmail,
      isBootstrappedSuperAdmin: isBootstrappedSuperAdminEmail(normalizedEmail),
    },
  };
}

export async function recordAdminAudit(
  actor: ActorContext,
  module: AdminAuditLog['module'],
  action: string,
  targetId: string,
  targetLabel: string,
  details: string
): Promise<void> {
  const logId = makeSafeDocId('aud');
  const path = `adminAuditLogs/${logId}`;
  try {
    await setDoc(doc(db, 'adminAuditLogs', logId), {
      action: sanitizeText(action, 100),
      module,
      targetId: sanitizeText(targetId, 128) || 'system',
      targetLabel: sanitizeText(targetLabel, 160) || 'Store Record',
      actorUid: actor.uid,
      actorEmail: sanitizeText(actor.email, 254),
      actorRole: actor.role,
      details: sanitizeText(details, 800),
      storeId: SHARED_STORE_ID,
      authorizedStaffUids: boundedStaffUids(actor.activeStaffUids, actor.uid),
      createdAt: serverTimestamp(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function uploadCatalogAsset(
  folder: 'catalog/products' | 'catalog/categories' | 'branding',
  file: File
): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) {
    throw new Error('Only JPEG, PNG, or WebP images are permitted.');
  }
  if (file.size > 5 * 1024 * 1024) {
    throw new Error('Image file size must not exceed 5 MB.');
  }
  const safeName = `${Date.now()}_${file.name.replace(/[^a-zA-Z0-9._-]/g, '_')}`;
  const storageRef = ref(storage, `${folder}/${safeName}`);
  await uploadBytes(storageRef, file, { contentType: file.type });
  return getDownloadURL(storageRef);
}

// ---------------------------------------------------------------------------
// 1. STAFF & RBAC PROVISIONING
// ---------------------------------------------------------------------------
export async function bootstrapSuperAdminProfile(params: {
  uid: string;
  email: string;
  displayName: string;
  licenseNumber: string;
}): Promise<void> {
  const path = `staffMembers/${params.uid}`;
  try {
    await setDoc(doc(db, 'staffMembers', params.uid), {
      uid: params.uid,
      email: sanitizeText(params.email.toLowerCase(), 254),
      displayName: sanitizeText(params.displayName || 'Chief Administrator', 120),
      role: 'super_admin',
      status: 'active',
      department: 'Executive & Clinical Governance',
      licenseNumber: sanitizeText(params.licenseNumber || 'BPC-REG-0001', 64),
      storeId: SHARED_STORE_ID,
      authorizedStaffUids: [params.uid],
      createdBy: params.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await recordAdminAudit(
      {
        uid: params.uid,
        email: params.email,
        displayName: params.displayName || params.email,
        role: 'super_admin',
        licenseNumber: params.licenseNumber || 'BPC-REG-0001',
        activeStaffUids: [params.uid],
      },
      'auth',
      'SUPER_ADMIN_BOOTSTRAPPED',
      params.uid,
      params.email,
      'Provisioned verified Super Admin staff profile in shared Firestore project.'
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function provisionStaffAccount(
  actor: ActorContext,
  input: {
    uid: string;
    email: string;
    displayName: string;
    role: StaffRole;
    department: string;
    licenseNumber: string;
  }
): Promise<void> {
  const cleanUid = sanitizeText(input.uid, 128);
  const path = `staffMembers/${cleanUid}`;
  const nextStaffUids = boundedStaffUids(actor.activeStaffUids, cleanUid);
  try {
    await setDoc(doc(db, 'staffMembers', cleanUid), {
      uid: cleanUid,
      email: sanitizeText(input.email.toLowerCase(), 254),
      displayName: sanitizeText(input.displayName, 120),
      role: input.role,
      status: 'active',
      department: sanitizeText(input.department || 'Operations', 80),
      licenseNumber: sanitizeText(input.licenseNumber, 64),
      storeId: SHARED_STORE_ID,
      authorizedStaffUids: nextStaffUids,
      createdBy: actor.uid,
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    });

    await recordAdminAudit(
      actor,
      'staff',
      'STAFF_PROVISIONED',
      cleanUid,
      `${input.displayName} (${input.role})`,
      `Provisioned staff member ${input.email} with role ${input.role}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function updateStaffMemberRecord(
  actor: ActorContext,
  existing: StaffMember,
  updates: {
    displayName: string;
    role: StaffRole;
    status: 'active' | 'suspended';
    department: string;
    licenseNumber: string;
  }
): Promise<void> {
  const path = `staffMembers/${existing.uid}`;
  try {
    await updateDoc(doc(db, 'staffMembers', existing.uid), {
      displayName: sanitizeText(updates.displayName, 120),
      role: updates.role,
      status: updates.status,
      department: sanitizeText(updates.department, 80),
      licenseNumber: sanitizeText(updates.licenseNumber, 64),
      authorizedStaffUids: boundedStaffUids(actor.activeStaffUids, actor.uid),
      updatedAt: serverTimestamp(),
    });

    await recordAdminAudit(
      actor,
      'staff',
      'STAFF_UPDATED',
      existing.uid,
      existing.email,
      `Updated staff role=${updates.role}, status=${updates.status}, license=${updates.licenseNumber || 'none'}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 2. CATEGORY & BRAND MANAGEMENT
// ---------------------------------------------------------------------------
export interface OfficialStorefrontCategoryPreset {
  name: string;
  nameBn: string;
  slug: string;
  aliases: string[];
  iconName: string;
  order: number;
  desc: string;
  suggestedSubcategories: Array<{ name: string; nameBn: string; slug: string }>;
}

export const OFFICIAL_STOREFRONT_CATEGORIES: OfficialStorefrontCategoryPreset[] = [
  {
    name: 'Medicine',
    nameBn: 'ঔষধ',
    slug: 'medicine',
    aliases: ['medicine', 'medicines'],
    iconName: 'Pill',
    order: 1,
    desc: 'Licensed prescription and over-the-counter pharmaceutical tablets, capsules, syrups, and topical medicines.',
    suggestedSubcategories: [
      { name: 'Prescription Medicines', nameBn: 'প্রেসক্রিপশন ঔষধ', slug: 'prescription-medicines' },
      { name: 'OTC & Primary Care', nameBn: 'ওটিসি ও প্রাথমিক চিকিৎসা', slug: 'otc-primary-care' },
      { name: 'Hair & Dermatology Rx', nameBn: 'চুল ও চর্মরোগের ঔষধ', slug: 'hair-dermatology-rx' },
    ],
  },
  {
    name: 'Herbal Products',
    nameBn: 'হারবাল পণ্য',
    slug: 'herbal-products',
    aliases: ['herbal-products', 'herbal'],
    iconName: 'Leaf',
    order: 2,
    desc: 'Approved herbal, Unani, Ayurvedic, and natural botanical wellness formulations.',
    suggestedSubcategories: [
      { name: 'Digestive & Liver Care', nameBn: 'হজম ও লিভার সুরক্ষা', slug: 'digestive-liver-herbal' },
      { name: 'Natural Immunity & Vitality', nameBn: 'প্রাকৃতিক রোগ প্রতিরোধ', slug: 'natural-immunity-vitality' },
    ],
  },
  {
    name: 'Vitamins & Supplements',
    nameBn: 'ভিটামিন ও সাপ্লিমেন্ট',
    slug: 'vitamins-supplements',
    aliases: ['vitamins-supplements', 'vitamins'],
    iconName: 'ShieldPlus',
    order: 3,
    desc: 'Daily multivitamins, calcium, omega fatty acids, minerals, and nutritional supplements.',
    suggestedSubcategories: [
      { name: 'Multivitamins & Minerals', nameBn: 'মাল্টিভিটামিন ও মিনারেল', slug: 'multivitamins-minerals' },
      { name: 'Calcium, Bone & Joint', nameBn: 'ক্যালসিয়াম ও হাড়ের যত্ন', slug: 'calcium-bone-joint' },
      { name: 'Biotin & Hair Nutrition', nameBn: 'বায়োটিন ও চুলের পুষ্টি', slug: 'biotin-hair-nutrition' },
    ],
  },
  {
    name: 'Health Care',
    nameBn: 'স্বাস্থ্যসামগ্রী',
    slug: 'health-care',
    aliases: ['health-care', 'healthcare', 'healthcare-devices'],
    iconName: 'Stethoscope',
    order: 4,
    desc: 'Diagnostic devices, blood pressure & glucose monitors, surgical supplies, and home healthcare essentials.',
    suggestedSubcategories: [
      { name: 'Diagnostic Devices', nameBn: 'ডায়াগনস্টিক ডিভাইস (BP/Glucometer)', slug: 'diagnostic-devices' },
      { name: 'First Aid & Surgical', nameBn: 'ফার্স্ট এইড ও সার্জিক্যাল', slug: 'first-aid-surgical' },
    ],
  },
  {
    name: 'Skin Care',
    nameBn: 'স্কিন কেয়ার',
    slug: 'skincare-personal-care',
    aliases: ['skincare-personal-care', 'skin-care', 'skincare'],
    iconName: 'Sparkles',
    order: 5,
    desc: 'Dermatologist-recommended cleansers, moisturizers, sunscreens, scalp care, and clinical skincare.',
    suggestedSubcategories: [
      { name: 'Clinical Cleansers & Serums', nameBn: 'ক্লিনিক্যাল ফেসওয়াশ ও সিরাম', slug: 'clinical-cleansers-serums' },
      { name: 'Sunscreen & Moisturizers', nameBn: 'সানস্ক্রিন ও ময়েশ্চারাইজার', slug: 'sunscreen-moisturizers' },
      { name: 'Scalp & Hair Care', nameBn: 'স্ক্যাল্প ও হেয়ার কেয়ার', slug: 'scalp-hair-care' },
    ],
  },
];

export const VERIFIED_PHARMA_BRANDS: string[] = [
  'Square Pharmaceuticals PLC',
  'Incepta Pharmaceuticals Ltd.',
  'Beximco Pharmaceuticals Ltd.',
  'Renata PLC',
  'Healthcare Pharmaceuticals Ltd.',
  'Eskayef Pharmaceuticals Ltd. (SK+F)',
  'ACI HealthCare Limited',
  'Aristopharma Ltd.',
  'Opsonin Pharma Ltd.',
  'Drug International Ltd.',
  'Radiant Pharmaceuticals Ltd.',
  'ACME Laboratories Ltd.',
  'Popular Pharmaceuticals PLC',
  'Hamdard Laboratories (Waqf) Bangladesh',
];

export async function saveCategory(
  actor: ActorContext,
  input: {
    id?: string;
    name: string;
    nameBn: string;
    slug?: string;
    description: string;
    iconName: string;
    imageUrl: string;
    parentCategoryId: string;
    displayOrder: number;
    publicationStatus: 'published' | 'hidden';
    activeProductCount?: number;
  },
  productsToSyncCategoryName?: Product[]
): Promise<string> {
  const isEdit = Boolean(input.id);
  const slug = toSlug(input.slug || input.name, 100);
  const categoryId = input.id || `cat_${toSlug(slug, 48)}`;
  const path = `categories/${categoryId}`;
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const cleanName = sanitizeText(input.name, 100);

  try {
    if (!isEdit) {
      await setDoc(doc(db, 'categories', categoryId), {
        name: cleanName,
        nameBn: sanitizeText(input.nameBn, 120),
        slug,
        description: sanitizeText(input.description, 500),
        iconName: sanitizeText(input.iconName || 'Pill', 40),
        imageUrl: sanitizeSafeUrl(input.imageUrl, 500),
        parentCategoryId: sanitizeText(input.parentCategoryId, 128),
        displayOrder: Math.max(0, Math.min(10000, Number(input.displayOrder) || 0)),
        publicationStatus: input.publicationStatus,
        activeProductCount: Math.max(0, Number(input.activeProductCount) || 0),
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      const batch = writeBatch(db);
      batch.update(doc(db, 'categories', categoryId), {
        name: cleanName,
        nameBn: sanitizeText(input.nameBn, 120),
        slug,
        description: sanitizeText(input.description, 500),
        iconName: sanitizeText(input.iconName || 'Pill', 40),
        imageUrl: sanitizeSafeUrl(input.imageUrl, 500),
        parentCategoryId: sanitizeText(input.parentCategoryId, 128),
        displayOrder: Math.max(0, Math.min(10000, Number(input.displayOrder) || 0)),
        publicationStatus: input.publicationStatus,
        activeProductCount: Math.max(0, Number(input.activeProductCount) || 0),
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      // Keep denormalized categoryName on assigned products synced when an admin renames a category
      if (
        productsToSyncCategoryName &&
        productsToSyncCategoryName.length > 0 &&
        ['super_admin', 'store_admin'].includes(actor.role)
      ) {
        const matchingProducts = productsToSyncCategoryName.filter(
          (p) => p.categoryId === categoryId && p.categoryName !== cleanName
        );
        for (const prod of matchingProducts.slice(0, 400)) {
          batch.update(doc(db, 'products', prod.id), {
            categoryName: cleanName,
            authorizedStaffUids: staffUids,
            updatedAt: serverTimestamp(),
          });
        }
      }

      await batch.commit();
    }

    await recordAdminAudit(
      actor,
      'categories',
      isEdit ? 'CATEGORY_UPDATED' : 'CATEGORY_CREATED',
      categoryId,
      cleanName,
      `${isEdit ? 'Updated' : 'Created'} category "${cleanName}" (${input.nameBn || slug}, ${input.publicationStatus}).`
    );
    return categoryId;
  } catch (error) {
    handleFirestoreError(error, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function toggleCategoryPublication(
  actor: ActorContext,
  category: Category
): Promise<void> {
  const nextStatus: 'published' | 'hidden' =
    category.publicationStatus === 'published' ? 'hidden' : 'published';
  await saveCategory(actor, {
    id: category.id,
    name: category.name,
    nameBn: category.nameBn,
    slug: category.slug,
    description: category.description,
    iconName: category.iconName,
    imageUrl: category.imageUrl,
    parentCategoryId: category.parentCategoryId,
    displayOrder: category.displayOrder,
    publicationStatus: nextStatus,
    activeProductCount: category.activeProductCount,
  });
}

export async function swapCategoryDisplayOrder(
  actor: ActorContext,
  first: Category,
  second: Category
): Promise<void> {
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `categories/${first.id}`;
  const firstOrder = first.displayOrder;
  const secondOrder =
    second.displayOrder === firstOrder ? firstOrder + 1 : second.displayOrder;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'categories', first.id), {
      displayOrder: Math.max(0, Math.min(10000, secondOrder)),
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });
    batch.update(doc(db, 'categories', second.id), {
      displayOrder: Math.max(0, Math.min(10000, firstOrder)),
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });
    await batch.commit();

    await recordAdminAudit(
      actor,
      'categories',
      'CATEGORY_REORDERED',
      first.id,
      `${first.name} <-> ${second.name}`,
      `Updated storefront category order: "${first.name}" (#${secondOrder}), "${second.name}" (#${firstOrder}).`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function reconcileCategoryProductCounts(
  actor: ActorContext,
  categories: Category[],
  products: Product[]
): Promise<number> {
  if (categories.length === 0) return 0;
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = 'categories/reconcile';

  try {
    const batch = writeBatch(db);
    let updatedCategories = 0;

    for (const cat of categories) {
      const actualCount = products.filter((p) => {
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

      if (actualCount !== cat.activeProductCount) {
        updatedCategories += 1;
        batch.update(doc(db, 'categories', cat.id), {
          activeProductCount: actualCount,
          authorizedStaffUids: staffUids,
          updatedAt: serverTimestamp(),
        });
      }
    }

    if (updatedCategories > 0) {
      await batch.commit();
      await recordAdminAudit(
        actor,
        'categories',
        'CATEGORY_COUNTS_RECONCILED',
        'categories',
        `${updatedCategories} category count(s)`,
        `Reconciled activeProductCount across ${updatedCategories} category record(s) from live product catalog.`
      );
    }

    return updatedCategories;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function renameBrandAcrossProducts(
  actor: ActorContext,
  oldManufacturer: string,
  newManufacturer: string,
  products: Product[]
): Promise<number> {
  const cleanNew = sanitizeText(newManufacturer, 120);
  if (!cleanNew) {
    throw new Error('Valid brand / manufacturer name is required.');
  }
  const matching = products.filter(
    (p) => p.manufacturer.trim().toLowerCase() === oldManufacturer.trim().toLowerCase()
  );
  if (matching.length === 0) return 0;

  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = 'products/brand-rename';
  try {
    const batch = writeBatch(db);
    for (const prod of matching.slice(0, 450)) {
      batch.update(doc(db, 'products', prod.id), {
        manufacturer: cleanNew,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    await recordAdminAudit(
      actor,
      'products',
      'BRAND_STANDARDIZED',
      'brands',
      `${oldManufacturer} -> ${cleanNew}`,
      `Updated brand/manufacturer from "${oldManufacturer}" to "${cleanNew}" across ${matching.length} product(s).`
    );
    return matching.length;
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteCategorySafely(actor: ActorContext, category: Category): Promise<void> {
  if (category.activeProductCount > 0) {
    throw new Error(
      `Cannot delete "${category.name}" while it still contains ${category.activeProductCount} active product(s). Reassign or archive products first.`
    );
  }
  const path = `categories/${category.id}`;
  try {
    await deleteDoc(doc(db, 'categories', category.id));
    await recordAdminAudit(
      actor,
      'categories',
      'CATEGORY_DELETED',
      category.id,
      category.name,
      `Deleted empty category "${category.name}".`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

// ---------------------------------------------------------------------------
// 3. PRODUCT MANAGEMENT
// ---------------------------------------------------------------------------
export interface ProductFormInput {
  id?: string;
  name: string;
  slug?: string;
  genericName: string;
  manufacturer: string;
  categoryId: string;
  categoryName: string;
  subcategory: string;
  description: string;
  images: string[];
  unitSize: string;
  sellingPrice: number;
  previousPrice: number;
  stockQuantity: number;
  lowStockThreshold: number;
  sku: string;
  prescriptionType: Product['prescriptionType'];
  usageInstructions: string;
  storageInstructions: string;
  nearestExpiryDate: string;
  publicationStatus: Product['publicationStatus'];
  featured: boolean;
  popular: boolean;
}

export async function saveProduct(
  actor: ActorContext,
  input: ProductFormInput,
  previousProduct?: Product
): Promise<string> {
  const isEdit = Boolean(input.id && previousProduct);
  const productId = input.id || makeSafeDocId('prd');
  const path = `products/${productId}`;
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);

  const safeStock = Math.max(0, Math.round(Number(input.stockQuantity) || 0));
  const safeThreshold = Math.max(0, Math.round(Number(input.lowStockThreshold) || 10));
  const safeExpiry = sanitizeText(input.nearestExpiryDate, 32);
  const availabilityStatus = computeProductAvailability(safeStock, safeThreshold, safeExpiry);

  // Enforce expired-stock restriction: never allow expired product to remain published with sellable stock
  const effectivePubStatus: Product['publicationStatus'] =
    availabilityStatus === 'expired_restricted' && input.publicationStatus === 'published' && safeStock > 0
      ? 'draft'
      : input.publicationStatus;

  const cleanImages = (input.images || [])
    .map((u) => sanitizeSafeUrl(u, 500))
    .filter(Boolean)
    .slice(0, 6);

  const cleanSku = sanitizeText(input.sku, 64).replace(/[^a-zA-Z0-9_-]/g, '-');

  try {
    await runTransaction(db, async (tx) => {
      const catRef = doc(db, 'categories', input.categoryId);
      const catSnap = await tx.get(catRef);
      if (!catSnap.exists()) {
        throw new Error('Selected category does not exist.');
      }
      const catData = catSnap.data() as Omit<Category, 'id'>;

      let prevCatRef = null;
      let prevCatData: Omit<Category, 'id'> | null = null;
      if (isEdit && previousProduct && previousProduct.categoryId !== input.categoryId) {
        prevCatRef = doc(db, 'categories', previousProduct.categoryId);
        const prevCatSnap = await tx.get(prevCatRef);
        if (prevCatSnap.exists()) {
          prevCatData = prevCatSnap.data() as Omit<Category, 'id'>;
        }
      }

      const prodRef = doc(db, 'products', productId);
      if (!isEdit) {
        tx.set(prodRef, {
          name: sanitizeText(input.name, 160),
          slug: toSlug(input.slug || input.name, 160),
          genericName: sanitizeText(input.genericName, 160),
          manufacturer: sanitizeText(input.manufacturer, 120),
          categoryId: input.categoryId,
          categoryName: sanitizeText(catData.name, 100),
          subcategory: sanitizeText(input.subcategory, 100),
          description: sanitizeText(input.description, 2000),
          images: cleanImages,
          unitSize: sanitizeText(input.unitSize, 80),
          sellingPrice: Math.max(0, Number(input.sellingPrice) || 0),
          previousPrice: Math.max(0, Number(input.previousPrice) || 0),
          stockQuantity: safeStock,
          lowStockThreshold: safeThreshold,
          sku: cleanSku || `SKU-${Date.now().toString(36).toUpperCase()}`,
          availabilityStatus,
          prescriptionType: input.prescriptionType,
          usageInstructions: sanitizeText(input.usageInstructions, 1000),
          storageInstructions: sanitizeText(input.storageInstructions, 500),
          nearestExpiryDate: safeExpiry,
          publicationStatus: effectivePubStatus,
          featured: Boolean(input.featured),
          popular: Boolean(input.popular),
          storeId: SHARED_STORE_ID,
          authorizedStaffUids: staffUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });

        if (effectivePubStatus !== 'archived') {
          tx.update(catRef, {
            activeProductCount: Math.max(0, (catData.activeProductCount || 0) + 1),
            authorizedStaffUids: staffUids,
            updatedAt: serverTimestamp(),
          });
        }

        if (safeStock > 0) {
          const movId = makeSafeDocId('mov');
          tx.set(doc(db, 'inventoryMovements', movId), {
            productId,
            productName: sanitizeText(input.name, 160),
            sku: cleanSku || 'SKU-INIT',
            batchNumber: 'INITIAL-OPENING',
            movementType: 'stock_in',
            quantityDelta: safeStock,
            previousStock: 0,
            newStock: safeStock,
            reason: 'Initial opening inventory recorded on product creation',
            performedByUid: actor.uid,
            performedByEmail: sanitizeText(actor.email, 254),
            storeId: SHARED_STORE_ID,
            authorizedStaffUids: staffUids,
            createdAt: serverTimestamp(),
          });
        }
      } else if (previousProduct) {
        if (actor.role === 'inventory_manager') {
          tx.update(prodRef, {
            description: sanitizeText(input.description, 2000),
            images: cleanImages,
            unitSize: sanitizeText(input.unitSize, 80),
            stockQuantity: safeStock,
            lowStockThreshold: safeThreshold,
            sku: cleanSku,
            availabilityStatus,
            usageInstructions: sanitizeText(input.usageInstructions, 1000),
            storageInstructions: sanitizeText(input.storageInstructions, 500),
            nearestExpiryDate: safeExpiry,
            publicationStatus: effectivePubStatus,
            authorizedStaffUids: staffUids,
            updatedAt: serverTimestamp(),
          });
        } else {
          tx.update(prodRef, {
            name: sanitizeText(input.name, 160),
            slug: toSlug(input.slug || input.name, 160),
            genericName: sanitizeText(input.genericName, 160),
            manufacturer: sanitizeText(input.manufacturer, 120),
            categoryId: input.categoryId,
            categoryName: sanitizeText(catData.name, 100),
            subcategory: sanitizeText(input.subcategory, 100),
            description: sanitizeText(input.description, 2000),
            images: cleanImages,
            unitSize: sanitizeText(input.unitSize, 80),
            sellingPrice: Math.max(0, Number(input.sellingPrice) || 0),
            previousPrice: Math.max(0, Number(input.previousPrice) || 0),
            stockQuantity: safeStock,
            lowStockThreshold: safeThreshold,
            sku: cleanSku,
            availabilityStatus,
            prescriptionType: input.prescriptionType,
            usageInstructions: sanitizeText(input.usageInstructions, 1000),
            storageInstructions: sanitizeText(input.storageInstructions, 500),
            nearestExpiryDate: safeExpiry,
            publicationStatus: effectivePubStatus,
            featured: Boolean(input.featured),
            popular: Boolean(input.popular),
            authorizedStaffUids: staffUids,
            updatedAt: serverTimestamp(),
          });
        }

        const wasActive = previousProduct.publicationStatus !== 'archived';
        const isNowActive = effectivePubStatus !== 'archived';
        if (prevCatRef && prevCatData) {
          if (wasActive) {
            tx.update(prevCatRef, {
              activeProductCount: Math.max(0, (prevCatData.activeProductCount || 0) - 1),
              authorizedStaffUids: staffUids,
              updatedAt: serverTimestamp(),
            });
          }
          if (isNowActive) {
            tx.update(catRef, {
              activeProductCount: Math.max(0, (catData.activeProductCount || 0) + 1),
              authorizedStaffUids: staffUids,
              updatedAt: serverTimestamp(),
            });
          }
        } else if (wasActive !== isNowActive) {
          tx.update(catRef, {
            activeProductCount: Math.max(0, (catData.activeProductCount || 0) + (isNowActive ? 1 : -1)),
            authorizedStaffUids: staffUids,
            updatedAt: serverTimestamp(),
          });
        }

        if (safeStock !== previousProduct.stockQuantity) {
          const delta = safeStock - previousProduct.stockQuantity;
          const movId = makeSafeDocId('mov');
          tx.set(doc(db, 'inventoryMovements', movId), {
            productId,
            productName: sanitizeText(input.name, 160),
            sku: cleanSku,
            batchNumber: 'CATALOG-EDIT',
            movementType: delta > 0 ? 'adjustment_add' : 'adjustment_deduct',
            quantityDelta: delta,
            previousStock: previousProduct.stockQuantity,
            newStock: safeStock,
            reason: 'Stock updated during product catalog edit',
            performedByUid: actor.uid,
            performedByEmail: sanitizeText(actor.email, 254),
            storeId: SHARED_STORE_ID,
            authorizedStaffUids: staffUids,
            createdAt: serverTimestamp(),
          });
        }
      }
    });

    await recordAdminAudit(
      actor,
      'products',
      isEdit ? 'PRODUCT_UPDATED' : 'PRODUCT_CREATED',
      productId,
      input.name,
      `${isEdit ? 'Updated' : 'Created'} product "${input.name}" (SKU: ${cleanSku}, Price: BDT ${input.sellingPrice}, Status: ${effectivePubStatus}).`
    );
    return productId;
  } catch (error) {
    handleFirestoreError(error, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function bulkUpdateProductPublication(
  actor: ActorContext,
  productsToUpdate: Product[],
  targetStatus: Product['publicationStatus']
): Promise<void> {
  if (productsToUpdate.length === 0) return;
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = 'products/bulk';
  try {
    const batch = writeBatch(db);
    for (const prod of productsToUpdate) {
      if (prod.availabilityStatus === 'expired_restricted' && targetStatus === 'published' && prod.stockQuantity > 0) {
        continue;
      }
      batch.update(doc(db, 'products', prod.id), {
        publicationStatus: targetStatus,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });
    }
    await batch.commit();

    await recordAdminAudit(
      actor,
      'products',
      'PRODUCTS_BULK_STATUS',
      'bulk',
      `${productsToUpdate.length} products`,
      `Bulk updated ${productsToUpdate.length} products to publicationStatus="${targetStatus}".`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 4. INVENTORY, BATCHES & EXPIRY SAFETY
// ---------------------------------------------------------------------------
export async function receiveIncomingBatch(
  actor: ActorContext,
  product: Product,
  input: {
    batchNumber: string;
    supplierName: string;
    supplierContact: string;
    unitCostPrice: number;
    quantityReceived: number;
    manufacturingDate: string;
    expiryDate: string;
    notes: string;
  }
): Promise<void> {
  if (isDateExpired(input.expiryDate)) {
    throw new Error('Regulatory restriction: Cannot receive an already expired pharmaceutical batch into sellable stock.');
  }
  const qty = Math.max(1, Math.round(Number(input.quantityReceived) || 0));
  const batchId = makeSafeDocId('bat');
  const movId = makeSafeDocId('mov');
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const cleanBatchNo = sanitizeText(input.batchNumber, 64).replace(/[^a-zA-Z0-9_-]/g, '-');
  const batchStatus = computeBatchExpiryState(input.expiryDate, qty);

  const path = `productBatches/${batchId}`;
  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', product.id);
      const prodSnap = await tx.get(prodRef);
      if (!prodSnap.exists()) throw new Error('Target product does not exist.');
      const liveProd = prodSnap.data() as Omit<Product, 'id'>;

      const prevStock = liveProd.stockQuantity || 0;
      const newStock = prevStock + qty;
      const nextNearestExpiry =
        !liveProd.nearestExpiryDate || input.expiryDate < liveProd.nearestExpiryDate
          ? input.expiryDate
          : liveProd.nearestExpiryDate;
      const availabilityStatus = computeProductAvailability(newStock, liveProd.lowStockThreshold, nextNearestExpiry);

      tx.set(doc(db, 'productBatches', batchId), {
        productId: product.id,
        productName: sanitizeText(liveProd.name, 160),
        sku: liveProd.sku,
        batchNumber: cleanBatchNo,
        supplierName: sanitizeText(input.supplierName, 120),
        supplierContact: sanitizeText(input.supplierContact, 120),
        unitCostPrice: Math.max(0, Number(input.unitCostPrice) || 0),
        quantityReceived: qty,
        quantityRemaining: qty,
        manufacturingDate: sanitizeText(input.manufacturingDate, 32),
        expiryDate: sanitizeText(input.expiryDate, 32),
        status: batchStatus,
        notes: sanitizeText(input.notes, 500),
        recordedByUid: actor.uid,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      tx.update(prodRef, {
        stockQuantity: newStock,
        lowStockThreshold: liveProd.lowStockThreshold,
        availabilityStatus,
        nearestExpiryDate: nextNearestExpiry,
        publicationStatus: liveProd.publicationStatus,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'inventoryMovements', movId), {
        productId: product.id,
        productName: sanitizeText(liveProd.name, 160),
        sku: liveProd.sku,
        batchNumber: cleanBatchNo,
        movementType: 'stock_in',
        quantityDelta: qty,
        previousStock: prevStock,
        newStock,
        reason: sanitizeText(`Incoming batch ${cleanBatchNo} from ${input.supplierName}`, 400),
        performedByUid: actor.uid,
        performedByEmail: sanitizeText(actor.email, 254),
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });
    });

    await recordAdminAudit(
      actor,
      'inventory',
      'BATCH_RECEIVED',
      batchId,
      `${product.name} (${cleanBatchNo})`,
      `Received +${qty} units in batch ${cleanBatchNo}, expiry ${input.expiryDate}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function adjustInventoryAtomically(
  actor: ActorContext,
  productId: string,
  delta: number,
  reason: string,
  batchNumber = 'MANUAL-ADJ'
): Promise<void> {
  if (delta === 0) throw new Error('Quantity adjustment must be non-zero.');
  if (!reason || reason.trim().length < 3) {
    throw new Error('A clear audit reason (minimum 3 characters) is required for stock adjustments.');
  }

  const movId = makeSafeDocId('mov');
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `products/${productId}`;

  try {
    let productName = productId;
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', productId);
      const snap = await tx.get(prodRef);
      if (!snap.exists()) throw new Error('Product record not found.');
      const prod = snap.data() as Omit<Product, 'id'>;
      productName = prod.name;

      const prevStock = prod.stockQuantity || 0;
      const newStock = prevStock + delta;
      if (newStock < 0) {
        throw new Error(`Insufficient stock: current stock is ${prevStock}, cannot deduct ${Math.abs(delta)}.`);
      }

      const availabilityStatus = computeProductAvailability(newStock, prod.lowStockThreshold, prod.nearestExpiryDate);
      const nextPubStatus =
        availabilityStatus === 'expired_restricted' && prod.publicationStatus === 'published' && newStock > 0
          ? 'draft'
          : prod.publicationStatus;

      tx.update(prodRef, {
        stockQuantity: newStock,
        lowStockThreshold: prod.lowStockThreshold,
        availabilityStatus,
        nearestExpiryDate: prod.nearestExpiryDate,
        publicationStatus: nextPubStatus,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'inventoryMovements', movId), {
        productId,
        productName: sanitizeText(prod.name, 160),
        sku: prod.sku,
        batchNumber: sanitizeText(batchNumber, 64),
        movementType: delta > 0 ? 'adjustment_add' : 'adjustment_deduct',
        quantityDelta: delta,
        previousStock: prevStock,
        newStock,
        reason: sanitizeText(reason, 400),
        performedByUid: actor.uid,
        performedByEmail: sanitizeText(actor.email, 254),
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });
    });

    await recordAdminAudit(
      actor,
      'inventory',
      'STOCK_ADJUSTED',
      productId,
      productName,
      `Adjusted stock by ${delta > 0 ? `+${delta}` : delta}. Reason: ${reason}`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function quarantineBatchStock(actor: ActorContext, batchRecord: ProductBatch): Promise<void> {
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const movId = makeSafeDocId('mov');
  const path = `productBatches/${batchRecord.id}`;

  try {
    await runTransaction(db, async (tx) => {
      const batchRef = doc(db, 'productBatches', batchRecord.id);
      const prodRef = doc(db, 'products', batchRecord.productId);
      const [batchSnap, prodSnap] = await Promise.all([tx.get(batchRef), tx.get(prodRef)]);
      if (!batchSnap.exists() || !prodSnap.exists()) {
        throw new Error('Batch or product record missing.');
      }

      const bData = batchSnap.data() as Omit<ProductBatch, 'id'>;
      const pData = prodSnap.data() as Omit<Product, 'id'>;
      const deductQty = Math.min(pData.stockQuantity, bData.quantityRemaining);
      const newStock = Math.max(0, pData.stockQuantity - deductQty);
      const availabilityStatus = computeProductAvailability(newStock, pData.lowStockThreshold, '');

      tx.update(batchRef, {
        quantityRemaining: 0,
        status: 'expired_quarantined',
        notes: sanitizeText(`${bData.notes ? `${bData.notes} | ` : ''}Quarantined from sellable inventory`, 500),
        expiryDate: bData.expiryDate,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      tx.update(prodRef, {
        stockQuantity: newStock,
        lowStockThreshold: pData.lowStockThreshold,
        availabilityStatus,
        nearestExpiryDate: newStock === 0 ? '' : pData.nearestExpiryDate,
        publicationStatus: newStock === 0 && pData.publicationStatus === 'published' ? 'published' : pData.publicationStatus,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      tx.set(doc(db, 'inventoryMovements', movId), {
        productId: batchRecord.productId,
        productName: sanitizeText(pData.name, 160),
        sku: pData.sku,
        batchNumber: bData.batchNumber,
        movementType: 'expired_quarantine',
        quantityDelta: -deductQty,
        previousStock: pData.stockQuantity,
        newStock,
        reason: sanitizeText(`Quarantined expired/restricted batch ${bData.batchNumber} (Exp: ${bData.expiryDate})`, 400),
        performedByUid: actor.uid,
        performedByEmail: sanitizeText(actor.email, 254),
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });
    });

    await recordAdminAudit(
      actor,
      'inventory',
      'BATCH_QUARANTINED',
      batchRecord.id,
      `${batchRecord.productName} (${batchRecord.batchNumber})`,
      `Quarantined batch ${batchRecord.batchNumber} and removed remaining units from sellable stock.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ---------------------------------------------------------------------------
// 5. ORDERS, SUBCOLLECTIONS, PRESCRIPTIONS & PAYMENTS
// ---------------------------------------------------------------------------
export async function fetchOrderDetails(orderId: string): Promise<{
  items: OrderItem[];
  history: OrderStatusHistory[];
}> {
  const itemsPath = `orders/${orderId}/items`;
  const historyPath = `orders/${orderId}/statusHistory`;
  const currentUser = auth.currentUser;
  const isBootstrapped = isBootstrappedSuperAdminEmail(currentUser?.email);
  try {
    const itemsQ =
      isBootstrapped || !currentUser
        ? query(collection(db, 'orders', orderId, 'items'), where('storeId', '==', SHARED_STORE_ID))
        : query(
            collection(db, 'orders', orderId, 'items'),
            where('storeId', '==', SHARED_STORE_ID),
            where('authorizedStaffUids', 'array-contains', currentUser.uid)
          );
    const histQ =
      isBootstrapped || !currentUser
        ? query(
            collection(db, 'orders', orderId, 'statusHistory'),
            where('storeId', '==', SHARED_STORE_ID),
            orderBy('createdAt', 'desc')
          )
        : query(
            collection(db, 'orders', orderId, 'statusHistory'),
            where('storeId', '==', SHARED_STORE_ID),
            where('authorizedStaffUids', 'array-contains', currentUser.uid),
            orderBy('createdAt', 'desc')
          );

    const [itemsSnap, histSnap] = await Promise.all([getDocs(itemsQ), getDocs(histQ)]);
    const items = itemsSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, 'id'>) }));
    const history = histSnap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderStatusHistory, 'id'>) }));
    return { items, history };
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, `${itemsPath} | ${historyPath}`);
  }
}

export async function transitionOrderStatus(
  actor: ActorContext,
  order: Order,
  input: {
    nextStatus: OrderStatus;
    courierName?: string;
    trackingReference?: string;
    cancellationReason?: string;
    note?: string;
    reviewerLicenseOverride?: string;
  }
): Promise<void> {
  // 1. Validate state transition & clinical prescription gate on trusted backend
  const headers = await getBearerHeaders();
  const validationRes = await fetch('/api/orders/validate-transition', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      currentStatus: order.orderStatus,
      nextStatus: input.nextStatus,
      staffRole: actor.role,
      requiresPrescription: order.requiresPrescription,
      prescriptionReviewStatus: order.prescriptionReviewStatus,
      reviewerLicense: input.reviewerLicenseOverride || actor.licenseNumber || 'VERIFIED-RX',
      trackingReference: input.trackingReference ?? order.trackingReference,
      cancellationReason: input.cancellationReason ?? order.cancellationReason,
    }),
  });
  const validationBody = await parseJsonOrNull<{ allowed?: boolean; error?: string }>(
    validationRes
  );
  if (validationBody) {
    if (!validationRes.ok || !validationBody.allowed) {
      throw new Error(validationBody.error || 'Order status transition rejected by server policy.');
    }
  } else {
    // Enforce clinical prescription & shipping safety rules even on static-only hosts
    const fulfillmentStatuses = [
      'confirmed',
      'processing',
      'ready_for_dispatch',
      'shipped',
      'delivered',
    ];
    if (order.requiresPrescription && fulfillmentStatuses.includes(input.nextStatus)) {
      const lic = input.reviewerLicenseOverride || actor.licenseNumber || 'VERIFIED-RX';
      if (order.prescriptionReviewStatus !== 'approved' || lic.trim().length < 3) {
        throw new Error(
          'Clinical safety block: Prescription-only medicine orders require licensed prescription approval before dispatch.'
        );
      }
    }
    const trk = input.trackingReference ?? order.trackingReference;
    if (input.nextStatus === 'shipped' && (!trk || trk.trim().length < 3)) {
      throw new Error('A valid courier tracking reference is required before marking an order as Shipped.');
    }
  }

  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `orders/${order.id}`;

  try {
    // Load order items if cancelling so reserved stock is atomically restocked
    let itemsToRestock: OrderItem[] = [];
    if (input.nextStatus === 'cancelled' && order.orderStatus !== 'cancelled') {
      const itemsQ = query(collection(db, 'orders', order.id, 'items'), where('storeId', '==', SHARED_STORE_ID));
      const snap = await getDocs(itemsQ);
      itemsToRestock = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<OrderItem, 'id'>) }));
    }

    await runTransaction(db, async (tx) => {
      const orderRef = doc(db, 'orders', order.id);
      const orderSnap = await tx.get(orderRef);
      if (!orderSnap.exists()) throw new Error('Order not found.');

      // Pre-read all product docs for restocking (Firestore requires all reads before writes in transactions)
      const prodSnapshots = await Promise.all(
        itemsToRestock.map((item) => tx.get(doc(db, 'products', item.productId)))
      );

      let nextPaymentStatus = order.paymentStatus;
      if (input.nextStatus === 'cancelled' && order.paymentStatus === 'verified_paid') {
        nextPaymentStatus = 'refund_pending';
      } else if (input.nextStatus === 'refund_pending') {
        nextPaymentStatus = 'refund_pending';
      } else if (input.nextStatus === 'refunded') {
        nextPaymentStatus = 'refunded';
      }

      tx.update(orderRef, {
        orderStatus: input.nextStatus,
        paymentStatus: nextPaymentStatus,
        transactionReference: order.transactionReference,
        paymentVerifiedAt: order.paymentVerifiedAt,
        prescriptionReviewId: order.prescriptionReviewId,
        prescriptionReviewStatus: order.prescriptionReviewStatus,
        courierName: sanitizeText(input.courierName ?? order.courierName, 80),
        trackingReference: sanitizeText(input.trackingReference ?? order.trackingReference, 100),
        cancellationReason: sanitizeText(input.cancellationReason ?? order.cancellationReason, 300),
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      const histId = makeSafeDocId('hst');
      tx.set(doc(db, 'orders', order.id, 'statusHistory', histId), {
        orderId: order.id,
        fromStatus: order.orderStatus,
        toStatus: input.nextStatus,
        note: sanitizeText(
          input.note ||
            (input.nextStatus === 'cancelled'
              ? `Order cancelled: ${input.cancellationReason}`
              : `Transitioned to ${input.nextStatus}`),
          400
        ),
        changedByUid: actor.uid,
        changedByName: sanitizeText(actor.displayName, 120),
        changedByRole: actor.role,
        customerId: order.customerId,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });

      // Restock items atomically when order is cancelled
      itemsToRestock.forEach((item, idx) => {
        const prodSnap = prodSnapshots[idx];
        if (!prodSnap || !prodSnap.exists()) return;
        const pData = prodSnap.data() as Omit<Product, 'id'>;
        const prevStock = pData.stockQuantity || 0;
        const newStock = prevStock + item.quantity;
        const availabilityStatus = computeProductAvailability(
          newStock,
          pData.lowStockThreshold,
          pData.nearestExpiryDate
        );

        tx.update(doc(db, 'products', item.productId), {
          stockQuantity: newStock,
          availabilityStatus,
          updatedAt: serverTimestamp(),
        });

        const movId = makeSafeDocId('mov');
        tx.set(doc(db, 'inventoryMovements', movId), {
          productId: item.productId,
          productName: sanitizeText(pData.name, 160),
          sku: pData.sku,
          batchNumber: item.batchNumber || 'ORDER-RESTOCK',
          movementType: 'order_restocked',
          quantityDelta: item.quantity,
          previousStock: prevStock,
          newStock,
          reason: sanitizeText(`Restocked from cancelled order ${order.orderNumber}`, 400),
          performedByUid: actor.uid,
          performedByEmail: sanitizeText(actor.email, 254),
          storeId: SHARED_STORE_ID,
          authorizedStaffUids: staffUids,
          createdAt: serverTimestamp(),
        });
      });
    });

    await recordAdminAudit(
      actor,
      'orders',
      'ORDER_STATUS_UPDATED',
      order.id,
      order.orderNumber,
      `Order ${order.orderNumber}: ${order.orderStatus} -> ${input.nextStatus}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export type PaymentDecisionType = 'verify_paid' | 'mark_failed' | 'complete_refund';

export async function recordPaymentDecision(
  actor: ActorContext,
  order: Order,
  input: {
    decision: PaymentDecisionType;
    transactionReference: string;
    reconciliationConfirmed: boolean;
    reason?: string;
  }
): Promise<void> {
  const cleanRefInput = (input.transactionReference || '').trim().toUpperCase();
  const cleanReason = (input.reason || '').trim();

  // Client-side preflight validation (matches /api/payments/verify-gateway rules even on static hosts)
  if (input.decision === 'mark_failed') {
    if (cleanReason.length < 5) {
      throw new Error('A documented verification failure reason (minimum 5 characters) is required.');
    }
  } else if (input.decision === 'complete_refund') {
    if (cleanRefInput.length < 4) {
      throw new Error('A valid refund disbursement reference (minimum 4 characters) is required.');
    }
    if (!input.reconciliationConfirmed) {
      throw new Error('Confirm that the refund amount has been disbursed before marking as Refunded.');
    }
  } else {
    if (order.paymentMethod === 'bkash') {
      if (!/^[A-Z0-9]{8,14}$/.test(cleanRefInput)) {
        throw new Error(
          'bKash verification requires an 8–14 character alphanumeric Merchant TrxID verified against merchant settlement.'
        );
      }
      if (!input.reconciliationConfirmed) {
        throw new Error('Confirm merchant gateway settlement verification before marking bKash as paid.');
      }
    } else if (order.paymentMethod === 'nagad') {
      if (!/^[A-Z0-9\-]{8,18}$/.test(cleanRefInput)) {
        throw new Error('Nagad verification requires an 8–18 character merchant issuer reference ID.');
      }
      if (!input.reconciliationConfirmed) {
        throw new Error('Confirm Nagad merchant portal settlement verification before marking as paid.');
      }
    } else if (order.paymentMethod === 'cod') {
      if (cleanRefInput.length < 4) {
        throw new Error('Cash on Delivery settlement requires courier cash-collection receipt reference (min 4 chars).');
      }
    }
  }

  const headers = await getBearerHeaders();
  const res = await fetch('/api/payments/verify-gateway', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      orderId: order.id,
      paymentMethod: order.paymentMethod,
      decision: input.decision,
      transactionReference: cleanRefInput,
      reason: cleanReason,
      amountBdt: order.totalAmountBdt,
      staffRole: actor.role,
      reconciliationConfirmed: input.reconciliationConfirmed,
    }),
  });
  const body = await parseJsonOrNull<{
    verified?: boolean;
    error?: string;
    paymentStatus?: PaymentStatus;
    normalizedReference: string;
    paymentVerifiedAt: string;
  }>(res);

  const nowIso = new Date().toISOString();
  const resolved = body
    ? (() => {
        if (!res.ok || !body.verified) {
          throw new Error(body.error || 'Payment settlement decision failed on server.');
        }
        return {
          paymentStatus:
            body.paymentStatus ||
            (input.decision === 'mark_failed'
              ? 'failed'
              : input.decision === 'complete_refund'
              ? 'refunded'
              : 'verified_paid'),
          normalizedReference: body.normalizedReference,
          paymentVerifiedAt: body.paymentVerifiedAt,
        };
      })()
    : {
        paymentStatus: (input.decision === 'mark_failed'
          ? 'failed'
          : input.decision === 'complete_refund'
          ? 'refunded'
          : 'verified_paid') as PaymentStatus,
        normalizedReference:
          input.decision === 'mark_failed'
            ? `${cleanRefInput || 'NO-TRX'} [REJECTED]`
            : input.decision === 'complete_refund'
            ? `${cleanRefInput} [REFUNDED]`
            : cleanRefInput,
        paymentVerifiedAt: input.decision === 'mark_failed' ? '' : nowIso,
      };

  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `orders/${order.id}`;
  const nextOrderStatus: OrderStatus =
    input.decision === 'complete_refund' && order.orderStatus === 'refund_pending'
      ? 'refunded'
      : order.orderStatus;

  const historyNote =
    input.decision === 'mark_failed'
      ? `Payment marked FAILED (${order.paymentMethod.toUpperCase()}): ${cleanReason}${
          cleanRefInput ? ` [Submitted Ref: ${cleanRefInput}]` : ''
        }`
      : input.decision === 'complete_refund'
      ? `Refund completed (${order.paymentMethod.toUpperCase()}): ${resolved.normalizedReference}${
          cleanReason ? ` · ${cleanReason}` : ''
        }`
      : `Payment verified (${order.paymentMethod.toUpperCase()}): ${resolved.normalizedReference}`;

  const auditAction =
    input.decision === 'mark_failed'
      ? 'PAYMENT_MARKED_FAILED'
      : input.decision === 'complete_refund'
      ? 'PAYMENT_REFUND_COMPLETED'
      : 'PAYMENT_VERIFIED';

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'orders', order.id), {
      orderStatus: nextOrderStatus,
      paymentStatus: resolved.paymentStatus,
      transactionReference: sanitizeText(resolved.normalizedReference, 100),
      paymentVerifiedAt: sanitizeText(resolved.paymentVerifiedAt, 40),
      prescriptionReviewId: order.prescriptionReviewId,
      prescriptionReviewStatus: order.prescriptionReviewStatus,
      courierName: order.courierName,
      trackingReference: order.trackingReference,
      cancellationReason: order.cancellationReason,
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });

    const histId = makeSafeDocId('hst');
    batch.set(doc(db, 'orders', order.id, 'statusHistory', histId), {
      orderId: order.id,
      fromStatus: order.orderStatus,
      toStatus: nextOrderStatus,
      note: sanitizeText(historyNote, 400),
      changedByUid: actor.uid,
      changedByName: sanitizeText(actor.displayName, 120),
      changedByRole: actor.role,
      customerId: order.customerId,
      storeId: SHARED_STORE_ID,
      authorizedStaffUids: staffUids,
      createdAt: serverTimestamp(),
    });

    await batch.commit();

    await recordAdminAudit(
      actor,
      'payments',
      auditAction,
      order.id,
      order.orderNumber,
      sanitizeText(
        `${historyNote} (Amount: BDT ${order.totalAmountBdt}).`,
        450
      )
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function verifyPaymentSettlement(
  actor: ActorContext,
  order: Order,
  input: {
    transactionReference: string;
    reconciliationConfirmed: boolean;
  }
): Promise<void> {
  await recordPaymentDecision(actor, order, {
    decision: 'verify_paid',
    transactionReference: input.transactionReference,
    reconciliationConfirmed: input.reconciliationConfirmed,
  });
}

export async function reviewPrescriptionSubmission(
  actor: ActorContext,
  review: PrescriptionReview,
  linkedOrder: Order | undefined,
  decision: {
    reviewStatus: 'approved' | 'rejected' | 'more_info_requested';
    reviewerLicense: string;
    reviewNotes: string;
  }
): Promise<void> {
  const cleanLicense = sanitizeText(decision.reviewerLicense || actor.licenseNumber, 64);
  if (cleanLicense.length < 3) {
    throw new Error('Qualified Pharmacy Council / BMDC registration license is required to record a clinical prescription decision.');
  }
  if (!decision.reviewNotes || decision.reviewNotes.trim().length < 5) {
    throw new Error('Clinical review notes (minimum 5 characters) are required.');
  }

  const reviewedAtIso = new Date().toISOString();
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `prescriptionReviews/${review.id}`;

  try {
    const batch = writeBatch(db);
    batch.update(doc(db, 'prescriptionReviews', review.id), {
      reviewStatus: decision.reviewStatus,
      reviewerUid: actor.uid,
      reviewerName: sanitizeText(actor.displayName, 120),
      reviewerLicense: cleanLicense,
      reviewNotes: sanitizeText(decision.reviewNotes, 600),
      reviewedAt: reviewedAtIso,
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });

    if (linkedOrder && !(linkedOrder.orderStatus in { cancelled: true, refunded: true })) {
      const nextOrderStatus: OrderStatus =
        decision.reviewStatus === 'approved' && linkedOrder.orderStatus === 'awaiting_review'
          ? 'confirmed'
          : linkedOrder.orderStatus;

      batch.update(doc(db, 'orders', linkedOrder.id), {
        orderStatus: nextOrderStatus,
        paymentStatus: linkedOrder.paymentStatus,
        transactionReference: linkedOrder.transactionReference,
        paymentVerifiedAt: linkedOrder.paymentVerifiedAt,
        prescriptionReviewId: review.id,
        prescriptionReviewStatus: decision.reviewStatus,
        courierName: linkedOrder.courierName,
        trackingReference: linkedOrder.trackingReference,
        cancellationReason: linkedOrder.cancellationReason,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });

      const histId = makeSafeDocId('hst');
      batch.set(doc(db, 'orders', linkedOrder.id, 'statusHistory', histId), {
        orderId: linkedOrder.id,
        fromStatus: linkedOrder.orderStatus,
        toStatus: nextOrderStatus,
        note: sanitizeText(
          `Prescription review ${decision.reviewStatus.toUpperCase()} by ${actor.displayName} (Reg: ${cleanLicense}): ${decision.reviewNotes}`,
          400
        ),
        changedByUid: actor.uid,
        changedByName: sanitizeText(actor.displayName, 120),
        changedByRole: actor.role,
        customerId: linkedOrder.customerId,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });
    }

    await batch.commit();

    await recordAdminAudit(
      actor,
      'prescriptions',
      `PRESCRIPTION_${decision.reviewStatus.toUpperCase()}`,
      review.id,
      review.orderNumber,
      `Prescription ${decision.reviewStatus} by ${actor.displayName} (License: ${cleanLicense}).`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 6. CUSTOMERS & SUPPORT TICKETS
// ---------------------------------------------------------------------------
export async function fetchCustomerPrivatePii(customerId: string): Promise<UserPrivateProfile | null> {
  const path = `users/${customerId}/privateProfile/pii`;
  try {
    const snap = await getDoc(doc(db, 'users', customerId, 'privateProfile', 'pii'));
    if (!snap.exists()) return null;
    return snap.data() as UserPrivateProfile;
  } catch (error) {
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function updateCustomerStanding(
  actor: ActorContext,
  customer: UserAccount,
  nextStatus: UserAccount['accountStatus'],
  reason: string
): Promise<void> {
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `users/${customer.id}`;
  try {
    await updateDoc(doc(db, 'users', customer.id), {
      displayName: customer.displayName,
      accountStatus: nextStatus,
      orderCount: customer.orderCount,
      totalSpentBdt: customer.totalSpentBdt,
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });

    await recordAdminAudit(
      actor,
      'customers',
      'CUSTOMER_STATUS_UPDATED',
      customer.id,
      customer.displayName,
      `Updated customer account standing to "${nextStatus}". Reason: ${reason}. (Note: Firebase Auth identity disablement/deletion is managed separately via Identity Toolkit / Admin console.)`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function updateSupportTicketStatus(
  actor: ActorContext,
  ticket: SupportTicket,
  updates: {
    priority: SupportTicket['priority'];
    status: SupportTicket['status'];
    staffResolutionNote: string;
  }
): Promise<void> {
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `supportTickets/${ticket.id}`;
  try {
    await updateDoc(doc(db, 'supportTickets', ticket.id), {
      priority: updates.priority,
      status: updates.status,
      staffResolutionNote: sanitizeText(updates.staffResolutionNote, 1500),
      assignedToUid: actor.uid,
      authorizedStaffUids: staffUids,
      updatedAt: serverTimestamp(),
    });

    await recordAdminAudit(
      actor,
      'customers',
      'SUPPORT_TICKET_UPDATED',
      ticket.id,
      ticket.ticketNumber,
      `Support ticket ${ticket.ticketNumber} marked "${updates.status}".`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ---------------------------------------------------------------------------
// 7. COUPONS, DELIVERY ZONES & WEBSITE CMS
// ---------------------------------------------------------------------------
export async function saveCouponRecord(
  actor: ActorContext,
  input: Omit<Coupon, 'id' | 'storeId' | 'authorizedStaffUids' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const isEdit = Boolean(input.id);
  const cleanCode = sanitizeText(input.code.toUpperCase(), 32).replace(/[^A-Z0-9_-]/g, '');
  const couponId = input.id || `cpn_${cleanCode.toLowerCase()}`;
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `coupons/${couponId}`;

  try {
    if (!isEdit) {
      await setDoc(doc(db, 'coupons', couponId), {
        code: cleanCode,
        description: sanitizeText(input.description, 240),
        discountType: input.discountType,
        discountValue: Math.max(1, Number(input.discountValue) || 1),
        minOrderAmountBdt: Math.max(0, Number(input.minOrderAmountBdt) || 0),
        maxDiscountBdt: Math.max(0, Number(input.maxDiscountBdt) || 0),
        startDate: sanitizeText(input.startDate, 32),
        endDate: sanitizeText(input.endDate, 32),
        usageLimit: Math.max(1, Number(input.usageLimit) || 100),
        usedCount: 0,
        applicableCategory: sanitizeText(input.applicableCategory || 'all', 100),
        status: input.status,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'coupons', couponId), {
        description: sanitizeText(input.description, 240),
        discountType: input.discountType,
        discountValue: Math.max(1, Number(input.discountValue) || 1),
        minOrderAmountBdt: Math.max(0, Number(input.minOrderAmountBdt) || 0),
        maxDiscountBdt: Math.max(0, Number(input.maxDiscountBdt) || 0),
        startDate: sanitizeText(input.startDate, 32),
        endDate: sanitizeText(input.endDate, 32),
        usageLimit: Math.max(1, Number(input.usageLimit) || 100),
        usedCount: Math.max(0, Number(input.usedCount) || 0),
        applicableCategory: sanitizeText(input.applicableCategory || 'all', 100),
        status: input.status,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminAudit(
      actor,
      'coupons',
      isEdit ? 'COUPON_UPDATED' : 'COUPON_CREATED',
      couponId,
      cleanCode,
      `${isEdit ? 'Updated' : 'Created'} coupon ${cleanCode} (${input.discountType}: ${input.discountValue}).`
    );
  } catch (error) {
    handleFirestoreError(error, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function calculateDiscountViaBackend(params: {
  subtotalBdt: number;
  deliveryFeeBdt: number;
  coupon: Coupon | null;
  itemCategories: string[];
}): Promise<{
  valid: boolean;
  subtotalBdt: number;
  discountBdt: number;
  deliveryFeeBdt: number;
  totalAmountBdt: number;
}> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/discounts/calculate', {
    method: 'POST',
    headers,
    body: JSON.stringify(params),
  });
  const body = await parseJsonOrNull<{
    valid: boolean;
    error?: string;
    subtotalBdt: number;
    discountBdt: number;
    deliveryFeeBdt: number;
    totalAmountBdt: number;
  }>(res);
  if (body) {
    if (!res.ok || !body.valid) {
      throw new Error(body.error || 'Coupon validation failed.');
    }
    return body;
  }
  const safeSubtotal = Math.max(0, Number(params.subtotalBdt) || 0);
  const safeDelivery = Math.max(0, Number(params.deliveryFeeBdt) || 0);
  if (!params.coupon) {
    return {
      valid: true,
      subtotalBdt: safeSubtotal,
      discountBdt: 0,
      deliveryFeeBdt: safeDelivery,
      totalAmountBdt: safeSubtotal + safeDelivery,
    };
  }
  const rawDisc =
    params.coupon.discountType === 'percentage'
      ? Math.round((safeSubtotal * Math.min(90, Math.max(0, params.coupon.discountValue))) / 100)
      : Math.round(Math.max(0, params.coupon.discountValue));
  const capped =
    params.coupon.maxDiscountBdt > 0 ? Math.min(rawDisc, params.coupon.maxDiscountBdt) : rawDisc;
  const discountBdt = Math.min(capped, safeSubtotal);
  return {
    valid: true,
    subtotalBdt: safeSubtotal,
    discountBdt,
    deliveryFeeBdt: safeDelivery,
    totalAmountBdt: Math.max(0, safeSubtotal - discountBdt + safeDelivery),
  };
}

export async function deleteCouponRecord(
  actor: ActorContext,
  coupon: Coupon
): Promise<void> {
  const path = `coupons/${coupon.id}`;
  try {
    await deleteDoc(doc(db, 'coupons', coupon.id));
    await recordAdminAudit(
      actor,
      'coupons',
      'COUPON_DELETED',
      coupon.id,
      coupon.code,
      `Deleted promotional coupon ${coupon.code}.`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function saveDeliveryZoneRecord(
  actor: ActorContext,
  input: Omit<DeliveryZone, 'id' | 'storeId' | 'authorizedStaffUids' | 'createdAt' | 'updatedAt'> & { id?: string }
): Promise<void> {
  const isEdit = Boolean(input.id);
  const zoneId = input.id || makeSafeDocId('zne');
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = `deliveryZones/${zoneId}`;

  try {
    if (!isEdit) {
      await setDoc(doc(db, 'deliveryZones', zoneId), {
        zoneName: sanitizeText(input.zoneName, 80),
        coverageAreas: sanitizeText(input.coverageAreas, 400),
        deliveryFeeBdt: Math.max(0, Number(input.deliveryFeeBdt) || 0),
        freeDeliveryMinOrderBdt: Math.max(0, Number(input.freeDeliveryMinOrderBdt) || 0),
        estimatedDeliveryText: sanitizeText(input.estimatedDeliveryText, 80),
        courierPartner: sanitizeText(input.courierPartner, 80),
        instructions: sanitizeText(input.instructions, 300),
        status: input.status,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'deliveryZones', zoneId), {
        zoneName: sanitizeText(input.zoneName, 80),
        coverageAreas: sanitizeText(input.coverageAreas, 400),
        deliveryFeeBdt: Math.max(0, Number(input.deliveryFeeBdt) || 0),
        freeDeliveryMinOrderBdt: Math.max(0, Number(input.freeDeliveryMinOrderBdt) || 0),
        estimatedDeliveryText: sanitizeText(input.estimatedDeliveryText, 80),
        courierPartner: sanitizeText(input.courierPartner, 80),
        instructions: sanitizeText(input.instructions, 300),
        status: input.status,
        authorizedStaffUids: staffUids,
        updatedAt: serverTimestamp(),
      });
    }

    await recordAdminAudit(
      actor,
      'payments',
      isEdit ? 'DELIVERY_ZONE_UPDATED' : 'DELIVERY_ZONE_CREATED',
      zoneId,
      input.zoneName,
      `${isEdit ? 'Updated' : 'Created'} delivery zone "${input.zoneName}" (Fee: BDT ${input.deliveryFeeBdt}).`
    );
  } catch (error) {
    handleFirestoreError(error, isEdit ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export async function deleteDeliveryZoneRecord(
  actor: ActorContext,
  zone: DeliveryZone
): Promise<void> {
  const path = `deliveryZones/${zone.id}`;
  try {
    await deleteDoc(doc(db, 'deliveryZones', zone.id));
    await recordAdminAudit(
      actor,
      'payments',
      'DELIVERY_ZONE_DELETED',
      zone.id,
      zone.zoneName,
      `Deleted delivery zone "${zone.zoneName}".`
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function ensureDefaultDeliveryZones(
  actor: ActorContext,
  existingZones: DeliveryZone[]
): Promise<number> {
  const existingNames = new Set(existingZones.map((z) => z.zoneName.trim().toLowerCase()));
  const defaults: Array<
    Omit<DeliveryZone, 'id' | 'storeId' | 'authorizedStaffUids' | 'createdAt' | 'updatedAt'>
  > = [
    {
      zoneName: 'Inside Dhaka Metro',
      coverageAreas: 'Dhanmondi, Gulshan, Banani, Uttara, Mirpur, Mohammadpur, Motijheel, Badda',
      deliveryFeeBdt: 60,
      freeDeliveryMinOrderBdt: 1500,
      estimatedDeliveryText: '1–2 Days Inside Dhaka',
      courierPartner: 'Own Pharmacy Dispatch / Pathao Pharma',
      instructions: 'Temperature-controlled insulated pouch used for heat-sensitive medicines.',
      status: 'active',
    },
    {
      zoneName: 'Outside Dhaka (All Districts)',
      coverageAreas: 'Chattogram, Sylhet, Rajshahi, Khulna, Barishal, Rangpur, Mymensingh & Sadar Upazilas',
      deliveryFeeBdt: 120,
      freeDeliveryMinOrderBdt: 1500,
      estimatedDeliveryText: '3–5 Days Nationwide',
      courierPartner: 'Steadfast / Sundarban Sealed Courier',
      instructions: 'Tamper-evident outer packaging with invoice and batch verification slip.',
      status: 'active',
    },
  ];

  let created = 0;
  for (const z of defaults) {
    if (!existingNames.has(z.zoneName.trim().toLowerCase())) {
      await saveDeliveryZoneRecord(actor, z);
      created += 1;
    }
  }
  return created;
}

export interface PaymentGatewayMerchantConfig {
  bkashNumber: string;
  bkashAccountType: 'Merchant Payment' | 'Personal Send Money';
  nagadNumber: string;
  nagadAccountType: 'Merchant Payment' | 'Personal Send Money';
  rocketNumber: string;
  codTerms: string;
  checkoutSafetyNotice: string;
}

export function parsePaymentGatewayConfig(
  rawPolicy: string | undefined | null
): PaymentGatewayMerchantConfig {
  const fallback: PaymentGatewayMerchantConfig = {
    bkashNumber: '',
    bkashAccountType: 'Merchant Payment',
    nagadNumber: '',
    nagadAccountType: 'Merchant Payment',
    rocketNumber: '',
    codTerms: 'ঢাকার ভেতরে ও বাইরে ডেলিভারি ম্যানের কাছে পণ্য বুঝে নগদ পরিশোধযোগ্য (৳1500+ অর্ডারে ফ্রি ডেলিভারি)।',
    checkoutSafetyNotice:
      'নিরাপদ পেমেন্ট পদ্ধতি: Cash on Delivery (COD), bKash এবং Nagad মার্চেন্ট পেমেন্ট। আপনার গোপন PIN বা OTP কখনো কাউকে জানাবেন না।',
  };

  if (!rawPolicy || !rawPolicy.trim()) {
    return fallback;
  }

  const lines = rawPolicy.split('\n').map((l) => l.trim()).filter(Boolean);
  let hasStructuredTag = false;
  const noticeLines: string[] = [];

  for (const line of lines) {
    if (line.startsWith('[bKash ')) {
      hasStructuredTag = true;
      const m = line.match(/^\[bKash\s+(Merchant Payment|Personal Send Money)\]:\s*(.*)$/i);
      if (m) {
        fallback.bkashAccountType =
          m[1].toLowerCase() === 'personal send money' ? 'Personal Send Money' : 'Merchant Payment';
        fallback.bkashNumber = m[2].trim();
      }
    } else if (line.startsWith('[Nagad ')) {
      hasStructuredTag = true;
      const m = line.match(/^\[Nagad\s+(Merchant Payment|Personal Send Money)\]:\s*(.*)$/i);
      if (m) {
        fallback.nagadAccountType =
          m[1].toLowerCase() === 'personal send money' ? 'Personal Send Money' : 'Merchant Payment';
        fallback.nagadNumber = m[2].trim();
      }
    } else if (line.startsWith('[Rocket/Alt MFS]:')) {
      hasStructuredTag = true;
      fallback.rocketNumber = line.slice('[Rocket/Alt MFS]:'.length).trim();
    } else if (line.startsWith('[COD Policy]:')) {
      hasStructuredTag = true;
      fallback.codTerms = line.slice('[COD Policy]:'.length).trim() || fallback.codTerms;
    } else {
      noticeLines.push(line);
    }
  }

  if (noticeLines.length > 0) {
    fallback.checkoutSafetyNotice = noticeLines.join(' ');
  } else if (!hasStructuredTag) {
    fallback.checkoutSafetyNotice = rawPolicy.trim();
  }

  return fallback;
}

export function serializePaymentGatewayConfig(config: PaymentGatewayMerchantConfig): string {
  const parts: string[] = [];
  const cleanNotice = sanitizeText(config.checkoutSafetyNotice, 600);
  if (cleanNotice) {
    parts.push(cleanNotice);
  }
  const cleanBkash = sanitizeText(config.bkashNumber, 40);
  if (cleanBkash) {
    parts.push(`[bKash ${config.bkashAccountType}]: ${cleanBkash}`);
  }
  const cleanNagad = sanitizeText(config.nagadNumber, 40);
  if (cleanNagad) {
    parts.push(`[Nagad ${config.nagadAccountType}]: ${cleanNagad}`);
  }
  const cleanRocket = sanitizeText(config.rocketNumber, 40);
  if (cleanRocket) {
    parts.push(`[Rocket/Alt MFS]: ${cleanRocket}`);
  }
  const cleanCod = sanitizeText(config.codTerms, 350);
  if (cleanCod) {
    parts.push(`[COD Policy]: ${cleanCod}`);
  }
  return parts.join('\n').slice(0, 1500);
}

export async function saveSiteSettingsConfig(
  actor: ActorContext,
  input: Omit<SiteSettings, 'id' | 'storeId' | 'authorizedStaffUids' | 'updatedByUid' | 'createdAt' | 'updatedAt'>,
  existsAlready: boolean
): Promise<void> {
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const path = 'siteSettings/storefront_config';
  const payload = {
    siteName: sanitizeText(input.siteName, 120),
    tagline: sanitizeText(input.tagline, 160),
    taglineBn: sanitizeText(input.taglineBn, 160),
    logoUrl: sanitizeSafeUrl(input.logoUrl, 500),
    faviconUrl: sanitizeSafeUrl(input.faviconUrl, 500),
    heroTitle: sanitizeText(input.heroTitle, 160),
    heroSubtitle: sanitizeText(input.heroSubtitle, 400),
    heroBannerUrl: sanitizeSafeUrl(input.heroBannerUrl, 500),
    heroCtaText: sanitizeText(input.heroCtaText, 60),
    promoBannerText: sanitizeText(input.promoBannerText, 240),
    featuredCategorySlugs: (input.featuredCategorySlugs || []).map((s) => sanitizeText(s, 100)).filter(Boolean).slice(0, 8),
    homepageSectionOrder: (input.homepageSectionOrder || []).map((s) => sanitizeText(s, 60)).filter(Boolean).slice(0, 8),
    navigationLinks: (input.navigationLinks || []).map((s) => sanitizeText(s, 160)).filter(Boolean).slice(0, 8),
    supportPhone: sanitizeText(input.supportPhone, 40),
    supportEmail: sanitizeText(input.supportEmail, 254),
    supportHours: sanitizeText(input.supportHours, 80),
    pharmacyLicenseNo: sanitizeText(input.pharmacyLicenseNo, 80),
    deliveryInfoPolicy: sanitizeText(input.deliveryInfoPolicy, 1500),
    paymentInfoPolicy: sanitizeText(input.paymentInfoPolicy, 1500),
    enabledPaymentMethods: (input.enabledPaymentMethods || []).map((s) => sanitizeText(s, 32)).filter(Boolean).slice(0, 5),
    faqContent: sanitizeText(input.faqContent, 2500),
    termsAndConditions: sanitizeText(input.termsAndConditions, 3000),
    privacyPolicy: sanitizeText(input.privacyPolicy, 3000),
    returnRefundPolicy: sanitizeText(input.returnRefundPolicy, 2500),
    authorizedStaffUids: staffUids,
    updatedByUid: actor.uid,
    updatedAt: serverTimestamp(),
  };

  try {
    if (!existsAlready) {
      await setDoc(doc(db, 'siteSettings', 'storefront_config'), {
        ...payload,
        storeId: SHARED_STORE_ID,
        createdAt: serverTimestamp(),
      });
    } else {
      await updateDoc(doc(db, 'siteSettings', 'storefront_config'), payload);
    }

    await recordAdminAudit(
      actor,
      'cms',
      'SITE_SETTINGS_SAVED',
      'storefront_config',
      input.siteName,
      'Updated shared Customer Panel CMS branding, hero banner, navigation, and legal policies.'
    );
  } catch (error) {
    handleFirestoreError(error, existsAlready ? OperationType.UPDATE : OperationType.CREATE, path);
  }
}

export function buildDefaultStorefrontSettingsPayload(
  existing?: SiteSettings | null
): Omit<
  SiteSettings,
  'id' | 'storeId' | 'authorizedStaffUids' | 'updatedByUid' | 'createdAt' | 'updatedAt'
> {
  return {
    siteName: existing?.siteName || 'Finesteride Recur 1Mg Shop Bd',
    tagline: existing?.tagline || 'Your Health Our Priority',
    taglineBn: existing?.taglineBn || 'আপনার স্বাস্থ্যসেবার বিশ্বস্ত অনলাইন সঙ্গী',
    logoUrl: existing?.logoUrl || '',
    faviconUrl: existing?.faviconUrl || '',
    heroTitle: existing?.heroTitle || 'চলমান ফার্মেসি অফার ও ফ্রি ডেলিভারি',
    heroSubtitle:
      existing?.heroSubtitle ||
      '৳1500+ অর্ডারে সারা বাংলাদেশে ডেলিভারি চার্জ সম্পূর্ণ ফ্রি! এছাড়া চেকআউটে অনুমোদিত কুপন কোড ব্যবহার করুন।',
    heroBannerUrl:
      existing?.heroBannerUrl ||
      '/assets/aistudio/867081142_122283788462156715_1316202229849569188_n_60369be3.jpg',
    heroCtaText: existing?.heroCtaText || 'কুপন উদাহরণ: HEALTH50 · CARE10',
    promoBannerText:
      existing?.promoBannerText ||
      'সারা বাংলাদেশে হোম ডেলিভারি · নিবন্ধিত সরবরাহকারী থেকে সংগৃহীত পণ্য',
    featuredCategorySlugs:
      existing?.featuredCategorySlugs && existing.featuredCategorySlugs.length > 0
        ? existing.featuredCategorySlugs
        : OFFICIAL_STOREFRONT_CATEGORIES.map((c) => c.slug),
    homepageSectionOrder:
      existing?.homepageSectionOrder && existing.homepageSectionOrder.length > 0
        ? existing.homepageSectionOrder
        : ['hero_banner', 'featured_categories', 'popular_products', 'trust_guarantees'],
    navigationLinks:
      existing?.navigationLinks && existing.navigationLinks.length > 0
        ? existing.navigationLinks
        : [
            'হোম|/',
            'ব্র্যান্ড|/brands',
            'অফার|/offers',
            'আমাদের সম্পর্কে|/about',
            'যোগাযোগ|/contact',
            'অর্ডার ট্র্যাকিং|/track-order',
          ],
    supportPhone: existing?.supportPhone || '+880 1700-000000',
    supportEmail: existing?.supportEmail || 'support@finesterideshopbd.example',
    supportHours: existing?.supportHours || '9:00 AM – 10:00 PM (Daily)',
    pharmacyLicenseNo: existing?.pharmacyLicenseNo || 'DGDA-MODEL-PHARM-BD-PENDING',
    deliveryInfoPolicy:
      existing?.deliveryInfoPolicy ||
      '৳1500+ অর্ডারে সারা বাংলাদেশে ফ্রি ডেলিভারি। ঢাকার ভেতরে ১–২ কার্যদিবস (৳60) এবং ঢাকার বাইরে ৩–৫ কার্যদিবস (৳120)। প্রেসক্রিপশন ঔষধ নিবন্ধিত ফার্মাসিস্ট যাচাইয়ের পর প্রেরণ করা হয়।',
    paymentInfoPolicy:
      existing?.paymentInfoPolicy ||
      'নিরাপদ পেমেন্ট পদ্ধতি: Cash on Delivery (COD), bKash এবং Nagad মার্চেন্ট পেমেন্ট। আপনার গোপন PIN বা OTP কখনো কাউকে জানাবেন না।',
    enabledPaymentMethods:
      existing?.enabledPaymentMethods && existing.enabledPaymentMethods.length > 0
        ? existing.enabledPaymentMethods
        : ['cod', 'bkash', 'nagad'],
    faqContent:
      existing?.faqContent ||
      'আমাদের সম্পর্কে (About Us): Finesteride Recur 1Mg Shop Bd নিবন্ধিত সরবরাহকারী থেকে সংগৃহীত শতভাগ আসল ঔষধ, হারবাল পণ্য, ভিটামিন ও স্বাস্থ্যসামগ্রী সারা বাংলাদেশে সরবরাহ করে।\n১. প্রেসক্রিপশন ঔষধের জন্য কি ডাক্তারের প্রেসক্রিপশন আবশ্যক? হ্যাঁ, BMDC নিবন্ধিত চিকিৎসকের প্রেসক্রিপশন যাচাইয়ের পর অর্ডার কনফার্ম করা হয়।\n২. অর্ডার ট্র্যাকিং কিভাবে করবো? অর্ডার নম্বর ও মোবাইল নম্বর দিয়ে অর্ডার ট্র্যাকিং মেনু থেকে লাইভ স্ট্যাটাস দেখা যাবে।',
    termsAndConditions:
      existing?.termsAndConditions ||
      'সকল বিক্রয় ও বিতরণ বাংলাদেশ ঔষধ প্রশাসন অধিদপ্তর (DGDA) এর নীতিমালা অনুসরণ করে পরিচালিত হয়। মেয়াদোত্তীর্ণ বা নিষিদ্ধ ঔষধ বিক্রয় সম্পূর্ণ ব্লক করা থাকে।',
    privacyPolicy:
      existing?.privacyPolicy ||
      'গ্রাহকের ব্যক্তিগত তথ্য ও প্রেসক্রিপশন সম্পূর্ণ সুরক্ষিত এবং শুধুমাত্র অনুমোদিত ফার্মেসি কর্মকর্তাদের যাচাইয়ের জন্য সংরক্ষিত থাকে।',
    returnRefundPolicy:
      existing?.returnRefundPolicy ||
      'সিল অক্ষত থাকা সাপেক্ষে ভুল বা ক্ষতিগ্রস্ত পণ্য ডেলিভারির ৩ দিনের মধ্যে রিটার্ন ও রিফান্ড নীতিমালার আওতায় বিবেচিত হবে।',
  };
}

export async function toggleCategoryInStorefrontNavbar(
  actor: ActorContext,
  categorySlug: string,
  siteSettings: SiteSettings | null
): Promise<boolean> {
  const basePayload = buildDefaultStorefrontSettingsPayload(siteSettings);
  const currentSlugs = basePayload.featuredCategorySlugs || [];
  const exists = currentSlugs.includes(categorySlug);
  let nextSlugs: string[];

  if (exists) {
    nextSlugs = currentSlugs.filter((s) => s !== categorySlug);
  } else {
    if (currentSlugs.length >= 8) {
      throw new Error('Maximum 8 primary category tabs can be pinned directly in the top storefront navigation bar.');
    }
    nextSlugs = [...currentSlugs, categorySlug];
  }

  await saveSiteSettingsConfig(
    actor,
    {
      ...basePayload,
      featuredCategorySlugs: nextSlugs,
    },
    Boolean(siteSettings)
  );

  return !exists;
}

export async function ensureDefaultStorefrontCoupons(
  actor: ActorContext,
  existingCoupons: Coupon[]
): Promise<number> {
  const existingCodes = new Set(existingCoupons.map((c) => c.code.trim().toUpperCase()));
  const todayIso = new Date().toISOString().slice(0, 10);
  const nextYear = new Date();
  nextYear.setDate(nextYear.getDate() + 365);
  const endDateIso = nextYear.toISOString().slice(0, 10);

  const defaults: Array<
    Omit<Coupon, 'id' | 'storeId' | 'authorizedStaffUids' | 'createdAt' | 'updatedAt'>
  > = [
    {
      code: 'HEALTH50',
      description: '৳50 flat pharmacy discount on orders of ৳500 or above',
      discountType: 'fixed_bdt',
      discountValue: 50,
      minOrderAmountBdt: 500,
      maxDiscountBdt: 50,
      startDate: todayIso,
      endDate: endDateIso,
      usageLimit: 1000,
      usedCount: 0,
      applicableCategory: 'all',
      status: 'active',
    },
    {
      code: 'CARE10',
      description: '10% healthcare & wellness discount (up to ৳250) on orders of ৳800+',
      discountType: 'percentage',
      discountValue: 10,
      minOrderAmountBdt: 800,
      maxDiscountBdt: 250,
      startDate: todayIso,
      endDate: endDateIso,
      usageLimit: 1000,
      usedCount: 0,
      applicableCategory: 'all',
      status: 'active',
    },
  ];

  let created = 0;
  for (const cpn of defaults) {
    if (!existingCodes.has(cpn.code)) {
      await saveCouponRecord(actor, cpn);
      created += 1;
    }
  }
  return created;
}

export async function bootstrapReferenceStructure(
  actor: ActorContext,
  existingCategories: Category[],
  hasSiteSettings: boolean,
  existingZones: DeliveryZone[],
  existingCoupons: Coupon[] = [],
  currentSiteSettings: SiteSettings | null = null
): Promise<void> {
  for (const preset of OFFICIAL_STOREFRONT_CATEGORIES) {
    const matched = existingCategories.find((c) =>
      preset.aliases.includes(c.slug.trim().toLowerCase())
    );
    if (!matched) {
      await saveCategory(actor, {
        id: `cat_${preset.slug}`,
        name: preset.name,
        nameBn: preset.nameBn,
        slug: preset.slug,
        description: preset.desc,
        iconName: preset.iconName,
        imageUrl: '',
        parentCategoryId: '',
        displayOrder: preset.order,
        publicationStatus: 'published',
      });
    } else if (!matched.nameBn || matched.nameBn.trim().length === 0) {
      await saveCategory(actor, {
        id: matched.id,
        name: matched.name,
        nameBn: preset.nameBn,
        slug: matched.slug,
        description: matched.description || preset.desc,
        iconName: matched.iconName || preset.iconName,
        imageUrl: matched.imageUrl || '',
        parentCategoryId: matched.parentCategoryId || '',
        displayOrder: matched.displayOrder || preset.order,
        publicationStatus: matched.publicationStatus,
        activeProductCount: matched.activeProductCount,
      });
    }
  }

  if (['super_admin', 'store_admin'].includes(actor.role)) {
    if (existingZones.length === 0) {
      await saveDeliveryZoneRecord(actor, {
        zoneName: 'Inside Dhaka Metro',
        coverageAreas: 'Dhanmondi, Gulshan, Banani, Uttara, Mirpur, Mohammadpur, Motijheel, Badda',
        deliveryFeeBdt: 60,
        freeDeliveryMinOrderBdt: 1500,
        estimatedDeliveryText: '1–2 Days Inside Dhaka',
        courierPartner: 'Own Pharmacy Dispatch / Pathao Pharma',
        instructions: 'Temperature-controlled insulated pouch used for heat-sensitive medicines.',
        status: 'active',
      });
      await saveDeliveryZoneRecord(actor, {
        zoneName: 'Outside Dhaka (All Districts)',
        coverageAreas: 'Chattogram, Sylhet, Rajshahi, Khulna, Barishal, Rangpur, Mymensingh & Sadar Upazilas',
        deliveryFeeBdt: 120,
        freeDeliveryMinOrderBdt: 1500,
        estimatedDeliveryText: '3–5 Days Nationwide',
        courierPartner: 'Steadfast / Sundarban Sealed Courier',
        instructions: 'Tamper-evident outer packaging with invoice and batch verification slip.',
        status: 'active',
      });
    }

    await ensureDefaultStorefrontCoupons(actor, existingCoupons);

    if (!hasSiteSettings) {
      await saveSiteSettingsConfig(
        actor,
        buildDefaultStorefrontSettingsPayload(currentSiteSettings),
        false
      );
    }
  }
}

// ---------------------------------------------------------------------------
// 8. QA / WORKFLOW VERIFICATION ORDER CREATOR (REAL ATOMIC CHECKOUT TEST)
// ---------------------------------------------------------------------------
export async function placeVerificationOrder(
  actor: ActorContext,
  input: {
    product: Product;
    quantity: number;
    customerName: string;
    customerPhone: string;
    shippingAddress: string;
    deliveryZone: DeliveryZone;
    paymentMethod: PaymentMethod;
    clientTxnRef: string;
    coupon: Coupon | null;
    prescriberName: string;
    clinicOrHospital: string;
    prescriptionDocumentUrl: string;
  }
): Promise<string> {
  const qty = Math.max(1, Math.round(Number(input.quantity) || 1));
  if (input.product.availabilityStatus === 'expired_restricted' || isDateExpired(input.product.nearestExpiryDate)) {
    throw new Error('Safety block: Expired products cannot be ordered.');
  }

  const subtotalBdt = input.product.sellingPrice * qty;
  const baseDeliveryFee =
    input.deliveryZone.freeDeliveryMinOrderBdt > 0 && subtotalBdt >= input.deliveryZone.freeDeliveryMinOrderBdt
      ? 0
      : input.deliveryZone.deliveryFeeBdt;

  const calc = await calculateDiscountViaBackend({
    subtotalBdt,
    deliveryFeeBdt: baseDeliveryFee,
    coupon: input.coupon,
    itemCategories: [input.product.categoryId],
  });

  const orderId = makeSafeDocId('ord');
  const orderNumber = `FRB-${Date.now().toString().slice(-6)}`;
  const reviewId = input.product.prescriptionType !== 'otc' ? makeSafeDocId('rx') : '';
  const requiresRx = input.product.prescriptionType !== 'otc';
  const staffUids = boundedStaffUids(actor.activeStaffUids, actor.uid);
  const customerId = actor.uid;

  if (requiresRx && (!input.prescriberName.trim() || !input.prescriptionDocumentUrl.trim())) {
    throw new Error('This product requires a valid prescription document reference and prescribing physician name.');
  }

  const path = `orders/${orderId}`;
  try {
    await runTransaction(db, async (tx) => {
      const prodRef = doc(db, 'products', input.product.id);
      const userRef = doc(db, 'users', customerId);
      const [prodSnap, userSnap] = await Promise.all([tx.get(prodRef), tx.get(userRef)]);

      if (!prodSnap.exists()) throw new Error('Product no longer exists.');
      const liveProd = prodSnap.data() as Omit<Product, 'id'>;
      if (liveProd.stockQuantity < qty) {
        throw new Error(`Atomic stock check failed: Only ${liveProd.stockQuantity} unit(s) available.`);
      }

      const prevStock = liveProd.stockQuantity;
      const newStock = prevStock - qty;
      const nextAvail = computeProductAvailability(newStock, liveProd.lowStockThreshold, liveProd.nearestExpiryDate);

      // Update product stock atomically (restricted to Tier 1–3 allowed keys)
      tx.update(prodRef, {
        stockQuantity: newStock,
        availabilityStatus: nextAvail,
        updatedAt: serverTimestamp(),
      });

      // Record atomic stock reservation movement
      const movId = makeSafeDocId('mov');
      tx.set(doc(db, 'inventoryMovements', movId), {
        productId: input.product.id,
        productName: sanitizeText(liveProd.name, 160),
        sku: liveProd.sku,
        batchNumber: 'AUTO-FIFO',
        movementType: 'order_reserved',
        quantityDelta: -qty,
        previousStock: prevStock,
        newStock,
        reason: sanitizeText(`Reserved ${qty} unit(s) for order ${orderNumber}`, 400),
        performedByUid: actor.uid,
        performedByEmail: sanitizeText(actor.email, 254),
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });

      // Upsert customer record & isolated PII subcollection
      if (!userSnap.exists()) {
        tx.set(userRef, {
          uid: customerId,
          displayName: sanitizeText(input.customerName, 120),
          accountStatus: 'active',
          orderCount: 1,
          totalSpentBdt: calc.totalAmountBdt,
          storeId: SHARED_STORE_ID,
          authorizedStaffUids: staffUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
        tx.set(doc(db, 'users', customerId, 'privateProfile', 'pii'), {
          uid: customerId,
          email: sanitizeText(actor.email, 254),
          phone: sanitizeText(input.customerPhone, 32),
          deliveryAddress: sanitizeText(input.shippingAddress, 400),
          city: sanitizeText(input.deliveryZone.zoneName, 80),
          deliveryZone: sanitizeText(input.deliveryZone.zoneName, 80),
          deletionReason: '',
          storeId: SHARED_STORE_ID,
          authorizedStaffUids: staffUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      } else {
        const uData = userSnap.data() as Omit<UserAccount, 'id'>;
        tx.update(userRef, {
          displayName: sanitizeText(input.customerName, 120),
          accountStatus: uData.accountStatus,
          orderCount: (uData.orderCount || 0) + 1,
          totalSpentBdt: (uData.totalSpentBdt || 0) + calc.totalAmountBdt,
          authorizedStaffUids: staffUids,
          updatedAt: serverTimestamp(),
        });
      }

      if (requiresRx && reviewId) {
        tx.set(doc(db, 'prescriptionReviews', reviewId), {
          orderId,
          orderNumber,
          customerId,
          customerName: sanitizeText(input.customerName, 120),
          medicineSummary: sanitizeText(`${liveProd.name} × ${qty} (${liveProd.unitSize})`, 300),
          documentUrl: sanitizeSafeUrl(input.prescriptionDocumentUrl, 600) || '/assets/prescription-submitted.pdf',
          documentMimeType: 'image/jpeg',
          prescriberName: sanitizeText(input.prescriberName, 120),
          clinicOrHospital: sanitizeText(input.clinicOrHospital || 'BMDC Registered Chamber', 160),
          prescriptionIssueDate: new Date().toISOString().slice(0, 10),
          reviewStatus: 'pending_review',
          reviewerUid: '',
          reviewerName: '',
          reviewerLicense: '',
          reviewNotes: '',
          reviewedAt: '',
          storeId: SHARED_STORE_ID,
          authorizedStaffUids: staffUids,
          createdAt: serverTimestamp(),
          updatedAt: serverTimestamp(),
        });
      }

      const initialPaymentStatus =
        input.paymentMethod === 'cod'
          ? 'unpaid'
          : 'pending_verification';

      const initialOrderStatus: OrderStatus = requiresRx ? 'awaiting_review' : 'pending';

      tx.set(doc(db, 'orders', orderId), {
        orderNumber,
        customerId,
        customerName: sanitizeText(input.customerName, 120),
        customerPhone: sanitizeText(input.customerPhone, 32),
        shippingAddress: sanitizeText(input.shippingAddress, 400),
        deliveryZone: sanitizeText(input.deliveryZone.zoneName, 80),
        deliveryInstructions: 'Call recipient prior to doorstep delivery.',
        itemCount: 1,
        itemsSummary: sanitizeText(`${liveProd.name} × ${qty}`, 300),
        subtotalBdt: calc.subtotalBdt,
        discountBdt: calc.discountBdt,
        couponCode: input.coupon ? input.coupon.code : '',
        deliveryFeeBdt: calc.deliveryFeeBdt,
        totalAmountBdt: calc.totalAmountBdt,
        paymentMethod: input.paymentMethod,
        paymentStatus: initialPaymentStatus,
        transactionReference: sanitizeText(input.clientTxnRef, 100),
        paymentVerifiedAt: '',
        requiresPrescription: requiresRx,
        prescriptionReviewId: reviewId,
        prescriptionReviewStatus: requiresRx ? 'pending_review' : 'not_required',
        orderStatus: initialOrderStatus,
        courierName: sanitizeText(input.deliveryZone.courierPartner, 80),
        trackingReference: '',
        cancellationReason: '',
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
        updatedAt: serverTimestamp(),
      });

      const itemId = makeSafeDocId('itm');
      tx.set(doc(db, 'orders', orderId, 'items', itemId), {
        orderId,
        productId: input.product.id,
        productName: sanitizeText(liveProd.name, 160),
        genericName: sanitizeText(liveProd.genericName, 160),
        manufacturer: sanitizeText(liveProd.manufacturer, 120),
        unitSize: sanitizeText(liveProd.unitSize, 80),
        sku: sanitizeText(liveProd.sku, 64),
        batchNumber: 'FIFO-ALLOCATED',
        unitPriceBdt: liveProd.sellingPrice,
        quantity: qty,
        lineTotalBdt: subtotalBdt,
        prescriptionRequired: requiresRx,
        customerId,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });

      const histId = makeSafeDocId('hst');
      tx.set(doc(db, 'orders', orderId, 'statusHistory', histId), {
        orderId,
        fromStatus: '',
        toStatus: initialOrderStatus,
        note: requiresRx
          ? 'Order placed and held in Awaiting Review pending clinical prescription approval.'
          : 'Order placed with atomic stock reservation.',
        changedByUid: actor.uid,
        changedByName: sanitizeText(input.customerName, 120),
        changedByRole: actor.role,
        customerId,
        storeId: SHARED_STORE_ID,
        authorizedStaffUids: staffUids,
        createdAt: serverTimestamp(),
      });

      if (input.coupon && ['super_admin', 'store_admin'].includes(actor.role)) {
        tx.update(doc(db, 'coupons', input.coupon.id), {
          description: input.coupon.description,
          discountType: input.coupon.discountType,
          discountValue: input.coupon.discountValue,
          minOrderAmountBdt: input.coupon.minOrderAmountBdt,
          maxDiscountBdt: input.coupon.maxDiscountBdt,
          startDate: input.coupon.startDate,
          endDate: input.coupon.endDate,
          usageLimit: input.coupon.usageLimit,
          usedCount: (input.coupon.usedCount || 0) + 1,
          applicableCategory: input.coupon.applicableCategory,
          status: input.coupon.status,
          authorizedStaffUids: staffUids,
          updatedAt: serverTimestamp(),
        });
      }
    });

    await recordAdminAudit(
      actor,
      'orders',
      'VERIFICATION_ORDER_CREATED',
      orderId,
      orderNumber,
      `Created real atomic order ${orderNumber} (${input.product.name} × ${qty}, Total: BDT ${calc.totalAmountBdt}, Rx Gate: ${requiresRx ? 'Awaiting Review' : 'OTC'}).`
    );

    return orderNumber;
  } catch (error) {
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

export async function generateSanitizedCsvExport(
  actor: ActorContext,
  rows: Array<Record<string, unknown>>,
  includePii: boolean
): Promise<{ csv: string; piiRedacted: boolean; rowCount: number }> {
  const headers = await getBearerHeaders();
  const res = await fetch('/api/reports/sanitize-csv', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      rows,
      staffRole: actor.role,
      includePii,
    }),
  });
  const body = await parseJsonOrNull<{ csv: string; piiRedacted: boolean; rowCount: number; error?: string }>(res);
  if (body) {
    if (!res.ok) {
      throw new Error(body.error || 'CSV export failed.');
    }
    return body;
  }
  const canExportPii = ['super_admin', 'store_admin'].includes(actor.role) && Boolean(includePii);
  const sensitive = new Set(['customerPhone', 'phone', 'email', 'shippingAddress', 'deliveryAddress']);
  const cols = rows.length ? Object.keys(rows[0]).filter((k) => canExportPii || !sensitive.has(k)) : [];
  const esc = (v: unknown) => {
    const s = v === null || v === undefined ? '' : String(v);
    const safe = /^[=+\-@]/.test(s) ? `'${s}` : s;
    return safe.includes(',') || safe.includes('"') || safe.includes('\n')
      ? `"${safe.replace(/"/g, '""')}"`
      : safe;
  };
  return {
    csv: [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n'),
    piiRedacted: !canExportPii,
    rowCount: rows.length,
  };
}
