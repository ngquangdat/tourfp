/* TourFP — bản thử: ghi tour theo thao tác và khớp phần tử bằng "dấu vân tay".
 * - Không dùng class/id. Không phụ thuộc thư viện.
 * - Chữ lấy từ API (tên, tên kế hoạch…) và chữ số bị loại khỏi dấu vân tay.
 *   Để lọc được, file này phải được nạp TRƯỚC khi app gọi API (đặt trong <head>).
 * - Ghi: bấm bình thường = bước "thao tác" (cú bấm vẫn chạy, app chuyển màn như thật);
 *        Alt+bấm = bước "chỉ tô sáng" (cú bấm bị chặn).
 * - Phát: tô sáng đích, chờ người dùng tự bấm rồi mới sang bước sau; tự chờ màn mới hiện ra.
 *   start({ mode: 'guide' | 'direct', to }) chạy tới bước thứ `to`: dẫn từng bước, hoặc thư viện tự đưa tới nơi.
 * - Cấu hình (đặt trước khi nạp): window.TOURFP_SERVER = địa chỉ máy chủ lưu tour; window.TOURFP_PLAYER = true để ẩn thanh ghi;
 *   window.TOURFP_MATCH_INFO = true để hiện dòng kỹ thuật "khớp 93% · scan · 7 ms" dưới lời hướng dẫn (mặc định ẩn);
 *   window.TOURFP_BACK = true để có nút "Quay lại" trên thẻ hướng dẫn (mặc định tắt).
 * - Lượt chạy của khách (dẫn từng bước hay vào thẳng): khi kết thúc, thư viện bắn sự kiện tourfp:run trên window với toàn bộ dữ liệu
 *   lượt (ẩn danh). Thư viện KHÔNG tự gọi mạng; trang tích hợp nghe sự kiện và gửi detail lên POST /api/runs của máy chủ quản trị
 *   (qua backend của mình, vì CSP của trang thường không cho gọi thẳng). Tắt bằng window.TOURFP_LOG = false.
 *   Chạy thử của người quản trị không bắn sự kiện, trừ khi start({ log: true }) (lượt được đánh dấu "chạy thử").
 * API: TourFP.record() | stop() | play() | start(opts) | load(steps) | export() | save() | run(id, opts) | ask(query)
 *      | capture(el) | find(fp) | showPanel(on) | destroy()
 */
(function tourfp() {
  if (typeof window === 'undefined' || typeof document === 'undefined') return; // được import ở phía máy chủ (SSR, công cụ build): không làm gì
  // App Angular (zone.js): mọi hẹn giờ, MutationObserver, sự kiện tạo trong zone của Angular đều làm app chạy change detection.
  // Thư viện theo dõi DOM liên tục, mà change detection lại đổi DOM (NgClass đổi class…), nên hai bên kích nhau thành vòng lặp
  // không dứt và trang đứng hẳn. Vì vậy thư viện luôn chạy ngoài zone của Angular, ở zone gốc.
  const rootZone = () => window.Zone && window.Zone.root;
  { const z = rootZone(); if (z && window.Zone.current !== z) return z.run(tourfp); }
  const outside = f => function () { const z = rootZone(); return z && window.Zone.current !== z ? z.run(f, this, arguments) : f.apply(this, arguments); };
  if (window.TourFP) window.TourFP.destroy();

  const VERSION = '0.3.26';
  const W = { label: 40, key: 25, attr: 12, icon: 20, tag: 8, role: 5, comp: 15, anchor: 15, pos: 5 };
  const THRESHOLD = 0.6, MARGIN = 0.08, Z = 2147483000;
  // id và data-testid: chỉ nhận giá trị ổn định (bộ lọc ở capture() bỏ id tự sinh như mat-input-3, cdk-overlay-0, ...-12345)
  const KEY = ['id', 'data-testid', 'formcontrolname', 'name', 'data-walkthrough'], BONUS = new Set(['id', 'data-testid']);
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
  // Nằm hẳn ngoài màn hình theo chiều ngang mà không có khung cuộn ngang nào đưa nó vào được: đó là ngăn kéo/bảng trượt đang đóng
  // (hoặc bản sao ẩn của nó). Người dùng không thấy và không bấm được, nên coi như chưa có trên màn.
  function offscreen(e) {
    const r = e.getBoundingClientRect();
    if (r.right > 0 && r.left < innerWidth) return false;
    for (let p = e.parentElement; p && p !== document.documentElement; p = p.parentElement) {
      if (p.scrollWidth > p.clientWidth + 4) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll') return false; }
    }
    return document.documentElement.scrollWidth <= innerWidth + 4;
  }
  const tagOf = e => e.tagName.toLowerCase();

  // ---------- giá trị từ API: nghe mọi phản hồi JSON, nhớ các chuỗi trong đó ----------
  const api = window.__tourfpApi || (window.__tourfpApi = { set: new Set(), responses: 0, hooked: false, feed: null });
  const API_MAX = 30000, IGNORE_URL = /i18n|\/assets\/|locale|translat/i; // file dịch là chữ cố định, không tính
  const keyOf = s => norm(s).toLowerCase();
  function feed(v, depth) {
    if (v == null || depth > 12 || api.set.size >= API_MAX) return;
    if (typeof v === 'string') { const s = keyOf(v); if (s.length >= 2 && s.length <= 120 && hasLetters(s)) { api.set.add(s); if (/\d/.test(s)) api.set.add(stripNum(s)); } }
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
  // ---------- dữ liệu cá nhân: không bao giờ được nằm trong tour ----------
  // Thư viện có thể được nạp sau khi app đã gọi API hồ sơ, nên không thể chỉ dựa vào việc "nghe" phản hồi. Thêm hai nguồn:
  //  - những gì app lưu trong localStorage/sessionStorage (hồ sơ, token đăng nhập có tên bên trong): chỉ dùng để nhận ra dữ liệu
  //    cá nhân, không dùng để phân loại nhãn (ở đó có cả chữ cố định của app);
  //  - hình dạng của chuỗi: họ tên người Việt, email.
  const priv = new Set();
  function feedPriv(v, depth) {
    if (v == null || depth > 8 || priv.size >= 5000) return;
    if (typeof v === 'string') {
      if (v.length > 120) { // token dạng a.b.c: phần giữa là JSON chứa tên, email
        const p = v.split('.');
        if (p.length === 3 && p[1].length < 4000) try { feedPriv(JSON.parse(decodeURIComponent(escape(atob(p[1].replace(/-/g, '+').replace(/_/g, '/'))))), depth + 1); } catch (_) { /* không phải token */ }
        else if (v.length < 20000 && /^[[{]/.test(v)) try { feedPriv(JSON.parse(v), depth + 1); } catch (_) { /* không phải JSON */ }
        return;
      }
      if (/^[[{]/.test(v)) { try { return feedPriv(JSON.parse(v), depth + 1); } catch (_) { /* chuỗi thường */ } }
      const k = keyOf(v);
      if (k.length >= 4 && hasLetters(k) && k.includes(' ')) priv.add(k); // chỉ giữ chuỗi nhiều từ (họ tên, địa chỉ); từ đơn dễ trùng nhãn
    } else if (Array.isArray(v)) for (const x of v.slice(0, 50)) feedPriv(x, depth + 1);
    else if (typeof v === 'object') for (const k in v) feedPriv(v[k], depth + 1);
  }
  function readStores() {
    for (const st of [window.localStorage, window.sessionStorage]) {
      try { for (let i = 0; i < st.length && i < 200; i++) { const k = st.key(i); if (!/^tourfp|i18n|lang|locale|translat/i.test(k)) feedPriv(st.getItem(k), 0); } } catch (_) { /* không đọc được thì thôi */ }
    }
  }
  readStores();
  // chỉ các họ hiếm khi là từ thường trong giao diện (bỏ Hồ, Lý, Cao, Hà, Mai…: "Hồ Sơ", "Lý Do" là nhãn); phần còn lại nhờ nguồn thứ nhất
  const SURNAME = /^(nguy[eễ]n|tr[aầ]n|l[eê]|ph[aạ]m|ho[aà]ng|hu[yỳ]nh|phan|v[uũ]|v[oõ]|[dđ][aặ]ng|b[uù]i|[dđ][oỗ]|ng[oô]|tr[iị]nh|qu[aá]ch|tr[uư][oơ]ng)$/i;
  const CAP = /^[A-ZÀ-ỸĐ][A-Za-zÀ-ỹĐđ]*$/;
  function looksPersonal(v) {
    v = norm(v);
    if (/[^\s@]+@[^\s@]+\.[a-z]{2,}/i.test(v)) return true;
    const w = v.replace(/^(xin chào|chào|hi|hello)[,!]?\s+/i, '').split(' ');
    // họ tên: 2–5 từ đều viết hoa chữ đầu (hoặc viết hoa hết), từ đầu là một họ phổ biến
    return w.length >= 2 && w.length <= 5 && SURNAME.test(w[0]) && w.every(x => CAP.test(x));
  }
  const isPersonal = v => looksPersonal(v) || priv.has(keyOf(v));
  // "là dữ liệu": giá trị API hoặc dữ liệu cá nhân
  const isData = v => isApiValue(v) || isPersonal(v);
  function isApiValue(piece) {
    const k = keyOf(piece);
    if (api.set.has(k)) return true;
    for (const s of api.set) if (s.length >= 4 && s.length * 2 >= k.length && k.includes(s)) return true;
    return false;
  }

  // ---------- tín hiệu ----------
  // Tách chữ của phần tử thành các mẩu, mỗi dòng chữ một mẩu. Chữ số được thay bằng # chứ không cắt bỏ:
  // "1M" → "#M", "% EPS 1 năm" → "% EPS # năm", "0.0 tr" → "# tr". Dòng chỉ có số ("82.9%") thì bỏ.
  function pieces(e) {
    const out = [], num = [];
    let digits = false, nodes = 0;
    const w = document.createTreeWalker(e, NodeFilter.SHOW_TEXT);
    // chỉ cần vài mẩu đầu: với khối lớn (thẻ, bảng) đó là tiêu đề
    for (let n; (n = w.nextNode()) && nodes < 40 && out.length < 6;) {
      const v = n.nodeValue;
      if (!v.trim() || (n.parentElement && n.parentElement.closest('svg,script,style,mat-icon,.material-icons'))) continue;
      nodes++;
      const d = /\d/.test(v);
      if (d) digits = true;
      const t = stripNum(v);
      if (t.length >= 2 && hasLetters(t)) { out.push(t.slice(0, 60)); num.push(d); }
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
    if (p) return p.getAttribute('href') || p.getAttribute('xlink:href') || 'd:' + hash(p.getAttribute('d') || '');
    // icon vẽ bằng hình cơ bản, không có path (ví dụ nút ⋮ gồm ba hình tròn): lấy dấu của chính các hình đó
    const shapes = [...i.querySelectorAll('circle,rect,ellipse,line,polygon,polyline')].slice(0, 8);
    if (!shapes.length) return '';
    const A = ['cx', 'cy', 'r', 'x', 'y', 'width', 'height', 'rx', 'points', 'x1', 'y1', 'x2', 'y2'];
    return 'g:' + hash(shapes.map(x => x.tagName + A.map(a => x.getAttribute(a) || '').join(',')).join('|'));
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
      layout: innerWidth < 1024 ? 'mobile' : 'desktop', // theo breakpoint lg của app (Tailwind: lg = 1024px)
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
    for (let p = e.parentElement; p && p !== document.body && getComputedStyle(p).cursor === 'pointer' && textKids(p) <= 1; p = p.parentElement) {
      const b = p.getBoundingClientRect();
      if (!b.width || !b.height) break; // thẻ bọc không có kích thước: tô sáng nó sẽ không thấy gì
      if (b.width * b.height > 0.4 * innerWidth * innerHeight) break; // chiếm phần lớn màn hình: đó là vùng chứa, không phải nút
      // cha còn chứa nút, ô nhập, icon hay ảnh khác: đó là một thanh gom nhiều thứ bấm được (thanh trên cùng, thanh bộ lọc), không phải một nút
      const cur = e;
      if ([...p.querySelectorAll('input,textarea,select,button,a[href],[role=button],img,svg,mat-icon,tcbs-icon')].some(x => !cur.contains(x) && !x.contains(cur) && visible(x))) break;
      e = p;
    }
    return e;
  }

  // "hình dáng" vị trí của phần tử: chuỗi thẻ từ nó lên 5 cấp cha. Các dòng của cùng một bảng có chung chuỗi này.
  const sigOf = e => {
    const out = [];
    for (let p = e, i = 0; p && p !== document.body && i < 6; p = p.parentElement, i++) out.push(tagOf(p) + (p.getAttribute('role') ? '[' + p.getAttribute('role') + ']' : ''));
    return out.join('<');
  };
  const textOf = e => { const t = e.textContent || ''; return t.length > 400 ? '' : norm(t); };
  // Nhãn "mềm": mẩu chữ trùng với một giá trị trong phản hồi API. Nó có thể là dữ liệu của riêng người dùng (tên, tên kế hoạch)
  // hoặc là nhãn cố định mà API cũng trả về ("MUA", "Kỹ thuật"). Không biết chắc, nên: có trên phần tử thì cộng điểm,
  // không có thì không trừ điểm.
  function softHit(fp, e) {
    if (!fp.soft || !fp.soft.length) return false;
    const c = stripNum(textOf(e));
    if (!c) return false;
    for (const x of fp.soft) if (!c.includes(x)) return false;
    return lettersLen(fp.soft.join('')) * 2 >= lettersLen(c); // khối chứa nhiều chữ khác thì không tính
  }
  // "cùng loại" với đích: cùng thẻ, cùng icon, cùng thuộc tính khoá, cùng nhãn. Dùng chung cho lúc ghi và lúc phát,
  // để nhóm các phần tử lặp lại (các dòng của bảng) luôn được dựng theo đúng một cách.
  function sameKind(fp, e) {
    if (isUi(e) || !visible(e) || tagOf(e) !== fp.tag || iconOf(e) !== fp.icon) return false;
    for (const k in fp.key) if (e.getAttribute(k) !== fp.key[k]) return false;
    if (fp.soft && fp.soft.length) { if (!softHit(fp, e)) return false; }
    else if (fp.label && labelScore(fp, e) < 0.9) return false;
    // bản ghi từ v4 không đếm phần tử nằm ngoài màn vào nhóm; bản ghi cũ đã đếm cả chúng nên giữ nguyên cách đếm để thứ tự không lệch
    return fp.v >= 4 ? !offscreen(e) : true;
  }
  // các phần tử khác cùng loại với đích (không tính phần tử bọc ngoài hay nằm trong đích)
  function twinsOf(fp, el) {
    const out = [];
    for (const r of roots()) for (const e of r.querySelectorAll(fp.tag)) if (e !== el && !e.contains(el) && !el.contains(e) && sameKind(fp, e)) out.push(e);
    return out;
  }
  // Nhóm các phần tử cùng loại và cùng "hình dáng" vị trí, theo thứ tự trên trang. Khi nhiều lớp lồng nhau cùng khớp
  // (khối bọc và chữ bên trong nó), chỉ giữ lớp ngoài cùng, để mỗi mục của danh sách được đếm đúng một lần.
  function kindGroup(fp, sig) {
    const all = [];
    for (const r of roots()) for (const e of r.querySelectorAll(fp.tag)) if (sameKind(fp, e) && sigOf(e) === sig) all.push(e);
    const set = new Set(all);
    return all.filter(e => { for (let p = e.parentElement; p; p = p.parentElement) if (set.has(p)) return false; return true; });
  }

  // bản "trần" của dấu vân tay: bỏ phần chữ, chỉ còn cấu trúc (thẻ, icon, thuộc tính khoá). Dùng để dựng nhóm các dòng dữ liệu.
  const bare = fp => Object.assign({}, fp, { soft: [], segs: [], label: '' });
  const innerOf = (fp, g, sig) => [...g.querySelectorAll(fp.tag)].filter(x => sameKind(fp, x) && sigOf(x) === sig);
  function capture(el) {
    const fp = { v: 4, tag: tagOf(el), role: el.getAttribute('role') || '', label: '', segs: [], soft: [], exact: '', mixed: false, dyn: 0, cover: 1, key: {}, attr: {}, icon: iconOf(el), comp: compChain(el), anchor: '', anchorSkip: 0, pos: posOf(el), hint: '', ctx: context() };
    // tiêu đề khối đứng trước: lấy mẩu đầu tiên không phải giá trị API, và nhớ vị trí của nó để lúc khớp đọc đúng mẩu đó
    const ac = anchorCands(el), ai = ac.findIndex((v, i) => !ac.data[i] && !isData(v));
    if (ai >= 0) { fp.anchor = ac[ai]; fp.anchorSkip = ai; }
    const attrLabel = el.getAttribute('aria-label') || el.getAttribute('title') || el.getAttribute('placeholder') || el.getAttribute('alt');
    if (attrLabel && !isPersonal(attrLabel)) fp.label = stripNum(attrLabel).slice(0, 60);
    else if (!attrLabel && !el.matches('mat-select,select,[role=combobox]')) { // ô chọn hiển thị giá trị đang chọn, không phải nhãn: bỏ qua chữ của nó
      const p = pieces(el);
      if (p.all.length) {
        const stat = [], soft = [];
        for (const x of p.all) (isData(x) ? soft : stat).push(x);
        const big = p.all.length > 2; // khối chứa nhiều chữ: chỉ giữ hai mẩu đầu (tiêu đề), phần sau thường là dữ liệu
        fp.segs = stat.slice(0, big ? 2 : 5);
        if (!fp.segs.length) fp.soft = soft.slice(0, 2); // không có mẩu cố định nào: dùng mẩu "mềm" làm nhãn tuỳ chọn
        const used = fp.segs.length ? fp.segs : fp.soft;
        fp.label = used.join(' ').slice(0, 60);
        fp.dyn = soft.length; // số mẩu chữ trùng giá trị API
        fp.mixed = soft.length > 0 || p.digits || big;
        fp.cover = +(lettersLen(used.join('')) / lettersLen(norm(el.textContent))).toFixed(2);
      }
      // chữ nguyên văn có con số ("1M", "Bước 2"): dùng để phân xử giữa các phần tử chỉ khác nhau ở con số
      const own = textOf(el);
      if (own && own.length <= 40 && /\d/.test(own) && hasLetters(own) && !isPersonal(own)) fp.exact = own;
    }
    // thuộc tính khoá: bỏ giá trị sinh tự động (mat-radio-group-0, mat-input-3, chuỗi có nhiều chữ số), vì mỗi lần tải một khác
    for (const k of KEY) { const v = el.getAttribute(k); if (v && !/\d{3,}/.test(v) && !LIB.test(v) && !/[-_]\d+$/.test(v) && !(BONUS.has(k) && idHasData(v))) fp.key[k] = v; }
    for (const k of SOFT) { const v = el.getAttribute(k); if (v && v.length <= 80) fp.attr[k] = k === 'href' ? v.split('?')[0] : stripNum(v); }
    // số phần tử khác trên màn cùng loại với đích (ví dụ ba nút bút chì, các nút MUA của bảng)
    fp.twins = 0;
    {
      // Phần tử có chữ, icon hoặc thuộc tính khoá: bản sao là mọi phần tử cùng loại trên màn.
      // Phần tử không có gì để nhận diện (ô chỉ chứa số): bản sao là các phần tử cùng thẻ ở cùng "hình dáng" vị trí, tức các ô khác của lưới.
      // Phần tử chỉ có chữ là dữ liệu (mã chứng khoán, tên quỹ): chữ đó không dùng để nhận diện được (người khác, ngày khác sẽ khác),
      // nên cũng coi như không có gì để nhận diện: bản sao là các phần tử cùng cấu trúc, và sẽ ghi theo thứ tự.
      const loose = !hasStrong(fp) && fp.soft.length > 0, base = loose ? bare(fp) : fp;
      const twins = hasStrong(fp) ? twinsOf(fp, el) : kindGroup(base, sigOf(el)).filter(g => g !== el && !g.contains(el) && !el.contains(g));
      fp.twins = twins.length;
      if (twins.length) {
        // Tiêu đề khối đứng trước chỉ phân biệt được các bản sao khi cả ba điều đúng:
        //  - nó nằm bên trong chính "đơn vị lặp" chứa đích (một dòng của bảng, một mục của form), không phải chữ của dòng bên cạnh;
        //  - nó là nhãn, không phải dữ liệu (mã, số liệu);
        //  - không bản sao nào khác có tiêu đề y hệt.
        // Nếu không, đây là danh sách sinh từ dữ liệu: nhận diện bằng thứ tự, "nút thứ mấy trong danh sách".
        const sig = sigOf(el), peer = twins.find(e => sigOf(e) === sig);
        let byAnchor = !!fp.anchor && !loose;
        if (byAnchor && peer) {
          let unit = el;
          while (unit.parentElement && !unit.parentElement.contains(peer)) unit = unit.parentElement;
          const inner = anchorCands(el, unit), j = inner.indexOf(fp.anchor);
          byAnchor = j >= 0 && !inner.data[j];
        }
        // (so với mọi mẩu chữ đứng trước bản sao, không chỉ mẩu ở cùng vị trí: các ô của một dòng thấy tên dòng ở những vị trí khác nhau)
        if (byAnchor) byAnchor = !twins.slice(0, 300).some(e => anchorCands(e).some(v => sim(fp.anchor, v)));
        if (!byAnchor) {
          const group = kindGroup(base, sig);
          fp.sig = sig;
          fp.nth = Math.max(0, group.findIndex(g => g === el || g.contains(el)));
          if (loose) fp.loose = 1;
          // đích nằm bên trong một mục của nhóm (khối bọc cùng "hình dáng"): nhớ nó là phần tử thứ mấy trong mục đó
          const g = group[fp.nth];
          if (g && g !== el && g.contains(el)) { const k = innerOf(base, g, sig).indexOf(el); if (k >= 0) fp.sub = k; }
          fp.anchor = ''; fp.anchorSkip = 0;
        }
      }
    }
    fp.hint = hintOf(fp);
    return fp;
  }
  // id / data-testid ghép từ dữ liệu (btn-mua-TCB, row-ke-hoach-A): một mẩu trùng giá trị API hay thông tin cá nhân là bỏ,
  // vì người khác, ngày khác sẽ mang id khác
  const idHasData = v => isData(v) || v.split(/[-_:.\s]+/).some(p => p.length >= 2 && hasLetters(p) && isData(p));
  // chọn nhanh theo khoá đầu tiên (id trước): một phần tử khớp là lấy luôn, khỏi quét cả trang
  const hintOf = fp => { const k0 = Object.keys(fp.key)[0]; return k0 ? (fp.comp[0] ? fp.comp[0] + ' ' : '') + fp.tag + '[' + k0 + '="' + CSS.escape(fp.key[k0]) + '"]' : ''; };

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
    const c = fp.v >= 3 ? stripNum(t) : norm(t);
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
    if (fp.soft && fp.soft.length) { if (softHit(fp, e)) add(W.label, 1); } // nhãn mềm: có thì cộng, không có thì không trừ
    else if (fp.label) add(W.label, labelScore(fp, e));
    // id / data-testid: phần tử không còn thuộc tính đó (app bỏ id đi) thì không trừ điểm; mang giá trị khác thì là phần tử khác
    for (const k in fp.key) { const v = e.getAttribute(k); if (v == null && BONUS.has(k)) continue; add(W.key, v === fp.key[k]); }
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
    if (fp.label && !(fp.soft && fp.soft.length) && labelScore(fp, e)) return true;
    for (const k in fp.key) if (e.getAttribute(k) === fp.key[k]) return true;
    if (fp.icon && iconOf(e) === fp.icon) return true;
    return false;
  }
  // nhãn mềm không tính là tín hiệu mạnh: nó có thể vắng mặt ở người dùng khác
  const hasStrong = fp => !!((fp.label && !(fp.soft && fp.soft.length)) || fp.icon || Object.keys(fp.key).length);

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
      hits = hits.filter(h => visible(h) && !offscreen(h));
      if (hits.length === 1) { const s = score(fp, hits[0]); if (s >= THRESHOLD) return done({ status: 'ok', el: hits[0], score: s, margin: 1, via: 'hint', scanned: 1 }); }
    }
    // Đích được ghi theo thứ tự trong danh sách. Dựng lại đúng nhóm như lúc ghi (cùng loại, cùng "hình dáng", lớp ngoài cùng),
    // rồi: nếu trong nhóm chỉ đúng một phần tử có chữ nguyên văn như lúc ghi ("1M") thì lấy nó; nếu không thì lấy cái thứ nth.
    if (fp.nth != null && fp.sig) {
      const base = fp.loose ? bare(fp) : fp;
      const group = kindGroup(base, fp.sig);
      let same = fp.exact ? group.filter(g => textOf(g) === fp.exact) : [];
      // dòng dữ liệu: nếu đúng một dòng còn mang chữ như lúc ghi (cùng mã) thì đi theo dòng đó, không thì lấy theo thứ tự
      let byText = same.length === 1 ? fp.exact : '';
      if (!byText && fp.loose) { same = group.filter(g => softHit(fp, g)); if (same.length === 1) byText = fp.soft.join(' '); }
      const rep = byText ? same[0] : group[fp.nth];
      if (!rep || offscreen(rep)) return done({ status: 'not-found', score: 0, scanned: group.length, need: fp.nth + 1, have: group.length });
      // trong mục đó, trả về đúng lớp đã ghi (có thể là lớp bên trong)
      let pick = rep, top = score(fp, rep);
      if (fp.sub != null) { const x = innerOf(base, rep, fp.sig)[fp.sub]; if (x) { pick = x; top = score(fp, x); } }
      else for (const x of rep.querySelectorAll(fp.tag)) if (sameKind(base, x)) { const v = score(fp, x); if (v > top) { pick = x; top = v; } }
      // Lấy theo thứ tự mà số phần tử trong nhóm đã khác lúc ghi: danh sách đã đổi (thêm, bớt, một mục đang mở rộng), không còn chắc
      // "thứ n" vẫn là mục cũ. Vẫn dẫn tới đó (danh sách sinh từ dữ liệu thì số dòng đổi là bình thường) nhưng báo ra để bên gọi biết.
      const drift = !byText && fp.twins != null && group.length !== fp.twins + 1;
      return done({ status: 'ok', el: pick, score: top, margin: 1, via: (byText ? 'chữ «' + byText + '»' : 'thứ ' + (fp.nth + 1) + '/' + group.length) + (drift ? ' (lúc ghi có ' + (fp.twins + 1) + ')' : ''), drift, scanned: group.length });
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
    // ứng viên đủ điểm nhưng nằm ngoài màn (ngăn kéo đang đóng) thì loại hẳn: chờ tới khi nó thật sự hiện ra
    { const live = ranked.filter(c => c.score < THRESHOLD || !offscreen(c.el)); ranked.length = 0; ranked.push(...live); }
    for (const c of ranked) c.adj = c.score;
    for (const c of ranked.slice(0, 8)) c.adj = c.score * reach(c.el);
    ranked.sort((a, b) => b.adj - a.adj);
    // Phân xử giữa các ứng viên ngang điểm: nếu có ứng viên mang đúng chữ nguyên văn lúc ghi (kể cả con số: "1M" chứ không phải "3M"),
    // các ứng viên còn lại bị xếp sau. Không ứng viên nào mang đúng chữ đó (con số đã đổi) thì không ai bị trừ.
    if (fp.exact) {
      const hit = ranked.filter(c => c.score >= THRESHOLD && textOf(c.el) === fp.exact);
      if (hit.length) { for (const c of ranked) if (!hit.includes(c)) c.adj *= 0.85; ranked.sort((a, b) => b.adj - a.adj); }
    }
    // ứng viên lồng nhau (nút và chữ bên trong nó) là cùng một đích, không tính là mơ hồ
    let best = ranked[0];
    // giữa một phần tử và khối cha của chính nó thì chọn theo điểm gốc, không để hệ số "bị che" quyết định
    if (best) for (const c of ranked) if (c !== best && c.score > best.score && (c.el.contains(best.el) || best.el.contains(c.el))) best = c;
    const second = best && ranked.find((c, i) => i > 0 && !best.el.contains(c.el) && !c.el.contains(best.el));
    if (!best || best.score < THRESHOLD) return done({ status: 'not-found', score: best ? best.score : 0, scanned });
    const margin = best.adj - (second ? second.adj : 0);
    return done({ status: margin >= MARGIN ? 'ok' : 'ambiguous', el: best.el, score: best.score, margin, via: 'scan', scanned, top: ranked.slice(0, 3) });
  }

  // danh sách phần tử bấm được đang hiện (dùng cho kiểm thử)
  function clickables() {
    const out = new Set();
    for (const r of roots()) {
      for (const e of r.querySelectorAll(SEMANTIC)) if (visible(e) && !isUi(e) && !offscreen(e)) out.add(e);
      for (const e of r.querySelectorAll('div,span,li,td,tcbs-icon,mat-icon,img')) {
        if (!visible(e) || isUi(e) || e.closest(SEMANTIC) || offscreen(e)) continue;
        if (getComputedStyle(e).cursor === 'pointer' && getComputedStyle(e.parentElement).cursor !== 'pointer') out.add(e);
      }
    }
    return [...out];
  }

  // ---------- giao diện ghi và phát ----------
  const steps = []; // { kind: 'click' | 'hover' | 'input' | 'info', fp, note, title?, desc? } — desc: mô tả hiện dưới lời hướng dẫn
  let recording = false, playing = -1, raf = 0, target = null, token = 0, pending = null, lastCap = 0;
  let hoverEl = null, hoverT = 0, lastDown = 0, popups = [], advancing = false;
  let resumeAt = -1; // bước đang dở của lượt phát gần nhất (-1: không có)
  let directRun = 0, fullSteps = null, choice = null; // lượt "vào thẳng" đang chạy; bản đầy đủ của tour khi chỉ chạy tới bước x; hai lựa chọn đang chờ
  // khi đang ghi: menu bật ra do rê chuột (không phải do bấm) thì nhớ phần tử đang được rê lên
  const popMo = new MutationObserver(list => {
    // Thứ bật ra là do bấm (không phải do rê chuột) khi cú bấm xảy ra sau lúc chuột đi vào phần tử đang rê, tức chuột vẫn nằm
    // trên chỗ vừa bấm; hoặc khi nó hiện ra gần như tức thì sau cú bấm. Rê sang một phần tử khác rồi menu mới bật ra thì là do rê.
    if (!recording || performance.now() - lastDown < 250 || lastDown > hoverT || !hoverEl || !hoverEl.isConnected) return;
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
  // Thẻ theo thiết kế: rộng 200px, đệm 12px, các khối cách nhau 16px, bo 8px, bóng "Card shadow/lg", chữ Roboto 14px/18px
  const tip = mk('div', `position:fixed;z-index:${Z + 1};width:200px;max-width:calc(100vw - 24px);box-sizing:border-box;display:none;flex-direction:column;align-items:stretch;gap:16px;background:#fff;color:#1f2329;border-radius:8px;padding:12px;pointer-events:none;filter:drop-shadow(0 2px 8px rgba(0,0,0,.20));font:400 14px/18px Roboto,system-ui,sans-serif`); // chuột đi xuyên qua chú thích để menu rê chuột bên dưới không tự đóng
  const tipArrow = mk('div', 'position:absolute;width:14px;height:14px;background:#fff;transform:rotate(45deg);border-radius:2px;display:none;pointer-events:none');
  const tipHead = mk('div', 'display:flex;align-items:center;justify-content:space-between;min-height:24px');
  const tipStep = mk('span', 'background:#f2f3f5;color:#222;font-size:12px;font-weight:500;font-variant-numeric:tabular-nums;padding:3px 8px;border-radius:6px;line-height:1.25;display:none');
  const bClose = mk('button', 'all:unset;box-sizing:border-box;pointer-events:auto;cursor:pointer;color:#3c4043;width:24px;height:24px;margin-left:auto;display:flex;align-items:center;justify-content:center;border-radius:6px');
  bClose.setAttribute('aria-label', 'Đóng');
  {
    const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    svg.setAttribute('width', '18'); svg.setAttribute('height', '18'); svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('fill', 'none'); svg.setAttribute('stroke', 'currentColor'); svg.setAttribute('stroke-width', '2.2'); svg.setAttribute('stroke-linecap', 'round');
    const p = document.createElementNS('http://www.w3.org/2000/svg', 'path');
    p.setAttribute('d', 'M18 6L6 18M6 6l12 12');
    svg.append(p);
    bClose.append(svg);
  }
  tipHead.append(tipStep, bClose);
  const tipText = mk('div', 'font:400 14px/18px Roboto,system-ui,sans-serif;color:#1f2329;white-space:pre-line');
  const tipMeta = mk('div', 'margin-top:-10px;font-size:11px;line-height:14px;opacity:.55;display:none');
  const tipFoot = mk('div', 'display:none;gap:8px;align-items:center;justify-content:flex-end');
  const btnCardCss = 'all:unset;box-sizing:border-box;pointer-events:auto;cursor:pointer;min-height:36px;padding:8px 10px;border-radius:8px;font:600 13px/1.25 Roboto,system-ui,sans-serif;text-align:center;display:flex;align-items:center;justify-content:center;';
  const bPrev = mk('button', btnCardCss + 'flex:1;background:#f5f5f5;color:#222;border:1px solid #d9d9d9;display:none', 'QUAY LẠI');
  const bNext = mk('button', btnCardCss + 'flex:1;background:#c52b23;color:#fff;border:1px solid #c52b23;display:none', 'TIẾP TỤC');
  tipFoot.append(bPrev, bNext);
  tip.append(tipArrow, tipHead, tipText, tipMeta, tipFoot);
  // chế độ chỉ phát (chạy thử từ trang quản trị, hoặc mở trang với ?tourfp=<mã>): không hiện thanh ghi tour
  const PLAYER = !!window.TOURFP_PLAYER || new URLSearchParams(location.search).has('tourfp');
  if (PLAYER) panel.style.display = 'none';

  // ---------- ghi lại lượt chạy của khách ----------
  // Một lượt = từ lúc start()/play()/direct() tới khi xong, khách bấm Dừng, kẹt, hay rời trang. Khi kết thúc, thư viện bắn sự kiện
  // tourfp:run (detail = dữ liệu lượt: bản thư viện, bản build của app, từng bước tới đâu, kẹt ở đâu). Thư viện không tự gọi mạng:
  // trang tích hợp nghe sự kiện rồi gửi lên POST /api/runs của máy chủ quản trị theo cách của mình (CSP của trang thường chặn gọi
  // thẳng ra ngoài). Ẩn danh: không có gì nhận ra khách, không có chữ trên trang, chỉ pathname. Không ghi khi: window.TOURFP_LOG
  // = false; đang dùng thanh ghi (người quản trị); trình duyệt do máy khác điều khiển (kiểm thử tự động); chạy thử qua bookmark.
  const TRIP_KEY = 'tourfp:trip';
  // forceLog: người quản trị chạy thử có chọn "Ghi lượt chạy này" (start({ log: true })): ghi dù là bookmark hay Playwright, đánh dấu "chạy thử"
  let trip = null, tourMeta = { id: '', name: '' }, viaBookmark = false, forceLog = false;
  const canLog = () => forceLog || (window.TOURFP_LOG !== false && PLAYER && !navigator.webdriver && !viaBookmark);
  const rid = () => { const a = new Uint8Array(12); crypto.getRandomValues(a); return Array.from(a, b => b.toString(16).padStart(2, '0')).join(''); };
  const uaShort = () => {
    const u = navigator.userAgent, m = /Edg\/(\d+)/.exec(u) || /OPR\/(\d+)/.exec(u) || /Chrome\/(\d+)/.exec(u) || /Firefox\/(\d+)/.exec(u) || /Version\/(\d+).*Safari/.exec(u);
    const b = m ? ({ Edg: 'Edge', OPR: 'Opera', Chrome: 'Chrome', Firefox: 'Firefox', Version: 'Safari' })[m[0].split('/')[0]] + ' ' + m[1] : 'Trình duyệt khác';
    const os = /Windows/.test(u) ? 'Windows' : /iPhone|iPad/.test(u) ? 'iOS' : /Android/.test(u) ? 'Android' : /Mac OS/.test(u) ? 'macOS' : /Linux/.test(u) ? 'Linux' : '';
    return b + (os ? ' · ' + os : '');
  };
  function tripBegin(mode, to) {
    if (!canLog() || trip) return;
    const all = fullSteps || steps;
    trip = { id: rid(), tour_id: tourMeta.id, tour_name: tourMeta.name, tour_hash: hash(all.map(x => x.kind + ':' + nameOf(x.fp)).join('|')), mode, to: to || null, total: all.length, source: forceLog ? 'trial' : '',
      status: 'running', failed_step: null, lib: VERSION, app: {}, layout: context().layout, ua: uaShort(), width: innerWidth, height: innerHeight,
      path: location.pathname, started_at: Date.now() / 1000, finished_at: null, steps: [] };
    const t = trip; appVersion().then(a => { t.app = a; }).catch(() => {});
  }
  // ghi hoặc cập nhật dòng của bước i
  function tripStep(i, data) {
    if (!trip || !steps[i]) return;
    let x = trip.steps.find(y => y.n === i + 1);
    if (!x) { x = { n: i + 1, kind: steps[i].kind, name: String(steps[i].title || nameOf(steps[i].fp)).slice(0, 80) }; trip.steps.push(x); }
    Object.assign(x, data, { at: +((Date.now() / 1000 - trip.started_at)).toFixed(1) });
    if (data.result === 'found' || data.result === 'done' || data.result === 'skipped') { if (trip.failed_step === i + 1) { trip.failed_step = null; trip.status = 'running'; } }
  }
  // kết quả một lần chờ đích, rút gọn để gửi
  const tripFind = (r, waited) => r.skipTo != null ? { result: 'skipped' }
    : { result: r.status === 'ok' ? 'found' : r.status, waited: Math.round(waited || 0), score: r.score != null ? +r.score.toFixed(3) : undefined, via: r.via ? String(r.via).slice(0, 60) : undefined, drift: !!r.drift, ctx: ctxOf(context()), expected: r.status === 'ok' ? undefined : ctxOf(r.expected) };
  const ctxOf = c => c ? { path: c.path, dialog: c.dialog, step: c.step } : undefined;
  // các bước đã tìm thấy trước bước i (kể cả i): khách đã làm xong (vì tour mới đi tiếp được)
  const tripDone = i => { if (trip) for (const x of trip.steps) if (x.n <= i + 1 && x.result === 'found') x.result = 'done'; };
  const tripSkip = (from, to) => { for (let k = from; k < to; k++) tripStep(k, { result: 'skipped' }); };
  // mốc giữa chừng (đang chờ đích quá lâu, sai bố cục): gửi ngay nhưng lượt vẫn tiếp tục; bản cuối sẽ ghi đè
  function tripMark(status, failed) { if (!trip) return; trip.status = status; if (failed != null) trip.failed_step = failed + 1; tripSend(trip); }
  function tripEnd(status, failed) {
    if (!trip) return;
    const t = trip; trip = null;
    t.status = status; if (failed != null) t.failed_step = failed + 1; t.finished_at = Date.now() / 1000;
    // dừng hay rời trang khi đang chờ một bước: ghi bước đó là chỗ kẹt
    const last = t.steps[t.steps.length - 1];
    if (t.failed_step == null && status !== 'done' && last && !/^(done|found|skipped)$/.test(last.result)) t.failed_step = last.n;
    // bản build của app có thể chưa đọc xong (fetch ngsw.json): chờ tối đa một nhịp
    Promise.race([appVersion(), new Promise(r => setTimeout(r, 1000))]).then(a => { if (a) t.app = a; tripSend(t); }).catch(() => tripSend(t));
  }
  // Giao lượt cho trang tích hợp. detail là bản sao, trang có sửa cũng không ảnh hưởng lượt đang chạy (lượt "đang chờ" còn gửi tiếp).
  function tripSend(t) {
    try { window.dispatchEvent(new CustomEvent('tourfp:run', { detail: JSON.parse(JSON.stringify(t)) })); } catch (_) { /* trình duyệt cũ */ }
  }
  // thư viện tự tải lại trang (về màn bắt đầu): giữ lượt qua lần tải, không tính là khách rời trang
  const tripStash = () => { if (!trip) return; try { sessionStorage.setItem(TRIP_KEY, JSON.stringify(trip)); } catch (_) {} trip = null; };
  try { const v = sessionStorage.getItem(TRIP_KEY); if (v) { sessionStorage.removeItem(TRIP_KEY); trip = JSON.parse(v); } } catch (_) { /* không đọc được thì bỏ qua */ }
  addEventListener('pagehide', () => { if (trip) { const t = trip; trip = null; t.status = 'left'; t.finished_at = Date.now() / 1000; const last = t.steps[t.steps.length - 1]; if (t.failed_step == null && last && !/^(done|found|skipped)$/.test(last.result)) t.failed_step = last.n; tripSend(t); } });
  // Gắn giao diện vào trang. Khi thư viện được nạp trước cả lúc trang có thẻ <html> (chèn ở "document start"), chờ tới khi có.
  // Lớp phủ khi "vào thẳng": làm mờ cả trang trong lúc thư viện tự bấm qua các bước, để người dùng không thấy từng màn lóe lên.
  // Chặn luôn thao tác tay trong lúc đi; cú bấm của thư viện là bấm bằng mã nên không bị cản.
  const cover = mk('div', `position:fixed;inset:0;z-index:${Z};display:none;background:rgba(14,15,18,.35);backdrop-filter:blur(14px);-webkit-backdrop-filter:blur(14px)`);
  const coverOn = () => { cover.style.display = 'block'; };
  const coverOff = () => { cover.style.display = 'none'; };
  const mount = () => document.documentElement.append(cover, box, tip, panel);
  if (document.documentElement) mount();
  else new MutationObserver((_, mo) => { if (document.documentElement) { mo.disconnect(); mount(); } }).observe(document, { childList: true });
  try { const p = JSON.parse(sessionStorage.getItem(POS) || 'null'); if (p) moveTo(p[0], p[1]); } catch (_) { /* vị trí cũ không đọc được */ }

  const nameOf = fp => fp.exact || (fp.segs && fp.segs[0]) || (fp.soft && fp.soft[0]) || fp.label || fp.attr.placeholder
    || (fp.icon && !/^[dg]:/.test(fp.icon) && !/[\/#.]/.test(fp.icon) ? fp.icon : '') // tên icon đọc được ("close"), không phải mã băm hay đường dẫn
    || (fp.anchor ? 'nút ở mục ' + fp.anchor : 'phần tử được tô sáng');
  // hiển thị chữ lên giao diện; phần đặt trong «…» (tên đích, tên tour) thành chữ in đậm, bỏ dấu ngoặc
  const rich = (node, text) => {
    node.replaceChildren();
    String(text).split(/«([^»]*)»/).forEach((part, i) => {
      if (!part) return;
      if (i % 2) { const b = document.createElement('b'); b.style.fontWeight = '700'; b.textContent = part; node.append(b); } else node.append(part);
    });
  };
  const setMeta = (t, isRich) => {
    if (!t) { tipMeta.textContent = ''; tipMeta.style.display = 'none'; return; }
    if (isRich) rich(tipMeta, t); else tipMeta.textContent = t;
    tipMeta.style.display = 'block';
  };
  const setBtns = (next, prev, badge) => {
    tipStep.textContent = badge || ''; tipStep.style.display = badge ? '' : 'none';
    bNext.textContent = next || ''; bNext.style.display = next ? 'flex' : 'none';
    bPrev.textContent = prev || ''; bPrev.style.display = prev ? 'flex' : 'none';
    tipFoot.style.display = next || prev ? 'flex' : 'none';
    if (next && !prev) {
      bNext.style.flex = '0 1 auto'; bNext.style.minWidth = 'calc(50% - 6px)'; bNext.style.marginLeft = 'auto';
    } else {
      bNext.style.flex = '1'; bNext.style.minWidth = '0'; bNext.style.marginLeft = '';
    }
  };
  const hideArrow = () => { tipArrow.style.display = 'none'; };
  const showNoticeTip = () => { hideArrow(); tip.style.display = 'flex'; tip.style.left = '12px'; tip.style.top = '12px'; };
  const setInfo = t => { rich(info, t || (recording ? `Đang ghi · ${steps.length} bước · Alt+bấm = chỉ tô sáng` : `TourFP · ${steps.length} bước`)); };
  function place() {
    if (!target || !target.isConnected) {
      box.style.display = 'none';
      hideArrow();
      // đích biến mất giữa chừng (ví dụ menu rê chuột tự đóng): quay lại bước rê chuột trước đó rồi chờ lại
      if (target && playing >= 0 && !advancing) {
        target = null;
        let back = playing;
        if (steps[playing].kind !== 'hover') for (let k = playing - 1; k >= 0 && k >= playing - 3; k--) if (steps[k].kind === 'hover') { back = k; break; }
        show(back, back === playing ? playingBack : false);
      }
      return;
    }
    const r = target.getBoundingClientRect();
    Object.assign(box.style, { display: 'block', left: r.left - 4 + 'px', top: r.top - 4 + 'px', width: r.width + 8 + 'px', height: r.height + 8 + 'px' });
    const clamp = (v, lo, hi) => Math.max(lo, Math.min(v, hi));
    const setArrow = (side, pos) => {
      Object.assign(tipArrow.style, { display: 'block', top: '', bottom: '', left: '', right: '' });
      tipArrow.style[side] = '-6px';
      tipArrow.style[side === 'top' || side === 'bottom' ? 'left' : 'top'] = Math.round(pos) + 'px';
    };
    // menu bật ra (không phải hộp thoại chặn màn hình) đang chứa đích, nếu có
    const menu = playing >= 0 ? menuOf(target) : null;
    if (playing >= 0 && (menu || steps[playing].kind === 'hover')) {
      // đặt chú thích sát bên cạnh: cạnh đích ở bước rê chuột, cạnh ngoài của menu khi đích nằm trong menu (không che các mục khác)
      const a = menu ? menu.getBoundingClientRect() : r, w = tip.offsetWidth, h = tip.offsetHeight;
      const left = a.right + 14 + w <= innerWidth - 8 ? a.right + 14 : Math.max(12, a.left - w - 14);
      const top = clamp(r.top, 12, Math.max(12, innerHeight - h - 12));
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      const oy = (Math.max(top, r.top) + Math.min(top + h, r.bottom)) / 2;
      if (left >= a.right) setArrow('left', clamp(oy - top - 7, 18, Math.max(18, h - 32)));
      else if (left + w <= a.left) setArrow('right', clamp(oy - top - 7, 18, Math.max(18, h - 32)));
      else hideArrow();
    } else if (playing >= 0) {
      const w = tip.offsetWidth, h = tip.offsetHeight;
      const left = clamp(r.left, 12, Math.max(12, innerWidth - w - 12));
      // Không bao giờ để chú thích đè lên đích: thử dưới đích, trên đích, rồi sát đáy màn hình. Đích cao gần hết màn hình
      // (khối lớn) thì không chỗ nào tránh được: đặt sát đáy, phần trên của đích vẫn nhìn thấy và bấm được.
      const clear = y => y >= 12 && y + h <= innerHeight - 12 && (y >= r.bottom + 4 || y + h <= r.top - 4);
      const y = [r.bottom + 14, r.top - h - 14, innerHeight - h - 12].find(clear);
      const top = y != null ? y : Math.max(12, innerHeight - h - 12);
      tip.style.left = left + 'px'; tip.style.top = top + 'px';
      const ox = (Math.max(left, r.left) + Math.min(left + w, r.right)) / 2;
      if (top >= r.bottom) setArrow('top', clamp(ox - left - 7, 18, Math.max(18, w - 32)));
      else if (top + h <= r.top) setArrow('bottom', clamp(ox - left - 7, 18, Math.max(18, w - 32)));
      else hideArrow();
    }
  }
  let lastWatch = 0;
  const loop = () => { place(); const t = performance.now(); if (t - lastWatch > 300) { lastWatch = t; watchStep(); } raf = requestAnimationFrame(loop); };
  const flash = c => { box.style.borderColor = c; setTimeout(() => { box.style.borderColor = recording ? '#ffb020' : 'transparent'; }, 250); };

  // --- ghi: lấy dấu vân tay lúc nhấn xuống (trước khi app đổi DOM), ghi bước lúc bấm xong
  const onMove = e => {
    if (!recording || isUi(e.target)) return;
    target = clickableRoot(e.target);
    noteHover(e.target, target);
  };
  // Ghi nhận phần tử đang được rê lên. Gọi cả ở mouseover: sự kiện này đến TRƯỚC mouseenter của app, nên khi menu rê chuột bật ra
  // ngay trong mouseenter thì bộ theo dõi popup đã biết chuột đang ở phần tử nào (mousemove đến sau, lúc đó đã muộn).
  function noteHover(raw, root) {
    if (!raw.closest || raw.closest(POPUP) || hoverEl === root) return;
    hoverEl = root; hoverT = performance.now();
  }
  const onOver = e => { if (recording && !isUi(e.target)) noteHover(e.target, clickableRoot(e.target)); };
  const onDown = e => {
    if (isUi(e.target)) return;
    lastDown = performance.now();
    if (recording) {
      const el = clickableRoot(e.target);
      pending = { el, fp: capture(el), x: e.clientX, y: e.clientY, t: performance.now(), alt: e.altKey, clickable: isClickable(el) };
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
    if (e.altKey) { e.preventDefault(); e.stopImmediatePropagation(); }
    commit(el, fp, e.altKey);
  };
  // thêm một bước vào tour
  // acted = true: cú bấm đã được app xử lý ngay lúc nhấn xuống (phần tử có thể đã bị gỡ), nên chắc chắn là bước "bấm"
  function commit(el, fp, alt, acted) {
    // phần tử không bấm được (tiêu đề, thẻ thông tin) thì là bước "chỉ tô sáng", khi phát có nút Tiếp
    // Phần tử trông không bấm được (không có con trỏ tay) vẫn có thể được app gắn sự kiện bấm: cứ ghi là "bấm" rồi theo dõi,
    // không thấy tác dụng gì thì mới hạ thành "chỉ tô sáng" (khi phát có nút Tiếp).
    const kind = alt ? 'info' : acted ? 'click' : el.matches('input,textarea') ? 'input' : 'click';
    // đích nằm trong menu bật ra do rê chuột: chèn bước "rê chuột" vào trước
    const pop = popups.find(p => !p.used && p.node.isConnected && p.node.contains(el));
    if (pop) { for (const p of popups) if (p.node.contains(el) || pop.node.contains(p.node)) p.used = true; steps.push({ kind: 'hover', fp: pop.trig, note: '' }); }
    const step = { kind, fp, note: '' };
    steps.push(step);
    // bước đầu của tour mang phiên bản trang lúc ghi
    if (!steps[0].app) { const first = steps[0]; appVersion().then(a => { if (!first.app) first.app = a; }); }
    if (kind === 'click' && !acted) watchEffect(step, !isClickable(el));
    if (acted) setTimeout(() => { step.after = context(); }, 700); // thay đổi đã xảy ra rồi: chỉ cần ghi lại màn hình sau cú bấm
    flash('#3dd68c'); setInfo();
  }
  const isClickable = el => el.matches(SEMANTIC) || getComputedStyle(el).cursor === 'pointer';
  // cú bấm không làm đổi màn và không làm trang thay đổi gì thì hạ thành bước "chỉ tô sáng"
  const STATE_CLASS = /check|select|activ|expand|open|show|collaps/i;
  // strict: phần tử trông không bấm được. Trang có số liệu nhảy liên tục, nên chỉ tin các thay đổi rõ ràng: màn hình đổi,
  // trạng thái chọn/mở đổi, lớp phủ bật ra, hoặc cả một khối được vẽ thêm hay gỡ đi. Thay đổi lặt vặt và việc cuộn thì không tính.
  function watchEffect(step, strict) {
    const before = context();
    let changed = false;
    const bigNode = (n, m) => !strict || !!(m.target.closest && m.target.closest('.cdk-overlay-container')) || n.matches(POPUP) || n.querySelectorAll('*').length >= 3;
    const mo = new MutationObserver(list => {
      for (const m of list) {
        if (isUi(m.target)) continue;
        if (m.type === 'childList') {
          for (const n of [...m.addedNodes, ...m.removedNodes]) if (n.nodeType === 1 && !isUi(n) && !/ripple/i.test(n.className && n.className.baseVal === undefined ? n.className : '') && bigNode(n, m)) changed = true;
        } else if (m.attributeName === 'class') {
          const a = new Set((m.oldValue || '').split(/\s+/)), b = m.target.classList;
          for (const c of b) if (!a.has(c) && STATE_CLASS.test(c)) changed = true;
          for (const c of a) if (c && !b.contains(c) && STATE_CLASS.test(c)) changed = true;
        } else if (m.oldValue !== m.target.getAttribute(m.attributeName)) changed = true;
      }
    });
    mo.observe(document.body, { childList: true, subtree: true, attributes: true, attributeOldValue: true, attributeFilter: ['class', 'aria-checked', 'aria-selected', 'aria-expanded', 'aria-pressed'] });
    const onScroll = () => { if (!strict) changed = true; }; // cú bấm làm trang cuộn tới một mục cũng là có tác dụng
    document.addEventListener('scroll', onScroll, true);
    setTimeout(() => {
      mo.disconnect(); document.removeEventListener('scroll', onScroll, true);
      step.after = context(); // màn hình sau cú bấm; ở bước cuối, đây là "màn cuối" của tour
      if (!changed && sameCtx(step.after, before)) { step.kind = 'info'; setInfo(); }
    }, 700);
  }
  const onUp = e => {
    if (isUi(e.target)) return;
    if (!recording) return gate(e, false);
    if (e.altKey) e.stopImmediatePropagation();
    // Nhả chuột tại chỗ mà không có sự kiện click theo sau (app đã xử lý lúc nhấn xuống rồi gỡ phần tử đi): vẫn ghi thành một bước,
    // bằng dấu vân tay đã lấy lúc nhấn xuống. Kéo thả hay cuộn (chuột đã di chuyển) thì không ghi.
    if (e.type !== 'pointerup' || !pending) return;
    const p = pending;
    if (Math.hypot(e.clientX - p.x, e.clientY - p.y) > 8 || performance.now() - p.t > 800) return;
    setTimeout(() => {
      if (!recording || pending !== p) return;
      pending = null; lastCap = performance.now();
      // chỉ coi là "đã được xử lý lúc nhấn xuống" khi phần tử vốn bấm được và giờ đã biến mất khỏi trang
      commit(p.el, p.fp, p.alt, p.clickable && !p.el.isConnected);
    }, 150);
  };

  // --- phát: chỉ cho bấm vào đích; bấm đúng đích ở bước "thao tác" thì sang bước sau
  function gate(e, isClick) {
    if (playing < 0 || !target) return;
    const st = steps[playing], inside = target.contains(e.target);
    // một hộp thoại không chứa đích đang che màn hình (quảng cáo, thông báo): để người dùng thao tác trong nó mà đóng đi
    const d = topDialog();
    if (d && !d.contains(target) && e.target.closest && (d.contains(e.target) || e.target.closest('.cdk-overlay-container'))) return;
    // bước "chỉ tô sáng": không chặn cú bấm vào chính đích (nếu nó có tác dụng thì bộ theo dõi bên dưới sẽ dẫn tiếp), nhưng không tự sang bước
    if (inside && st.kind === 'info') return;
    if (inside && st.kind !== 'hover') { if (isClick && st.kind === 'click' && !advancing) { const i = playing, seq = showId; advancing = true; setTimeout(() => { if (playing === i && showId === seq) show(i + 1); }, 300); } return; }
    e.stopImmediatePropagation();
    if (isClick) { e.preventDefault(); flash('#fff'); }
  }

  // ---------- phiên bản của trang đích ----------
  // Tour gắn với phiên bản trang lúc ghi, để khi kiểm thử biết tour đang chạy trên bản mới hơn, cũ hơn hay cùng bản.
  //  - version: số phiên bản do trang khai báo (window.TOURFP_APP_VERSION, hoặc thẻ meta app-version / version), nếu có;
  //  - build: tên file chính của bản build Angular (main-XXXX.js), đổi mỗi lần triển khai;
  //  - builtAt: thời điểm build ghi trong /ngsw.json (service worker của Angular), để so bản nào mới hơn;
  //  - ng: phiên bản Angular.
  let appVer = null;
  function appVersion() {
    if (appVer) return appVer;
    appVer = (async () => {
      const meta = n => { const m = document.querySelector(`meta[name="${n}"]`); return m ? (m.content || '').trim() : ''; };
      const out = { version: String(window.TOURFP_APP_VERSION || meta('app-version') || meta('version') || meta('build-version') || '').slice(0, 40), build: '', builtAt: 0, ng: '' };
      for (const e of document.querySelectorAll('script[src]')) {
        const m = /\/(main)[.-]([A-Za-z0-9_]{6,})\.js(\?|$)/.exec(e.src);
        if (m) { out.build = m[1] + '-' + m[2]; break; }
      }
      const ngEl = document.querySelector('[ng-version]');
      if (ngEl) out.ng = ngEl.getAttribute('ng-version') || '';
      try {
        const r = await fetch('/ngsw.json', { cache: 'no-store' });
        if (r.ok && /json/.test(r.headers.get('content-type') || '')) { const j = await r.json(); if (typeof j.timestamp === 'number') out.builtAt = j.timestamp; }
      } catch (_) { /* trang không có service worker: chỉ còn tên bản build */ }
      return out;
    })();
    return appVer;
  }
  function record() {
    stopPlay(); recording = true; bRec.textContent = '■ Dừng ghi'; bRec.style.background = '#e5484d';
    box.style.borderColor = '#ffb020'; box.style.boxShadow = 'none';
    popups = []; hoverEl = null; popMo.observe(document.body, { childList: true, subtree: true });
    probe(); appVersion();
    setInfo(); cancelAnimationFrame(raf); loop();
  }
  function stop() { recording = false; pending = null; popMo.disconnect(); bRec.textContent = '● Ghi'; bRec.style.background = '#2a2f3a'; target = null; box.style.display = 'none'; cancelAnimationFrame(raf); setInfo(); }
  function stopPlay(msg) {
    tripEnd('stopped'); coverOff();
    token++; showId++; directRun++; playing = -1; atEnd = false; choice = null; resumeAt = -1;
    if (fullSteps) { steps.length = 0; steps.push(...fullSteps); fullSteps = null; }
    hideArrow(); tip.style.display = 'none'; box.style.display = 'none'; target = null; cancelAnimationFrame(raf); setInfo(msg);
    playingBack = false; lastNext = -300;
  }

  const sure = fp => { try { return find(fp).status === 'ok'; } catch (_) { return false; } }; // tìm thấy và không mơ hồ (dò lỗi thì coi như chưa thấy)
  // chờ đến khi màn hình của bước hiện ra và tìm được đích (kết quả mơ hồ không tính là tìm được)
  // alt: dấu vân tay của bước kế; nếu màn hình đã ở trạng thái của bước kế thì bỏ qua bước này
  // alts: các bước kế tiếp [{fp, idx}]. Nếu đích đang chờ không xuất hiện mà đích của một bước sau đã hiện ổn định
  // (bước này đã được làm sẵn, ví dụ menu đã mở rộng từ trước) thì trả về { skipTo: idx }.
  // menuOnly: chỉ nhận bước sau khi đích của nó nằm trong menu bật ra (dùng khi đang chờ người dùng rê chuột).
  function waitFind(fp, ms = 8000, alts = null, menuOnly = false) {
    const my = ++token;
    return new Promise(res => {
      const t0 = performance.now();
      let deb = 0, timer = 0, stop = 0, last = null, seenIdx = -1, seenT = 0, done = false;
      const mo = new MutationObserver(() => { clearTimeout(deb); deb = setTimeout(tryIt, 120); });
      const fin = r => { if (done) return; done = true; mo.disconnect(); clearInterval(timer); clearTimeout(deb); clearTimeout(stop); res(r); };
      // Hết giờ là trả kết quả, kể cả khi việc dò bị lỗi hay trang bận (API lỗi, màn hình vẽ dở): người gọi luôn nhận được câu trả lời.
      stop = setTimeout(() => fin(my !== token ? null : last || { status: 'not-found', score: 0 }), ms);
      let rest = 0; // trang nặng: lần dò tốn bao lâu thì nghỉ gấp ba lâu như thế, để app còn vẽ màn và hẹn giờ còn chạy
      function tryIt() {
        if (done) return;
        const a = performance.now();
        if (a < rest) { clearTimeout(deb); deb = setTimeout(tryIt, rest - a); return; }
        try { look(); } catch (_) { if (performance.now() - t0 > ms) fin(last || { status: 'not-found', score: 0 }); } // dò lỗi thì coi như chưa thấy
        const b = performance.now(); rest = b + 3 * (b - a);
      }
      function look() {
        if (my !== token) return fin(null);
        last = find(fp);
        if (last.status === 'ok') return fin(last);
        if (alts) {
          let hit = -1;
          for (const a of alts) { const r = find(a.fp); if (r.status === 'ok' && (!menuOnly || menuOf(r.el))) { hit = a.idx; break; } }
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

  // hộp thoại đang che màn hình mà không bước nào của tour diễn ra trong nó (quảng cáo, thông báo bất chợt)
  // Hộp thoại "của tour": có bước diễn ra trong nó, hoặc nó là màn hình sau cú bấm của một bước (ví dụ bước cuối mở hộp thoại
  // Nộp tiền: đó chính là màn đích của tour, không phải hộp thoại lạ).
  const foreignDialog = () => {
    const d = topDialog(); if (!d) return false;
    const k = dialogKey(d);
    return !steps.some(s => s.fp.ctx.dialog === k || (s.after && s.after.dialog === k));
  };
  // Tạm ngừng dẫn cho tới khi người dùng đóng hộp thoại lạ, rồi phát tiếp từ đúng chỗ. Không chặn cú bấm nào, không tải lại trang.
  // Tour ghi cho bố cục nào (điện thoại / máy tính): lấy theo bước đầu. Khác bố cục đang dùng thì các phần tử là của giao diện
  // khác hẳn, không tìm thấy là chắc chắn: báo thẳng lý do thay vì "không tìm thấy phần tử".
  const LAYOUT = { mobile: 'điện thoại', desktop: 'máy tính' };
  function layoutClash() {
    const want = steps.length && steps[0].fp && steps[0].fp.ctx && steps[0].fp.ctx.layout, have = context().layout;
    return want && LAYOUT[want] && want !== have ? { want, have } : null;
  }
  // Báo sai bố cục và chờ: người dùng đổi kích thước cửa sổ (hoặc xoay máy) cho đúng thì tự chạy tiếp bằng `again`.
  function holdForLayout(again) {
    const c = layoutClash(), my = ++token;
    showId++;
    tripMark('wrong-layout');
    playing = -1; target = null; box.style.display = 'none'; cancelAnimationFrame(raf);
    showNoticeTip();
    // lời nhắn cho khách hàng: nói việc cần làm, không nói chuyện kỹ thuật
    rich(tipText, c.want === 'mobile'
      ? 'Hướng dẫn này dành cho phiên bản trên «điện thoại».\nBạn vui lòng mở trên điện thoại để xem tiếp nhé.'
      : 'Hướng dẫn này dành cho phiên bản trên «máy tính».\nBạn vui lòng mở trên máy tính để xem tiếp nhé.');
    setMeta(''); setBtns(null, null, null);
    setInfo('Sai bố cục: tour cho ' + LAYOUT[c.want]);
    const timer = setInterval(() => { if (my !== token) return clearInterval(timer); if (!layoutClash()) { clearInterval(timer); again(); } }, 400);
  }
  function holdForDialog() {
    const my = ++token;
    showId++;
    playing = -1; target = null; box.style.display = 'none'; cancelAnimationFrame(raf);
    showNoticeTip();
    rich(tipText, 'Hãy đóng hộp thoại đang che màn hình, tour sẽ tự tiếp tục.'); setMeta(''); setBtns(null, null, null);
    setInfo('Chờ đóng hộp thoại');
    const timer = setInterval(() => { if (my !== token) return clearInterval(timer); if (!foreignDialog()) { clearInterval(timer); play(); } }, 300);
  }
  // Trong lúc đang tô sáng một đích: màn hình đổi dưới chân (hộp thoại bật lên, đích bị gỡ hay trượt ra ngoài) thì tìm lại.
  function watchStep() {
    if (playing < 0 || !target || advancing || recording) return;
    const i = playing, st = steps[i];
    if (foreignDialog()) return holdForDialog();
    if (!target.isConnected || !visible(target) || offscreen(target) || context().dialog !== st.fp.ctx.dialog) show(i, playingBack);
  }
  let showId = 0, playingBack = false;
  // nút "Quay lại" chỉ hiện khi trang bật window.TOURFP_BACK = true (mặc định tắt) và không phải bước đầu
  const prevLabel = i => window.TOURFP_BACK === true && i > 0 ? 'QUAY LẠI' : null;
  async function show(i, back = false) {
    if (i >= steps.length) { tripDone(i - 1); tripEnd('done'); return stopPlay(`Xong tour · ${steps.length} bước`); }
    tripDone(i - 1);
    const seq = ++showId;
    playingBack = back;
    playing = i; target = null; advancing = false; box.style.display = 'none';
    const st = steps[i], nx = steps[i + 1], name = st.title || nameOf(st.fp), head = `Bước ${i + 1}/${steps.length}`, badge = `${i + 1}/${steps.length}`;
    // bước rê chuột mà đích của bước sau đã hiện sẵn thì không cần rê nữa (trừ khi người dùng vừa bấm Quay lại)
    if (!back && st.kind === 'hover' && nx && sure(nx.fp)) return show(i + 1);
    box.style.borderColor = 'transparent'; box.style.boxShadow = '0 0 0 9999px rgba(0,0,0,.5)';
    showNoticeTip();
    rich(tipText, 'Đang chờ màn hình…'); setMeta(''); setBtns(null, prevLabel(i), badge);
    setInfo(`${head}: đang tìm`);
    cancelAnimationFrame(raf); loop();
    const after = (from, n) => steps.slice(from, from + n).map((x, k) => ({ fp: x.fp, idx: from + k }));
    tripStep(i, { result: 'waiting' });
    // 30 giây kể từ lúc bắt đầu bước mà vẫn chưa thấy đích: báo về máy chủ là đang kẹt ở bước này (lượt vẫn tiếp tục chờ)
    setTimeout(() => { if (playing === i && trip && !target) tripMark('waiting', i); }, 30000);
    const tf = performance.now(), r = await waitFind(st.fp, 8000, back ? null : after(i + 1, 2));
    if (!r || playing !== i) return;
    if (r.skipTo != null) { tripSkip(i, r.skipTo); return show(r.skipTo); }
    tripStep(i, tripFind(r, performance.now() - tf));
    setInfo(`${head}: ${r.status}`);
    if (r.status !== 'ok') {
      rich(tipText, r.status === 'ambiguous'
        ? `Có nhiều phần tử giống «${name}» nên chưa xác định chắc được đích`
        : `Không tìm thấy «${name}»` + (r.expected ? `\nCần ở màn: ${r.expected.path} ${r.expected.dialog} ${r.expected.step}` : ''));
      setMeta(r.status);
      // không bỏ cuộc: tiếp tục theo dõi, đích hiện ra sau (người dùng tự mở menu, dữ liệu tải xong) thì dẫn tiếp
      const again = await waitFind(st.fp, 600000, back ? null : after(i + 1, 2));
      if (again && playing === i) { if (again.skipTo != null) { tripSkip(i, again.skipTo); show(again.skipTo); } else if (again.status === 'ok') show(i, back); }
      return;
    }
    resumeAt = i;
    target = r.el;
    r.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    // Dòng đầu: việc cần làm với đích (loại bước + tên đích, hoặc lời riêng `note` của bước). Mô tả thêm (`desc`, người quản trị
    // nhập ở trang quản trị) nằm ngay dưới, chữ mờ hơn — không thay thế dòng đầu, để người dùng luôn biết phải bấm/rê vào đâu.
    const auto = st.kind === 'click'
      ? `Bấm vào «${name}» để tiếp tục`
      : st.kind === 'hover'
        ? `Di chuyển chuột vào «${name}»`
        : st.kind === 'input'
          ? `Nhập vào ô «${name}», xong bấm Tiếp tục`
          : `«${name}»`;
    rich(tipText, (st.note || '').trim() || auto);
    const desc = (st.desc || '').trim();
    if (desc) tipText.append(mk('div', 'margin-top:6px;font-size:12px;line-height:16px;color:#80868b;white-space:pre-line', desc));
    if (window.TOURFP_MATCH_INFO === true) setMeta(`khớp ${Math.round(r.score * 100)}% · ${r.via} · ${r.ms} ms`, true); // dòng kỹ thuật, mặc định ẩn
    else setMeta('');
    const lastStep = i === steps.length - 1;
    // bước di chuyển chuột không có nút Tiếp tục: người dùng tự rê chuột, menu bật ra là sang bước sau
    setBtns(lastStep ? 'ĐÃ HIỂU' : st.kind === 'hover' ? null : 'TIẾP TỤC', prevLabel(i), badge);
    // bước rê chuột: sang bước sau ngay khi đích của bước sau hiện ra
    if (st.kind === 'hover' && nx) {
      if (back) {
        // nếu menu rê chuột vẫn đang mở từ bước vừa quay lại, chờ nó đóng hẳn rồi mới tự tiến khi người dùng rê lại
        while (seq === showId && playing === i && sure(nx.fp)) await sleep(150);
        if (seq !== showId || playing !== i) return;
      }
      const r2 = await waitFind(nx.fp, 120000, after(i + 2, 2), true);
      if (r2 && seq === showId && playing === i) { if (r2.skipTo != null) { tripSkip(i + 1, r2.skipTo); show(r2.skipTo); } else if (r2.status === 'ok') show(i + 1); }
    }
  }
  async function goPrev() {
    if (playing <= 0) return;
    lastNext = -300;
    const targetIdx = playing - 1, want = steps[targetIdx].fp.ctx;
    if (sameCtx(want, context())) return show(targetIdx, true);

    const my = ++token;
    showId++;
    playing = targetIdx; target = null; advancing = false; box.style.display = 'none'; cancelAnimationFrame(raf);
    showNoticeTip();
    rich(tipText, 'Đang quay lại bước trước…');
    setMeta(want.path !== location.pathname ? want.path : '');
    setBtns(null, null, `${targetIdx + 1}/${steps.length}`);

    const hadDialog = !!topDialog();
    if (hadDialog && dialogKey(topDialog()) !== want.dialog) pressEsc();

    if (location.pathname !== want.path) {
      const before = pageSig(), t0 = performance.now();
      const hasMatch = fp => { try { return find(fp, { ignoreCtx: true }).status === 'ok'; } catch (_) { return false; } };
      const wasSure = hasMatch(steps[targetIdx].fp);
      const wasEarlier = steps.slice(0, targetIdx).map(s => hasMatch(s.fp));
      const structSig = () => [document.title, ...[...document.querySelectorAll('main,[role=main],h1,h2')].filter(e => visible(e) && !isUi(e)).map(e => e.tagName + '#' + (e.id || '') + ':' + stripNum(e.textContent).slice(0, 30))].join('|');
      const beforeStruct = structSig();
      let arrived = false;
      try { sessionStorage.setItem(RESUME, JSON.stringify({ steps, at: targetIdx })); } catch (_) {}
      navTo(want.path);
      while (my === token && performance.now() - t0 < 3000) {
        const c = context();
        if (c.path === want.path) {
          const hit = sameCtx(want, c) && sure(steps[targetIdx].fp);
          const structChanged = structSig() !== beforeStruct;
          const earlierHit = steps.slice(0, targetIdx).some((s, k) => !wasEarlier[k] && sameCtx(s.fp.ctx, c) && sure(s.fp));
          if (before) {
            if (pageSig() !== before && (hit || sameCtx(want, c) || earlierHit)) { arrived = true; break; }
          } else {
            if ((!wasSure && hit) || (structChanged && hit) || earlierHit) { arrived = true; break; }
          }
        }
        await sleep(150);
      }
      if (my !== token) return;
      if (!arrived) { tripStash(); return location.assign(want.path); }
      try { sessionStorage.removeItem(RESUME); } catch (_) {}
    } else if (hadDialog) {
      const t0 = performance.now();
      while (my === token && performance.now() - t0 < 1200) {
        if (sameCtx(want, context())) break;
        await sleep(100);
      }
      if (my !== token) return;
    }

    if (sameCtx(want, context()) || sure(steps[targetIdx].fp)) return show(targetIdx, true);
    const c = context();
    for (let k = targetIdx - 1; k >= 0; k--) {
      if (sameCtx(steps[k].fp.ctx, c) && sure(steps[k].fp)) return show(k, true);
    }
    show(targetIdx, true);
  }
  // bước đầu tiên thuộc màn đang đứng (cùng đường dẫn, hộp thoại, bước); ưu tiên bước đã tìm thấy đích
  const sameCtx = (a, b) => a.path === b.path && a.dialog === b.dialog && a.step === b.step;
  function startIndex() {
    const c = context();
    let first = -1;
    for (let i = 0; i < steps.length; i++) {
      if (!sameCtx(steps[i].fp.ctx, c)) continue;
      if (first < 0) first = i;
      if (sure(steps[i].fp)) return i;
    }
    return first;
  }
  // dấu hiệu app đã thật sự đổi màn: các component đứng sau router-outlet khác đi (xét cả outlet lồng bên trong khung trang)
  const pageSig = () => [...document.querySelectorAll('router-outlet')].map(o => o.nextElementSibling ? o.nextElementSibling.tagName : '').join('|');
  // màn đang đứng không có trong tour: đưa về màn của bước 1 rồi phát từ đầu
  const RESUME = 'tourfp:resume';
  function goStart() {
    const path = steps[0].fp.ctx.path, my = ++token, t0 = performance.now(), before = pageSig(), samePath = location.pathname === path;
    showId++; lastNext = -300;
    playing = 0; target = null; box.style.display = 'none';
    showNoticeTip();
    rich(tipText, 'Màn này không có trong tour — đang về màn bắt đầu…'); setMeta(path); setBtns(null, null, null);
    try { sessionStorage.setItem(RESUME, JSON.stringify(steps)); } catch (_) { /* không lưu được thì thôi */ }
    // đang có hộp thoại mà bước 1 không nằm trong hộp thoại: thử đóng bằng phím Esc trước
    if (topDialog() && !steps[0].fp.ctx.dialog) document.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, which: 27, bubbles: true }));
    // chuyển trang ngay trong app (không tải lại); nếu app không phản ứng thì tải lại và phát tiếp sau khi nạp
    history.pushState({}, '', path);
    dispatchEvent(new PopStateEvent('popstate', { state: null }));
    const timer = setInterval(() => {
      if (my !== token) return clearInterval(timer);
      if ((samePath || !before || pageSig() !== before) && sameCtx(context(), steps[0].fp.ctx) && find(steps[0].fp).el) { clearInterval(timer); try { sessionStorage.removeItem(RESUME); } catch (_) {} show(0); }
      else if (performance.now() - t0 > 3000) { clearInterval(timer); tripStash(); location.assign(path); }
    }, 200);
  }
  // đang đứng ở màn cuối và bước cuối đã làm xong: báo cho người dùng, cho chọn phát lại từ đầu
  let atEnd = false;
  function endNotice() {
    tripEnd('done');
    token++; showId++; playing = -1; target = null; atEnd = true; box.style.display = 'none'; cancelAnimationFrame(raf);
    showNoticeTip();
    rich(tipText, 'Bạn đang ở màn cuối của tour, bước cuối đã được thực hiện.'); setMeta('');
    setBtns('PHÁT LẠI TỪ ĐẦU', null, null);
    setInfo('Đang ở màn cuối của tour');
  }
  async function play() {
    directRun++; // lượt "vào thẳng" trước đó (nếu còn hẹn giờ tự đóng) không được đóng nhầm lượt phát này
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào');
    tripBegin('guide');
    atEnd = false;
    if (layoutClash()) return holdForLayout(play);
    // có hộp thoại lạ đang che màn hình: chờ người dùng đóng nó trước, không vội về màn bắt đầu hay tải lại trang
    if (foreignDialog()) return holdForDialog();
    const c = context(), n = steps.length - 1, last = steps[n];
    // lượt trước đang dở ở một bước mà đích của nó giờ đã có trên màn hình: đi tiếp từ bước đó, không quay về bước đầu
    if (resumeAt > 0 && resumeAt <= n && sameCtx(steps[resumeAt].fp.ctx, c) && sure(steps[resumeAt].fp)) return show(resumeAt);
    let first = -1;
    for (let i = 0; i <= n; i++) {
      if (!sameCtx(steps[i].fp.ctx, c)) continue;
      if (first < 0) first = i;
      if (sure(steps[i].fp)) return show(i);
    }
    // không bước nào tìm thấy đích: nếu màn này là màn của (hoặc sau) bước cuối thì coi như đã ở cuối tour
    if ((last.after && sameCtx(last.after, c)) || sameCtx(last.fp.ctx, c)) {
      const r = sameCtx(last.fp.ctx, c) ? await waitFind(last.fp, 1500) : { status: 'not-found' }; // chờ một nhịp phòng khi màn chưa vẽ xong
      if (!r) return;
      return r.status === 'not-found' ? endNotice() : show(n); // 'ambiguous': show() sẽ báo chưa xác định chắc được đích
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
  function clickOn(el) {
    if (!el) return;
    if (typeof el.click === 'function') return el.click();
    const r = el.getBoundingClientRect();
    el.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true, view: window, clientX: r.left + r.width / 2, clientY: r.top + r.height / 2 }));
  }
  // Vào thẳng không bao giờ được bỏ màn hình đứng ở "Đang đưa bạn tới…": lỗi bất ngờ giữa chừng thì báo như không tới được.
  let directAt = 0;
  async function direct() {
    const my = directRun + 1;
    try { await directGo(); }
    catch (_) { if (my === directRun && tip.style.display !== 'none') { tripEnd('error', directAt); directStuck(directAt); } }
  }
  let directStuck = () => {};
  async function directGo() {
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào');
    tripBegin('direct');
    if (layoutClash()) return holdForLayout(direct);
    const my = ++directRun, alive = () => my === directRun;
    const n = steps.length, last = steps[n - 1];
    token++; showId++; playing = -1; target = null; atEnd = false; box.style.display = 'none'; cancelAnimationFrame(raf);
    showNoticeTip();
    const say = t => { rich(tipText, t); setMeta(''); setBtns(null, null, null); };
    coverOn(); say('Đang đưa bạn tới màn hình…');
    const finish = () => { coverOff(); tripDone(n - 1); tripEnd('done'); say('Đã đưa bạn tới nơi.'); setTimeout(() => { if (alive()) stopPlay('Đã tới nơi'); }, 1600); };

    // Không tự đi tiếp được từ bước i: dừng hẳn (không tô tối, không chặn thao tác) và báo cho người dùng. Phần hướng dẫn bằng chữ
    // do trang tích hợp hiện (ví dụ trong hội thoại, từ "summary" của trợ lý). "Thử lại" chạy lại từ đầu, nút ✕ tắt.
    const stuck = (i, r, waited) => {
      coverOff();
      tripStep(i, r ? tripFind(r, waited) : { result: 'stuck', ctx: ctxOf(context()), expected: ctxOf(steps[i].fp.ctx) }); tripEnd('stuck', i);
      directRun++; token++; playing = -1; target = null; atEnd = false; box.style.display = 'none'; cancelAnimationFrame(raf);
      rich(tipText, 'Chưa thể thực hiện lúc này.\nBạn có thể đọc hướng dẫn trong lúc chờ hệ thống ổn định.');
      setMeta(''); setBtns('THỬ LẠI', null, null);
      choice = { guide: direct, direct: () => stopPlay() };
      setInfo(`Chưa tới được bước ${i + 1}/${n}`);
      try { window.dispatchEvent(new CustomEvent('tourfp:stuck', { detail: { step: i + 1, total: n } })); } catch (_) { /* trình duyệt cũ */ }
    };
    directStuck = stuck; directAt = 0;

    // 1) Bước cuối chuyển sang một trang khác và không mở hộp thoại: vào thẳng trang đó bằng đường dẫn.
    const after = last.after;
    if (after && !after.dialog && !after.step && after.path !== last.fp.ctx.path) {
      if (topDialog()) pressEsc();
      if (location.pathname !== after.path) navTo(after.path);
      for (let t = 0; t < 15 && alive() && context().path !== after.path; t++) await sleep(200);
      if (!alive()) return;
      if (context().path !== after.path) { tripEnd('done'); return location.assign(after.path); } // app không tự chuyển: tải thẳng trang đó
      return finish();
    }

    // 2) Còn lại: chỉ làm "chặng cuối", tức các bước liền nhau cùng đường dẫn với bước cuối. Các trang trước đó bỏ qua.
    let first = n - 1;
    while (first > 0 && steps[first - 1].fp.ctx.path === last.fp.ctx.path) first--;
    if (steps[first].fp.ctx.dialog) { coverOff(); return play(); } // chặng cuối bắt đầu trong một hộp thoại: không tới được bằng đường dẫn, quay về dẫn từng bước
    const c = context();
    let start = -1;
    for (let i = first; i < n && start < 0; i++) if (sameCtx(steps[i].fp.ctx, c) && sure(steps[i].fp)) start = i; // đang đứng sẵn giữa chặng
    if (start < 0) {
      if (topDialog()) pressEsc();
      if (location.pathname !== steps[first].fp.ctx.path) {
        // Đổi địa chỉ xong thì app còn phải tải và vẽ màn mới; trong lúc đó màn cũ vẫn nằm trên trang mà đường dẫn đã là màn mới.
        // Chờ màn mới vẽ xong rồi mới tìm, không thì đang dò đích trên màn cũ. Quá 8 giây vẫn chưa đổi: app không tới được màn đó.
        const sig0 = pageSig();
        navTo(steps[first].fp.ctx.path);
        if (sig0) {
          for (let t = 0; t < 40 && alive() && pageSig() === sig0; t++) await sleep(200);
          if (!alive()) return;
          if (pageSig() === sig0) return stuck(first);
        }
      }
      start = first;
    }
    for (let i = start; i < n; i++) {
      const st = steps[i];
      if (st.kind === 'info') continue; // bước chỉ để xem, không có gì phải làm
      directAt = i;
      say(`Đang đưa bạn tới màn hình… (${i + 1}/${n})`);
      let r;
      tripStep(i, { result: 'waiting' });
      const tf = performance.now();
      try { r = await waitFind(st.fp, 6000, steps.slice(i + 1, i + 3).map((x, k) => ({ fp: x.fp, idx: i + 1 + k }))); } catch (_) { r = { status: 'not-found' }; }
      if (!alive()) return;
      if (!r) return stuck(i); // lượt chờ bị cắt ngang mà lượt vào thẳng này vẫn còn: không để màn hình đứng ở "Đang đưa bạn tới…"
      if (r.skipTo != null) { tripSkip(i, r.skipTo); i = r.skipTo - 1; continue; } // bước này đã được làm sẵn
      if (r.status !== 'ok') return stuck(i, r, performance.now() - tf); // không thấy đích (màn hình lỗi, dữ liệu chưa tải được): dừng, không treo màn hình
      tripStep(i, tripFind(r, performance.now() - tf));
      if (st.kind === 'input') { directRun++; coverOff(); return show(i); } // không tự làm được (không thấy đích, hoặc cần người dùng nhập): dẫn từng bước từ đây
      if (st.kind === 'hover') hoverOn(r.el);
      else { r.el.scrollIntoView({ block: 'center', inline: 'nearest' }); clickOn(r.el); }
      tripStep(i, { result: 'done' });
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
    forceLog = opts.log === true || opts.log === 1 || opts.log === '1' || opts.log === 'true';
    tripBegin(opts.mode === 'direct' ? 'direct' : 'guide', to < (fullSteps || steps).length ? to : null);
    return opts.mode === 'direct' ? direct() : play();
  }

  // Dùng cho kiểm thử tự động: tìm đích của bước thứ i (chờ tối đa opts.timeout), cuộn nó vào tầm nhìn và trả về toạ độ.
  // Không tô sáng, không chặn cú bấm, không tự bấm: trình điều khiển bên ngoài dùng toạ độ này để rê hoặc bấm bằng chuột thật.
  async function locate(i, opts = {}) {
    const st = steps[i];
    if (!st) return { index: i, status: 'no-step' };
    { const c = layoutClash(); if (c) return { index: i, kind: st.kind, name: st.title || nameOf(st.fp), status: 'wrong-layout', context: context(), expected: st.fp.ctx, layout: c }; }
    const t0 = performance.now();
    const r = await waitFind(st.fp, opts.timeout || 8000, steps.slice(i + 1, i + 3).map((x, k) => ({ fp: x.fp, idx: i + 1 + k })));
    const out = { index: i, kind: st.kind, name: st.title || nameOf(st.fp), waited: Math.round(performance.now() - t0), context: context(), expected: st.fp.ctx };
    if (!r) return { ...out, status: 'cancelled' };
    if (r.skipTo != null) return { ...out, status: 'skipped', skipTo: r.skipTo }; // bước này đã được làm sẵn
    if (r.status !== 'ok') return { ...out, status: r.status, score: +(r.score || 0).toFixed(3) }; // gồm cả 'ambiguous': không trả toạ độ, để không ai bấm nhầm
    r.el.scrollIntoView({ block: 'center', inline: 'nearest' });
    await sleep(150);
    const b = r.el.getBoundingClientRect();
    return { ...out, status: r.status, score: +r.score.toFixed(3), via: r.via, drift: !!r.drift, ms: r.ms, rect: { x: b.left, y: b.top, w: b.width, h: b.height } };
  }

  // ---------- máy chủ lưu tour (thư mục server/) ----------
  const SERVER = String(window.TOURFP_SERVER || 'http://localhost:8000').replace(/\/$/, '');
  // Chép vào clipboard NGAY trong cú bấm. Nhiều trang (kể cả TCInvest) từ chối quyền ghi clipboard kiểu mới,
  // nên chỉ còn cách cũ, và cách cũ chỉ chạy được khi đang ở trong một cú bấm của người dùng.
  // Lúc ghi, thư viện có thể chưa nghe được hết phản hồi API nên một tiêu đề neo là dữ liệu (tên khách hàng, mã) có thể lọt vào.
  // Trước khi tour rời khỏi trang (lưu, chép, xuất) thì rà lại và bỏ các tiêu đề neo giờ đã biết là giá trị API.
  function scrub() {
    let n = 0;
    readStores(); // app có thể vừa lưu hồ sơ sau lúc thư viện khởi động
    for (const st of steps) {
      const fp = st.fp;
      if (!fp) continue;
      if (fp.anchor && isData(fp.anchor)) { fp.anchor = ''; fp.anchorSkip = 0; n++; }
      // id ghép từ dữ liệu mà lúc ghi chưa biết (API về sau): bỏ khoá đó, dựng lại chọn nhanh theo khoá còn lại
      for (const k of BONUS) if (fp.key && fp.key[k] && idHasData(fp.key[k])) { delete fp.key[k]; fp.hint = hintOf(fp); n++; }
      // chữ nguyên văn và nhãn lấy từ thuộc tính (title, aria-label) cũng có thể là tên người: bỏ, phần tử vẫn còn các tín hiệu khác
      if (fp.exact && isPersonal(fp.exact)) { fp.exact = ''; n++; }
      if (fp.label && isPersonal(fp.label)) {
        // nhãn là dữ liệu cá nhân: xoá chữ đi, chỉ giữ cấu trúc. Phần tử sẽ được tìm theo icon, thuộc tính, vị trí.
        fp.label = ''; fp.segs = []; fp.soft = []; if (fp.loose) delete fp.loose; n++;
      }
    }
    return n;
  }
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
  // Chrome do trang quản trị mở để ghi tour: có sẵn hàm __tourfpHost, gửi tour thẳng về trang quản trị qua đó
  const host = () => typeof window.__tourfpHost === 'function';
  const setSaveMode = () => { bSave.textContent = host() ? 'Gửi' : serverOk === false ? 'Chép JSON' : 'Lưu'; };
  async function probe() {
    if (host()) return setSaveMode();
    if (serverOk !== null) return;
    try { serverOk = (await fetch(SERVER + '/api/config')).ok; } catch (_) { serverOk = false; }
    setSaveMode();
  }
  // Gọi được máy chủ: hỏi tên rồi gửi tour lên. Không gọi được: nút thành "Chép JSON" và chép ngay trong cú bấm,
  // để dán vào hộp Thêm tour của trang quản trị.
  async function save() {
    scrub();
    if (recording) stop();
    if (!steps.length) return setInfo('Chưa có bước nào để lưu');
    if (host()) {
      try { await window.__tourfpHost(JSON.stringify(steps)); return setInfo(`Đã gửi ${steps.length} bước về trang quản trị · đặt tên và lưu ở đó`); }
      catch (_) { return setInfo('Không gửi được về trang quản trị'); }
    }
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
    tourMeta = { id: String(id), name: String(t.name || '') };
    start(opts);
  }
  // Hỏi trợ lý trên máy chủ "muốn tới màn hình nào", rồi cho người dùng chọn: dẫn từng bước hay vào thẳng.
  // ask(query, { ui: false }): chỉ trả JSON của trợ lý, không hiện gì, để trang tích hợp tự hiện trong hội thoại của mình
  // rồi gọi TourFP.run(a.tour.id, { mode: 'guide' | 'direct', to: a.to_step }) khi người dùng chọn.
  async function ask(query, opts = {}) {
    let a;
    try {
      const r = await fetch(SERVER + '/api/assist', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ query, layout: context().layout }) });
      if (!r.ok) throw new Error('HTTP ' + r.status);
      a = await r.json();
    } catch (e) {
      a = { matched: false, reason: 'Không gọi được trợ lý.' };
    }
    if (opts.ui === false) return a;
    stopPlay();
    showNoticeTip(); setMeta('');
    if (!a.matched) { rich(tipText, a.reason || 'Chưa tìm thấy tour phù hợp.'); setBtns(null, null, null); choice = {}; return a; }
    rich(tipText, `«${a.tour.name}»` + (a.to_step < a.tour.step_count ? ` · tới bước ${a.to_step}/${a.tour.step_count}` : '') + '\n' + a.reason);
    setBtns(a.options[0].label, a.options[1].label, null);
    const go = mode => run(a.tour.id, { mode, to: a.to_step }).catch(() => { rich(tipText, 'Không tải được tour.'); });
    choice = { guide: () => go('guide'), direct: () => go('direct') };
    return a;
  }
  // ---------- bookmark TourFP ----------
  // Bookmark chỉ nạp thư viện (window.TOURFP_BOOKMARK) rồi gọi hàm này; mọi xử lý nằm ở đây để sửa thư viện là bookmark
  // tự có bản mới, không phải tạo lại bookmark. Không dùng prompt()/alert(): trình duyệt do Playwright điều khiển tự đóng
  // các hộp đó ngay, và trên điện thoại chúng dễ bị đóng khi bàn phím bật lên. Thay bằng một khung ngay trong trang.
  // Đọc mã chạy thử. Dễ tính với những gì bàn phím và bộ nhớ chép của điện thoại có thể làm với chuỗi dài: thêm khoảng trắng,
  // xuống dòng, đổi "--" thành gạch dài, bỏ dấu "=" đệm. Lỗi thì ném ra lý do ngắn để hiện cho người dùng.
  async function unpack(v) {
    v = String(v).replace(/[—―]/g, '--').replace(/[‐-–−]/g, '-').trim();
    const at = v.indexOf('TFP1:');
    if (at < 0) {
      if (/^[[{]/.test(v)) { try { return JSON.parse(v); } catch (_) { throw new Error('JSON hỏng'); } }
      throw new Error('không thấy đầu mã TFP1');
    }
    let b64 = v.slice(at + 5).replace(/[^A-Za-z0-9_\-+/]/g, '').replace(/-/g, '+').replace(/_/g, '/');
    while (b64.length % 4) b64 += '=';
    let bin;
    try { bin = atob(b64); } catch (_) { throw new Error('mã bị thiếu hoặc sai ký tự, dài ' + b64.length); }
    const u = new Uint8Array(bin.length);
    for (let k = 0; k < bin.length; k++) u[k] = bin.charCodeAt(k);
    if (typeof DecompressionStream !== 'function') throw new Error('trình duyệt này quá cũ để đọc mã');
    let text;
    try { text = await new Response(new Blob([u]).stream().pipeThrough(new DecompressionStream('gzip'))).text(); }
    catch (_) { throw new Error('mã bị cắt mất một phần, dài ' + b64.length); }
    try { return JSON.parse(text); } catch (_) { throw new Error('nội dung mã hỏng'); }
  }
  function playPack(q) {
    if (!q || !Array.isArray(q.steps) || !q.steps.length) throw new Error('mã không chứa bước nào');
    viaBookmark = true; // chạy thử của người quản trị, không phải lượt của khách
    panel.style.display = 'none';
    window.TourFP.load(q.steps);
    start(q.start || {});
  }
  let carried = ''; // mã chạy thử đọc được từ địa chỉ trang lúc thư viện vừa nạp (app có thể xoá phần # sau đó)
  try { carried = location.hash || ''; } catch (_) { /* không đọc được */ }
  function bookmark() {
    const admin = String(window.TOURFP_ADMIN || '').replace(/\/$/, '');
    // "Gửi" trên thanh ghi: chép tour (phòng khi trình duyệt xoá window.name) rồi quay về trang quản trị
    // (cửa sổ Chrome do máy chủ mở đã có sẵn đường gửi riêng: giữ nguyên)
    if (typeof window.__tourfpHost !== 'function') window.__tourfpHost = j => { copyNow(j); window.name = 'tourfp-draft:' + j; if (admin) location.href = admin + '/#add'; };
    const n = window.name || '';
    if (n.startsWith('tourfp-play:')) { window.name = ''; try { return playPack(JSON.parse(n.slice(12))); } catch (_) { /* hỏng thì hỏi mã */ } }
    // Trang quản trị gắn mã chạy thử vào địa chỉ trang (#tourfp=TFP1:…): đọc từ đó, người dùng khỏi phải dán.
    // Phần sau dấu # không gửi lên máy chủ của trang. Đọc xong thì gỡ khỏi địa chỉ.
    const hm = /[#&]tourfp=(TFP1:[A-Za-z0-9_\-]+)/.exec(location.hash || '') || /[#&]tourfp=(TFP1:[A-Za-z0-9_\-]+)/.exec(carried);
    if (hm) {
      carried = '';
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* không gỡ được thì thôi */ }
      unpack(hm[1]).then(playPack).catch(() => picker());
      return;
    }
    // Trang quản trị mở trang này để ghi tour (#tourfp=rec): hiện thẳng thanh ghi, không hỏi gì
    if (/[#&]tourfp=rec\b/.test(location.hash || '') || /[#&]tourfp=rec\b/.test(carried)) {
      carried = '';
      try { history.replaceState(history.state, '', location.pathname + location.search); } catch (_) { /* không gỡ được thì thôi */ }
      return openRecorder();
    }
    picker();
  }
  function openRecorder() { stopPlay(); panel.style.display = 'flex'; probe(); setInfo('Bấm ● Ghi để bắt đầu'); }
  function picker() {
    const old = document.getElementById('tourfp-pick'); if (old) old.remove();
    const d = mk('div', `position:fixed;left:12px;right:12px;bottom:${innerWidth < 768 ? 80 : 16}px;max-width:420px;margin:0 auto;z-index:${Z + 5};background:#16181d;color:#fff;border:1px solid #3a3f4b;border-radius:14px;padding:14px;box-sizing:border-box;box-shadow:0 10px 40px rgba(0,0,0,.5);${FONT}`);
    d.id = 'tourfp-pick';
    const title = mk('div', 'font-weight:600;font-size:15px;margin-bottom:8px', 'TourFP');
    const ta = mk('textarea', 'display:block;width:100%;box-sizing:border-box;height:64px;resize:none;border-radius:8px;border:1px solid #3a3f4b;background:#0e0f12;color:#fff;padding:8px;font:16px/1.3 system-ui,sans-serif');
    ta.placeholder = 'Dán mã chạy thử để chạy tour';
    const err = mk('div', 'color:#ff8a8e;font-size:13px;min-height:18px;margin:6px 0');
    const row = mk('div', 'display:flex;gap:8px;flex-wrap:wrap');
    const bGo = mk('button', btnCss + 'background:#e5484d;padding:7px 14px', 'Chạy tour');
    const bNew = mk('button', btnCss + 'padding:7px 14px', 'Ghi tour mới');
    const bX = mk('button', btnCss + 'background:transparent;padding:7px 10px;margin-left:auto', 'Đóng');
    row.append(bGo, bNew, bX); d.append(title, ta, err, row);
    bGo.onclick = async () => {
      if (!ta.value.trim()) { err.textContent = 'Chưa dán mã chạy thử.'; return; }
      let q;
      try { q = await unpack(ta.value); } catch (e) { err.textContent = 'Mã chạy thử không đúng (' + e.message + '). Hãy chép lại ở trang quản trị.'; return; }
      try { d.remove(); playPack(q); } catch (e) { document.documentElement.append(d); err.textContent = 'Không chạy được tour này (' + e.message + ').'; }
    };
    bNew.onclick = () => { d.remove(); openRecorder(); };
    bX.onclick = () => d.remove();
    document.documentElement.append(d);
  }
  bSave.onclick = save;
  if (!PLAYER) probe(); // biết trước nên gửi hay chép, để cú bấm đầu tiên vào nút đã làm đúng việc
  bRec.onclick = () => (recording ? stop() : record());
  bPlay.onclick = play;
  bClr.onclick = () => { fullSteps = null; steps.length = 0; stopPlay(); };
  const pick = k => { const f = choice[k]; choice = null; if (f) f(); };
  let lastNext = -300;
  for (const ev of ['click', 'pointerdown', 'mousedown', 'pointerup', 'mouseup']) tip.addEventListener(ev, e => e.stopPropagation());
  bNext.onclick = e => {
    e.stopPropagation();
    const now = performance.now();
    if (e.detail > 1) return;
    if (choice) return pick('guide');
    if (atEnd) { atEnd = false; return goStart(); }
    if (playing < 0 || advancing || now - lastNext < 250) return;
    lastNext = now;
    const i = playing, seq = showId, st = steps[i], lastStep = i === steps.length - 1;
    if (!lastStep && st.kind === 'click' && target && target.isConnected) {
      advancing = true;
      clickOn(target);
      setTimeout(() => { if (playing === i && showId === seq) show(i + 1); }, 300);
      return;
    }
    if (!lastStep && st.kind === 'hover' && target && target.isConnected) {
      advancing = true;
      hoverOn(target);
      setTimeout(() => { if (playing === i && showId === seq) show(i + 1); }, 150);
      return;
    }
    show(i + 1);
  };
  bPrev.onclick = e => { if (e.detail > 1) return; if (choice) pick('direct'); else goPrev(); };
  bClose.onclick = () => stopPlay();
  const L = [['mousemove', onMove], ['mouseover', onOver], ['pointerdown', onDown], ['mousedown', onUp], ['pointerup', onUp], ['mouseup', onUp], ['click', onClick]];
  for (const [n, h] of L) document.addEventListener(n, h, true);

  function destroy() {
    tripEnd('stopped');
    token++; cancelAnimationFrame(raf); popMo.disconnect();
    for (const [n, h] of L) document.removeEventListener(n, h, true);
    cover.remove(); box.remove(); tip.remove(); panel.remove();
    delete window.TourFP;
  }

  const api_ = {
    version: VERSION, capture, captureAt: el => capture(clickableRoot(el)), isClickable, save, run, start, direct, ask, locate,
    showPanel: (on = true) => { panel.style.display = on ? 'flex' : 'none'; }, find, score, context, clickables, record, stop, play, destroy, steps,
    apiStats: () => ({ responses: api.responses, values: api.set.size }),
    appVersion, bookmark,
    isApiValue,
    state: () => ({ recording, playing, steps: steps.length, target: target ? nameOf(capture(target)) : null, tip: tip.style.display !== 'none' ? tipText.textContent : '' }),
    export: () => { scrub(); return JSON.stringify(steps, null, 2); },
    // tour nạp từ ngoài có thể đã bị lược các trường rỗng: điền lại giá trị mặc định để việc so khớp không lệch hay ném lỗi
    load: a => {
      for (const st of a) if (st && st.fp) st.fp = Object.assign({ tag: '', role: '', label: '', segs: [], soft: [], exact: '', key: {}, attr: {}, icon: '', comp: [], anchor: '' }, st.fp);
      fullSteps = null; steps.length = 0; steps.push(...a); setInfo();
      tourMeta = { id: '', name: '' };
    },
  };
  // trang gọi thư viện từ trong Angular (dịch vụ, nút bấm): chuyển ra zone gốc trước khi làm gì
  for (const k in api_) if (typeof api_[k] === 'function') api_[k] = outside(api_[k]);
  window.TourFP = api_;

  // vừa bị tải lại trang giữa lúc đưa về màn bắt đầu: nạp lại tour và phát tiếp (không điều hướng lần nữa)
  try {
    const saved = sessionStorage.getItem(RESUME);
    if (saved) {
      sessionStorage.removeItem(RESUME);
      const parsed = JSON.parse(saved);
      const arr = Array.isArray(parsed) ? parsed : parsed && Array.isArray(parsed.steps) ? parsed.steps : [];
      const at = !Array.isArray(parsed) && parsed && typeof parsed.at === 'number' ? parsed.at : -1;
      steps.push(...arr); setInfo();
      setTimeout(() => {
        if (at >= 0 && at < steps.length) return show(at, true);
        const i = startIndex(); show(i >= 0 ? i : 0);
      }, 800);
    }
  } catch (_) { /* không đọc được thì bỏ qua */ }

  // mở trang với ?tourfp=<mã>[&mode=guide|direct][&to=<bước>]: tải tour đó từ máy chủ và chạy luôn
  const qs = new URLSearchParams(location.search), wanted = qs.get('tourfp');
  // Không tải được (máy chủ không gọi được, CSP của trang chặn, mã tour sai): báo ngay trên trang, vì thanh ghi đang ẩn ở chế độ phát
  if (wanted && !steps.length) run(wanted, { mode: qs.get('mode'), to: qs.get('to'), log: qs.get('log') }).catch(() => {
    setInfo('Không tải được tour ' + wanted);
    showNoticeTip();
    rich(tipText, 'Không tải được tour hướng dẫn.'); setMeta(''); setBtns(null, null, null); choice = {};
  });
  if (window.TOURFP_BOOKMARK) { delete window.TOURFP_BOOKMARK; bookmark(); }
})();
