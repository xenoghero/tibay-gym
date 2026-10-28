import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

// process.env wins over Next's .env.local. Never copy real project configuration
// into the isolated client bundle, even when the workspace has production credentials.
export function isolatedEnvironment(source = process.env) {
  const env = { ...source };
  for (const key of Object.keys(env)) {
    if (key.startsWith("NEXT_PUBLIC_FIREBASE_") || key.startsWith("FIREBASE_ADMIN_") ||
        key === "GOOGLE_APPLICATION_CREDENTIALS") env[key] = "";
  }
  return { ...env,
    NEXT_PUBLIC_FIREBASE_ISOLATED: "1",
    NEXT_PUBLIC_FIREBASE_PROJECT_ID: "demo-reshape-attendance",
    NEXT_PUBLIC_FIREBASE_API_KEY: "demo-emulator-key",
    NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN: "demo-reshape-attendance.firebaseapp.com",
    NEXT_PUBLIC_FIREBASE_APP_ID: "demo-reshape-attendance",
    NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET: "",
    NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID: "",
    NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID: "",
    NEXT_PUBLIC_APP_URL: "",
    NEXT_PUBLIC_FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    NEXT_PUBLIC_FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    FIREBASE_ADMIN_PROJECT_ID: "demo-reshape-attendance",
    FIREBASE_ADMIN_CLIENT_EMAIL: "",
    FIREBASE_ADMIN_PRIVATE_KEY: "",
    FIREBASE_ADMIN_ALLOWED_UID: "isolated-admin",
    GOOGLE_APPLICATION_CREDENTIALS: "",
    GCLOUD_PROJECT: "demo-reshape-attendance",
    GOOGLE_CLOUD_PROJECT: "demo-reshape-attendance",
    FIRESTORE_EMULATOR_HOST: "127.0.0.1:8080",
    FIREBASE_AUTH_EMULATOR_HOST: "127.0.0.1:9099",
    CRON_SECRET: "isolated-cleanup-secret",
  };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const child = spawn(process.execPath, ["node_modules/next/dist/bin/next", "dev", "--hostname", "127.0.0.1", ...process.argv.slice(2)], {
    env: isolatedEnvironment(), stdio: "inherit",
  });
  child.on("error", () => { console.error("Could not start isolated development server"); process.exitCode = 1; });
  child.on("exit", (code) => { process.exitCode = code ?? 1; });
}
