// Field Hunt — "verify-find" Supabase Edge Function.
// Three jobs, chosen by "mode" in the request:
//   photo     (default) check a photo with Claude, work out points on the server, save the find
//   sighting  no photo: confirm the species has been recorded near the player's GPS position, save it
//   identify  suggest what species a photo and/or description shows
// Needs one secret: ANTHROPIC_API_KEY (see SETUP-ACCOUNTS.md).

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = Deno.env.get("VISION_MODEL") ?? "claude-haiku-4-5-20251001";
const IDENTIFY_MODEL = Deno.env.get("IDENTIFY_MODEL") ?? "claude-sonnet-5-5";
const DAILY_CHECKS = Number(Deno.env.get("DAILY_CHECKS") ?? 80);
const SIGHTING_KM = 10;     // a sighting is confirmed if the species was recorded within this distance
const MAX_GPS_ERROR_M = 1000;

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
- "cheat": true if the photo looks like a picture of a screen, a printed page or book, a toy or model, a professional or stock photo (watermarks, studio look), or shows a captive or pet animal (zoo, aquarium, tank or terrarium, cage) or a plant in a pot indoors. Otherwise false.
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
async function bonuses(admin: ReturnType<typeof createClient>, userId: string, key: string, lat: number | null, lng: number | null, tz: number) {
  const parts: string[] = []; let add = 0;
  const { data: mine } = await admin.from("finds").select("found_at,lat,lng,points").eq("user_id", userId).gt("points", 0).neq("species_key", key);
  const list = (mine ?? []) as { found_at: string; lat: number | null; lng: number | null }[];
  const now = Date.now();
  const dayStart = Math.floor((now - tz * 60000) / 864e5) * 864e5 + tz * 60000;
  if (!list.some((f) => new Date(f.found_at).getTime() >= dayStart)) { add += 10; parts.push("First find today +10"); }
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
    const mode = ["photo", "sighting", "identify"].includes(b.mode) ? b.mode : "photo";
    const num = (v: unknown) => (v === null || v === undefined || v === "" || !Number.isFinite(Number(v))) ? null : Number(v);
    const lat = num(b.lat), lng = num(b.lng);
    const place = String(b.place ?? "").slice(0, 120);
    const tz = Math.min(840, Math.max(-840, Number(b.tz) || 0)); // minutes, as from Date.getTimezoneOffset()

    const needsAI = mode !== "sighting";
    if (needsAI && !Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "The species AI isn't set up yet (missing ANTHROPIC_API_KEY)." }, 503);
    if (needsAI) {
      const since = new Date(Date.now() - 864e5).toISOString();
      const { count: used } = await admin.from("verify_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("at", since);
      if ((used ?? 0) >= DAILY_CHECKS) return json({ error: "You've used today's AI checks. Try again tomorrow." }, 429);
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
For each give: "name" (common name), "sci" (scientific name), "group" (one of reptile, amphibian, fish, mammal, bird, plant, tree, insect, other), "confidence" (high, medium or low), "why" (one short sentence a child can read, naming the features that match).
If the photo shows no living thing, or there is too little to go on, return an empty list.
"tip": one short tip for getting a better identification next time.

Reply with only JSON: {"candidates":[{"name":"","sci":"","group":"","confidence":"","why":""}],"tip":""}`;
      const content: unknown[] = [];
      if (image) content.push({ type: "image", source: { type: "base64", media_type: mediaType, data: image } });
      content.push({ type: "text", text: prompt });
      const p = await claude(IDENTIFY_MODEL, content, 600);
      const groups = ["reptile", "amphibian", "fish", "mammal", "bird", "plant", "tree", "insect", "other"];
      const candidates = (Array.isArray(p.candidates) ? p.candidates : []).slice(0, 3).map((c: Record<string, unknown>) => ({
        name: cap1(String(c.name ?? "").slice(0, 80)),
        sci: String(c.sci ?? "").slice(0, 80),
        group: groups.includes(String(c.group)) ? String(c.group) : "other",
        confidence: ["high", "medium", "low"].includes(String(c.confidence)) ? String(c.confidence) : "low",
        why: String(c.why ?? "").slice(0, 200),
      })).filter((c: { sci: string }) => c.sci);
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

    const { data: prev } = await admin.from("finds").select("*").eq("user_id", user.id).eq("species_key", key).maybeSingle();
    const claimed = Date.parse(String(b.found_at ?? ""));
    const foundAt = prev?.found_at ?? new Date(Number.isFinite(claimed) ? Math.min(Date.now(), Math.max(Date.now() - 365 * 864e5, claimed)) : Date.now()).toISOString();

    /* ---------------- sighting (no photo) ---------------- */
    if (mode === "sighting") {
      if (prev && ["yes", "unsure", "sighted"].includes(prev.verdict)) {
        return json({ verdict: prev.verdict, note: prev.ai_note ?? "", points: prev.points, rarity: prev.rarity, parts: [], rescored: false });
      }
      const acc = num(b.acc);
      if (lat == null || lng == null) return json({ error: "Sightings need your GPS location. Turn on Location Services for Safari and try again." }, 400);
      if (acc != null && acc > MAX_GPS_ERROR_M) return json({ error: "Your GPS signal is too weak to confirm the spot. Step into the open and try again." }, 400);

      const [near, rarCount] = await Promise.all([
        nearbyCount(key, sci, lat, lng, SIGHTING_KM),
        nearbyCount(key, sci, lat, lng, radiusKm),
      ]);
      const rar = rarityFor(rarCount);
      let verdict = "unconfirmed", note = "", points = 0; const parts: string[] = [];
      if (near == null) {
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
    if (!photoPath.startsWith(user.id + "/")) return json({ error: "That request was missing details." }, 400);

    // Already verified with a photo: just swap the photo, no re-scoring
    if (prev?.verdict === "yes") {
      await admin.from("finds").update({ photo_path: photoPath, kind: "photo" }).eq("id", prev.id);
      if (prev.photo_path && prev.photo_path !== photoPath) await admin.storage.from("photos").remove([prev.photo_path]);
      return json({ verdict: "yes", note: prev.ai_note ?? "", points: prev.points, rarity: prev.rarity, parts: [], photo_path: photoPath, rescored: false });
    }

    const { data: blob, error: dErr } = await admin.storage.from("photos").download(photoPath);
    if (dErr || !blob) return json({ error: "The photo didn't upload. Try again." }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg";
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");

    await admin.from("verify_log").insert({ user_id: user.id });

    let verdict = "no", note = "";
    const { data: dup } = await admin.from("finds").select("id").eq("photo_hash", hash).neq("id", prev?.id ?? -1).limit(1);
    if (dup && dup.length) {
      note = "This photo was already used for another find.";
    } else {
      const ai = await checkPhoto(encodeBase64(bytes), mediaType, name, sci, group, place);
      verdict = ai.cheat ? "no" : ai.match;
      note = ai.cheat ? `${ai.saw ? ai.saw + ". " : ""}Only wild finds photographed by you count.` : ai.saw;
    }

    // A failed photo never wipes out a confirmed sighting
    if (verdict === "no" && prev?.verdict === "sighted") {
      await admin.storage.from("photos").remove([photoPath]);
      return json({ verdict: "no", kept: "sighted", note, points: prev.points, rarity: prev.rarity, parts: [], photo_path: null, rescored: true });
    }

    const rarCount = await nearbyCount(key, sci, lat, lng, radiusKm);
    const rar = rarityFor(rarCount);
    const parts: string[] = [];
    let points = 0;
    if (verdict !== "no") {
      const base = verdict === "yes" ? rar.pts : Math.round(rar.pts / 2);
      points = base; parts.push(`${cap1(rar.id)} +${base}${verdict === "unsure" ? " (half: not sure)" : ""}`);
      const bo = await bonuses(admin, user.id, key, lat, lng, tz); points += bo.add; parts.push(...bo.parts);
      if (prev?.verdict === "sighted") parts.push("Upgraded from sighting");
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
