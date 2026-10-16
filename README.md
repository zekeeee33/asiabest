# Asia Best Construction and Development Corporation — Equipment Tracker

The Equipment Tracker is a mobile-responsive construction inventory application for Asia Best Construction and Development Corporation, built with React, TypeScript, Vite, and Supabase. It separates individually tracked equipment from quantity-based materials and keeps authorization, stock transactions, and audit history in PostgreSQL.

## Local setup

1. Install Node.js 20.19+ or 22.12+ and npm.
2. Run `npm install`.
3. Create a Supabase project and apply the SQL in `supabase/migrations/202610160001_initial_inventory.sql` in the Supabase SQL editor. For CLI use, run `supabase init` once, then `supabase link --project-ref <project-ref>` and `supabase db push`.
4. Copy `.env.example` to `.env.local`, then set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` to the project URL and **publishable/anon** key. Never use a service-role key in the browser.
5. Start the app with `npm run dev`. Camera access requires HTTPS, except on `localhost`.
6. Create users through Supabase Auth. New users receive the least-privileged `viewer_auditor` role by default. Promote the first administrator from the trusted SQL editor, replacing the email:

   ```sql
   update public.user_profiles
   set role = 'administrator'
   where id = (select id from auth.users where email = 'admin@example.com');
   ```

7. Create categories, locations, projects, and user location/project grants in the Supabase dashboard before using scoped workflows. Site staff need project or location grants; inventory managers and administrators have global inventory scope.

## Included workflows

- Supabase Auth sign-in and role-scoped inventory reads.
- Inventory registration for individual assets and bulk stock, with an immediate per-record QR label preview/print flow; table search/status filtering and CSV export.
- Rear-camera QR scanning with manual asset-tag fallback; camera access is requested only on the scanner screen.
- Transactional equipment checkout/return, stock receipt/issue/adjustment, pending inter-location asset transfer/receipt, and maintenance status functions.
- PostgreSQL checks, unique asset tags/serial numbers, active assignment uniqueness, non-negative stock balances, RLS, immutable movement rows, and protected audit history.
- Dashboard KPIs, location distribution, low-stock counts, and estimated purchase value derived from accessible database records.
- Installable web manifest and a small same-origin offline shell cache. Database transactions still require a network connection.

## Validation

Run `npm run build` for the TypeScript check and production bundle, and `npm run lint` for Oxlint.

The Supabase migration must be applied to a real project before database/RLS behavior can be exercised. This workspace does not include project credentials, and no production Supabase deployment or mobile-device camera test has been performed.

## Current boundaries

This is a secure working foundation, not yet the complete requested production feature set. The UI includes inventory registration, QR scanning/labels, checkout/return, stock receipts/issues/adjustments, pending asset transfers and receipt, maintenance requests/status transitions, scoped movement/audit history, CSV export, and live basic dashboard metrics. Inspection capture and maintenance cost/parts fields, employee receipt acknowledgements, return/transfer photo evidence, secured storage buckets, configurable alert recipients and overdue/warranty notifications, advanced date/project filters and utilization/cost analytics, XLSX export, and end-to-end role/device tests still need implementation. These remaining workflows should be completed against a configured Supabase project before production release.
