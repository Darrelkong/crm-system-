import React, { act, StrictMode, type ComponentProps } from "react";
import { createRoot } from "react-dom/client";
import { CustomersListClient } from "@/app/(dashboard)/customers/customers-list-client";
import { I18nProvider } from "@/i18n/provider";

declare global {
  interface Window {
    __relationshipNavigate: (href: string) => void;
  }
}
window.IS_REACT_ACT_ENVIRONMENT = true;
localStorage.setItem("crm_locale", "en");
const root = createRoot(document.getElementById("mount")!);
const requests: string[] = [];
const errors: string[] = [];
const checks: string[] = [];
const originalError = console.error;
console.error = (...args: unknown[]) => { errors.push(args.map(String).join(" ")); originalError(...args); };
const originalFetch = window.fetch.bind(window);
window.fetch = (input, init) => {
  const url = new URL(String(input), location.origin);
  if (url.origin !== location.origin) throw new Error("Remote request forbidden");
  requests.push(url.pathname + url.search);
  return originalFetch(input, init);
};
function check(value: unknown, message: string) { if (!value) throw new Error(message); checks.push(message); }
async function settle(ms = 40) { await act(async () => { await new Promise(resolve => setTimeout(resolve, ms)); }); }
type Page = { key: string; props: ComponentProps<typeof CustomersListClient> };
async function navigate(href: string, admin = false) {
  const url = new URL(href, location.origin);
  const params = new URLSearchParams(url.search);
  if (admin) params.set("actor", "admin");
  const page: Page = await (await fetch(`/fixture/page?${params}`)).json();
  history.pushState(null, "", url.pathname + url.search);
  await act(async () => root.render(<StrictMode><I18nProvider>
    <CustomersListClient key={page.key} {...page.props} />
  </I18nProvider></StrictMode>));
  await settle();
}
let navigation: Promise<void> = Promise.resolve();
window.__relationshipNavigate = href => { navigation = navigate(href); };
const mount = () => document.getElementById("mount")!;
const customerIds = () => [...new Set([...mount().querySelectorAll<HTMLAnchorElement>('a[href^="/customers/"]')]
  .map(a => a.getAttribute("href")!.split("/").pop()!)
  .filter(id => id !== "new"))];
function rows(prefix: string, count: number) {
  const ids = customerIds();
  check(ids.length === count && ids.every(id => id.startsWith(prefix)), `${prefix}: ${count} correctly scoped rendered records`);
}
async function tab(relationship?: string) {
  const link = [...mount().querySelectorAll<HTMLAnchorElement>("nav a")].find(a =>
    new URL(a.href).searchParams.get("relationship") === (relationship ?? null));
  check(link, `tab exists: ${relationship ?? "all"}`);
  await act(async () => link!.click()); await navigation;
  check(new URL(location.href).searchParams.get("relationship") === (relationship ?? null), "tab URL preserves relationship");
  check(!new URL(location.href).searchParams.has("page"), "tab starts at page 1");
}
async function nextPage(search = false) {
  const buttons = [...mount().querySelectorAll<HTMLButtonElement>('nav[aria-label="Pagination"] button')];
  const button = buttons.find(b => b.textContent?.trim() === "2");
  check(button, "page 2 control available");
  await act(async () => button!.click()); await settle(search ? 400 : 40);
}
async function search(value: string) {
  const input = mount().querySelector<HTMLInputElement>('input[type="search"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, value);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await settle(400);
}
try {
  await navigate("/customers?relationship=owner"); rows("owned-", 40);
  await nextPage(); rows("owned-", 5);
  check(new URL(location.href).searchParams.get("relationship") === "owner" && new URL(location.href).searchParams.get("page") === "2", "pagination URL retains owner scope");
  await tab("collaborator"); rows("collab-", 40);
  await nextPage(); rows("collab-", 3);
  check(requests.some(url => url === "/api/customers?page=2&relationship=collaborator"), "pagination API retains collaborator scope");
  await search("needle"); rows("collab-", 40);
  await nextPage(true); rows("collab-", 3);
  check(requests.some(url => { const u = new URL(url, location.origin); return u.pathname === "/api/customers" && u.searchParams.get("q") === "needle" && u.searchParams.get("page") === "2" && u.searchParams.get("relationship") === "collaborator"; }), "search pagination sends correct relationship");
  await search("owned"); check(customerIds().length === 0, "search cannot cross into owner-only records");
  await tab("owner"); rows("owned-", 40);
  await search("collab"); check(customerIds().length === 0, "owner search cannot cross into collaborator-only records");
  await tab(); check(customerIds().length === 40, "all tab restores full permitted page");
  await navigate("/customers?relationship=collaborator"); rows("collab-", 40);
  await navigate("/customers?relationship=invalid"); check(customerIds().length === 40, "invalid relationship safely renders normal scope");
  await navigate("/customers?relationship=owner", true);
  check(!mount().querySelector('nav a[aria-current="page"]'), "Admin has no staff relationship tabs");
  check(customerIds().length === 40, "Admin list remains populated");
  const requestCount = requests.length; await settle(400);
  check(requests.length === requestCount, "idle request count stays bounded");
  check(errors.length === 0, "no React lifecycle warnings/errors");
  const result = { ok: true, assertionCount: checks.length, checks, apiRequests: requests.filter(r => r.startsWith("/api/")), errors };
  document.getElementById("result")!.textContent = JSON.stringify(result, null, 2);
  await originalFetch("/result", { method: "POST", body: JSON.stringify(result) });
} catch (error) {
  const result = { ok: false, assertionCount: checks.length, checks, error: String(error), errors, requests };
  document.getElementById("result")!.textContent = JSON.stringify(result, null, 2);
  await originalFetch("/result", { method: "POST", body: JSON.stringify(result) });
} finally { await act(async () => root.unmount()); }
