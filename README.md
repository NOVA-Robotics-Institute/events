# NOVA events feed

Published events for [nova-robotics.org](https://nova-robotics.org), generated from the shared Google Drive.

- **Don't edit `events.json` or `event-images/` by hand.** They're overwritten every hour by the [Sync events](.github/workflows/sync.yml) workflow from the event sheets on the Drive (only sheets with **Publish?** = "Yes").
- Served by GitHub Pages at `https://nova-robotics-institute.github.io/events/events.json`; the website loads it on each visit, so changes appear without redeploying the site.
- To sync immediately: **Actions → Sync events → Run workflow**.

Repo secrets (Settings → Secrets and variables → Actions):

| Secret | Value |
| --- | --- |
| `GOOGLE_SERVICE_ACCOUNT` | The Google service account's JSON key (whole file contents) |
| `DRIVE_FOLDER_ID` | The ID at the end of the events folder's Drive URL |
