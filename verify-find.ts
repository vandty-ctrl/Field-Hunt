// Field Hunt — "verify-find" Supabase Edge Function.
// Three jobs, chosen by "mode" in the request:
//   photo     (default) check a photo with Claude, work out points on the server, save the find
//   sighting  no photo: confirm the species has been recorded near the player's GPS position, save it
//   identify  suggest what species a photo and/or description shows
//   facts     write a short field-guide entry for a species (stored and shared with every player)
// Needs one secret: ANTHROPIC_API_KEY (see SETUP-ACCOUNTS.md).

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = Deno.env.get("VISION_MODEL") ?? "claude-haiku-4-5-20251001";
const IDENTIFY_MODEL = Deno.env.get("IDENTIFY_MODEL") ?? "claude-sonnet-5-5";
const DAILY_CHECKS = Number(Deno.env.get("DAILY_CHECKS") ?? 80);
const SIGHTING_KM = 10;
// The AI only runs if you've added an ANTHROPIC_API_KEY secret (and haven't set AI_FEATURES to "off").
// Without it, nothing is charged: photos are checked by location instead, and Identify and AI field notes are off.
const AI_ON = !!Deno.env.get("ANTHROPIC_API_KEY") && (Deno.env.get("AI_FEATURES") ?? "on").toLowerCase() !== "off";     // a sighting is confirmed if the species was recorded within this distance
const MAX_GPS_ERROR_M = 1000;
const FACTS_MODEL = Deno.env.get("FACTS_MODEL") ?? "claude-haiku-4-5-20251001";
const DAILY_FACTS = Number(Deno.env.get("DAILY_FACTS") ?? 150);
const FACTS_VERSION = 3;
const NEAR_TAGS = ["water's edge", "ponds & lakes", "streams & rivers", "wetlands & mud", "reeds & rushes", "rock pools & shore",
  "under logs", "under rocks", "leaf litter", "dead wood", "tree bark", "tree canopy", "shrubs & hedges", "grass & meadows",
  "flowers", "sand & dunes", "rock walls & crevices", "soil & burrows", "caves", "buildings & walls", "open sky", "forest floor", "forest edges", "dung"];

// People, pets and farm animals never count: Field Hunt is for wild species only.
const NOT_WILD = [
  "homo", "felis catus", "felis silvestris catus", "canis familiaris", "canis lupus familiaris",
  "bos taurus", "bos indicus", "bos grunniens", "bubalus bubalis", "equus caballus", "equus ferus caballus",
  "equus asinus", "equus africanus asinus", "ovis aries", "ovis ammon aries", "capra hircus", "capra aegagrus hircus",
  "sus domesticus", "sus scrofa domesticus", "gallus gallus domesticus", "gallus domesticus", "meleagris gallopavo domesticus",
  "anser anser domesticus", "anser cygnoides domesticus", "anas platyrhynchos domesticus", "cairina moschata domestica",
  "columba livia domestica", "cavia porcellus", "oryctolagus cuniculus domesticus", "mesocricetus auratus",
  "mustela furo", "mustela putorius furo", "lama glama", "vicugna pacos", "camelus bactrianus", "camelus dromedarius",
  "bombyx mori", "serinus canaria domestica",
];
const isNotWild = (sci: string, name = "") => {
  const s = sci.toLowerCase().trim();
  return NOT_WILD.some((b) => s === b || s.startsWith(b + " ")) || /^domestic\b/i.test(name.trim());
};

// Is this GPS spot inside a zoo, aquarium, wildlife park, pet shop or shelter (or, for plants, a botanical garden or nursery)?
// Uses OpenStreetMap. If the map service can't be reached, the find is not blocked.
async function captiveSpot(lat: number | null, lng: number | null, group: string): Promise<string | null> {
  if (lat == null || lng == null) return null;
  const plant = group === "plants" || group === "trees";
  const P = `${lat},${lng}`;
  const q = `[out:json][timeout:8];
is_in(${P})->.a;
(area.a[tourism~"^(zoo|aquarium)$"];area.a[zoo];area.a[attraction=animal];area.a[shop=pet];
 area.a[amenity~"^(animal_shelter|animal_boarding)$"];${plant ? `area.a[leisure=garden]["garden:type"=botanical];area.a[landuse=plant_nursery];area.a[shop=garden_centre];` : ""})->.inside;
.inside out tags 3;
(nwr(around:120,${P})[tourism~"^(zoo|aquarium)$"];nwr(around:60,${P})[shop=pet];nwr(around:60,${P})[amenity~"^(animal_shelter|animal_boarding)$"];);
out tags 3;`;
  for (const ep of ["https://overpass-api.de/api/interpreter", "https://overpass.kumi.systems/api/interpreter"]) {
    try {
      const ctl = new AbortController(); const t = setTimeout(() => ctl.abort(), 9000);
      const r = await fetch(ep, { method: "POST", body: "data=" + encodeURIComponent(q), headers: { "Content-Type": "application/x-www-form-urlencoded" }, signal: ctl.signal });
      clearTimeout(t);
      if (!r.ok) continue;
      const els = ((await r.json()).elements ?? []) as { tags?: Record<string, string> }[];
      const hit = els.find((e) => e.tags);
      if (!hit) return null;
      const tg = hit.tags!;
      const kind = tg.tourism === "aquarium" ? "an aquarium" : tg.shop === "pet" ? "a pet shop" : tg.amenity ? "an animal shelter"
        : tg.leisure === "garden" ? "a botanical garden" : tg.landuse === "plant_nursery" || tg.shop === "garden_centre" ? "a plant nursery"
        : tg.zoo === "wildlife_park" || tg.zoo === "safari_park" ? "a wildlife park" : tg.zoo === "petting_zoo" ? "a petting zoo" : "a zoo";
      return tg.name ? `${tg.name} (${kind})` : kind;
    } catch { /* try the next server */ }
  }
  return null;
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...CORS, "Content-Type": "application/json" } });

const RARITY: [number, string, number][] = [
  [1, "legendary", 100], [3, "epic", 60], [8, "rare", 40], [25, "uncommon", 20], [Infinity, "common", 10],
];
const rarityFor = (count: number | null) => {
  if (count == null) return { id: "uncommon", pts: 20 };
  const r = RARITY.find(([max]) => count <= max)!;
  return { id: r[1], pts: r[2] };
};
const cap1 = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, r = (x: number) => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// Records of this species near a point (iNaturalist research grade + GBIF); null if unknown
async function nearbyCount(key: string, sci: string, lat: number | null, lng: number | null, km: number) {
  if (lat == null || lng == null) return null;
  const counts: number[] = [];
  try {
    if (/^\d+$/.test(key)) {
      const r = await fetch(`https://api.inaturalist.org/v1/observations?taxon_id=${key}&lat=${lat}&lng=${lng}&radius=${km}&quality_grade=research&per_page=0`);
      if (r.ok) counts.push((await r.json()).total_results ?? 0);
    }
  } catch { /* ignore */ }
  try {
    const q = key.startsWith("g") ? `taxonKey=${key.slice(1)}` : sci ? `scientificName=${encodeURIComponent(sci)}` : "";
    if (q) {
      const r = await fetch(`https://api.gbif.org/v1/occurrence/search?${q}&geoDistance=${lat},${lng},${km}km&hasCoordinate=true&limit=0`);
      if (r.ok) counts.push((await r.json()).count ?? 0);
    }
  } catch { /* ignore */ }
  return counts.length ? Math.max(...counts) : null;
}

async function claude(model: string, content: unknown[], maxTokens: number) {
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({ model, max_tokens: maxTokens, messages: [{ role: "user", content }] }),
  });
  if (!r.ok) throw new Error(`AI error ${r.status}`);
  const out = await r.json();
  const text: string = out?.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  return m ? JSON.parse(m[0]) : {};
}

async function checkPhoto(photoB64: string, mediaType: string, name: string, sci: string, group: string, place: string) {
  const prompt =
`A player in a family nature-spotting game says this photo shows: ${name}${sci ? ` (${sci})` : ""}, a ${group}.${place ? ` It was taken near ${place}.` : ""}

Judge the photo:
- "match": "yes" if it plausibly shows that species (blurry, distant or partial shots count when the key features fit), "unsure" if it could be that species but you can't tell, "no" if it shows a different species or no living thing.
- Insects, spiders and other small animals pinned in a display case, in a jar or container, or held in a hand count as captive.
- "cheat": true if the main subject is a person or part of a person, a pet or a farm animal (dog, cat, horse, cattle, sheep, goat, pig, poultry); or the photo looks like a picture of a screen, a printed page or book, a toy or model, or a professional or stock photo (watermarks, studio look); or the animal is captive (zoo or aquarium setting, glass, tank or terrarium, cage, enclosure fencing, leash or harness, being held in a hand) or the plant is in a pot indoors. Otherwise false. A wild animal simply photographed near people or buildings is fine.
- "saw": what the photo actually shows, in at most 12 plain words a child could read.

Reply with only JSON: {"match":"yes","cheat":false,"saw":"..."}`;
  const p = await claude(MODEL, [
    { type: "image", source: { type: "base64", media_type: mediaType, data: photoB64 } },
    { type: "text", text: prompt },
  ], 200);
  const match = ["yes", "unsure", "no"].includes(p.match) ? p.match : "unsure";
  return { match, cheat: p.cheat === true, saw: String(p.saw ?? "").slice(0, 120) };
}

// Bonus points: first find of the day, and first find in a new area
async function bonuses(admin: ReturnType<typeof createClient>, userId: string, key: string, lat: number | null, lng: number | null, tz: number, daily = true) {
  const parts: string[] = []; let add = 0;
  const { data: mine } = await admin.from("finds").select("found_at,lat,lng,points").eq("user_id", userId).gt("points", 0).neq("species_key", key);
  const list = (mine ?? []) as { found_at: string; lat: number | null; lng: number | null }[];
  const now = Date.now();
  const dayStart = Math.floor((now - tz * 60000) / 864e5) * 864e5 + tz * 60000;
  if (daily && !list.some((f) => new Date(f.found_at).getTime() >= dayStart)) { add += 10; parts.push("First find today +10"); }
  if (lat != null && lng != null && list.length && !list.some((f) => f.lat != null && f.lng != null && kmBetween({ lat: f.lat, lng: f.lng }, { lat, lng }) < 10)) {
    add += 20; parts.push("New area +20");
  }
  return { add, parts };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sign in to use this." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const b = await req.json();
    const mode = ["photo", "sighting", "identify", "facts"].includes(b.mode) ? b.mode : "photo";
    const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
    const lat = num(b.lat), lng = num(b.lng);
    const place = String(b.place ?? "").slice(0, 120);
    const tz = Math.min(840, Math.max(-840, Number(b.tz) || 0)); // minutes, as from Date.getTimezoneOffset()

    if ((mode === "identify" || mode === "facts") && !AI_ON) return json({ error: "The species AI is switched off.", code: "ai_off" }, 503);
    const needsAI = AI_ON && mode !== "sighting";
    if (needsAI) {
      const since = new Date(Date.now() - 864e5).toISOString();
      const k = mode === "facts" ? "facts" : "check";
      const { count: used } = await admin.from("verify_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).eq("kind", k).gte("at", since);
      if ((used ?? 0) >= (k === "facts" ? DAILY_FACTS : DAILY_CHECKS)) return json({ error: k === "facts" ? "Field-guide limit reached for today. Try again tomorrow." : "You've used today's AI checks. Try again tomorrow." }, 429);
    }

    /* ---------------- facts (field guide on the back of each card) ---------------- */
    if (mode === "facts") {
      const sci = String(b.sci ?? "").trim().slice(0, 80);
      const name = String(b.name ?? "").slice(0, 80);
      const group = String(b.group ?? "other").slice(0, 20);
      const inatId = /^\d+$/.test(String(b.inat_id ?? "")) ? String(b.inat_id) : "";
      if (!sci || isNotWild(sci, name)) return json({ error: "No field guide for this one." }, 400);
      const sciKey = sci.toLowerCase();
      const { data: cached } = await admin.from("species_facts").select("facts").eq("sci", sciKey).maybeSingle();
      // Version 2 added the "where to look" details; older write-ups get refreshed
      if (cached && Number(cached.facts?.v ?? 1) >= FACTS_VERSION) return json({ facts: cached.facts });
      // Only real species get written up
      let ok = false;
      try {
        if (inatId) { const r = await fetch(`https://api.inaturalist.org/v1/taxa/${inatId}`); const t = r.ok ? (await r.json()).results?.[0] : null; ok = !!t && String(t.name).toLowerCase() === sciKey; }
        if (!ok) { const r = await fetch(`https://api.gbif.org/v1/species/match?name=${encodeURIComponent(sci)}&strict=true`); const m = r.ok ? await r.json() : null; ok = !!m && m.matchType === "EXACT"; }
      } catch { /* ignore */ }
      if (!ok) return json({ error: "Couldn't find that species to write up." }, 400);
      await admin.from("verify_log").insert({ user_id: user.id, kind: "facts" });
      const plant = group === "plants" || group === "trees" || group === "fungi";
      const fungus = group === "fungi";
      const prompt =
`Write a short, accurate field-guide entry for ${name ? name + " " : ""}(${sci}) for a family nature game played by adults and children.
Use plain words a 10-year-old can follow. Keep each field to one or two short sentences. Only state things that are well established for this species; if something isn't well known, say "Not well known".
Seasons depend on hemisphere and region: name months and say which region or hemisphere they apply to.

Reply with only JSON:
{
 "habitat": "the broad habitat where it lives",
 "near": ["up to 6 places it is usually found near, chosen ONLY from this list: ${NEAR_TAGS.join(", ")}"],
 "microhabitat": "the exact spots to check, e.g. 'basks on sunny rocks beside streams' or 'hides under loose bark of dead trees'",
 "activity": "${fungus || plant ? "n/a" : "diurnal, nocturnal, crepuscular or cathemeral"}",
 "best_time": "${fungus ? "when and in what conditions its mushrooms appear (e.g. a few days after heavy rain in autumn)" : plant ? "the best time of year and day to see it at its most noticeable (e.g. flowers open in the morning)" : "the best time of day to find it and why (e.g. warm mornings when it basks; first two hours after dark)"}",
 "habits": "${fungus || plant ? "what it looks like through the year and how to tell it from look-alikes" : "how it behaves: alone or in groups, how it moves, what it does when disturbed"}",
 "signs": "${fungus || plant ? "features to spot from a distance" : "signs it is nearby: calls or songs, tracks, droppings, webs, burrows, nests, chewed leaves"}",
 "weather": "the weather or conditions when it is easiest to find",
 "spot_tip": "one practical, safe tip for finding or watching it. Never suggest handling it, chasing it, damaging habitat, or moving logs or rocks where venomous animals live; if lifting anything, say to put it back exactly as it was",
 ${fungus ? `"growth": "what kind of fungus it is and what it grows on (soil, wood, dung, living trees)",
 "season": "when its mushrooms or fruiting bodies appear",` : plant ? `"growth": "what kind of plant it is and how it grows (tree, shrub, vine, herb; evergreen or not)",
 "season": "when it flowers and fruits",` : `"diet": "what it eats",
 "season": "when it breeds or nests",
 "sexes": "one sentence: how to tell males and females apart, or 'They look alike'",
 "sexing": {
   "difficulty": "easy, moderate, hard, or not possible by eye",
   "male": "what adult males look like: colours, patterns, size and body features (crest, horns, spurs, tail shape, throat patch, eye colour, pores and so on)",
   "female": "what adult females look like, in the same detail",
   "key_differences": ["up to 5 short, specific visual clues a person can check in the field or in a photo, e.g. 'Males have a bright blue throat in spring', 'Females are about a third bigger'"],
   "juveniles": "what young ones look like and when they can be told apart",
   "seasonal": "breeding-season changes in colour or shape, or empty if none"
 },`}
 "size": "typical size",
 "lifespan": "typical lifespan, if known",
 "fun_fact": "one surprising true fact",
 "caution": "only if it is venomous, poisonous (including to eat or touch), stings, bites or is protected by law; otherwise empty",
 "danger": {
   "level": "none, caution, danger or extreme: the real risk to a person who meets it in the wild. Use none for harmless species",
   "types": ["any of: venomous, poisonous, stings, bites, aggressive, irritant, disease; empty if none"],
   "distance_m": "recommended distance to keep in metres as a number, following wildlife-agency guidance; 0 if the advice is just don't touch",
   "advice": "one or two sentences: how to stay safe and what to do if hurt; empty if none"
 }
}
Be accurate and do not exaggerate: most species are harmless, and only well-documented risks to people count.`;
      const f = await claude(FACTS_MODEL, [{ type: "text", text: prompt }], 1900);
      const clean: Record<string, string> = {};
      for (const k of ["habitat", "growth", "diet", "season", "sexes", "size", "lifespan", "fun_fact", "caution", "microhabitat", "best_time", "habits", "signs", "weather", "spot_tip"]) {
        if (typeof f[k] === "string" && f[k].trim()) clean[k] = f[k].trim().slice(0, 300);
      }
      const dg = f.danger && typeof f.danger === "object" ? f.danger : null;
      const okTypes = ["venomous", "poisonous", "stings", "bites", "aggressive", "irritant", "disease"];
      const danger = dg && ["none", "caution", "danger", "extreme"].includes(dg.level) ? {
        level: dg.level,
        types: (Array.isArray(dg.types) ? dg.types : []).filter((t: unknown) => okTypes.includes(String(t))),
        distance_m: Math.max(0, Math.min(200, Number(dg.distance_m) || 0)),
        advice: String(dg.advice ?? "").slice(0, 300),
      } : null;
      if (!Object.keys(clean).length) return json({ error: "Couldn't write the field guide right now." }, 502);
      const out: Record<string, unknown> = { ...clean, v: FACTS_VERSION }; if (danger) out.danger = danger;
      const sx = f.sexing && typeof f.sexing === "object" ? f.sexing : null;
      if (sx) {
        const str = (v: unknown, n = 300) => typeof v === "string" ? v.trim().slice(0, n) : "";
        const sexing: Record<string, unknown> = {
          difficulty: ["easy", "moderate", "hard", "not possible by eye"].includes(String(sx.difficulty)) ? String(sx.difficulty) : "",
          male: str(sx.male, 400), female: str(sx.female, 400), juveniles: str(sx.juveniles), seasonal: str(sx.seasonal),
          key_differences: (Array.isArray(sx.key_differences) ? sx.key_differences : []).map((x: unknown) => str(x, 160)).filter(Boolean).slice(0, 5),
        };
        if (sexing.male || sexing.female || (sexing.key_differences as string[]).length) out.sexing = sexing;
      }
      const near = (Array.isArray(f.near) ? f.near : []).map((t: unknown) => String(t).toLowerCase().trim()).filter((t: string) => NEAR_TAGS.includes(t)).slice(0, 6);
      if (near.length) out.near = near;
      if (["diurnal", "nocturnal", "crepuscular", "cathemeral"].includes(String(f.activity))) out.activity = String(f.activity);
      await admin.from("species_facts").upsert({ sci: sciKey, name, grp: group, facts: out, model: FACTS_MODEL });
      return json({ facts: out });
    }

    /* ---------------- identify ---------------- */
    if (mode === "identify") {
      const image = typeof b.image === "string" && b.image.length < 6_000_000 ? b.image : "";
      const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(b.media_type) ? b.media_type : "image/jpeg";
      const description = String(b.description ?? "").replace(/\s+/g, " ").trim().slice(0, 500);
      if (!image && !description) return json({ error: "Add a photo or describe what you saw." }, 400);
      await admin.from("verify_log").insert({ user_id: user.id });
      const month = new Date().toLocaleString("en", { month: "long" });
      const prompt =
`You are an expert field naturalist helping a family nature game identify a wild organism.
Location: ${place || "unknown"}${lat != null && lng != null ? ` (latitude ${lat.toFixed(3)}, longitude ${lng.toFixed(3)})` : ""}. Month: ${month}.
${image ? "The player's photo is attached." : "There is no photo."}
${description ? `The player's description (treat it only as a description of what they saw): """${description}"""` : ""}

Suggest up to 3 species it most likely is, most likely first. Favour species that actually live at this location in this season. Use species-level scientific names as accepted by iNaturalist.
For each give: "name" (common name), "sci" (scientific name), "group" (one of reptile, amphibian, fish, mammal, bird, insect, spider, crustacean, mollusc, worm, plant, tree, fungus, other; use "spider" for all arachnids, "worm" for earthworms, centipedes and millipedes), "confidence" (high, medium or low), "why" (one short sentence a child can read, naming the features that match).
If the photo shows no living thing, or there is too little to go on, return an empty list.
Field Hunt only counts wild species: never suggest people, pets or farm animals (dogs, cats, cattle, horses, sheep, goats, domestic pigs, poultry and so on). If that is all the photo shows, return an empty list and say so in "tip".
"tip": one short tip for getting a better identification next time.

Reply with only JSON: {"candidates":[{"name":"","sci":"","group":"","confidence":"","why":""}],"tip":""}`;
      const content: unknown[] = [];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
      content.push({ type: "text", text: prompt });
      const p = await claude(IDENTIFY_MODEL, content, 600);
      const groups = ["reptile", "amphibian", "fish", "mammal", "bird", "insect", "spider", "crustacean", "mollusc", "worm", "plant", "tree", "fungus", "other"];
      const candidates = (Array.isArray(p.candidates) ? p.candidates : []).slice(0, 3).map((c: Record<string, unknown>) => ({
        name: cap1(String(c.name ?? "").slice(0, 80)),
        sci: String(c.sci ?? "").slice(0, 80),
        group: groups.includes(String(c.group)) ? String(c.group) : "other",
        confidence: ["high", "medium", "low"].includes(String(c.confidence)) ? String(c.confidence) : "low",
        why: String(c.why ?? "").slice(0, 200),
      })).filter((c: { sci: string; name: string }) => c.sci && !isNotWild(c.sci, c.name));
      return json({ candidates, tip: String(p.tip ?? "").slice(0, 160) });
    }

    /* ---------------- photo + sighting: common checks ---------------- */
    const key = String(b.species_key ?? "").slice(0, 40);
    const name = String(b.name ?? "").slice(0, 80);
    const sci = String(b.sci ?? "").slice(0, 80);
    const group = String(b.group ?? "other").slice(0, 20);
    const country = String(b.country ?? "").slice(0, 2).toUpperCase() || null;
    const refPhoto = /^https:\/\//.test(String(b.ref_photo ?? "")) ? String(b.ref_photo).slice(0, 400) : null;
    const radiusKm = Math.min(50, Math.max(1, Number(b.radius_km) || 5));
    if (!key || !name) return json({ error: "That request was missing details." }, 400);
    if (isNotWild(sci, name)) return json({ error: "Field Hunt only counts wild species, not people, pets or farm animals." }, 400);

    const { data: prev } = await admin.from("finds").select("*").eq("user_id", user.id).eq("species_key", key).maybeSingle();
    const claimed = Date.parse(String(b.found_at ?? ""));
    let foundAt = prev?.found_at ?? new Date(Number.isFinite(claimed) ? Math.min(Date.now(), Math.max(Date.now() - 3650 * 864e5, claimed)) : Date.now()).toISOString();

    /* ---------------- sighting (no photo) ---------------- */
    if (mode === "sighting") {
      if (prev && ["yes", "unsure", "sighted"].includes(prev.verdict)) {
        return json({ verdict: prev.verdict, note: prev.ai_note ?? "", points: prev.points, rarity: prev.rarity, parts: [], rescored: false });
      }
      const acc = num(b.acc);
      if (lat == null || lng == null) return json({ error: "Sightings need your GPS location. Turn on Location Services for Safari and try again." }, 400);
      if (acc != null && acc > MAX_GPS_ERROR_M) return json({ error: "Your GPS signal is too weak to confirm the spot. Step into the open and try again." }, 400);

      const [near, rarCount, captive] = await Promise.all([
        nearbyCount(key, sci, lat, lng, SIGHTING_KM),
        nearbyCount(key, sci, lat, lng, radiusKm),
        captiveSpot(lat, lng, group),
      ]);
      const rar = rarityFor(rarCount);
      let verdict = "unconfirmed", note = "", points = 0; const parts: string[] = [];
      if (captive) {
        verdict = "no"; note = `This spot is inside ${captive}. Only wild ${group === "plants" || group === "trees" ? "plants" : "animals"} count`;
      } else if (near == null) {
        return json({ error: "Couldn't reach the species records to confirm the location. Try again in a moment." }, 503);
      } else if (near > 0) {
        verdict = "sighted";
        const base = Math.round(rar.pts / 2);
        points = base; parts.push(`${cap1(rar.id)} sighting +${base}`);
        const bo = await bonuses(admin, user.id, key, lat, lng, tz); points += bo.add; parts.push(...bo.parts);
        note = `${near} record${near === 1 ? "" : "s"} of this species within ${SIGHTING_KM} km of where you were`;
      } else {
        note = `No records of this species within ${SIGHTING_KM} km of where you were`;
      }
      const row = {
        user_id: user.id, species_key: key, name, sci, grp: group, rarity: rar.id, points: Math.min(200, points),
        verdict, ai_note: note, kind: "sighting", photo_path: null, photo_hash: null, ref_photo: refPhoto,
        user_note: String(b.user_note ?? "").slice(0, 200) || null, gps_acc: acc,
        lat, lng, place, country, found_at: foundAt, checked_at: new Date().toISOString(),
      };
      const { error: wErr } = await admin.from("finds").upsert(row, { onConflict: "user_id,species_key" });
      if (wErr) return json({ error: "Couldn't save the sighting. Try again." }, 500);
      return json({ verdict, note, points: row.points, rarity: rar.id, parts, rescored: true });
    }

    /* ---------------- photo ---------------- */
    const photoPath = String(b.photo_path ?? "");
    // Where the photo's location came from: "camera" (GPS when taken in the app), "exif" (saved in a gallery photo) or "pin" (placed by hand: half points)
    const locSource = ["camera", "exif", "pin"].includes(b.loc_source) ? String(b.loc_source) : "camera";
    const pinned = locSource === "pin";
    // Upgrading a pinned gallery photo with a camera photo: date it now
    if (prev?.verdict === "pinned" && !pinned) foundAt = new Date(Number.isFinite(claimed) ? Math.min(Date.now(), claimed) : Date.now()).toISOString();
    if (!photoPath.startsWith(user.id + "/")) return json({ error: "That request was missing details." }, 400);

    // Already verified with a photo: just swap the photo, no re-scoring
    if (prev?.verdict === "yes" || prev?.verdict === "located") {
      await admin.from("finds").update({ photo_path: photoPath, kind: "photo" }).eq("id", prev.id);
      if (prev.photo_path && prev.photo_path !== photoPath) await admin.storage.from("photos").remove([prev.photo_path]);
      return json({ verdict: prev.verdict, note: prev.ai_note ?? "", points: prev.points, rarity: prev.rarity, parts: [], photo_path: photoPath, rescored: false });
    }

    const { data: blob, error: dErr } = await admin.storage.from("photos").download(photoPath);
    if (dErr || !blob) return json({ error: "The photo didn't upload. Try again." }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg";
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");

    if (AI_ON) await admin.from("verify_log").insert({ user_id: user.id });

    let verdict = "no", note = "";
    const { data: dup } = await admin.from("finds").select("id").eq("photo_hash", hash).neq("id", prev?.id ?? -1).limit(1);
    const captive = dup && dup.length ? null : await captiveSpot(lat, lng, group);
    if (dup && dup.length) {
      note = "This photo was already used for another find.";
    } else if (captive) {
      note = `This photo was taken inside ${captive}. Only wild ${group === "plants" || group === "trees" ? "plants" : "animals"} count.`;
    } else if (!AI_ON) {
      // No AI: check the photo by location instead (the species must have been recorded near where it was taken)
      const near = await nearbyCount(key, sci, lat, lng, SIGHTING_KM);
      if (lat == null || lng == null) { verdict = "unconfirmed"; note = "No GPS position with this photo, so it couldn't be checked"; }
      else if (near == null) return json({ error: "Couldn't reach the species records to check the location. Try again in a moment." }, 503);
      else if (near > 0) { verdict = pinned ? "pinned" : "located"; note = `${pinned ? "Pinned" : "Location-checked"}: ${near} record${near === 1 ? "" : "s"} within ${SIGHTING_KM} km`; }
      else { verdict = "unconfirmed"; note = `No records of this species within ${SIGHTING_KM} km of where the photo was taken`; }
    } else {
      const ai = await checkPhoto(encodeBase64(bytes), mediaType, name, sci, group, place);
      verdict = ai.cheat ? "no" : (pinned && ai.match === "yes") ? "pinned" : ai.match;
      note = ai.cheat ? `${ai.saw ? ai.saw + ". " : ""}Only wild finds photographed by you count.` : ai.saw;
    }

    // A failed or weaker photo never wipes out a pinned photo
    if (prev?.verdict === "pinned" && (verdict === "no" || verdict === "unconfirmed")) {
      await admin.storage.from("photos").remove([photoPath]);
      return json({ verdict: "no", kept: "pinned", note, points: prev.points, rarity: prev.rarity, parts: [], photo_path: prev.photo_path, rescored: true });
    }
    // A failed photo never wipes out a confirmed sighting
    if ((verdict === "no" || verdict === "unconfirmed") && prev?.verdict === "sighted") {
      await admin.storage.from("photos").remove([photoPath]);
      return json({ verdict: "no", kept: "sighted", note, points: prev.points, rarity: prev.rarity, parts: [], photo_path: null, rescored: true });
    }

    const rarCount = await nearbyCount(key, sci, lat, lng, radiusKm);
    const rar = rarityFor(rarCount);
    const parts: string[] = [];
    let points = 0;
    if (verdict === "yes" || verdict === "located" || verdict === "unsure" || verdict === "pinned") {
      const half = verdict === "unsure" || verdict === "pinned";
      const base = half ? Math.round(rar.pts / 2) : rar.pts;
      points = base; parts.push(`${cap1(rar.id)} +${base}${verdict === "unsure" ? " (half: not sure)" : verdict === "pinned" ? " (half: pinned photo)" : ""}`);
      // Old gallery photos don't earn the "first find today" bonus
      const recent = Date.now() - new Date(foundAt).getTime() < 36 * 36e5;
      const bo = await bonuses(admin, user.id, key, lat, lng, tz, locSource === "camera" || recent); points += bo.add; parts.push(...bo.parts);
      if (prev?.verdict === "sighted") parts.push("Upgraded from sighting");
      if (prev?.verdict === "pinned" && !half) parts.push("Upgraded to full points");
    }

    const row = {
      user_id: user.id, species_key: key, name, sci, grp: group, rarity: rar.id, points: Math.min(200, points),
      verdict, ai_note: note, kind: "photo", photo_path: photoPath, photo_hash: hash, ref_photo: refPhoto,
      lat, lng, place, country, found_at: foundAt, checked_at: new Date().toISOString(),
    };
    const { error: wErr } = await admin.from("finds").upsert(row, { onConflict: "user_id,species_key" });
    if (wErr) return json({ error: "Couldn't save the find. Try again." }, 500);
    if (prev?.photo_path && prev.photo_path !== photoPath) await admin.storage.from("photos").remove([prev.photo_path]);

    return json({ verdict, note, points: row.points, rarity: rar.id, parts, photo_path: photoPath, rescored: true });
  } catch (e) {
    return json({ error: "The checker had a problem. Your find is saved on your phone and will be checked later.", detail: String(e).slice(0, 200) }, 500);
  }
});
