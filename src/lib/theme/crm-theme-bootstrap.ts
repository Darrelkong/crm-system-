export const CRM_THEME_STORAGE_KEY = "crm-login-theme";

export const CRM_THEME_COLOR_LIGHT = "#f5f7fa";
export const CRM_THEME_COLOR_DARK = "#080b12";

/** Inline script — runs before React hydration to avoid theme flash and iOS chrome mismatch. */
export const CRM_THEME_BOOTSTRAP_SCRIPT = `(function(){try{var k=${JSON.stringify(CRM_THEME_STORAGE_KEY)};var t=localStorage.getItem(k);var theme=t==="dark"?"dark":"light";var root=document.documentElement;root.dataset.theme=theme;root.style.colorScheme=theme;var color=theme==="dark"?${JSON.stringify(CRM_THEME_COLOR_DARK)}:${JSON.stringify(CRM_THEME_COLOR_LIGHT)};var meta=document.querySelector('meta[name="theme-color"]');if(!meta){meta=document.createElement("meta");meta.setAttribute("name","theme-color");document.head.appendChild(meta);}meta.setAttribute("content",color);}catch(e){}})();`;
