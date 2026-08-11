// GET  /api/events            -> 公開中イベント一覧(誰でも取得可)
// GET  /api/events (管理者)    -> 全イベント(X-Admin-Passcode ヘッダーが必要)
// POST /api/events             -> 作成/更新(要パスコード)
// DELETE /api/events?id=xxx    -> 削除(要パスコード)

function isAdmin(request, env) {
  const passcode = request.headers.get('X-Admin-Passcode');
  return !!passcode && !!env.ADMIN_PASSCODE && passcode === env.ADMIN_PASSCODE;
}

const PUBLIC_FIELDS = ['id','eyebrow','title','intro','dateLine','venueLine','timeslots','successTitle','successText'];

export async function onRequestGet(context) {
  const { request, env } = context;
  const raw = await env.EVENTS_KV.get('events');
  let events = raw ? JSON.parse(raw) : [];

  if (!isAdmin(request, env)) {
    events = events
      .filter(e => e.published)
      .map(e => Object.fromEntries(PUBLIC_FIELDS.map(k => [k, e[k]])));
  }

  return new Response(JSON.stringify(events), {
    headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }
  });
}

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!isAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const body = await request.json();
  if (!body.title || !body.title.trim()) {
    return new Response(JSON.stringify({ error: 'title is required' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

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
  return new Response(JSON.stringify({ ok: true, id: body.id }), { headers: { 'Content-Type': 'application/json' } });
}

export async function onRequestDelete(context) {
  const { request, env } = context;
  if (!isAdmin(request, env)) {
    return new Response(JSON.stringify({ error: 'unauthorized' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }
  const url = new URL(request.url);
  const id = url.searchParams.get('id');
  const raw = await env.EVENTS_KV.get('events');
  let events = raw ? JSON.parse(raw) : [];
  events = events.filter(e => e.id !== id);
  await env.EVENTS_KV.put('events', JSON.stringify(events));
  return new Response(JSON.stringify({ ok: true }), { headers: { 'Content-Type': 'application/json' } });
}
