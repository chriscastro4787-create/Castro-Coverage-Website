/**
 * Castro Coverage — Lead Outreach Tool
 *
 * Local tool: enter a lead's name + email, it immediately sends the
 * prewritten "Health Insurance Request" email and logs the lead so you
 * can track the text conversation that follows — including which line
 * of the sales script comes next.
 *
 * Usage:
 *   node tools/lead-outreach-server.mjs
 *   (or double-click tools/run-lead-outreach.cmd)
 *
 * Uses the same GMAIL_USER / GMAIL_PASS app password already set in .env.
 */

import http from 'http';
import crypto from 'crypto';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import nodemailer from 'nodemailer';
import * as dotenv from 'dotenv';
import { ImapFlow } from 'imapflow';
import { simpleParser } from 'mailparser';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, '..', '.env') });

const PORT = 5055;
const LEADS_FILE = path.join(__dirname, 'leads.json');
const ARCHIVE_FILE = path.join(__dirname, 'leads-archive.json');
const HTML_FILE = path.join(__dirname, 'lead-outreach.html');
const IMAP_STATE_FILE = path.join(__dirname, 'imap-state.json');
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const IMAP_POLL_MS = 25000;
const ARCHIVE_SWEEP_MS = 24 * 60 * 60 * 1000; // once a day
const ARCHIVE_RESOLVED_DAYS = 90;  // Closed / Released / Follow Up / Not Qualified
const ARCHIVE_COLD_SENT_DAYS = 180; // still "Sent", never got any reply
const RESOLVED_STATUSES = ['dead', 'closed', 'released', 'followup', 'bounced'];
const BOUNCE_SENDER_RE = /mailer-daemon|postmaster|mail delivery subsystem/i;
const BOUNCE_SUBJECT_RE = /delivery status notification|undeliver|delivery (has )?failed|returned to sender|address not found|couldn'?t be delivered/i;

const LEAD_DEFAULTS = {
  status: 'sent',        // sent -> needs_reply -> awaiting_reply -> ... -> done -> (or dead, any time)
  scriptStep: 0,         // number of script lines already delivered (0-6)
  branch: null,          // 'individual' | 'family', set at step 3
  priceLow: '',
  priceHigh: '',
  hadContact: false,     // true once the lead has replied at least once
  callbackNumber: '',
  notes: '',
  respondedAt: null,
  lastReengagedAt: null,
  lastEmailReply: '',    // snippet of the most recent inbound email, auto-detected
  lastMessageId: null,   // Message-ID of the last email sent, for reply threading
  lastRescheduleProposal: '', // the last alternate date/time proposed, if any
};

const imapStatus = { lastCheckedAt: null, lastError: null, checking: false };

// Last line of defense: this tool needs to stay up. Log and keep running instead
// of letting one unexpected error (e.g. a transient OneDrive file lock) kill the process.
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server kept alive):', err);
});
process.on('unhandledRejection', (reason) => {
  console.error('Unhandled promise rejection (server kept alive):', reason);
});

const transporter = nodemailer.createTransport({
  service: 'gmail',
  auth: {
    user: process.env.GMAIL_USER,
    pass: process.env.GMAIL_PASS,
  },
  pool: true,          // reuse SMTP connections instead of a new handshake per email
  maxConnections: 3,   // a few connections in parallel, not a burst that looks abusive
  maxMessages: 100,    // recycle a connection after 100 sends
  rateDelta: 1000,     // ...no more than
  rateLimit: 3,        // 3 messages per this many ms — smooths out any rapid-fire sends
});

// Wraps transporter.sendMail with one retry on transient failures (network blips,
// temporary SMTP 4xx responses) so a single hiccup doesn't fail the whole request.
async function sendMailWithRetry(mailOptions, retries = 1) {
  try {
    return await transporter.sendMail(mailOptions);
  } catch (err) {
    if (retries <= 0) throw err;
    await new Promise(r => setTimeout(r, 1500));
    return sendMailWithRetry(mailOptions, retries - 1);
  }
}

function esc(str) {
  return String(str ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function signatureHtml() {
  return `
  <table cellpadding="0" cellspacing="0" role="presentation" style="border-collapse:collapse">
    <tr>
      <td style="vertical-align:middle;padding-right:14px">
        <img src="https://castrocoverage.com/Brand%20Assets/Icon.png" alt="Castro Coverage" width="46" height="46" style="display:block;border-radius:8px">
      </td>
      <td style="vertical-align:middle;border-left:2px solid #00C4D4;padding-left:14px">
        <div style="font-weight:700;color:#060F1C;font-size:14px">Christopher Castro</div>
        <div style="color:#64748B;font-size:12.5px;margin-top:1px">State Advisor · Castro Coverage</div>
        <div style="color:#64748B;font-size:12.5px;margin-top:4px">
          <a href="tel:+19542280869" style="color:#0891B2;text-decoration:none">(954) 228-0869</a>
          &nbsp;·&nbsp;
          <a href="mailto:christopherhealth@castrocoverage.com" style="color:#0891B2;text-decoration:none">christopherhealth@castrocoverage.com</a>
        </div>
      </td>
    </tr>
  </table>`;
}

function signatureText() {
  return `Christopher Castro\nState Advisor · Castro Coverage\n(954) 228-0869 · christopherhealth@castrocoverage.com`;
}

function outreachEmail(firstName) {
  const subject = 'Health Insurance Request';
  const text = `Hello ${firstName},\n\nI received your request for health insurance information. Were you looking for yourself or for the family?\n\nThank you,\n\n${signatureText()}`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.7;max-width:520px;margin:0 auto">
  <p style="margin:0 0 16px">Hello ${esc(firstName)},</p>
  <p style="margin:0 0 16px">I received your request for health insurance information. Were you looking for yourself or for the family?</p>
  <p style="margin:0 0 20px">Thank you,</p>
  ${signatureHtml()}
</div>`;
  return { subject, text, html };
}

function reengageEmail(firstName) {
  const subject = 'Still Interested in Health Coverage?';
  const text = `Hi ${firstName},\n\nJust wanted to check back in — are you still exploring health insurance options? I have some plans in mind and would love to help you find the right fit whenever you're ready.\n\nLet me know and we can pick the conversation back up.\n\nThank you,\n\n${signatureText()}`;
  const html = `
<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.7;max-width:520px;margin:0 auto">
  <p style="margin:0 0 16px">Hi ${esc(firstName)},</p>
  <p style="margin:0 0 16px">Just wanted to check back in — are you still exploring health insurance options? I have some plans in mind and would love to help you find the right fit whenever you're ready.</p>
  <p style="margin:0 0 16px">Let me know and we can pick the conversation back up.</p>
  <p style="margin:0 0 20px">Thank you,</p>
  ${signatureHtml()}
</div>`;
  return { subject, text, html };
}

// ── The text script, sent as threaded reply emails instead of copy/pasted ──
function scriptStepEmail(nextStep, branch, priceLow, priceHigh) {
  const lines = {
    1: `OK, there are many healthcare coverage plans available in your state. I do have some policies in mind for you, but they are based on your health. Are there any pre-existing conditions or medications that you need covered?`,
    2: `I may be able to assist you. How soon are you looking for a policy to begin?`,
    3: branch === 'family'
      ? `Ok, I can help you with that. What are your ages please? I'll try to get you some numbers...`
      : `Ok, I can help you with that. How old are you? I'll try to get you some numbers...`,
    4: `Thank you. It looks like I can get you into a plan that's a PPO, $0 deductible, AND $0 copays for around $${priceLow} - $${priceHigh} per month. Is that a comfortable range for you?`,
    5: `OK, I'd like to get on the phone with you to discuss your available options and dig deeper as to what you're looking for in coverage. What does your schedule look like this week?`,
    6: `Ok, I'll be sending you a message through my personal line, it'll come from a (561) number, make sure you send me a thumbs up to confirm the appointment, and save that number as it'll be where I'll call you from.`,
  };
  const text = lines[nextStep];
  const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.7;max-width:520px;margin:0 auto"><p style="margin:0">${esc(text)}</p></div>`;
  return { subject: 'Re: Health Insurance Request', text, html };
}

function readLeads() {
  if (!fs.existsSync(LEADS_FILE)) return [];
  try {
    const raw = JSON.parse(fs.readFileSync(LEADS_FILE, 'utf8'));
    return raw.map(l => {
      const merged = { ...LEAD_DEFAULTS, ...l };
      if (merged.status === 'responded') merged.status = 'needs_reply'; // legacy alias
      return merged;
    });
  } catch {
    return [];
  }
}

function writeLeads(leads) {
  fs.writeFileSync(LEADS_FILE, JSON.stringify(leads, null, 2));
}

function readArchive() {
  if (!fs.existsSync(ARCHIVE_FILE)) return [];
  try {
    return JSON.parse(fs.readFileSync(ARCHIVE_FILE, 'utf8'));
  } catch {
    return [];
  }
}

function writeArchive(archived) {
  fs.writeFileSync(ARCHIVE_FILE, JSON.stringify(archived, null, 2));
}

// Keeps leads.json small over time: moves long-resolved leads (Closed / Released /
// Follow Up / Not Qualified, past ARCHIVE_RESOLVED_DAYS) and cold never-replied
// leads (still "Sent", past ARCHIVE_COLD_SENT_DAYS) into leads-archive.json.
function archiveOldLeads() {
  try {
  const leads = readLeads();
  const now = Date.now();
  const toArchive = [];
  const toKeep = [];

  for (const lead of leads) {
    const lastActivity = new Date(lead.respondedAt || lead.sentAt).getTime();
    const daysSince = (now - lastActivity) / 86400000;

    const isOldResolved = RESOLVED_STATUSES.includes(lead.status) && daysSince > ARCHIVE_RESOLVED_DAYS;
    const isColdSent = lead.status === 'sent' && daysSince > ARCHIVE_COLD_SENT_DAYS;

    (isOldResolved || isColdSent ? toArchive : toKeep).push(lead);
  }

  if (toArchive.length) {
    writeArchive([...readArchive(), ...toArchive]);
    writeLeads(toKeep);
    console.log(`Archived ${toArchive.length} lead(s) into leads-archive.json`);
  }
  } catch (err) {
    console.error('Archive sweep failed (will retry next cycle):', err.message);
  }
}

function readImapState() {
  try {
    return JSON.parse(fs.readFileSync(IMAP_STATE_FILE, 'utf8'));
  } catch {
    return { lastUid: null };
  }
}

function writeImapState(state) {
  fs.writeFileSync(IMAP_STATE_FILE, JSON.stringify(state, null, 2));
}

// ── Background inbox check — flags a lead as "needs_reply" the moment ──
// they email back, without any manual click.
async function pollInbox() {
  if (!process.env.GMAIL_USER || !process.env.GMAIL_PASS || imapStatus.checking) return;
  imapStatus.checking = true;

  const client = new ImapFlow({
    host: 'imap.gmail.com',
    port: 993,
    secure: true,
    auth: { user: process.env.GMAIL_USER, pass: process.env.GMAIL_PASS },
    logger: false,
  });

  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX');
    try {
      const state = readImapState();

      if (state.lastUid == null) {
        // First run: baseline to "now" so we don't scan years of old mail.
        state.lastUid = client.mailbox.uidNext - 1;
        writeImapState(state);
      } else if (client.mailbox.uidNext - 1 > state.lastUid) {
        const leads = readLeads();
        const leadsByEmail = new Map(leads.map(l => [l.email.toLowerCase(), l]));
        let changed = false;
        let maxUid = state.lastUid;
        const bounceUidsToDelete = [];

        for await (const msg of client.fetch(`${state.lastUid + 1}:*`, { envelope: true, uid: true, source: true })) {
          if (msg.uid > maxUid) maxUid = msg.uid;

          const fromAddr = (msg.envelope?.from?.[0]?.address || '').toLowerCase();
          const subject = msg.envelope?.subject || '';
          const looksLikeBounce = BOUNCE_SENDER_RE.test(fromAddr) || BOUNCE_SUBJECT_RE.test(subject);

          if (looksLikeBounce) {
            let bodyText = '';
            try {
              const parsed = await simpleParser(msg.source);
              bodyText = (parsed.text || parsed.html || '').toLowerCase();
            } catch {
              // fall through with empty body if it can't be parsed
            }

            const bouncedLead = leads.find(l => bodyText.includes(l.email.toLowerCase()));
            if (bouncedLead && bouncedLead.status !== 'bounced') {
              bouncedLead.status = 'bounced';
              bouncedLead.notes = bouncedLead.notes
                ? `${bouncedLead.notes} | Email bounced — address not found.`
                : 'Email bounced — address not found.';
              changed = true;
            }

            bounceUidsToDelete.push(msg.uid);
            continue;
          }

          const lead = leadsByEmail.get(fromAddr);
          if (!lead || lead.status === 'needs_reply') continue;

          let snippet = '';
          try {
            const parsed = await simpleParser(msg.source);
            snippet = (parsed.text || '').trim().replace(/\s+/g, ' ').slice(0, 240);
          } catch {
            // fall through with empty snippet if the body can't be parsed
          }

          lead.status = 'needs_reply';
          lead.hadContact = true;
          lead.respondedAt = new Date().toISOString();
          lead.lastEmailReply = snippet;
          changed = true;
        }

        if (changed) writeLeads(leads);
        if (bounceUidsToDelete.length) {
          try {
            await client.messageDelete(bounceUidsToDelete, { uid: true });
          } catch (err) {
            console.error('Failed to delete bounce message(s):', err.message);
          }
        }
        state.lastUid = maxUid;
        writeImapState(state);
      }
    } finally {
      lock.release();
    }
    imapStatus.lastError = null;
  } catch (err) {
    imapStatus.lastError = err.message;
    console.error('IMAP poll failed:', err.message);
  } finally {
    imapStatus.checking = false;
    imapStatus.lastCheckedAt = new Date().toISOString();
    try {
      await client.logout();
    } catch {
      // connection may already be closed
    }
  }
}

function sendJson(res, status, data) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let chunks = '';
    req.on('data', c => (chunks += c));
    req.on('end', () => {
      if (!chunks) return resolve({});
      try {
        resolve(JSON.parse(chunks));
      } catch (e) {
        reject(e);
      }
    });
    req.on('error', reject);
  });
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);

  try {
    if (req.method === 'GET' && url.pathname === '/') {
      res.writeHead(200, { 'Content-Type': 'text/html' });
      return res.end(fs.readFileSync(HTML_FILE, 'utf8'));
    }

    if (req.method === 'GET' && url.pathname === '/api/leads') {
      const leads = readLeads().sort((a, b) => new Date(b.sentAt) - new Date(a.sentAt));
      return sendJson(res, 200, leads);
    }

    if (req.method === 'GET' && url.pathname === '/api/imap-status') {
      return sendJson(res, 200, imapStatus);
    }

    if (req.method === 'POST' && url.pathname === '/api/leads') {
      const body = await readBody(req);
      const firstName = String(body.firstName || '').trim();
      const lastName = String(body.lastName || '').trim();
      const email = String(body.email || '').trim();

      if (!firstName || !lastName || !email) {
        return sendJson(res, 400, { error: 'First name, last name, and email are all required.' });
      }
      if (!EMAIL_RE.test(email)) {
        return sendJson(res, 400, { error: 'Invalid email address.' });
      }

      const existing = [...readLeads(), ...readArchive()]
        .find(l => l.email.toLowerCase() === email.toLowerCase());
      if (existing) {
        const sentDate = new Date(existing.sentAt).toLocaleDateString();
        return sendJson(res, 409, {
          error: `The initial email was already sent to ${email} on ${sentDate} (as ${existing.firstName} ${existing.lastName}). Check the tracker — including the Archived section — before sending again.`,
        });
      }

      const { subject, text, html } = outreachEmail(firstName);
      let messageId;

      try {
        const info = await sendMailWithRetry({
          from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
          to: email,
          subject,
          text,
          html,
        });
        messageId = info.messageId;
      } catch (err) {
        console.error('Email send failed:', err.message);
        return sendJson(res, 500, { error: `Email failed to send: ${err.message}` });
      }

      const lead = {
        ...LEAD_DEFAULTS,
        id: crypto.randomUUID(),
        firstName,
        lastName,
        email,
        sentAt: new Date().toISOString(),
        lastMessageId: messageId,
      };

      const leads = readLeads();
      leads.push(lead);
      writeLeads(leads);

      return sendJson(res, 200, lead);
    }

    const idMatch = url.pathname.match(/^\/api\/leads\/([^/]+)$/);
    const reengageMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/reengage$/);

    if (req.method === 'POST' && reengageMatch) {
      const leads = readLeads();
      const idx = leads.findIndex(l => l.id === reengageMatch[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'Lead not found.' });

      const lead = leads[idx];
      const { subject, text, html } = reengageEmail(lead.firstName);

      try {
        const info = await sendMailWithRetry({
          from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
          to: lead.email,
          subject,
          text,
          html,
          inReplyTo: lead.lastMessageId || undefined,
          references: lead.lastMessageId || undefined,
        });
        lead.lastMessageId = info.messageId;
      } catch (err) {
        console.error('Re-engage email failed:', err.message);
        return sendJson(res, 500, { error: `Email failed to send: ${err.message}` });
      }

      lead.lastReengagedAt = new Date().toISOString();
      leads[idx] = lead;
      writeLeads(leads);
      return sendJson(res, 200, lead);
    }

    const advanceMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/advance-script$/);

    if (req.method === 'POST' && advanceMatch) {
      const leads = readLeads();
      const idx = leads.findIndex(l => l.id === advanceMatch[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'Lead not found.' });

      const lead = leads[idx];
      const cur = lead.scriptStep || 0;
      if (cur >= 6) return sendJson(res, 400, { error: 'The script is already complete for this lead.' });

      const body = await readBody(req);
      const nextStep = cur + 1;
      let branch = lead.branch;
      let priceLow = lead.priceLow;
      let priceHigh = lead.priceHigh;

      if (nextStep === 3) {
        branch = body.branch;
        if (branch !== 'individual' && branch !== 'family') {
          return sendJson(res, 400, { error: 'Choose "individual" or "family" before sending step 3.' });
        }
      }
      if (nextStep === 4) {
        priceLow = String(body.priceLow || '').trim();
        priceHigh = String(body.priceHigh || '').trim();
        if (!priceLow || !priceHigh) {
          return sendJson(res, 400, { error: 'Enter both the low and high monthly price before sending.' });
        }
      }

      const { subject, text, html } = scriptStepEmail(nextStep, branch, priceLow, priceHigh);

      try {
        const info = await sendMailWithRetry({
          from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
          to: lead.email,
          subject,
          text,
          html,
          inReplyTo: lead.lastMessageId || undefined,
          references: lead.lastMessageId || undefined,
        });
        lead.lastMessageId = info.messageId;
      } catch (err) {
        console.error('Script email failed:', err.message);
        return sendJson(res, 500, { error: `Email failed to send: ${err.message}` });
      }

      lead.status = 'awaiting_reply';
      lead.scriptStep = nextStep;
      lead.branch = branch;
      lead.priceLow = priceLow;
      lead.priceHigh = priceHigh;
      lead.lastEmailReply = '';

      leads[idx] = lead;
      writeLeads(leads);
      return sendJson(res, 200, lead);
    }

    const rescheduleMatch = url.pathname.match(/^\/api\/leads\/([^/]+)\/reschedule$/);

    if (req.method === 'POST' && rescheduleMatch) {
      const leads = readLeads();
      const idx = leads.findIndex(l => l.id === rescheduleMatch[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'Lead not found.' });

      const lead = leads[idx];
      const body = await readBody(req);
      const proposedTime = String(body.proposedTime || '').trim();
      if (!proposedTime) return sendJson(res, 400, { error: 'Enter a proposed date/time first.' });

      const text = `Unfortunately I won't be available at that time. Does ${proposedTime} work for you instead?`;
      const html = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:15px;color:#1a1a1a;line-height:1.7;max-width:520px;margin:0 auto"><p style="margin:0">${esc(text)}</p></div>`;

      try {
        const info = await sendMailWithRetry({
          from: `"Christopher Castro – Castro Coverage" <${process.env.GMAIL_USER}>`,
          to: lead.email,
          subject: 'Re: Health Insurance Request',
          text,
          html,
          inReplyTo: lead.lastMessageId || undefined,
          references: lead.lastMessageId || undefined,
        });
        lead.lastMessageId = info.messageId;
      } catch (err) {
        console.error('Reschedule email failed:', err.message);
        return sendJson(res, 500, { error: `Email failed to send: ${err.message}` });
      }

      lead.status = 'awaiting_reply';
      lead.lastEmailReply = '';
      lead.lastRescheduleProposal = proposedTime;

      leads[idx] = lead;
      writeLeads(leads);
      return sendJson(res, 200, lead);
    }

    if (req.method === 'PATCH' && idMatch) {
      const leads = readLeads();
      const idx = leads.findIndex(l => l.id === idMatch[1]);
      if (idx === -1) return sendJson(res, 404, { error: 'Lead not found.' });

      const body = await readBody(req);
      const lead = leads[idx];
      if (body.callbackNumber !== undefined) lead.callbackNumber = String(body.callbackNumber).trim();
      if (body.notes !== undefined) lead.notes = String(body.notes).trim();
      if (body.priceLow !== undefined) lead.priceLow = String(body.priceLow).trim();
      if (body.priceHigh !== undefined) lead.priceHigh = String(body.priceHigh).trim();
      if (body.branch !== undefined) lead.branch = body.branch;
      if (body.scriptStep !== undefined) lead.scriptStep = Number(body.scriptStep);
      if (body.status !== undefined) {
        lead.status = body.status;
        if (body.status === 'needs_reply') {
          lead.hadContact = true;
          lead.respondedAt = new Date().toISOString();
        } else {
          lead.lastEmailReply = ''; // cleared once you've acted on it
        }
      }
      leads[idx] = lead;
      writeLeads(leads);
      return sendJson(res, 200, lead);
    }

    if (req.method === 'DELETE' && idMatch) {
      writeLeads(readLeads().filter(l => l.id !== idMatch[1]));
      return sendJson(res, 200, { success: true });
    }

    sendJson(res, 404, { error: 'Not found' });
  } catch (err) {
    console.error('Server error:', err);
    sendJson(res, 500, { error: 'Internal server error' });
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use — the Lead Outreach tool may already be running in another window. Close that window (or the process using port ${PORT}) and try again.`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, () => {
  console.log(`Lead Outreach tool running at http://localhost:${PORT}`);
  pollInbox();
  setInterval(pollInbox, IMAP_POLL_MS);
  archiveOldLeads();
  setInterval(archiveOldLeads, ARCHIVE_SWEEP_MS);
});
