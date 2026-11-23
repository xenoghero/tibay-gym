import { expect, type Page } from "@playwright/test";

/** Test-only values for the emulator's demo project; none of these exist in the live gym. */
export const PROJECT = "demo-reshape-attendance";
export const ADMIN = { email: "admin@tibay.test", password: "admin-pass-1234" };

/** Staff sign-in (admin or coach) on the shared login page. */
export async function staffLogin(page: Page, email: string, password: string) {
  await page.goto("/login");
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password", { exact: true }).fill(password);
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
}

/** Opens the member portal by phone number, the way a member does. */
export async function memberLogin(page: Page, phone: string) {
  await page.goto("/customer");
  await page.getByLabel("Phone number").fill(phone);
  await page.getByRole("button", { name: "View my membership" }).click();
  await expect(page.getByRole("navigation", { name: "Member navigation" })).toBeVisible();
}

/** Today in Manila as YYYY-MM-DD, shifted by whole days. */
export function manilaDate(shiftDays = 0) {
  return new Date(Date.now() + 8 * 3_600_000 + shiftDays * 86_400_000).toISOString().slice(0, 10);
}

/** Opens a day card on the coach or admin Schedule, moving one month if the day is outside the current one. */
export async function openDay(page: Page, date: string) {
  const today = manilaDate();
  if (date.slice(0, 7) !== today.slice(0, 7)) await page.getByRole("button", { name: date < today ? "Previous month" : "Next month" }).click();
  const label = new Date(`${date}T00:00:00Z`).toLocaleDateString("en-PH", { timeZone: "UTC", weekday: "long", month: "long", day: "numeric" });
  await page.getByRole("button", { name: new RegExp(`^${label},`) }).click();
  return page.getByRole("dialog");
}

/** Admin › Payments: approves the newest pending request for one customer. */
export async function approvePayment(page: Page, name: string) {
  await page.goto("/dashboard/payments");
  await page.getByRole("row").filter({ hasText: name }).filter({ hasText: "Pending" }).getByRole("button", { name: `Review payment for ${name}` }).click();
  await page.getByLabel("I reviewed the amount, evidence and final coverage.").check();
  await page.getByRole("button", { name: "Approve — payment received" }).click();
  await expect(page.getByText(/^Payment confirmed\./)).toBeVisible();
}

export { expect };
