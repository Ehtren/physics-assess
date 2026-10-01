import { IDBAdapter } from './storage.js';
import * as D from './domain.js';
const S = new IDBAdapter(), $ = s => document.querySelector(s), app = $('#app');
let view = 'tracker', cur, ctx, MSG = '', WHY = null, PL = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = ['tracker', 'curriculum', 'bank', 'papers', 'student', 'marking', 'data'];
const save = (name, obj) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })); a.download = name; a.click(); };
const readFile = f => f.text().then(JSON.parse);
async function render() {
  cur = await S.get('cur', 'cur'); ctx = await D.context(S);
  $('#nav').innerHTML = TABS.map(t => `<button data-a=tab data-v=${t} ${t == view ? 'class=on' : ''}>${t}</button>`).join('');
  app.innerHTML = (MSG ? `<p class=msg>${esc(MSG)}</p>` : '') + (cur || view == 'data' || view == 'student' ? await V[view]() : '<p>Load the Physics curriculum JSON in the <b>data</b> tab first.</p>'); MSG = '';
}
const V = {
  async tracker() {
    const E = await D.evidence(S, cur), T = await D.teacherStatus(S, ctx), taught = new Set((await S.all('teach')).map(t => t.section));
    if (WHY) return why(E[WHY]);
    const decl = ['1.1', '1.2', '1.3', '1.4', '1.5.1', '1.5.2', '1.5.3'];
    return `<h3>Tracker (${esc(ctx.studentName)})</h3><p><small>Green count = units you set Green: <b>${Object.values(T).filter(t => t.teacher_status == 'green').length} / ${cur.units.length}</b>. The engine only recommends.</small></p><table><tr><th>Unit<th>Your status<th>Recommendation<th>Set status<th></tr>` +
      cur.units.map(u => { const e = E[u.id], t = T[u.id], r = e.rec, drift = t?.teacher_status && r.s != 'none' && t.teacher_status != r.s;
        return `<tr><td>${esc(u.name)} <button data-a=rename data-v=${u.id}>rename</button><br><small>${e.taughtSections.length} sections taught</small><td>${t?.teacher_status ? `<b class="${t.teacher_status[0].toUpperCase()}">${t.teacher_status}</b>` : 'unrated'}<td>${r.s} <small>(${esc(r.r)})</small>${drift ? ' <b>review</b>' : ''}<td>${['red', 'yellow', 'green', ''].map(s => `<button data-a=status data-v=${u.id} data-s="${s}">${s || 'clear'}</button>`).join('')}<td><button data-a=why data-v=${u.id}>Why?</button></tr>`; }).join('') + `</table>
      <div class=card><b>Record teaching (teacher declaration)</b><p><small>Nothing is recorded until you save. Leave date blank if unknown.</small></p>${cur.secs.filter(s => s.unit == 'PHY-U1').map(s => `<label><input type=checkbox class=ts value="${s.code}" ${taught.has(s.code) ? 'disabled checked' : decl.includes(s.code) ? 'checked' : ''}> ${s.code} ${esc(s.title)}</label><br>`).join('')}<p>Start date (optional) <input type=date id=tdate> <button data-a=teach>Save teaching events</button></p></div>`;
  },
  async curriculum() { return `<h3>Curriculum ${esc(cur.syllabus.syllabus_id)}</h3><p><small>Cambridge structure (authoritative). Tags shown in objectives are proposed metadata.</small></p>` + cur.secs.map(s => `<details><summary>${s.code} ${esc(s.title)} <small>· ${cur.units.find(u => u.id == s.unit).name} · ${s.core} core / ${s.supp} supp</small></summary><ul>${cur.objs.filter(o => o.section == s.code).map(o => `<li><small>${o.code} [${o.tier}]</small> ${esc(o.label)} <small>(proposed: ${o.meta.dimensions.join(', ')})</small>`).join('')}</ul></details>`).join(''); },
  async bank() {
    const qs = (await S.all('question')).sort((a, b) => a.code < b.code ? -1 : 1);
    return `<h3>Question bank</h3><p><input type=file data-f=pack accept=.json> <small>import a question pack</small></p><table><tr><th>Code<th>Question<th>Fmt<th>Marks<th>Stage<th></tr>` + qs.map(q => `<tr><td>${q.code}<br><span class=tag>${q.source_type.replace('_', ' ')}</span><td>${esc(q.p)}<td>${q.fmt}<td>${q.marks}<td>${q.stage}<td>${{ draft: `<button data-a=adv data-v=${q.id} data-to=structurally_validated>Run validation</button>`, structurally_validated: `<label><input type=checkbox id=sc${q.id}> I checked the science and mark scheme</label> <button data-a=adv data-v=${q.id} data-to=content_reviewed>Mark reviewed</button>`, content_reviewed: `<button data-a=adv data-v=${q.id} data-to=teacher_approved>Approve</button>` }[q.stage] || ''} ${q.stage != 'retired' ? `<button data-a=adv data-v=${q.id} data-to=retired>retire</button>` : ''}</tr>`).join('') + '</table>';
  },
  async papers() {
    const ps = await S.all('paper'), n = (await S.all('question')).filter(q => q.stage == 'teacher_approved').length;
    return `<h3>Paper builder</h3><div class=card><b>Blueprint</b> (${n} approved questions available)<br>Name <input id=bn value="Unit 1 practice"> Marks <input id=bm type=number value=10 style="width:60px"> Minutes <input id=bt type=number value=12 style="width:60px"> Exposure <select id=be><option value=unseen>unseen only</option><option value=any>any</option></select><br>${cur.units.map(u => `<label><input type=checkbox class=bu value=${u.id} ${u.id == 'PHY-U1' ? 'checked' : ''}> ${esc(u.name)}</label> `).join('')}<br><button data-a=assemble>Assemble paper</button> <small>Hard constraints are never relaxed; you get a shortfall message instead.</small></div>` +
      (await Promise.all(ps.map(async p => { const r = await D.validatePaper(S, cur, p), qs = await Promise.all(p.items.map(i => S.get('question', i)));
        return `<div class=card><b>${esc(p.name)}</b> <span class=tag>${p.stage}</span> · ${p.bp.marks} marks, ${p.bp.minutes} min<br><small>${qs.map(q => `${q.code} (${q.marks}, ${q.ao}, ${q.dim}, ${q.diff}, ${q.source_type})`).join('<br>')}</small><br>${r.map(x => `<small class=${x.ok ? 'G' : 'R'}>${x.id} ${x.ok ? 'pass' : 'FAIL'} ${esc(x.msg)}</small>`).join(' · ')}<br>${{ draft: `<button data-a=padv data-v=${p.id} data-to=structurally_validated>Validate</button>`, structurally_validated: `<button data-a=padv data-v=${p.id} data-to=teacher_approved>Approve paper</button>`, teacher_approved: `<button data-a=padv data-v=${p.id} data-to=assigned>Assign to student</button>`, assigned: `<button data-a=exportpack data-v=${p.id}>Export student pack</button>` }[p.stage]}</div>`; }))).join('');
  },
  async student() {
    if (PL?.done) return `<h3>Submitted</h3><p>${PL.msg ? PL.msg : PL.mode == 'exam' ? 'Your answers were submitted. Results are not shown in exam mode.' : PL.html}</p><button data-a=endplay>Back</button>`;
    if (PL) return `<h3>${esc(PL.pack.name)} <small>(${PL.mode} mode, ${PL.pack.minutes} min)</small></h3>` + PL.pack.items.map((q, i) => `<div class=card><b>${i + 1}.</b> ${esc(q.p)} <small>[${q.marks}]</small><br>${q.fmt == 'mcq' ? q.opts.map((o, k) => `<label><input type=radio name=r${q.id} value=${k}> ${esc(o)}</label><br>`).join('') : q.fmt == 'numeric' ? `<input name=r${q.id}>` : `<textarea name=r${q.id} rows=3 cols=60></textarea>`}</div>`).join('') + '<button data-a=submit>Submit</button>';
    const as = await S.all('assign'), ps = await Promise.all(as.map(a => S.get('paper', a.paper)));
    return `<h3>Student</h3>${ps.length ? ps.map(p => `<div class=card>${esc(p.name)} <button data-a=play data-v=${p.id} data-m=learning>Learning mode</button> <button data-a=play data-v=${p.id} data-m=exam>Exam mode</button></div>`).join('') : '<p>No assigned papers.</p>'}<p><input type=file data-f=pack2 accept=.json> <small>or load a student pack file</small></p>`;
  },
  async marking() {
    const at = await S.all('attempt'), aw = await S.all('award'), done = new Set(aw.map(a => a.item)), q = [];
    at.forEach(a => a.items.forEach(i => { if (!done.has(i.id)) q.push(i); }));
    return `<h3>Marking queue</h3>` + (q.length ? (await Promise.all(q.map(async i => { const qq = await S.get('question', i.qv); return `<div class=card><b>${i.snap.code}</b> ${esc(qq.p)}<br><i>${esc(i.resp) || '(no answer)'}</i><ul>${i.snap.sch.map(s => `<li>${esc(s.t)} <small>(${s.m})</small>`).join('')}</ul>Marks (0-${i.snap.marks}) <input id=m${i.id} type=number style="width:60px"> note <input id=n${i.id}> <button data-a=mark data-v=${i.id}>Save</button></div>`; }))).join('') : '<p>Nothing waiting.</p>');
  },
  async data() {
    return `<h3>Data</h3><div class=card>1. Curriculum JSON <input type=file data-f=cur accept=.json> ${cur ? '<small>loaded ✓</small>' : ''}</div><div class=card>2. Question pack: bank tab. 3. Student attempt file (from another device) <input type=file data-f=att accept=.json> <button data-a=expatt>Export my attempts</button></div><div class=card><button data-a=backup>Backup everything (JSON)</button> Restore <input type=file data-f=restore accept=.json></div>`;
  }
};
function why(e) {
  const u = cur.units.find(x => x.id == WHY);
  return `<button data-a=why data-v="">← back</button><h3>Why: ${esc(u.name)} → ${e.rec.s} <small>(${esc(e.rec.r)})</small></h3><p>Sections taught: ${e.taughtSections.join(', ') || 'none'} · qualifying evidence items: ${e.events} · pre-teaching or non-qualifying items (not judged): ${e.pre}</p><table><tr><th>Dimension<th>Required?<th>State<th>Marks<th>Questions<th>Days<th>%<th>% first-time</tr>${Object.entries(e.dims).map(([d, x]) => `<tr><td>${d}<td>${u.required.includes(d) ? 'yes' : 'no'}<td>${x.state}<td>${x.av ?? ''}<td>${x.q ?? ''}<td>${x.days ?? ''}<td>${x.pct ?? ''}<td>${x.firstPct ?? ''}</tr>`).join('')}</table><p>Coverage ${Math.round(e.cov * 100)}% · unseen application ${e.unseenApp}/2 · authentic evidence ${e.authOk ? 'yes' : e.waived ? 'waived: ' + esc(e.waived.note) : 'no'} <button data-a=waive data-v=${u.id}>waive with note</button></p><b>Blockers to Green</b><ul>${e.blockers.map(b => `<li>${esc(b)}`).join('') || '<li>none'}</ul><small>Ruleset v1. Re-test tracking and per-section weakness checks are not built yet.</small>`;
}
const act = {
  tab: (el) => { view = el.dataset.v; WHY = null; }, why: el => { WHY = el.dataset.v || null; },
  rename: async el => { const n = prompt('Unit name'); if (n) { cur.units.find(u => u.id == el.dataset.v).name = n; await S.put('cur', cur); } },
  status: async el => { const E = await D.evidence(S, cur), n = el.dataset.s ? prompt('Note (required if above the recommendation)') : ''; await D.setStatus(S, ctx, el.dataset.v, el.dataset.s, n, E[el.dataset.v].rec); },
  waive: async el => { const n = prompt('Why is authentic evidence waived?'); if (n) await D.waive(S, ctx, el.dataset.v, n); },
  teach: async () => { const s = [...document.querySelectorAll('.ts:checked:not(:disabled)')].map(x => x.value); await D.addTeaching(S, ctx, s, $('#tdate').value); MSG = `Recorded ${s.length} teaching events (date ${$('#tdate').value || 'unknown'}).`; },
  adv: async el => { const q = await S.get('question', el.dataset.v); await D.advanceQ(S, cur, q, el.dataset.to, document.getElementById('sc' + q.id)?.checked); },
  assemble: async () => { const r = await D.assemble(S, cur, { name: $('#bn').value, marks: +$('#bm').value, minutes: +$('#bt').value, exposure: $('#be').value, units: [...document.querySelectorAll('.bu:checked')].map(x => x.value) }); MSG = r.ok ? 'Paper drafted.' : r.msg; },
  padv: async el => { await D.advanceP(S, cur, await S.get('paper', el.dataset.v), el.dataset.to, ctx); },
  exportpack: async el => save('student-pack.json', await D.studentPack(S, await S.get('paper', el.dataset.v))),
  play: async el => { PL = { pack: await D.studentPack(S, await S.get('paper', el.dataset.v)), mode: el.dataset.m }; },
  endplay: () => { PL = null; },
  submit: async () => {
    const responses = {}; PL.pack.items.forEach(q => { const f = q.fmt == 'mcq' ? document.querySelector(`input[name=r${q.id}]:checked`) : document.querySelector(`[name=r${q.id}]`); responses[q.id] = f?.value ?? ''; });
    const raw = { paper: PL.pack.paper, mode: PL.mode, responses, submitted: new Date().toISOString() };
    if (!(await S.get('paper', PL.pack.paper))) { save('attempt-' + raw.submitted.slice(0, 10) + '.json', [raw]); PL.done = true; PL.msg = 'Your answers were saved to a file. Send that file to your teacher.'; return; }
    const a = await D.markAttempt(S, cur, ctx, raw);
    PL.done = true; if (PL.mode == 'learning') { const aw = await S.all('award'); PL.html = (await Promise.all(a.items.map(async i => { const q = await S.get('question', i.qv), f = aw.find(x => x.item == i.id); return `<p>${q.code}: ${f ? f.marks + '/' + q.marks : 'awaiting teacher marking'}<br><small>${esc(q.fb || '')}</small></p>`; }))).join(''); }
    PL.raw = raw;
  },
  mark: async el => { const id = el.dataset.v; if (document.getElementById('m' + id).value === '') throw Error('Enter a mark first'); const it = (await S.all('attempt')).flatMap(a => a.items).find(i => i.id == id); await D.teacherMark(S, it, +document.getElementById('m' + id).value, document.getElementById('n' + id).value); },
  backup: async () => save('backup.json', await S.exportAll()),
  expatt: async () => save('attempts.json', (await S.all('attempt')).map(a => ({ paper: a.paper, mode: a.mode, submitted: a.submitted, responses: Object.fromEntries(a.items.map(i => [i.qv, i.resp])) })))
};
document.addEventListener('click', async e => { const el = e.target.closest('[data-a]'); if (!el) return; try { await act[el.dataset.a](el); } catch (x) { MSG = x.message; } render(); });
document.addEventListener('change', async e => {
  const f = e.target.dataset.f; if (!f || !e.target.files[0]) return;
  try {
    const j = await readFile(e.target.files[0]);
    if (f == 'cur') { await D.importCurriculum(S, j); MSG = 'Curriculum imported.'; }
    if (f == 'pack') { await D.importPack(S, j); MSG = `Imported ${j.questions.length} draft questions. None are available to students until approved.`; }
    if (f == 'pack2') { PL = { pack: j, mode: 'exam' }; view = 'student'; }
    if (f == 'att') { for (const r of j) await D.markAttempt(S, cur, ctx, r); MSG = `Imported ${j.length} attempts.`; }
    if (f == 'restore') { await S.importAll(j); MSG = 'Restored.'; }
  } catch (x) { MSG = 'Import failed: ' + x.message; }
  render();
});
render();
