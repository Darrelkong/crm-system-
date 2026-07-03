import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  generateDeviceId,
  getDeviceCookieOptions,
  hashDeviceId,
  readDeviceIdFromCookieHeader,
  resolveDeviceIdFromRequest,
} from "@/lib/auth/device";
import { DEVICE_COOKIE_NAME } from "@/lib/auth/constants";

describe("device cookie helpers", () => {
  it("generates high-entropy device ids", () => {
    const a = generateDeviceId();
    const b = generateDeviceId();
    assert.ok(a.length >= 32);
    assert.notEqual(a, b);
  });

  it("hashes device ids with sha-256 hex", async () => {
    const hash = await hashDeviceId("test-device-id");
    assert.match(hash, /^[0-9a-f]{64}$/);
    const again = await hashDeviceId("test-device-id");
    assert.equal(hash, again);
  });

  it("uses secure httpOnly lax cookie options in production", () => {
    const options = getDeviceCookieOptions(new Date("2030-01-01T00:00:00.000Z"));
    assert.equal(options.name, DEVICE_COOKIE_NAME);
    assert.equal(options.httpOnly, true);
    assert.equal(options.sameSite, "lax");
    assert.equal(options.path, "/");
    assert.equal(typeof options.secure, "boolean");
  });

  it("reads device id from cookie header", () => {
    const cookie = `${DEVICE_COOKIE_NAME}=abc123; crm_session=xyz`;
    assert.equal(readDeviceIdFromCookieHeader(cookie), "abc123");
    assert.equal(readDeviceIdFromCookieHeader(null), null);
  });

  it("resolves existing device id from request", () => {
    const request = new Request("https://crm.example/login", {
      headers: {
        cookie: `${DEVICE_COOKIE_NAME}=existing-device`,
      },
    });
    const resolved = resolveDeviceIdFromRequest(request);
    assert.equal(resolved.deviceId, "existing-device");
    assert.equal(resolved.isNew, false);
  });

  it("generates new device id when cookie missing", () => {
    const request = new Request("https://crm.example/login");
    const resolved = resolveDeviceIdFromRequest(request);
    assert.ok(resolved.deviceId.length >= 32);
    assert.equal(resolved.isNew, true);
  });
});
