// Field Hunt — "verify-find" Supabase Edge Function.
// Checks a player's photo with Claude, works out the points on the server, and saves the find.
// Needs one secret: ANTHROPIC_API_KEY (see SETUP-ACCOUNTS.md).

import { createClient } from "npm:@supabase/supabase-js@2";
import { encodeBase64 } from "jsr:@std/encoding@1/base64";

const MODEL = Deno.env.get("VISION_MODEL") ?? "claude-haiku-4-5-20251001";
const DAILY_CHECKS = Number(Deno.env.get("DAILY_CHECKS") ?? 80);

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

function kmBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const R = 6371, r = (x: number) => x * Math.PI / 180;
  const dLat = r(b.lat - a.lat), dLng = r(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

// How many records of this species exist near the find (iNaturalist + GBIF), to set rarity server-side.
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

async function askClaude(photoB64: string, mediaType: string, name: string, sci: string, group: string, place: string) {
  const prompt =
`A player in a family nature-spotting game says this photo shows: ${name}${sci ? ` (${sci})` : ""}, a ${group}.${place ? ` It was taken near ${place}.` : ""}

Judge the photo:
- "match": "yes" if it plausibly shows that species (blurry, distant or partial shots count when the key features fit), "unsure" if it could be that species but you can't tell, "no" if it shows a different species or no living thing.
- "cheat": true if the photo looks like a picture of a screen, a printed page or book, a toy or model, a professional or stock photo (watermarks, studio look), or shows a captive or pet animal (zoo, aquarium, tank or terrarium, cage) or a plant in a pot indoors. Otherwise false.
- "saw": what the photo actually shows, in at most 12 plain words a child could read.

Reply with only JSON: {"match":"yes","cheat":false,"saw":"..."}`;
  const r = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": Deno.env.get("ANTHROPIC_API_KEY") ?? "",
      "anthropic-version": "2023-06-01",
      "content-type": "application/json",
    },
    body: JSON.stringify({
      model: MODEL,
      max_tokens: 200,
      messages: [{ role: "user", content: [
        { type: "image", source: { type: "base64", media_type: mediaType, data: photoB64 } },
        { type: "text", text: prompt },
      ] }],
    }),
  });
  if (!r.ok) throw new Error(`Photo checker error ${r.status}`);
  const out = await r.json();
  const text: string = out?.content?.find((c: { type: string }) => c.type === "text")?.text ?? "";
  const m = text.match(/\{[\s\S]*\}/);
  const parsed = m ? JSON.parse(m[0]) : {};
  const match = ["yes", "unsure", "no"].includes(parsed.match) ? parsed.match : "unsure";
  return { match, cheat: parsed.cheat === true, saw: String(parsed.saw ?? "").slice(0, 120) };
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: CORS });
  if (req.method !== "POST") return json({ error: "Use POST." }, 405);
  try {
    const url = Deno.env.get("SUPABASE_URL")!;
    const anon = Deno.env.get("SUPABASE_ANON_KEY")!;
    const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    if (!Deno.env.get("ANTHROPIC_API_KEY")) return json({ error: "The photo checker isn't set up yet (missing ANTHROPIC_API_KEY)." }, 503);

    const userClient = createClient(url, anon, { global: { headers: { Authorization: req.headers.get("Authorization") ?? "" } } });
    const { data: { user } } = await userClient.auth.getUser();
    if (!user) return json({ error: "Sign in to get photos checked." }, 401);
    const admin = createClient(url, service, { auth: { persistSession: false } });

    const b = await req.json();
    const key = String(b.species_key ?? "").slice(0, 40);
    const name = String(b.name ?? "").slice(0, 80);
    const sci = String(b.sci ?? "").slice(0, 80);
    const group = String(b.group ?? "other").slice(0, 20);
    const photoPath = String(b.photo_path ?? "");
    const place = String(b.place ?? "").slice(0, 120);
    const country = String(b.country ?? "").slice(0, 2).toUpperCase() || null;
    const lat = Number.isFinite(Number(b.lat)) && b.lat !== null ? Number(b.lat) : null;
    const lng = Number.isFinite(Number(b.lng)) && b.lng !== null ? Number(b.lng) : null;
    const radiusKm = Math.min(50, Math.max(1, Number(b.radius_km) || 5));
    const tz = Math.min(840, Math.max(-840, Number(b.tz) || 0)); // minutes, as from Date.getTimezoneOffset()
    if (!key || !name || !photoPath.startsWith(user.id + "/")) return json({ error: "That request was missing details." }, 400);

    // Daily limit on checks
    const since = new Date(Date.now() - 864e5).toISOString();
    const { count: used } = await admin.from("verify_log").select("id", { count: "exact", head: true }).eq("user_id", user.id).gte("at", since);
    if ((used ?? 0) >= DAILY_CHECKS) return json({ error: "You've reached today's photo checks. Your photo is saved and will be checked tomorrow." }, 429);

    const { data: prev } = await admin.from("finds").select("*").eq("user_id", user.id).eq("species_key", key).maybeSingle();

    // Already verified: just swap the photo, no re-scoring
    if (prev?.verdict === "yes") {
      await admin.from("finds").update({ photo_path: photoPath }).eq("id", prev.id);
      if (prev.photo_path && prev.photo_path !== photoPath) await admin.storage.from("photos").remove([prev.photo_path]);
      return json({ verdict: "yes", note: prev.ai_note ?? "", points: prev.points, rarity: prev.rarity, parts: [], photo_path: photoPath, rescored: false });
    }

    // Load the photo
    const { data: blob, error: dErr } = await admin.storage.from("photos").download(photoPath);
    if (dErr || !blob) return json({ error: "The photo didn't upload. Try again." }, 400);
    const bytes = new Uint8Array(await blob.arrayBuffer());
    const mediaType = ["image/jpeg", "image/png", "image/webp"].includes(blob.type) ? blob.type : "image/jpeg";
    const hash = Array.from(new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))).map((x) => x.toString(16).padStart(2, "0")).join("");

    await admin.from("verify_log").insert({ user_id: user.id });

    // Same photo already used anywhere else?
    let verdict = "no", note = "", cheat = false;
    const { data: dup } = await admin.from("finds").select("id").eq("photo_hash", hash).neq("id", prev?.id ?? -1).limit(1);
    if (dup && dup.length) {
      note = "This photo was already used for another find.";
      cheat = true;
    } else {
      const ai = await askClaude(encodeBase64(bytes), mediaType, name, sci, group, place);
      verdict = ai.match; cheat = ai.cheat; note = ai.saw;
      if (cheat) { verdict = "no"; note = `${ai.saw ? ai.saw + ". " : ""}Only wild finds photographed by you count.`; }
    }
    if (cheat) verdict = "no";

    // Points, worked out here so they can't be faked
    const count = await nearbyCount(key, sci, lat, lng, radiusKm);
    const rar = rarityFor(count);
    const parts: string[] = [];
    let points = 0;
    if (verdict !== "no") {
      const base = verdict === "yes" ? rar.pts : Math.round(rar.pts / 2);
      points = base; parts.push(`${rar.id[0].toUpperCase() + rar.id.slice(1)} +${base}${verdict === "unsure" ? " (half: not sure)" : ""}`);
      const { data: mine } = await admin.from("finds").select("found_at,lat,lng,points").eq("user_id", user.id).gt("points", 0).neq("species_key", key);
      const now = Date.now();
      const dayStart = Math.floor((now - tz * 60000) / 864e5) * 864e5 + tz * 60000;
      if (!(mine ?? []).some((f) => new Date(f.found_at).getTime() >= dayStart)) { points += 10; parts.push("First find today +10"); }
      if (lat != null && lng != null && (mine ?? []).length && !(mine ?? []).some((f) => f.lat != null && kmBetween({ lat: f.lat, lng: f.lng }, { lat, lng }) < 10)) {
        points += 20; parts.push("New area +20");
      }
    }

    // Keep the original find date (for guest finds moved into an account), never in the future, max 1 year back
    const claimed = Date.parse(String(b.found_at ?? ""));
    const foundAt = prev?.found_at ?? new Date(Number.isFinite(claimed) ? Math.min(Date.now(), Math.max(Date.now() - 365 * 864e5, claimed)) : Date.now()).toISOString();

    const row = {
      user_id: user.id, species_key: key, name, sci, grp: group, rarity: rar.id, points: Math.min(200, points),
      verdict, ai_note: note, photo_path: photoPath, photo_hash: hash, lat, lng, place, country,
      found_at: foundAt, checked_at: new Date().toISOString(),
    };
    const { error: wErr } = await admin.from("finds").upsert(row, { onConflict: "user_id,species_key" });
    if (wErr) return json({ error: "Couldn't save the find. Try again." }, 500);
    if (prev?.photo_path && prev.photo_path !== photoPath) await admin.storage.from("photos").remove([prev.photo_path]);

    return json({ verdict, note, points: row.points, rarity: rar.id, parts, photo_path: photoPath, rescored: true });
  } catch (e) {
    return json({ error: "The photo checker had a problem. Your photo is saved; it'll be checked later." , detail: String(e).slice(0, 200) }, 500);
  }
});
