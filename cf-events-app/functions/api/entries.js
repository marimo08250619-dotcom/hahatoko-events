// POST  /api/entries              -> 申込送信(誰でも可)
// GET   /api/entries?eventId=xxx  -> 一覧取得(要パスコード)
// PATCH /api/entries               -> ステータス更新(要パスコード) body: {id, status}

function isAdmin(request, env) {
  const passcode = request.headers.get('X-Admin-Passcode');
  return !!passcode && !!env.ADMIN_PASSCODE && passcode === env.ADMIN_PASSCODE;
}

export async function onRequestPost(context) {
  const { request, env } = context;
  const body = await request.json();

  if (!body.eventId || !body.name || !body.contact || !body.timeslot) {
    return new Response(JSON.stringify({ error: 'missing required fields' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  const raw = await env.EVENTS_KV.get('entries');
  const entries = raw ? JSON.parse(raw) : [];

  entries.push({
    id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
    eventId: body.eventId,
    name: String(body.name).slice(0, 200),
    contact: String(body.contact).slice(0, 200),
    timeslot: String(body.timeslot).slice(0, 200),
    note: String(body.note || '').slice(0, 2000),
    status: '未確認',
    submittedAt: new Date().toISOString()
  });

  await env.EVENTS_KV.put('entries', JSON.stringify(entries));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestGet(context) {
  const { request, env } = context;
  if (!isAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  const raw = await env.EVENTS_KV.get('entries');
  let entries = raw ? JSON.parse(raw) : [];
  if (eventId) entries = entries.filter(e => e.eventId === eventId);
  return new Response(JSON.stringify(entries), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (!isAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const body = await request.json();
  const raw = await env.EVENTS_KV.get('entries');
  let entries = raw ? JSON.parse(raw) : [];
  const idx = entries.findIndex(e => e.id === body.id);
  if (idx === -1) {
    return new Response(JSON.stringify({ error: 'not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
  }
  entries[idx].status = body.status;
  await env.EVENTS_KV.put('entries', JSON.stringify(entries));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
