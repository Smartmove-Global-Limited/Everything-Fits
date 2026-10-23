// "Quản lý level" dialog (port of the web editor src/editor/manage.js, levels only: the game has
// one chapter). Every change is saved like the Lưu button (project file / draft).
import type { EditorPage } from './EditorPage';
import { $ } from './EditorPage';
import { levelNumber, nextLevelId, blankLevel } from './EditorStore';

const clone = <T>(o: T): T => JSON.parse(JSON.stringify(o));

export function initManage(app: EditorPage) {
  const modal = $('mgModal');
  const ch = () => app.chapter;
  const save = async () => { await app.publish(); app.refreshLevelSelect(); app.markDirty(); };
  const fail = (e: any) => app.status('Lỗi: ' + (e?.message || e), 'bad');

  async function addLevel() {
    const c = ch(), id = nextLevelId(c.id, c.levels.map(l => l.id));
    const lv = blankLevel(id);
    if (app.level) lv.container = clone(app.level.container);
    c.levels.push(lv); await save();
    app.status(`Đã thêm level ${c.levels.length}`, 'ok');
    render(); app.openLevel(id);
  }
  async function deleteLevel(i: number) {
    const c = ch(), lv = c.levels[i];
    if (c.levels.length < 2) return app.status('Phải còn ít nhất một level', 'bad');
    if (!window.confirm(`Xoá Level ${levelNumber(app.store.book, c.id, i)} (${lv.id})?`)) return;
    c.levels.splice(i, 1); await save();
    app.status(`Đã xoá level ${lv.id}`, 'ok'); render();
    if (lv.id === app.level?.id) app.openLevel(c.levels[Math.min(i, c.levels.length - 1)].id);
  }
  async function duplicateLevel(i: number) {
    const c = ch(), src = c.levels[i], id = nextLevelId(c.id, c.levels.map(l => l.id));
    c.levels.splice(i + 1, 0, { ...clone(src), id });
    await save();
    app.status('Đã nhân bản level', 'ok'); render(); app.openLevel(id);
  }
  async function reorder(from: number, to: number) {
    const list = ch().levels;
    if (from === to || to < 0 || to >= list.length) return;
    const [x] = list.splice(from, 1);
    list.splice(to, 0, x);
    await save();
    app.status('Đã đổi thứ tự level', 'ok');
    render();
  }

  const btn = (text: string, title: string, fn: () => Promise<void> | void, cls = '') => {
    const b = document.createElement('button');
    b.textContent = text; b.title = title; b.className = 'mini ' + cls;
    b.addEventListener('click', () => Promise.resolve(fn()).catch(fail));
    return b;
  };
  /** Rows can be dragged by their grip to reorder (manage.js makeSortable) */
  function makeSortable(table: HTMLElement, onDrop: (f: number, t: number) => Promise<void>) {
    let from: number | null = null;
    const clear = (...names: string[]) => table.querySelectorAll(names.map(n => 'tr.' + n).join(',')).forEach(x => x.classList.remove(...names));
    table.addEventListener('dragstart', (e: any) => {
      const tr = e.target.closest('tr[draggable]'); if (!tr) return;
      from = +tr.dataset.i; tr.classList.add('dragging');
      e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('text/plain', String(from));
    });
    table.addEventListener('dragover', (e: any) => {
      const tr = e.target.closest('tr[draggable]'); if (!tr || from === null) return;
      e.preventDefault();
      const r = tr.getBoundingClientRect();
      clear('over-top', 'over-bottom');
      tr.classList.add(e.clientY > r.top + r.height / 2 ? 'over-bottom' : 'over-top');
    });
    table.addEventListener('dragleave', (e: any) => { if (!table.contains(e.relatedTarget)) clear('over-top', 'over-bottom'); });
    table.addEventListener('drop', (e: any) => {
      const tr = e.target.closest('tr[draggable]');
      clear('over-top', 'over-bottom', 'dragging');
      if (!tr || from === null) return;
      e.preventDefault();
      const r = tr.getBoundingClientRect();
      let to = +tr.dataset.i + (e.clientY > r.top + r.height / 2 ? 1 : 0);
      if (to > from) to--;
      const f = from; from = null;
      onDrop(f, to).catch(fail);
    });
    table.addEventListener('dragend', () => { from = null; clear('over-top', 'over-bottom', 'dragging'); });
  }

  function render() {
    const c = ch(), lt = $('mgLevels');
    $('mgLevelHead').textContent = `${c.levels.length} level`;
    lt.innerHTML = '<tr><th></th><th>#</th><th>Level</th><th>Món</th><th></th></tr>';
    c.levels.forEach((lv, i) => {
      const acts = document.createElement('div'); acts.className = 'mini-row';
      acts.append(
        btn('Mở', 'Mở level này để sửa', () => { app.openLevel(lv.id); modal.hidden = true; }),
        btn('Nhân bản', 'Tạo bản sao ngay dưới', () => duplicateLevel(i)),
        btn('Xoá', 'Xoá level', () => deleteLevel(i), 'danger'),
      );
      const tr = document.createElement('tr');
      if (lv.id === app.level?.id) tr.className = 'on';
      const cells: (string | Node)[] = ['<span class="grip" title="Kéo để đổi thứ tự">⋮⋮</span>', String(i + 1),
        `Level ${levelNumber(app.store.book, c.id, i)} <code>${lv.id}</code>`, String((lv.items || []).length), acts];
      for (const x of cells) { const td = document.createElement('td'); if (typeof x === 'string') td.innerHTML = x; else td.append(x); tr.appendChild(td); }
      tr.draggable = true; tr.dataset.i = String(i);
      lt.appendChild(tr);
    });
  }

  makeSortable($('mgLevels'), reorder);
  $('mgBtn').addEventListener('click', () => { render(); modal.hidden = false; });
  $('mgClose').addEventListener('click', () => { modal.hidden = true; });
  modal.addEventListener('click', (e: any) => { if (e.target === modal) modal.hidden = true; });
  $('mgAddLevel').addEventListener('click', () => addLevel().catch(fail));
  return { render };
}
