import {
  CRM_BOOT_SPLASH_FADE_MS,
  resolveBootSplashLoadingText,
} from "./boot-splash";

export function buildBootSplashInitScript(allowDevPreview: boolean): string {
  const loadingMessages = JSON.stringify({
    en: resolveBootSplashLoadingText("en"),
    "zh-Hant": resolveBootSplashLoadingText("zh-Hant"),
    "zh-Hans": resolveBootSplashLoadingText("zh-Hans"),
  });

  return `(function(){try{var root=document.documentElement;var params=new URLSearchParams(location.search);var allowDevPreview=${allowDevPreview ? "true" : "false"};var preview=allowDevPreview&&params.get("startupPreview")==="1";var debug=params.get("startupDebug")==="1";var standalone=false;var displayModeStandalone=false;try{displayModeStandalone=window.matchMedia("(display-mode: standalone)").matches;standalone=displayModeStandalone||window.navigator.standalone===true;}catch(e){}if(standalone&&!displayModeStandalone&&window.navigator.standalone===true){root.classList.add("crm-boot-splash-ios-standalone");}var showSplash=standalone||preview;var collectTiming=showSplash||debug;if(!collectTiming){return;}if(debug){root.dataset.crmStartupDebug="visible";}if(!showSplash){return;}if(preview){root.dataset.crmBootPreview="1";}var lang=root.lang||"en";var message=${loadingMessages};var msgNode=document.getElementById("crm-boot-splash-message");if(msgNode){msgNode.textContent=message[lang]||message.en;}var splash=document.getElementById("crm-boot-splash");if(splash){splash.removeAttribute("hidden");}var timing=window.__crmStartupTiming||{marks:{}};window.__crmStartupTiming=timing;timing.startupPreview=preview;timing.startupDebug=debug;timing.standalone=standalone;timing.navigationStartMs=0;timing.marks.bootShellVisible=performance.now();timing.bootShellVisibleMs=Math.round(timing.marks.bootShellVisible);function markDomReady(){timing.marks.domContentLoaded=performance.now();timing.domContentLoadedMs=Math.round(timing.marks.domContentLoaded);}if(document.readyState==="loading"){document.addEventListener("DOMContentLoaded",markDomReady,{once:true});}else{markDomReady();}function markWindowLoad(){timing.marks.windowLoad=performance.now();timing.windowLoadMs=Math.round(timing.marks.windowLoad);}if(document.readyState==="complete"){markWindowLoad();}else{window.addEventListener("load",markWindowLoad,{once:true});}try{var nav=performance.getEntriesByType("navigation")[0];if(nav){timing.responseStartMs=Math.round(nav.responseStart);timing.responseEndMs=Math.round(nav.responseEnd);if(!timing.domContentLoadedMs&&nav.domContentLoadedEventEnd){timing.domContentLoadedMs=Math.round(nav.domContentLoadedEventEnd);}if(!timing.windowLoadMs&&nav.loadEventEnd){timing.windowLoadMs=Math.round(nav.loadEventEnd);}}}catch(e){}window.__crmDismissBootSplash=function(reason){if(timing.marks.bootShellDismissed){return;}timing.marks.bootShellDismissed=performance.now();timing.bootShellDismissedMs=Math.round(timing.marks.bootShellDismissed);timing.dismissReason=reason||"ready";if(!splash){return;}splash.classList.add("crm-boot-splash--dismissed");window.setTimeout(function(){splash.classList.add("crm-boot-splash--removed");splash.setAttribute("hidden","hidden");},${CRM_BOOT_SPLASH_FADE_MS});};}catch(e){}})();`;
}

export const CRM_BOOT_SPLASH_INIT_SCRIPT = buildBootSplashInitScript(
  process.env.NODE_ENV !== "production",
);
