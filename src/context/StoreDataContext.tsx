import React, { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { collection, doc, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../lib/firebase';
import { syncCatalogToCustomerPanel, type ActorContext } from '../services/pharmacyService';
import type {
  AdminAuditLog,
  Category,
  Coupon,
  DeliveryZone,
  InventoryMovement,
  Order,
  PrescriptionReview,
  Product,
  ProductBatch,
  SiteSettings,
  StaffMember,
  SupportTicket,
  UserAccount,
} from '../types/pharmacy';
import { useAuth } from './AuthContext';

interface StoreDataContextValue {
  loading: boolean;
  syncError: string | null;
  retrySync: () => void;
  actor: ActorContext | null;
  staffMembers: StaffMember[];
  categories: Category[];
  products: Product[];
  productBatches: ProductBatch[];
  inventoryMovements: InventoryMovement[];
  orders: Order[];
  prescriptionReviews: PrescriptionReview[];
  customers: UserAccount[];
  supportTickets: SupportTicket[];
  coupons: Coupon[];
  deliveryZones: DeliveryZone[];
  siteSettings: SiteSettings | null;
  auditLogs: AdminAuditLog[];
}

const StoreDataContext = createContext<StoreDataContextValue | null>(null);

export function StoreDataProvider({ children }: { children: React.ReactNode }) {
  const { user, authReady, isAuthorizedStaff, isBootstrappedSuperAdmin, effectiveRole, staffProfile } = useAuth();

  const [reloadNonce, setReloadNonce] = useState(0);
  const [loading, setLoading] = useState(true);
  const [syncError, setSyncError] = useState<string | null>(null);
  const autoBackfillDoneRef = useRef(false);

  const [staffMembers, setStaffMembers] = useState<StaffMember[]>([]);
  const [categories, setCategories] = useState<Category[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [productBatches, setProductBatches] = useState<ProductBatch[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [orders, setOrders] = useState<Order[]>([]);
  const [prescriptionReviews, setPrescriptionReviews] = useState<PrescriptionReview[]>([]);
  const [customers, setCustomers] = useState<UserAccount[]>([]);
  const [supportTickets, setSupportTickets] = useState<SupportTicket[]>([]);
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [deliveryZones, setDeliveryZones] = useState<DeliveryZone[]>([]);
  const [siteSettings, setSiteSettings] = useState<SiteSettings | null>(null);
  const [auditLogs, setAuditLogs] = useState<AdminAuditLog[]>([]);

  const retrySync = useCallback(() => {
    setSyncError(null);
    setLoading(true);
    setReloadNonce((n) => n + 1);
  }, []);

  useEffect(() => {
    if (!authReady || !user || !isAuthorizedStaff) {
      setLoading(false);
      return;
    }

    setLoading(true);
    setSyncError(null);

    // Subscribe directly to collections so records created from either Admin Panel,
    // Customer Panel, or Firebase Console (even without storeId/authorizedStaffUids)
    // always sync in real time.
    const buildStaffQuery = (colName: string) => collection(db, colName);

    const onListenerError = (path: string) => (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('Missing or insufficient permissions') || msg.includes('PERMISSION_DENIED')) {
        setLoading(false);
        return;
      }
      try {
        handleFirestoreError(err, OperationType.LIST, path);
      } catch (formatted) {
        setSyncError(formatted instanceof Error ? formatted.message : String(formatted));
        setLoading(false);
      }
    };

    let initialLoaded = 0;
    const markReady = () => {
      initialLoaded += 1;
      if (initialLoaded >= 4) {
        setLoading(false);
      }
    };

    const unsubs: Array<() => void> = [];

    unsubs.push(
      onSnapshot(
        buildStaffQuery('staffMembers'),
        (snap) => {
          setStaffMembers(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<StaffMember, 'id'>) })));
          markReady();
        },
        onListenerError('staffMembers')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('categories'),
        (snap) => {
          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const name = String(raw.name || raw.nameEn || raw.title || 'Category');
            const nameBn = String(raw.nameBn || raw.titleBn || '');
            const displayOrder = Number(raw.displayOrder ?? raw.sortOrder ?? raw.order ?? 0) || 0;
            const publicationStatus: Category['publicationStatus'] =
              (raw.publicationStatus as Category['publicationStatus']) ||
              (raw.isActive === false || raw.active === false || raw.status === 'inactive'
                ? 'hidden'
                : 'published');
            const activeProductCount = Number(raw.activeProductCount ?? raw.productCount ?? 0) || 0;
            return {
              id: d.id,
              ...(raw as Omit<Category, 'id'>),
              name,
              nameBn,
              slug: String(raw.slug || d.id),
              description: String(raw.description || ''),
              iconName: String(raw.iconName || raw.iconKey || raw.icon || 'Pill'),
              imageUrl: String(raw.imageUrl || raw.image || ''),
              parentCategoryId: String(raw.parentCategoryId || ''),
              displayOrder,
              publicationStatus,
              activeProductCount,
            };
          });
          list.sort((a, b) => (a.displayOrder ?? 0) - (b.displayOrder ?? 0));
          setCategories(list);
          markReady();
        },
        onListenerError('categories')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('products'),
        (snap) => {
          const list = snap.docs.map((d) => {
            const raw = d.data() as Omit<Product, 'id'> & Record<string, unknown>;
            const sellingPrice =
              Number(raw.sellingPrice ?? raw.offerPrice ?? raw.discountPrice ?? raw.price ?? 0) || 0;
            const previousPrice =
              Number(raw.previousPrice ?? raw.regularPrice ?? raw.mrp ?? raw.originalPrice ?? 0) || 0;
            const stockQuantity = Number(raw.stockQuantity ?? raw.stock ?? 0) || 0;
            const images = Array.isArray(raw.images)
              ? raw.images
              : Array.isArray(raw.galleryUrls)
              ? (raw.galleryUrls as string[])
              : raw.imageUrl
              ? [raw.imageUrl]
              : raw.image
              ? [raw.image]
              : [];
            return {
              id: d.id,
              ...raw,
              sellingPrice,
              previousPrice: previousPrice > sellingPrice ? previousPrice : Number(raw.previousPrice ?? 0) || 0,
              stockQuantity,
              images,
              manufacturer: raw.manufacturer || raw.brand || raw.company || '',
              categoryName: raw.categoryName || raw.category || String(raw.categoryNameEn || ''),
              unitSize: raw.unitSize || raw.packSize || '',
              usageInstructions: raw.usageInstructions || String(raw.usageInfo || raw.usageSummary || ''),
              storageInstructions: raw.storageInstructions || String(raw.storageInfo || ''),
              publicationStatus:
                raw.publicationStatus || (raw.isActive || raw.status === 'active' ? 'published' : 'draft'),
              availabilityStatus: raw.availabilityStatus || (stockQuantity > 0 ? 'in_stock' : 'out_of_stock'),
              prescriptionType:
                raw.prescriptionType ||
                (raw.requiresPrescription || raw.prescriptionRequired ? 'prescription_required' : 'otc'),
            };
          });
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setProducts(list);
          markReady();
        },
        onListenerError('products')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('orders'),
        (snap) => {
          const mapCustomerStatus = (rawStatus: unknown): Order['orderStatus'] => {
            const s = String(rawStatus || '').trim().toLowerCase().replace(/\s+/g, '_');
            switch (s) {
              case 'pending':
                return 'pending';
              case 'awaiting_review':
                return 'awaiting_review';
              case 'confirmed':
                return 'confirmed';
              case 'processing':
                return 'processing';
              case 'ready_for_dispatch':
                return 'ready_for_dispatch';
              case 'shipped':
                return 'shipped';
              case 'delivered':
                return 'delivered';
              case 'cancelled':
                return 'cancelled';
              case 'refund_pending':
                return 'refund_pending';
              case 'refunded':
                return 'refunded';
              default:
                return 'pending';
            }
          };

          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const rawPayStatus = String(raw.paymentStatus || 'unpaid');
            const paymentStatus: Order['paymentStatus'] =
              rawPayStatus === 'paid'
                ? 'verified_paid'
                : (rawPayStatus as Order['paymentStatus']) || 'unpaid';
            const requiresPrescription = Boolean(raw.requiresPrescription);
            const addressParts = [raw.deliveryAddress, raw.area, raw.district]
              .map((p) => String(p || '').trim())
              .filter(Boolean);

            return {
              id: d.id,
              ...(raw as Omit<Order, 'id'>),
              orderNumber: String(raw.orderNumber || d.id),
              customerId: String(raw.customerId || raw.userId || ''),
              customerName: String(raw.customerName || 'Customer'),
              customerPhone: String(raw.customerPhone || ''),
              shippingAddress: String(raw.shippingAddress || addressParts.join(', ')),
              deliveryZone: String(raw.deliveryZone || ''),
              deliveryInstructions: String(raw.deliveryInstructions || raw.orderNotes || ''),
              itemCount: Math.max(1, Number(raw.itemCount ?? 1) || 1),
              itemsSummary: String(
                raw.itemsSummary || `${Math.max(1, Number(raw.itemCount ?? 1) || 1)} item(s)`
              ),
              subtotalBdt: Number(raw.subtotalBdt ?? raw.subtotal ?? 0) || 0,
              discountBdt: Number(raw.discountBdt ?? raw.discountAmount ?? 0) || 0,
              couponCode: String(raw.couponCode || ''),
              deliveryFeeBdt: Number(raw.deliveryFeeBdt ?? raw.deliveryFee ?? 0) || 0,
              totalAmountBdt: Number(raw.totalAmountBdt ?? raw.totalAmount ?? 0) || 0,
              paymentMethod: String(raw.paymentMethod || 'cod'),
              paymentStatus,
              transactionReference: String(raw.transactionReference || raw.paymentSenderRef || ''),
              paymentVerifiedAt: String(raw.paymentVerifiedAt || ''),
              requiresPrescription,
              prescriptionReviewId: String(raw.prescriptionReviewId || raw.prescriptionId || ''),
              prescriptionReviewStatus:
                (raw.prescriptionReviewStatus as Order['prescriptionReviewStatus']) ||
                (requiresPrescription ? 'pending_review' : 'not_required'),
              orderStatus: mapCustomerStatus(raw.orderStatus || raw.status),
              courierName: String(raw.courierName || ''),
              trackingReference: String(raw.trackingReference || ''),
              cancellationReason: String(raw.cancellationReason || ''),
            };
          });
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setOrders(list);
          markReady();
        },
        onListenerError('orders')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('productBatches'),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<ProductBatch, 'id'>) }));
          list.sort((a, b) => (a.expiryDate || '').localeCompare(b.expiryDate || ''));
          setProductBatches(list);
        },
        onListenerError('productBatches')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('inventoryMovements'),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<InventoryMovement, 'id'>) }));
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setInventoryMovements(list);
        },
        onListenerError('inventoryMovements')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('prescriptionReviews'),
        (snap) => {
          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const rawStatus = String(raw.reviewStatus || raw.status || 'pending_review');
            const reviewStatus: PrescriptionReview['reviewStatus'] =
              rawStatus === 'needs_info'
                ? 'more_info_requested'
                : (rawStatus as PrescriptionReview['reviewStatus']);
            const productIds = Array.isArray(raw.productIds) ? (raw.productIds as string[]) : [];
            return {
              id: d.id,
              ...(raw as Omit<PrescriptionReview, 'id'>),
              orderId: String(raw.orderId || ''),
              orderNumber: String(raw.orderNumber || d.id),
              customerId: String(raw.customerId || raw.userId || ''),
              customerName: String(raw.customerName || 'Patient'),
              medicineSummary: String(
                raw.medicineSummary ||
                  raw.notes ||
                  (productIds.length > 0 ? `Product IDs: ${productIds.join(', ')}` : 'Submitted Prescription')
              ),
              documentUrl: String(raw.documentUrl || raw.storageFilePath || ''),
              documentMimeType: String(raw.documentMimeType || 'image/jpeg'),
              prescriberName: String(raw.prescriberName || raw.doctorName || ''),
              clinicOrHospital: String(raw.clinicOrHospital || ''),
              prescriptionIssueDate: String(raw.prescriptionIssueDate || raw.prescriptionDate || ''),
              reviewStatus,
              reviewerUid: String(raw.reviewerUid || ''),
              reviewerName: String(raw.reviewerName || ''),
              reviewerLicense: String(raw.reviewerLicense || ''),
              reviewNotes: String(raw.reviewNotes || raw.pharmacistNotes || ''),
              reviewedAt: String(raw.reviewedAt || ''),
            };
          });
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setPrescriptionReviews(list);
        },
        onListenerError('prescriptionReviews')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('users'),
        (snap) => {
          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            const accountStatus: UserAccount['accountStatus'] =
              (raw.accountStatus as UserAccount['accountStatus']) ||
              (raw.accountDeletionRequested === true ? 'deletion_requested' : 'active');
            return {
              id: d.id,
              ...(raw as Omit<UserAccount, 'id'>),
              uid: String(raw.uid || d.id),
              displayName: String(raw.displayName || 'Customer'),
              accountStatus,
              orderCount: Number(raw.orderCount ?? 0) || 0,
              totalSpentBdt: Number(raw.totalSpentBdt ?? 0) || 0,
            };
          });
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setCustomers(list);
        },
        onListenerError('users')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('supportTickets'),
        (snap) => {
          const mapCategory = (cat: unknown): SupportTicket['category'] => {
            const c = String(cat || '');
            if (c === 'medicine_query') return 'medicine_query';
            if (c === 'delivery' || c === 'delivery_delay') return 'delivery_delay';
            if (c === 'payment' || c === 'refund_request') return 'refund_request';
            if (c === 'account' || c === 'account_deletion') return 'account_deletion';
            return 'order_issue';
          };

          const list = snap.docs.map((d) => {
            const raw = d.data() as Record<string, unknown>;
            return {
              id: d.id,
              ...(raw as Omit<SupportTicket, 'id'>),
              ticketNumber: String(raw.ticketNumber || raw.orderNumber || `TKT-${d.id.slice(-6).toUpperCase()}`),
              customerId: String(raw.customerId || raw.userId || ''),
              customerName: String(raw.customerName || 'Customer'),
              subject: String(raw.subject || 'Support Inquiry'),
              category: mapCategory(raw.category),
              priority: (raw.priority as SupportTicket['priority']) || 'medium',
              status: (raw.status as SupportTicket['status']) || 'open',
              message: String(raw.message || ''),
              staffResolutionNote: String(raw.staffResolutionNote || raw.adminReply || ''),
              assignedToUid: String(raw.assignedToUid || ''),
            };
          });
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setSupportTickets(list);
        },
        onListenerError('supportTickets')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('coupons'),
        (snap) => {
          setCoupons(
            snap.docs.map((d) => {
              const raw = d.data() as Record<string, unknown>;
              const rawType = String(raw.discountType || 'percentage');
              return {
                id: d.id,
                ...(raw as Omit<Coupon, 'id'>),
                code: String(raw.code || d.id).toUpperCase(),
                description: String(raw.description || ''),
                discountType: rawType === 'fixed' ? 'fixed_bdt' : (rawType as Coupon['discountType']),
                discountValue: Number(raw.discountValue ?? 0) || 0,
                minOrderAmountBdt: Number(raw.minOrderAmountBdt ?? raw.minOrderAmount ?? 0) || 0,
                maxDiscountBdt: Number(raw.maxDiscountBdt ?? raw.maxDiscountAmount ?? 0) || 0,
                startDate: String(raw.startDate || ''),
                endDate: String(raw.endDate || ''),
                usageLimit: Number(raw.usageLimit ?? 1000) || 1000,
                usedCount: Number(raw.usedCount ?? 0) || 0,
                applicableCategory: String(raw.applicableCategory || 'all'),
                status:
                  (raw.status as Coupon['status']) ||
                  (raw.isActive === false ? 'inactive' : 'active'),
              };
            })
          );
        },
        onListenerError('coupons')
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('deliveryZones'),
        (snap) => {
          setDeliveryZones(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<DeliveryZone, 'id'>) })));
        },
        onListenerError('deliveryZones')
      )
    );

    unsubs.push(
      onSnapshot(
        doc(db, 'siteSettings', 'storefront_config'),
        (snap) => {
          if (snap.exists()) {
            setSiteSettings({ id: snap.id, ...(snap.data() as Omit<SiteSettings, 'id'>) });
          } else {
            setSiteSettings(null);
          }
        },
        (err) => {
          // Document might not exist prior to initial CMS save
          if (err && String(err).includes('offline')) {
            onListenerError('siteSettings/storefront_config')(err);
          }
        }
      )
    );

    unsubs.push(
      onSnapshot(
        buildStaffQuery('adminAuditLogs'),
        (snap) => {
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<AdminAuditLog, 'id'>) }));
          list.sort((a, b) => (b.createdAt?.toMillis?.() || 0) - (a.createdAt?.toMillis?.() || 0));
          setAuditLogs(list);
        },
        onListenerError('adminAuditLogs')
      )
    );

    return () => {
      unsubs.forEach((fn) => fn());
    };
  }, [authReady, user, isAuthorizedStaff, isBootstrappedSuperAdmin, reloadNonce]);

  const actor: ActorContext | null = useMemo(() => {
    if (!user || !effectiveRole) return null;
    const activeUids = staffMembers.filter((m) => m.status === 'active').map((m) => m.uid);
    return {
      uid: user.uid,
      email: user.email || '',
      displayName: staffProfile?.displayName || user.displayName || user.email || 'Admin',
      role: effectiveRole,
      licenseNumber: staffProfile?.licenseNumber || (isBootstrappedSuperAdmin ? 'BPC-REG-0001' : ''),
      activeStaffUids: Array.from(new Set([user.uid, ...activeUids])).slice(0, 20),
    };
  }, [user, effectiveRole, staffMembers, staffProfile, isBootstrappedSuperAdmin]);

  // Automatically backfill Customer Panel compatibility mirror fields once per session
  // if existing products or categories in Firestore were created before dual-schema sync.
  useEffect(() => {
    if (
      loading ||
      autoBackfillDoneRef.current ||
      !actor ||
      !['super_admin', 'store_admin'].includes(actor.role)
    ) {
      return;
    }

    const needsProductBackfill = products.some(
      (p) =>
        p.price === undefined ||
        p.categorySlug === undefined ||
        p.status === undefined ||
        p.published === undefined ||
        p.inStock === undefined
    );
    const needsCategoryBackfill = categories.some(
      (c) => c.status === undefined || c.published === undefined || c.order === undefined
    );

    if (!needsProductBackfill && !needsCategoryBackfill) {
      return;
    }

    autoBackfillDoneRef.current = true;
    void syncCatalogToCustomerPanel(actor, {
      categories,
      products,
      siteSettings,
      deliveryZones,
      coupons,
      publishDrafts: false,
      silent: true,
    }).catch((err) => {
      console.warn('Background Customer Panel compatibility backfill skipped:', err);
    });
  }, [loading, actor, products, categories, siteSettings, deliveryZones, coupons]);

  return (
    <StoreDataContext.Provider
      value={{
        loading,
        syncError,
        retrySync,
        actor,
        staffMembers,
        categories,
        products,
        productBatches,
        inventoryMovements,
        orders,
        prescriptionReviews,
        customers,
        supportTickets,
        coupons,
        deliveryZones,
        siteSettings,
        auditLogs,
      }}
    >
      {children}
    </StoreDataContext.Provider>
  );
}

export function useStoreData(): StoreDataContextValue {
  const ctx = useContext(StoreDataContext);
  if (!ctx) throw new Error('useStoreData must be used inside StoreDataProvider');
  return ctx;
}
