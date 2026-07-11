/**
 * Castro Coverage — Confirmation Email Tool
 *
 * Sends a branded confirmation email to a lead after they submit a quote request.
 *
 * Usage:
 *   node tools/send_confirmation.mjs "First Last" "lead@email.com"
 *
 * Setup (one-time):
 *   1. Enable 2-Step Verification on your Gmail account
 *   2. Go to myaccount.google.com → Security → App Passwords
 *   3. Create an App Password for "Mail"
 *   4. Add to .env:
 *        GMAIL_USER=christopherhealth@castrocoverage.com
 *        GMAIL_PASS=your_app_password_here
 *   5. Run: npm install nodemailer dotenv
 */

import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
dotenv.config();

const [,, fullName, toEmail] = process.argv;

if (!fullName || !toEmail) {
  console.error('Usage: node tools/send_confirmation.mjs "First Last" "email@example.com"');
  process.exit(1);
}

const firstName = fullName.split(' ')[0];

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
  pool: true,
  maxConnections: 3,
  maxMessages: 100,
  rateDelta: 1000,
  rateLimit: 3,
});

const html = `
<!DOCTYPE html>
<html>
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
  body { margin: 0; padding: 0; background: #f0fafa; font-family: Arial, sans-serif; }
  .wrap { max-width: 580px; margin: 32px auto; background: #ffffff; border-radius: 16px; overflow: hidden; box-shadow: 0 4px 24px rgba(0,0,0,.08); }
  .header { background: #060F1C; padding: 36px 40px; text-align: center; }
  .header img { width: 56px; height: 56px; }
  .header-name { color: #ffffff; font-size: 18px; font-weight: 800; margin-top: 12px; letter-spacing: -.02em; }
  .header-tag { color: rgba(255,255,255,.4); font-size: 12px; margin-top: 4px; letter-spacing: .06em; text-transform: uppercase; }
  .body { padding: 40px; }
  .check { width: 56px; height: 56px; background: linear-gradient(135deg, #00C4D4, #0891B2); border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 24px; }
  .heading { font-size: 22px; font-weight: 800; color: #060F1C; text-align: center; margin-bottom: 12px; }
  .sub { font-size: 15px; color: #64748B; line-height: 1.7; text-align: center; margin-bottom: 32px; }
  .info-box { background: #f0fafa; border-left: 3px solid #00C4D4; border-radius: 0 10px 10px 0; padding: 18px 20px; margin-bottom: 28px; }
  .info-box p { margin: 0; font-size: 14px; color: #334155; line-height: 1.7; }
  .btn { display: block; width: fit-content; margin: 0 auto 32px; background: linear-gradient(135deg, #00C4D4, #0891B2); color: #060F1C; text-decoration: none; font-weight: 800; font-size: 15px; padding: 14px 32px; border-radius: 10px; }
  .divider { border: none; border-top: 1px solid #E4EDF2; margin: 0 0 28px; }
  .footer { background: #060F1C; padding: 20px 40px; text-align: center; }
  .footer p { margin: 0; font-size: 11px; color: rgba(255,255,255,.25); line-height: 1.7; }
</style>
</head>
<body>
<div class="wrap">
  <div class="header">
    <div class="header-name">Castro Coverage</div>
    <div class="header-tag">Licensed Health Insurance Broker</div>
  </div>
  <div class="body">
    <div style="text-align:center;margin-bottom:24px">
      <img src="https://castrocoverage.com/Brand%20Assets/Icon.png" alt="Castro Coverage" width="72" height="72" style="display:inline-block">
    </div>
    <div class="heading">We received your request, ${firstName}.</div>
    <p class="sub">
      Thank you for reaching out to Castro Coverage. A licensed advisor will be in touch with you within 24 hours to walk you through your best options — no pressure, no jargon.
    </p>
    <div class="info-box">
      <p><strong>What happens next:</strong><br>
      We'll review your coverage needs and reach out personally to discuss the private health plans, ACA marketplace options, or group coverage that best fits your situation and budget. Our advisory service is completely free to you.</p>
    </div>
    <a href="https://calendar.app.google/bpAhv9YdZV2qYySA9" class="btn">
      Schedule a Call Now →
    </a>
    <hr class="divider">
    <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse;margin:0 auto">
      <tr>
        <td style="vertical-align:middle;padding-right:14px">
          <img src="https://castrocoverage.com/Brand%20Assets/Icon.png" alt="Castro Coverage" width="46" height="46" style="display:block;border-radius:8px">
        </td>
        <td style="vertical-align:middle;border-left:2px solid #00C4D4;padding-left:14px;text-align:left">
          <div style="font-weight:700;color:#060F1C;font-size:14px">Christopher Castro</div>
          <div style="color:#64748B;font-size:12.5px;margin-top:1px">State Advisor · Castro Coverage</div>
          <div style="color:#64748B;font-size:12.5px;margin-top:4px">
            <a href="tel:+19542280869" style="color:#0891B2;text-decoration:none">(954) 228-0869</a>
            &nbsp;·&nbsp;
            <a href="mailto:christopherhealth@castrocoverage.com" style="color:#0891B2;text-decoration:none">christopherhealth@castrocoverage.com</a>
          </div>
        </td>
      </tr>
    </table>
  </div>
  <div class="footer">
    <p>© 2026 Castro Coverage · NPN: 22109263 · Licensed in FL & 31+ States<br>
    You're receiving this because you requested a free health insurance quote.</p>
  </div>
</div>
</body>
</html>
`;

try {
  await transporter.sendMail({
    from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
    to: toEmail,
    subject: `We received your quote request, ${firstName} — Castro Coverage`,
    html,
  });
  console.log(`✅ Confirmation sent to ${fullName} <${toEmail}>`);
} catch (err) {
  console.error('❌ Failed to send:', err.message);
  process.exit(1);
}
