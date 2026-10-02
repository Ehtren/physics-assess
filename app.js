import { IDBAdapter } from './storage.js';
import * as D from './domain.js';
const S = new IDBAdapter(), $ = s => document.querySelector(s), app = $('#app');
let view = 'tracker', cur, ctx, MSG = '', WHY = null, PL = null;
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const TABS = ['tracker', 'curriculum', 'bank', 'papers', 'student', 'marking', 'data'];
const save = (name, obj) => { const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([JSON.stringify(obj, null, 1)], { type: 'application/json' })); a.download = name; a.click(); };
const readFile = f => f.text().then(JSON.parse);
const LABEL = { tracker: 'Home', curriculum: 'Curriculum', bank: 'Questions', papers: 'Papers', student: 'Do a paper', marking: 'Marking', data: 'Backup & files' };
const TOPICS = { 1: 'Motion, forces and energy', 2: 'Thermal physics', 3: 'Waves', 4: 'Electricity and magnetism', 5: 'Nuclear physics', 6: 'Space physics' };
const GROUPS = { '1.5': 'Forces', '1.7': 'Energy, work and power', '2.1': 'Kinetic particle model of matter', '2.2': 'Thermal properties and temperature', '2.3': 'Transfer of thermal energy', '3.2': 'Light', '4.2': 'Electrical quantities', '4.3': 'Electric circuits', '4.5': 'Electromagnetic effects', '5.1': 'The nuclear model of the atom', '5.2': 'Radioactivity', '6.1': 'The Earth and the Solar System', '6.2': 'Stars and the Universe' };
const OPEN = new Set(); // keeps opened sections open after each click
document.addEventListener('toggle', e => { const k = e.target.dataset?.k; if (k) e.target.open ? OPEN.add(k) : OPEN.delete(k); }, true);
const op = k => `data-k="${k}" ${OPEN.has(k) ? 'open' : ''}`;
async function render() {
  cur = await S.get('cur', 'cur'); ctx = await D.context(S);
  $('#nav').innerHTML = TABS.map(t => `<button data-a=tab data-v=${t} ${t == view ? 'class=on' : ''}>${LABEL[t]}</button>`).join('');
  app.innerHTML = (MSG ? `<p class=msg>${esc(MSG)}</p>` : '') + (cur || view == 'data' || view == 'student' ? await V[view]() : '<p>Load the Physics curriculum JSON in the <b>data</b> tab first.</p>'); MSG = '';
}
const V = {
  async tracker() {
    const E = await D.evidence(S, cur), T = await D.teacherStatus(S, ctx), taught = new Set((await S.all('teach')).map(t => t.section));
    if (WHY) return why(E[WHY]);
    const decl = ['1.1', '1.2', '1.3', '1.4', '1.5.1', '1.5.2', '1.5.3'];
    const qa = await S.all('question'), aa = await S.all('assign'), at = await S.all('attempt'), steps = [['Load the curriculum file (Data tab)', true], ['Import the question pack (Bank tab)', qa.length > 0], ['Record what you have taught (box at the bottom of this page)', taught.size > 0], ['Review and approve questions (Bank tab)', qa.some(q => q.stage == 'teacher_approved')], ['Build, approve and assign a paper (Papers tab)', aa.length > 0], ['Student does the paper (Student tab)', at.length > 0]], next = steps.find(x => !x[1]);
    const check = `<div class=card><b>Setup checklist</b><br>${steps.map(x => (x[1] ? '✅ ' : '⬜ ') + x[0]).join('<br>')}<br><b>${next ? 'Next: ' + next[0] : 'All done. Mark written answers in the Marking tab, then press Why? on a unit.'}</b></div>`;
    return check + `<h3>Tracker (${esc(ctx.studentName)})</h3><p><small>Green count = units you set Green: <b>${Object.values(T).filter(t => t.teacher_status == 'green').length} / ${cur.units.length}</b>. The engine only recommends.</small></p><table><tr><th>Unit<th>Your status<th>Recommendation<th>Set status<th></tr>` +
      cur.units.map(u => { const e = E[u.id], t = T[u.id], r = e.rec, drift = t?.teacher_status && r.s != 'none' && t.teacher_status != r.s;
        return `<tr><td>${esc(u.name)} <button data-a=rename data-v=${u.id}>rename</button><br><small>${e.taughtSections.length} sections taught</small><td>${t?.teacher_status ? `<b class="${t.teacher_status[0].toUpperCase()}">${t.teacher_status}</b>` : 'unrated'}<td>${r.s} <small>(${esc(r.r)})</small>${drift ? ' <b>review</b>' : ''}<td>${!e.taughtSections.length ? '<small>not taught yet</small>' : ['red', 'yellow', 'green', ''].map(s => `<button data-a=status data-v=${u.id} data-s="${s}">${s || 'clear'}</button>`).join('')}<td><button data-a=why data-v=${u.id}>Why?</button></tr>`; }).join('') + `</table>
      <details class=card ${taught.size ? '' : 'open'}><summary><b>Record what you have taught</b></summary><p><small>The ticked boxes are only a suggestion from your declared scope. <b>Nothing is recorded until you press Save.</b> Leave the date blank if you do not know it.</small></p>${cur.secs.filter(s => s.unit == 'PHY-U1').map(s => `<label><input type=checkbox class=ts value="${s.code}" ${taught.has(s.code) ? 'disabled checked' : decl.includes(s.code) ? 'checked' : ''}> ${s.code} ${esc(s.title)}</label><br>`).join('')}<p>Start date (optional) <input type=date id=tdate> <button data-a=teach>Save teaching events</button></p></details>`;
  },
  async curriculum() {
    const sec = s => `<details class=sub ${op('c' + s.code)}><summary>${s.code} ${esc(s.title)} <small>· ${s.core} core / ${s.supp} supp</small></summary><ul>${cur.objs.filter(o => o.section == s.code).map(o => `<li><small>${o.code.split(':')[1]} ${o.tier == 'core' ? 'Core' : 'Supp'}</small> ${esc(o.label)}`).join('')}</ul></details>`;
    return `<h3>Curriculum</h3><p>Cambridge Physics 0625 (2026-28). Open a topic, then a section, then see its learning objectives. Core = everyone, Supp = Extended only.</p>` + Object.keys(TOPICS).map(t => {
      const ss = cur.secs.filter(s => s.code.split('.')[0] == t), seen = new Set(), out = [], u = cur.units.find(x => x.id == 'PHY-U' + t);
      for (const s of ss) { const p = s.code.split('.'); if (p.length == 2) { out.push(sec(s)); continue; } const g = p[0] + '.' + p[1]; if (seen.has(g)) continue; seen.add(g); const kids = ss.filter(x => x.code.startsWith(g + '.')); out.push(`<details class=sub ${op('c' + g)}><summary>${g} ${esc(GROUPS[g] || '')} <small>· ${kids.length} sections</small></summary>${kids.map(sec).join('')}</details>`); }
      return `<details class=card ${op('c' + t)}><summary><b>${t} ${TOPICS[t]}</b> <small>· ${ss.reduce((n, s) => n + s.n, 0)} objectives · tracker unit: ${esc(u?.name || '')}</small></summary>${out.join('')}</details>`;
    }).join('');
  },
  async bank() {
    const qs = (await S.all('question')).sort((a, b) => a.code < b.code ? -1 : 1), M = Object.fromEntries(cur.objs.map(o => [o.code, o])), L = ['familiar', 'slightly unfamiliar', 'unfamiliar'];
    const ST = { draft: 'draft', structurally_validated: 'system checks passed', content_reviewed: 'reviewed by you', teacher_approved: 'approved', retired: 'retired' };
    const card = q => {
      const errs = D.validateQ(cur, q);
      const ans = q.fmt == 'mcq' ? `<ol type=A>${q.opts.map((o, i) => `<li ${i == q.key ? 'class=G' : ''}>${esc(o)}${i == q.key ? ' ✓ correct answer' : ''}`).join('')}</ol>` : q.fmt == 'numeric' ? `<p>Correct answer: <b>${q.num.v} ${esc(q.num.u || '')}</b> (accepts ±${q.num.tol}). Recompute check: <code>${esc(q.chk || 'none')}</code></p>` : '';
      const next = { draft: `<button data-a=adv data-v=${q.id} data-to=structurally_validated>1. Run automatic checks</button>`, structurally_validated: `<label><input type=checkbox id=sc${q.id}> I checked the question, answer, mark scheme and tags</label> <button data-a=adv data-v=${q.id} data-to=content_reviewed>2. Mark as reviewed</button>`, content_reviewed: `<button data-a=adv data-v=${q.id} data-to=teacher_approved>3. Approve for use</button>` }[q.stage] || '';
      return `<details class=card ${op('q' + q.id)}><summary><b>${q.code}</b> ${esc(q.p.length > 70 ? q.p.slice(0, 70) + '…' : q.p)} <small>· ${q.marks} mark${q.marks > 1 ? 's' : ''} · ${q.fmt}</small> <span class=tag>${ST[q.stage]}</span></summary>
      <p>${esc(q.p)}</p>${ans}<b>Mark scheme</b><ul>${(q.sch || []).map(s => `<li>${esc(s.t)} <small>(${s.m})</small>`).join('')}</ul><p><b>Feedback in learning mode:</b> ${esc(q.fb || '(none)')}</p>
      <p><b>Tags:</b> ${q.ao} · ${q.dim} · command word "${q.cw}" · ${q.diff} · ${L[q.unf]} context</p><b>Syllabus objectives</b><ul>${q.o.map(c => `<li><small>${c.split(':')[1]} ${M[c]?.tier || ''}</small> ${esc(M[c]?.label || 'UNKNOWN OBJECTIVE')}`).join('')}</ul>
      <p><small>Source: <span class=tag>${q.source_type.replace('_', ' ')}</span> · code ${q.code} · version ${q.version} · ${esc(q.prov?.generator || '')}</small></p>
      <p class=${errs.length ? 'R' : 'G'}>${errs.length ? 'Automatic checks failed: ' + errs.map(e => e.id + ' ' + esc(e.msg)).join('; ') : '✓ Passes the automatic checks'}</p><p>${next} ${q.stage != 'retired' ? `<button data-a=adv data-v=${q.id} data-to=retired>Retire</button>` : ''}</p></details>`;
    };
    const grp = (t, f) => { const x = qs.filter(f); return x.length ? `<h4>${t} (${x.length})</h4>${x.map(card).join('')}` : ''; };
    return `<h3>Questions</h3><p>Your question library. Every new question starts as a <b>draft</b>. Open one, read it with its answer, mark scheme and tags, then move it forward. Only <b>approved</b> questions can go into a paper.</p><p><input type=file data-f=pack accept=.json> <small>add questions (starter-pack-unit1.json)</small></p>` + (qs.length ? grp('Needs your review', q => !['teacher_approved', 'retired'].includes(q.stage)) + grp('Approved', q => q.stage == 'teacher_approved') + grp('Retired', q => q.stage == 'retired') : '<p><b>No questions yet.</b> Choose the starter pack file above.</p>');
  },
  async papers() {
    const ps = await S.all('paper'), n = (await S.all('question')).filter(q => q.stage == 'teacher_approved').length;
    return `<h3>Papers</h3><p>Build a paper from approved questions, check it, approve it, then assign it to your student.</p><div class=card><b>Blueprint</b> (${n} approved questions available)${n ? '' : '<br><b>You need approved questions first (Bank tab).</b>'}<br>Name <input id=bn value="Unit 1 practice"> Marks <input id=bm type=number value=10 style="width:60px"> Minutes <input id=bt type=number value=12 style="width:60px"> Exposure <select id=be><option value=unseen>unseen only</option><option value=any>any</option></select><br>${cur.units.map(u => `<label><input type=checkbox class=bu value=${u.id} ${u.id == 'PHY-U1' ? 'checked' : ''}> ${esc(u.name)}</label> `).join('')}<br><button data-a=assemble>Assemble paper</button> <small>Hard constraints are never relaxed; you get a shortfall message instead.</small></div>` +
      (await Promise.all(ps.map(async p => { const r = await D.validatePaper(S, cur, p), qs = await Promise.all(p.items.map(i => S.get('question', i)));
        return `<div class=card><b>${esc(p.name)}</b> <span class=tag>${p.stage}</span> · ${p.bp.marks} marks, ${p.bp.minutes} min<br><small>${qs.map(q => `${q.code} (${q.marks}, ${q.ao}, ${q.dim}, ${q.diff}, ${q.source_type})`).join('<br>')}</small><br><details><summary class=${r.every(x => x.ok) ? 'G' : 'R'}>${r.filter(x => x.ok).length}/${r.length} automatic checks pass</summary>${r.map(x => `<small class=${x.ok ? 'G' : 'R'}>${x.id} ${x.ok ? 'pass' : 'FAIL'}: ${esc(x.msg)}</small>`).join('<br>')}</details>${{ draft: `<button data-a=padv data-v=${p.id} data-to=structurally_validated>Validate</button>`, structurally_validated: `<button data-a=padv data-v=${p.id} data-to=teacher_approved>Approve paper</button>`, teacher_approved: `<button data-a=padv data-v=${p.id} data-to=assigned>Assign to student</button>`, assigned: `<button data-a=exportpack data-v=${p.id}>Export student pack</button>` }[p.stage]}</div>`; }))).join('');
  },
  async student() {
    if (PL?.done) return `<h3>Submitted</h3><p>${PL.msg ? PL.msg : PL.mode == 'exam' ? 'Your answers were submitted. Results are not shown in exam mode.' : PL.html}</p><button data-a=endplay>Back</button>`;
    if (PL) return `<h3>${esc(PL.pack.name)} <small>(${PL.mode} mode, ${PL.pack.minutes} min)</small></h3>` + PL.pack.items.map((q, i) => `<div class=card><b>${i + 1}.</b> ${esc(q.p)} <small>[${q.marks}]</small><br>${q.fmt == 'mcq' ? q.opts.map((o, k) => `<label><input type=radio name=r${q.id} value=${k}> ${esc(o)}</label><br>`).join('') : q.fmt == 'numeric' ? `<input name=r${q.id}>` : `<textarea name=r${q.id} rows=3 cols=60></textarea>`}</div>`).join('') + '<button data-a=submit>Submit</button>';
    const as = await S.all('assign'), ps = await Promise.all(as.map(a => S.get('paper', a.paper)));
    return `<h3>Student</h3>${ps.length ? ps.map(p => `<div class=card>${esc(p.name)} <button data-a=play data-v=${p.id} data-m=learning>Learning mode</button> <button data-a=play data-v=${p.id} data-m=exam>Exam mode</button></div>`).join('') : '<p>No assigned papers yet. Approve and assign one in the Papers tab.</p>'}<p><input type=file data-f=pack2 accept=.json> <small>or load a student pack file</small></p>`;
  },
  async marking() {
    const at = await S.all('attempt'), aw = await S.all('award'), done = new Set(aw.map(a => a.item)), q = [];
    at.forEach(a => a.items.forEach(i => { if (!done.has(i.id)) q.push(i); }));
    return `<h3>Marking queue</h3>` + (q.length ? (await Promise.all(q.map(async i => { const qq = await S.get('question', i.qv); return `<div class=card><b>${i.snap.code}</b> ${esc(qq.p)}<br><i>${esc(i.resp) || '(no answer)'}</i><ul>${i.snap.sch.map(s => `<li>${esc(s.t)} <small>(${s.m})</small>`).join('')}</ul>Marks (0-${i.snap.marks}) <input id=m${i.id} type=number style="width:60px"> note <input id=n${i.id}> <button data-a=mark data-v=${i.id}>Save</button></div>`; }))).join('') : '<p>Nothing waiting.</p>');
  },
  async data() {
    return `<h3>Data</h3><div class=card><b>Curriculum file</b> ${cur ? '✅ loaded' : '⬜ not loaded'}<br><small>physics_0625_2026_2028_curriculum_v1.1.json (load it once)</small><br><input type=file data-f=cur accept=.json></div><div class=card><b>Answers sent by a student</b><br><small>If the student worked on their own device, load the file they sent you.</small><br><input type=file data-f=att accept=.json></div><div class=card><b>Backup</b><br><small>Your data lives only in this browser. Download a backup after every session.</small><br><button data-a=backup>Download backup</button> &nbsp; Restore: <input type=file data-f=restore accept=.json></div>`;
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
    const j = await readFile(e.target.files[0]); e.target.value = '';
    if (f == 'cur') { await D.importCurriculum(S, j); MSG = 'Curriculum imported.'; }
    if (f == 'pack') { const r = await D.importPack(S, j); MSG = `${r.added} new, ${r.updated} updated, ${r.same} unchanged. New and updated questions are drafts: nothing reaches the student until you approve it.`; }
    if (f == 'pack2') { PL = { pack: j, mode: 'exam' }; view = 'student'; }
    if (f == 'att') { for (const r of j) await D.markAttempt(S, cur, ctx, r); MSG = `Imported ${j.length} attempts.`; }
    if (f == 'restore') { await S.importAll(j); MSG = 'Restored.'; }
  } catch (x) { MSG = 'Import failed: ' + x.message; }
  render();
});
render();
