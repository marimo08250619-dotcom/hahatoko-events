const PUBLIC_FIELDS = ['id','eyebrow','title','intro','dateLine','venueLine','timeslots','menuOptions','successTitle','successText','needsLineCta','cancelPolicy'];

// リマインドを送るタイミング(イベント日までの残り日数)
const REMINDER_STAGES = [
  { key: '1ヶ月前', days: 30 },
  { key: '2週間前', days: 14 },
  { key: '前日', days: 1 }
];

function isAdmin(request, env) {
  const passcode = request.headers.get('X-Admin-Passcode');
  return !!passcode && !!env.ADMIN_PASSCODE && passcode === env.ADMIN_PASSCODE;
}
function json(data, init) {
  return new Response(JSON.stringify(data), Object.assign({ headers: { 'Content-Type': 'application/json' } }, init));
}

async function notifyLine(env, entry, eventTitle) {
  if (!env.LINE_CHANNEL_ACCESS_TOKEN || !env.LINE_NOTIFY_USER_ID) return;
  const text =
    `【新規予約】${eventTitle}\n` +
    `お名前: ${entry.name}\n` +
    `連絡先: ${entry.contact}\n` +
    `時間帯: ${entry.timeslot}\n` +
    (entry.menu ? `メニュー: ${entry.menu}\n` : '') +
    (entry.note ? `相談内容: ${entry.note}\n` : '') +
    `管理画面で確認してください。`;
  try {
    await fetch('https://api.line.me/v2/bot/message/push', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.LINE_CHANNEL_ACCESS_TOKEN
      },
      body: JSON.stringify({
        to: env.LINE_NOTIFY_USER_ID,
        messages: [{ type: 'text', text }]
      })
    });
  } catch (e) {
    console.error('LINE notify failed', e);
  }
}

// ── 追加: リマインドメール送信(Resend経由) ──────────────────────
async function sendReminderEmail(env, entry, ev, stageKey) {
  if (!env.RESEND_API_KEY || !env.FROM_EMAIL) {
    console.error('RESEND_API_KEY / FROM_EMAIL not configured');
    return false;
  }
  if (!entry.email) return false;

  const subject = `【${ev.title}】ご予約リマインド(${stageKey})`;
  const bodyLines = [
    `${entry.name} 様`,
    ``,
    `お申し込みいただいている下記イベントのリマインドです。`,
    ``,
    `■ イベント: ${ev.title}`,
    `■ 日時: ${ev.dateLine || ev.date}`,
    `■ 時間帯: ${entry.timeslot}`,
    ev.venueLine ? `■ 会場: ${ev.venueLine}` : '',
    ``,
    ev.cancelPolicy ? `【キャンセルポリシー】\n${ev.cancelPolicy}` : '',
    ``,
    ev.paymentInfo ? `【お振込先】\n${ev.paymentInfo}\n※前払いのお手続きがお済みでない場合は、期日までにお願いいたします。` : '',
    ``,
    `ご不明な点がございましたら、お気軽にお問い合わせください。`
  ].filter(Boolean);

  try {
    const res = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + env.RESEND_API_KEY
      },
      body: JSON.stringify({
        from: env.FROM_EMAIL,
        to: entry.email,
        subject,
        text: bodyLines.join('\n')
      })
    });
    if (!res.ok) {
      console.error('Resend send failed', await res.text());
      return false;
    }
    return true;
  } catch (e) {
    console.error('Resend send error', e);
    return false;
  }
}

// ── 追加: 全イベント・全申込を走査してリマインドが必要なものを送信 ──
async function runReminderSweep(env) {
  const eventsRaw = await env.EVENTS_KV.get('events');
  const events = eventsRaw ? JSON.parse(eventsRaw) : [];
  const entriesRaw = await env.EVENTS_KV.get('entries');
  const entries = entriesRaw ? JSON.parse(entriesRaw) : [];

  // 施術系イベント = キャンセルポリシーと振込先情報の両方が設定されているもの
  const targetEventIds = new Set(
    events.filter(e => e.cancelPolicy && e.paymentInfo && e.date).map(e => e.id)
  );

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  let changed = false;

  for (const entry of entries) {
    if (entry.status === 'キャンセル') continue;
    if (!targetEventIds.has(entry.eventId)) continue;

    const ev = events.find(e => e.id === entry.eventId);
    if (!ev || !ev.date) continue;

    const eventDate = new Date(ev.date + 'T00:00:00');
    const diffDays = Math.round((eventDate - today) / (1000 * 60 * 60 * 24));

    if (!entry.remindersSent) entry.remindersSent = [];

    for (const stage of REMINDER_STAGES) {
      if (diffDays !== stage.days) continue;
      if (entry.remindersSent.includes(stage.key)) continue;

      const ok = await sendReminderEmail(env, entry, ev, stage.key);
      if (ok) {
        entry.remindersSent.push(stage.key);
        changed = true;
      }
    }
  }

  if (changed) {
    await env.EVENTS_KV.put('entries', JSON.stringify(entries));
  }
}
// ──────────────────────────────────────────────────────────────

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

async function handleAvailability(request, env) {
  const url = new URL(request.url);
  const eventId = url.searchParams.get('eventId');
  if (!eventId) return json({ error: 'eventId is required' }, { status: 400 });
  const raw = await env.EVENTS_KV.get('entries');
  const entries = raw ? JSON.parse(raw) : [];
  const takenTimeslots = entries
    .filter(e => e.eventId === eventId && e.status !== 'キャンセル')
    .map(e => e.timeslot);
  return json({ takenTimeslots });
}

async function handleEntries(request, env) {
  const url = new URL(request.url);

  if (request.method === 'POST') {
    const body = await request.json();
    if (!body.eventId || !body.name || !body.contact || !body.email || !body.timeslot) {
      return json({ error: 'missing required fields' }, { status: 400 });
    }
    const raw = await env.EVENTS_KV.get('entries');
    const entries = raw ? JSON.parse(raw) : [];

    const conflict = entries.some(e =>
      e.eventId === body.eventId &&
      e.timeslot === body.timeslot &&
      e.status !== 'キャンセル'
    );
    if (conflict) {
      return json({ error: 'timeslot already taken' }, { status: 409 });
    }

    const newEntry = {
      id: Date.now().toString(36) + Math.random().toString(36).slice(2, 6),
      eventId: body.eventId,
      name: String(body.name).slice(0, 200),
      contact: String(body.contact).slice(0, 200),
      email: String(body.email || '').slice(0, 200), // 追加: リマインド送信用メールアドレス
      timeslot: String(body.timeslot).slice(0, 200),
      menu: String(body.menu || '').slice(0, 200),
      note: String(body.note || '').slice(0, 2000),
      status: '未確認',
      remindersSent: [], // 追加: 送信済みリマインドの記録
      submittedAt: new Date().toISOString()
    };
    entries.push(newEntry);
    await env.EVENTS_KV.put('entries', JSON.stringify(entries));

    const eventsRaw = await env.EVENTS_KV.get('events');
    const eventsList = eventsRaw ? JSON.parse(eventsRaw) : [];
    const ev = eventsList.find(e => e.id === body.eventId);
    await notifyLine(env, newEntry, ev ? ev.title : '(イベント名不明)');

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

    if (body.status !== undefined) entries[idx].status = body.status;

    if (body.timeslot !== undefined && body.timeslot !== entries[idx].timeslot) {
      const conflict = entries.some(e =>
        e.id !== body.id &&
        e.eventId === entries[idx].eventId &&
        e.timeslot === body.timeslot &&
        e.status !== 'キャンセル'
      );
      if (conflict) return json({ error: 'timeslot already taken' }, { status: 409 });
      entries[idx].timeslot = body.timeslot;
    }
    if (body.menu !== undefined) entries[idx].menu = body.menu;
    if (body.email !== undefined) entries[idx].email = body.email; // 追加: 管理画面からのメール修正用

    await env.EVENTS_KV.put('entries', JSON.stringify(entries));
    return json({ ok: true });
  }

  if (request.method === 'DELETE') {
    if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
    const id = url.searchParams.get('id');
    const raw = await env.EVENTS_KV.get('entries');
    let entries = raw ? JSON.parse(raw) : [];
    entries = entries.filter(e => e.id !== id);
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
    // 追加: 手動でリマインド送信をテスト実行するための管理者用エンドポイント
    if (url.pathname === '/api/run-reminders') {
      if (!isAdmin(request, env)) return json({ error: 'unauthorized' }, { status: 401 });
      await runReminderSweep(env);
      return json({ ok: true });
    }
    if (url.pathname === '/api/events') return handleEvents(request, env);
    if (url.pathname === '/api/availability') return handleAvailability(request, env);
    if (url.pathname === '/api/entries') return handleEntries(request, env);
    return env.ASSETS.fetch(request);
  },

  // 追加: Cron Trigger本体(wrangler.tomlでスケジュール設定)
  async scheduled(event, env, ctx) {
    ctx.waitUntil(runReminderSweep(env));
  }
};
