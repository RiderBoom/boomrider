# BoomRider Staging Test Plan

**Document Purpose:** Staging deployment procedures, verification matrix, test accounts, and Go / No-Go decision criteria for validating Migration 035 and Server-Authoritative Pricing prior to production deployment.

---

## 1. Staging Setup & Pre-requisites

### Environment Setup
- **Staging Supabase Project ID:** `boomrider-staging`
- **Database Baseline:** Schema baseline applied through Migration 034.
- **Node Environment:** `VITE_SUPABASE_URL` pointing to staging instance.

### Test Accounts & Roles

| Role | Email | User ID | Test Balance |
| :--- | :--- | :--- | :--- |
| **Customer** | `cust.staging@boomrider.com` | `usr-cust-001` | ฿1,000.00 |
| **Merchant** | `shop.staging@boomrider.com` | `usr-shop-001` | ฿500.00 |
| **Rider / Driver** | `rider.staging@boomrider.com` | `usr-rider-001` | ฿500.00 |
| **Admin** | `admin.staging@boomrider.com` | `usr-admin-001` | ฿10,000.00 |

---

## 2. Staging Deployment Steps

1. **Apply Migration 035 SQL Script**:
   ```bash
   npx supabase db push --db-url "$STAGING_DATABASE_URL"
   ```
2. **Deploy Updated Supabase Edge Functions**:
   ```bash
   npx supabase functions deploy send-notification --project-ref boomrider-staging
   ```
3. **Deploy Frontend Build to Staging Environment**:
   ```bash
   npm run build
   # Deploy dist/ to staging hosting provider
   ```

---

## 3. Test Cases & Verification Matrix

### Scenario A: Server Quote Generation & Single-Use Token Consumption

- **Test A1: Invalid Coordinates Request**
  - **Action:** Request quote with `pickupLat = 120.0` (out of bounds).
  - **Expected Result:** RPC returns `ok: false`, `reason: "INVALID_COORDINATES_OUT_OF_BOUNDS"`.
- **Test A2: Food Quote & Order Execution**
  - **Action:** Customer requests quote for Food order, then calls `place_customer_order` with `quoteId`.
  - **Expected Result:** Order created successfully, quote marked `used_at = NOW()`.
- **Test A3: Double Use of Quote Token**
  - **Action:** Re-send `place_customer_order` using the used `quoteId` from Test A2.
  - **Expected Result:** RPC rejects request with `ok: false`, `reason: "QUOTE_ALREADY_USED"`.
- **Test A4: Quote Expiry (5-Minute Window)**
  - **Action:** Request quote, wait 5 minutes, then attempt order placement.
  - **Expected Result:** RPC rejects order with `ok: false`, `reason: "QUOTE_EXPIRED"`.

### Scenario B: Client Price & Distance Tampering Rejection

- **Test B1: Tampered Grand Total in Wallet Order**
  - **Action:** Client sends `grandTotal = 1` in payload for a ฿350 Service order with ฿10 wallet balance.
  - **Expected Result:** Server evaluates actual fee (฿350) against DB config and rejects order with `INSUFFICIENT_CUSTOMER_WALLET`.

### Scenario C: Settlement Financial Invariant Verification

- **Test C1: Complete Order Settlement & Ledger Inspection**
  - **Action:** Complete order across Customer, Merchant, Rider, and Admin.
  - **Expected Result:** `customerPaid = merchantIncome + riderIncome + adminIncome + refundedAmount`. No negative wallet balances.

---

## 4. Go / No-Go Decision Criteria

- [ ] All 4 service categories (Food, Parcel, Ride, Service) pass E2E quote and placement tests on staging.
- [ ] Zero unauthoritative fallback direct-inserts observed.
- [ ] Reconciliation script reports 100% ledger balance equality across test orders.
- [ ] No regression on pre-migration legacy orders.
