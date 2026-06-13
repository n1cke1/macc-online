// Supabase Edge Function: email notifications for review activity.
//
// Invoked (fire-and-forget) by the `comments_notify` DB trigger with a JSON
// body `{ comment_id }`. Using the service-role key it looks up the new comment,
// determines recipients — the parent comment's author on a reply, plus any
// @mentioned display names it can resolve — and sends one email each via Resend.
//
// Realtime is deliberately out of v1.1: async review only needs email.
//
// Secrets (set with `supabase secrets set ...`):
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY  (provided automatically in prod)
//   RESEND_API_KEY   — Resend API key
//   NOTIFY_FROM      — e.g. "MACC KZ <noreply@your-domain.org>"
//   SITE_URL         — base URL for deep links back to the thread

import { createClient } from 'jsr:@supabase/supabase-js@2';

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY') ?? '';
const NOTIFY_FROM = Deno.env.get('NOTIFY_FROM') ?? 'MACC KZ <noreply@example.org>';
const SITE_URL = Deno.env.get('SITE_URL') ?? '';

const admin = createClient(SUPABASE_URL, SERVICE_KEY, {
  auth: { persistSession: false },
});

interface CommentRow {
  id: string;
  author_id: string;
  parent_id: string | null;
  target_type: string;
  target_id: string;
  body: string;
}

async function emailFor(userId: string): Promise<string | null> {
  const { data, error } = await admin.auth.admin.getUserById(userId);
  if (error || !data?.user?.email) return null;
  return data.user.email;
}

async function displayName(userId: string): Promise<string> {
  const { data } = await admin.from('profiles').select('display_name').eq('id', userId).single();
  return data?.display_name ?? 'Someone';
}

async function send(to: string, subject: string, html: string): Promise<void> {
  if (!RESEND_API_KEY) {
    console.warn('RESEND_API_KEY unset — skipping email to', to);
    return;
  }
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: NOTIFY_FROM, to, subject, html }),
  });
  if (!res.ok) console.error('Resend error', res.status, await res.text());
}

Deno.serve(async (req) => {
  try {
    const { comment_id } = await req.json();
    if (!comment_id) return new Response('missing comment_id', { status: 400 });

    const { data: comment, error } = await admin
      .from('comments')
      .select('id, author_id, parent_id, target_type, target_id, body')
      .eq('id', comment_id)
      .single<CommentRow>();
    if (error || !comment) return new Response('comment not found', { status: 404 });

    const fromName = await displayName(comment.author_id);
    const link = SITE_URL
      ? `${SITE_URL}/?focus=${comment.target_type}:${encodeURIComponent(comment.target_id)}`
      : '';
    const recipients = new Set<string>();

    // 1) Reply → notify the parent comment's author.
    if (comment.parent_id) {
      const { data: parent } = await admin
        .from('comments')
        .select('author_id')
        .eq('id', comment.parent_id)
        .single<{ author_id: string }>();
      if (parent && parent.author_id !== comment.author_id) {
        const to = await emailFor(parent.author_id);
        if (to) recipients.add(to);
      }
    }

    // 2) @mentions → resolve display names (case-insensitive, "@First Last" or "@First").
    const mentions = [...comment.body.matchAll(/@([\p{L}][\p{L}\s.'-]{1,40})/gu)].map((m) =>
      m[1].trim().toLowerCase(),
    );
    if (mentions.length) {
      const { data: profs } = await admin.from('profiles').select('id, display_name');
      for (const p of profs ?? []) {
        if (p.id === comment.author_id) continue;
        const dn = (p.display_name ?? '').toLowerCase();
        if (mentions.some((m) => dn === m || dn.startsWith(m))) {
          const to = await emailFor(p.id);
          if (to) recipients.add(to);
        }
      }
    }

    const subject = `MACC KZ — ${fromName} commented on a ${comment.target_type}`;
    const safeBody = comment.body.replace(/[<>&]/g, (c) =>
      ({ '<': '&lt;', '>': '&gt;', '&': '&amp;' })[c]!,
    );
    const html =
      `<p><strong>${fromName}</strong> wrote on <em>${comment.target_type}: ${comment.target_id}</em>:</p>` +
      `<blockquote style="border-left:3px solid #ccc;padding-left:12px;color:#333">${safeBody}</blockquote>` +
      (link ? `<p><a href="${link}">Open the thread →</a></p>` : '') +
      `<hr><p style="color:#888;font-size:12px">You received this because you were replied to or mentioned in the MACC KZ review tool.</p>`;

    await Promise.all([...recipients].map((to) => send(to, subject, html)));
    return new Response(JSON.stringify({ sent: recipients.size }), {
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (e) {
    console.error(e);
    return new Response('error', { status: 500 });
  }
});
