// Domain logic. Talks only to a storage adapter S (see storage.js). No DOM, no IndexedDB.
export const uuid4 = () => crypto.randomUUID();
const NS = '6ba7b810-9dad-11d1-80b4-00c04fd430c8';
export async function uuid5(name, ns = NS) { // deterministic ids for curriculum records
  const nb = ns.replace(/-/g, '').match(/../g).map(x => parseInt(x, 16));
  const d = new Uint8Array(await crypto.subtle.digest('SHA-1', new Uint8Array([...nb, ...new TextEncoder().encode(name)]))).slice(0, 16);
  d[6] = d[6] & 15 | 80; d[8] = d[8] & 63 | 128;
  const h = [...d].map(b => b.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}
const hash = s => { let h = 5381; for (const c of s) h = (h * 33 ^ c.charCodeAt(0)) >>> 0; return h.toString(16); };
const now = () => new Date().toISOString();
export const DIMS = ['knowledge', 'calculation', 'application', 'data', 'practical'];
// Mastery ruleset v1 (as agreed in architecture spec D)
export const RULES = { v: 1, minMarks: 8, minQ: 3, minDays: 2, strong: 80, weak: 50, early: { marks: 4, q: 2 }, last: { n: 3, floor: 60, max: 1 }, cov: 0.8, unseenApp: 2, auth: { marks: 6, pct: 70 } };
const FMT = ['mcq', 'numeric', 'short', 'explain'], DIFF = ['basic', 'medium', 'hard'];

export async function context(S) {
  let c = await S.get('kv', 'ctx');
  if (!c) { c = { id: 'ctx', teacher: uuid4(), student: uuid4(), studentName: 'Student 1', enrolment: uuid4(), waivers: {} }; await S.put('kv', c); }
  return c;
}
export async function importCurriculum(S, j) {
  const objs = [];
  for (const s of j.sections) for (const o of s.objectives)
    objs.push({ code: o.id, uid: await uuid5(j.meta.syllabus_id + '|' + o.id), section: s.code, unit: s.unit, tier: o.tier, label: o.label, action: o.objective_action, meta: o.assessment_metadata });
  await S.put('cur', { id: 'cur', syllabus: j.meta, units: j.tracker_units.map(u => ({ id: u.id, name: u.default_label, sections: u.sections, required: u.required_dimensions_default })),
    secs: j.sections.map(s => ({ code: s.code, title: s.title, unit: s.unit, n: s.n_objectives, core: s.n_core, supp: s.n_supplement })), objs, specs: j.paper_specs, commandWords: j.vocab.command_words.map(w => w.word) });
}
const maps = new WeakMap();
const om = cur => maps.get(cur) || (maps.set(cur, Object.fromEntries(cur.objs.map(o => [o.code, o]))), maps.get(cur));
export const unitOf = (cur, q) => om(cur)[q.o[0]]?.unit;
export const sectionOf = (cur, q) => om(cur)[q.o[0]]?.section;

// ---- teaching events (teacher-declared; date may be unknown) ----
export async function addTeaching(S, ctx, sections, date) {
  for (const s of sections) await S.put('teach', { id: uuid4(), student: ctx.student, section: s, kind: 'taught', date: date || null, date_status: date ? 'known' : 'unknown', by: 'teacher', at: now() });
}
// ---- question bank ----
export async function importPack(S, pack) {
  const have = {}; (await S.all('question')).forEach(q => { if (q.stage !== 'retired' && (!have[q.code] || q.version > have[q.code].version)) have[q.code] = q; });
  let added = 0, updated = 0, same = 0;
  for (const q of pack.questions) {
    const h = hash(JSON.stringify(q)), old = have[q.code], base = { stage: 'draft', source_type: 'ai_generated', prov: { generator: pack.generator, spec: pack.spec }, hash: h, ...q, created: now() };
    if (!old) { await S.put('question', { id: uuid4(), version: 1, ...base }); added++; }
    else if (old.hash === h) same++;
    else if (old.stage === 'draft') { await S.put('question', { ...base, id: old.id, version: old.version }); updated++; }
    else { old.stage = 'retired'; await S.put('question', old); await S.put('question', { id: uuid4(), ...base, version: old.version + 1 }); updated++; }
  }
  return { added, updated, same };
}
export function validateQ(cur, q) {
  const e = [], add = (id, msg) => e.push({ id, msg }), M = om(cur);
  if ((q.sch || []).reduce((s, x) => s + x.m, 0) !== q.marks) add('V02', 'marking points do not sum to marks');
  if (q.fmt === 'mcq' && !(q.opts?.length === 4 && Number.isInteger(q.key) && q.key >= 0 && q.key < 4)) add('V03', 'MCQ needs 4 options and one valid key');
  if (q.fmt === 'numeric') {
    if (!(isFinite(q.num?.v) && q.num.tol >= 0)) add('V03', 'numeric key/tolerance invalid');
    else if (!q.chk) add('V04', 'no recompute expression');
    else { let v; try { v = Function('"use strict";return (' + q.chk + ')')(); } catch { v = NaN; } if (!(Math.abs(v - q.num.v) <= q.num.tol)) add('V04', `recomputed ${v}, key ${q.num.v}`); }
  }
  if ((q.fmt === 'short' || q.fmt === 'explain') && !(q.sch || []).length) add('V03', 'no marking points');
  if (!q.o?.length || q.o.some(c => !M[c])) add('V05', 'objective missing or unknown');
  if (!FMT.includes(q.fmt) || !['AO1', 'AO2'].includes(q.ao) || !DIMS.includes(q.dim) || !DIFF.includes(q.diff) || ![0, 1, 2].includes(q.unf) || !cur.commandWords.includes(q.cw)) add('V06', 'invalid tag value');
  if (q.source_type === 'ai_generated' && !(q.prov?.generator && q.prov?.spec)) add('V10', 'provenance incomplete');
  return e;
}
const ORDER = ['draft', 'structurally_validated', 'content_reviewed', 'teacher_approved'];
export async function advanceQ(S, cur, q, to, science) {
  if (to === 'retired') q.stage = 'retired';
  else {
    if (ORDER.indexOf(to) !== ORDER.indexOf(q.stage) + 1) throw Error('stages must be taken in order');
    if (to === 'structurally_validated') { const e = validateQ(cur, q); if (e.length) throw Error(e.map(x => x.id + ' ' + x.msg).join('; ')); }
    if (to === 'content_reviewed' && !science) throw Error('confirm you checked the science and mark scheme');
    q.stage = to;
  }
  await S.put('question', q); await S.put('review', { id: uuid4(), q: q.id, to, science: !!science, at: now() });
}
// ---- blueprint, assembler, paper validation ----
export async function assemble(S, cur, bp) {
  const seen = new Set(); (await S.all('attempt')).forEach(a => (a.items || []).forEach(i => seen.add(i.snap.code)));
  const c = (await S.all('question')).filter(q => q.stage === 'teacher_approved' && bp.units.includes(unitOf(cur, q)) && (bp.exposure !== 'unseen' || !seen.has(q.code))).sort((a, b) => a.code < b.code ? -1 : 1);
  const pick = (i, left, acc) => left === 0 ? acc : i >= c.length ? null : (c[i].marks <= left && pick(i + 1, left - c[i].marks, [...acc, c[i]])) || pick(i + 1, left, acc);
  const r = pick(0, bp.marks, []);
  if (!r) return { ok: false, msg: `Cannot make exactly ${bp.marks} marks from ${c.length} approved eligible questions (${c.reduce((s, q) => s + q.marks, 0)} marks available). Nothing was relaxed.` };
  const p = { id: uuid4(), name: bp.name, bp, items: r.map(q => q.id), stage: 'draft', created: now() };
  await S.put('paper', p); return { ok: true, paper: p };
}
export async function validatePaper(S, cur, p) {
  const qs = await Promise.all(p.items.map(id => S.get('question', id))), seen = new Set(); (await S.all('attempt')).forEach(a => (a.items || []).forEach(i => seen.add(i.snap.code)));
  const pack = JSON.stringify(studentPackOf(qs)), r = [], chk = (id, ok, msg) => r.push({ id, ok, msg });
  chk('V01', qs.reduce((s, q) => s + q.marks, 0) === p.bp.marks, 'marks sum to target');
  chk('V07', qs.every(q => p.bp.units.includes(unitOf(cur, q)) && q.stage === 'teacher_approved'), 'all items approved and in scope');
  chk('V08', p.bp.minutes >= 0.9 * p.bp.marks, `time ${p.bp.minutes} min for ${p.bp.marks} marks`);
  chk('V09', p.bp.exposure !== 'unseen' || qs.every(q => !seen.has(q.code)), 'exposure policy');
  chk('V10', qs.every(q => q.source_type && q.prov), 'provenance present');
  chk('V11', new Set(qs.map(q => q.code)).size === qs.length, 'no duplicates');
  chk('V12', !/"(key|sch|num|chk|fb)"/.test(pack), 'student pack has no keys, schemes or feedback');
  return r;
}
const studentPackOf = qs => qs.map(q => ({ id: q.id, code: q.code, fmt: q.fmt, p: q.p, opts: q.opts, marks: q.marks }));
export async function studentPack(S, p) { return { paper: p.id, name: p.name, minutes: p.bp.minutes, items: studentPackOf(await Promise.all(p.items.map(id => S.get('question', id)))) }; }
export async function advanceP(S, cur, p, to, ctx) {
  const O = ['draft', 'structurally_validated', 'teacher_approved', 'assigned'];
  if (O.indexOf(to) !== O.indexOf(p.stage) + 1) throw Error('paper stages must be taken in order');
  if (to === 'structurally_validated') { const r = (await validatePaper(S, cur, p)).filter(x => !x.ok); if (r.length) throw Error(r.map(x => x.id + ' ' + x.msg).join('; ')); }
  p.stage = to; await S.put('paper', p);
  if (to === 'assigned') await S.put('assign', { id: uuid4(), student: ctx.student, paper: p.id, at: now() });
}
// ---- attempts and marking ----
export async function markAttempt(S, cur, ctx, raw) { // raw = { paper, mode, responses:{qid:val}, submitted }
  const p = await S.get('paper', raw.paper), prior = (await S.all('attempt')).filter(a => a.submitted < raw.submitted), seen = new Set(); prior.forEach(a => a.items.forEach(i => seen.add(i.snap.code)));
  const taught = new Set((await S.all('teach')).filter(t => t.student === ctx.student).map(t => t.section)), items = [], awards = [];
  for (const qid of p.items) {
    const q = await S.get('question', qid), r = raw.responses[qid], it = { id: uuid4(), qv: q.id, resp: r ?? '', seen: seen.has(q.code),
      snap: { code: q.code, version: q.version, hash: q.hash, fmt: q.fmt, marks: q.marks, ao: q.ao, dim: q.dim, unf: q.unf, diff: q.diff, source_type: q.source_type, obj: q.o, unit: unitOf(cur, q), section: sectionOf(cur, q), sch: q.sch, taught: taught.has(sectionOf(cur, q)), mode: raw.mode } };
    let m = null;
    if (q.fmt === 'mcq') m = r !== '' && r != null && Number(r) === q.key ? q.marks : 0;
    if (q.fmt === 'numeric') m = Math.abs(parseFloat(String(r).replace(',', '.')) - q.num.v) <= q.num.tol ? q.marks : 0;
    if (m !== null) awards.push({ id: uuid4(), item: it.id, marks: m, by: 'auto', confirmed: true, at: now() });
    items.push(it);
  }
  const a = { id: uuid4(), student: ctx.student, paper: raw.paper, mode: raw.mode, submitted: raw.submitted, items };
  await S.put('attempt', a); await S.putMany('award', awards); return a;
}
export async function teacherMark(S, item, marks, note) {
  if (!(marks >= 0 && marks <= item.snap.marks)) throw Error('marks out of range');
  await S.put('award', { id: uuid4(), item: item.id, marks, by: 'teacher', confirmed: true, note: note || '', at: now() });
}
// ---- evidence, mastery recommendation ("why" data) ----
const st = a => ({ av: a.reduce((s, e) => s + e.av, 0), m: a.reduce((s, e) => s + e.m, 0), q: new Set(a.map(e => e.code)).size, days: new Set(a.map(e => e.day)).size });
const pct = x => x.av ? 100 * x.m / x.av : 0;
function dimState(all, first, taught) {
  if (!taught) return { state: 'not_taught' };
  const A = st(all), F = st(first), sufA = A.av >= RULES.minMarks && A.q >= RULES.minQ && A.days >= RULES.minDays, sufF = F.av >= RULES.minMarks && F.q >= RULES.minQ && F.days >= RULES.minDays;
  const last = [...first].sort((a, b) => a.t < b.t ? -1 : 1).slice(-RULES.last.n), lowLast = last.filter(e => e.av && 100 * e.m / e.av < RULES.last.floor).length;
  let state = 'insufficient';
  if (pct(A) < RULES.weak && (sufA || (A.av >= RULES.early.marks && A.q >= RULES.early.q))) state = 'weakness';
  else if (sufF && pct(F) >= RULES.strong && lowLast <= RULES.last.max) state = 'strength';
  else if (sufA) state = 'developing';
  return { state, ...A, pct: Math.round(pct(A)), firstPct: Math.round(pct(F)), firstMarks: F.av };
}
export async function evidence(S, cur) {
  const ctx = await context(S), [att, aw, teach] = await Promise.all(['attempt', 'award', 'teach'].map(s => S.all(s))), fin = {};
  aw.filter(a => a.confirmed).sort((a, b) => a.at < b.at ? -1 : 1).forEach(a => fin[a.item] = a);
  const taught = new Set(teach.filter(t => t.student === ctx.student).map(t => t.section)), ev = [];
  for (const a of att) for (const it of a.items) { const f = fin[it.id]; if (!f) continue; const s = it.snap;
    ev.push({ unit: s.unit, sec: s.section, code: s.code, dim: s.dim, unf: s.unf, m: f.marks, av: s.marks, day: a.submitted.slice(0, 10), t: a.submitted, first: !it.seen, src: s.source_type, ok: taught.has(s.section) && (a.mode === 'exam' || !it.seen) }); }
  const out = {};
  for (const u of cur.units) {
    const ts = u.sections.filter(s => taught.has(s)), qe = ev.filter(e => e.unit === u.id && e.ok), dims = {};
    for (const d of DIMS) dims[d] = dimState(qe.filter(e => e.dim === d), qe.filter(e => e.dim === d && e.first), ts.length > 0);
    const cov = ts.length ? ts.filter(s => qe.some(e => e.sec === s)).length / ts.length : 0, unseenApp = qe.filter(e => e.first && e.dim === 'application' && e.unf >= 1).length;
    const au = st(qe.filter(e => e.src.startsWith('cambridge'))), authOk = pct(au) >= RULES.auth.pct && au.av >= RULES.auth.marks, waived = ctx.waivers[u.id], blockers = [];
    u.required.forEach(d => { if (dims[d].state !== 'strength') blockers.push(`${d}: ${dims[d].state}`); });
    if (cov < RULES.cov) blockers.push(`coverage ${Math.round(cov * 100)}% of taught sections (need 80%)`);
    if (unseenApp < RULES.unseenApp) blockers.push(`unseen application items ${unseenApp}/${RULES.unseenApp}`);
    if (!authOk && !waived) blockers.push('no Cambridge-authentic evidence (waive with a note)');
    const weak = u.required.filter(d => dims[d].state === 'weakness'); let rec;
    if (!ts.length) rec = { s: 'none', r: 'not taught' };
    else if (!u.required.some(d => ['strength', 'developing', 'weakness'].includes(dims[d].state))) rec = { s: 'none', r: 'insufficient evidence' };
    else if (dims.knowledge.state === 'weakness' || weak.length >= 2) rec = { s: 'red', r: 'weakness: ' + weak.join(', ') };
    else rec = blockers.length ? { s: 'yellow', r: 'blocked' } : { s: 'green', r: 'all criteria met' };
    out[u.id] = { taughtSections: ts, dims, cov, unseenApp, authOk, waived, blockers, rec, events: qe.length, pre: ev.filter(e => e.unit === u.id && !e.ok).length };
  }
  return out;
}
export async function teacherStatus(S, ctx) {
  const m = {}; (await S.all('status')).filter(s => s.student === ctx.student).sort((a, b) => a.at < b.at ? -1 : 1).forEach(s => m[s.unit] = s); return m;
}
export async function setStatus(S, ctx, unit, status, note, rec) {
  const R = { red: 1, yellow: 2, green: 3 };
  if (status && R[status] > (R[rec.s] || 0) && !note) throw Error('a note is required when your status is above the recommendation');
  await S.put('status', { id: uuid4(), student: ctx.student, unit, teacher_status: status, note: note || '', rec_at_time: rec.s, ruleset: RULES.v, at: now() });
}
export async function waive(S, ctx, unit, note) { ctx.waivers[unit] = { note, at: now() }; await S.put('kv', ctx); }
