/**
 * Normalize external property payloads into listing input shape.
 */

function collectImages(prop = {}) {
  const images = [];
  if (prop.coverPhoto?.url) images.push(prop.coverPhoto.url);
  if (prop.image?.url) images.push(prop.image.url);
  for (const p of prop.photos || prop.images || prop.media || []) {
    if (typeof p === "string") images.push(p);
    else {
      const url = p?.url || p?.medium || p?.full || p?.original || p?.large;
      if (url) images.push(url);
    }
  }
  return [...new Set(images.filter(Boolean))];
}

function emirateFromLocationPath(pathName = "") {
  const first = String(pathName).split(",")[0]?.trim();
  return first || "Dubai";
}

/** Coerce portal strings like "studio" into numeric DB values. */
export function parseNumericField(value) {
  if (value == null || value === "") return null;
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const s = String(value).trim().toLowerCase();
  if (s === "studio") return 0;
  const n = Number(s.replace(/[^\d.]/g, ""));
  return Number.isFinite(n) ? n : null;
}

export function normalizeListingRow(input = {}) {
  return {
    source: input.source,
    external_id: String(input.external_id),
    source_url: input.source_url || "",
    transaction_type: input.transaction_type,
    property_type: input.property_type || "apartment",
    beds: parseNumericField(input.beds),
    baths: parseNumericField(input.baths),
    emirate: input.emirate || "Dubai",
    community: input.community || "",
    sub_community: input.sub_community || "",
    building: input.building || "",
    price_aed: Number(input.price_aed || 0),
    price_period: input.price_period || (input.transaction_type === "rent" ? "yearly" : "total"),
    handover_date: input.handover_date || null,
    payment_plan: input.payment_plan || "",
    developer: input.developer || "",
    furnished: input.furnished,
    amenities: input.amenities || [],
    images: input.images || [],
    description: input.description || "",
    agent_name: input.agent_name || "",
    agent_phone: input.agent_phone || "",
    agency_name: input.agency_name || "",
    rera_permit: input.rera_permit || "",
    lat: input.lat ?? null,
    lng: input.lng ?? null
  };
}

export function normalizeRapidApiProperty(prop, purpose = "for-sale") {
  const loc = prop.location || [];
  const byLevel = (n) => loc.find((l) => l.level === n)?.name?.en || loc.find((l) => l.level === n)?.name;
  const emirate = byLevel(1) || "Dubai";
  const community = byLevel(2) || "";
  const sub = byLevel(3) || "";
  const title = prop.title?.en || prop.title || "";
  const images = collectImages(prop);
  const phone = prop.phoneNumber?.mobile || prop.phoneNumber?.phone || prop.contactMethod?.phone || "";
  return normalizeListingRow({
    source: "bayut",
    external_id: String(prop.externalID || prop.id),
    source_url: prop.slug
      ? `https://www.bayut.com/property/details-${prop.externalID || prop.id}.html`
      : `https://www.bayut.com/`,
    transaction_type:
      purpose === "for-rent"
        ? "rent"
        : prop.completionStatus === "under-construction" || prop.isOffPlan
          ? "off_plan"
          : "sale",
    property_type: String(prop.category?.slug || prop.propertyType || "apartment").replace(/_/g, " "),
    beds: prop.rooms ?? prop.bedrooms ?? null,
    baths: prop.baths ?? null,
    emirate,
    community,
    sub_community: sub,
    building: prop.building?.name?.en || "",
    price_aed: Number(prop.price || 0),
    price_period: purpose === "for-rent" ? prop.rentFrequency || "yearly" : "total",
    handover_date: prop.handoverDate || prop.completionDetails?.startDate || null,
    payment_plan: prop.paymentPlan || "",
    developer: prop.developer?.name?.en || prop.developerName || "",
    furnished: prop.furnishingStatus === "furnished" ? true : prop.furnishingStatus === "unfurnished" ? false : null,
    amenities: (prop.amenities || []).map((a) => (typeof a === "string" ? a : a?.text?.en || a?.name || "")).filter(Boolean),
    images: [...new Set(images)],
    description: title,
    agent_name: prop.contactName || prop.agent?.name || "",
    agent_phone: phone,
    agency_name: prop.agency?.name || "",
    rera_permit: prop.permitNumber || "",
    lat: prop.geography?.lat ?? null,
    lng: prop.geography?.lng ?? null
  });
}

export function normalizeNewProject(prop) {
  const loc = prop.location || [];
  const emirate = loc.find((l) => l.level === 1)?.name?.en || "Dubai";
  const community = loc.find((l) => l.level === 2)?.name?.en || "";
  const images = [];
  if (prop.coverPhoto?.url) images.push(prop.coverPhoto.url);
  return normalizeListingRow({
    source: "bayut",
    external_id: `project-${prop.externalID || prop.id}`,
    source_url: prop.slug ? `https://www.bayut.com/new-projects/details-${prop.externalID}.html` : "https://www.bayut.com/new-projects/",
    transaction_type: "off_plan",
    property_type: "apartment",
    beds: prop.roomsMin ?? prop.rooms ?? null,
    baths: prop.bathsMin ?? null,
    emirate,
    community,
    price_aed: Number(prop.price || prop.startingPrice || 0),
    price_period: "total",
    handover_date: prop.completionDate || prop.handoverDate || null,
    payment_plan: prop.paymentPlan || prop.paymentPlans?.[0]?.description || "",
    developer: prop.developer?.name?.en || prop.developerName || "",
    images: [...new Set(images)],
    description: prop.title?.en || prop.title || "",
    agent_name: prop.contactName || "",
    agent_phone: prop.phoneNumber?.mobile || "",
    agency_name: prop.developer?.name?.en || ""
  });
}

export function normalizePropertyFinderV2Property(prop) {
  const images = (prop.images || [])
    .map((i) => i.medium_image_url || i.small_image_url || i.url)
    .filter(Boolean);
  const locParts = String(prop.location?.full_name || prop.location?.name || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  const category = String(prop.listing_category || "").toLowerCase();
  const transaction_type =
    category === "rent"
      ? "rent"
      : prop.completion_status === "off_plan" || String(prop.completion_status || "").includes("plan")
        ? "off_plan"
        : "sale";

  return normalizeListingRow({
    source: "propertyfinder",
    external_id: String(prop.property_id || prop.reference_number),
    source_url: prop.url || "https://www.propertyfinder.ae/",
    transaction_type,
    property_type: String(prop.property_type || "apartment").toLowerCase(),
    beds: prop.bedrooms != null && prop.bedrooms !== "" ? Number(prop.bedrooms) : null,
    baths: prop.bathrooms != null && prop.bathrooms !== "" ? Number(prop.bathrooms) : null,
    emirate: locParts[0] || prop.emirate || "Dubai",
    community: locParts[1] || "",
    sub_community: locParts[2] || "",
    building: locParts[3] || "",
    price_aed: Number(prop.price || 0),
    price_period: transaction_type === "rent" ? prop.price_period || "yearly" : "total",
    furnished:
      prop.furnished === "Yes" || prop.furnished === true
        ? true
        : prop.furnished === "No" || prop.furnished === false
          ? false
          : null,
    amenities: Array.isArray(prop.amenities) ? prop.amenities : [],
    images: [...new Set(images)],
    description: prop.description || prop.title || "",
    agent_name: prop.agent?.name || "",
    agent_phone: prop.agent?.phone || prop.agent?.mobile || "",
    agency_name: prop.agent?.broker?.name || prop.broker?.name || "",
    lat: prop.location?.coordinates?.lat ?? null,
    lng: prop.location?.coordinates?.lon ?? null
  });
}

export function normalizePropertyFinderHtml(prop, emirate, transactionType) {
  const images = (prop.images || []).map((i) => i.medium || i.small || i.url).filter(Boolean);
  const communityParts = String(prop.location?.path_name || "").split(",").map((s) => s.trim()).filter(Boolean);
  return normalizeListingRow({
    source: "propertyfinder",
    external_id: String(prop.id),
    source_url: prop.share_url || prop.details_path || "https://www.propertyfinder.ae/",
    transaction_type: transactionType,
    property_type: String(prop.property_type || "apartment").toLowerCase(),
    beds: prop.bedrooms ?? prop.bedrooms_value ?? null,
    baths: prop.bathrooms ?? prop.bathrooms_value ?? null,
    emirate: communityParts[0] || emirate,
    community: communityParts[2] || communityParts[1] || prop.location?.name || "",
    sub_community: communityParts[3] || "",
    building: prop.location?.type === "TOWER" ? prop.location?.name || "" : "",
    price_aed: Number(prop.price?.value || 0),
    price_period: transactionType === "rent" ? prop.price?.period || "yearly" : "total",
    handover_date: prop.completion_status === "off_plan" ? prop.completion_status : null,
    furnished:
      prop.furnished === "Yes" || prop.furnished === true
        ? true
        : prop.furnished === "No" || prop.furnished === false
          ? false
          : null,
    amenities: prop.amenity_names || prop.amenities || [],
    images: [...new Set(images)],
    description: prop.description || prop.title || "",
    agent_name: prop.agent?.name || "",
    agent_phone: prop.contact_options?.[0]?.value || "",
    agency_name: prop.broker?.name || "",
    rera_permit: prop.rera?.number || "",
    lat: prop.location?.coordinates?.lat ?? null,
    lng: prop.location?.coordinates?.lon ?? null
  });
}

export function normalizePropertyFinderApiProperty(prop, purpose = "for-sale") {
  const nested = prop.property || prop;
  if (nested?.share_url || nested?.location?.path_name) {
    return normalizePropertyFinderHtml(
      nested,
      emirateFromLocationPath(nested.location?.path_name),
      purpose === "for-rent" ? "rent" : "sale"
    );
  }
  const loc = nested.location || {};
  return normalizeListingRow({
    source: "propertyfinder",
    external_id: String(nested.id || nested.externalID),
    source_url: nested.share_url || nested.url || "https://www.propertyfinder.ae/",
    transaction_type: purpose === "for-rent" ? "rent" : "sale",
    property_type: String(nested.property_type || nested.category?.name || "apartment").toLowerCase(),
    beds: nested.bedrooms ?? nested.rooms ?? null,
    baths: nested.bathrooms ?? null,
    emirate: emirateFromLocationPath(loc.path_name || loc.full_name),
    community: loc.name || "",
    price_aed: Number(nested.price?.value || nested.price || 0),
    price_period: purpose === "for-rent" ? nested.price?.period || "yearly" : "total",
    amenities: nested.amenities || nested.amenity_names || [],
    images: collectImages(nested),
    description: nested.description || nested.title || "",
    agent_name: nested.agent?.name || "",
    agent_phone: nested.agent?.phone || "",
    agency_name: nested.broker?.name || nested.agency?.name || ""
  });
}

export function normalizePropertyFinderNewProject(prop) {
  const nested = prop.property || prop;
  return normalizeListingRow({
    source: "propertyfinder",
    external_id: `project-${nested.id || nested.externalID}`,
    source_url: nested.share_url || nested.url || "https://www.propertyfinder.ae/en/new-projects",
    transaction_type: "off_plan",
    property_type: "apartment",
    beds: nested.bedrooms ?? nested.roomsMin ?? null,
    baths: nested.bathrooms ?? null,
    emirate: emirateFromLocationPath(nested.location?.path_name),
    community: nested.location?.name || "",
    price_aed: Number(nested.price?.value || nested.startingPrice || 0),
    price_period: "total",
    handover_date: nested.handoverDate || nested.completionDate || null,
    payment_plan: nested.payment_plan || "",
    developer: nested.developer?.name || "",
    images: collectImages(nested),
    description: nested.description || nested.title || ""
  });
}

export function normalizeDubizzleHtml(hit, emirate, transactionType) {
  const images = [];
  if (hit.photo?.main) images.push(hit.photo.main);
  for (const p of hit.photos || hit.images || []) {
    if (typeof p === "string") images.push(p);
    else if (p?.url) images.push(p.url);
  }
  const id = hit.objectID || hit.id || hit.listing_id;
  return normalizeListingRow({
    source: "dubizzle",
    external_id: String(id),
    source_url: hit.url || hit.absolute_url?.en || hit.link || `https://dubai.dubizzle.com/`,
    transaction_type: transactionType,
    property_type: String(hit.property_type || hit.category?.name || "apartment").toLowerCase(),
    beds: hit.bedrooms ?? hit.beds ?? null,
    baths: hit.bathrooms ?? hit.baths ?? null,
    emirate,
    community: hit.neighborhood?.name?.en || hit.location?.name || "",
    price_aed: Number(hit.price || hit.price_aed || 0),
    price_period: transactionType === "rent" ? hit.rent_frequency || "yearly" : "total",
    furnished: hit.furnished === true ? true : hit.furnished === false ? false : null,
    amenities: hit.amenities || [],
    images: [...new Set(images)],
    description: hit.name?.en || hit.title || hit.description || "",
    agent_name: hit.agent?.name || "",
    agent_phone: hit.agent?.phone || hit.phone || "",
    agency_name: hit.agency?.name || ""
  });
}
