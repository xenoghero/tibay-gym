# Cash and GCash payments

Admin setup: **Account settings -> Payment methods -> Edit GCash details**. Edit the receiving account holder, mobile number, and optional QR image. Customers can choose Cash or the single configured GCash account. There is no add-account action, account type selector, or custom payment method name.

Existing GCash account identities are retained when editing. Legacy Maya, bank, and additional GCash accounts are excluded from new customer choices and rejected for new submissions. The next settings save retains only the selected GCash account. Pending and historical payments keep their submitted account snapshots and reference review behavior.

QR uploads accept JPG, PNG, and WebP up to 5 MB. There is no minimum resolution, sharpness, or QR readability check. Images are decoded, stripped of metadata, resized to fit 640 pixels, and optimized as palette PNGs automatically instead of rejecting detailed images. Format, input size, and image decoding safeguards remain.

Settings remain in `gymSettings/payments`, with verified admin authorization, revision checks, stable operation IDs, and audit events. The receiving account identity cannot be replaced once configured. No database migration is required.

GCash requires receipt storage to be available and a private payment receipt. The settings revision and account identity bind the receipt and payment request. Payments remain pending until admin approval. Editing account details does not rewrite historical payments.
