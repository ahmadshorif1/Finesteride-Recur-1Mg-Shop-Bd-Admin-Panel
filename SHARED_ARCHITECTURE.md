# Finesteride Recur 1Mg Shop Bd — Shared Firebase Architecture, Workflows & Deployment Guide

This document defines the shared data contract, security model, administrative provisioning workflow, operational state machines, testing procedures, and Customer Panel connection checklist for **Finesteride Recur 1Mg Shop Bd**.

---

## 1. Shared Firebase Project & Tenant Coordinates

Both the **Admin Panel** (this application) and the **Customer Storefront** connect to the exact same Firebase project and Firestore database:

- **Firebase Project ID**: `admin-panel-5ecd8`
- **Firestore Database ID**: `(default)`
- **Shared Storefront Tenant Constant (`SHARED_STORE_ID`)**: `finesteride-recur-bd`

> **Critical Security Distinction**: `VITE_FIREBASE_API_KEY` identifies the Firebase project to Google servers — it **never** grants administrative authority. Administrative access is enforced through Firebase Authentication, server-side token verification (`/api/auth/verify-session`), and hardened Firestore/Storage Security Rules (`firestore.rules` and `storage.rules`).

---

## 2. Shared Firestore Data Schema & Collection Contracts

Every shared document includes `storeId: "finesteride-recur-bd"` and `authorizedStaffUids: string[]` (up to 20 active staff UIDs) so list queries satisfy zero-`get()` query rules cleanly.

| Collection Path | Storefront Read Access | Storefront Write Access | Admin Panel Access | Purpose & Key Fields |
| :--- | :--- | :--- | :--- | :--- |
| `/staffMembers/{uid}` | Denied | Denied | Self `get`; Super/Store Admin manage | Staff RBAC (`role`, `status`, `licenseNumber`, `department`). |
| `/categories/{categoryId}` | Public `get` & `list` | Denied | `super_admin`, `store_admin`, `inventory_manager` | English & Bengali category hierarchy (`name`, `nameBn`, `title`, `titleBn`, `slug`, `displayOrder`, `order`, `sortOrder`, `publicationStatus`, `isActive`, `status`, `published`, `activeProductCount`, `productCount`). Deletion blocked when `activeProductCount > 0`. |
| `/products/{productId}` | Public `get` & `list` | Denied (stock reserved via atomic transaction) | Catalog/Inventory roles; pricing restricted to `super_admin` / `store_admin` | Sellable healthcare catalog with full Customer Panel mirror fields (`name`, `genericName`, `manufacturer`, `brand`, `company`, `categoryId`, `categoryName`, `category`, `categorySlug`, `categoryNameBn`, `sellingPrice`, `price`, `mrp`, `regularPrice`, `originalPrice`, `discountPrice`, `discountPercent`, `images`, `image`, `imageUrl`, `thumbnail`, `unitSize`, `packSize`, `stockQuantity`, `stock`, `inStock`, `availabilityStatus`, `prescriptionType`, `requiresPrescription`, `prescriptionRequired`, `publicationStatus`, `isActive`, `status`, `published`). **Wholesale cost is never stored here.** |
| `/productBatches/{batchId}` | Denied (Confidential) | Denied | `super_admin`, `store_admin`, `inventory_manager`, `analyst` (read) | Confidential supplier lots, `unitCostPrice`, `batchNumber`, `expiryDate`, and quarantine status. |
| `/inventoryMovements/{movementId}` | Denied | Customer atomic `order_reserved` only with matching `getAfter` product stock delta | Authorized staff create/read; **immutable** (`update, delete: false`) | Tamper-evident ledger of every stock receipt, adjustment, order reservation, cancellation restock, and expiry quarantine. |
| `/users/{userId}` | Owner `get` only | Owner `create`/`update` own profile (`accountStatus == 'active'`) | Staff read; `super_admin`, `store_admin`, `customer_support` status updates | Public-safe account metadata (`displayName`, `accountStatus`, `orderCount`, `totalSpentBdt`). |
| `/users/{userId}/privateProfile/{docId}` | Owner `get` (`docId == 'pii'`) | Owner `create`/`update` | `super_admin`, `store_admin`, `order_manager`, `customer_support` | Isolated customer PII (`email`, `phone`, `deliveryAddress`, `city`, `deliveryZone`, `deletionReason`). |
| `/orders/{orderId}` | Owner where `customerId == auth.uid` | Authenticated customer `create` in `pending` or `awaiting_review` | `super_admin`, `store_admin`, `order_manager` transitions; read for `analyst`/`customer_support` | Master order header (`orderNumber`, `subtotalBdt`, `discountBdt`, `deliveryFeeBdt`, `totalAmountBdt`, `paymentMethod`, `paymentStatus`, `requiresPrescription`, `prescriptionReviewStatus`, `orderStatus`). |
| `/orders/{orderId}/items/{itemId}` | Parent order owner | Customer `create` with order | Staff read; **immutable** (`update, delete: false`) | Historical product & price snapshot (`productName`, `unitPriceBdt`, `quantity`, `lineTotalBdt`, `sku`, `batchNumber`). |
| `/orders/{orderId}/statusHistory/{historyId}` | Parent order owner | Customer initial entry; Staff transitions | Staff read/append; **immutable** (`update, delete: false`) | Timestamped order status audit trail. |
| `/prescriptionReviews/{reviewId}` | Owner where `customerId == auth.uid` | Customer `create` (`reviewStatus == 'pending_review'`) | `super_admin` & `store_admin` with valid `reviewerLicense` | Clinical prescription verification (`documentUrl`, `prescriberName`, `reviewStatus`, `reviewerLicense`, `reviewNotes`). |
| `/coupons/{couponId}` | Authenticated read where `status == 'active'` | Denied (incremented only via order checkout) | `super_admin`, `store_admin` | Promotional discount rules (`code`, `discountType`, `discountValue`, `minOrderAmountBdt`, `maxDiscountBdt`, `usageLimit`, `usedCount`). |
| `/deliveryZones/{zoneId}` | Public where `status == 'active'` | Denied | `super_admin`, `store_admin` | Inside/Outside Dhaka shipping fees, free-delivery thresholds, and cold-chain courier instructions. |
| `/siteSettings/storefront_config` | Public `get` | Denied | `super_admin`, `store_admin` | Storefront CMS branding, hero banner, navigation links, enabled payment channels, DGDA license, and legal policies. |
| `/supportTickets/{ticketId}` | Owner where `customerId == auth.uid` | Authenticated customer `create` | `super_admin`, `store_admin`, `customer_support` | Customer inquiries, refund requests, and account-deletion requests. |
| `/adminAuditLogs/{logId}` | Denied | Denied | Staff `create`; `super_admin` & `store_admin` `read`; **immutable** | Append-only administrative security log. |

### Recommended Composite Indexes & Retention Policy
- **Composite Indexes** (create in Firebase Console → Firestore → Indexes as volume grows):
  1. `products`: `storeId ASC, publicationStatus ASC, createdAt DESC`
  2. `orders`: `customerId ASC, createdAt DESC` and `storeId ASC, orderStatus ASC, createdAt DESC`
  3. `prescriptionReviews`: `storeId ASC, reviewStatus ASC, createdAt DESC`
  4. `adminAuditLogs`: `storeId ASC, module ASC, createdAt DESC`
- **Data Retention Policy**:
  - `orders`, `orders/{id}/items`, `inventoryMovements`, `prescriptionReviews`, and `adminAuditLogs` are **retained for a minimum of 5 years** for Bangladesh DGDA pharmaceutical traceability and financial audit compliance.
  - When a customer submits an account deletion request (`account_deletion` ticket or `deletion_requested` standing), personal contact fields in `/users/{uid}/privateProfile/pii` may be scrubbed after open orders settle while preserving anonymized financial/dispensing invoices.

---

## 3. Secure Administrator & Staff Provisioning Guide

1. **Initial Super Admin Bootstrap**:
   - Sign in using Google SSO with the verified owner account (`ahmadshorif00001@gmail.com`).
   - Complete the one-time **Super Admin Profile Bootstrap** prompt (records `/staffMembers/{uid}` with `role: "super_admin"` and Pharmacy Council registration number).
2. **Provisioning Additional Staff (`store_admin`, `inventory_manager`, `order_manager`, `customer_support`, `analyst`)**:
   - Have the new team member visit the Admin Panel URL and sign in once with their verified Google or Email/Password account.
   - Because they are not yet provisioned, the **Unauthorized Access Gate** blocks all store data and displays their **Verified Firebase Auth UID** with a one-click Copy button.
   - Sign in as a `super_admin` (or `store_admin` for non-super roles), open **Staff & Security → Provision Staff**, paste the UID, assign their role and clinical license number (mandatory for prescription reviewers), and click **Provision Staff**.
3. **Revoking Access**:
   - Open **Staff & Security**, click **Manage** on the staff row, and set Account Standing to **Suspended**. Firestore Security Rules immediately block all reads and writes for suspended staff members.
4. **Enabling Email/Password & Multi-Factor Authentication (MFA)**:
   - Open Firebase Console → Authentication → Sign-in method to enable **Email/Password** alongside Google SSO, and enable **Identity Platform SMS/TOTP MFA** for mandatory second-factor verification.

---

## 4. Inventory, Expiry & Order State Machines

### Inventory & Batch Safety Rules
- Every stock mutation (`receiveIncomingBatch`, `adjustInventoryAtomically`, `quarantineBatchStock`, `placeVerificationOrder`, `transitionOrderStatus` cancellation) runs inside a Firestore atomic `runTransaction` that updates `/products/{id}.stockQuantity` and writes a matching `/inventoryMovements/{movId}` record verified via `getAfter()` in `firestore.rules`.
- Expired batches (`expiryDate < today`) cannot be received into sellable stock. Products whose nearest expiry date has passed automatically transition to `availabilityStatus: "expired_restricted"` and cannot be published or checked out.

### Order & Clinical Prescription State Machine
- **OTC Orders**: `pending` → `confirmed` → `processing` → `ready_for_dispatch` → `shipped` (requires `trackingReference`) → `delivered` (terminal except `refund_pending` → `refunded`).
- **Prescription Orders (`requiresPrescription == true`)**:
  - Created in `awaiting_review` with `prescriptionReviewStatus: "pending_review"`.
  - **Clinical Gate**: Both `/api/orders/validate-transition` and `firestore.rules` block transitioning an order to `confirmed`, `processing`, `ready_for_dispatch`, `shipped`, or `delivered` until `/prescriptionReviews/{reviewId}` is marked `approved` by an authorized reviewer with a recorded Pharmacy Council / BMDC license number.
- **Cancellations**: Cancelling an order requires a written `cancellationReason`, atomically restocks reserved units back to `/products` with `order_restocked` ledger entries, and transitions already-paid orders to `refund_pending`.

---

## 5. Testing & Verification Instructions

1. **Static Lint & Security Rules Validation**:
   ```bash
   npx eslint firestore.rules storage.rules
   npm run lint
   npm run build
   ```
2. **Firebase Emulator Suite Rules Testing** (`firestore.rules.test.ts`):
   - Install `@firebase/rules-unit-testing` and run with `firebase emulators:exec --only firestore` to execute the Dirty Dozen adversarial tests (self-escalation block, wholesale cost isolation, negative stock prevention, clinical prescription gate enforcement, and audit log immutability).
3. **Live Interactive QA in Dashboard**:
   - Sign in as Super Admin → click **Initialize Official Categories & CMS** on Overview.
   - Add a prescription medicine (e.g., *Finasteride Recur 1mg*, `prescription_required`, stock `50`, price `450`) in **Products**.
   - Open **Reports & Storefront QA → Atomic Checkout QA** and place a live verification order. Confirm stock decrements to `49`, an `order_reserved` movement appears in **Inventory & Batches**, the order is held in `awaiting_review`, and approving the prescription in **Prescriptions** unlocks order confirmation.

---

## 6. Deployment Instructions

1. Copy `.env.example` to `.env` and populate `VITE_FIREBASE_*` variables matching `firebase-applet-config.json`.
2. Deploy Firestore and Storage security rules to the shared Firebase project:
   ```bash
   firebase deploy --only firestore:rules,storage
   ```
3. Build and start the full-stack production server (Express API + compiled Vite SPA on port 3000):
   ```bash
   npm run build
   NODE_ENV=production node server.ts
   ```

---

## 7. Customer Panel Connection Checklist

Use this checklist when building or connecting the separate **Customer Storefront** (`MASTER PROMPT 02`):

- [ ] **Environment Config**: Set `VITE_FIREBASE_PROJECT_ID="admin-panel-5ecd8"`, `VITE_FIREBASE_DATABASE_ID="(default)"`, and `VITE_SHARED_STORE_ID="finesteride-recur-bd"` (use the one-click **Copy Customer Panel `.env`** button in Admin Panel → **Products → Customer Panel Sync** or **Reports & QA → Shared Firebase Checklist**).
- [ ] **Storefront Branding & Policies**: Read `doc(db, 'siteSettings', 'storefront_config')` for live hero banners, Bangla/English taglines, navigation links, enabled payment channels (`enabledPaymentMethods`), and DGDA policies.
- [ ] **Catalog & Category Queries**: Query `/categories` and `/products` directly via Firestore (`collection(db, 'products')`, `where('publicationStatus', '==', 'published')`, `where('isActive', '==', true)`, `where('status', '==', 'active')`, `where('categoryId', ...)`, or `where('categorySlug', ...)`) — or via `GET /api/public/catalog`. Hide or disable Add-to-Cart when `availabilityStatus == 'out_of_stock'` or `'expired_restricted'` (`inStock == false`).
- [ ] **Customer Profile & Isolated PII**: Store public display profile in `/users/{uid}` (`accountStatus: 'active'`) and contact/address PII in `/users/{uid}/privateProfile/pii`.
- [ ] **Prescription Uploads**: Upload prescription scans to Firebase Storage path `/prescriptions/{uid}/{orderId}/{fileName}` (JPEG/PNG/WebP/PDF, max 8 MB) and create `/prescriptionReviews/{reviewId}` with `reviewStatus: 'pending_review'`.
- [ ] **Atomic Checkout**: Place orders using `runTransaction` that decrements `/products/{id}.stockQuantity`, writes an `/inventoryMovements` entry (`movementType: 'order_reserved'`), writes `/orders/{orderId}` (`storeId: 'finesteride-recur-bd'`, `paymentStatus: 'unpaid'` for COD or `'pending_verification'` for bKash/Nagad), and snapshots `/orders/{orderId}/items/{itemId}` + `/orders/{orderId}/statusHistory/{histId}`.
