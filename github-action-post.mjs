import { readFile, writeFile } from "node:fs/promises";
import { existsSync } from "node:fs";

const officialReleasePages = [
  "https://www.guildwars3.com/en/",
  "https://www.guildwars2.com/en/news/",
  "https://www.guildwars.com/",
  "https://www.guildwars.com/en/",
  "https://www.guildwars.com/en/news/"
];

const newsSources = [
  {
    name: "Guild Wars 3 official site",
    url: "https://www.guildwars3.com/en/",
    parser: parseGuildWars3News
  },
  {
    name: "Guild Wars 2 official news",
    url: "https://www.guildwars2.com/en/news/",
    parser: parseGuildWars2News
  },
  {
    name: "Official Guild Wars YouTube",
    url: "https://www.youtube.com/feeds/videos.xml?user=guildwars2",
    parser: parseYouTubeFeed
  }
];

const allowedHosts = new Set([
  "guildwars.com",
  "www.guildwars.com",
  "guildwars2.com",
  "www.guildwars2.com",
  "guildwars3.com",
  "www.guildwars3.com",
  "youtube.com",
  "www.youtube.com",
  "youtu.be"
]);

const statePath = process.env.GW3_NEWS_STATE_PATH || "news-state.json";
const dryRun = process.env.DRY_RUN === "1";
const fallStartSeattleUnix = Math.floor(Date.parse("2027-09-01T07:00:00Z") / 1000);
const maxSeenIds = 200;

function isAllowedOfficialUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && allowedHosts.has(parsed.hostname);
  } catch (error) {
    return false;
  }
}

function decodeEntities(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function stripTags(html) {
  return decodeEntities(html)
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeText(value) {
  return stripTags(value).replace(/\s+/g, " ").trim();
}

function isGw3Relevant(text) {
  return /\b(guild\s*wars\s*3|gw3|guild\s*wars\s*franchise)\b/i.test(text);
}

function absoluteUrl(url, baseUrl) {
  try {
    return new URL(decodeEntities(url), baseUrl).toString();
  } catch (error) {
    return "";
  }
}

function itemId(url, title) {
  return `${url || "no-url"}#${normalizeText(title).toLowerCase()}`;
}

function uniqueById(items) {
  const seen = new Set();
  return items.filter((item) => {
    if (!item.id || seen.has(item.id)) {
      return false;
    }
    seen.add(item.id);
    return true;
  });
}

function parseDate(value) {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseMonthDate(value) {
  const parsed = new Date(`${value} 00:00:00Z`);
  return Number.isNaN(parsed.getTime()) ? "" : parsed.toISOString();
}

function parseGuildWars3News(html, source) {
  const newsBlock = html.split(/<h[12][^>]*>\s*News\s*<\/h[12]>/i)[1] || html;
  const linkMatches = [...newsBlock.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)];

  return uniqueById(linkMatches
    .map((match) => {
      const url = absoluteUrl(match[1], source.url);
      const title = normalizeText(match[2]);
      return {
        id: itemId(url, title),
        source: source.name,
        title,
        url,
        publishedAt: "",
        summary: ""
      };
    })
    .filter((item) => item.title && item.url && isAllowedOfficialUrl(item.url))
    .filter((item) => {
      const parsed = new URL(item.url);
      return parsed.hostname.endsWith("guildwars3.com") && parsed.pathname.includes("/news/");
    }));
}

function parseGuildWars2News(html, source) {
  const articleMatches = [...html.matchAll(
    /<h3[^>]*>\s*<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>\s*<\/h3>\s*([\s\S]*?)(?=<h3|\bPage\s+\d+\s+of|<footer|$)/gi
  )];

  return uniqueById(articleMatches
    .map((match) => {
      const url = absoluteUrl(match[1], source.url);
      const title = normalizeText(match[2]);
      const bodyText = normalizeText(match[3]);
      const dateMatch = bodyText.match(/\bon\s+([A-Z][a-z]+\s+\d{1,2},\s+20\d{2})/);
      const summary = bodyText
        .replace(/^by\s+The Guild Wars 2 Team\s+on\s+[A-Z][a-z]+\s+\d{1,2},\s+20\d{2}\s*/i, "")
        .replace(/\s*Read More\s*$/i, "")
        .trim();

      return {
        id: itemId(url, title),
        source: source.name,
        title,
        url,
        publishedAt: dateMatch ? parseMonthDate(dateMatch[1]) : "",
        summary
      };
    })
    .filter((item) => item.title && item.url && isAllowedOfficialUrl(item.url))
    .filter((item) => isGw3Relevant(`${item.title} ${item.summary}`)));
}

function tagValue(xml, tagName) {
  const match = xml.match(new RegExp(`<${tagName}\\b[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i"));
  return match ? decodeEntities(match[1]).trim() : "";
}

function parseYouTubeFeed(xml, source) {
  const entries = [...xml.matchAll(/<entry\b[^>]*>([\s\S]*?)<\/entry>/gi)];

  return uniqueById(entries
    .map((entryMatch) => {
      const entry = entryMatch[1];
      const videoId = tagValue(entry, "yt:videoId");
      const title = normalizeText(tagValue(entry, "title"));
      const description = normalizeText(tagValue(entry, "media:description"));
      const linkMatch = entry.match(/<link\b[^>]*href=["']([^"']+)["'][^>]*>/i);
      const url = linkMatch
        ? absoluteUrl(linkMatch[1], "https://www.youtube.com/")
        : `https://www.youtube.com/watch?v=${videoId}`;

      return {
        id: videoId || itemId(url, title),
        source: source.name,
        title,
        url,
        publishedAt: parseDate(tagValue(entry, "published")),
        summary: description
      };
    })
    .filter((item) => item.title && item.url && isAllowedOfficialUrl(item.url))
    .filter((item) => isGw3Relevant(`${item.title} ${item.summary}`)));
}

function parseOfficialReleaseDate(text) {
  if (!/guild wars 3|gw3/i.test(text) || !/release|launch/i.test(text)) {
    return null;
  }

  const monthPattern = "January|February|March|April|May|June|July|August|September|October|November|December";
  const patterns = [
    new RegExp(`(?:release(?:s| date)?|launch(?:es| date)?)\\D{0,100}(${monthPattern})\\s+(\\d{1,2}),\\s*(20\\d{2})`, "i"),
    new RegExp(`(${monthPattern})\\s+(\\d{1,2}),\\s*(20\\d{2})\\D{0,100}(?:release|launch)`, "i"),
    /(?:release(?:s| date)?|launch(?:es| date)?)\D{0,100}(\d{4})-(\d{2})-(\d{2})/i
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (!match) {
      continue;
    }

    if (/^\d{4}$/.test(match[1])) {
      return `${match[1]}-${match[2]}-${match[3]}T00:00:00Z`;
    }

    const parsed = new Date(`${match[1]} ${match[2]}, ${match[3]} 00:00:00Z`);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed.toISOString();
    }
  }

  return null;
}

async function fetchText(url) {
  if (!isAllowedOfficialUrl(url)) {
    throw new Error(`Blocked non-official URL: ${url}`);
  }

  const response = await fetch(url, {
    headers: {
      "User-Agent": "GW3 Discord Timer GitHub Action"
    }
  });

  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }

  return response.text();
}

async function findOfficialReleaseDate() {
  for (const pageUrl of officialReleasePages) {
    try {
      const text = stripTags(await fetchText(pageUrl));
      const releaseDateIso = parseOfficialReleaseDate(text);
      if (releaseDateIso) {
        return {
          releaseDateIso,
          sourceUrl: pageUrl
        };
      }
    } catch (error) {
      console.log(`Skipped release date check for ${pageUrl}: ${error.message}`);
    }
  }

  return {
    releaseDateIso: "",
    sourceUrl: ""
  };
}

async function findOfficialNews() {
  const results = [];

  for (const source of newsSources) {
    try {
      const text = await fetchText(source.url);
      const items = source.parser(text, source).map((item) => ({
        ...item,
        checkedAt: new Date().toISOString()
      }));
      console.log(`Checked ${source.name}: ${items.length} GW3-related item(s).`);
      results.push(...items);
    } catch (error) {
      console.log(`Skipped ${source.name}: ${error.message}`);
    }
  }

  return uniqueById(results).sort((a, b) => {
    const aTime = Date.parse(a.publishedAt || 0) || 0;
    const bTime = Date.parse(b.publishedAt || 0) || 0;
    return aTime - bTime;
  });
}

async function readState() {
  if (!existsSync(statePath)) {
    return {
      newsInitialized: false,
      seenNewsIds: [],
      lastCountdownDate: ""
    };
  }

  try {
    const state = JSON.parse(await readFile(statePath, "utf8"));
    return {
      newsInitialized: Boolean(state.newsInitialized),
      seenNewsIds: Array.isArray(state.seenNewsIds) ? state.seenNewsIds : [],
      lastCountdownDate: String(state.lastCountdownDate || "")
    };
  } catch (error) {
    return {
      newsInitialized: false,
      seenNewsIds: [],
      lastCountdownDate: ""
    };
  }
}

async function writeState(state) {
  const nextState = {
    newsInitialized: Boolean(state.newsInitialized),
    seenNewsIds: [...new Set(state.seenNewsIds)].slice(-maxSeenIds),
    lastCountdownDate: String(state.lastCountdownDate || ""),
    updatedAt: new Date().toISOString()
  };

  await writeFile(statePath, `${JSON.stringify(nextState, null, 2)}\n`, "utf8");
}

function utcDateKey(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

function truncate(value, maxLength) {
  const text = normalizeText(value);
  if (text.length <= maxLength) {
    return text;
  }
  return `${text.slice(0, maxLength - 1).trim()}...`;
}

function buildCountdownMessage(officialResult) {
  if (officialResult.releaseDateIso) {
    const unix = Math.floor(Date.parse(officialResult.releaseDateIso) / 1000);
    return [
      `Guild Wars 3 release: <t:${unix}:R>`,
      `Exact time: <t:${unix}:F>`,
      `Official source: ${officialResult.sourceUrl}`
    ].join("\n");
  }

  return [
    `Guild Wars 3 Fall 2027 watch: <t:${fallStartSeattleUnix}:R>`,
    `Placeholder start: <t:${fallStartSeattleUnix}:F>`,
    "No official guildwars.com/guildwars3.com release date found yet."
  ].join("\n");
}

function buildNewsMessage(item) {
  const publishedLine = item.publishedAt
    ? `Published: <t:${Math.floor(Date.parse(item.publishedAt) / 1000)}:F>`
    : "";
  const summaryLine = item.summary ? truncate(item.summary, 220) : "";

  return [
    `Official GW3 news from ${item.source}`,
    `**${truncate(item.title, 180)}**`,
    publishedLine,
    summaryLine,
    item.url
  ].filter(Boolean).join("\n");
}

async function postToDiscord(content) {
  if (dryRun) {
    console.log(`[dry-run] Would post to Discord:\n${content}`);
    return;
  }

  const webhookUrl = process.env.DISCORD_WEBHOOK_URL;
  if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
    throw new Error("Missing or invalid GW3_DISCORD_WEBHOOK_URL secret.");
  }

  const response = await fetch(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      username: "GW3 Timer",
      content
    })
  });

  if (!response.ok) {
    throw new Error(`Discord returned HTTP ${response.status}: ${await response.text()}`);
  }
}

const state = await readState();
const today = utcDateKey();

const officialResult = await findOfficialReleaseDate();
if (state.lastCountdownDate !== today) {
  await postToDiscord(buildCountdownMessage(officialResult));
  state.lastCountdownDate = today;
  console.log("Posted daily GW3 countdown.");
} else {
  console.log("Daily countdown already posted today.");
}

const officialNews = await findOfficialNews();
const knownIds = new Set(state.seenNewsIds);
const newItems = officialNews.filter((item) => !knownIds.has(item.id));

if (!state.newsInitialized) {
  state.newsInitialized = true;
  state.seenNewsIds = [...state.seenNewsIds, ...officialNews.map((item) => item.id)];
  console.log(`Initialized news tracking with ${officialNews.length} existing item(s); no old news posted.`);
} else {
  for (const item of newItems) {
    await postToDiscord(buildNewsMessage(item));
    state.seenNewsIds.push(item.id);
    console.log(`Posted news: ${item.title}`);
  }

  if (!newItems.length) {
    console.log("No new official GW3 news found.");
  }
}

await writeState(state);
