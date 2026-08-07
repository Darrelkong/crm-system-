import { mkdirSync, writeFileSync } from "node:fs";
import en from "../src/i18n/locales/en";
import zhHans from "../src/i18n/locales/zh-Hans";
import zhHant from "../src/i18n/locales/zh-Hant";

mkdirSync("public/locales", { recursive: true });

writeFileSync("public/locales/en.json", JSON.stringify(en));
writeFileSync("public/locales/zh-Hans.json", JSON.stringify(zhHans));
writeFileSync("public/locales/zh-Hant.json", JSON.stringify(zhHant));

console.log("Generated public/locales/*.json");
