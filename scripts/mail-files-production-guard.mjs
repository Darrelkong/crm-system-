import { readFile } from "node:fs/promises";

export const GATEWAY_CONFIG_PATH =
  "wrangler.echfronthk-mail-files.production.jsonc";
export const GATEWAY_WORKER_NAME = "echfront-mail-files";
export const GATEWAY_ENTRYPOINT = "workers/echfront-mail-files/index.ts";
export const GATEWAY_SECRET_NAME = "CRM_SYSTEM_GATEWAY_SECRET";
export const GATEWAY_SERVICE_BINDING = "CRM_SYSTEM";
export const GATEWAY_SERVICE_NAME = "crm-system";
export const GATEWAY_R2_BINDING = "LARGE_ATTACHMENTS";
export const GATEWAY_R2_BUCKET = "crm-mail-large-attachments";
export const GATEWAY_HOSTNAME = "files.echfronthk.com";

export class MailFilesProductionGuardError extends Error {
  constructor(message) {
    super(message);
    this.name = "MailFilesProductionGuardError";
  }
}

export async function readGatewayProductionConfig(repositoryRoot) {
  const path = `${repositoryRoot}/${GATEWAY_CONFIG_PATH}`;
  let source;
  try {
    source = await readFile(path, "utf8");
  } catch {
    throw new MailFilesProductionGuardError(
      `Missing Gateway Production config: ${path}`,
    );
  }

  let config;
  try {
    config = JSON.parse(source);
  } catch (error) {
    throw new MailFilesProductionGuardError(
      `Invalid Gateway Production config: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  return { config, source };
}

function isObject(value) {
  return typeof value === "object" && value !== null;
}

function findBinding(bindings, key, value) {
  return (
    Array.isArray(bindings) &&
    bindings.some(
      (binding) => binding?.[key] === value,
    )
  );
}

export function assertGatewayProductionConfig(config, source = "") {
  if (!isObject(config)) {
    throw new MailFilesProductionGuardError("Gateway config is not an object.");
  }
  if (config.name !== GATEWAY_WORKER_NAME) {
    throw new MailFilesProductionGuardError(
      `Unexpected Gateway Worker name: ${config.name ?? "(missing)"}.`,
    );
  }
  if (config.main !== GATEWAY_ENTRYPOINT) {
    throw new MailFilesProductionGuardError(
      `Gateway main must be ${GATEWAY_ENTRYPOINT}.`,
    );
  }
  if (config.workers_dev !== false || config.preview_urls !== false) {
    throw new MailFilesProductionGuardError(
      "Gateway Production config must disable workers_dev and preview_urls.",
    );
  }
  if (config.compatibility_date !== "2026-01-01") {
    throw new MailFilesProductionGuardError(
      "Gateway compatibility_date must remain 2026-01-01.",
    );
  }
  if (
    !Array.isArray(config.routes) ||
    config.routes.length !== 1 ||
    config.routes[0]?.pattern !== GATEWAY_HOSTNAME ||
    config.routes[0]?.custom_domain !== true
  ) {
    throw new MailFilesProductionGuardError(
      `Gateway must declare the ${GATEWAY_HOSTNAME} custom domain.`,
    );
  }
  if (
    !findBinding(config.r2_buckets, "binding", GATEWAY_R2_BINDING) ||
    config.r2_buckets.find(
      (binding) => binding.binding === GATEWAY_R2_BINDING,
    )?.bucket_name !== GATEWAY_R2_BUCKET
  ) {
    throw new MailFilesProductionGuardError(
      `Gateway must bind ${GATEWAY_R2_BINDING} to ${GATEWAY_R2_BUCKET}.`,
    );
  }
  if (
    !findBinding(config.services, "binding", GATEWAY_SERVICE_BINDING) ||
    config.services.find(
      (binding) => binding.binding === GATEWAY_SERVICE_BINDING,
    )?.service !== GATEWAY_SERVICE_NAME
  ) {
    throw new MailFilesProductionGuardError(
      `Gateway must bind ${GATEWAY_SERVICE_BINDING} to ${GATEWAY_SERVICE_NAME}.`,
    );
  }
  if (
    config.d1_databases ||
    config.send_email ||
    config.vars ||
    config.secrets ||
    /mail-test|local-large-attachment|crm-system-local/i.test(source)
  ) {
    throw new MailFilesProductionGuardError(
      "Gateway Production config contains a forbidden local/test or broad binding.",
    );
  }
  return true;
}
