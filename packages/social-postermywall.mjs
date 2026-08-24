/**
 * Optional PosterMyWall developer hook.
 *
 * PosterMyWall’s public developer offering is primarily template/embed/export
 * for their editor — not a free “generate any flyer” API. Flyer generation in
 * JAB uses Gemini image + free stock + unique style prompts instead.
 *
 * Set POSTERMYWALL_API_KEY if you later wire their embed/export; this module
 * only reports availability so the agent can mention it honestly.
 */

export function posterMyWallConfigured() {
  return Boolean(String(process.env.POSTERMYWALL_API_KEY || "").trim());
}

export function posterMyWallStatus() {
  return {
    configured: posterMyWallConfigured(),
    mode: "gemini_compose",
    note:
      "Flyers are composed with Gemini + free stock (Pexels/Unsplash/Wikimedia) and unique style directions inspired by PosterMyWall layouts."
  };
}
