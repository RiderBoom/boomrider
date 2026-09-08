# BoomRider End-to-End Audit & System Architecture Report

**Document Status:** Final Audit
**Date:** Current Main Branch Audit
**Scope:** BoomRider Platform (Food Delivery, Parcel Delivery, Ride-Hailing, Service Platform) across Customer, Merchant, Rider/Driver, and Admin roles.

---

## 1. System Map & End-to-End Data Flow

```
[Customer Request Quote]
      │
      ├──> Input Coordinates (lat/lng), Service Type, Delivery Address ID / Restaurant ID
      ▼
[Server-Authoritative Quote Engine (create_service_quote RPC)]
      │
      ├──> Validate Lat/Lng bounds (-90..90, -180..180) & Non-null check
      ├──> Fetch DB Canonical Locations (Restaurant Location / User Addresses)
      ├──> Server OSRM Driving Distance Calculation (or Haversine Estimate Fallback)
      ├──> Apply Pricing Config Rules (Base Fee + billableKm * perKmFee)
      ├──> Insert Quote into `service_quotes` (expires_at = NOW() + 5 mins, used_at = NULL)
      └──> Return quote_id, breakdown, total, expires_at
      │
      ▼
[Customer Order Confirmation]
      │
      ├──> Customer passes `quote_id` + order parameters
      ▼
[Order Placement Transaction (place_customer_order RPC)]
      │
      ├──> Lock & Validate `service_quotes` row FOR UPDATE
      ├──> Check ownership (auth.uid()), service type match, expiry, single-use status
      ├──> Mark quote used (`used_at = NOW()`)
      ├──> Atomic Wallet Check & Debit (`FOR UPDATE` on `wallets`)
      ├──> Persist Order to `public.orders`
      └──> Append Transaction Record to `wallets.history`
      │
      ▼
[Dispatch Engine (dispatch_order RPC / Job Offers)]
      │
      ├──> Verify Rider Availability (`is_available = true`) & Cash Wallet Eligibility
      ├──> Create `job_offers` entry & Notify Rider (Push Notification + Audio/Vibration)
      │
      ▼
[Rider Acceptance (accept_job_offer / accept_order_direct RPC)]
      │
      ├──> Atomic row lock on `job_offers` & `wallets`
      ├──> Validate Cash Liability Threshold (`balance - active_cash_liabilities >= required_liability`)
      ├──> Transition order status to `rider_accepted` & mark rider `is_available = false`
      │
      ▼
[Order Execution & Status Transition]
      │
      ├──> `picking_up` -> `delivering` -> `delivered`
      │
      ▼
[Order Settlement (process_order_settlement RPC)]
      │
      ├──> Atomic Financial Settlement across Customer, Merchant, Rider, and Admin GP
      ├──> Append-only entries recorded in `wallets.history`
      └──> Balance Check Invariant: `customerPaid = merchantIncome + riderIncome + adminIncome + refundedAmount`
```

---

## 2. Issues Breakdown (P0 / P1 / P2 / P3)

### P0 — Critical Vulnerabilities & Financial Risks

1. **Client Distance & Pricing Tampering Vulnerability**
   - **File / Lines:** `supabase/migrations/034_fix_parcel_distance_pricing.sql:237-250`, `src/context/hooks/useOrderActions.js:72-88`
   - **Issue:** In migration 034, `place_customer_order` RPC accepts `p_order->>'distance'` sent by client before falling back to Haversine calculation. A malicious client can manipulate the `distance` property in the JSON payload to drastically underpay or overcharge.
   - **Impact:** Direct financial loss for riders and platform; pricing non-authoritative.

2. **Unauthoritative Direct-Insert Fallback in Client Hook**
   - **File / Lines:** `src/context/hooks/useOrderActions.js:72-105` (`_executeOrderPlacement`)
   - **Issue:** When the `place_customer_order` RPC fails or is unavailable, `useOrderActions.js` falls back to inserting directly into `public.orders` using client-calculated totals (`grandTotal`, `deliveryFee`, `adminGP`, `riderIncome`), completely bypassing server pricing validation and wallet balance verification.
   - **Impact:** Security bypass allowing arbitrary order price insertion and unverified order creation.

3. **Food Delivery Location Mismatch (userProfile vs userAddresses)**
   - **File / Lines:** `src/context/hooks/useOrderActions.js:42-56`, `supabase/migrations/034_fix_parcel_distance_pricing.sql:240-248`
   - **Issue:** Food delivery fees in frontend calculations could reference `userProfile.location`, whereas actual delivery addresses are picked from `userAddresses[0].location`. If a customer saved different locations in profile vs address book, delivery fee calculation used the wrong coordinates.
   - **Impact:** Miscalculated delivery fees and inaccurate rider routing.

4. **Missing Single-Use Server-Authoritative Quote Engine**
   - **File / Lines:** Platform-wide architecture gap in pricing flows.
   - **Issue:** No server quote mechanism existed (`service_quotes` table missing), allowing prices to fluctuate between estimate rendering and order confirmation, or allowing clients to reuse cached quotes indefinitely.
   - **Impact:** Price inconsistency between customer confirmation screen and server settlement.

---

### P1 — High Priority Functional & Integrity Issues

5. **Haversine Straight-Line Distance vs Road Distance Mismatch**
   - **File / Lines:** `src/components/InteractiveMap.jsx:248-255`, `supabase/migrations/034_fix_parcel_distance_pricing.sql:1-29`
   - **Issue:** `InteractiveMap.jsx` uses OSRM to render driving polylines visually on map UI, but `routes[0].distance` was not passed to server RPCs. RPCs recalculated distance using straight-line Haversine, causing discrepancies between map distance and charged distance.
   - **Impact:** Customers see road distance on map but get billed on straight-line distance (or vice versa).

6. **Parcel & Ride Location Integrity (Address Text without Valid Coordinates)**
   - **File / Lines:** `src/views/CustomerView.jsx:180-220`, `supabase/migrations/034_fix_parcel_distance_pricing.sql:260-290`
   - **Issue:** Customers could type address strings without dropping a valid map pin. RPCs defaulted missing coordinates to `1` km or fallback coordinates silently.
   - **Impact:** Dispatched orders with invalid or zero coordinates, rendering rider navigation impossible.

7. **Service Category Matching by Thai Display Text**
   - **File / Lines:** `supabase/migrations/034_fix_parcel_distance_pricing.sql:310-330`
   - **Issue:** Service order pricing matched service items using string comparison on category names (`v_service_elem->>'name' = v_service_cat`). If category names changed or had translation mismatches, pricing defaulted to 350 THB.
   - **Impact:** Incorrect pricing for service requests when category names vary.

---

### P2 — Medium Priority Observability & Operations Issues

8. **Lack of Structured Logging for Pricing & Fallbacks**
   - **File / Lines:** `supabase/functions/`, `src/context/hooks/`
   - **Issue:** System logs lacked structured JSON fields (`quoteId`, `distanceSource`, `pricingConfigVersion`, `latency`), making it difficult to trace whether pricing derived from OSRM or Haversine estimate.
   - **Impact:** Reduced observability in production monitoring.

9. **Absence of Read-Only Financial Ledger Reconciliation Script**
   - **File / Lines:** `scripts/`
   - **Issue:** No automated tool existed to verify that `customerPaid = merchantIncome + riderIncome + adminIncome + refundedAmount` across historical orders and wallet transactions.
   - **Impact:** Operational difficulty auditing ledger balance consistency.

---

### P3 — Low Priority Documentation & Maintenance

10. **Missing Staging & Production Rollout Documentation**
    - **File / Lines:** `docs/`
    - **Issue:** Standardized staging deployment, canary rollout steps, feature flags, and SQL rollback triggers were scattered across migration files rather than central operational runbooks.
    - **Impact:** Potential operational confusion during production deployments.
