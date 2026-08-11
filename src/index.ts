export interface Env {
  SERVICES_EMAIL: any;
}

function subdomainFromHost(host: string) {
  if (!host) return '';
  const parts = host.split('.');
  // return first label as subdomain (naive but sufficient for mapping)
  return parts.length > 2 ? parts[0] : '';
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

    const stmt = db.prepare(
      `INSERT INTO emails (id, received_at, message_id, sender, recipients, cc, bcc, subject, text_body, html_body, headers, attachments, raw, size, subdomain)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    );

    const recipients = payload.to || '';
    const size = payload.size || 0;
    try {
      console.log('D1 INSERT starting', { id, received_at, subdomain, messageId: payload.messageId });
      const res = await stmt.run(
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
        subdomain
      );
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

      const stmt = db.prepare(
        `INSERT INTO emails (id, received_at, message_id, sender, recipients, cc, bcc, subject, text_body, html_body, headers, attachments, raw, size, subdomain)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      );

      const messageId = message.messageId || message['message-id'] || '';
      const recipients = toField || '';
      const size = message.size || 0;

      try {
        const res = await stmt.run(
          id,
          received_at,
          messageId,
          fromField,
          recipients,
          message.cc || '',
          message.bcc || '',
          subject,
          text,
          html,
          JSON.stringify(headers || {}),
          JSON.stringify(attachments || []),
          message.raw || '',
          size,
          subdomain
        );
        console.log('email() D1 INSERT result', { id, res });
      } catch (innerErr) {
        const ie: any = innerErr;
        console.error('email() D1 INSERT failed', ie && ie.message ? ie.message : ie, ie && ie.stack ? ie.stack : 'no-stack');
      }
    } catch (e) {
      console.error('email() handler error', e);
    }
  }
}
