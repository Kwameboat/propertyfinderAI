# Developer & Government Intel Agent

Live RAG over **curated developer and government URLs** — answers questions about off-plan projects, payment plans, handover, DLD/RERA updates, and regulations.

## How it works

```
User: "What off-plan projects does Emaar have?"
  → Match "Emaar" in URL registry
  → Jina Reader fetches properties.emaar.com pages
  → Gemini extracts projects + payment plans
  → Supabase developer_intel cache (6h TTL)
  → Chat answer + optional project cards
```

## URL registry

Edit `packages/real-estate/data/developer-sources.mjs` to add more developers or government sites.

**Pre-loaded:** Emaar, Damac, Nakheel, Sobha, Aldar, Azizi, Binghatti, Meraas, Danube, Ellington, Omniyat, Dubai Properties + DLD, Dubai REST/RERA, ADREC, DMT.

## Supabase migration

Run `supabase/migrations/003_developer_intel.sql` in Supabase SQL Editor.

## Deploy

```bash
node deploy/deploy-developer-intel.cjs
```

## Example questions

- "Tell me about Emaar Creek Harbour payment plan"
- "Latest Damac off-plan launches in Dubai"
- "What's the latest DLD regulation on broker commission?"
