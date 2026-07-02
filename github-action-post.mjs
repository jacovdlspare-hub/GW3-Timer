const officialPages = [
  "https://www.guildwars.com/",
  "https://www.guildwars.com/en/",
  "https://www.guildwars.com/en/news/"
];

const allowedHosts = new Set(["guildwars.com", "www.guildwars.com"]);
const fallStartSeattleUnix = Math.floor(Date.parse("2027-09-01T07:00:00Z") / 1000);

function isOfficialGuildWarsUrl(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === "https:" && allowedHosts.has(parsed.hostname);
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

async function findOfficialReleaseDate() {
  for (const pageUrl of officialPages) {
    if (!isOfficialGuildWarsUrl(pageUrl)) {
      continue;
    }

    const response = await fetch(pageUrl, {
      headers: {
        "User-Agent": "GW3 Discord Timer GitHub Action"
      }
    });

    if (!response.ok) {
      console.log(`Skipped ${pageUrl}: HTTP ${response.status}`);
      continue;
    }

    const text = stripTags(await response.text());
    const releaseDateIso = parseOfficialReleaseDate(text);
    if (releaseDateIso) {
      return {
        releaseDateIso,
        sourceUrl: pageUrl
      };
    }
  }

  return {
    releaseDateIso: "",
    sourceUrl: ""
  };
}

function buildDiscordMessage(officialResult) {
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
    "No official guildwars.com release date found yet."
  ].join("\n");
}

async function postToDiscord(content) {
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

const officialResult = await findOfficialReleaseDate();
const message = buildDiscordMessage(officialResult);
await postToDiscord(message);

console.log(officialResult.releaseDateIso
  ? `Posted official GW3 countdown from ${officialResult.sourceUrl}`
  : "Posted Fall 2027 placeholder countdown; no official date found.");
