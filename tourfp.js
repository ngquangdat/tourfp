/* TourFP 0.2.0 — bản thử: ghi tour theo thao tác và khớp phần tử bằng "dấu vân tay".
 * - Không dùng class/id. Không phụ thuộc thư viện.
 * - Chữ lấy từ API (tên, tên kế hoạch…) và chữ số bị loại khỏi dấu vân tay.
 *   Để lọc được, file này phải được nạp TRƯỚC khi app gọi API (đặt trong <head>).
 * - Ghi: bấm bình thường = bước "thao tác" (cú bấm vẫn chạy, app chuyển màn như thật);
 *        Alt+bấm = bước "chỉ tô sáng" (cú bấm bị chặn).
 * - Phát: tô sáng đích, chờ người dùng tự bấm rồi mới sang bước sau; tự chờ màn mới hiện ra.
 * API: TourFP.capture(el) | TourFP.find(fp) | record() | stop() | play() | export() | load(steps) | destroy()
 */
(() => {
  if (typeof window === 'undefined' || typeof document === 'undefined') return; // được import ở phía máy chủ (SSR, công cụ build): không làm gì
  if (window.TourFP) window.TourFP.destroy();

  const W = { label: 40, key: 25, attr: 12, icon: 20, tag: 8, role: 5, comp: 15, anchor: 15, pos: 5 };
  const THRESHOLD = 0.6, MARGIN = 0.08, Z = 2147483000;
  const KEY = ['formcontrolname', 'name', 'data-walkthrough'];
  const SOFT = ['type', 'placeholder', 'aria-label', 'title', 'href', 'panelclass', 'inputmode'];
  const SEMANTIC = 'button,a,input,select,textarea,[role=button],[role=tab],[role=option],[role=menuitem],[role=radio],[role=checkbox],mat-select,mat-radio-button,mat-checkbox,mat-option';
  const LIB = /^(mat|cdk|ng|mdc)-/;
  const ICONS = 'tcbs-icon,mat-icon,svg,img';

  const norm = s => (s || '').replace(/\s+/g, ' ').trim();
  const stripNum = s => norm(s).replace(/\d[\d.,%]*/g, '#');
  const hasLetters = s => /[A-Za-zÀ-ỹ]/.test(s);
  const hash = s => { let h = 5381; for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0; return (h >>> 0).toString(36); };
  const isUi = e => !!(e && e.closest && e.closest('[data-tourfp-ui]'));
  const visible = e => e.getClientRects().length > 0;
  const tagOf = e => e.tagName.toLowerCase();

  // ---------- giá trị từ API: nghe mọi phản hồi JSON, nhớ các chuỗi trong đó ----------
  const api = window.__tourfpApi || (window.__tourfpApi = { set: new Set(), responses: 0, hooked: false, feed: null });
  const API_MAX = 30000, IGNORE_URL = /i18n|\/assets\/|locale|translat/i; // file dịch là chữ cố định, không tính
  const keyOf = s => norm(s).toLowerCase();
  function feed(v, depth) {
    if (v == null || depth > 12 || api.set.size >= API_MAX) return;
    if (typeof v === 'string') { const s = keyOf(v); if (s.length >= 2 && s.length <= 120 && hasLetters(s)) api.set.add(s); }
    else if (Array.isArray(v)) for (const x of v) feed(x, depth + 1);
    else if (typeof v === 'object') for (const k in v) feed(v[k], depth + 1);
  }
  api.feed = (url, body) => {
    try {
      if (IGNORE_URL.test(url || '')) return;
      if (typeof body === 'string') { if (body.length > 3e6) return; const c = body.trimStart()[0]; if (c !== '{' && c !== '[') return; body = JSON.parse(body); }
      feed(body, 0); api.responses++;
    } catch (_) { /* không phải JSON */ }
  };
  if (!api.hooked) {
    api.hooked = true;
    const xo = XMLHttpRequest.prototype.open, xs = XMLHttpRequest.prototype.send;
    XMLHttpRequest.prototype.open = function (m, u) { this.__tfpUrl = String(u); return xo.apply(this, arguments); };
    XMLHttpRequest.prototype.send = function () {
      this.addEventListener('load', () => { try { const t = this.responseType; api.feed(this.__tfpUrl, t === '' || t === 'text' ? this.responseText : t === 'json' ? this.response : null); } catch (_) {} });
      return xs.apply(this, arguments);
    };
    const of = window.fetch;
    if (of) window.fetch = function () {
      const p = of.apply(this, arguments);
      p.then(r => { if (/json/.test(r.headers.get('content-type') || '')) r.clone().text().then(t => api.feed(r.url, t)).catch(() => {}); }).catch(() => {});
      return p;
    };
  }
  function isApiValue(piece) {
    const k = keyOf(piece);
    if (api.set.has(k)) return true;
    for (const s of api.set) if (s.length >= 4 && s.length * 2 >= k.length && k.includes(s)) return true;
    return false;
  }

  // ---------- tín hiệu ----------
  // tách chữ của phần tử thành các mẩu, bỏ chữ số
  function pieces(e) {
    const out = [], num = [];
    let digits = false, nodes = 0;
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    // chỉ cần vài mẩu đầu: với khối lớn (thẻ, bảng) đó là tiêu đề
    for (let n; (n = w.nextNode()) && nodes < 40 && out.length < 6;) {
      const v = n.nodeValue;
      if (!v.trim() || (n.parentElement && n.parentElement.closest('svg,script,style'))) continue;
      nodes++;
      if (/\d/.test(v)) digits = true;
      for (const seg of v.split(/\d[\d.,%\/:-]*/)) { const s = norm(seg); if (s.length >= 2 && hasLetters(s)) { out.push(s.slice(0, 60)); num.push(/\d/.test(v)); } }
    }
    return { all: out, digits, num };
  }
  const lettersLen = s => s.replace(/[\d\s.,%#\/:-]/g, '').length || 1;

  // nhãn để hiển thị và để so thuộc tính
  function labelOf(e) {
    const a = e.getAttribute('aria-label') || e.getAttribute('title') || e.getAttribute('placeholder') || e.getAttribute('alt');
    if (a) return stripNum(a).slice(0, 60);
    if (e.childElementCount > 12) return '';
    const t = e.textContent;
    if (!t || t.length > 200) return '';
    const s = stripNum(t);
    return s.length <= 60 && hasLetters(s) ? s : '';
  }

  function iconOf(e) {
    const i = e.matches(ICONS) ? e : e.querySelector(ICONS);
    if (!i || (i !== e && e.childElementCount > 6)) return '';
    const n = i.getAttribute('name') || i.getAttribute('svgicon') || i.getAttribute('fonticon');
    if (n) return n;
    if (tagOf(i) === 'mat-icon' && !i.childElementCount) return norm(i.textContent);
    if (tagOf(i) === 'img') return (i.getAttribute('src') || '').split('/').pop().split('?')[0];
    const p = i.querySelector('use,path');
    if (!p) return '';
    return p.getAttribute('href') || p.getAttribute('xlink:href') || 'd:' + hash(p.getAttribute('d') || '');
  }

  function compChain(e) {
    const out = [];
    for (let p = e.parentElement; p && out.length < 3; p = p.parentElement) {
      const t = tagOf(p);
      if (t.includes('-') && !LIB.test(t)) out.push(t);
    }
    return out;
  }

  // chữ ngắn gần nhất đứng trước phần tử (nhãn ô nhập, tiêu đề khối); bỏ qua nếu là giá trị API
  // các mẩu chữ đứng trước phần tử, theo thứ tự gần đến xa (nhãn ô nhập, tiêu đề khối). Mỗi khối chỉ lấy hai mẩu đầu
  // (tiêu đề như "Số điện thoại"); phần sau thường là dữ liệu của người dùng.
  // stopAt: chỉ lấy chữ nằm bên trong khối này (không leo ra ngoài). out.data[i] = mẩu thứ i lấy từ dòng chữ có chữ số.
  function anchorCands(e, stopAt) {
    const out = []; out.data = [];
    const ff = e.closest('mat-form-field');
    const ml = ff && ff.querySelector('mat-label,label');
    if (ml) { const v = stripNum(ml.textContent).slice(0, 40); if (v && hasLetters(v)) { out.push(v); out.data.push(false); } }
    let cur = e;
    for (let lvl = 0; lvl < 4 && cur && cur !== document.body && cur !== stopAt && out.length < 8; lvl++, cur = cur.parentElement) {
      for (let sib = cur.previousElementSibling, k = 0; sib && k < 3; sib = sib.previousElementSibling, k++) {
        const t = sib.textContent;
        if (!t || t.length > 400) continue;
        const p = pieces(sib);
        p.all.slice(0, 2).forEach((v, i) => { if (v.length <= 40) { out.push(v); out.data.push(p.num[i]); } });
      }
    }
    return out;
  }

  function posOf(e) {
    const p = e.parentElement;
    if (!p) return [0, 1];
    const same = [...p.children].filter(c => c.tagName === e.tagName);
    return [same.indexOf(e), same.length];
  }

  // ---------- ngữ cảnh màn hình ----------
  // chỉ hộp thoại chặn màn hình mới là "trạng thái màn"; menu bật ra khi rê chuột cũng mang role=dialog nhưng không tính
  const isModal = d => d.matches('[aria-modal=true],mat-dialog-container,dialog[open]') || !!d.closest('.cdk-global-overlay-wrapper');
  const POPUP = '.cdk-overlay-container,[role=menu],[role=dialog],[role=listbox]';
  // menu bật ra (không phải hộp thoại chặn màn hình) đang chứa phần tử, nếu có
  function menuOf(el) {
    const p = el.closest(POPUP);
    return p && !p.matches('.cdk-overlay-container') && !isModal(p) && !p.querySelector('[aria-modal=true],mat-dialog-container') ? p : null;
  }
  function topDialog() {
    const ds = [...document.querySelectorAll('[role=dialog],[aria-modal=true],dialog[open]')].filter(d => visible(d) && !isUi(d) && isModal(d));
    return ds[ds.length - 1] || null;
  }
  function dialogKey(d) {
    for (const c of d.querySelectorAll('*')) { const t = tagOf(c); if (t.includes('-') && !LIB.test(t)) return t; }
    const pane = d.closest('.cdk-overlay-pane');
    return pane ? [...pane.classList].filter(c => !/^cdk-/.test(c)).join('.') : 'dialog';
  }
  function activeStep(root) {
    const a = root.querySelector('[class*=step].active,[class*=step][aria-selected=true],[role=tab][aria-selected=true]');
    return a ? stripNum(a.textContent).slice(0, 30) : '';
  }
  function context() {
    const d = topDialog();
    return {
      path: location.pathname,
      layout: innerWidth < 768 ? 'mobile' : 'desktop', // ngưỡng 768 là giả định, cần chỉnh theo app
      dialog: d ? dialogKey(d) : '',
      step: d ? activeStep(d) : '',
    };
  }
  // vùng tìm: nếu có hộp thoại thì chỉ hộp thoại và các lớp phủ mở sau nó
  function roots() {
    const d = topDialog();
    if (!d) return [document.body];
    const pane = d.closest('.cdk-overlay-pane');
    if (!pane || !pane.parentElement) return [d];
    const out = [d];
    let seen = false;
    for (const p of document.querySelectorAll('.cdk-overlay-pane')) {
      if (p === pane) { seen = true; continue; }
      if (seen && visible(p)) out.push(p);
    }
    return out;
  }

  // ---------- ghi dấu vân tay ----------
  function clickableRoot(target) {
    let e = target;
    for (let i = 0; e && i < 5 && e !== document.body; i++, e = e.parentElement) if (e.matches(SEMANTIC)) return e;
    e = target;
    if (getComputedStyle(e).cursor !== 'pointer') return target;
    // leo lên mục bấm được nhỏ nhất: dừng khi cha gom nhiều mục có chữ (ví dụ cả thanh menu)
    const textKids = p => { let n = 0; for (const c of p.children) if (norm(c.textContent)) n++; return n; };
    for (let p = e.parentElement; p && p !== document.body && getComputedStyle(p).cursor === 'pointer' && textKids(p) <= 1; p = p.parentElement) e = p;
    return e;
  }

  // "hình dáng" vị trí của phần tử: chuỗi thẻ từ nó lên 5 cấp cha. Các dòng của cùng một bảng có chung chuỗi này.
  const sigOf = e => {
    const out = [];
    for (let p = e, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) out.push(tagOf(p) + (p.getAttribute('role') ? '[' + p.getAttribute('role') + ']' : ''));
    return out.join('<');
  };
  // các phần tử khác trên màn có chữ/icon/thuộc tính y hệt đích (không tính phần tử bọc ngoài hay nằm trong đích)
  function twinsOf(fp, el) {
    const out = [];
    for (const r of roots()) for (const e of r.querySelectorAll(fp.tag)) {
      if (e === el || e.contains(el) || el.contains(e) || isUi(e) || !visible(e) || iconOf(e) !== fp.icon) continue;
      if (fp.label && labelScore(fp, e) < 0.9) continue;
      let same = true;
      for (const k in fp.key) if (e.getAttribute(k) !== fp.key[k]) same = false;
      if (same) out.push(e);
    }
    return out;
  }

  function capture(el) {
    const fp = { v: 2, tag: tagOf(el), role: el.getAttribute('role') || '', label: '', segs: [], mixed: false, dyn: 0, cover: 1, key: {}, attr: {}, icon: iconOf(el), comp: compChain(el), anchor: '', anchorSkip: 0, pos: posOf(el), hint: '', ctx: context() };
    // tiêu đề khối đứng trước: lấy mẩu đầu tiên không phải giá trị API, và nhớ vị trí của nó để lúc khớp đọc đúng mẩu đó
    const ac = anchorCands(el), ai = ac.findIndex(v => !isApiValue(v));
    if (ai >= 0) { fp.anchor = ac[ai]; fp.anchorSkip = ai; }
    const attrLabel = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt');
    if (attrLabel) fp.label = stripNum(attrLabel).slice(0, 60);
    else {
      const p = pieces(el);
      if (p && p.all.length) {
        const stat = p.all.filter(s => !isApiValue(s));
        const big = p.all.length > 2; // khối chứa nhiều chữ: chỉ giữ hai mẩu đầu (tiêu đề), phần sau thường là dữ liệu
        fp.segs = stat.slice(0, big ? 2 : 5);
        fp.label = fp.segs.join(' ').slice(0, 60);
        fp.dyn = p.all.length - stat.length; // số mẩu chữ bị loại vì là giá trị API
        fp.mixed = fp.dyn > 0 || p.digits || big;
        fp.cover = +(lettersLen(fp.segs.join('')) / lettersLen(norm(el.textContent))).toFixed(2);
      }
    }
    for (const k of KEY) { const v = el.getAttribute(k); if (v && !/\d{3,}/.test(v)) fp.key[k] = v; }
    for (const k of SOFT) { const v = el.getAttribute(k); if (v && v.length <= 80) fp.attr[k] = k === 'href' ? v.split('?')[0] : stripNum(v); }
    // số phần tử khác trên màn có chữ/icon/thuộc tính y hệt (ví dụ ba nút bút chì): nếu có thì khối đứng trước là bắt buộc
    fp.twins = 0;
    if (hasStrong(fp)) {
      const group = twinsOf(fp, el);
      fp.twins = group.length;
      if (group.length) {
        // Tiêu đề khối đứng trước chỉ phân biệt được các bản sao khi cả ba điều đúng:
        //  - nó nằm bên trong chính "đơn vị lặp" chứa đích (một dòng của bảng, một mục của form), không phải chữ của dòng bên cạnh;
        //  - nó là nhãn, không phải dữ liệu (mã, số liệu);
        //  - không bản sao nào khác có tiêu đề y hệt.
        // Nếu không, đây là danh sách sinh từ dữ liệu: nhận diện bằng thứ tự, "nút thứ mấy trong danh sách".
        const sig = sigOf(el), peer = group.find(e => sigOf(e) === sig);
        let byAnchor = !!fp.anchor;
        if (byAnchor && peer) {
          let unit = el;
          while (unit.parentElement && !unit.parentElement.contains(peer)) unit = unit.parentElement;
          const inner = anchorCands(el, unit), j = inner.indexOf(fp.anchor);
          byAnchor = j >= 0 && !inner.data[j];
        }
        if (byAnchor) byAnchor = !group.some(e => sim(fp.anchor, anchorCands(e)[fp.anchorSkip] || ''));
        if (!byAnchor) {
          fp.sig = sig;
          fp.nth = group.filter(e => sigOf(e) === sig && (e.compareDocumentPosition(el) & Node.DOCUMENT_POSITION_FOLLOWING)).length;
          fp.anchor = ''; fp.anchorSkip = 0;
        }
      }
    }
    const k0 = Object.keys(fp.key)[0];
    if (k0) fp.hint = (fp.comp[0] ? fp.comp[0] + ' ' : '') + fp.tag + '[' + k0 + '="' + CSS.escape(fp.key[k0]) + '"]';
    return fp;
  }

  // ---------- khớp ----------
  function sim(a, b) {
    if (!a || !b) return 0;
    if (a === b) return 1;
    const A = new Set(a.toLowerCase().split(' ')), B = new Set(b.toLowerCase().split(' '));
    let n = 0; for (const x of A) if (B.has(x)) n++;
    const j = n / (A.size + B.size - n);
    return j >= 0.5 ? j : 0;
  }
  // nhãn khớp khi mọi mẩu chữ cố định đều có trong phần tử; phần chữ động được phép khác
  function labelScore(fp, e) {
    if (!fp.segs || !fp.segs.length) return sim(fp.label, labelOf(e));
    const t = e.textContent;
    if (!t) return 0;
    // không giới hạn độ dài: thẻ có biểu đồ chứa rất nhiều chữ số nhưng vẫn là đích hợp lệ
    if (t.length > 4000 && !t.includes(fp.segs[0].split(' ').sort((a, b) => b.length - a.length)[0])) return 0;
    const c = norm(t);
    let hit = 0;
    for (const s of fp.segs) if (c.includes(s)) hit++;
    if (hit < fp.segs.length) return hit * 2 >= fp.segs.length ? 0.5 * hit / fp.segs.length : 0;
    const cover = Math.min(1, lettersLen(fp.segs.join('')) / lettersLen(c));
    return Math.max(0.5, 1 - Math.abs(cover - (fp.cover || 1)));
  }
  const softVal = (e, k) => { const v = e.getAttribute(k); return v == null ? null : k === 'href' ? v.split('?')[0] : stripNum(v); };

  function score(fp, e) {
    let got = 0, max = 0;
    const add = (w, v) => { max += w; got += w * (v === true ? 1 : v || 0); };
    if (fp.label) add(W.label, labelScore(fp, e));
    for (const k in fp.key) add(W.key, e.getAttribute(k) === fp.key[k]);
    for (const k in fp.attr) add(W.attr, softVal(e, k) === fp.attr[k]);
    if (fp.icon) add(W.icon, iconOf(e) === fp.icon);
    if (fp.tag) add(W.tag, tagOf(e) === fp.tag);
    if (fp.role) add(W.role, e.getAttribute('role') === fp.role);
    if (fp.comp && fp.comp.length) { const c = compChain(e); add(W.comp, c[0] === fp.comp[0] ? 1 : c.includes(fp.comp[0]) || fp.comp.includes(c[0]) ? 0.5 : 0); }
    let anchorHit = 0;
    if (fp.anchor) {
      const ac = anchorCands(e);
      // bản ghi cũ chưa có anchorSkip: chấp nhận nếu trùng một trong các mẩu gần nhất
      anchorHit = fp.anchorSkip == null ? (ac.slice(0, 6).some(v => sim(fp.anchor, v)) ? 1 : 0) : sim(fp.anchor, ac[fp.anchorSkip] || '');
      add(W.anchor, anchorHit);
    }
    if (fp.pos) { const p = posOf(e); add(W.pos, p[0] === fp.pos[0] && p[1] === fp.pos[1]); }
    const s = max ? got / max : 0;
    // phần tử có bản sao giống hệt trên màn: sai khối đứng trước thì không được nhận, kể cả khi mọi thứ khác đều khớp
    return fp.twins && fp.anchor && !anchorHit ? Math.min(s, THRESHOLD - 0.05) : s;
  }

  // có ít nhất một tín hiệu mạnh thì mới chấm đầy đủ
  function strongHit(fp, e) {
    if (fp.label && labelScore(fp, e)) return true;
    for (const k in fp.key) if (e.getAttribute(k) === fp.key[k]) return true;
    if (fp.icon && iconOf(e) === fp.icon) return true;
    return false;
  }
  const hasStrong = fp => !!(fp.label || fp.icon || Object.keys(fp.key).length);

  // hệ số "với tới được": bản sao nằm trong ngăn kéo ẩn ngoài màn hình hoặc bị che thì xếp sau bản đang hiện
  function reach(e) {
    const r = e.getBoundingClientRect();
    if (r.right <= 0 || r.left >= innerWidth) return 0.7; // lệch hẳn ra ngoài theo chiều ngang
    const x = r.left + r.width / 2, y = r.top + r.height / 2;
    if (y < 0 || y > innerHeight) return 1; // phải cuộn mới thấy: chưa biết
    const t = document.elementFromPoint(x, y);
    if (!t || isUi(t) || e.contains(t) || t.contains(e)) return 1;
    // bị khuất chỉ vì đang cuộn ra ngoài một khung cuộn (ví dụ thân hộp thoại) thì không phải là bị che
    for (let p = e.parentElement; p && p !== document.body; p = p.parentElement) {
      const s = getComputedStyle(p);
      if (s.overflowY === 'visible' && s.overflowX === 'visible') continue;
      const pr = p.getBoundingClientRect();
      if (x < pr.left || x > pr.right || y < pr.top || y > pr.bottom) return 1;
    }
    return 0.8;
  }

  function find(fp, opts = {}) {
    const t0 = performance.now();
    const done = r => Object.assign(r, { ms: +(performance.now() - t0).toFixed(2) });
    if (!opts.ignoreCtx && fp.ctx) {
      const c = context();
      if (c.path !== fp.ctx.path) return done({ status: 'wrong-screen', expected: fp.ctx, actual: c });
      if (c.dialog !== fp.ctx.dialog || c.step !== fp.ctx.step) return done({ status: 'wrong-state', expected: fp.ctx, actual: c });
    }
    const rs = roots();
    if (fp.hint && !opts.noHint) {
      let hits = [];
      try { for (const r of rs) hits.push(...r.querySelectorAll(fp.hint)); } catch (_) { hits = []; }
      hits = hits.filter(visible);
      if (hits.length === 1) { const s = score(fp, hits[0]); if (s >= THRESHOLD) return done({ status: 'ok', el: hits[0], score: s, margin: 1, via: 'hint', scanned: 1 }); }
    }
    const strong = hasStrong(fp);
    const ranked = [];
    let scanned = 0;
    const scan = sel => {
      for (const r of rs) for (const e of r.querySelectorAll(sel)) {
        if (isUi(e) || !visible(e)) continue;
        scanned++;
        if (strong && !strongHit(fp, e)) continue;
        ranked.push({ el: e, score: score(fp, e) });
      }
    };
    scan(fp.tag || '*');
    ranked.sort((a, b) => b.score - a.score);
    if (fp.tag && (!ranked.length || ranked[0].score < THRESHOLD)) { ranked.length = 0; scan('*'); ranked.sort((a, b) => b.score - a.score); }
    // điểm gốc quyết định có đạt ngưỡng không; điểm đã nhân hệ số chỉ dùng để xếp hạng giữa các bản sao
    for (const c of ranked) c.adj = c.score;
    for (const c of ranked.slice(0, 8)) c.adj = c.score * reach(c.el);
    ranked.sort((a, b) => b.adj - a.adj);
    // ứng viên lồng nhau (nút và chữ bên trong nó) là cùng một đích, không tính là mơ hồ
    let best = ranked[0];
    // giữa một phần tử và khối cha của chính nó thì chọn theo điểm gốc, không để hệ số "bị che" quyết định
    if (best) for (const c of ranked) if (c !== best && c.score > best.score && (c.el.contains(best.el) || best.el.contains(c.el))) best = c;
    const second = best && ranked.find((c, i) => i > 0 && !best.el.contains(c.el) && !c.el.contains(best.el));
    // đích được ghi theo thứ tự trong danh sách: lấy các ứng viên cùng "hình dáng", xếp theo thứ tự trên trang, chọn cái thứ nth
    if (fp.nth != null && fp.sig) {
      const group = ranked.filter(c => c.score >= THRESHOLD && sigOf(c.el) === fp.sig).map(c => c.el)
        .sort((x, y) => (x.compareDocumentPosition(y) & Node.DOCUMENT_POSITION_FOLLOWING ? -1 : 1));
      const pick = group[fp.nth];
      if (!pick) return done({ status: 'not-found', score: best ? best.score : 0, scanned, need: fp.nth + 1, have: group.length });
      return done({ status: 'ok', el: pick, score: score(fp, pick), margin: 1, via: 'thứ ' + (fp.nth + 1) + '/' + group.length, scanned });
    }
    if (!best || best.score < THRESHOLD) return done({ status: 'not-found', score: best ? best.score : 0, scanned });
    const margin = best.adj - (second ? second.adj : 0);
    return done({ status: margin >= MARGIN ? 'ok' : 'ambiguous', el: best.el, score: best.score, margin, via: 'scan', scanned, top: ranked.slice(0, 3) });
  }

  // danh sách phần tử bấm được đang hiện (dùng cho kiểm thử)
  function clickables() {
    const out = new Set();
    for (const r of roots()) {
      for (const e of r.querySelectorAll(SEMANTIC)) if (visible(e) && !isUi(e)) out.add(e);
      for (const e of r.querySelectorAll('div,span,li,td,tcbs-icon,mat-icon,img')) {
        if (!visible(e) || isUi(e) || e.closest(SEMANTIC)) continue;
        if (getComputedStyle(e).cursor === 'pointer' && getComputedStyle(e.parentElement).cursor !== 'pointer') out.add(e);
      }
    }
    return [...out];
  }

  // ---------- giao diện ghi và phát ----------
  const steps = []; // { kind: 'click' | 'hover' | 'input' | 'info', fp, note }
  let recording = false, playing = -1, raf = 0, target = null, token = 0, pending = null, lastCap = 0;
  let hoverEl = null, hoverT = 0, lastDown = 0, popups = [], advancing = false;
  let directRun = 0, fullSteps = null, choice = null; // lượt "vào thẳng" đang chạy; bản đầy đủ của tour khi chỉ chạy tới bước x; hai lựa chọn đang chờ
  // khi đang ghi: menu bật ra do rê chuột (không phải do bấm) thì nhớ phần tử đang được rê lên
  const popMo = new MutationObserver(list => {
    // bỏ qua nếu vừa có cú bấm (trong 1,5 giây, hoặc từ lúc chuột vào phần tử đang rê): khi đó thứ bật ra là do bấm
    if (!recording || performance.now() - lastDown < 1500 || lastDown > hoverT || !hoverEl || !hoverEl.isConnected) return;
    for (const m of list) for (const n of m.addedNodes) {
      if (n.nodeType !== 1 || isUi(n) || !(n.closest('.cdk-overlay-container') || n.matches(POPUP))) continue;
      // hộp thoại chặn màn hình và lớp nền mờ của nó không bao giờ là menu rê chuột
      if (n.matches('.cdk-overlay-backdrop,.cdk-global-overlay-wrapper') || n.closest('.cdk-global-overlay-wrapper') || n.querySelector('[aria-modal=true],mat-dialog-container,.cdk-global-overlay-wrapper')) continue;
      popups.push({ node: n, trig: capture(hoverEl), used: false });
      if (popups.length > 8) popups.shift();
      return;
    }
  });
  const mk = (tag, css, text) => { const e = document.createElement(tag); e.setAttribute('data-tourfp-ui', ''); e.style.cssText = css; if (text) e.textContent = text; return e; };
  const FONT = 'font:13px/1.4 system-ui,sans-serif;';
  const NARROW = innerWidth < 480;
  const panel = mk('div', `position:fixed;left:${NARROW ? 8 : 12}px;max-width:calc(100vw - 16px);box-sizing:border-box;bottom:${innerWidth < 768 ? 80 : 12}px;z-index:${Z + 2};background:#16181d;color:#fff;border:1px solid #3a3f4b;border-radius:10px;padding:8px 10px;display:flex;gap:8px;align-items:center;box-shadow:0 6px 24px rgba(0,0,0,.45);${FONT}`);
  const btnCss = `all:unset;cursor:pointer;white-space:nowrap;padding:5px ${NARROW ? 8 : 10}px;border-radius:6px;background:#2a2f3a;color:#fff;${FONT}`;
  const bRec = mk('button', btnCss, '● Ghi'), bPlay = mk('button', btnCss, '▶ Phát'), bClr = mk('button', btnCss, 'Xoá'), bSave = mk('button', btnCss, 'Lưu');
  const info = mk('span', `opacity:.8;min-width:${NARROW ? 0 : 170}px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap`, 'TourFP · 0 bước');
  const grip = mk('span', 'opacity:.5;font-size:16px;line-height:1;padding:0 2px', '⠿');
  panel.append(grip, bRec, bPlay, bClr, bSave, info);
  // kéo thanh điều khiển đi chỗ khác: nắm vào bất kỳ đâu trừ các nút; vị trí được nhớ trong phiên
  const POS = 'tourfp:pos';
  const moveTo = (x, y) => {
    panel.style.left = Math.max(0, Math.min(x, innerWidth - panel.offsetWidth)) + 'px';
    panel.style.top = Math.max(0, Math.min(y, innerHeight - panel.offsetHeight)) + 'px';
    panel.style.bottom = 'auto';
  };
  let drag = null;
  panel.style.cursor = 'move'; panel.style.userSelect = 'none'; panel.style.touchAction = 'none';
  panel.addEventListener('pointerdown', e => {
    if (e.target.closest('button')) return;
    const r = panel.getBoundingClientRect();
    drag = { dx: e.clientX - r.left, dy: e.clientY - r.top };
    panel.setPointerCapture(e.pointerId); e.preventDefault();
  });
  panel.addEventListener('pointermove', e => { if (drag) moveTo(e.clientX - drag.dx, e.clientY - drag.dy); });
  const endDrag = () => {
    if (!drag) return;
    drag = null;
    try { sessionStorage.setItem(POS, JSON.stringify([parseFloat(panel.style.left), parseFloat(panel.style.top)])); } catch (_) { /* không nhớ được thì thôi */ }
  };
  panel.addEventListener('pointerup', endDrag);
  panel.addEventListener('pointercancel', endDrag);
  const box = mk('div', `position:fixed;z-index:${Z};pointer-events:none;border:2px solid #ffb020;border-radius:6px;display:none;transition:all .08s`);
  const tip = mk('div', `position:fixed;z-index:${Z + 1};max-width:300px;background:#fff;color:#111;border-radius:8px;padding:10px 12px;display:none;pointer-events:none;box-shadow:0 8px 28px rgba(0,0,0,.4);${FONT}`); // chuột đi xuyên qua chú thích để menu rê chuột bên dưới không tự đóng
  const tipText = mk('div', 'margin-bottom:4px;white-space:pre-line');
  const tipMeta = mk('div', 'margin-bottom:8px;font-size:11px;opacity:.55');
  const bNext = mk('button', btnCss + 'pointer-events:auto;background:#e5484d;', 'Tiếp'), bStop = mk('button', btnCss + 'pointer-events:auto;background:#ddd;color:#111;margin-left:6px', 'Dừng');
  const bClose = mk('button', btnCss + 'pointer-events:auto;background:none;color:#666;margin-left:6px;display:none', 'Đóng');
  tip.append(tipText, tipMeta, bNext, bStop, bClose);
  // chế độ chỉ phát (chạy thử từ trang quản trị, hoặc mở trang với ?tourfp=<mã>): không hiện thanh ghi tour
  const PLAYER = !!window.TOURFP_PLAYER || new URLSearchParams(location.search).has('tourfp');
  if (PLAYER) panel.style.display = 'none';
  document.documentElement.append(box, tip, panel);
  try { const p = JSON.parse(sessionStorage.getItem(POS) || 'null'); if (p) moveTo(p[0], p[1]); } catch (_) { /* vị trí cũ không đọc được */ }

  const nameOf = fp => (fp.segs && fp.segs[0]) || fp.label || fp.icon || fp.key.name || fp.key.formcontrolname || fp.attr.placeholder || fp.tag;
  // hiển thị chữ lên giao diện; phần đặt trong «…» (tên đích, tên tour) thành chữ in đậm, bỏ dấu ngoặc
  const rich = (node, text) => {
    node.replaceChildren();
    String(text).split(/«([^»]*)»/).forEach((part, i) => {
      if (!part) return;
      if (i % 2) { const b = document.createElement('b'); b.style.fontWeight = '700'; b.textContent = part; node.append(b); } else node.append(part);
    });
  };
  const setBtns = (next, stop) => {
    bNext.textContent = next || ''; bNext.style.display = next ? '' : 'none';
    bStop.textContent = stop || ''; bStop.style.display = stop ? '' : 'none';
  };
  const setInfo = t => { rich(info, t || (recording ? `Đang ghi · ${steps.length} bước · Alt+bấm = chỉ tô sáng` : `TourFP · ${steps.length} bước`)); };
  function place() {
    if (!target || !target.isConnected) {
      box.style.display = 'none';
      // đích biến mất giữa chừng (ví dụ menu rê chuột tự đóng): quay lại bước rê chuột trước đó rồi chờ lại
      if (target && playing >= 0 && !advancing) {
        target = null;
        let back = playing;
        for (let k = playing - 1; k >= 0 && k >= playing - 3; k--) if (steps[k].kind === 'hover') { back = k; break; }
        show(back);
      }
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
    // menu bật ra (không phải hộp thoại chặn màn hình) đang chứa đích, nếu có
    const menu = playing >= 0 ? menuOf(target) : null;
    if (playing >= 0 && (menu || steps[playing].kind === 'hover')) {
      // đặt chú thích sát bên cạnh: cạnh đích ở bước rê chuột, cạnh ngoài của menu khi đích nằm trong menu (không che các mục khác)
      const a = menu ? menu.getBoundingClientRect() : r, w = tip.offsetWidth, h = tip.offsetHeight;
      const left = a.right + 12 + w <= innerWidth ? a.right + 12 : Math.max(8, a.left - w - 12);
      tip.style.left = left + 'px'; tip.style.top = Math.max(8, Math.min(r.top, innerHeight - h - 8)) + 'px';
    } else if (playing >= 0) {
      const below = r.bottom + 12 + tip.offsetHeight < innerHeight;
      tip.style.left = Math.max(8, Math.min(r.left, innerWidth - tip.offsetWidth - 8)) + 'px';
      tip.style.top = (below ? r.bottom + 12 : Math.max(8, r.top - tip.offsetHeight - 12)) + 'px';
    }
  }
  const loop = () => { place(); raf = requestAnimationFrame(loop); };
  const flash = c => { const old = box.style.borderColor; box.style.borderColor = c; setTimeout(() => { box.style.borderColor = old; }, 250); };

  // --- ghi: lấy dấu vân tay lúc nhấn xuống (trước khi app đổi DOM), ghi bước lúc bấm xong
  const onMove = e => {
    if (!recording || isUi(e.target)) return;
    target = clickableRoot(e.target);
    if (!e.target.closest(POPUP) && hoverEl !== target) { hoverEl = target; hoverT = performance.now(); }
  };
  const onDown = e => {
    if (isUi(e.target)) return;
    lastDown = performance.now();
    if (recording) {
      const el = clickableRoot(e.target);
      pending = { el, fp: capture(el) };
      if (e.altKey) e.stopImmediatePropagation();
    } else gate(e, false);
  };
  const onClick = e => {
    if (isUi(e.target)) return;
    if (!recording) return gate(e, true);
    if (e.timeStamp - lastCap < 80) return; // cú bấm lặp do nhãn chuyển tiếp sang ô nhập
    lastCap = e.timeStamp;
    const el = clickableRoot(e.target);
    const fp = pending && (pending.el === el || pending.el.contains(el) || el.contains(pending.el)) ? pending.fp : capture(el);
    pending = null;
    // phần tử không bấm được (tiêu đề, thẻ thông tin) thì là bước "chỉ tô sáng", khi phát có nút Tiếp
    const kind = e.altKey || !isClickable(el) ? 'info' : el.matches('input,textarea') ? 'input' : 'click';
    if (e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); }
    // đích nằm trong menu bật ra do rê chuột: chèn bước "rê chuột" vào trước
    const pop = popups.find(p => !p.used && p.node.isConnected && p.node.contains(el));
    if (pop) { for (const p of popups) if (p.node.contains(el) || pop.node.contains(p.node)) p.used = true; steps.push({ kind: 'hover', fp: pop.trig, note: '' }); }
    const step = { kind, fp, note: '' };
    steps.push(step);
    if (kind === 'click') watchEffect(step);
    flash('#3dd68c'); setInfo();
  };
  const isClickable = el => el.matches(SEMANTIC) || getComputedStyle(el).cursor === 'pointer';
  // cú bấm không làm đổi màn và không làm trang thay đổi gì thì hạ thành bước "chỉ tô sáng"
  const STATE_CLASS = /check|select|activ|expand|open|show|collaps/i;
  function watchEffect(step) {
    const before = context();
    let changed = false;
    const mo = new MutationObserver(list => {
      for (const m of list) {
        if (isUi(m.target)) continue;
        if (m.type === 'childList') {
          for (const n of [...m.addedNodes, ...m.removedNodes]) if (n.nodeType === 1 && !isUi(n) && !/ripple/i.test(n.className && n.className.baseVal === undefined ? n.className : '')) changed = true;
        } else if (m.attributeName === 'class') {
          const a = new Set((m.oldValue || '').split(/\s+/)), b = m.target.classList;
          for (const c of b) if (!a.has(c) && STATE_CLASS.test(c)) changed = true;
          for (const c of a) if (c && !b.contains(c) && STATE_CLASS.test(c)) changed = true;
        } else if (m.oldValue !== m.target.getAttribute(m.attributeName)) changed = true;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-checked', 'aria-selected', 'aria-expanded', 'aria-pressed'] });
    setTimeout(() => {
      mo.disconnect();
      step.after = context(); // màn hình sau cú bấm; ở bước cuối, đây là "màn cuối" của tour
      if (!changed && sameCtx(step.after, before)) { step.kind = 'info'; setInfo(); }
    }, 700);
  }
  const onUp = e => { if (recording && e.altKey && !isUi(e.target)) e.stopImmediatePropagation(); else if (!recording && !isUi(e.target)) gate(e, false); };

  // --- phát: chỉ cho bấm vào đích; bấm đúng đích ở bước "thao tác" thì sang bước sau
  function gate(e, isClick) {
    if (playing < 0 || !target) return;
    const st = steps[playing], inside = target.contains(e.target);
    if (inside && st.kind !== 'info' && st.kind !== 'hover') { if (isClick && st.kind === 'click') { const i = playing; advancing = true; setTimeout(() => { if (playing === i) show(i + 1); }, 300); } return; }
    e.stopImmediatePropagation();
    if (isClick) { e.preventDefault(); flash('#fff'); }
  }

  function record() {
    stopPlay(); recording = true; bRec.textContent = '■ Dừng ghi'; bRec.style.background = '#e5484d';
    box.style.borderColor = '#ffb020'; box.style.boxShadow = 'none';
    popups = []; hoverEl = null; popMo.observe(document.body, { childList: true, subtree: true });
    probe();
    setInfo(); cancelAnimationFrame(raf); loop();
  }
  function stop() { recording = false; pending = null; popMo.disconnect(); bRec.textContent = '● Ghi'; bRec.style.background = '#2a2f3a'; target = null; box.style.display = 'none'; cancelAnimationFrame(raf); setInfo(); }
  function stopPlay(msg) {
    token++; directRun++; playing = -1; atEnd = false; choice = null; bClose.style.display = 'none';
    if (fullSteps) { steps.length = 0; steps.push(...fullSteps); fullSteps = null; }
    tip.style.display = 'none'; box.style.display = 'none'; target = null; cancelAnimationFrame(raf); setInfo(msg);
  }

  // chờ đến khi màn hình của bước hiện ra và tìm được đích
  // alt: dấu vân tay của bước kế; nếu màn hình đã ở trạng thái của bước kế thì bỏ qua bước này
  // alts: các bước kế tiếp [{fp, idx}]. Nếu đích đang chờ không xuất hiện mà đích của một bước sau đã hiện ổn định
  // (bước này đã được làm sẵn, ví dụ menu đã mở rộng từ trước) thì trả về { skipTo: idx }.
  // menuOnly: chỉ nhận bước sau khi đích của nó nằm trong menu bật ra (dùng khi đang chờ người dùng rê chuột).
  function waitFind(fp, ms = 8000, alts = null, menuOnly = false) {
    const my = ++token;
    return new Promise(res => {
      const t0 = performance.now();
      let deb = 0, timer = 0, last = null, seenIdx = -1, seenT = 0;
      const mo = new MutationObserver(() => { clearTimeout(deb); deb = setTimeout(tryIt, 120); });
      const fin = r => { mo.disconnect(); clearInterval(timer); clearTimeout(deb); res(r); };
      function tryIt() {
        if (my !== token) return fin(null);
        last = find(fp);
        if (last.el) return fin(last);
        if (alts) {
          let hit = -1;
          for (const a of alts) { const r = find(a.fp); if (r.el && (!menuOnly || menuOf(r.el))) { hit = a.idx; break; } }
          if (hit < 0) seenIdx = -1;
          else if (hit !== seenIdx) { seenIdx = hit; seenT = performance.now(); }
          else if (performance.now() - seenT >= (menuOnly ? 400 : 1500)) return fin({ skipTo: hit });
        }
        if (performance.now() - t0 > ms) fin(last);
      }
      mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeFilter: ['class', 'style', 'hidden', 'aria-selected'] });
      timer = setInterval(tryIt, 600);
      tryIt();
    });
  }

  async function show(i) {
    if (i >= steps.length) return stopPlay(`Xong tour · ${steps.length} bước`);
    playing = i; target = null; advancing = false; box.style.display = 'none';
    const st = steps[i], nx = steps[i + 1], name = nameOf(st.fp), head = `Bước ${i + 1}/${steps.length}`;
    // bước rê chuột mà đích của bước sau đã hiện sẵn thì không cần rê nữa
    if (st.kind === 'hover' && nx && find(nx.fp).el) return show(i + 1);
    box.style.borderColor = '#e5484d'; box.style.boxShadow = '0 0 0 9999px rgba(0,0,0,.5)';
    tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px';
    // nút Tiếp chỉ có ở bước nhập và bước chỉ tô sáng; bước cần bấm hoặc rê chuột thì người dùng phải tự làm
    rich(tipText, `${head}: đang chờ màn hình…`); tipMeta.textContent = ''; setBtns(null, 'Dừng');
    setInfo(`${head}: đang tìm`);
    cancelAnimationFrame(raf); loop();
    const after = (from, n) => steps.slice(from, from + n).map((x, k) => ({ fp: x.fp, idx: from + k }));
    const r = await waitFind(st.fp, 8000, after(i + 1, 2));
    if (!r || playing !== i) return;
    if (r.skipTo != null) return show(r.skipTo);
    setInfo(`${head}: ${r.status}`);
    if (!r.el) {
      rich(tipText, `${head}: không tìm thấy «${name}»` + (r.expected ? `\nCần ở màn: ${r.expected.path} ${r.expected.dialog} ${r.expected.step}` : ''));
      tipMeta.textContent = r.status;
      return;
    }
    target = r.el;
    r.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    rich(tipText, `${head}: ` + (st.note || (st.kind === 'click' ? `Bấm vào «${name}» để tiếp tục` : st.kind === 'hover' ? `Rê chuột vào «${name}»` : st.kind === 'input' ? `Nhập vào ô «${name}», xong bấm Tiếp` : name)));
    tipMeta.textContent = `khớp ${Math.round(r.score * 100)}% · ${r.via} · ${r.ms} ms` + (r.status === 'ambiguous' ? ' · ⚠ mơ hồ' : '');
    // bước cuối: nút thành "Kết thúc". Bước có nút Tiếp thì chỉ còn một nút Kết thúc; bước phải tự bấm thì nút Dừng đổi tên.
    const lastStep = i === steps.length - 1, manual = st.kind === 'input' || st.kind === 'info';
    if (lastStep) setBtns(manual ? 'Kết thúc' : null, manual ? null : 'Kết thúc');
    else setBtns(manual ? 'Tiếp' : null, 'Dừng');
    // bước rê chuột: sang bước sau ngay khi đích của bước sau hiện ra
    if (st.kind === 'hover' && nx) {
      const r2 = await waitFind(nx.fp, 120000, after(i + 2, 2), true);
      if (r2 && playing === i) { if (r2.skipTo != null) show(r2.skipTo); else if (r2.el) show(i + 1); }
    }
  }
  // bước đầu tiên thuộc màn đang đứng (cùng đường dẫn, hộp thoại, bước); ưu tiên bước đã tìm thấy đích
  const sameCtx = (a, b) => a.path === b.path && a.dialog === b.dialog && a.step === b.step;
  function startIndex() {
    const c = context();
    let first = -1;
    for (let i = 0; i < steps.length; i++) {
      if (!sameCtx(steps[i].fp.ctx, c)) continue;
      if (first < 0) first = i;
      if (find(steps[i].fp).el) return i;
    }
    return first;
  }
  // màn đang đứng không có trong tour: đưa về màn của bước 1 rồi phát từ đầu
  const RESUME = 'tourfp:resume';
  function goStart() {
    // dấu hiệu app đã thật sự đổi màn: component đứng sau router-outlet khác đi
    const pageSig = () => { const o = document.querySelector('router-outlet'); return o && o.nextElementSibling ? o.nextElementSibling.tagName : ''; };
    const path = steps[0].fp.ctx.path, my = ++token, t0 = performance.now(), before = pageSig(), samePath = location.pathname === path;
    playing = 0; target = null; box.style.display = 'none';
    tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px'; bNext.style.display = 'none';
    rich(tipText, 'Màn này không có trong tour — đang về màn bắt đầu…'); tipMeta.textContent = path; setBtns(null, 'Dừng');
    try { sessionStorage.setItem(RESUME, JSON.stringify(steps)); } catch (_) { /* không lưu được thì thôi */ }
    // đang có hộp thoại mà bước 1 không nằm trong hộp thoại: thử đóng bằng phím Esc trước
    if (topDialog() && !steps[0].fp.ctx.dialog) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    // chuyển trang ngay trong app (không tải lại); nếu app không phản ứng thì tải lại và phát tiếp sau khi nạp
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    const timer = setInterval(() => {
      if (my !== token) return clearInterval(timer);
      if ((samePath || !before || pageSig() !== before) && sameCtx(context(), steps[0].fp.ctx) && find(steps[0].fp).el) { clearInterval(timer); try { sessionStorage.removeItem(RESUME); } catch (_) {} show(0); }
      else if (performance.now() - t0 > 3000) { clearInterval(timer); location.assign(path); }
    }, 200);
  }
  // đang đứng ở màn cuối và bước cuối đã làm xong: báo cho người dùng, cho chọn phát lại từ đầu
  let atEnd = false;
  function endNotice() {
    token++; playing = -1; target = null; atEnd = true; box.style.display = 'none'; cancelAnimationFrame(raf);
    tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px';
    rich(tipText, 'Bạn đang ở màn cuối của tour, bước cuối đã được thực hiện.'); tipMeta.textContent = '';
    setBtns('Phát lại từ đầu', 'Dừng');
    setInfo('Đang ở màn cuối của tour');
  }
  async function play() {
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào');
    atEnd = false;
    const c = context(), n = steps.length - 1, last = steps[n];
    let first = -1;
    for (let i = 0; i <= n; i++) {
      if (!sameCtx(steps[i].fp.ctx, c)) continue;
      if (first < 0) first = i;
      if (find(steps[i].fp).el) return show(i);
    }
    // không bước nào tìm thấy đích: nếu màn này là màn của (hoặc sau) bước cuối thì coi như đã ở cuối tour
    if ((last.after && sameCtx(last.after, c)) || sameCtx(last.fp.ctx, c)) {
      const r = sameCtx(last.fp.ctx, c) ? await waitFind(last.fp, 1500) : { el: null }; // chờ một nhịp phòng khi màn chưa vẽ xong
      if (!r) return;
      return r.el ? show(n) : endNotice();
    }
    if (first >= 0) show(first); else goStart();
  }

  // ---------- vào thẳng: thư viện tự làm các bước thay người dùng ----------
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  const navTo = path => { history.pushState({}, '', path); dispatchEvent(new PopStateEvent('popstate', { state: null })); };
  const pressEsc = () => document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
  // giả lập rê chuột: sự kiện "enter" không nổi bọt nên bắn riêng cho phần tử và vài cấp cha của nó
  function hoverOn(el) {
    for (const t of ['pointerover', 'mouseover', 'mousemove']) el.dispatchEvent(new MouseEvent(t, { bubbles: true, cancelable: true, view: window }));
    for (let p = el, i = 0; p && p !== document.body && i < 4; p = p.parentElement, i++) for (const t of ['pointerenter', 'mouseenter']) p.dispatchEvent(new MouseEvent(t, { bubbles: false, view: window }));
  }
  async function direct() {
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào');
    const my = ++directRun, alive = () => my === directRun;
    const n = steps.length, last = steps[n - 1];
    token++; playing = -1; target = null; atEnd = false; box.style.display = 'none'; cancelAnimationFrame(raf);
    tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px';
    const say = t => { rich(tipText, t); tipMeta.textContent = ''; setBtns(null, 'Dừng'); };
    say('Đang đưa bạn tới màn hình…');
    const finish = () => { say('Đã đưa bạn tới nơi.'); setBtns(null, null); setTimeout(() => { if (alive()) stopPlay('Đã tới nơi'); }, 1600); };

    // 1) Bước cuối chuyển sang một trang khác và không mở hộp thoại: vào thẳng trang đó bằng đường dẫn.
    const after = last.after;
    if (after && !after.dialog && !after.step && after.path !== last.fp.ctx.path) {
      if (topDialog()) pressEsc();
      if (location.pathname !== after.path) navTo(after.path);
      for (let t = 0; t < 15 && alive() && context().path !== after.path; t++) await sleep(200);
      if (!alive()) return;
      if (context().path !== after.path) return location.assign(after.path); // app không tự chuyển: tải thẳng trang đó
      return finish();
    }

    // 2) Còn lại: chỉ làm "chặng cuối", tức các bước liền nhau cùng đường dẫn với bước cuối. Các trang trước đó bỏ qua.
    let first = n - 1;
    while (first > 0 && steps[first - 1].fp.ctx.path === last.fp.ctx.path) first--;
    if (steps[first].fp.ctx.dialog) return play(); // chặng cuối bắt đầu trong một hộp thoại: không tới được bằng đường dẫn, quay về dẫn từng bước
    const c = context();
    let start = -1;
    for (let i = first; i < n && start < 0; i++) if (sameCtx(steps[i].fp.ctx, c) && find(steps[i].fp).el) start = i; // đang đứng sẵn giữa chặng
    if (start < 0) {
      if (topDialog()) pressEsc();
      if (location.pathname !== steps[first].fp.ctx.path) navTo(steps[first].fp.ctx.path);
      start = first;
    }
    for (let i = start; i < n; i++) {
      const st = steps[i];
      if (st.kind === 'info') continue; // bước chỉ để xem, không có gì phải làm
      say(`Đang đưa bạn tới màn hình… (${i + 1}/${n})`);
      const r = await waitFind(st.fp, 6000, steps.slice(i + 1, i + 3).map((x, k) => ({ fp: x.fp, idx: i + 1 + k })));
      if (!r || !alive()) return;
      if (r.skipTo != null) { i = r.skipTo - 1; continue; } // bước này đã được làm sẵn
      if (!r.el || st.kind === 'input') { directRun++; return show(i); } // không tự làm được (không thấy đích, hoặc cần người dùng nhập): dẫn từng bước từ đây
      if (st.kind === 'hover') hoverOn(r.el);
      else { r.el.scrollIntoView({ block: 'center', inline: 'nearest' }); r.el.click(); }
      await sleep(350);
      if (!alive()) return;
    }
    finish();
  }

  // Bắt đầu một lượt: mode 'guide' (dẫn từng bước, mặc định) hoặc 'direct' (vào thẳng); to = dừng sau bước thứ mấy (mặc định: hết tour).
  function start(opts = {}) {
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào');
    if (fullSteps) { steps.length = 0; steps.push(...fullSteps); fullSteps = null; }
    const to = Math.min(Math.max(parseInt(opts.to, 10) || steps.length, 1), steps.length);
    if (to < steps.length) { fullSteps = steps.slice(); steps.length = to; }
    return opts.mode === 'direct' ? direct() : play();
  }

  // ---------- máy chủ lưu tour (thư mục server/) ----------
  const SERVER = String(window.TOURFP_SERVER || 'http://localhost:8000').replace(/\/$/, '');
  // Chép vào clipboard NGAY trong cú bấm. Nhiều trang (kể cả TCInvest) từ chối quyền ghi clipboard kiểu mới,
  // nên chỉ còn cách cũ, và cách cũ chỉ chạy được khi đang ở trong một cú bấm của người dùng.
  function copyNow(text) {
    const ta = mk('textarea', 'position:fixed;left:0;top:0;opacity:0');
    ta.value = text; document.documentElement.append(ta); ta.select();
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (_) { /* không chép được */ }
    ta.remove();
    return ok;
  }
  // Máy chủ có gọi được không: null = chưa biết. Trang chặn kết nối ra ngoài thì kết quả không đổi, nên chỉ cần dò một lần.
  let serverOk = null;
  const setSaveMode = () => { bSave.textContent = serverOk === false ? 'Chép JSON' : 'Lưu'; };
  async function probe() {
    if (serverOk !== null) return;
    try { serverOk = (await fetch(SERVER + '/api/config')).ok; } catch (_) { serverOk = false; }
    setSaveMode();
  }
  // Gọi được máy chủ: hỏi tên rồi gửi tour lên. Không gọi được: nút thành "Chép JSON" và chép ngay trong cú bấm,
  // để dán vào hộp Thêm tour của trang quản trị.
  async function save() {
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào để lưu');
    if (serverOk === false) {
      return setInfo(copyNow(JSON.stringify(steps)) ? 'Đã chép JSON · dán vào Thêm tour ở trang quản trị' : 'Không chép được · dùng copy(TourFP.export()) trong console');
    }
    const name = (prompt('Tên tour:') || '').trim();
    if (!name) return;
    try {
      const r = await fetch(SERVER + '/api/tours', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name, steps }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      serverOk = true;
      setInfo(`Đã lưu «${name}»`);
    } catch (_) {
      serverOk = false; setSaveMode();
      setInfo('Không gọi được máy chủ · bấm Chép JSON');
    }
  }
  // tải một tour từ máy chủ theo mã rồi phát
  async function run(id, opts = {}) {
    const r = await fetch(`${SERVER}/api/tours/${encodeURIComponent(id)}`);
    if (!r.ok) throw new Error('HTTP ' + r.status);
    const t = await r.json();
    fullSteps = null; steps.length = 0; steps.push(...t.steps); setInfo();
    start(opts);
  }
  // Hỏi trợ lý trên máy chủ "muốn tới màn hình nào", rồi cho người dùng chọn: dẫn từng bước hay vào thẳng.
  async function ask(query) {
    let a;
    try {
      const r = await fetch(SERVER + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, layout: context().layout }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      a = await r.json();
    } catch (e) {
      a = { matched: false, reason: 'Không gọi được trợ lý.' };
    }
    stopPlay();
    tip.style.display = 'block'; tip.style.left = '12px'; tip.style.top = '12px'; tipMeta.textContent = '';
    bClose.style.display = '';
    if (!a.matched) { rich(tipText, a.reason || 'Chưa tìm thấy tour phù hợp.'); setBtns(null, null); choice = {}; return a; }
    rich(tipText, `«${a.tour.name}»` + (a.to_step < a.tour.step_count ? ` · tới bước ${a.to_step}/${a.tour.step_count}` : '') + '\n' + a.reason);
    setBtns(a.options[0].label, a.options[1].label);
    const go = mode => run(a.tour.id, { mode, to: a.to_step }).catch(() => { rich(tipText, 'Không tải được tour.'); });
    choice = { guide: () => go('guide'), direct: () => go('direct') };
    return a;
  }
  bSave.onclick = save;
  if (!PLAYER) probe(); // biết trước nên gửi hay chép, để cú bấm đầu tiên vào nút đã làm đúng việc
  bRec.onclick = () => (recording ? stop() : record());
  bPlay.onclick = play;
  bClr.onclick = () => { fullSteps = null; steps.length = 0; stopPlay(); };
  const pick = k => { const f = choice[k]; choice = null; bClose.style.display = 'none'; if (f) f(); };
  bNext.onclick = () => { if (choice) pick('guide'); else if (atEnd) { atEnd = false; goStart(); } else show(playing + 1); };
  bStop.onclick = () => { if (choice) pick('direct'); else stopPlay(); };
  bClose.onclick = () => stopPlay();
  const L = [['mousemove', onMove], ['pointerdown', onDown], ['mousedown', onUp], ['pointerup', onUp], ['mouseup', onUp], ['click', onClick]];
  for (const [n, h] of L) document.addEventListener(n, h, true);

  function destroy() {
    token++; cancelAnimationFrame(raf); popMo.disconnect();
    for (const [n, h] of L) document.removeEventListener(n, h, true);
    box.remove(); tip.remove(); panel.remove();
    delete window.TourFP;
  }

  window.TourFP = {
    capture, captureAt: el => capture(clickableRoot(el)), isClickable, save, run, start, direct, ask,
    showPanel: (on = true) => { panel.style.display = on ? 'flex' : 'none'; }, find, score, context, clickables, record, stop, play, destroy, steps,
    apiStats: () => ({ responses: api.responses, values: api.set.size }),
    isApiValue,
    state: () => ({ recording, playing, steps: steps.length, target: target ? nameOf(capture(target)) : null, tip: tip.style.display === 'block' ? tipText.textContent : '' }),
    export: () => JSON.stringify(steps, null, 2),
    load: a => { fullSteps = null; steps.length = 0; steps.push(...a); setInfo(); },
  };

  // vừa bị tải lại trang giữa lúc đưa về màn bắt đầu: nạp lại tour và phát tiếp (không điều hướng lần nữa)
  try {
    const saved = sessionStorage.getItem(RESUME);
    if (saved) {
      sessionStorage.removeItem(RESUME);
      steps.push(...JSON.parse(saved)); setInfo();
      setTimeout(() => { const i = startIndex(); show(i >= 0 ? i : 0); }, 800);
    }
  } catch (_) { /* không đọc được thì bỏ qua */ }

  // mở trang với ?tourfp=<mã>[&mode=guide|direct][&to=<bước>]: tải tour đó từ máy chủ và chạy luôn
  const qs = new URLSearchParams(location.search), wanted = qs.get('tourfp');
  if (wanted && !steps.length) run(wanted, { mode: qs.get('mode'), to: qs.get('to') }).catch(() => setInfo('Không tải được tour ' + wanted));
})();
