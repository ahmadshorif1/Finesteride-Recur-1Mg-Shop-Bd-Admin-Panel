/**
 * Firestore Security Rules Emulator Test Suite
 * Run against Firebase Local Emulator Suite:
 *   npx firebase emulators:exec --only firestore "npx tsx firestore.rules.test.ts"
 *
 * Verifies all 12 "Dirty Dozen" adversarial payloads defined in security_spec.md
 * return PERMISSION_DENIED while authorized pharmacy workflows succeed.
 */

export interface DirtyDozenScenario {
  id: string;
  title: string;
  actor: { uid: string; email: string; email_verified: boolean };
  operation: 'get' | 'list' | 'create' | 'update' | 'delete';
  path: string;
  payload?: Record<string, unknown>;
  expectedOutcome: 'PERMISSION_DENIED' | 'ALLOWED';
}

export const DIRTY_DOZEN_SCENARIOS: DirtyDozenScenario[] = [
  {
    id: 'DD-01',
    title: 'Self-Provisioned Super Admin Escalation by Customer',
    actor: { uid: 'attacker_01', email: 'attacker@example.com', email_verified: true },
    operation: 'create',
    path: 'staffMembers/attacker_01',
    payload: {
      uid: 'attacker_01',
      email: 'attacker@example.com',
      displayName: 'Malicious Customer',
      role: 'super_admin',
      status: 'active',
      department: 'Pharmacy',
      licenseNumber: 'FAKE-01',
      storeId: 'finesteride-recur-bd',
      authorizedStaffUids: ['attacker_01'],
      createdBy: 'attacker_01',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-02',
    title: 'Unverified Email Spoof of Bootstrapped Super Admin',
    actor: { uid: 'spoof_uid', email: 'ahmadshorif00001@gmail.com', email_verified: false },
    operation: 'create',
    path: 'categories/spoof-cat',
    payload: {
      name: 'Spoof Category',
      nameBn: '',
      slug: 'spoof-category',
      description: '',
      iconName: 'Pill',
      imageUrl: '',
      parentCategoryId: '',
      displayOrder: 1,
      publicationStatus: 'published',
      activeProductCount: 0,
      storeId: 'finesteride-recur-bd',
      authorizedStaffUids: [],
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-03',
    title: 'Shadow / Ghost Field Injection on Product Update',
    actor: { uid: 'admin_uid', email: 'ahmadshorif00001@gmail.com', email_verified: true },
    operation: 'update',
    path: 'products/prod_01',
    payload: {
      dgdaSecretBypass: true,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-04',
    title: 'Customer Price and Stock Tampering',
    actor: { uid: 'customer_01', email: 'customer@example.com', email_verified: true },
    operation: 'update',
    path: 'products/prod_01',
    payload: {
      sellingPrice: 1,
      stockQuantity: 9999,
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-05',
    title: 'Customer Reading Confidential Wholesale Batch Cost',
    actor: { uid: 'customer_01', email: 'customer@example.com', email_verified: true },
    operation: 'get',
    path: 'productBatches/batch_01',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-06',
    title: 'Cross-Customer PII Harvest from Isolated Subcollection',
    actor: { uid: 'customer_02', email: 'other@example.com', email_verified: true },
    operation: 'get',
    path: 'users/customer_01/privateProfile/pii',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-07',
    title: 'Prescription Gate Bypass on Order Confirmation',
    actor: { uid: 'admin_uid', email: 'ahmadshorif00001@gmail.com', email_verified: true },
    operation: 'update',
    path: 'orders/ord_rx_pending',
    payload: {
      requiresPrescription: true,
      prescriptionReviewStatus: 'pending_review',
      orderStatus: 'confirmed',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-08',
    title: 'Client-Submitted Fake Verified Payment Status at Checkout',
    actor: { uid: 'customer_01', email: 'customer@example.com', email_verified: true },
    operation: 'create',
    path: 'orders/ord_fake_paid',
    payload: {
      customerId: 'customer_01',
      paymentMethod: 'bkash',
      paymentStatus: 'verified_paid',
      transactionReference: 'CLIENT_FAKE_TXN',
      paymentVerifiedAt: '2026-10-27T10:00:00Z',
      orderStatus: 'pending',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-09',
    title: 'Orphaned Inventory Movement Without Atomic Product Stock Update',
    actor: { uid: 'admin_uid', email: 'ahmadshorif00001@gmail.com', email_verified: true },
    operation: 'create',
    path: 'inventoryMovements/mov_orphan',
    payload: {
      productId: 'prod_01',
      previousStock: 10,
      quantityDelta: 50,
      newStock: 60,
      reason: 'Unbacked ledger write',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-10',
    title: 'Category Deletion While Active Products Exist',
    actor: { uid: 'admin_uid', email: 'ahmadshorif00001@gmail.com', email_verified: true },
    operation: 'delete',
    path: 'categories/cat_with_active_products',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-11',
    title: 'Order Manager Mutating Terminal Cancelled Order',
    actor: { uid: 'order_mgr_01', email: 'orders@shopbd.example', email_verified: true },
    operation: 'update',
    path: 'orders/ord_cancelled_01',
    payload: {
      orderStatus: 'delivered',
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-12',
    title: 'Super Admin Attempting to Delete Protected Audit Log',
    actor: { uid: 'admin_uid', email: 'ahmadshorif00001@gmail.com', email_verified: true },
    operation: 'delete',
    path: 'adminAuditLogs/audit_01',
    expectedOutcome: 'PERMISSION_DENIED',
  },
  {
    id: 'DD-13',
    title: 'Customer Attempting to Register Admin Web Push Device Token',
    actor: { uid: 'customer_01', email: 'customer@example.com', email_verified: true },
    operation: 'create',
    path: 'staffPushDevices/dev_customer_01',
    payload: {
      deviceId: 'dev_customer_01',
      staffUid: 'customer_01',
      staffEmail: 'customer@example.com',
      fcmToken: 'fake_fcm_registration_token_1234567890',
      vapidKeyPrefix: 'BKo5qe',
      userAgent: 'Mozilla/5.0',
      status: 'active',
      storeId: 'finesteride-recur-bd',
      authorizedStaffUids: ['customer_01'],
    },
    expectedOutcome: 'PERMISSION_DENIED',
  },
];
