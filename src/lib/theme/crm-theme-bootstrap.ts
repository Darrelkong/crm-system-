export const CRM_THEME_STORAGE_KEY = "crm-login-theme";

/** CRM app light chrome / safe-area */
export const CRM_THEME_COLOR_LIGHT = "#f5f7fa";
/** Login page light — close to blush-white scene gradient */
export const CRM_THEME_COLOR_LOGIN_LIGHT = "#fdf7fb";
export const CRM_THEME_COLOR_DARK = "#080b12";

export type CrmThemeBootstrapValue = "light" | "dark";

export function isLoginPathname(pathname?: string | null): boolean {
  if (!pathname) {
    return false;
  }
  return pathname === "/login" || pathname.startsWith("/login/");
}

export function resolveCrmThemeColor(
  theme: CrmThemeBootstrapValue,
  pathname?: string | null,
): string {
  if (theme === "dark") {
    return CRM_THEME_COLOR_DARK;
  }
  if (isLoginPathname(pathname)) {
    return CRM_THEME_COLOR_LOGIN_LIGHT;
  }
  return CRM_THEME_COLOR_LIGHT;
}

function replaceThemeColorMeta(color: string): void {
  document
    .querySelectorAll('meta[name="theme-color"]')
    .forEach((node) => node.remove());

  const meta = document.createElement("meta");
  meta.setAttribute("name", "theme-color");
  meta.setAttribute("content", color);
  const head = document.head;
  if (head.firstChild) {
    head.insertBefore(meta, head.firstChild);
  } else {
    head.appendChild(meta);
  }
}

function replaceColorSchemeMeta(scheme: CrmThemeBootstrapValue): void {
  document
    .querySelectorAll('meta[name="color-scheme"]')
    .forEach((node) => node.remove());

  const meta = document.createElement("meta");
  meta.setAttribute("name", "color-scheme");
  meta.setAttribute(
    "content",
    scheme === "dark" ? "dark light" : "light dark",
  );
  const head = document.head;
  const themeColorMeta = document.querySelector('meta[name="theme-color"]');
  if (themeColorMeta?.nextSibling) {
    head.insertBefore(meta, themeColorMeta.nextSibling);
  } else if (themeColorMeta) {
    head.appendChild(meta);
  } else if (head.firstChild) {
    head.insertBefore(meta, head.firstChild);
  } else {
    head.appendChild(meta);
  }
}

/** Replace every theme-color meta with a single tag (no media) for iOS Safari. */
export function setCrmThemeColorMeta(color: string): void {
  if (typeof document === "undefined") {
    return;
  }

  replaceThemeColorMeta(color);

  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      replaceThemeColorMeta(color);
    });
  }
}

export function setCrmColorSchemeMeta(scheme: CrmThemeBootstrapValue): void {
  if (typeof document === "undefined") {
    return;
  }

  replaceColorSchemeMeta(scheme);

  if (typeof requestAnimationFrame !== "undefined") {
    requestAnimationFrame(() => {
      replaceColorSchemeMeta(scheme);
    });
  }
}

/** Inline script — runs before React hydration to avoid theme flash and iOS chrome mismatch. */
export const CRM_THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(CRM_THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var theme=t==="dark"?"dark":"light";var root=document.documentElement;root.dataset.theme=theme;root.style.colorScheme=theme;var path=location.pathname;var loginPath=path==="/login"||path.indexOf("/login/")===0;var lightColor=loginPath?${JSON.stringify(CRM_THEME_COLOR_LOGIN_LIGHT)}:${JSON.stringify(CRM_THEME_COLOR_LIGHT)};var color=theme==="dark"?${JSON.stringify(CRM_THEME_COLOR_DARK)}:lightColor;var metas=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<metas.length;i++){metas[i].parentNode.removeChild(metas[i]);}var meta=document.createElement("meta");meta.setAttribute("name","theme-color");meta.setAttribute("content",color);var head=document.head;if(head.firstChild){head.insertBefore(meta,head.firstChild);}else{head.appendChild(meta);}var schemeMetas=document.querySelectorAll('meta[name="color-scheme"]');for(var j=0;j<schemeMetas.length;j++){schemeMetas[j].parentNode.removeChild(schemeMetas[j]);}var schemeMeta=document.createElement("meta");schemeMeta.setAttribute("name","color-scheme");schemeMeta.setAttribute("content",theme==="dark"?"dark light":"light dark");if(meta.nextSibling){head.insertBefore(schemeMeta,meta.nextSibling);}else{head.appendChild(schemeMeta);}var bg=theme==="dark"?${JSON.stringify(CRM_THEME_COLOR_DARK)}:lightColor;root.style.backgroundColor=bg;if(document.body){document.body.style.backgroundColor=bg;}}catch(e){}})();`;
