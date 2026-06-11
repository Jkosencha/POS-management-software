# Sunrise Minimart — Point of Sale System

A full-stack, cloud-backed Point of Sale system built for a minimart in Kenya. Runs on any device with a browser, supports M-Pesa payments, works offline, and prints 80mm thermal receipts.


## Overview

This POS system replaces paper-based sales tracking at a minimart. It runs in the browser on any device — a laptop at the counter, a tablet for the owner, or a phone in a pinch. All data lives in Supabase (PostgreSQL), which means every device sees the same inventory and sales in real time.

**Key design goals:**
- No desktop app to install — just open a URL
- Works offline when internet drops; sales sync automatically when reconnected
- M-Pesa STK push built in — customers pay on their phone without cash handling
- Role separation — cashiers see the register; owners and managers see the full business picture
- Stock is always accurate — every sale, restock, and adjustment is tracked and can be audited

---

## Features

### Register (Cashier)
- Browse products by category or search by name
- Barcode scanner support (HID keyboard mode — plug in a USB scanner and it just works)
- Cart with quantity controls and item removal
- Discount percentage per sale
- VAT calculation (inclusive, configurable rate)
- Payment methods: Cash (with change calculation), M-Pesa STK Push, Card
- Printed 80mm thermal receipt on each sale
- Offline mode — sales queue locally and sync when internet returns

### Dashboard (Admin/Manager)
- Live sales feed for today, updating in real time
- Four stat cards: today's revenue, average basket, M-Pesa total, low-stock count
- Payment method split (Cash / M-Pesa / Card breakdown)
- Top-selling products today, ranked by revenue
- Revenue trend chart — last 7 or 30 days
- Stock alerts for items running low or out
- Day close / Z-report with cash reconciliation

### Inventory
- Full product list with stock levels, categories, and low-stock highlighting
- Add new products with name, SKU, barcode, category, price, and low-stock threshold
- Restock, return, adjustment, and spoilage movements — all logged with reason and notes
- Full stock history per product with running balance
- Barcode scanner integration — scan to instantly open a product's restock panel

### Sales History
- Complete list of all sales with date, cashier, method, and total
- Void a sale (manager/owner only) — atomically reverses the transaction and restocks all items
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
- Change any staff member's role (cashier / manager / owner)
- Invite new staff by email — they receive a link to set their own password
- Cannot change your own role (enforced at both UI and database trigger level)

### Settings
- Each user can update their own display name (appears in the greeting and on receipts)
- Owner can update: store name, currency symbol, VAT rate, receipt footer message
