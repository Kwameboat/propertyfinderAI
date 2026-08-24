/**

 * Route inbound agency WhatsApp to JAB sales vs platform tenant (shop without WABA).

 */



import {

  listPlatformTenants,

  getPlatformTenantBySlug,

  getPlatformTenantSession,

  setPlatformTenantSession,

  clearPlatformTenantSession,

  resolvePlatformSlugForClient

} from "./hub-db/platform-tenant.mjs";



const AGENCY_INTENT_RE =

  /\b(jab|digital hub|digitalhub|waba|paystack|onboard|onboarding|setup fee|setup package|agency|top[\s-]?up|topup|credits|pricing for jab|jab ai|jab whatsapp|become a client|sign up|signup)\b/i;



const MENU_INTENT_RE = /\b(menu|list shops|other shop|switch shop|change shop|back to menu)\b/i;



function normalizePhone(value) {

  return String(value || "").replace(/\D/g, "");

}



function parseSlugFromText(text) {

  const raw = String(text || "");

  const refMatch = raw.match(/\b(?:ref|shop|tenant|platform)\s*[:#-]?\s*([a-z0-9-]{2,48})\b/i);

  if (refMatch) return refMatch[1].toLowerCase();

  const hashMatch = raw.match(/#([a-z0-9-]{2,48})\b/i);

  if (hashMatch) return hashMatch[1].toLowerCase();

  return null;

}



function tenantSearchText(text) {

  const trimmed = String(text || "").trim();

  const hiMatch = trimmed.match(/^(?:hi|hello|hey)\s+(.+)$/i);

  return (hiMatch ? hiMatch[1] : trimmed).trim().toLowerCase();

}



function isActiveTenant(tenants, instanceName) {

  return tenants.some((t) => t.instance_name === instanceName);

}



function matchTenantByName(tenants, text) {

  const search = tenantSearchText(text);

  if (!search || search.length < 2) return null;

  for (const t of tenants) {

    const name = String(t.display_name || "").trim().toLowerCase();

    const slug = String(t.platform_slug || resolvePlatformSlugForClient(t) || "").toLowerCase();

    if (name && search === name) return t;

    if (slug && (search === slug || search === slug.replace(/-/g, " "))) return t;

  }

  return null;

}



function matchTenantByMenuNumber(tenants, text) {

  const m = String(text || "").trim().match(/^(\d{1,2})\b/);

  if (!m) return null;

  const idx = Number(m[1]) - 1;

  return tenants[idx] || null;

}



function bindTenantRoute(db, agencyInstance, phone, tenant, hadSession) {

  const previous = hadSession?.instance_name || null;

  setPlatformTenantSession(db, agencyInstance, phone, tenant.instance_name);

  const switched = previous !== tenant.instance_name;

  return {

    action: "tenant",

    tenantInstance: tenant.instance_name,

    welcomeText: switched ? buildTenantWelcome(tenant) : undefined,

    newlyBound: switched

  };

}



export function buildTenantPickerMenu(tenants, { agencyBrand = "JAB Digital Hub" } = {}) {

  if (!tenants.length) {

    return `Hi! You're on ${agencyBrand} WhatsApp. How can we help you today?`;

  }

  const lines = [

    `Welcome to ${agencyBrand} WhatsApp.`,

    "Who would you like to chat with? Reply with the number or shop name:",

    ...tenants.map((t, i) => `${i + 1}. ${t.display_name || t.instance_name}`),

    "",

    "For JAB AI setup, pricing & onboarding, reply JAB."

  ];

  return lines.join("\n");

}



export function buildTenantWelcome(tenant) {

  const name = tenant?.display_name || tenant?.instance_name || "our team";

  return `You're now chatting with ${name}. How can we help you today?`;

}



/**

 * @returns {{ action: 'agency'|'tenant'|'menu', tenantInstance?: string, menuText?: string, welcomeText?: string, newlyBound?: boolean }}

 */

export function resolvePlatformRoute(db, { agencyInstance, customerPhone, inboundText }) {

  const tenants = listPlatformTenants(db, { agencyInstanceName: agencyInstance });

  if (!tenants.length) {

    return { action: "agency" };

  }



  const text = String(inboundText || "").trim();

  const phone = normalizePhone(customerPhone);

  const hadSession = getPlatformTenantSession(db, agencyInstance, phone);



  if (MENU_INTENT_RE.test(text)) {

    clearPlatformTenantSession(db, agencyInstance, phone);

    return { action: "menu", menuText: buildTenantPickerMenu(tenants) };

  }



  if (AGENCY_INTENT_RE.test(text)) {

    clearPlatformTenantSession(db, agencyInstance, phone);

    return { action: "agency" };

  }



  const slug = parseSlugFromText(text);

  if (slug) {

    const bySlug = getPlatformTenantBySlug(db, slug);

    if (bySlug && bySlug.instance_name !== agencyInstance && isActiveTenant(tenants, bySlug.instance_name)) {

      return bindTenantRoute(db, agencyInstance, phone, bySlug, hadSession);

    }

  }



  const byNumber = matchTenantByMenuNumber(tenants, text);

  if (byNumber) {

    return bindTenantRoute(db, agencyInstance, phone, byNumber, hadSession);

  }



  const byName = matchTenantByName(tenants, text);

  if (byName) {

    return bindTenantRoute(db, agencyInstance, phone, byName, hadSession);

  }



  if (hadSession?.instance_name && isActiveTenant(tenants, hadSession.instance_name)) {

    return { action: "tenant", tenantInstance: hadSession.instance_name };

  }



  if (tenants.length === 1 && /^(hi|hello|hey|good\s*(morning|afternoon|evening)|start)$/i.test(text)) {

    return bindTenantRoute(db, agencyInstance, phone, tenants[0], hadSession);

  }



  if (/^(hi|hello|hey|start)$/i.test(text) || text.length < 8) {

    return { action: "menu", menuText: buildTenantPickerMenu(tenants) };

  }



  return { action: "menu", menuText: buildTenantPickerMenu(tenants) };

}

