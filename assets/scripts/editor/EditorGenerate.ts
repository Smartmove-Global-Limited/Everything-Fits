// "Máy chọn đồ giúp" dialog (port of the web editor src/editor/generate.js): template + seed → a
// level for the bag being edited.
import type { EditorPage } from './EditorPage';
import { $ } from './EditorPage';
import { generate, MYSTERY_ID, KEY_ID } from './logic';

export function initGenerate(app: EditorPage) {
  const poolEl = $('gPool');
  const usable = () => app.items.defs.filter(d => d.id > 0 && app.catalog.items.has(d.id));
  const checked = new Set<number>(usable().map(d => d.id));

  function refresh() {
    poolEl.innerHTML = '';
    for (const d of usable()) {
      const lab = document.createElement('label'); lab.className = checked.has(d.id) ? 'on' : '';
      const cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = checked.has(d.id);
      cb.addEventListener('change', () => { if (cb.checked) checked.add(d.id); else checked.delete(d.id); lab.classList.toggle('on', cb.checked); });
      lab.append(cb, document.createTextNode(`${d.id} · ${d.name}`));
      poolEl.appendChild(lab);
    }
  }

  function template(): any {
    const L = app.level;
    return {
      id: L.id, name: L.name, timer: +$('gTimer').value || 90, background: L.background,
      seed: +$('gSeed').value || 1, tier: $('gTier').value || null,
      pool: Array.from(checked), count: [+$('gCountMin').value, +$('gCountMax').value],
      density: [+$('gDenMin').value / 100, +$('gDenMax').value / 100],
      sizeDist: { L: +$('gL').value, M: +$('gM').value },
      // no mystery box / key picture in this art set: hide nothing, or the box would be invisible
      mechanics: { linked: +$('gLinked').value, locked: app.catalog.items.has(MYSTERY_ID) && app.catalog.items.has(KEY_ID) ? +$('gLocked').value : 0 },
      container: L.container,
    };
  }
  function run() {
    const t = template();
    if (t.pool.length < t.count[1]) return app.status('Kho đồ ít hơn số món tối đa', 'bad');
    const r = generate(t, app.areaOf, app.items);
    if (!r) return app.status('Không sinh được level nào hợp lệ', 'bad');
    const L = app.level, lv: any = r.level; lv.id = L.id; lv.name = L.name; lv.reward = L.reward;
    app.setLevel(lv, { keepId: true });
    $('gInfo').textContent = `${r.diff.total} điểm · ${r.diff.tier} · đầy ${(r.diff.density * 100).toFixed(0)}% (muốn ${(r.target * 100).toFixed(0)}%) · ${r.sol.solvable ? 'xếp được' : 'chặt tay'}${r.hint ? ' · ' + r.hint : ''}`;
    app.status(r.hint ? 'Đã sinh nhưng chưa đạt density' : 'Đã chọn đồ. Chỉnh tay tiếp ở bước 3 hoặc Lưu.', r.hint ? 'bad' : 'ok');
  }
  $('gRun').addEventListener('click', run);
  $('gReroll').addEventListener('click', () => { $('gSeed').value = Math.floor(Math.random() * 1e6); run(); });
  refresh();
  return { refresh };
}
