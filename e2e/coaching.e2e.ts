import { test, type Browser, type Page } from "@playwright/test";
import { ADMIN, approvePayment, expect, manilaDate, memberLogin, openDay, staffLogin } from "./fixtures";

/**
 * Coaching smoke journeys, in the order the gym lives them: catalog and coach set-up, a client signs up and pays,
 * the admin approves and assigns a coach, sessions get scheduled, planned and marked, then corrections, Freeze,
 * top-ups, a check-in start, and coach account changes. Each test builds on the one before.
 */
test.describe.configure({ mode: "serial" });

const COACH = { name: "Carlo Cruz", email: "coach@tibay.test", password: "coach-pass-1234", newPassword: "coach-pass-5678" };
const ANA = { first: "Ana", last: "Reyes", name: "Ana Reyes", phone: "09170000001" };
const BEN = { first: "Ben", last: "Santos", name: "Ben Santos", phone: "09170000002" };
const yesterday = manilaDate(-1), twoDaysAgo = manilaDate(-2), tomorrow = manilaDate(1);

let admin: Page, coach: Page, member: Page;
// A fresh caller IP per test, so the public rate limits (3 sign-ups, 5 portal logins per 15 min) apply per test, not per suite.
let caller = "";
test.beforeEach(() => { caller = `10.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250)}.${Math.floor(Math.random() * 250) + 1}`; });
async function newPage(browser: Browser) {
  const page = await (await browser.newContext()).newPage();
  await page.route("**/api/**", route => route.continue({ headers: { ...route.request().headers(), "x-e2e-caller": caller } }));
  return page;
}
test.beforeAll(async ({ browser }) => { [admin, coach, member] = await Promise.all([newPage(browser), newPage(browser), newPage(browser)]); });
test.afterAll(async () => { for (const page of [admin, coach, member]) await page?.context().close(); });

/** The public Personal training link, steps 1–4, paying cash for the package with `sessions`. */
async function signUp(page: Page, person: typeof ANA, sessions: number) {
  await page.goto("/coaching");
  await page.getByLabel("First name").fill(person.first);
  await page.getByLabel("Last name").fill(person.last);
  await page.getByLabel("Mobile number").fill(person.phone);
  await page.getByRole("radio", { name: "Regular" }).check();
  await page.getByLabel("Facebook name").fill(`${person.name} FB`);
  await page.getByRole("button", { name: /Next: preferred schedule/ }).click();
  await page.getByLabel("Start date").fill(manilaDate(1));
  await page.getByRole("checkbox", { name: "Monday" }).check();
  await page.getByRole("checkbox", { name: "Wednesday" }).check();
  await page.getByRole("radio", { name: /^Morning/ }).check();
  await page.getByLabel(/^Goals/).fill("Get stronger");
  await page.getByRole("button", { name: /Save and go to payment/ }).click();
  await page.getByRole("radiogroup", { name: "Package" }).getByRole("radio", { name: new RegExp(`^${sessions} sessions`) }).check();
  // Cash is the default method, so no receipt upload (Supabase is off in isolated mode).
  await page.getByRole("button", { name: "Submit payment request" }).click();
  await expect(page.getByRole("heading", { name: "Payment sent for review" })).toBeVisible();
}

async function adminCoaching(tab: "Schedule" | "Clients") {
  await admin.goto("/dashboard/coaching");
  await admin.getByRole("group", { name: "Coaching view" }).getByRole("button", { name: tab }).click();
}

async function memberCoaching() {
  await memberLogin(member, ANA.phone);
  await member.getByRole("navigation", { name: "Member navigation" }).getByRole("link", { name: "Coaching" }).click();
  return member.getByRole("region", { name: "Your package" });
}

/** Add session sheet: pick the client, day and start time, then confirm. */
async function addSession(sheet: ReturnType<Page["getByRole"]>, client: string, date: string, start: string, muscle?: string) {
  await sheet.getByRole("button", { name: /^Client/ }).click();
  await sheet.getByRole("radio", { name: new RegExp(client) }).click();
  await sheet.locator('input[type="date"]').fill(date);
  await sheet.getByLabel("Start").selectOption({ label: start });
  if (muscle) await sheet.getByRole("button", { name: muscle, exact: true }).click();
  await sheet.getByRole("button", { name: new RegExp(`^Add ${client.split(" ")[0]} · ${start}`) }).click();
  // Once saved, the sheet turns into that day's sheet.
  await expect(sheet).toBeHidden();
}

/** Closes the open sheet with Esc and waits for it to go, so the next click lands on the page. */
async function closeSheet(page: Page) {
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
}

test("1. admin sets up the coaching catalog", async () => {
  await staffLogin(admin, ADMIN.email, ADMIN.password);
  await admin.waitForURL("**/dashboard**");
  await admin.goto("/dashboard/settings#coaching");
  await admin.getByRole("group", { name: "Coaching settings" }).getByRole("button", { name: "Packages" }).click();
  await admin.getByRole("button", { name: "Add package" }).click();
  const sheet = admin.getByRole("dialog", { name: "New package" });
  await sheet.getByLabel("Price (₱)").fill("2500");
  await sheet.getByLabel("Sessions").fill("10");
  await sheet.getByLabel("Valid for (days)").fill("30");
  await sheet.getByRole("switch", { name: /Show to customers/ }).click();
  await sheet.getByRole("button", { name: "Add package" }).click();
  await expect(admin.getByText("₱2,500 package added. Applies to new purchases.")).toBeVisible();

  await admin.getByRole("button", { name: "Edit session top-ups" }).click();
  const topUps = admin.getByRole("dialog", { name: "Session top-ups" });
  await topUps.getByLabel("Price per session (₱)").fill("300");
  await topUps.getByRole("button", { name: "Save top-ups" }).click();
  await expect(admin.getByText("₱300/ session")).toBeVisible();
});

test("2. admin creates a coach, who signs in to an empty coach portal", async () => {
  await admin.getByRole("group", { name: "Coaching settings" }).getByRole("button", { name: "Coaches" }).click();
  await admin.getByRole("button", { name: "Add coach" }).click();
  const sheet = admin.getByRole("dialog", { name: "Add a coach" });
  await sheet.getByLabel("Name").fill(COACH.name);
  await sheet.getByLabel("Email").fill(COACH.email);
  await sheet.getByLabel("Starting password").fill(COACH.password);
  await sheet.getByRole("button", { name: "Create coach" }).click();
  await expect(admin.getByText(COACH.email)).toBeVisible();

  await staffLogin(coach, COACH.email, COACH.password);
  await coach.waitForURL("**/coach");
  await expect(coach.getByRole("heading", { name: "Schedule" })).toBeVisible();
  await coach.goto("/coach/clients");
  await expect(coach.getByRole("heading", { name: "No clients yet" })).toBeVisible();
});

test("3. a new client signs up on the Personal training link and pays cash", async () => {
  await signUp(member, ANA, 10);
  await memberLogin(member, ANA.phone);
  await member.getByRole("navigation", { name: "Member navigation" }).getByRole("link", { name: "Payments" }).click();
  await expect(member.getByText(/Coaching/).first()).toBeVisible();
  await expect(member.getByText(/pending/i).first()).toBeVisible();
});

test("4. the same phone cannot sign up twice", async () => {
  await member.context().clearCookies();
  await member.goto("/coaching");
  await member.getByLabel("First name").fill("Ana");
  await member.getByLabel("Last name").fill("Again");
  await member.getByLabel("Mobile number").fill(ANA.phone);
  await member.getByRole("radio", { name: "Regular" }).check();
  await member.getByLabel("Facebook name").fill("Ana Again");
  await member.getByRole("button", { name: /Next: preferred schedule/ }).click();
  await member.getByLabel("Start date").fill(manilaDate(1));
  await member.getByRole("checkbox", { name: "Friday" }).check();
  await member.getByRole("radio", { name: /^Evening/ }).check();
  await member.getByRole("button", { name: /Save and go to payment/ }).click();
  await expect(member.getByText("This number already has an account")).toBeVisible();
});

test("5. admin approves the payment; the package is approved but not started", async () => {
  await approvePayment(admin, ANA.name);
  const card = await memberCoaching();
  await expect(card).toContainText("Approved, not started");
  await expect(card).toContainText("Not assigned yet");
});

test("6. admin assigns the client to the coach", async () => {
  await adminCoaching("Clients");
  await admin.getByRole("button", { name: "Assign coach" }).click();
  const sheet = admin.getByRole("dialog", { name: "Assign a coach" });
  await sheet.getByRole("radio", { name: new RegExp(COACH.name) }).click();
  await sheet.getByRole("checkbox").uncheck(); // "Book the first session next" is tested on its own below
  await sheet.getByRole("button", { name: `Assign ${COACH.name}` }).click();
  await expect(admin.getByRole("status")).toContainText(`${ANA.name} is now coached by ${COACH.name}.`);

  await coach.goto("/coach/clients");
  await expect(coach.getByRole("list", { name: "Your clients" })).toContainText(ANA.name);
  await expect(await memberCoaching()).toContainText(COACH.name);
});

test("7. admin schedules a walk-in yesterday and a session tomorrow", async () => {
  await adminCoaching("Schedule");
  await admin.getByRole("button", { name: "+ Add session" }).click();
  await addSession(admin.getByRole("dialog", { name: "Add session" }), ANA.name, yesterday, "9:00 AM", "Legs");
  await closeSheet(admin);

  await admin.getByRole("button", { name: "+ Add session" }).click();
  await addSession(admin.getByRole("dialog", { name: "Add session" }), ANA.name, tomorrow, "10:00 AM");
  await closeSheet(admin);

  // Both show on the coach's own schedule.
  await coach.goto("/coach");
  await expect(await openDay(coach, yesterday)).toContainText(ANA.name);
  await closeSheet(coach);
  await expect(await openDay(coach, tomorrow)).toContainText(ANA.name);
  await closeSheet(coach);
});

test("8. the coach refuses a clashing time", async () => {
  const day = await openDay(coach, yesterday);
  await day.getByRole("button", { name: /Add session/ }).click();
  const sheet = coach.getByRole("dialog", { name: "Add session" });
  await sheet.getByRole("button", { name: /^Client/ }).click();
  await sheet.getByRole("radio", { name: new RegExp(ANA.name) }).click();
  await sheet.getByLabel("Start").selectOption({ label: "9:00 AM" });
  await expect(sheet.getByRole("button", { name: /That time is taken/ })).toBeDisabled();
  await closeSheet(coach);
});

test("9. the coach plans the session, logs sets and a note, and marks it done", async () => {
  const day = await openDay(coach, yesterday);
  await day.getByRole("button", { name: new RegExp(ANA.name) }).click();
  const sheet = coach.getByRole("dialog", { name: ANA.name });
  await sheet.getByLabel("New exercise").fill("Goblet squat");
  await sheet.getByLabel("New exercise").press("Enter");
  await sheet.getByRole("button", { name: "+ Add set" }).click();
  await sheet.getByLabel("Goblet squat set 1 reps").fill("10");
  await sheet.getByLabel("Goblet squat set 1 kg").fill("20");
  await sheet.getByPlaceholder("How did it go?").fill("Great depth today");
  await sheet.getByRole("button", { name: /Mark session done/ }).click();
  await expect(sheet.getByText("✓ Session done")).toBeVisible();
  await closeSheet(coach);

  // The first session starts the package; the member sees it and the note.
  const card = await memberCoaching();
  await expect(card).toContainText("Active");
  await expect(card).toContainText("of 10 · 1 done");
  const sessions = member.getByRole("region", { name: "My sessions" });
  if (yesterday.slice(0, 7) !== manilaDate().slice(0, 7)) await sessions.getByRole("button", { name: "Previous month" }).click();
  await sessions.getByRole("button", { name: /Done|done/ }).first().click();
  await expect(member.getByText("Great depth today")).toBeVisible();
  await closeSheet(member);
});

test("10. the coach records a no-show, undoes it, then cancels the session", async () => {
  await coach.goto("/coach");
  const day = await openDay(coach, twoDaysAgo);
  await day.getByRole("button", { name: /Add session/ }).click();
  await addSession(coach.getByRole("dialog", { name: "Add session" }), ANA.name, twoDaysAgo, "7:00 AM");
  await coach.getByRole("dialog").getByRole("button", { name: new RegExp(ANA.name) }).click();
  const sheet = coach.getByRole("dialog", { name: ANA.name });
  await sheet.getByRole("button", { name: /No-show/ }).click();
  await expect(sheet.getByText("No-show · no session used")).toBeVisible();
  await sheet.getByRole("button", { name: "Undo" }).click();
  await expect(sheet.getByRole("button", { name: /Mark session done/ })).toBeVisible();
  await sheet.getByRole("button", { name: "Cancel session" }).click();
  await expect(coach.getByRole("dialog")).toContainText("No sessions yet.");
  await closeSheet(coach);
});

test("11. the coach moves tomorrow's session to another time", async () => {
  const day = await openDay(coach, tomorrow);
  await day.getByRole("button", { name: new RegExp(ANA.name) }).click();
  const sheet = coach.getByRole("dialog", { name: ANA.name });
  await sheet.getByRole("button", { name: "Change day or time" }).click();
  await sheet.getByLabel("Start").selectOption({ label: "11:00 AM" });
  await sheet.getByRole("button", { name: "Save time" }).click();
  await expect(sheet).toContainText("11:00 AM");
  await closeSheet(coach);
});

test("12. admin fixes a mark and adjusts sessions left with a reason", async () => {
  await adminCoaching("Clients");
  await admin.getByRole("button", { name: "Sessions" }).click();
  const sheet = admin.getByRole("dialog", { name: ANA.name });
  const history = sheet.getByRole("region", { name: "Session history" });
  await expect(history).toContainText("✓ Session done");
  await history.getByRole("button", { name: "No-show" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Mark corrected.");
  await expect(history).toContainText("no session used");
  await history.getByRole("button", { name: "Done", exact: true }).click();
  await expect(history).toContainText("✓ Session done");

  await sheet.getByRole("button", { name: "Adjust" }).click();
  await sheet.getByLabel("Sessions left").fill("12");
  await sheet.getByLabel("Reason").fill("Two bonus sessions for referral");
  await sheet.getByRole("button", { name: "Save adjustment" }).click();
  await expect(sheet.getByRole("status")).toHaveText("Session adjustment saved.");
  await expect((await memberCoaching()).getByText("12", { exact: true })).toBeVisible();
});

test("13. Freeze: member requests, admin approves, booking is blocked, member unfreezes", async () => {
  const card = await memberCoaching();
  await card.getByRole("button", { name: "Request a Freeze" }).click();
  await expect(card).toContainText("Freeze requested.");

  await adminCoaching("Clients");
  const requests = admin.getByRole("region", { name: "Freeze requests" });
  await expect(requests).toContainText(ANA.name);
  await requests.getByRole("button", { name: "Approve (starts today)" }).click();
  // Tomorrow's session falls inside the Freeze, so it is cancelled.
  await expect(requests.getByRole("status")).toContainText("Freeze approved. Cancelled 1 session");

  await adminCoaching("Schedule");
  await admin.getByRole("button", { name: "+ Add session" }).click();
  const sheet = admin.getByRole("dialog", { name: "Add session" });
  await sheet.getByRole("button", { name: /^Client/ }).click();
  await expect(sheet.getByRole("radio", { name: new RegExp(ANA.name) })).toBeDisabled();
  await expect(sheet).toContainText("Frozen · can’t be added");
  await closeSheet(admin);

  const frozen = await memberCoaching();
  await expect(frozen).toContainText("Frozen");
  await frozen.getByRole("button", { name: "Unfreeze now" }).click();
  await expect(frozen).toContainText("Active");
});

test("14. member buys session top-ups and they add to the package once approved", async () => {
  await memberCoaching();
  const buy = member.getByRole("region", { name: "Session top-ups" });
  await buy.getByRole("button", { name: "More sessions" }).click();
  await buy.getByRole("button", { name: /Buy 2 top-ups/ }).click();
  await member.getByRole("button", { name: "Submit payment request" }).click();
  await expect(member.getByText(/Payment request submitted/)).toBeVisible();

  await approvePayment(admin, ANA.name);
  // On an active package, top-ups join the package itself: 12 + 2.
  await expect((await memberCoaching()).getByText("14", { exact: true })).toBeVisible();
});

test("15. admin assigns a second client and books the first session straight away", async () => {
  await signUp(member, BEN, 10);
  await approvePayment(admin, BEN.name);
  await adminCoaching("Clients");
  await admin.getByRole("button", { name: "Assign coach" }).click();
  const sheet = admin.getByRole("dialog", { name: "Assign a coach" });
  await sheet.getByRole("radio", { name: new RegExp(COACH.name) }).click();
  await sheet.getByRole("button", { name: `Assign ${COACH.name}` }).click();
  // "Book the first session next" is on by default and opens Add session with Ben picked.
  const add = admin.getByRole("dialog", { name: "Add session" });
  await expect(add.getByRole("button", { name: /^Client/ })).toContainText(BEN.name);
  await add.locator('input[type="date"]').fill(tomorrow);
  await add.getByLabel("Start").selectOption({ label: "4:00 PM" });
  await add.getByRole("button", { name: /^Add Ben · 4:00 PM/ }).click();
  await expect(admin.getByRole("dialog")).toContainText(BEN.name);
  await closeSheet(admin);
});

test("16. the first check-in starts an approved package", async () => {
  await member.context().clearCookies();
  await member.goto("/checkin");
  await member.getByRole("button", { name: /^Check in/i }).click();
  await member.getByLabel("Phone number").fill(BEN.phone);
  await member.getByRole("button", { name: "Check in", exact: true }).click();
  // The package's membership month covers this visit, so there is no daily payment step.
  await expect(member.getByText("You’re checked in")).toBeVisible();
  await memberLogin(member, BEN.phone);
  await member.getByRole("navigation", { name: "Member navigation" }).getByRole("link", { name: "Coaching" }).click();
  await expect(member.getByRole("region", { name: "Your package" })).toContainText("Active");
});

test("17. admin resets the coach's password, then deactivates the coach", async () => {
  await admin.goto("/dashboard/settings#coaching");
  await admin.getByRole("group", { name: "Coaching settings" }).getByRole("button", { name: "Coaches" }).click();
  await admin.getByLabel(`Actions for ${COACH.name}`).click();
  await admin.getByRole("button", { name: "Reset password" }).click();
  const reset = admin.getByRole("dialog", { name: `Reset ${COACH.name}'s password?` });
  await reset.getByLabel("New starting password").fill(COACH.newPassword);
  await reset.getByRole("button", { name: "Reset password" }).click();
  await expect(admin.getByText(`Password reset for ${COACH.name}.`)).toBeVisible();

  await coach.context().clearCookies();
  await coach.evaluate(() => indexedDB.deleteDatabase("firebaseLocalStorageDb"));
  await staffLogin(coach, COACH.email, COACH.newPassword);
  await coach.waitForURL("**/coach");

  await admin.getByLabel(`Actions for ${COACH.name}`).click();
  await admin.getByRole("button", { name: "Deactivate…" }).click();
  await admin.getByRole("dialog", { name: `Deactivate ${COACH.name}?` }).getByRole("button", { name: "Deactivate" }).click();
  await expect(admin.getByText("Deactivated")).toBeVisible();

  // Their clients go back to needing a coach.
  await adminCoaching("Clients");
  await expect(admin.getByRole("button", { name: "Assign coach" })).toHaveCount(2);
});
