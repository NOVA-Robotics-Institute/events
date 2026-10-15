// Walks the shared Drive folder, reads every event sheet (headers in row 1, values in row 2),
// downloads event images, and writes events.json. No dependencies; needs Node 20+.
// Env: GOOGLE_SERVICE_ACCOUNT (service-account key JSON), DRIVE_FOLDER_ID (top-level events folder),
//      OUT_DIR (where to write, default '.'). Output is served by GitHub Pages and loaded by the website.
import { createSign } from 'node:crypto';
import { writeFile, rm, mkdir } from 'node:fs/promises';

const key = JSON.parse(process.env.GOOGLE_SERVICE_ACCOUNT);
const OUT = process.env.OUT_DIR || '.';
const IMG_DIR = 'event-images'; // image paths in events.json are relative to it

// Service-account OAuth: sign a JWT, trade it for an access token
const b64 = o => Buffer.from(JSON.stringify(o)).toString('base64url');
const now = Math.floor(Date.now() / 1000);
const claims = b64({ alg: 'RS256', typ: 'JWT' }) + '.' + b64({
  iss: key.client_email, aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600,
  scope: 'https://www.googleapis.com/auth/drive.readonly https://www.googleapis.com/auth/spreadsheets.readonly',
});
const jwt = claims + '.' + createSign('RSA-SHA256').update(claims).sign(key.private_key, 'base64url');
const { access_token } = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: jwt }),
}).then(r => r.json());

const get = async url => {
  const r = await fetch(url, { headers: { Authorization: `Bearer ${access_token}` } });
  if (!r.ok) throw new Error(`${r.status} ${url}\n${await r.text()}`);
  return r;
};

// Recursively collect Google Sheets under the folder
async function sheetsIn(folderId) {
  const q = encodeURIComponent(`'${folderId}' in parents and trashed = false`);
  const { files } = await get(`https://www.googleapis.com/drive/v3/files?q=${q}&pageSize=1000&fields=files(id,name,mimeType)&supportsAllDrives=true&includeItemsFromAllDrives=true`).then(r => r.json());
  const nested = await Promise.all(files.filter(f => f.mimeType.endsWith('.folder')).map(f => sheetsIn(f.id)));
  return files.filter(f => f.mimeType.endsWith('.spreadsheet')).concat(...nested);
}

// Sheets returns dates/times as serial numbers (days since 1899-12-30) unless typed as text
const serial = n => new Date(Date.UTC(1899, 11, 30) + n * 864e5);
const toDate = v => (typeof v === 'number' ? serial(v) : new Date(v)).toISOString().slice(0, 10);
const toTime = v => typeof v === 'number'
  ? serial(v % 1).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' })
  : String(v ?? '').trim();

const FIELDS = {
  'event name': 'name', date: 'date', 'start time': 'start', 'end time': 'end', location: 'location', chapter: 'chapter',
  'brief description': 'description', 'signup link': 'signup', 'link to image': 'image', 'publish?': 'publish',
};

await rm(`${OUT}/${IMG_DIR}`, { recursive: true, force: true });
await mkdir(`${OUT}/${IMG_DIR}`, { recursive: true });
const events = [];

for (const file of await sheetsIn(process.env.DRIVE_FOLDER_ID)) {
  try {
    const { values = [] } = await get(`https://sheets.googleapis.com/v4/spreadsheets/${file.id}/values/A1:Z2?valueRenderOption=UNFORMATTED_VALUE&dateTimeRenderOption=SERIAL_NUMBER`).then(r => r.json());
    const [head = [], row = []] = values;
    const e = {};
    head.forEach((h, i) => { const k = FIELDS[String(h).trim().toLowerCase()]; if (k) e[k] = row[i]; });
    if (!e.name || !e.date || !/^yes/i.test(e.publish)) continue;

    let image = String(e.image ?? '').trim();
    const driveId = image.match(/\/d\/([\w-]+)|[?&]id=([\w-]+)/);
    if (driveId) {
      const id = driveId[1] || driveId[2];
      const r = await get(`https://www.googleapis.com/drive/v3/files/${id}?alt=media&supportsAllDrives=true`);
      image = `${IMG_DIR}/${id}.${r.headers.get('content-type').split('/')[1].replace('jpeg', 'jpg')}`;
      await writeFile(`${OUT}/${image}`, Buffer.from(await r.arrayBuffer()));
    }

    events.push({
      name: String(e.name).trim(),
      date: toDate(e.date),
      time: [toTime(e.start), toTime(e.end)].filter(Boolean).join(' – '),
      location: String(e.location ?? '').trim(),
      chapter: String(e.chapter ?? 'All').split(' ')[0], // "All (use if not chapter-specific)" -> "All"
      description: String(e.description ?? '').trim(),
      signup: String(e.signup ?? '').trim(),
      image,
    });
  } catch (err) {
    console.warn(`Skipping "${file.name}": ${err.message}`); // one bad sheet shouldn't break the site
  }
}

events.sort((a, b) => a.date.localeCompare(b.date));
await writeFile(`${OUT}/events.json`, JSON.stringify(events, null, 2) + '\n');
await writeFile(`${OUT}/.nojekyll`, ''); // serve files as-is on GitHub Pages
console.log(`Wrote ${events.length} events`);
