import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function read(relativePath: string): string {
  return readFileSync(relativePath, "utf8");
}

describe("customer governance admin UI", () => {
  it("keeps Settings global-only without a member policy shortcut", () => {
    const settings = read(
      "src/app/(dashboard)/admin/settings/settings-client.tsx",
    );

    assert.match(settings, /新人公共池保护期/);
    assert.match(settings, /45 天/);
    assert.doesNotMatch(settings, /管理成员领取权限/);
    assert.doesNotMatch(settings, /href="\/admin\/public-pool-members"/);
  });

  it("renders isolated member cards and a Public Pool policy panel", () => {
    const client = read(
      "src/app/(dashboard)/admin/public-pool-members/public-pool-members-client.tsx",
    );

    for (const text of [
      "新人保护期",
      "可领取",
      "已暂停",
      "首次登录",
      "自动开放",
      "剩余",
      "下次可领取",
      "使用系统默认",
      "自定义",
      "管理权限 →",
      "暂停领取",
      "恢复领取",
      "当前有效规则",
      "保存领取权限",
      "public-pool-policy",
    ]) {
      assert.match(client, new RegExp(text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
    assert.match(client, /单独管理团队成员的公共池领取资格、配额及冷却时间/);
    assert.doesNotMatch(
      client,
      /用户管理|设备授权|Cloudflare Access|建立团队成员账号|重置密码|解锁账号|删除团队成员/,
    );
  });

  it("keeps generic account administration on the generic users page", () => {
    const usersPage = read("src/app/(dashboard)/admin/users/page.tsx");
    const usersClient = read(
      "src/app/(dashboard)/admin/users/users-client.tsx",
    );
    assert.match(usersPage, /用户管理/);
    assert.match(usersPage, /UsersClient/);
    assert.doesNotMatch(usersPage, /公共池领取权限|public-pool-members/);
    assert.doesNotMatch(usersClient, /PublicPoolPolicyCard/);
    assert.doesNotMatch(usersClient, /public-pool-policy/);
    assert.doesNotMatch(usersClient, /poolClaimPaused|pool_claim_quota_override/);
  });

  it("keeps the dedicated page as the only member policy editor", () => {
    const page = read(
      "src/app/(dashboard)/admin/public-pool-members/page.tsx",
    );
    const client = read(
      "src/app/(dashboard)/admin/public-pool-members/public-pool-members-client.tsx",
    );
    const api = read("src/app/api/admin/public-pool-members/route.ts");

    assert.match(page, /PublicPoolMembersClient/);
    assert.match(api, /requireAdmin/);
    for (const control of [
      "领取资格",
      "首次登录",
      "自动开放",
      "7 天领取配额",
      "领取冷却",
      "保存领取权限",
    ]) {
      assert.match(client, new RegExp(control.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    }
  });

  it("shows the fixed collaboration reminder rule without old dissolution copy", () => {
    const settings = read(
      "src/app/(dashboard)/admin/settings/settings-client.tsx",
    );
    const simplified = read("src/i18n/locales/zh-Hans.ts");
    const traditional = read("src/i18n/locales/zh-Hant.ts");

    assert.match(settings, /CollaborationReminderPolicyCard/);
    for (const locale of [simplified, traditional]) {
      assert.match(locale, /collaborationReminder/);
      assert.match(locale, /协作客户无跟进提醒|協作客戶無跟進提醒/);
      assert.match(locale, /10 天/);
      assert.match(locale, /协作关系长期有效|協作關係長期有效/);
      assert.doesNotMatch(locale, /90 天自动解散|90 天自動解散|共同负责自动解散/);
    }
    assert.match(settings, /SETTINGS_LINK_CARDS/);
  });
});
