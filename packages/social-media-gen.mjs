/**
 * AI flyer + short video generation for the agency social agent.
 * Primary: Gemini 2.5 Flash Image (Nano Banana) for PosterMyWall-style posts.
 * Fallback: richer ffmpeg poster layout (not a plain text card).
 */

import { mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";

function geminiKey() {
  return String(
    process.env.GEMINI_API_KEY ||
      process.env.GOOGLE_API_KEY ||
      process.env.GOOGLE_GENERATIVE_AI_API_KEY ||
      ""
  ).trim();
}

function imageModels() {
  const preferred =
    process.env.JAB_SOCIAL_IMAGE_MODEL ||
    process.env.JAB_SOCIAL_GEMINI_IMAGE_MODEL ||
    process.env.GEMINI_IMAGE_MODEL ||
    "";
  const defaults = [
    "gemini-2.5-flash-image",
    "gemini-3.1-flash-image",
    "gemini-3-pro-image",
    "gemini-2.0-flash-preview-image-generation"
  ];
  return preferred ? [preferred, ...defaults.filter((m) => m !== preferred)] : defaults;
}

async function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const child = spawn("ffmpeg", ["-y", ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let err = "";
    child.stderr.on("data", (d) => {
      err += d.toString();
    });
    child.on("error", (e) => reject(e));
    child.on("close", (code) => {
      if (code === 0) resolve(true);
      else reject(new Error(`ffmpeg exit ${code}: ${err.slice(-500)}`));
    });
  });
}

export function socialMediaDir(baseDir) {
  const dir = path.join(baseDir, "social");
  mkdirSync(dir, { recursive: true });
  return dir;
}

function escapeDrawText(s) {
  return String(s || "")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "")
    .replace(/%/g, "pct")
    .replace(/\n/g, " ")
    .slice(0, 48);
}

function buildPosterPrompt({ imagePrompt, headline, brandName, brandColors, brief, stylePrompt = "" }) {
  return [
    "Create a finished Instagram square advertising flyer (1080 style), like PosterMyWall / Canva.",
    "NOT a plain solid color with centered text. Must look designed, commercial, and UNIQUE.",
    "",
    stylePrompt ? `Style direction: ${stylePrompt}` : null,
    "",
    "Layout requirements:",
    "- Strong background (not flat empty teal)",
    "- Large stacked bold headlines on the LEFT (2–5 short lines max)",
    "- 1–2 circular photographic insets with thick white/gold borders on the RIGHT",
    "- Bottom contact / CTA strip (WhatsApp style) if phone numbers appear in the brief",
    "- Sharp typography, premium social-media poster look",
    "- No watermarks, no PosterMyWall logo, no UI chrome",
    "- Render all headline + phone text clearly in the image",
    "",
    `Brand: ${brandName}`,
    brandColors ? `Accent colors: ${brandColors}` : null,
    headline ? `Primary headline to feature: ${headline}` : null,
    brief ? `Campaign brief: ${String(brief).slice(0, 600)}` : null,
    imagePrompt ? `Art direction: ${imagePrompt}` : null,
    "",
    "Output a single finished poster image only."
  ]
    .filter(Boolean)
    .join("\n");
}

async function generateWithGeminiImage(prompt, outPath, model, referenceImages = []) {
  const key = geminiKey();
  if (!key) throw new Error("GEMINI_API_KEY missing");
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(
    model
  )}:generateContent?key=${encodeURIComponent(key)}`;

  const parts = [{ text: prompt }];
  for (const img of referenceImages.slice(0, 2)) {
    try {
      const buf = readFileSync(img.path || img);
      const b64 = buf.toString("base64");
      const mime = String(img.path || img).endsWith(".png") ? "image/png" : "image/jpeg";
      parts.push({ inlineData: { mimeType: mime, data: b64 } });
    } catch {
      /* skip bad ref */
    }
  }
  if (referenceImages.length) {
    parts[0] = {
      text:
        prompt +
        "\n\nUse the attached stock photos as the people inside the circular frames (edit/compose them into the poster). Keep faces natural. Do not leave empty gray circles."
    };
  }

  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key
    },
    body: JSON.stringify({
      contents: [{ role: "user", parts }],
      generationConfig: {
        responseModalities: ["TEXT", "IMAGE"],
        imageConfig: { aspectRatio: "1:1" }
      }
    }),
    signal: AbortSignal.timeout(180000)
  });
  const body = await response.text();
  if (!response.ok) throw new Error(`${model} ${response.status}: ${body.slice(0, 220)}`);
  const json = JSON.parse(body || "{}");
  const outParts = json?.candidates?.[0]?.content?.parts || [];
  for (const part of outParts) {
    const inline = part.inlineData || part.inline_data;
    if (inline?.data) {
      writeFileSync(outPath, Buffer.from(inline.data, "base64"));
      return outPath;
    }
  }
  throw new Error(`${model} returned no image bytes`);
}

/** Richer local poster if image API fails — still not AI photo, but not a blank teal card. */
async function generatePosterFallback({
  outPath,
  headline = "WANTED",
  line2 = "",
  line3 = "",
  brandName = "JAB Digital Hub",
  contact = ""
}) {
  const h1 = escapeDrawText(headline || "POST");
  const h2 = escapeDrawText(line2 || brandName);
  const h3 = escapeDrawText(line3 || "");
  const cta = escapeDrawText(contact || "DM / WhatsApp");
  const vf = [
    "color=c=0x0B0B0B:s=1080x1080:d=1",
    // left accent bar
    "drawbox=x=0:y=0:w=28:h=1080:color=0xE11D48:t=fill",
    // fake circular photo frames on right
    "drawbox=x=680:y=120:w=320:h=320:color=0x222222:t=fill",
    "drawbox=x=680:y=500:w=320:h=320:color=0x2A2A2A:t=fill",
    `drawtext=text='${h1}':fontsize=72:fontcolor=white:x=70:y=160:font=DejaVu-Sans-Bold`,
    `drawtext=text='${h2}':fontsize=48:fontcolor=white:x=70:y=280:font=DejaVu-Sans-Bold`,
    h3
      ? `drawtext=text='${h3}':fontsize=42:fontcolor=0xF8FAFC:x=70:y=370:font=DejaVu-Sans-Bold`
      : null,
    `drawbox=x=70:y=820:w=420:h=70:color=white:t=fill`,
    `drawtext=text='CONTACT US':fontsize=28:fontcolor=black:x=100:y=838:font=DejaVu-Sans-Bold`,
    `drawtext=text='${cta}':fontsize=30:fontcolor=white:x=70:y=920:font=DejaVu-Sans`
  ]
    .filter(Boolean)
    .join(",");

  // lavfi filter_complex with multiple draw ops via -vf on color source
  await runFfmpeg([
    "-f",
    "lavfi",
    "-i",
    "color=c=0x0B0B0B:s=1080x1080:d=1",
    "-vf",
    [
      "drawbox=x=0:y=0:w=28:h=1080:color=0xE11D48:t=fill",
      "drawbox=x=700:y=140:w=280:h=280:color=0x1F2937:t=fill",
      "drawbox=x=700:y=480:w=280:h=280:color=0x374151:t=fill",
      `drawtext=text='${h1}':fontsize=64:fontcolor=white:x=70:y=150`,
      `drawtext=text='${h2}':fontsize=44:fontcolor=white:x=70:y=260`,
      h3 ? `drawtext=text='${h3}':fontsize=40:fontcolor=white:x=70:y=350` : null,
      "drawbox=x=70:y=820:w=400:h=64:color=white:t=fill",
      "drawtext=text='CONTACT US':fontsize=26:fontcolor=black:x=95:y=838",
      `drawtext=text='${cta}':fontsize=28:fontcolor=white:x=70:y=920`
    ]
      .filter(Boolean)
      .join(","),
    "-frames:v",
    "1",
    outPath
  ]);
  return outPath;
}

/**
 * Create square + story flyer PNGs.
 */
export async function generateSocialFlyer({
  baseDir,
  imagePrompt,
  headline = "",
  brandName = "JAB Digital Hub",
  brandColors = "#0F4C5C,#E8D5B7",
  brief = "",
  line2 = "",
  line3 = "",
  contact = "",
  stylePrompt = "",
  stockImages = []
} = {}) {
  const dir = socialMediaDir(baseDir);
  const stamp = createHash("sha1")
    .update(`${Date.now()}:${imagePrompt}:${headline}:${brief}:${stylePrompt}`)
    .digest("hex")
    .slice(0, 12);
  const squarePath = path.join(dir, `flyer-${stamp}-1080.png`);
  const storyPath = path.join(dir, `flyer-${stamp}-story.png`);

  const prompt = buildPosterPrompt({
    imagePrompt,
    headline: [headline, line2, line3, contact].filter(Boolean).join(" | "),
    brandName,
    brandColors,
    brief,
    stylePrompt
  });

  let source = null;
  let method = "fallback";
  const errors = [];

  for (const model of imageModels()) {
    try {
      await generateWithGeminiImage(prompt, squarePath, model, stockImages);
      source = squarePath;
      method = `${model}${stockImages.length ? "+stock" : ""}`;
      break;
    } catch (e) {
      errors.push(`${model}:${e.message.slice(0, 100)}`);
    }
  }

  if (!source) {
    const tmp = path.join(dir, `flyer-${stamp}-card.png`);
    try {
      await generatePosterFallback({
        outPath: tmp,
        headline: headline || "NOW HIRING",
        line2: line2 || brandName,
        line3: line3 || String(brief || "").slice(0, 40),
        brandName,
        contact: contact || "WhatsApp us"
      });
      source = tmp;
      method = `poster-fallback:${errors.join("|").slice(0, 160)}`;
      writeFileSync(squarePath, readFileSync(tmp));
    } catch (e) {
      method = `failed:${e.message.slice(0, 120)}`;
      writeFileSync(
        squarePath,
        Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
          "base64"
        )
      );
      source = squarePath;
    }
  }

  try {
    await runFfmpeg([
      "-i",
      source,
      "-vf",
      "scale=1080:1920:force_original_aspect_ratio=decrease,pad=1080:1920:(ow-iw)/2:(oh-ih)/2:color=0x0B0B0B",
      storyPath
    ]);
  } catch {
    if (existsSync(source)) writeFileSync(storyPath, readFileSync(source));
  }

  return {
    squarePath: existsSync(squarePath) ? squarePath : source,
    storyPath: existsSync(storyPath) ? storyPath : source,
    method
  };
}

/**
 * Short vertical video from flyer (Ken Burns).
 */
export async function generateSocialVideo({
  baseDir,
  imagePath,
  hookText = "",
  durationSec = 10
} = {}) {
  const dir = socialMediaDir(baseDir);
  if (!imagePath || !existsSync(imagePath)) throw new Error("imagePath required for video");
  const stamp = createHash("sha1")
    .update(`${imagePath}:${Date.now()}`)
    .digest("hex")
    .slice(0, 12);
  const outPath = path.join(dir, `video-${stamp}.mp4`);
  const dur = Math.max(5, Math.min(30, Number(durationSec) || 10));
  const frames = dur * 25;
  const hook = escapeDrawText(hookText);

  const vf = [
    "scale=1080:1920:force_original_aspect_ratio=increase,crop=1080:1920",
    `zoompan=z='min(zoom+0.0012,1.35)':d=${frames}:x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)':s=1080x1920:fps=25`,
    hook
      ? `drawtext=text='${hook}':fontsize=42:fontcolor=white:borderw=2:bordercolor=black@0.6:x=(w-text_w)/2:y=h*0.82`
      : null
  ]
    .filter(Boolean)
    .join(",");

  await runFfmpeg([
    "-loop",
    "1",
    "-i",
    imagePath,
    "-vf",
    vf,
    "-t",
    String(dur),
    "-pix_fmt",
    "yuv420p",
    "-c:v",
    "libx264",
    "-movflags",
    "+faststart",
    outPath
  ]);

  return { videoPath: outPath, durationSec: dur };
}
