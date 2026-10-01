import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import en from '@/i18n/locales/en';
import hans from '@/i18n/locales/zh-Hans';
import hant from '@/i18n/locales/zh-Hant';
import { translate } from '@/i18n/translate';
for (const [locale, messages, expected] of [['en',en,'Image blocked for privacy'],['zh-Hans',hans,'为保护隐私，图片已屏蔽'],['zh-Hant',hant,'為保護隱私，圖片已封鎖']] as const) test(`image UI real translator/catalog contract ${locale}`,()=>{
  assert.equal(translate(messages,'mail.detail.imageBlocked'),expected);
  const generated=JSON.parse(readFileSync(`public/locales/${locale}.json`,'utf8'));
  for (const key of ['imageBlocked','tinyImageBlocked','loadImages','imagePrivacy','imagesLoaded']) {
    const value=translate(messages,`mail.detail.${key}`);
    assert.notEqual(value,`mail.detail.${key}`);
    assert.equal(generated.mail.detail[key],value);
  }
});
