// Paste into the web game page (snug, 420×760 viewport). Defines window.efDump(selector, name):
// walks the element tree and posts boxes, colours, radii, borders, shadows, images, text runs and
// rasterised SVGs to tools/web-ui/receiver.mjs, which saves tools/web-ui/dumps/<name>.json.
// tools/editor/build-ui.js turns that dump into a Cocos prefab.
window.efDump = async function efDump(selector, name, opts = {}) {
  const phone = document.getElementById('phone') || document.body;
  const origin = phone.getBoundingClientRect();
  const col = s => { const m = String(s).match(/rgba?\(([^)]+)\)/); if (!m) return null; const p = m[1].split(/[ ,/]+/).filter(Boolean).map(Number); return [p[0], p[1], p[2], p.length > 3 ? p[3] : 1]; };
  const splitTop = s => { const out = []; let d = 0, cur = ''; for (const ch of s) { if (ch === '(') d++; if (ch === ')') d--; if (ch === ',' && !d) { out.push(cur.trim()); cur = ''; } else cur += ch; } if (cur.trim()) out.push(cur.trim()); return out; };
  const shadows = s => s === 'none' ? [] : splitTop(s).map(x => { const c = col(x); const nums = x.replace(/rgba?\([^)]*\)/, '').replace('inset', '').trim().split(/\s+/).map(parseFloat); return { color: c, x: nums[0] || 0, y: nums[1] || 0, blur: nums[2] || 0, spread: nums[3] || 0, inset: /inset/.test(x) }; });
  const rect = r => ({ x: +(r.left - origin.left).toFixed(2), y: +(r.top - origin.top).toFixed(2), w: +r.width.toFixed(2), h: +r.height.toFixed(2) });
  const pending = [];
  function svgPng(el, r, out) {
    const clone = el.cloneNode(true);
    clone.setAttribute('width', r.width); clone.setAttribute('height', r.height);
    if (!clone.getAttribute('xmlns')) clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    const cs = getComputedStyle(el);
    clone.querySelectorAll('*').forEach(n => { if (n.getAttribute('fill') === 'currentColor') n.setAttribute('fill', cs.color); if (n.getAttribute('stroke') === 'currentColor') n.setAttribute('stroke', cs.color); });
    if (!clone.getAttribute('fill') && cs.fill && cs.fill !== 'none') clone.setAttribute('fill', cs.fill === 'currentcolor' ? cs.color : cs.fill);
    const url = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(clone.outerHTML);
    pending.push(new Promise(ok => { const img = new Image(); img.onload = () => { const k = 3, c = document.createElement('canvas'); c.width = Math.ceil(r.width * k); c.height = Math.ceil(r.height * k); c.getContext('2d').drawImage(img, 0, 0, c.width, c.height); out.svgPng = c.toDataURL('image/png'); ok(); }; img.onerror = () => ok(); img.src = url; }));
  }
  function walk(el) {
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') return null;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0 && el.tagName !== 'BR') return null;
    const n = { tag: el.tagName.toLowerCase(), id: el.id || '', cls: typeof el.className === 'string' ? el.className : '', ...rect(r) };
    const bg = col(cs.backgroundColor); if (bg && bg[3] > 0) n.bg = bg;
    if (cs.backgroundImage !== 'none') n.bgImage = cs.backgroundImage;
    const rad = parseFloat(cs.borderTopLeftRadius); if (rad) n.radius = Math.min(rad, r.width / 2, r.height / 2);
    const bw = parseFloat(cs.borderTopWidth); if (bw && cs.borderTopStyle !== 'none') { n.border = { w: bw, color: col(cs.borderTopColor) }; }
    const sh = shadows(cs.boxShadow); if (sh.length) n.shadows = sh;
    if (cs.opacity !== '1') n.opacity = +cs.opacity;
    if (cs.filter !== 'none') n.filter = cs.filter;
    if (cs.transform !== 'none') n.transform = cs.transform;
    if (el.tagName === 'IMG') { n.src = el.getAttribute('src'); return n; }
    if (el.tagName === 'svg' || el.tagName === 'SVG') { svgPng(el, r, n); return n; }
    n.children = [];
    for (const c of el.childNodes) {
      if (c.nodeType === 3) {
        const t = c.textContent.replace(/\s+/g, ' '); if (!t.trim()) continue;   // keep edge spaces: runs like "collect " + <b>100</b> + " free"
        const range = document.createRange(); range.selectNodeContents(c);
        const rr = range.getBoundingClientRect(); if (!rr.width) continue;
        n.children.push({ tag: '#text', text: t, ...rect(rr), font: cs.fontFamily.split(',')[0].replace(/"/g, '').trim(), weight: +cs.fontWeight, size: parseFloat(cs.fontSize), color: col(cs.color), align: cs.textAlign, letterSpacing: cs.letterSpacing === 'normal' ? 0 : parseFloat(cs.letterSpacing), lineHeight: parseFloat(cs.lineHeight) || 0, tabular: cs.fontVariantNumeric.includes('tabular') });
      } else if (c.nodeType === 1) { const k = walk(c); if (k) n.children.push(k); }
    }
    return n;
  }
  const root = document.querySelector(selector);
  const tree = walk(root);
  await Promise.all(pending);
  const body = JSON.stringify({ name, selector, viewport: [origin.width, origin.height], tree, ...opts });
  const res = await fetch('http://127.0.0.1:5198/save?name=' + name, { method: 'POST', body });
  return res.text();
};
'efDump ready';
