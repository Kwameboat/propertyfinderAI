/**
 * Multi-platform social publisher facade.
 */

import { captionForPlatform } from "../social-prompt.mjs";
import { resolveAccountCreds, isAccountReady, SOCIAL_PLATFORMS } from "./creds.mjs";
import { publishInstagram, publishFacebook } from "./meta.mjs";
import { publishTikTok } from "./tiktok.mjs";
import { publishX } from "./x.mjs";
import { publishLinkedIn } from "./linkedin.mjs";
import { publishYouTube } from "./youtube.mjs";

export { SOCIAL_PLATFORMS, resolveAccountCreds, isAccountReady };

export async function publishToPlatform(db, platform, { captions, media, dryRun = true }) {
  const creds = resolveAccountCreds(db, platform);
  const caption = captionForPlatform(captions, platform);
  const imagePath = media?.squarePath || media?.storyPath || media?.imagePath || null;
  const storyPath = media?.storyPath || imagePath;
  const videoPath = media?.videoPath || null;
  const publicMediaBase = String(process.env.JAB_SOCIAL_PUBLIC_MEDIA_BASE || "").trim();

  if (dryRun) {
    return {
      ok: true,
      dryRun: true,
      platform,
      ready: isAccountReady(creds),
      handle: creds.handle,
      captionPreview: caption.slice(0, 180),
      media: { image: Boolean(imagePath), video: Boolean(videoPath) }
    };
  }

  if (!isAccountReady(creds)) {
    return {
      ok: false,
      platform,
      error: `${platform} not connected — add tokens in Hub Social or .env`
    };
  }

  try {
    let result;
    switch (platform) {
      case "instagram":
        result = await publishInstagram({
          creds,
          caption,
          imagePath: storyPath || imagePath,
          videoPath,
          publicMediaBase
        });
        break;
      case "facebook":
        result = await publishFacebook({ creds, caption, imagePath, videoPath });
        break;
      case "tiktok":
        result = await publishTikTok({ creds, caption, videoPath, imagePath: storyPath });
        break;
      case "x":
        result = await publishX({ creds, caption, imagePath, videoPath });
        break;
      case "linkedin":
        result = await publishLinkedIn({ creds, caption, imagePath, videoPath });
        break;
      case "youtube":
        result = await publishYouTube({ creds, caption, videoPath });
        break;
      default:
        throw new Error(`Unknown platform ${platform}`);
    }
    return { ok: true, platform, ...result };
  } catch (error) {
    return { ok: false, platform, error: error.message || String(error) };
  }
}

export async function publishSocialPost(db, post, { dryRun } = {}) {
  const platforms = post.platforms?.length ? post.platforms : SOCIAL_PLATFORMS;
  const useDry = dryRun !== undefined ? dryRun : Boolean(post.dry_run);
  const results = {};
  for (const platform of platforms) {
    results[platform] = await publishToPlatform(db, platform, {
      captions: post.captions,
      media: post.media,
      dryRun: useDry
    });
  }
  return results;
}
