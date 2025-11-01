import type { VercelRequest, VercelResponse } from "@vercel/node";
import fetch from "node-fetch";
import { Resend } from "resend";

const resend = new Resend(process.env.RESEND_API_KEY!);

// Required env
const MAIL_FROM = process.env.MAIL_FROM!;     // e.g. "Digest <digest@yourdomain.com>"
const MAIL_TO   = process.env.MAIL_TO!;
const X_CLIENT_ID = process.env.X_CLIENT_ID!;
const X_CLIENT_SECRET = process.env.X_CLIENT_SECRET!;
const X_REFRESH_TOKEN = process.env.X_REFRESH_TOKEN!;
const REDIRECT_URI = process.env.X_REDIRECT_URI || "http://localhost:8080/callback";

async function refreshAccessToken(): Promise<string> {
  const form = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: X_REFRESH_TOKEN,
    client_id: X_CLIENT_ID,
    redirect_uri: REDIRECT_URI
  });
  const auth = Buffer.from(`${X_CLIENT_ID}:${X_CLIENT_SECRET}`).toString('base64');
  const r = await fetch("https://api.twitter.com/2/oauth2/token", {
    method: "POST",
    headers: { 
      "Content-Type": "application/x-www-form-urlencoded",
      "Authorization": `Basic ${auth}`
    },
    body: form.toString()
  });
  if (!r.ok) throw new Error(`Token refresh failed: ${r.status} ${await r.text()}`);
  const j = await r.json() as any;
  return j.access_token as string;
}

async function getMe(access: string): Promise<string> {
  const r = await fetch("https://api.x.com/2/users/me", {
    headers: { Authorization: `Bearer ${access}` }
  });
  if (!r.ok) throw new Error(`getMe failed: ${r.status} ${await r.text()}`);
  const j = await r.json() as any;
  return j.data.id as string;
}

async function fetchHome(userId: string, access: string, startISO: string, endISO: string) {
  const base = new URL(`https://api.x.com/2/users/${userId}/timelines/reverse_chronological`);
  base.searchParams.set("max_results","100");
  base.searchParams.set("start_time", startISO);
  base.searchParams.set("end_time", endISO);
  base.searchParams.set("exclude","replies,retweets");      // remove to include everything
  base.searchParams.set("expansions","author_id");
  base.searchParams.set("tweet.fields","created_at,public_metrics");
  base.searchParams.set("user.fields","name,username");

  let token: string | undefined;
  const pages:any[] = [];
  while (true) {
    const url = new URL(base);
    if (token) url.searchParams.set("pagination_token", token);
    const r = await fetch(url, { headers:{ Authorization:`Bearer ${access}` }});
    if (!r.ok) throw new Error(`timeline failed: ${r.status} ${await r.text()}`);
    const j = await r.json() as any;
    pages.push(j);
    token = j?.meta?.next_token;
    if (!token) break;
  }
  return pages;
}

function renderHTML(pages:any[]) {
  const users:Record<string,any> = {};
  const posts:any[] = [];

  for (const p of pages) {
    (p.includes?.users || []).forEach((u:any)=>users[u.id]=u);
    for (const t of (p.data || [])) {
      const u = users[t.author_id] || {};
      posts.push({
        created_at: t.created_at,
        id: t.id,
        text: t.text || "",
        metrics: t.public_metrics || {},
        name: u.name,
        username: u.username
      });
    }
  }

  posts.sort((a,b)=> (a.created_at < b.created_at ? 1 : -1));
  if (!posts.length) return "<p>No new posts in the last 24 hours.</p>";

  const esc = (s:string)=>s.replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;");
  const item = (p:any) => {
    const url = `https://x.com/${p.username}/status/${p.id}`;
    const when = new Date(p.created_at).toLocaleString();
    const m = p.metrics;
    return `
      <div style="border-bottom:1px solid #e5e7eb;padding:12px 0;">
        <div><b>${esc(p.name||"")}</b> @${esc(p.username||"")} · <a href="${url}">${when}</a></div>
        <div style="white-space:pre-wrap;margin:6px 0;">${esc(p.text)}</div>
        <div style="color:#6b7280;font-size:12px;">❤ ${m.like_count??0}  🔁 ${m.retweet_count??0}  💬 ${m.reply_count??0}</div>
      </div>`;
  };

  return `<h2 style="margin:0 0 12px 0;">Daily X Digest</h2>${posts.map(item).join("")}`;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  try {
    const access = await refreshAccessToken();
    const now = new Date();
    const endISO = new Date(now.getTime() - now.getMilliseconds()).toISOString();
    const startISO = new Date(now.getTime() - 24*3600*1000).toISOString();

    const userId = await getMe(access);
    const pages = await fetchHome(userId, access, startISO, endISO);
    const html = renderHTML(pages);

    await resend.emails.send({
      from: MAIL_FROM,
      to: MAIL_TO,
      subject: "Your Daily X Digest",
      html,
      text: "Open this in an HTML-capable client."
    });

    res.status(200).json({ ok: true, sent: true });
  } catch (e:any) {
    console.error(e);
    res.status(500).json({ ok: false, error: String(e?.message || e) });
  }
}