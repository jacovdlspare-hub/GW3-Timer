import { createServer } from "node:http";
import { readFile, writeFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const port = Number(process.env.PORT || 3883);
const cachePath = path.join(__dirname, "release-date.json");
const settingsPath = path.join(__dirname, "settings.local.json");
const dayMs = 24 * 60 * 60 * 1000;

const officialPages = [
  "https://www.guildwars.com/",
  "https://www.guildwars.com/en/",
  "https://www.guildwars.com/en/news/"
];

const contentTypes = new Map([
  [".html", "text/html; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".json", "application/json; charset=utf-8"]
]);

function isOfficialGuildWarsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && ["guildwars.com", "www.guildwars.com"].includes(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function stripTags(html) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ");
}

function parseOfficialReleaseDate(text) {
  if (!/guild wars 3|gw3/i.test(text) || !/release/i.test(text)) {
    return null;
  }

  const monthPattern = "January|February|March|April|May|June|July|August|September|October|November|December";
  const patterns = [
    new RegExp(`(?:release(?:s| date)?|launch(?:es| date)?)\\D{0,80}(${monthPattern})\\s+(\\d{1,2}),\\s*(20\\d{2})`, "i"),
    new RegExp(`(${monthPattern})\\s+(\\d{1,2}),\\s*(20\\d{2})\\D{0,80}(?:release|launch)`, "i"),
    /(?:release(?:s| date)?|launch(?:es| date)?)\D{0,80}(\d{4})-(\d{2})-(\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    if (Number(match[1])) {
      return `${match[1]}-${match[2]}-${match[3]}T00:00:00`;
    }

    const date = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00`);
    if (!Number.isNaN(date.getTime())) {
      return date.toISOString();
    }
  }

  return null;
}

async function readCache() {
  if (!existsSync(cachePath)) {
    return {};
  }

  try {
    return JSON.parse(await readFile(cachePath, "utf8"));
  } catch (error) {
    return {};
  }
}

async function writeCache(data) {
  await writeFile(cachePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

async function readJsonFile(filePath) {
  if (!existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    return {};
  }
}

async function readSettings() {
  return readJsonFile(settingsPath);
}

async function writeSettings(settings) {
  const current = await readSettings();
  const next = {
    ...current,
    eventName: String(settings.eventName || current.eventName || "Guild Wars 3 release window").slice(0, 120),
    targetDate: String(settings.targetDate || current.targetDate || "2027-09-01T00:00").slice(0, 40),
    webhookUrl: String(settings.webhookUrl || "").trim(),
    autoPostDaily: Boolean(settings.autoPostDaily)
  };

  if (next.webhookUrl && !next.webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    throw new Error("Webhook URL must start with https://discord.com/api/webhooks/");
  }

  await writeFile(settingsPath, `${JSON.stringify(next, null, 2)}\n`, "utf8");
  return next;
}

function localDateKey(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function targetDateToUnix(targetDate) {
  const parsed = new Date(targetDate || "2027-09-01T00:00");
  if (Number.isNaN(parsed.getTime())) {
    return Math.floor(new Date("2027-09-01T00:00").getTime() / 1000);
  }
  return Math.floor(parsed.getTime() / 1000);
}

function buildDiscordContent(settings, releaseCache) {
  const releaseDate = releaseCache.releaseDateIso || settings.targetDate || "2027-09-01T00:00";
  const eventName = releaseCache.releaseDateIso ? "Guild Wars 3 release" : settings.eventName || "Guild Wars 3 release window";
  const unix = targetDateToUnix(releaseDate);
  const sourceLine = releaseCache.releaseDateIso && releaseCache.sourceUrl
    ? `\nOfficial source: ${releaseCache.sourceUrl}`
    : "\nNo official guildwars.com release date yet. Counting down to the start of Fall 2027.";

  return `${eventName}: <t:${unix}:R>\nExact time: <t:${unix}:F>${sourceLine}`;
}

async function postToDiscord(settings, content) {
  if (!settings.webhookUrl) {
    throw new Error("No Discord webhook URL configured");
  }

  const response = await fetch(settings.webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "GW3 Timer",
      content
    })
  });

  if (!response.ok) {
    throw new Error(`Discord returned ${response.status}`);
  }
}

async function postDailyDiscordMessage(force = false) {
  const settings = await readSettings();
  if (!settings.autoPostDaily || !settings.webhookUrl) {
    return { posted: false, reason: "disabled" };
  }

  const today = localDateKey();
  if (!force && settings.lastPostedDate === today) {
    return { posted: false, reason: "already-posted-today" };
  }

  const releaseCache = await checkOfficialReleaseDate(false);
  const content = buildDiscordContent(settings, releaseCache);
  await postToDiscord(settings, content);

  const nextSettings = {
    ...settings,
    lastPostedDate: today,
    lastPostedAt: new Date().toISOString()
  };
  await writeFile(settingsPath, `${JSON.stringify(nextSettings, null, 2)}\n`, "utf8");

  return { posted: true, postedAt: nextSettings.lastPostedAt };
}

async function shouldCheckToday() {
  if (!existsSync(cachePath)) {
    return true;
  }

  const info = await stat(cachePath);
  return Date.now() - info.mtimeMs > dayMs;
}

async function checkOfficialReleaseDate(force = false) {
  if (!force && !(await shouldCheckToday())) {
    return readCache();
  }

  const result = {
    checkedAt: new Date().toISOString(),
    sourceUrl: "",
    releaseDateIso: "",
    status: "not-found",
    allowedHosts: ["guildwars.com", "www.guildwars.com"]
  };

  for (const pageUrl of officialPages) {
    if (!isOfficialGuildWarsUrl(pageUrl)) {
      continue;
    }

    result.sourceUrl = pageUrl;

    try {
      const response = await fetch(pageUrl, {
        headers: {
          "User-Agent": "GW3 Discord Timer official date checker"
        }
      });

      if (!response.ok) {
        continue;
      }

      const text = stripTags(await response.text());
      const releaseDateIso = parseOfficialReleaseDate(text);
      if (releaseDateIso) {
        result.releaseDateIso = releaseDateIso;
        result.status = "found";
        break;
      }
    } catch (error) {
      result.status = "check-error";
      result.error = error.message;
    }
  }

  await writeCache(result);
  return result;
}

function resolveRequestPath(requestUrl) {
  const url = new URL(requestUrl, `http://localhost:${port}`);
  const pathname = decodeURIComponent(url.pathname === "/" ? "/index.html" : url.pathname);
  const fullPath = path.normalize(path.join(__dirname, pathname));

  if (!fullPath.startsWith(__dirname)) {
    return null;
  }

  return fullPath;
}

const server = createServer(async (request, response) => {
  const requestUrl = new URL(request.url || "/", `http://localhost:${port}`);

  if (requestUrl.pathname === "/check-now") {
    const result = await checkOfficialReleaseDate(true);
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify(result, null, 2));
    return;
  }

  if (requestUrl.pathname === "/settings" && request.method === "GET") {
    const settings = await readSettings();
    response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({
      eventName: settings.eventName || "",
      targetDate: settings.targetDate || "",
      webhookUrl: settings.webhookUrl || "",
      webhookConfigured: Boolean(settings.webhookUrl),
      autoPostDaily: Boolean(settings.autoPostDaily),
      lastPostedAt: settings.lastPostedAt || ""
    }, null, 2));
    return;
  }

  if (requestUrl.pathname === "/settings" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const settings = await writeSettings(body);
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true, autoPostDaily: settings.autoPostDaily }, null, 2));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
    return;
  }

  if (requestUrl.pathname === "/post-discord" && request.method === "POST") {
    try {
      const body = await readRequestJson(request);
      const settings = await writeSettings({
        eventName: body.eventName,
        targetDate: body.targetDate,
        webhookUrl: body.webhookUrl,
        autoPostDaily: (await readSettings()).autoPostDaily
      });
      await postToDiscord(settings, body.content || buildDiscordContent(settings, await readCache()));
      response.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: true }, null, 2));
    } catch (error) {
      response.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
      response.end(JSON.stringify({ ok: false, error: error.message }, null, 2));
    }
    return;
  }

  const filePath = resolveRequestPath(request.url || "/");
  if (!filePath) {
    response.writeHead(403);
    response.end("Forbidden");
    return;
  }

  try {
    const body = await readFile(filePath);
    response.writeHead(200, {
      "Content-Type": contentTypes.get(path.extname(filePath)) || "application/octet-stream"
    });
    response.end(body);
  } catch (error) {
    response.writeHead(404);
    response.end("Not found");
  }
});

async function readRequestJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 20000) {
      throw new Error("Request body too large");
    }
  }
  return body ? JSON.parse(body) : {};
}

await checkOfficialReleaseDate(false);
setInterval(() => {
  checkOfficialReleaseDate(true).then(() => postDailyDiscordMessage(false)).catch((error) => {
    console.error(`Daily GW3 automation failed: ${error.message}`);
  });
}, dayMs);
postDailyDiscordMessage(false).catch((error) => {
  console.error(`Startup Discord post skipped: ${error.message}`);
});

server.listen(port, () => {
  console.log(`GW3 Discord Timer: http://localhost:${port}`);
  console.log("Official daily checks only trust https://www.guildwars.com/");
  console.log("Daily Discord messages send once per day while this window is running and auto-post is enabled.");
});
