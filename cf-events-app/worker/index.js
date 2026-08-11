const PUBLIC_FIELDS = ['id','eyebrow','title','intro','dateLine','venueLine','timeslots','menuOptions','successTitle','successText'];

function isAdmin(request, env) {
  const passcode = request.headers.get('X-Admin-Passcode');
  return !!passcode && !!env.ADMIN_PASSCODE && passcode === env.ADMIN_PASSCODE;
}
function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { 'Content-Type': 'application/json' } }, init));
}

async function handleEvents(request, env) {
  const url = new URL(request.url);

  if (request.method === 'GET') {
    const raw = await env.EVENTS_KV.get('events');
    let events = raw ? JSON.parse(raw) : [];
    if (!isAdmin(request, env)) {
      events = events.filter(e => e.published).map(e => Object.fromEntries(PUBLIC_FIELDS.map(k => [k, e[k]])));
    }
    return json(events);
  }

  if (request.method === 'POST') {
    if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await request.json();
    if (!body.title || !body.title.trim()) return json({ error: 'title is required' }, { status: 400 });

    const raw = await env.EVENTS_KV.get('events');
    let events = raw ? JSON.parse(raw) : [];
    if (body.id) {
      const idx = events.findIndex(e => e.id === body.id);
      if (idx > -1) events[idx] = Object.assign({}, events[idx], body);
      else events.push(body);
    } else {
      body.id = (body.title.toLowerCase().replace(/[^a-z0-9ぁ-んァ-ヶ一-龠]+/gi, '-').slice(0, 30) || 'event') + '-' + Date.now().toString(36).slice(-4);
      body.createdAt = new Date().toISOString();
      events.push(body);
    }
    await env.EVENTS_KV.put('events', JSON.stringify(events));
    return json({ ok: true, id: body.id });
  }

  if (request.method === 'DELETE') {
    if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
    const id = url.searchParams.get('id');
    const raw = await env.EVENTS_KV.get('events');
    let events = raw ? JSON.parse(raw) : [];
    events = events.filter(e => e.id !== id);
    await env.EVENTS_KV.put('events', JSON.stringify(events));
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, { status: 405 });
}

async function handleEntries(request, env) {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const body = await request.json();
    if (!body.eventId || !body.name || !body.contact || !body.timeslot) {
      return json({ error: 'missing required fields' }, { status: 400 });
    }
    const raw = await env.EVENTS_KV.get('entries');
    const entries = raw ? JSON.parse(raw) : [];
    entries.push({
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      eventId: body.eventId,
      name: String(body.name).slice(0, 200),
      contact: String(body.contact).slice(0, 200),
      timeslot: String(body.timeslot).slice(0, 200),
      menu: String(body.menu || '').slice(0, 200),
      note: String(body.note || '').slice(0, 2000),
      status: '未確認',
      submittedAt: new Date().toISOString()
    });
    await env.EVENTS_KV.put('entries', JSON.stringify(entries));
    return json({ ok: true });
  }

  if (request.method === 'GET') {
    if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
    const eventId = url.searchParams.get('eventId');
    const raw = await env.EVENTS_KV.get('entries');
    let entries = raw ? JSON.parse(raw) : [];
    if (eventId) entries = entries.filter(e => e.eventId === eventId);
    return json(entries);
  }

  if (request.method === 'PATCH') {
    if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
    const body = await request.json();
    const raw = await env.EVENTS_KV.get('entries');
    let entries = raw ? JSON.parse(raw) : [];
    const idx = entries.findIndex(e => e.id === body.id);
    if (idx === -1) return json({ error: 'not found' }, { status: 404 });
    entries[idx].status = body.status;
    await env.EVENTS_KV.put('entries', JSON.stringify(entries));
    return json({ ok: true });
  }

  return json({ error: 'method not allowed' }, { status: 405 });
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/admin-check') {
      if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
      return json({ ok: true });
    }
    if (url.pathname === '/api/events') return handleEvents(request, env);
    if (url.pathname === '/api/entries') return handleEntries(request, env);
    return env.ASSETS.fetch(request);
  }
};
