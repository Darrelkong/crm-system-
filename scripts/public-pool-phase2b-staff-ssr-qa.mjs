/**
 * Public Pool Phase 2B — Staff SSR data minimization QA (local dev).
 * Usage: npx -y puppeteer@24.6.0 node scripts/public-pool-phase2b-staff-ssr-qa.mjs
 */
import puppeteer from "puppeteer";

const BASE = process.env.CRM_QA_BASE_URL ?? "http://localhost:3000";
const ADMIN = { email: "admin@crm.local", password: "Admin123!" };
const STAFF = { email: "staff-a@crm.local", password: "StaffA123!" };
const CUSTOMERS_API = "/api/public-pool/customers";

async function login(page, creds) {
  const loginRes = await page.evaluate(async (email, password) => {
    const res = await fetch("/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    return { ok: res.ok, status: res.status };
  }, creds.email, creds.password);

  if (!loginRes.ok) {
    throw new Error(`Login failed: HTTP ${loginRes.status}`);
  }

  await page.goto(`${BASE}/staff`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
}

function trackCustomersApi(page) {
  const calls = [];
  page.on("request", (req) => {
    if (req.url().includes(CUSTOMERS_API) && req.method() === "GET") {
      calls.push({ url: req.url(), at: Date.now() });
    }
  });
  return calls;
}

async function auditStaffPage(page, width) {
  await page.setViewport({ width, height: 900 });
  const apiCalls = [];
  const onRequest = (req) => {
    if (req.url().includes(CUSTOMERS_API) && req.method() === "GET") {
      apiCalls.push({ url: req.url(), at: Date.now() });
    }
  };
  page.on("request", onRequest);

  await page.goto(`${BASE}/public-pool`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 1200));

  page.off("request", onRequest);

  const htmlAfter = await page.content();

  const ui = await page.evaluate(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const tables = [...document.querySelectorAll("table")].filter(isVisible);
    const loading = [...document.querySelectorAll("p")].some(
      (p) => p.textContent?.includes("正在加载公共池") || p.textContent?.includes("Loading public pool"),
    );
    const randomClaim = [...document.querySelectorAll("button")].some((b) =>
      /随机领取|Random claim/i.test(b.textContent ?? ""),
    );
    const compactSummary = document.querySelector(".md\\:hidden.surface-card, [class*='md:hidden']");
    return {
      visibleTables: tables.length,
      loading,
      randomClaim,
      hasCompactSummary: Boolean(compactSummary),
    };
  });

  return {
    width,
    apiCallCount: apiCalls.length,
    apiCalls,
    postHydrationHasMaskedName: htmlAfter.includes("maskedName"),
    ...ui,
  };
}

async function auditAdminMobile(page) {
  await page.setViewport({ width: 390, height: 844 });
  const apiCalls = trackCustomersApi(page);
  await page.goto(`${BASE}/public-pool`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 800));
  const ui = await page.evaluate(() => {
    const isVisible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const cards = [...document.querySelectorAll("[data-public-pool-mobile-card]")];
    const visibleCards = cards.filter(isVisible);
    const tables = [...document.querySelectorAll("table")].filter(isVisible);
    return { visibleCards: visibleCards.length, visibleTables: tables.length };
  });
  return { width: 390, apiCallCount: apiCalls.length, ...ui };
}

async function resizeTest(page) {
  await page.setViewport({ width: 390, height: 900 });
  const calls = trackCustomersApi(page);
  await page.goto(`${BASE}/public-pool`, {
    waitUntil: "networkidle2",
    timeout: 30000,
  });
  await new Promise((r) => setTimeout(r, 800));
  const mobileCalls = calls.length;

  await page.setViewport({ width: 820, height: 900 });
  await new Promise((r) => setTimeout(r, 1500));
  const afterResizeCalls = calls.length;

  await page.setViewport({ width: 390, height: 900 });
  await new Promise((r) => setTimeout(r, 800));
  const afterShrinkCalls = calls.length;

  await page.setViewport({ width: 820, height: 900 });
  await new Promise((r) => setTimeout(r, 1500));
  const finalCalls = calls.length;

  return {
    mobileCalls,
    afterResizeTo820: afterResizeCalls,
    afterShrinkTo390: afterShrinkCalls,
    afterSecondResizeTo820: finalCalls,
  };
}

async function main() {
  const browser = await puppeteer.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 30000 });

  const results = { staff: {}, admin: {}, resize: {}, console: [] };
  page.on("console", (msg) => {
    const type = msg.type();
    if (type === "error" || type === "warning") {
      results.console.push({ type, text: msg.text() });
    }
  });

  await login(page, STAFF);
  results.staff["390"] = await auditStaffPage(page, 390);
  results.staff["767"] = await auditStaffPage(page, 767);
  results.staff["768"] = await auditStaffPage(page, 768);
  results.staff["820"] = await auditStaffPage(page, 820);
  results.resize = await resizeTest(page);

  await login(page, ADMIN);
  results.admin["390"] = await auditAdminMobile(page);

  await browser.close();

  const pass390 = results.staff["390"].apiCallCount === 0;
  const pass767 = results.staff["767"].apiCallCount === 0;
  const pass768 = results.staff["768"].apiCallCount >= 1;
  const pass820 = results.staff["820"].apiCallCount >= 1 && results.staff["820"].apiCallCount <= 2;

  console.log(JSON.stringify({ results, pass: { pass390, pass767, pass768, pass820 } }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
