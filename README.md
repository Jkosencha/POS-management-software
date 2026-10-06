# Sunrise Minimart: Point of Sale System

A full-stack, cloud-backed Point of Sale system built for a minimart in Kenya. Runs on any device with a browser, supports M-Pesa payments, works offline, and prints 80mm thermal receipts.


## Overview

This POS system replaces paper-based sales tracking at a minimart. It runs in the browser on any device: a laptop at the counter, a tablet for the owner, or a phone in a pinch. All data lives in Supabase (PostgreSQL), which means every device sees the same inventory and sales in real time.

**Key design goals:**
- No desktop app to install: just open a URL
- Works offline when internet drops; sales sync automatically when reconnected
- M-Pesa (Pochi la Biashara) recorded with one tap, alongside cash and card
- Role separation: cashiers see the register; owners and managers see the full business picture
- Stock is always accurate: every sale, restock, and adjustment is tracked and can be audited

---

## Features

### Register (all staff: cashiers, managers and owners can ring up sales)
- Browse products by category or search by name
- Barcode scanner support (HID keyboard mode: plug in a USB scanner and it just works)
- Cart with quantity controls and item removal
- Discount percentage per sale (cashiers up to 20%, managers and owners up to 100%)
- VAT calculation (inclusive, configurable rate)
- Payment methods: Cash (with change calculation), M-Pesa (Pochi la Biashara, recorded with one tap), Card
- Printed 80mm thermal receipt on each sale
- Offline mode: sales queue locally and sync when internet returns, credited to the cashier who rang them up; queued sales can be reviewed (and, by managers, discarded) from the sidebar

### Dashboard
Cashiers get their own dashboard showing only the sales they rang up (no cost or profit figures). Owners and managers see the whole shop:

- Recent sales feed for today, updating in real time
- Four stat cards: today's revenue, average basket, M-Pesa total, low-stock count
- Revenue vs. cost area chart: last 7, 30 or 90 days
- Sales by category donut, browsable month by month
- Payment method split donut (Cash / M-Pesa / Card)
- Top-selling products today, ranked by revenue
- Stock alerts for items running low or out
- Day close / Z-report with cash reconciliation (sidebar quick action)

### Inventory
- Full product list with stock levels, categories, and low-stock highlighting
- Add new products with name, SKU, barcode, category, price, and low-stock threshold
- Restock, return, adjustment, and spoilage movements: all logged with reason and notes
- Full stock history per product with running balance
- Barcode scanner integration: scan to instantly open a product's restock panel
- Low and out-of-stock items highlighted in red

### Partners (Owner/Manager)
- Add the business partners, each with their own color used across inventory, records and charts
- Every restock records whose stock it is (a partner, or Shared)
- Sales use up the oldest stock first (FIFO), so every unit sold is credited to the partner who owned it
- Shared stock is split evenly between partners
- Per-partner revenue, profit, units sold and stock value for any date range
- Line-by-line sales records and stock on hand, filterable by partner
- Payouts: record money each partner takes out and see their unpaid profit
- Existing stock starts as Shared; re-assign it in Inventory > History

### Categories (Admin/Manager)
- Add, rename, deactivate and delete product categories
- Renaming a category updates every product in it
- Deactivated categories, and their products, are hidden from the register
- A category that still has products can't be deleted

### Sales History
- Complete list of all sales with date, cashier, method, and total
- Void a sale (manager/owner only): atomically reverses the transaction and restocks all items
- Voided sales shown with strikethrough and a VOID badge; excluded from all revenue calculations

### Reports
- Date range picker (Today, Yesterday, 7 days, This month, This year, Custom)
- Revenue, transaction count, average basket, VAT collected
- Payment method breakdown per period
- Stock movement audit log with reason filter

### Z-Report / Day Close
- Selectable date
- Cash float reconciliation: opening float → expected cash → physically counted → variance
- Variance shown colour-coded (green = balanced, amber = over, red = short)
- Printable report saved to `day_closes` table

### Staff Management (Owner only)
- View all staff accounts with name, email, and role
- Edit a staff member's name, role (cashier / manager / owner) and active status
- Deactivate staff to block sign-in, or delete them to remove their login for good (their sales history is kept)
- Send a staff member a password reset link
- Invite new staff by email: they receive a link to set their own password
- Cannot change your own role or deactivate yourself (enforced at both UI and database trigger level)

### Settings
- Each user can update their own display name (appears in the greeting and on receipts)
- Each user can change their password; "Forgot password?" on the login screen emails a reset link
- Owner can update: store name, currency symbol, VAT rate, receipt footer message
- Danger zone (owner only): permanently delete sales in a date range, confirmed with the owner's password
