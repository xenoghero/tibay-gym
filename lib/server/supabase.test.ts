import { afterEach, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
import { supabaseAdmin } from "./supabase";

afterEach(() => vi.unstubAllEnvs());

it("blocks live Supabase access in isolated development even with credentials", () => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "1");
  vi.stubEnv("SUPABASE_URL", "https://example.supabase.co");
  vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
  expect(() => supabaseAdmin()).toThrow("disabled in isolated development");
});

it("fails clearly when server credentials are missing", () => {
  vi.stubEnv("NEXT_PUBLIC_FIREBASE_ISOLATED", "");
  vi.stubEnv("SUPABASE_URL", "");
  vi.stubEnv("SUPABASE_SECRET_KEY", "");
  expect(() => supabaseAdmin()).toThrow("Configure SUPABASE_URL and SUPABASE_SECRET_KEY");
});
