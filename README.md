# GW3 Discord Timer

Standalone countdown page for Guild Wars 3.

There are two ways to use this:

- Open `index.html` locally for a visual countdown.
- Use the GitHub Actions workflow for automatic daily Discord posts without leaving your PC on.

The timer starts at September 1, 2027, which is the start of Fall 2027 in the northern hemisphere.

## Discord usage

- Use **Copy Message** to copy a Discord-ready countdown using `<t:UNIX:R>` and `<t:UNIX:F>`.
- Use **Copy Short Timestamp** for just the relative countdown timestamp.
- Optional: paste a Discord channel webhook URL and click **Post To Discord**.
- The GitHub Action sends one Discord message per day without your PC running.

Webhook URLs are secrets. For GitHub Actions, save it as a repository secret named `GW3_DISCORD_WEBHOOK_URL`.

## Official release date check

The GitHub Action runs once per day. It only accepts a release date if it finds the date on `guildwars.com`. Other news sites and rumours are ignored.

If no official date is found, the timer keeps counting down to the start of Fall 2027.

## GitHub setup

1. Create a Discord webhook for the channel.
2. In GitHub, open the repo settings.
3. Go to **Secrets and variables** > **Actions**.
4. Add a repository secret named `GW3_DISCORD_WEBHOOK_URL`.
5. Paste the Discord webhook URL as the secret value.
6. Push this repo to GitHub.
7. Open **Actions** > **GW3 Discord Timer** and run it once with **Run workflow**.

The schedule is `0 22 * * *`, which is around 8am Sydney time during standard time and 9am during daylight saving time.
