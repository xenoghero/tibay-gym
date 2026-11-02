# Check-in promotions

Open **Account Settings → Promotions** (`/dashboard/settings#promotions`).

- Upload JPG, PNG, or WebP images up to 5 MB. Use **1500 × 500 px**, a **3:1** landscape ratio; the minimum accepted size is 900 × 300 px. Images are checked on the server and converted to WebP. The full banner is shown without cropping.
- Add a description containing the offer and any important details for customers using screen readers. Keep artwork text large enough to read on a phone.
- Uploading publishes immediately and appends the banner to the rotation. Up to eight banners may be stored.
- Edit descriptions, toggle visibility, move banners earlier/later, or remove them, then choose **Save changes**. **Discard changes** restores the saved list. Concurrent edits require a reload rather than overwriting another admin session.
- Customers see only visible banners beneath the welcome screen's check-in choices. Multiple banners rotate every six seconds and support previous/next, dots, horizontal touch swipes, and pause. Rotation pauses while hovered, focused, or the tab is hidden, and is disabled for reduced-motion preferences. A single banner has no carousel controls.
- No banners, all banners hidden, a loading failure, or all images failing to load produces no public banner section or empty placeholder. Promotions do not appear inside registration/payment forms.

## Storage

Uses the existing server Firebase admin and Supabase credentials. Metadata lives in the server-only Firestore document `gymSettings/promotions`; mutations require the same admin authorization as other settings. Audit events record the settings revision, without image contents.

The first authenticated upload creates a dedicated **public** Supabase Storage bucket, `checkin-promotions`, if it does not exist. Only public promotional artwork belongs here. Existing private photo/receipt buckets are unaffected. Browser storage write policies are not added; uploads go through the authenticated server endpoint.

Removing a saved banner immediately removes it from the public feed and attempts to delete its storage object. If storage deletion is unavailable, an unreferenced object can remain in the bucket. A failed/uncertain upload can also leave an unreferenced object; do not delete objects during ambiguous request recovery. Upload retries use stable operation IDs and content digests to avoid duplicate publication.

Endpoints: admin `GET`, `PUT` (binary image upload), `POST` (ordered metadata edits) at `/api/admin/promotions`; public visible banner feed at `/api/promotions`. Both metadata responses use `Cache-Control: no-store`. The public feed is loaded on opening the welcome screen, so customers already on the page see new promotions after reopening or refreshing it.
