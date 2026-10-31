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
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Category, 'id'>) }));
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
            const raw = d.data() as Omit<Product, 'id'>;
            const sellingPrice = Number(raw.sellingPrice ?? raw.price ?? 0) || 0;
            const previousPrice = Number(raw.previousPrice ?? raw.originalPrice ?? 0) || 0;
            const stockQuantity = Number(raw.stockQuantity ?? raw.stock ?? 0) || 0;
            const images = Array.isArray(raw.images)
              ? raw.images
              : raw.imageUrl
              ? [raw.imageUrl]
              : raw.image
              ? [raw.image]
              : [];
            return {
              id: d.id,
              ...raw,
              sellingPrice,
              previousPrice,
              stockQuantity,
              images,
              manufacturer: raw.manufacturer || raw.brand || '',
              categoryName: raw.categoryName || raw.category || '',
              unitSize: raw.unitSize || raw.packSize || '',
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
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Order, 'id'>) }));
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
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<PrescriptionReview, 'id'>) }));
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
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<UserAccount, 'id'>) }));
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
          const list = snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<SupportTicket, 'id'>) }));
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
          setCoupons(snap.docs.map((d) => ({ id: d.id, ...(d.data() as Omit<Coupon, 'id'>) })));
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
