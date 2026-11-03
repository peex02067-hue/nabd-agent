import { createAvatar } from './avatar.js';
import {
  runAgent, getCfg, saveCfg, getMem, setMem, getSkills, setSkills, getTools, setTools, getFiles, setFiles, store, modelFor,
} from './agent.js';

const $ = id => document.getElementById(id);
const P = (window.Capacitor && window.Capacitor.Plugins) || {};
const LN = P.LocalNotifications, SR = P.SpeechRecognition, TTS = P.TextToSpeech;

// ---------------- avatar ----------------
let avatar = null;
try { avatar = createAvatar($('stage')); avatar.setSkin(getCfg().skin); }
catch (e) { $('stage').innerHTML = '<div class="fallback">🙂</div>'; }

const LABELS = { idle: 'جاهز', listening: 'أسمعك...', thinking: 'يفكر...', working: 'يعمل...', speaking: 'يتحدث...' };
function setState(s, label) { if (avatar) avatar.setState(s); $('status').textContent = label || LABELS[s] || ''; }
let moodTimer = null;
function setMood(m, holdMs = 9000) {
  if (!avatar) return;
  avatar.setMood(m);
  clearTimeout(moodTimer);
  moodTimer = setTimeout(() => avatar.setMood('neutral'), holdMs);
}

// ---------------- chat log ----------------
function add(text, cls) {
  const d = document.createElement('div');
  d.className = 'msg ' + cls;
  if (cls === 'act') d.className = 'act';
  d.textContent = text;
  $('log').appendChild(d);
  $('log').scrollTop = $('log').scrollHeight;
  return d;
}
let planEl = null;
function renderPlan(steps) {
  if (!planEl) { planEl = document.createElement('div'); planEl.className = 'plan'; $('log').appendChild(planEl); }
  const icon = { pending: '◻️', doing: '⏳', done: '✅' };
  planEl.innerHTML = '<b>الخطة</b>';
  for (const s of steps) {
    const row = document.createElement('div');
    row.className = s.status;
    row.textContent = `${icon[s.status] || '◻️'} ${s.text}`;
    planEl.appendChild(row);
  }
  $('log').scrollTop = $('log').scrollHeight;
}

// ---------------- voice ----------------
let muted = store.get('muted', false);
$('mute').textContent = muted ? '🔇' : '🔊';
const speakable = t => t.replace(/https?:\/\/\S+/g, 'رابط').replace(/[*#`_>|~]+/g, ' ').replace(/\s+/g, ' ').trim();
async function speak(text) {
  if (muted || !text) return setState('idle');
  setState('speaking');
  try {
    if (TTS) await TTS.speak({ text: speakable(text), lang: 'ar-SA', rate: 1, pitch: 1.05, volume: 1 });
    else if ('speechSynthesis' in window) {
      await new Promise(res => {
        const u = new SpeechSynthesisUtterance(speakable(text));
        u.lang = 'ar-SA'; u.onend = u.onerror = res;
        speechSynthesis.speak(u);
        setTimeout(res, 60000);
      });
    }
  } catch (_) {}
  setState('idle');
}
async function stopSpeaking() { try { if (TTS) await TTS.stop(); else if ('speechSynthesis' in window) speechSynthesis.cancel(); } catch (_) {} }

$('mic').onclick = async () => {
  if (running) return;
  await stopSpeaking();
  try {
    if (SR) {
      const p = await SR.requestPermissions();
      if (p.speechRecognition && p.speechRecognition !== 'granted') return add('أحتاج إذن الميكروفون من إعدادات الهاتف.', 'bot');
      setState('listening'); $('mic').classList.add('on');
      const r = await SR.start({ language: 'ar-SA', maxResults: 1, prompt: 'تحدث الآن', partialResults: false, popup: true });
      $('mic').classList.remove('on'); setState('idle');
      if (r && r.matches && r.matches[0]) send(r.matches[0]);
    } else {
      const W = window.SpeechRecognition || window.webkitSpeechRecognition;
      if (!W) return add('التعرف على الصوت غير متاح هنا.', 'bot');
      const rec = new W(); rec.lang = 'ar-SA';
      rec.onresult = e => send(e.results[0][0].transcript);
      rec.onend = () => { $('mic').classList.remove('on'); if (!running) setState('idle'); };
      $('mic').classList.add('on'); setState('listening'); rec.start();
    }
  } catch (_) { $('mic').classList.remove('on'); setState('idle', 'لم أسمعك'); }
};

// ---------------- approval dialog ----------------
function approve({ title, text, code }) {
  return new Promise(resolve => {
    $('ap_title').textContent = title;
    $('ap_text').textContent = text || '';
    $('ap_code').textContent = code || '';
    $('ap_code').style.display = code ? 'block' : 'none';
    $('approve').classList.add('open');
    setMood('thinking', 60000);
    const done = ok => { $('approve').classList.remove('open'); $('ap_yes').onclick = $('ap_no').onclick = null; setMood(ok ? 'happy' : 'sad', 3000); resolve(ok); };
    $('ap_yes').onclick = () => done(true);
    $('ap_no').onclick = () => done(false);
  });
}

async function scheduleNotification(id, text, due) {
  if (!LN) return;
  try {
    await LN.requestPermissions();
    await LN.schedule({ notifications: [{ id, title: getCfg().name, body: text, schedule: { at: new Date(due), allowWhileIdle: true } }] });
  } catch (e) { return 'حُفظ التذكير لكن تعذرت جدولة الإشعار: ' + e.message; }
}

// ---------------- run ----------------
let running = null;
function setBusy(b) {
  $('send').textContent = b ? '■' : '➤';
  $('send').classList.toggle('stop', b);
  $('send').title = b ? 'إيقاف' : 'إرسال';
}
function configured() {
  const c = getCfg();
  return c.provider === 'openai' ? !!c.baseUrl : !!c.key;
}

async function send(text) {
  text = (text || '').trim();
  if (!text || running) return;
  if (!configured()) { openSettings(); return add('اختر مصدر الذكاء وأضف المفتاح أو رابط الخادم أولاً.', 'bot'); }
  await stopSpeaking();
  add(text, 'me');
  $('input').value = '';
  planEl = null;
  running = new AbortController();
  setBusy(true);
  try {
    const { text: reply, mood } = await runAgent(text, {
      onThinking: () => setState('thinking'),
      onWorking: () => setState('working'),
      onActivity: label => add(label, 'act'),
      onText: t => t && add(t, 'mid'),
      onPlan: renderPlan,
      approve,
      scheduleNotification,
    }, running.signal);
    setMood(mood);
    add(reply, 'bot');
    running = null; setBusy(false);
    await speak(reply);
  } catch (e) {
    if (e.name === 'AbortError') { add('⏹️ أوقفت المهمة.', 'act'); setMood('neutral'); }
    else { add('تعذر الإكمال: ' + e.message, 'bot'); setMood('sad', 5000); }
    setState('idle');
  } finally {
    running = null; setBusy(false);
  }
}

$('form').addEventListener('submit', e => {
  e.preventDefault();
  if (running) running.abort(); else send($('input').value);
});
$('mute').onclick = () => {
  muted = !muted; store.set('muted', muted);
  $('mute').textContent = muted ? '🔇' : '🔊';
  if (muted) stopSpeaking();
};
if (avatar) avatar.onTap = () => { if (!running) stopSpeaking(); };

// ---------------- settings ----------------
function syncProviderUI() {
  const oa = $('s_provider').value === 'openai';
  $('s_base_wrap').style.display = oa ? 'block' : 'none';
  $('s_key_hint').textContent = oa ? '(اتركه فارغاً مع Ollama المحلي)' : '';
  $('s_model').placeholder = modelFor({ provider: $('s_provider').value, model: '' });
}
$('s_provider').onchange = syncProviderUI;

function listInto(el, items, render, onDelete, onOpen) {
  el.innerHTML = '';
  if (!items.length) { el.innerHTML = '<div class="empty">لا شيء بعد</div>'; return; }
  items.forEach((it, i) => {
    const row = document.createElement('div');
    row.className = 'item';
    const span = document.createElement('span');
    span.textContent = render(it);
    row.appendChild(span);
    if (onOpen) { const b = document.createElement('button'); b.textContent = '👁️'; b.onclick = () => onOpen(it, i); row.appendChild(b); }
    const del = document.createElement('button');
    del.textContent = '🗑️';
    del.onclick = () => { onDelete(it, i); renderLists(); };
    row.appendChild(del);
    el.appendChild(row);
  });
}
function openViewer(title, body) {
  $('v_title').textContent = title;
  $('v_body').textContent = body;
  $('viewer').classList.add('open');
}
$('v_close').onclick = () => $('viewer').classList.remove('open');
$('v_share').onclick = async () => {
  const text = $('v_body').textContent;
  try { if (navigator.share) await navigator.share({ title: $('v_title').textContent, text }); else { await navigator.clipboard.writeText(text); add('📋 نُسخ إلى الحافظة.', 'act'); } }
  catch (_) {}
};

function renderLists() {
  listInto($('l_tools'), getTools(), t => `${t.name} — ${t.description}`,
    t => setTools(getTools().filter(x => x.name !== t.name)),
    t => openViewer('أداة: ' + t.name, t.description + '\n\n' + t.code));
  listInto($('l_skills'), getSkills(), s => s.title,
    s => setSkills(getSkills().filter(x => x.title !== s.title)),
    s => openViewer('مهارة: ' + s.title, s.instructions));
  const files = getFiles();
  listInto($('l_files'), Object.keys(files), p => p,
    p => { const f = getFiles(); delete f[p]; setFiles(f); },
    p => openViewer(p, getFiles()[p] || ''));
  listInto($('l_facts'), getMem().facts, f => f,
    f => { const m = getMem(); m.facts = m.facts.filter(x => x !== f); setMem(m); });
}

function openSettings() {
  const c = getCfg();
  $('s_provider').value = c.provider; $('s_base').value = c.baseUrl; $('s_key').value = c.key; $('s_model').value = c.model;
  $('s_name').value = c.name; $('s_skin').value = c.skin; $('s_ha').value = c.ha; $('s_hatoken').value = c.hatoken;
  syncProviderUI();
  renderLists();
  $('settings').classList.add('open');
}
$('gear').onclick = openSettings;
$('s_close').onclick = () => $('settings').classList.remove('open');
$('s_skin').oninput = () => avatar && avatar.setSkin($('s_skin').value);
$('s_save').onclick = () => {
  saveCfg({
    provider: $('s_provider').value, baseUrl: $('s_base').value.trim(), key: $('s_key').value.trim(), model: $('s_model').value.trim(),
    name: $('s_name').value.trim() || 'نبض', skin: $('s_skin').value, ha: $('s_ha').value.trim(), hatoken: $('s_hatoken').value.trim(),
  });
  if (avatar) avatar.setSkin(getCfg().skin);
  $('settings').classList.remove('open');
  add('تم حفظ الإعدادات.', 'act');
  setMood('happy', 2500);
};
$('s_clear_chat').onclick = () => { const m = getMem(); m.history = []; setMem(m); $('log').innerHTML = ''; add('بدأنا محادثة جديدة.', 'act'); $('settings').classList.remove('open'); };
$('s_clear_all').onclick = () => {
  if (!confirm('مسح الذاكرة والمهارات والأدوات والملفات؟ (الإعدادات تبقى)')) return;
  setMem({ facts: [], history: [] }); setSkills([]); setTools([]); setFiles({}); store.set('rems', []);
  $('log').innerHTML = ''; renderLists(); add('تم مسح كل شيء.', 'act');
};

// ---------------- reminders arriving while open ----------------
if (LN && LN.addListener) {
  LN.addListener('localNotificationReceived', n => { add('⏰ ' + n.body, 'rem'); setMood('surprised', 4000); speak('تذكير: ' + n.body); });
}

// ---------------- greeting ----------------
const c0 = getCfg();
if (configured()) add(`أهلاً من جديد! أنا ${c0.name}. اطلب مني أي مهمة: بحث، تحليل، تقارير، تذكيرات، أو تطوير أداة جديدة.`, 'bot');
else add(`أهلاً! أنا ${c0.name}. افتح ⚙️ واختر مصدر الذكاء لنبدأ.`, 'bot');
setMood('happy', 3000);
window.__nabd = { send }; // handy for testing
