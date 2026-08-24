/**
 * Telegram alerts for agency ops — handoffs, hot leads, payments.
 * Keeps internal alerts off WhatsApp to reduce Meta ban risk.
 */

export function telegramOpsConfigured() {
  const token = resolveOpsBotToken();
  return Boolean(token && resolveOpsChatIds().length);
}

export function resolveOpsBotToken() {
  return String(
    process.env.TELEGRAM_AGENCY_LEADS_BOT_TOKEN ||
      process.env.TELEGRAM_OPS_BOT_TOKEN ||
      process.env.TELEGRAM_BOT_TOKEN ||
      ""
  ).trim();
}

export function resolveOpsChatIds() {
  return [
    ...new Set(
      String(
        process.env.TELEGRAM_AGENCY_LEADS_CHAT_IDS ||
          process.env.TELEGRAM_OPS_CHAT_IDS ||
          process.env.TELEGRAM_APPROVER_IDS ||
          ""
      )
        .split(/[,;\s]+/)
        .map((s) => s.trim())
        .filter(Boolean)
    )
  ];
}

export async function sendTelegramOpsMessage(text, { disablePreview = true, hubUrl = "" } = {}) {
  const token = resolveOpsBotToken();
  const chatIds = resolveOpsChatIds();
  if (!token) {
    const err = new Error("telegram_ops_not_configured");
    err.code = "telegram_ops_not_configured";
    throw err;
  }
  if (!chatIds.length) {
    const err = new Error("telegram_ops_chat_ids_missing");
    err.code = "telegram_ops_chat_ids_missing";
    throw err;
  }

  let sent = 0;
  const errors = [];
  const replyMarkup =
    hubUrl && /^https?:\/\//i.test(String(hubUrl))
      ? { inline_keyboard: [[{ text: "Open in Hub", url: String(hubUrl).slice(0, 512) }]] }
      : undefined;
  for (const chatId of chatIds) {
    try {
      const payload = {
        chat_id: chatId,
        text: String(text || "").slice(0, 4000),
        disable_web_page_preview: Boolean(disablePreview)
      };
      if (replyMarkup) payload.reply_markup = replyMarkup;
      const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || !body.ok) {
        throw new Error(body.description || `HTTP ${response.status}`);
      }
      sent += 1;
    } catch (error) {
      errors.push({ chatId, error: error.message });
      console.error(
        JSON.stringify({ at: new Date().toISOString(), telegramOpsError: error.message, chatId })
      );
    }
  }
  return { sent, chats: chatIds.length, errors };
}
