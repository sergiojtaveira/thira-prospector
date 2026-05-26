const express = require('express');
const fetch = require('node-fetch');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;

const RESEND_API_KEY = process.env.RESEND_API_KEY;
const DIGEST_EMAIL = 'sergio@thiradesign.co';
const FROM_EMAIL = 'crm@thiradesign.co';

// In-memory prospect store so the server can access CRM data
// Prospects are synced from the browser via a POST endpoint
let prospectStore = [];

app.use(express.static(path.join(__dirname, 'public')));
app.use(express.json({ limit: '5mb' }));

// Browser syncs CRM data to server so emails can be sent
app.post('/sync-prospects', (req, res) => {
  try {
    prospectStore = req.body.prospects || [];
    res.json({ ok: true, count: prospectStore.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

app.get('/search', async (req, res) => {
  const { q } = req.query;
  const key = process.env.SERPAPI_KEY;
  if (!q) return res.status(400).json({ error: 'Missing query' });
  if (!key) return res.status(500).json({ error: 'SerpApi key not configured' });
  try {
    const url = `https://serpapi.com/search.json?engine=google_maps&q=${encodeURIComponent(q)}&api_key=${key}&type=search&hl=en&gl=uk`;
    const response = await fetch(url);
    const data = await response.json();
    res.json(data);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// Send the daily digest email
async function sendDailyDigest() {
  if (!RESEND_API_KEY) { console.log('No Resend key, skipping digest'); return; }
  if (!prospectStore.length) { console.log('No prospects, skipping digest'); return; }

  const today = new Date(); today.setHours(0, 0, 0, 0);

  const callBacks = prospectStore.filter(c => c.status && c.status.callback);
  const followUps = prospectStore.filter(c => {
    if (!c.followUpDate) return false;
    const fu = new Date(c.followUpDate); fu.setHours(0, 0, 0, 0);
    return fu <= today;
  });

  // Deduplicate
  const seen = new Set();
  const toCall = [];
  [...followUps, ...callBacks].forEach(c => {
    if (!seen.has(c.id)) { seen.add(c.id); toCall.push(c); }
  });

  if (!toCall.length) { console.log('No prospects to call today, skipping digest'); return; }

  const rows = toCall.map(c => {
    const lastLog = c.callLog && c.callLog.length ? c.callLog[c.callLog.length - 1] : null;
    const lastNote = lastLog && lastLog.text ? lastLog.text : 'No note';
    const followUpBadge = c.followUpDate ? `<span style="background:#fbbf24;color:#0d1f1a;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600;">Follow up: ${c.followUpDate}</span>` : '';
    const cbBadge = c.status.callback ? `<span style="background:#60a5fa;color:#0d1f1a;padding:2px 8px;border-radius:100px;font-size:11px;font-weight:600;">Call back</span>` : '';
    return `
      <tr style="border-bottom:1px solid #1e3d32;">
        <td style="padding:14px 12px;">
          <div style="font-weight:600;color:#e8f0ec;font-size:14px;">${c.title}</div>
          <div style="color:#7ecfad;font-size:13px;margin-top:3px;">${c.phone || 'No phone'}</div>
          <div style="color:rgba(232,240,236,0.45);font-size:11px;margin-top:2px;">${c.address || ''}</div>
        </td>
        <td style="padding:14px 12px;vertical-align:top;">
          <div style="display:flex;gap:6px;flex-wrap:wrap;">${followUpBadge}${cbBadge}</div>
        </td>
        <td style="padding:14px 12px;vertical-align:top;">
          <div style="font-size:12px;color:rgba(232,240,236,0.6);font-style:italic;">${lastNote}</div>
        </td>
      </tr>`;
  }).join('');

  const html = `
    <div style="background:#0d1f1a;padding:32px;font-family:sans-serif;max-width:680px;margin:0 auto;border-radius:12px;">
      <div style="margin-bottom:24px;">
        <span style="font-size:20px;font-weight:600;color:#7ecfad;">thira</span>
        <span style="font-size:11px;color:rgba(232,240,236,0.4);letter-spacing:2px;text-transform:uppercase;margin-left:8px;">CRM Daily Digest</span>
      </div>
      <h1 style="font-size:22px;color:#e8f0ec;margin:0 0 6px 0;">${toCall.length} prospect${toCall.length > 1 ? 's' : ''} to call today</h1>
      <p style="color:rgba(232,240,236,0.5);font-size:13px;margin:0 0 24px 0;">${new Date().toLocaleDateString('en-GB', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })}</p>
      <table style="width:100%;border-collapse:collapse;background:#0f2520;border-radius:8px;overflow:hidden;">
        <thead>
          <tr style="background:#122b24;">
            <th style="padding:10px 12px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(232,240,236,0.3);">Business</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(232,240,236,0.3);">Reason</th>
            <th style="padding:10px 12px;text-align:left;font-size:10px;letter-spacing:1.5px;text-transform:uppercase;color:rgba(232,240,236,0.3);">Last Note</th>
          </tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div style="margin-top:24px;padding-top:16px;border-top:1px solid rgba(255,255,255,0.07);">
        <a href="https://thira-prospector-production.up.railway.app" style="background:#7ecfad;color:#0d1f1a;padding:10px 20px;border-radius:8px;text-decoration:none;font-weight:600;font-size:13px;">Open Thira Prospector</a>
      </div>
      <p style="color:rgba(232,240,236,0.25);font-size:11px;margin-top:20px;">Sent daily at 8am by Thira CRM</p>
    </div>`;

  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: DIGEST_EMAIL,
        subject: `📞 ${toCall.length} prospect${toCall.length > 1 ? 's' : ''} to call today — Thira CRM`,
        html
      })
    });
    const result = await response.json();
    console.log('Daily digest sent:', result.id || result);
  } catch (err) {
    console.error('Failed to send digest:', err.message);
  }
}

// Schedule daily digest at 8am London time
function scheduleDailyDigest() {
  function msUntilNext8am() {
    const now = new Date();
    const next = new Date();
    next.setHours(8, 0, 0, 0);
    if (now >= next) next.setDate(next.getDate() + 1);
    return next - now;
  }
  setTimeout(function tick() {
    sendDailyDigest();
    setTimeout(tick, 24 * 60 * 60 * 1000);
  }, msUntilNext8am());
  console.log(`Daily digest scheduled. Next send in ${Math.round(msUntilNext8am() / 60000)} minutes`);
}

scheduleDailyDigest();

app.listen(PORT, () => console.log(`Thira Prospector running on port ${PORT}`));
