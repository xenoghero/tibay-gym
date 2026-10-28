# Tibay Gym

Gym management app built with Next.js and Firebase.

## Supabase connection

The receipt backend connects to **tibay-gym** in **Reinier IT Ventures**
([Supabase dashboard](https://supabase.com/dashboard/project/nqyavbidoixznjetehyv)).
Firebase continues to handle authentication and existing gym data.

The local `.env.local` is configured with `SUPABASE_URL` and
`SUPABASE_SECRET_KEY`. On another machine, copy the variable names from
`.env.example` and get the existing secret key from Supabase's API Keys page.
Add both variables separately to your hosting environment when deploying.
Never commit the secret key or use a `NEXT_PUBLIC_` prefix for it.

Run `npm run supabase:check` to verify the database API and Storage connection
without changing any data. The server helper is `supabaseAdmin()` in
`lib/server/supabase.ts`. It is blocked in isolated development, initializes
only when called, and must be used behind Firebase authorization because its
secret key bypasses Supabase row-level security.

This setup prepares the connection only. GCash screenshot uploads, a private
receipt bucket, receipt metadata tables, and Tesseract OCR for reference
numbers and amounts will be implemented later. Receipt images belong in
Supabase Storage; extracted data belongs in database tables. No public receipt
access or upload endpoint is enabled by this setup.

## Firebase project

This repository uses **tibay-gym**. The default Firebase CLI project is set in
`.firebaserc`; `.env.example` contains its public web app configuration.

- [Firebase console](https://console.firebase.google.com/project/tibay-gym/overview)
- Web app: **Tibay Gym** (`1:542615126141:web:5e9500cbacf35b31703114`)
- Firestore: `(default)`, Standard edition, Singapore (`asia-southeast1`)
- Authentication: email/password

## Local development

Use Node.js 22 and install dependencies:

```sh
npm ci
```

On a new machine, copy `.env.example` to `.env.local`. Add the Firebase Admin
service account's client email and private key to the server-only variables.
Keep `.env.local` private; it is excluded from Git. The browser and server
project IDs must both be `tibay-gym`.

Set `FIREBASE_ADMIN_ALLOWED_UID` to the administrator's Firebase Authentication
UID, then synchronize the private authorization document:

```sh
npm run rfid:provision -- admin
```

The initial administrator email is `tibayadmin@gmail.com`. Its password is
managed in Firebase Authentication and is not stored in this repository.
The current machine's `.env.local` is already configured.

```sh
npm run dev
```

Open [localhost:3000](http://localhost:3000) and sign in at `/login`.
Restart the development server after changing `.env.local`. Public Firebase
settings are embedded at build time, so rebuild when changing projects.

For isolated attendance development with the local emulators, use
`npm run dev:isolated`; this uses the separate demo project.

## Database rules and indexes

`firebase.json` selects `firestore.cutover.rules` and `firestore.indexes.json`.
The rules use the private `_serverConfig/admin` document to authorize the admin.
Attendance and RFID mutations run through the server.

New QR guests appear under **People > Unverified members**. Approving a guest
moves their profile and visits into official dashboard totals. Profiles created
directly by the admin initialize their private attendance state on their first
scan, after the server confirms that they have no previous attendance history.
An imported profile with existing history still requires reconciliation.

```sh
firebase deploy --only firestore --project tibay-gym
```

## Hosting configuration

Configure the same variables in the hosting environment before building,
including the server credentials and administrator UID. Set
`NEXT_PUBLIC_APP_URL` to the deployed origin and add the hosting domain to
Firebase Authentication's authorized domains. Local settings are not uploaded
automatically. This Firebase setup does not deploy the Next.js app.

For unattended stale-session cleanup after hosting, schedule authenticated GET
requests to `/api/attendance/auto-close` with a server-only `CRON_SECRET` bearer
token. The dashboard also requests cleanup when opened. Retention cleanup can
be run with `npm run rfid:maintenance -- cleanup`; automatic TTL deletion is not
enabled in this project. A physical RFID scanner must be provisioned separately.

## Live verification (October 25, 2026)

Verified against `tibay-gym` using the locally running production build:

- Deployed rules match `firestore.cutover.rules`; all five composite indexes are ready.
- Public guest check-in, admin approval, live dashboard counts, and repeat-scan checkout pass.
- A first check-in for a directly admin-created profile passes.
- Unauthenticated writes and direct admin browser writes to private attendance/configuration are denied.
- Both synthetic test profiles, their visits, and receipts were removed afterward.
- All 253 automated tests, lint, and production build pass.

## Checks

```sh
npm test
npm run lint
npm run build
```
