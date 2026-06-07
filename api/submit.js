import nodemailer from 'nodemailer';

// ── Rate limiting (per IP, in-memory) ──────────────
const rateLimitMap = new Map();
const RATE_LIMIT    = 5;   // max submissions
const RATE_WINDOW   = 60 * 60 * 1000; // per hour

function isRateLimited(ip) {
  const now  = Date.now();
  const entry = rateLimitMap.get(ip) || { count: 0, start: now };
  if (now - entry.start > RATE_WINDOW) { entry.count = 0; entry.start = now; }
  entry.count++;
  rateLimitMap.set(ip, entry);
  return entry.count > RATE_LIMIT;
}

// ── HTML escaping to prevent injection in emails ───
function esc(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#x27;');
}

// ── Email format validation ────────────────────────
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
});

function notificationHtml({ first_name, last_name, phone, email, coverage_type }) {
  [first_name, last_name, phone, email, coverage_type] = [first_name, last_name, phone, email, coverage_type].map(esc);
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#f0fafa;margin:0;padding:0}
  .wrap{max-width:560px;margin:32px auto;background:#fff;border-radius:14px;overflow:hidden;box-shadow:0 4px 20px rgba(0,0,0,.08)}
  .hdr{background:#060F1C;padding:28px 36px;color:#fff}
  .hdr h1{margin:0;font-size:18px;font-weight:800;letter-spacing:-.02em}
  .hdr p{margin:4px 0 0;font-size:12px;color:rgba(255,255,255,.4);text-transform:uppercase;letter-spacing:.06em}
  .body{padding:32px 36px}
  .alert{background:#00C4D415;border-left:3px solid #00C4D4;border-radius:0 10px 10px 0;padding:14px 18px;margin-bottom:24px;font-size:14px;color:#0E7490;font-weight:700}
  table{width:100%;border-collapse:collapse;font-size:14px}
  td{padding:10px 0;border-bottom:1px solid #E4EDF2;color:#334155}
  td:first-child{font-weight:700;color:#64748B;width:40%}
  tr:last-child td{border-bottom:none}
  .btn{display:inline-block;margin-top:24px;background:linear-gradient(135deg,#00C4D4,#0891B2);color:#060F1C;text-decoration:none;font-weight:800;font-size:14px;padding:12px 26px;border-radius:8px}
  .ftr{background:#060F1C;padding:16px 36px;font-size:11px;color:rgba(255,255,255,.25);text-align:center}
</style>
</head><body>
<div class="wrap">
  <div class="hdr"><h1>New Quote Request</h1><p>Castro Coverage — Lead Notification</p></div>
  <div class="body">
    <div class="alert">🔔 New lead just came in — reach out within 24 hours</div>
    <table>
      <tr><td>Name</td><td>${first_name} ${last_name}</td></tr>
      <tr><td>Email</td><td><a href="mailto:${email}">${email}</a></td></tr>
      <tr><td>Phone</td><td><a href="tel:${phone}">${phone}</a></td></tr>
      <tr><td>Coverage Type</td><td>${coverage_type}</td></tr>
    </table>
    <a href="https://cal.com/christopher-castro-giz5ap/30min" class="btn">Schedule a Call with This Lead →</a>
  </div>
  <div class="ftr">Castro Coverage · NPN: 22109263 · castrocoverage.com</div>
</div>
</body></html>`;
}

function confirmationHtml({ first_name }) {
  first_name = esc(first_name);
  return `
<!DOCTYPE html><html><head><meta charset="UTF-8">
<style>
  body{font-family:Arial,sans-serif;background:#f0fafa;margin:0;padding:0}
  .wrap{max-width:580px;margin:32px auto;background:#fff;border-radius:16px;overflow:hidden;box-shadow:0 4px 24px rgba(0,0,0,.08)}
  .hdr{background:#060F1C;padding:36px 40px;text-align:center}
  .hdr-name{color:#fff;font-size:18px;font-weight:800;margin-top:12px;letter-spacing:-.02em}
  .hdr-tag{color:rgba(255,255,255,.4);font-size:12px;margin-top:4px;letter-spacing:.06em;text-transform:uppercase}
  .body{padding:40px}
  .logo-wrap{text-align:center;margin-bottom:24px}
  .heading{font-size:22px;font-weight:800;color:#060F1C;text-align:center;margin-bottom:12px}
  .sub{font-size:15px;color:#64748B;line-height:1.7;text-align:center;margin-bottom:32px}
  .info-box{background:#f0fafa;border-left:3px solid #00C4D4;border-radius:0 10px 10px 0;padding:18px 20px;margin-bottom:28px}
  .info-box p{margin:0;font-size:14px;color:#334155;line-height:1.7}
  .btn{display:block;width:fit-content;margin:0 auto 32px;background:linear-gradient(135deg,#00C4D4,#0891B2);color:#060F1C;text-decoration:none;font-weight:800;font-size:15px;padding:14px 32px;border-radius:10px}
  hr{border:none;border-top:1px solid #E4EDF2;margin:0 0 28px}
  .contact{text-align:center;font-size:13px;color:#94A3B8;line-height:1.8}
  .contact a{color:#0891B2;text-decoration:none}
  .ftr{background:#060F1C;padding:20px 40px;text-align:center}
  .ftr p{margin:0;font-size:11px;color:rgba(255,255,255,.25);line-height:1.7}
</style>
</head><body>
<div class="wrap">
  <div class="hdr">
    <div class="hdr-name">Castro Coverage</div>
    <div class="hdr-tag">Licensed Health Insurance Broker</div>
  </div>
  <div class="body">
    <div class="logo-wrap">
      <img src="https://castrocoverage.com/Brand%20Assets/Icon.png" alt="Castro Coverage" width="72" height="72">
    </div>
    <div class="heading">We received your request, ${first_name}.</div>
    <p class="sub">Thank you for reaching out to Castro Coverage. A licensed advisor will be in touch within 24 hours to walk you through your best options — no pressure, no jargon.</p>
    <div class="info-box">
      <p><strong>What happens next:</strong><br>
      We'll review your coverage needs and reach out personally to discuss the private health plans, ACA marketplace options, or group coverage that best fits your situation and budget. Our advisory service is completely free to you.</p>
    </div>
    <a href="https://cal.com/christopher-castro-giz5ap/30min" class="btn">Schedule a Call Now →</a>
    <hr>
    <div class="contact">
      <strong style="color:#334155">Christopher Castro</strong><br>
      Licensed Health Insurance Broker · NPN: 22109263<br>
      <a href="tel:+15614219421">(561) 421-9421</a> &nbsp;·&nbsp;
      <a href="mailto:christophercastrohealth@gmail.com">christophercastrohealth@gmail.com</a><br>
      <a href="https://castrocoverage.com">castrocoverage.com</a>
    </div>
  </div>
  <div class="ftr">
    <p>© 2026 Castro Coverage · NPN: 22109263 · Licensed in FL & 31+ States<br>
    You're receiving this because you requested a free health insurance quote.</p>
  </div>
</div>
</body></html>`;
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  // Rate limit by IP
  const ip = req.headers['x-forwarded-for']?.split(',')[0] ?? 'unknown';
  if (isRateLimited(ip)) {
    return res.status(429).json({ error: 'Too many requests. Please try again later.' });
  }

  // Honeypot — bots fill this, humans don't see it
  if (req.body.website) {
    return res.status(200).json({ success: true }); // silently discard
  }

  const { first_name, last_name, phone, email, coverage_type } = req.body;

  // Presence check
  if (!first_name || !last_name || !email || !coverage_type) {
    return res.status(400).json({ error: 'Missing required fields' });
  }

  // Length limits
  if ([first_name, last_name, phone, email, coverage_type].some(v => String(v).length > 200)) {
    return res.status(400).json({ error: 'Input too long' });
  }

  // Email format
  if (!EMAIL_RE.test(email)) {
    return res.status(400).json({ error: 'Invalid email address' });
  }

  try {
    await Promise.all([
      transporter.sendMail({
        from: `"Castro Coverage Website" <${process.env.GMAIL_USER}>`,
        to: process.env.GMAIL_USER,
        subject: `New Quote Request — ${first_name} ${last_name}`,
        html: notificationHtml({ first_name, last_name, phone, email, coverage_type }),
      }),
      transporter.sendMail({
        from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
        to: email,
        subject: `We received your quote request, ${first_name} — Castro Coverage`,
        html: confirmationHtml({ first_name }),
      }),
    ]);

    return res.status(200).json({ success: true });
  } catch (err) {
    console.error('Email error:', err.message);
    return res.status(500).json({ error: 'Failed to send email' });
  }
}
