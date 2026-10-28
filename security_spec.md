# Security Specification — Finesteride Recur 1Mg Shop Bd

## 1. Data Invariants & Master Sources of Truth

1. **Identity & Privilege Invariant**: A Firebase Web API key never confers authority. All administrative roles derive exclusively from either the verified bootstrapped Super Admin (`request.auth.token.email == 'ahmadshorif00001@gmail.com' && request.auth.token.email_verified == true`) or an `active` document in `/staffMembers/{request.auth.uid}` provisioned by a `super_admin` or `store_admin`. Customers cannot create or edit `/staffMembers/{uid}` or self-assign roles.
2. **Master Gate Subcollection Sync**:
   - `/users/{userId}/privateProfile/{profileId}` requires `/users/{userId}` to exist and isolates customer PII (`email`, `phone`, `deliveryAddress`) strictly to `isOwner(userId)` or PII-authorized staff (`super_admin`, `store_admin`, `order_manager`, `customer_support`).
   - `/orders/{orderId}/items/{itemId}` and `/orders/{orderId}/statusHistory/{historyId}` require `/orders/{orderId}` to exist and enforce relational ownership matching the parent order's `customerId`.
3. **Inventory Atomicity Invariant**: Creating an `/inventoryMovements/{movementId}` document requires `existsAfter` and `getAfter` verification on `/products/{incoming().productId}` proving `stockQuantity == incoming().newStock` in the same atomic batch/transaction, and movements are strictly append-only (`allow update, delete: if false`).
4. **Category Safe-Deletion Invariant**: A `/categories/{categoryId}` document cannot be deleted unless `resource.data.activeProductCount == 0`.
5. **Prescription Safety Gate Invariant**: If `order.requiresPrescription == true`, transitioning `orderStatus` to `confirmed`, `processing`, `ready_for_dispatch`, `shipped`, or `delivered` requires `incoming().prescriptionReviewStatus == 'approved'` AND `exists(/databases/$(database)/documents/prescriptionReviews/$(incoming().prescriptionReviewId))` with `get(...).data.reviewStatus == 'approved'`.
6. **Terminal State Locking**: Orders in terminal states (`cancelled`, `refunded`) cannot be mutated by regular users or operational staff (only `super_admin` override). Support tickets in `closed` state are similarly locked.
7. **Append-Only Audit Trail**: `/adminAuditLogs/{logId}` enforces `incoming().actorUid == request.auth.uid`, `incoming().createdAt == request.time`, and `allow update, delete: if false`.
8. **Zero-Cost-Explosion List Queries**: No `allow list` block contains `get()` or `exists()`. All `allow list` rules evaluate `resource.data` directly (`storeId`, `publicationStatus`, `customerId`, or bounded `authorizedStaffUids`).

---

## 2. The "Dirty Dozen" Adversarial Payloads

1. **Payload 01 — Self-Provisioned Super Admin Escalation**
   - Target: `PUT /staffMembers/attacker_uid`
   - Payload: `{ "uid": "attacker_uid", "email": "attacker@example.com", "role": "super_admin", "status": "active", ... }`
   - Expected: `PERMISSION_DENIED` (only verified `super_admin` or `store_admin` can create staff records; `store_admin` cannot grant `super_admin`).

2. **Payload 02 — Unverified Email Spoof of Bootstrapped Admin**
   - Target: `POST /products/prod_spoof` as `{ uid: "spoof_1", email: "ahmadshorif00001@gmail.com", email_verified: false }`
   - Expected: `PERMISSION_DENIED` (`isVerifiedUser()` enforces `request.auth.token.email_verified == true`).

3. **Payload 03 — Shadow / Ghost Field Injection on Product Update**
   - Target: `PATCH /products/prod_1`
   - Payload: Valid product fields + `{ "dgdaSecretBypass": true }`
   - Expected: `PERMISSION_DENIED` (`isValidProduct` enforces strict `data.keys().hasOnly(...)` and `affectedKeys().hasOnly(...)`).

4. **Payload 04 — Customer Price & Stock Tampering**
   - Target: `PATCH /products/prod_1` as verified customer
   - Payload: `{ "sellingPrice": 1, "stockQuantity": 9999 }`
   - Expected: `PERMISSION_DENIED` (customers have zero write access to `/products`).

5. **Payload 05 — Customer Reading Confidential Wholesale Batch Costs**
   - Target: `GET /productBatches/batch_1` as verified customer
   - Expected: `PERMISSION_DENIED` (`/productBatches` restricted strictly to authorized staff).

6. **Payload 06 — Cross-Customer PII Harvest (PII Blanket Test)**
   - Target: `GET /users/victim_uid/privateProfile/pii` as authenticated `other_customer_uid`
   - Expected: `PERMISSION_DENIED` (PII split subcollection restricted to `isOwner(userId)` or PII-authorized staff; even `inventory_manager` and `analyst` are denied).

7. **Payload 07 — Prescription Gate Bypass on Order Confirmation**
   - Target: `PATCH /orders/ord_rx_1` where `requiresPrescription == true` and `prescriptionReviewStatus == 'pending_review'`
   - Payload: `{ "orderStatus": "confirmed" }`
   - Expected: `PERMISSION_DENIED` (rule verifies `prescriptionReviewStatus == 'approved'` and `get(/prescriptionReviews/...).data.reviewStatus == 'approved'`).

8. **Payload 08 — Client-Submitted Fake Payment Verification**
   - Target: `POST /orders/ord_pay_1` by customer with `{ "paymentMethod": "bkash", "paymentStatus": "verified_paid", "transactionReference": "FAKE123" }`
   - Expected: `PERMISSION_DENIED` (customer order creation forces `paymentStatus in ['unpaid', 'pending_verification']` and `paymentVerifiedAt == ''`).

9. **Payload 09 — Desynchronized Orphaned Inventory Movement**
   - Target: `POST /inventoryMovements/mov_orphan` without updating `/products/prod_1.stockQuantity`
   - Expected: `PERMISSION_DENIED` (`getAfter(/products/$(incoming().productId)).data.stockQuantity == incoming().newStock` fails).

10. **Payload 10 — ID Poisoning & Denial-of-Wallet String Bomb**
    - Target: `POST /categories/bad$id!with/slashes` or `description` of 50,000 chars
    - Expected: `PERMISSION_DENIED` (`isValidId()` regex + strict `.size() <= maxLength` on every string and array).

11. **Payload 11 — Mutation of Terminal Cancelled Order**
    - Target: `PATCH /orders/ord_cancelled` (where `existing().orderStatus == 'cancelled'`) by `order_manager`
    - Payload: `{ "orderStatus": "delivered" }`
    - Expected: `PERMISSION_DENIED` (Terminal State Locking blocks non-super-admin edits once `cancelled` or `refunded`).

12. **Payload 12 — Audit Log Tampering / Deletion**
    - Target: `DELETE /adminAuditLogs/log_1` or `PATCH /adminAuditLogs/log_1` even as `super_admin`
    - Expected: `PERMISSION_DENIED` (`allow update, delete: if false`).

---

## 3. Red Team Audit & Conflict Report

| Collection | Identity Spoofing | State Shortcutting | Resource / Value Poisoning | Shadow Update Gate | List Query Isolation | Result |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| `staffMembers` | Blocked (`super_admin` / `store_admin` only; role escalation blocked) | Suspended staff lose access synchronously via `get().data.status == 'active'` | `isValidId` + `isValidStaffMember` | `hasOnly` enforced | `canStaffList(resource.data)` (0 `get()`) | PASS |
| `categories` | Staff-only writes | Safe delete requires `activeProductCount == 0` | `isValidCategory` bounds all strings | `hasOnly` enforced | `publicationStatus == 'published'` or `canStaffList` | PASS |
| `products` | Staff-only writes; `exists(/categories/...)` verified | Expired status cannot publish as `in_stock` | `images.size() <= 6` + string size bounds | `hasOnly` enforced | `publicationStatus == 'published'` or `canStaffList` | PASS |
| `productBatches` | Inventory/Admin staff only; `recordedByUid == auth.uid` | Expired batches locked from active sale | `isValidProductBatch` | `hasOnly` enforced | `canStaffList(resource.data)` | PASS |
| `inventoryMovements` | `performedByUid == auth.uid` | Immutable (`update, delete: false`) + `getAfter` atomic product sync | `isValidInventoryMovement` | Immutable after create | `canStaffList(resource.data)` | PASS |
| `users` & `privateProfile` | `uid == userId == auth.uid` on self-registration; status locked to `'active'` | Customers can only request deletion (`deletion_requested`), not self-unsuspend | Master Gate `exists(/users/$(userId))` + `isValidUserPrivateProfile` | `hasOnly` enforced | Owner or PII-authorized staff | PASS |
| `orders`, `items`, `statusHistory` | `customerId == auth.uid` on customer create | Prescription gate + Terminal State Locking (`cancelled`/`refunded`) | Subcollection Master Gate + `isValidOrder` | Action-based `affectedKeys().hasOnly(...)` | `customerId == auth.uid` or `canStaffList` | PASS |
| `prescriptionReviews` | Customer owns submission; clinical reviewer UID/license verified | Cannot self-approve (`reviewStatus == 'pending_review'` on create) | `isValidPrescriptionReview` | Action-based `hasOnly` | `customerId == auth.uid` or `canStaffList` | PASS |
| `coupons`, `deliveryZones`, `siteSettings` | Admin-only writes; `updatedByUid == auth.uid` | Bounded arrays (`<=8` / `<=5`) | Strict URL/text length guards | `hasOnly` enforced | Active/storefront read or `canStaffList` | PASS |
| `supportTickets` | `customerId == auth.uid` on customer create | Terminal `closed` state locked | `isValidSupportTicket` | Action-based `hasOnly` | `customerId == auth.uid` or `canStaffList` | PASS |
| `adminAuditLogs` | `actorUid == auth.uid` enforced | `allow update, delete: if false` | `isValidAdminAuditLog` | Immutable | `canStaffList(resource.data)` | PASS |
| `staffPushDevices` | `staffUid == auth.uid` & `isAnyActiveStaff()` enforced | Owner or `super_admin` revocation only | `isValidStaffPushDevice` (`fcmToken <= 2048`) | `affectedKeys().hasOnly(...)` enforced | `staffUid == auth.uid` or `canStaffList` | PASS |
