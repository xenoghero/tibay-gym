"use client";

import { useState } from "react";
import { deleteDoc, doc, getDoc, serverTimestamp, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { RequireAuth } from "@/lib/auth/require-auth";

type Result =
  | { state: "idle" }
  | { state: "running" }
  | { state: "ok"; roundTrip: string }
  | { state: "error"; message: string };

// Phase 1, item 4: prove read/write connectivity against the real Firestore project.
// Writes one doc to `_connectivity_test`, reads it back, then deletes it.
export default function FirebaseCheckPage() {
  const [result, setResult] = useState<Result>({ state: "idle" });

  async function runCheck() {
    setResult({ state: "running" });
    const ref = doc(db, "_connectivity_test", `check-${Date.now()}`);
    const token = crypto.randomUUID();
    try {
      await setDoc(ref, { token, at: serverTimestamp() });
      const snap = await getDoc(ref);
      if (!snap.exists() || snap.data().token !== token) {
        throw new Error("Read back did not match what was written.");
      }
      await deleteDoc(ref);
      setResult({ state: "ok", roundTrip: token });
    } catch (err) {
      setResult({
        state: "error",
        message: err instanceof Error ? err.message : String(err),
      });
    }
  }

  return (
    <RequireAuth>
      <main className="mx-auto max-w-xl p-8 font-sans">
        <h1 className="text-xl font-semibold">Firebase connectivity check</h1>
        <p className="mt-2 text-sm text-zinc-600">
          Project: <code>{process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID}</code>
        </p>
        <button
          onClick={runCheck}
          disabled={result.state === "running"}
          className="mt-4 rounded bg-black px-4 py-2 text-sm text-white disabled:opacity-50"
        >
          {result.state === "running" ? "Running…" : "Run write + read + delete"}
        </button>

        {result.state === "ok" && (
          <p className="mt-4 rounded bg-green-100 p-3 text-sm text-green-900">
            ✅ Firestore round-trip succeeded (token <code>{result.roundTrip}</code>).
          </p>
        )}
        {result.state === "error" && (
          <p className="mt-4 rounded bg-red-100 p-3 text-sm text-red-900">
            ❌ {result.message}
          </p>
        )}
      </main>
    </RequireAuth>
  );
}
