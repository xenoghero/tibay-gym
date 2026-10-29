# Payment methods and QR accounts

Admin setup: **Account settings → Payment methods**. Add up to six GCash, Maya, or bank accounts with a display name, account holder, account/mobile number, optional uploaded QR image, and enabled toggle. Cash remains available. Saved accounts are disabled rather than deleted; disabled slots can be edited and reused.

Enabled accounts appear in paid daily check-ins, membership purchases, renewals, and corrections of rejected customer payments. Selecting an electronic account shows its receiving details and QR download, then requires a private receipt. Receipt storage must be ready before electronic payment submission is available. Payments stay pending until an admin reviews the receipt reference and amount and approves receipt of funds.

Account settings live in `gymSettings/payments`, independently of pricing. Writes require verified admin authorization, use revision checks and stable operation IDs, and append an audit event. QR files are decoded, stripped of metadata, and stored as bounded PNG data; SVGs and remote image URLs are rejected. No new storage bucket or database migration is required.

The displayed settings revision travels through receipt upload and payment submission. Stale or disabled choices are rejected. Receipt proof binds the customer, amount, charge, account, and settings revision. Each submitted payment snapshots its account details; editing or disabling an account does not rewrite pending or historical payments. Existing GCash requests retain their historical reference validation and approval behavior.

GCash references remain numeric. Bank and Maya references allow letters, digits, spaces, and hyphens, normalized for duplicate detection. GCash references retain their existing global claims; other electronic references are scoped by account type and receiving account number. Admins must check OCR suggestions against the actual received transfer and manually correct references when necessary.

Payment review, daily history, customer history, and the financial ledger show the submitted account name. Collection totals separate Cash, GCash, and other electronic payments. Membership activation and coverage still occur only after approval.

Validation includes settings authorization and body limits, concurrent/replayed saves, invalid QR data, PNG normalization, stale and disabled accounts, receipt/account binding, daily bank check-ins, renewal approval, reference deduplication, reporting, and customer/admin form interactions.
