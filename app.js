(function () {
  const storageKey = "gw3-discord-timer";
  const webhookStorageKey = "gw3-discord-timer-webhook";
  const officialCacheUrl = "release-date.json";
  const fallStart = "2027-09-01T00:00";

  const elements = {
    eventName: document.getElementById("event-name"),
    targetDate: document.getElementById("target-date"),
    saveDate: document.getElementById("save-date"),
    checkOfficial: document.getElementById("check-official"),
    discordMessage: document.getElementById("discord-message"),
    copyMessage: document.getElementById("copy-message"),
    copyShort: document.getElementById("copy-short"),
    webhookUrl: document.getElementById("webhook-url"),
    rememberWebhook: document.getElementById("remember-webhook"),
    autoPostDaily: document.getElementById("auto-post-daily"),
    sendWebhook: document.getElementById("send-webhook"),
    feedback: document.getElementById("feedback"),
    status: document.getElementById("timer-status"),
    releaseLine: document.getElementById("release-line"),
    officialStatus: document.getElementById("official-status"),
    officialSource: document.getElementById("official-source"),
    days: document.getElementById("days"),
    hours: document.getElementById("hours"),
    minutes: document.getElementById("minutes"),
    seconds: document.getElementById("seconds")
  };

  let targetTime = null;

  function readSettings() {
    try {
      return JSON.parse(localStorage.getItem(storageKey)) || {};
    } catch (error) {
      return {};
    }
  }

  async function saveServerSettings() {
    try {
      await fetch("/settings", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          eventName: elements.eventName.value.trim(),
          targetDate: elements.targetDate.value,
          webhookUrl: elements.rememberWebhook.checked ? elements.webhookUrl.value.trim() : "",
          autoPostDaily: elements.autoPostDaily.checked
        })
      });
    } catch (error) {
      // The timer can still work as a static page; server-backed automation just stays unavailable.
    }
  }

  function writeSettings() {
    const settings = {
      eventName: elements.eventName.value.trim(),
      targetDate: elements.targetDate.value,
      autoPostDaily: elements.autoPostDaily.checked
    };
    localStorage.setItem(storageKey, JSON.stringify(settings));

    if (elements.rememberWebhook.checked && elements.webhookUrl.value.trim()) {
      localStorage.setItem(webhookStorageKey, elements.webhookUrl.value.trim());
    } else {
      localStorage.removeItem(webhookStorageKey);
    }

    saveServerSettings();
  }

  function showFeedback(message, type) {
    elements.feedback.textContent = message;
    elements.feedback.className = `feedback ${type || ""}`.trim();
  }

  function getUnixTimestamp() {
    if (!targetTime) {
      return null;
    }
    return Math.floor(targetTime.getTime() / 1000);
  }

  function formatDate(date) {
    return new Intl.DateTimeFormat(undefined, {
      dateStyle: "full",
      timeStyle: "short"
    }).format(date);
  }

  function buildDiscordMessage() {
    const name = elements.eventName.value.trim() || "Guild Wars 3 release";
    const unix = getUnixTimestamp();

    if (!unix) {
      return "Set the GW3 target date first, then copy this Discord message.";
    }

    return `${name}: <t:${unix}:R>\nExact time: <t:${unix}:F>`;
  }

  function toDatetimeLocalValue(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date.getTime() - offset).toISOString().slice(0, 16);
  }

  function seedFallStart() {
    if (!elements.targetDate.value) {
      elements.targetDate.value = fallStart;
    }
  }

  function updateDiscordMessage() {
    elements.discordMessage.value = buildDiscordMessage();
  }

  function setTargetFromInput(options) {
    const value = elements.targetDate.value;
    const parsed = value ? new Date(value) : null;

    if (!parsed || Number.isNaN(parsed.getTime())) {
      targetTime = null;
      updateDiscordMessage();
      return false;
    }

    targetTime = parsed;
    updateDiscordMessage();

    if (options && options.save) {
      writeSettings();
      showFeedback("Timer saved on this computer.", "good");
    }

    return true;
  }

  function updateCountdown() {
    if (!targetTime) {
      elements.days.textContent = "--";
      elements.hours.textContent = "--";
      elements.minutes.textContent = "--";
      elements.seconds.textContent = "--";
      elements.status.textContent = "Fall target";
      elements.releaseLine.textContent = "Counting down to the start of Fall 2027 until the official Guild Wars site confirms a release date.";
      return;
    }

    const now = Date.now();
    const remaining = targetTime.getTime() - now;
    const absoluteSeconds = Math.max(0, Math.floor(remaining / 1000));
    const days = Math.floor(absoluteSeconds / 86400);
    const hours = Math.floor((absoluteSeconds % 86400) / 3600);
    const minutes = Math.floor((absoluteSeconds % 3600) / 60);
    const seconds = absoluteSeconds % 60;

    elements.days.textContent = String(days);
    elements.hours.textContent = String(hours).padStart(2, "0");
    elements.minutes.textContent = String(minutes).padStart(2, "0");
    elements.seconds.textContent = String(seconds).padStart(2, "0");
    elements.status.textContent = remaining <= 0 ? "Released" : "Counting down";
    elements.releaseLine.textContent = `${elements.eventName.value.trim() || "Guild Wars 3 release"} target: ${formatDate(targetTime)}`;

    updateDiscordMessage();
  }

  function setOfficialStatus(message, sourceUrl, type) {
    elements.officialStatus.textContent = message;
    elements.officialStatus.className = type || "";
    elements.officialSource.textContent = sourceUrl ? `Source: ${sourceUrl}` : "";
  }

  async function fetchOfficialData(options) {
    if (options && options.force) {
      try {
        const response = await fetch(`/check-now?t=${Date.now()}`, { cache: "no-store" });
        if (response.ok) {
          return response.json();
        }
      } catch (error) {
        // Fall back to the cached file below when the page is opened directly.
      }
    }

    const response = await fetch(`${officialCacheUrl}?t=${Date.now()}`, { cache: "no-store" });
    if (!response.ok) {
      throw new Error("No local release-date cache yet");
    }

    return response.json();
  }

  async function checkOfficialCache(options) {
    try {
      const data = await fetchOfficialData(options || {});
      if (data.releaseDateIso && data.sourceUrl) {
        const parsed = new Date(data.releaseDateIso);
        if (!Number.isNaN(parsed.getTime())) {
          elements.eventName.value = "Guild Wars 3 release";
          elements.targetDate.value = toDatetimeLocalValue(parsed);
          setTargetFromInput({ save: true });
          updateCountdown();
          setOfficialStatus(`Official release date found by daily checker: ${formatDate(parsed)}`, data.sourceUrl, "good");
          if (options && options.manual) {
            showFeedback("Official Guild Wars release date loaded.", "good");
          }
          return;
        }
      }

      const checkedAt = data.checkedAt ? formatDate(new Date(data.checkedAt)) : "not yet";
      setOfficialStatus(`No official Guild Wars 3 release date found. Last checked: ${checkedAt}.`, data.sourceUrl || "", "warn");
      if (options && options.manual) {
        showFeedback("No official GW3 release date found yet. Keeping Fall 2027 start.", "warn");
      }
    } catch (error) {
      setOfficialStatus("Daily checker is not running. Use start-timer.cmd for official-site checks.", "", "warn");
      if (options && options.manual) {
        showFeedback("Start the timer with start-timer.cmd to enable official checks.", "warn");
      }
    }
  }

  async function copyText(text, successMessage) {
    if (!text || !targetTime) {
      showFeedback("Set a target date first.", "warn");
      return;
    }

    try {
      await navigator.clipboard.writeText(text);
      showFeedback(successMessage, "good");
    } catch (error) {
      elements.discordMessage.focus();
      elements.discordMessage.select();
      showFeedback("Clipboard blocked. The message is selected so you can copy it manually.", "warn");
    }
  }

  async function postWebhook() {
    if (!setTargetFromInput({ save: false })) {
      showFeedback("Set a target date first.", "warn");
      return;
    }

    const webhookUrl = elements.webhookUrl.value.trim();
    if (!webhookUrl || !webhookUrl.startsWith("https://discord.com/api/webhooks/")) {
      showFeedback("Paste a valid Discord webhook URL first.", "warn");
      return;
    }

    writeSettings();
    elements.sendWebhook.disabled = true;
    showFeedback("Posting to Discord...", "");

    try {
      await saveServerSettings();
      const response = await fetch("/post-discord", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          content: buildDiscordMessage(),
          targetDate: elements.targetDate.value,
          eventName: elements.eventName.value.trim(),
          webhookUrl
        })
      });

      if (!response.ok) {
        throw new Error(`Discord returned ${response.status}`);
      }

      showFeedback("Posted to Discord.", "good");
    } catch (error) {
      showFeedback(`Could not post directly. Copy the message instead. ${error.message}`, "danger");
    } finally {
      elements.sendWebhook.disabled = false;
    }
  }

  async function loadServerSettings() {
    try {
      const response = await fetch(`/settings?t=${Date.now()}`, { cache: "no-store" });
      if (!response.ok) {
        return;
      }

      const settings = await response.json();
      if (settings.eventName) {
        elements.eventName.value = settings.eventName;
      }
      if (settings.targetDate) {
        elements.targetDate.value = settings.targetDate;
      }
      if (settings.webhookConfigured) {
        elements.rememberWebhook.checked = true;
      }
      if (settings.webhookUrl) {
        elements.webhookUrl.value = settings.webhookUrl;
      }
      elements.autoPostDaily.checked = Boolean(settings.autoPostDaily);
    } catch (error) {
      // Opening index.html directly has no local server settings endpoint.
    }
  }

  async function boot() {
    const settings = readSettings();
    const savedWebhook = localStorage.getItem(webhookStorageKey);

    if (settings.eventName) {
      elements.eventName.value = settings.eventName;
    }
    if (settings.targetDate) {
      elements.targetDate.value = settings.targetDate;
    }
    seedFallStart();
    if (savedWebhook) {
      elements.webhookUrl.value = savedWebhook;
      elements.rememberWebhook.checked = true;
    }
    elements.autoPostDaily.checked = Boolean(settings.autoPostDaily);

    await loadServerSettings();

    setTargetFromInput({ save: false });
    updateCountdown();
    checkOfficialCache({ manual: false });
    window.setInterval(updateCountdown, 1000);

    elements.saveDate.addEventListener("click", () => {
      if (setTargetFromInput({ save: true })) {
        updateCountdown();
      } else {
        showFeedback("Choose a valid date and time first.", "warn");
      }
    });

    elements.checkOfficial.addEventListener("click", () => {
      checkOfficialCache({ manual: true, force: true });
    });

    elements.eventName.addEventListener("input", () => {
      updateDiscordMessage();
      updateCountdown();
    });

    elements.targetDate.addEventListener("input", () => {
      setTargetFromInput({ save: false });
      updateCountdown();
    });

    elements.copyMessage.addEventListener("click", () => {
      copyText(buildDiscordMessage(), "Discord message copied.");
    });

    elements.copyShort.addEventListener("click", () => {
      const unix = getUnixTimestamp();
      copyText(unix ? `<t:${unix}:R>` : "", "Short Discord timestamp copied.");
    });

    elements.sendWebhook.addEventListener("click", postWebhook);
    elements.rememberWebhook.addEventListener("change", writeSettings);
    elements.autoPostDaily.addEventListener("change", () => {
      writeSettings();
      showFeedback(
        elements.autoPostDaily.checked
          ? "Daily Discord messages enabled while start-timer.cmd is running."
          : "Daily Discord messages disabled.",
        elements.autoPostDaily.checked ? "good" : "warn"
      );
    });
    elements.webhookUrl.addEventListener("change", writeSettings);
  }

  boot();
}());
