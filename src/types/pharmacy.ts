import type { Timestamp } from 'firebase/firestore';

export type StaffRole =
  | 'super_admin'
  | 'store_admin'
  | 'inventory_manager'
  | 'order_manager'
  | 'customer_support'
  | 'analyst';

export type StaffStatus = 'active' | 'suspended';

export interface StaffMember {
  id: string;
  uid: string;
  email: string;
  displayName: string;
  role: StaffRole;
  status: StaffStatus;
  department: string;
  licenseNumber: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdBy: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface RolePermissions {
  label: string;
  description: string;
  canManageCatalog: boolean;
  canEditPricing: boolean;
  canManageCategories: boolean;
  canManageInventory: boolean;
  canViewWholesaleCosts: boolean;
  canManageOrders: boolean;
  canReviewPrescriptions: boolean;
  canVerifyPayments: boolean;
  canViewCustomerPii: boolean;
  canManageCustomers: boolean;
  canManageSupport: boolean;
  canManageCms: boolean;
  canManageCoupons: boolean;
  canManageDelivery: boolean;
  canManageStaff: boolean;
  canViewAuditLogs: boolean;
  canExportReports: boolean;
  canExportPii: boolean;
}

export const ROLE_PERMISSIONS: Record<StaffRole, RolePermissions> = {
  super_admin: {
    label: 'Super Admin',
    description: 'Full pharmacy platform governance, RBAC provisioning, clinical review, pricing, and security audit access.',
    canManageCatalog: true,
    canEditPricing: true,
    canManageCategories: true,
    canManageInventory: true,
    canViewWholesaleCosts: true,
    canManageOrders: true,
    canReviewPrescriptions: true,
    canVerifyPayments: true,
    canViewCustomerPii: true,
    canManageCustomers: true,
    canManageSupport: true,
    canManageCms: true,
    canManageCoupons: true,
    canManageDelivery: true,
    canManageStaff: true,
    canViewAuditLogs: true,
    canExportReports: true,
    canExportPii: true,
  },
  store_admin: {
    label: 'Store Administrator',
    description: 'Manages catalog, pricing, batches, orders, prescriptions (with license), CMS, coupons, and operational staff.',
    canManageCatalog: true,
    canEditPricing: true,
    canManageCategories: true,
    canManageInventory: true,
    canViewWholesaleCosts: true,
    canManageOrders: true,
    canReviewPrescriptions: true,
    canVerifyPayments: true,
    canViewCustomerPii: true,
    canManageCustomers: true,
    canManageSupport: true,
    canManageCms: true,
    canManageCoupons: true,
    canManageDelivery: true,
    canManageStaff: true,
    canViewAuditLogs: true,
    canExportReports: true,
    canExportPii: true,
  },
  inventory_manager: {
    label: 'Inventory Manager',
    description: 'Manages stock levels, incoming pharmaceutical batches, supplier lots, and expiry quarantines (no pricing/PII access).',
    canManageCatalog: true,
    canEditPricing: false,
    canManageCategories: true,
    canManageInventory: true,
    canViewWholesaleCosts: true,
    canManageOrders: false,
    canReviewPrescriptions: false,
    canVerifyPayments: false,
    canViewCustomerPii: false,
    canManageCustomers: false,
    canManageSupport: false,
    canManageCms: false,
    canManageCoupons: false,
    canManageDelivery: false,
    canManageStaff: false,
    canViewAuditLogs: false,
    canExportReports: true,
    canExportPii: false,
  },
  order_manager: {
    label: 'Order Manager',
    description: 'Manages permitted order status transitions, courier dispatch, and verified payment reconciliation.',
    canManageCatalog: false,
    canEditPricing: false,
    canManageCategories: false,
    canManageInventory: false,
    canViewWholesaleCosts: false,
    canManageOrders: true,
    canReviewPrescriptions: false,
    canVerifyPayments: true,
    canViewCustomerPii: true,
    canManageCustomers: false,
    canManageSupport: false,
    canManageCms: false,
    canManageCoupons: false,
    canManageDelivery: false,
    canManageStaff: false,
    canViewAuditLogs: false,
    canExportReports: true,
    canExportPii: false,
  },
  customer_support: {
    label: 'Customer Support',
    description: 'Handles support inquiries, order status assistance, and customer account requests.',
    canManageCatalog: false,
    canEditPricing: false,
    canManageCategories: false,
    canManageInventory: false,
    canViewWholesaleCosts: false,
    canManageOrders: false,
    canReviewPrescriptions: false,
    canVerifyPayments: false,
    canViewCustomerPii: true,
    canManageCustomers: true,
    canManageSupport: true,
    canManageCms: false,
    canManageCoupons: false,
    canManageDelivery: false,
    canManageStaff: false,
    canViewAuditLogs: false,
    canExportReports: false,
    canExportPii: false,
  },
  analyst: {
    label: 'Read-Only Analyst',
    description: 'Read-only access to aggregated store performance, catalog metrics, and non-PII CSV exports.',
    canManageCatalog: false,
    canEditPricing: false,
    canManageCategories: false,
    canManageInventory: false,
    canViewWholesaleCosts: true,
    canManageOrders: false,
    canReviewPrescriptions: false,
    canVerifyPayments: false,
    canViewCustomerPii: false,
    canManageCustomers: false,
    canManageSupport: false,
    canManageCms: false,
    canManageCoupons: false,
    canManageDelivery: false,
    canManageStaff: false,
    canViewAuditLogs: false,
    canExportReports: true,
    canExportPii: false,
  },
};

export interface Category {
  id: string;
  name: string;
  nameBn: string;
  slug: string;
  description: string;
  iconName: string;
  imageUrl: string;
  parentCategoryId: string;
  displayOrder: number;
  publicationStatus: 'published' | 'hidden';
  activeProductCount: number;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type AvailabilityStatus =
  | 'in_stock'
  | 'low_stock'
  | 'out_of_stock'
  | 'expired_restricted';

export type PrescriptionType =
  | 'otc'
  | 'prescription_required'
  | 'pharmacist_verified';

export type PublicationStatus = 'published' | 'draft' | 'archived';

export interface Product {
  id: string;
  name: string;
  slug: string;
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
  availabilityStatus: AvailabilityStatus;
  prescriptionType: PrescriptionType;
  usageInstructions: string;
  storageInstructions: string;
  nearestExpiryDate: string;
  publicationStatus: PublicationStatus;
  featured: boolean;
  popular: boolean;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type BatchStatus =
  | 'active'
  | 'near_expiry'
  | 'expired_quarantined'
  | 'depleted';

export interface ProductBatch {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  supplierName: string;
  supplierContact: string;
  unitCostPrice: number;
  quantityReceived: number;
  quantityRemaining: number;
  manufacturingDate: string;
  expiryDate: string;
  status: BatchStatus;
  notes: string;
  recordedByUid: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type MovementType =
  | 'stock_in'
  | 'adjustment_add'
  | 'adjustment_deduct'
  | 'order_reserved'
  | 'order_restocked'
  | 'expired_quarantine';

export interface InventoryMovement {
  id: string;
  productId: string;
  productName: string;
  sku: string;
  batchNumber: string;
  movementType: MovementType;
  quantityDelta: number;
  previousStock: number;
  newStock: number;
  reason: string;
  performedByUid: string;
  performedByEmail: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
}

export interface UserAccount {
  id: string;
  uid: string;
  displayName: string;
  accountStatus: 'active' | 'suspended' | 'deletion_requested';
  orderCount: number;
  totalSpentBdt: number;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface UserPrivateProfile {
  uid: string;
  email: string;
  phone: string;
  deliveryAddress: string;
  city: string;
  deliveryZone: string;
  deletionReason: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export type OrderStatus =
  | 'pending'
  | 'awaiting_review'
  | 'confirmed'
  | 'processing'
  | 'ready_for_dispatch'
  | 'shipped'
  | 'delivered'
  | 'cancelled'
  | 'refund_pending'
  | 'refunded';

export type PaymentMethod = 'cod' | 'bkash' | 'nagad';

export type PaymentStatus =
  | 'unpaid'
  | 'pending_verification'
  | 'verified_paid'
  | 'refund_pending'
  | 'refunded'
  | 'failed';

export type PrescriptionReviewState =
  | 'not_required'
  | 'pending_review'
  | 'approved'
  | 'rejected'
  | 'more_info_requested';

export interface Order {
  id: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  customerPhone: string;
  shippingAddress: string;
  deliveryZone: string;
  deliveryInstructions: string;
  itemCount: number;
  itemsSummary: string;
  subtotalBdt: number;
  discountBdt: number;
  couponCode: string;
  deliveryFeeBdt: number;
  totalAmountBdt: number;
  paymentMethod: PaymentMethod;
  paymentStatus: PaymentStatus;
  transactionReference: string;
  paymentVerifiedAt: string;
  requiresPrescription: boolean;
  prescriptionReviewId: string;
  prescriptionReviewStatus: PrescriptionReviewState;
  orderStatus: OrderStatus;
  courierName: string;
  trackingReference: string;
  cancellationReason: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface OrderItem {
  id: string;
  orderId: string;
  productId: string;
  productName: string;
  genericName: string;
  manufacturer: string;
  unitSize: string;
  sku: string;
  batchNumber: string;
  unitPriceBdt: number;
  quantity: number;
  lineTotalBdt: number;
  prescriptionRequired: boolean;
  customerId: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
}

export interface OrderStatusHistory {
  id: string;
  orderId: string;
  fromStatus: string;
  toStatus: string;
  note: string;
  changedByUid: string;
  changedByName: string;
  changedByRole: string;
  customerId: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
}

export interface PrescriptionReview {
  id: string;
  orderId: string;
  orderNumber: string;
  customerId: string;
  customerName: string;
  medicineSummary: string;
  documentUrl: string;
  documentMimeType: string;
  prescriberName: string;
  clinicOrHospital: string;
  prescriptionIssueDate: string;
  reviewStatus: 'pending_review' | 'approved' | 'rejected' | 'more_info_requested';
  reviewerUid: string;
  reviewerName: string;
  reviewerLicense: string;
  reviewNotes: string;
  reviewedAt: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface Coupon {
  id: string;
  code: string;
  description: string;
  discountType: 'percentage' | 'fixed_bdt';
  discountValue: number;
  minOrderAmountBdt: number;
  maxDiscountBdt: number;
  startDate: string;
  endDate: string;
  usageLimit: number;
  usedCount: number;
  applicableCategory: string;
  status: 'active' | 'inactive';
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface DeliveryZone {
  id: string;
  zoneName: string;
  coverageAreas: string;
  deliveryFeeBdt: number;
  freeDeliveryMinOrderBdt: number;
  estimatedDeliveryText: string;
  courierPartner: string;
  instructions: string;
  status: 'active' | 'inactive';
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SiteSettings {
  id: string;
  siteName: string;
  tagline: string;
  taglineBn: string;
  logoUrl: string;
  faviconUrl: string;
  heroTitle: string;
  heroSubtitle: string;
  heroBannerUrl: string;
  heroCtaText: string;
  promoBannerText: string;
  featuredCategorySlugs: string[];
  homepageSectionOrder: string[];
  navigationLinks: string[];
  supportPhone: string;
  supportEmail: string;
  supportHours: string;
  pharmacyLicenseNo: string;
  deliveryInfoPolicy: string;
  paymentInfoPolicy: string;
  enabledPaymentMethods: string[];
  faqContent: string;
  termsAndConditions: string;
  privacyPolicy: string;
  returnRefundPolicy: string;
  storeId: string;
  authorizedStaffUids: string[];
  updatedByUid: string;
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface SupportTicket {
  id: string;
  ticketNumber: string;
  customerId: string;
  customerName: string;
  subject: string;
  category: 'order_issue' | 'medicine_query' | 'refund_request' | 'account_deletion' | 'delivery_delay';
  priority: 'low' | 'medium' | 'high';
  status: 'open' | 'in_progress' | 'resolved' | 'closed';
  message: string;
  staffResolutionNote: string;
  assignedToUid: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
  updatedAt?: Timestamp | null;
}

export interface AdminAuditLog {
  id: string;
  action: string;
  module:
    | 'auth'
    | 'products'
    | 'categories'
    | 'inventory'
    | 'orders'
    | 'prescriptions'
    | 'customers'
    | 'payments'
    | 'cms'
    | 'coupons'
    | 'staff';
  targetId: string;
  targetLabel: string;
  actorUid: string;
  actorEmail: string;
  actorRole: string;
  details: string;
  storeId: string;
  authorizedStaffUids: string[];
  createdAt?: Timestamp | null;
}

export type AdminModuleKey =
  | 'overview'
  | 'products'
  | 'categories'
  | 'inventory'
  | 'orders'
  | 'prescriptions'
  | 'customers'
  | 'payments_delivery'
  | 'promotions_cms'
  | 'staff_security'
  | 'reports_qa';
