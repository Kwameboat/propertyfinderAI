/**
 * Small Evolution API client for outbound WhatsApp sends.
 */

export async function readHubEnv(envPath) {
  const { readFile } = await import("node:fs/promises");
  try {
    const raw = await readFile(envPath, "utf8");
    const env = {};
    for (const line of raw.split(/\r?\n/)) {
      if (!line || line.trim().startsWith("#") || !line.includes("=")) continue;
      const i = line.indexOf("=");
      env[line.slice(0, i).trim()] = line.slice(i + 1).trim();
    }
    return env;
  } catch {
    return {};
  }
}

export function getEvolutionConfig(hubEnv = {}, processEnv = process.env) {
  const evoApiUrl = (
    processEnv.EVO_API_URL ||
    hubEnv.SERVER_URL ||
    "http://localhost:8080"
  ).replace(/\/$/, "");
  const globalKey =
    processEnv.EVO_GLOBAL_KEY ||
    processEnv.AUTHENTICATION_API_KEY ||
    hubEnv.AUTHENTICATION_API_KEY ||
    "";
  return { evoApiUrl, globalKey };
}

export async function fetchEvolutionInstances(evoApiUrl, globalKey) {
  const response = await fetch(`${evoApiUrl}/instance/fetchInstances`, {
    headers: { apikey: globalKey }
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`fetchInstances failed ${response.status}: ${body}`);
  const parsed = JSON.parse(body || "[]");
  if (Array.isArray(parsed)) return parsed;
  if (Array.isArray(parsed?.value)) return parsed.value;
  if (parsed?.name) return [parsed];
  return [];
}

export async function resolveEvolutionInstanceToken(evoApiUrl, globalKey, instanceName) {
  const instances = await fetchEvolutionInstances(evoApiUrl, globalKey);
  const match = instances.find((i) => i.name === instanceName);
  const token = match?.token || match?.apikey || match?.hash?.apikey || "";
  if (!token) throw new Error(`No Evolution token for instance "${instanceName}"`);
  return { token, instance: match };
}

export async function sendEvolutionText({
  evoApiUrl,
  apiKey,
  instance,
  number,
  text,
  linkPreview = false,
  category = "default",
  isAgency = false
}) {
  if (category !== "default" || isAgency) {
    const { guardedEvolutionSend } = await import("./whatsapp-guard.mjs");
    return guardedEvolutionSend({
      evoApiUrl,
      apiKey,
      instance,
      number,
      text,
      category: category === "default" ? "reply" : category,
      isAgency,
      linkPreview
    });
  }
  const url = `${evoApiUrl}/message/sendText/${encodeURIComponent(instance)}`;
  const response = await fetch(url, {
    method: "POST",
    headers: {
      apikey: apiKey,
      "Content-Type": "application/json"
    },
    body: JSON.stringify({ number, text, linkPreview })
  });
  const body = await response.text();
  if (!response.ok) {
    throw new Error(`Evolution sendText failed ${response.status}: ${body}`);
  }
  try {
    return JSON.parse(body);
  } catch {
    return { raw: body };
  }
}

export async function getEvolutionConnectionState(evoApiUrl, apiKey, instance) {
  const response = await fetch(
    `${evoApiUrl}/instance/connectionState/${encodeURIComponent(instance)}`,
    { headers: { apikey: apiKey } }
  );
  const body = await response.text();
  if (!response.ok) throw new Error(`connectionState failed ${response.status}: ${body}`);
  return JSON.parse(body || "{}");
}

/** Create or refresh Evolution instance using Meta WhatsApp Cloud API. */
export async function createEvolutionCloudInstance({
  evoApiUrl,
  globalKey,
  instanceName,
  number,
  businessToken,
  webhookUrl = null
}) {
  const digits = String(number || "").replace(/\D/g, "");
  const body = {
    instanceName,
    integration: "WHATSAPP-BUSINESS",
    token: businessToken,
    number: digits,
    qrcode: false,
    webhook: webhookUrl
      ? {
          url: webhookUrl,
          byEvents: false,
          base64: false,
          events: ["MESSAGES_UPSERT", "CONNECTION_UPDATE"]
        }
      : undefined
  };
  const response = await fetch(`${evoApiUrl}/instance/create`, {
    method: "POST",
    headers: { apikey: globalKey, "Content-Type": "application/json" },
    body: JSON.stringify(body)
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`instance/create failed ${response.status}: ${text.slice(0, 400)}`);
  }
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}
