import { loadHubEnv } from "../packages/real-estate/env.mjs";
import { scrapeBayutApify } from "../packages/real-estate/apify-scrape.mjs";
import { scrapeBayutApi, isBayutApiConfigured } from "../packages/real-estate/scrapers/rapidapi-bayut.mjs";

loadHubEnv();

const rows = [];
const stub = {};
const upsert = (_d, r) => {
  rows.push(r);
  return r;
};

console.log("rapid configured", isBayutApiConfigured());
if (isBayutApiConfigured()) {
  const api = await scrapeBayutApi(stub, upsert, { emirates: ["Dubai"], maxPages: 1 });
  console.log("rapidapi", JSON.stringify(api));
}

const apify = await scrapeBayutApify(stub, upsert, { emirates: ["Dubai"], maxPages: 1, maxResults: 10 });
console.log("apify", JSON.stringify(apify));
console.log("rows collected", rows.length);
