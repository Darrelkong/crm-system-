/**
 * Public Pool Phase 1 — mobile release gate (local dev only).
 * Usage: npx -y puppeteer@24.6.0 node scripts/public-pool-phase1-mobile-qa.mjs
 */
import puppeteer from "puppeteer";

const BASE = process.env.CRM_QA_BASE_URL ?? "http://localhost:3000";
const ADMIN = { email: "admin@crm.local", password: "Admin123!" };
const STAFF = { email: "staff-a@crm.local", password: "StaffA123!" };

const MOBILE_WIDTHS = [320, 375, 390, 430];
const MOBILE_HEIGHT = 844;

async function login(page, creds) {
  await page.goto(`${BASE}/login`, { waitUntil: "networkidle2", timeout: 30000 });
  const emailSel = 'input[type="email"], input[name="email"]';
  const passSel = 'input[type="password"]';
  await page.waitForSelector(emailSel);
  await page.$eval(emailSel, (el) => {
    el.value = "";
  });
  await page.type(emailSel, creds.email, { delay: 10 });
  await page.type(passSel, creds.password, { delay: 10 });
  await page.click('button[type="submit"]');
  await page.waitForFunction(
    () => !location.pathname.startsWith("/login"),
    { timeout: 20000 },
  );
}

async function goPublicPool(page) {
  await page.goto(`${BASE}/public-pool`, { waitUntil: "networkidle2", timeout: 30000 });
  await new Promise((r) => setTimeout(r, 600));
}

async function auditPublicPool(page, role) {
  return page.evaluate((roleName) => {
    const viewportWidth = window.innerWidth;
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
    const cards = [...document.querySelectorAll("article.surface-card")].filter(isVisible);
    const ths = [...document.querySelectorAll("thead th")].filter(isVisible);
    const rowClaims = [...document.querySelectorAll("button")].filter(
      (b) => isVisible(b) && /^(领取|領取|Claim)$/i.test(b.textContent?.trim() ?? ""),
    );
    const randomBtn = [...document.querySelectorAll("button")].find(
      (b) =>
        isVisible(b) &&
        /随机领取|隨機領取|Random claim/i.test(b.textContent ?? ""),
    );
    const maskedVisible = [...document.querySelectorAll("body *")].filter(
      (el) => isVisible(el) && /\*\*/.test(el.textContent ?? "") && el.children.length === 0,
    ).length;

    const docScrollWidth = document.documentElement.scrollWidth;
    const horizontalOverflow = docScrollWidth > viewportWidth + 2;

    const stackedHeaders = ths.filter((th) => {
      const lineHeight = parseFloat(getComputedStyle(th).lineHeight) || 16;
      return th.offsetHeight > lineHeight * 2.5;
    }).length;

    const issues = [];
    if (horizontalOverflow) issues.push("horizontal_overflow");

    if (roleName === "admin") {
      if (viewportWidth < 768) {
        if (tables.length > 0) issues.push("admin_table_visible_on_mobile");
        if (cards.length === 0) issues.push("admin_no_mobile_cards");
        if (randomBtn) issues.push("admin_random_claim_on_mobile");
      } else {
        if (tables.length === 0) issues.push("admin_table_missing_desktop");
        if (cards.length > 0) issues.push("admin_cards_visible_desktop");
      }
    }

    if (roleName === "staff") {
      if (viewportWidth < 768) {
        if (tables.length > 0) issues.push("staff_table_visible_on_mobile");
        if (ths.length > 0) issues.push("staff_table_headers_on_mobile");
        if (rowClaims.length > 0) issues.push("staff_row_claim_on_mobile");
        if (!randomBtn) issues.push("staff_random_claim_missing");
        if (maskedVisible > 0) issues.push("staff_masked_name_visible");
      } else {
        if (tables.length === 0) issues.push("staff_table_missing_desktop");
        if (randomBtn) issues.push("staff_random_claim_on_desktop");
      }
    }

    if (viewportWidth >= 768 && stackedHeaders > 2) {
      issues.push(`stacked_headers:${stackedHeaders}`);
    }

    return {
      tableVis: tables.length,
      cardVis: cards.length,
      randomVis: Boolean(randomBtn),
      maskedVis: maskedVisible,
      thVis: ths.length,
      rowClaimVis: rowClaims.length,
      horizontalOverflow,
      stackedHeaders,
      issues,
      pass: issues.length === 0,
    };
  }, role);
}

async function setDarkMode(page, dark) {
  await page.evaluate((enabled) => {
    document.documentElement.dataset.theme = enabled ? "dark" : "light";
    localStorage.setItem("crm-login-theme", enabled ? "dark" : "light");
  }, dark);
}

async function runRoleChecks(browser, role, creds) {
  const page = await browser.newPage();
  const consoleErrors = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") consoleErrors.push(msg.text());
  });
  page.on("pageerror", (err) => consoleErrors.push(String(err)));

  await login(page, creds);
  const out = { light: {}, dark: {}, consoleErrors };

  for (const w of MOBILE_WIDTHS) {
    await page.setViewport({ width: w, height: MOBILE_HEIGHT });
    await setDarkMode(page, false);
    await goPublicPool(page);
    out.light[w] = await auditPublicPool(page, role);
  }

  for (const w of [390, 430]) {
    await page.setViewport({ width: w, height: MOBILE_HEIGHT });
    await setDarkMode(page, true);
    await goPublicPool(page);
    out.dark[w] = await auditPublicPool(page, role);
  }

  await page.close();
  return out;
}

async function main() {
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox"],
  });

  const results = {
    admin: await runRoleChecks(browser, "admin", ADMIN),
    staff: await runRoleChecks(browser, "staff", STAFF),
    breakpoints: {},
    functional: {},
  };

  for (const spec of [
    { w: 767, h: 844, role: "staff", creds: STAFF },
    { w: 768, h: 844, role: "admin", creds: ADMIN },
    { w: 768, h: 844, role: "staff", creds: STAFF },
    { w: 820, h: 1180, role: "admin", creds: ADMIN },
    { w: 1024, h: 768, role: "admin", creds: ADMIN },
    { w: 1280, h: 800, role: "admin", creds: ADMIN },
    { w: 1440, h: 900, role: "admin", creds: ADMIN },
  ]) {
    const page = await browser.newPage();
    await login(page, spec.creds);
    await page.setViewport({ width: spec.w, height: spec.h });
    await goPublicPool(page);
    results.breakpoints[`${spec.w}x${spec.h}_${spec.role}`] = await auditPublicPool(
      page,
      spec.role,
    );
    await page.close();
  }

  const adminPage = await browser.newPage();
  await login(adminPage, ADMIN);
  await adminPage.setViewport({ width: 390, height: 844 });
  await goPublicPool(adminPage);
  results.functional.adminViewButton = await adminPage.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && /查看|View/i.test(b.textContent ?? "");
    });
    return btns.length > 0;
  });
  results.functional.adminClaimButton = await adminPage.evaluate(() => {
    const btns = [...document.querySelectorAll("button")].filter((b) => {
      const r = b.getBoundingClientRect();
      return r.width > 0 && /^(领取|領取)$/.test(b.textContent?.trim() ?? "");
    });
    return btns.length > 0;
  });
  results.functional.adminNameLink = await adminPage.evaluate(() => {
    const links = [...document.querySelectorAll("article.surface-card a")].filter((a) => {
      const r = a.getBoundingClientRect();
      return r.width > 0;
    });
    return links.length > 0;
  });
  await adminPage.close();

  const staffPage = await browser.newPage();
  await login(staffPage, STAFF);
  await staffPage.setViewport({ width: 390, height: 844 });
  await goPublicPool(staffPage);
  results.functional.staffRandomClaimEnabled = await staffPage.evaluate(() => {
    const btn = [...document.querySelectorAll("button")].find((b) =>
      /随机领取|隨機領取/i.test(b.textContent ?? ""),
    );
    return btn ? !btn.disabled : false;
  });

  if (process.env.CRM_QA_ALLOW_CLAIM === "1" && results.functional.staffRandomClaimEnabled) {
    await staffPage.click('button:not([disabled])');
    await new Promise((r) => setTimeout(r, 3500));
    results.functional.randomClaimDialog = await staffPage.evaluate(
      () => !!document.querySelector('[role="dialog"], .modal, [data-state="open"]'),
    );
    results.functional.previewBeforeClaim = await staffPage.evaluate(() => {
      return [...document.querySelectorAll("body *")].filter(
        (el) => /\*\*/.test(el.textContent ?? "") && el.children.length === 0,
      ).length;
    });
  } else {
    results.functional.randomClaimDialog = "NOT_EXECUTED";
    results.functional.previewBeforeClaim = "NOT_EXECUTED";
  }
  await staffPage.close();

  await browser.close();
  console.log(JSON.stringify(results, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
