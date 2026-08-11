export interface Env {
  SERVICES_EMAIL: any;
}

function subdomainFromHost(host: string) {
  if (!host) return '';
  const parts = host.split('.');
  // return first label as subdomain (naive but sufficient for mapping)
  return parts.length > 2 ? parts[0] : '';
}

// Parse RFC-5322 style headers from a raw email string into a simple map.
function parseEmailHeaders(raw: string) {
  const out: Record<string, string> = {};
  if (!raw) return out;
  // Split headers / body
  const split = raw.split(/\r?\n\r?\n/);
  const headerBlock = split.length ? split[0] : raw;
  // Unfold folded header lines (replace CRLF + SP/TAB with a single space)
  const unfolded = headerBlock.replace(/\r?\n[ \t]+/g, ' ');
  const lines = unfolded.split(/\r?\n/);
  for (const line of lines) {
    const idx = line.indexOf(':');
    if (idx === -1) continue;
    const name = line.slice(0, idx).trim().toLowerCase();
    const value = line.slice(idx + 1).trim();
    if (!out[name]) out[name] = value;
  }
  return out;
}

function selectDbForSubdomain(subdomain: string, env: Env) {
  // For now there is only one D1: services-email bound to SERVICES_EMAIL.
  // Extend this function to map other subdomains to different D1 bindings.
  return env.SERVICES_EMAIL;
}

export default {
  async fetch(request: Request, env: Env) {
    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    const host = request.headers.get('host') || '';
    const subdomain = subdomainFromHost(host);
    const db = selectDbForSubdomain(subdomain, env);

    let payload: any = {};
    const ct = request.headers.get('content-type') || '';
    try {
      if (ct.includes('application/json')) {
        payload = await request.json();
      } else {
        const form = await request.formData();
        // Common fields from Email Routing or other providers
        payload.from = form.get('from')?.toString() || form.get('sender')?.toString() || '';
        payload.to = form.get('to')?.toString() || '';
        payload.cc = form.get('cc')?.toString() || '';
        payload.bcc = form.get('bcc')?.toString() || '';
        payload.subject = form.get('subject')?.toString() || '';
        payload.text = form.get('text')?.toString() || form.get('body')?.toString() || '';
        payload.html = form.get('html')?.toString() || '';
        payload.messageId = form.get('message-id')?.toString() || form.get('messageId')?.toString() || '';
        payload.raw = form.get('raw')?.toString() || '';
        // attachments metadata
        const attachments: any[] = [];
        const anyForm = form as any;
        if (typeof anyForm.entries === 'function') {
          for (const entry of anyForm.entries()) {
            const [k, v] = entry as [string, any];
            if (v && typeof v.arrayBuffer === 'function') {
              const file = v as any;
              attachments.push({ field: k, name: file.name, size: file.size, type: file.type });
            }
          }
        } else {
          const maybeAttach = anyForm.get ? (anyForm.get('attachment') || anyForm.get('attachments')) : null;
          if (maybeAttach && typeof maybeAttach.arrayBuffer === 'function') {
            const file = maybeAttach as any;
            attachments.push({ field: 'attachment', name: file.name, size: file.size, type: file.type });
          }
        }
        payload.attachments = attachments;
        // capture headers if sent as a field
        const headersField = form.get('headers')?.toString();
        if (headersField) {
          try { payload.headers = JSON.parse(headersField); } catch { payload.headers = headersField; }
        }
      }
    } catch (e) {
      return new Response('Invalid payload', { status: 400 });
    }

    // Persist into D1
    const id = crypto.randomUUID();
    const received_at = new Date().toISOString();

    const insertSql = `INSERT INTO emails (id, received_at, message_id, sender, recipients, cc, bcc, subject, text_body, html_body, headers, attachments, raw, size, subdomain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
    const stmt = db.prepare(insertSql);

    const recipients = payload.to || '';
    const size = payload.size || 0;
    try {
      const params = [
        id,
        received_at,
        payload.messageId || '',
        payload.from || '',
        recipients,
        payload.cc || '',
        payload.bcc || '',
        payload.subject || '',
        payload.text || '',
        payload.html || '',
        JSON.stringify(payload.headers || {}),
        JSON.stringify(payload.attachments || []),
        payload.raw || '',
        size,
        subdomain,
      ];

      const placeholderCount = (insertSql.match(/\?/g) || []).length;
      console.log('D1 INSERT starting', { id, received_at, subdomain, messageId: payload.messageId, placeholderCount, paramsLength: params.length });
      if (placeholderCount !== params.length) {
        console.error('D1 INSERT parameter count mismatch', { placeholderCount, paramsLength: params.length });
        return new Response('Internal Server Error', { status: 500 });
      }

      const res = await stmt.bind(...params).run();
      console.log('D1 INSERT result', res);
      return new Response(JSON.stringify({ ok: true, id, res }), { status: 201, headers: { 'content-type': 'application/json' } });
    } catch (e) {
      console.error('D1 INSERT error', e);
      return new Response('Internal Server Error', { status: 500 });
    }
  }
,

  // Handle incoming emails from Email Routing
  async email(message: any, env: Env, ctx: any) {
    try {
      // Quick diagnostics: ensure the D1 binding is present in `env`.
      if (!env || !env.SERVICES_EMAIL) {
        console.error('email() handler: D1 binding `SERVICES_EMAIL` missing on env', Object.keys(env || {}));
        return;
      }
      const toField = Array.isArray(message.to) ? (message.to[0] || '') : (message.to || '');
      const fromField = message.from || '';
      const subject = message.subject || '';
      const text = message.text || '';
      const html = message.html || '';
      const headers = message.headers || {};
      const attachments = message.attachments || [];

      const host = toField.split('@')[1] || '';
      const subdomain = subdomainFromHost(host);
      const db = selectDbForSubdomain(subdomain, env);

      const id = crypto.randomUUID();
      const received_at = new Date().toISOString();

      const insertSql = `INSERT INTO emails (id, received_at, message_id, sender, recipients, cc, bcc, subject, text_body, html_body, headers, attachments, raw, size, subdomain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;
      const stmt = db.prepare(insertSql);

      const messageId = message.messageId || message['message-id'] || '';
      const recipients = toField || '';
      const size = message.size || 0;

      // Helper to read ReadableStream to string when present
      async function streamToString(s: any) {
        try {
          if (!s) return '';
          // Use Response to consume a ReadableStream or other body-like object
          return await new Response(s).text();
        } catch (err) {
          return '';
        }
      }

      // Sanitize attachments: keep only metadata to avoid streaming binary into D1
      const sanitizedAttachments = Array.isArray(attachments)
        ? attachments.map((a: any) => ({ name: a && a.name ? a.name : a.filename || null, size: a && a.size ? a.size : null, type: a && a.type ? a.type : null }))
        : [];

      // Ensure raw is a string (Email Routing may supply a ReadableStream)
      let rawString = '';
      if (typeof message.raw === 'string') {
        rawString = message.raw;
      } else if (message.raw && (typeof message.raw.getReader === 'function' || typeof message.raw.stream === 'function')) {
        rawString = await streamToString(message.raw);
      } else if (message.raw && typeof message.raw === 'object') {
        // fallback: try Response
        rawString = await streamToString(message.raw);
      }

      // If some fields are missing, try to parse headers from raw and merge
      const parsedFromRaw = parseEmailHeaders(rawString || '');
      const mergedHeaders = Object.assign({}, headers || {}, parsedFromRaw || {});
      const finalFrom = fromField || parsedFromRaw['from'] || '';
      const finalSubject = subject || parsedFromRaw['subject'] || '';
      const finalMessageId = messageId || parsedFromRaw['message-id'] || parsedFromRaw['message-id'] || '';
      const finalRecipients = recipients || parsedFromRaw['to'] || '';

      try {
        const params = [
          id,
          received_at,
          finalMessageId,
          finalFrom,
          finalRecipients,
          message.cc || parsedFromRaw['cc'] || '',
          message.bcc || parsedFromRaw['bcc'] || '',
          finalSubject,
          text,
          html,
          JSON.stringify(mergedHeaders || {}),
          JSON.stringify(sanitizedAttachments || []),
          rawString || '',
          size,
          subdomain,
        ];
        const placeholderCount = (insertSql.match(/\?/g) || []).length;
        console.log('email() D1 INSERT starting', { id, received_at, subdomain, messageId, placeholderCount, paramsLength: params.length });
        if (placeholderCount !== params.length) {
          console.error('email() D1 parameter count mismatch', { placeholderCount, paramsLength: params.length });
        } else {
          const res = await stmt.bind(...params).run();
          console.log('email() D1 INSERT result', { id, res });
        }
      } catch (innerErr) {
        const ie: any = innerErr;
        console.error('email() D1 INSERT failed', ie && ie.message ? ie.message : ie, ie && ie.stack ? ie.stack : 'no-stack');
      }
    } catch (e) {
      console.error('email() handler error', e);
    }
  }
}
