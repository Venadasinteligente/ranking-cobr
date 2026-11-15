/* Efeitos da damas: as reações animadas (coração, carinha de mal, faca, mão amassando a dama)
   e o combo de raio quando alguém come 2 ou mais pedras de uma vez.
   Tudo que é luz, fogo, fumaça e caco é desenhado num canvas por cima da tela inteira (o raio
   desce do topo da tela). Não sabe nada do banco nem das regras: o jogos.js passa onde estão as
   pedras (em px da tela) e a função que desenha a pedra. Fica num arquivo só pra a página de
   preview usar o mesmo código. */
(() => {
  'use strict';
  const el = (tag, at = {}, ...filhos) => {
    const n = document.createElement(tag);
    for (const [k, v] of Object.entries(at)) {
      if (v == null) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else n.setAttribute(k, v);
    }
    for (const f of filhos.flat()) if (f != null) n.append(f);
    return n;
  };
  // não olha o "reduzir movimento" do sistema: muito Windows vem com animação desligada e aí ninguém via o raio
  const sorte = (a, b) => a + Math.random() * (b - a);
  const um = (l) => l[Math.floor(Math.random() * l.length)];
  const saida = (k) => 1 - Math.pow(1 - k, 3);
  const TAU = Math.PI * 2;

  // ======================= palco: canvas na tela inteira =======================
  const S = { cv: null, cx: null, esc: null, w: 0, h: 0, dpr: 1, itens: [], raf: 0, ult: 0, tremor: 0, clarao: 0, claraoCor: '255,255,255', escuro: 0, escuroAlvo: 0, escuroAte: 0, tab: null };
  function medir() {
    if (!S.cv) return;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const vw = document.documentElement.clientWidth || innerWidth, vh = document.documentElement.clientHeight || innerHeight;
    if (S.w === vw && S.h === vh && S.dpr === dpr) return;
    S.dpr = dpr; S.w = vw; S.h = vh;
    S.cv.width = Math.round(S.w * dpr);
    S.cv.height = Math.round(S.h * dpr);
  }
  function palco() {
    if (!S.cv) {
      S.cv = el('canvas', { class: 'jg-fx-palco', 'aria-hidden': 'true' });
      S.cx = S.cv.getContext('2d');
      S.esc = el('div', { class: 'jg-fx-escuro', 'aria-hidden': 'true' });
      addEventListener('resize', medir);
    }
    if (!S.cv.isConnected) document.body.append(S.esc, S.cv);
    medir();
    if (!S.raf) { S.ult = performance.now(); S.raf = requestAnimationFrame(quadro); }
  }
  // item = { camada 0 (por baixo: rachadura, fumaça) | 1 (cacos, emojis) | 2 (luz somada), t0, dur, d(cx, k, dt) }
  function por(it) {
    S.itens.push(it);
    if (S.itens.length > 1100) S.itens.splice(0, S.itens.length - 1100);
    return it;
  }
  function quadro(agora) {
    const dt = Math.min(0.05, (agora - S.ult) / 1000);
    S.ult = agora;
    const cx = S.cx;
    cx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
    cx.clearRect(0, 0, S.w, S.h);
    if (agora > S.escuroAte) S.escuroAlvo = 0;
    S.escuro += (S.escuroAlvo - S.escuro) * Math.min(1, dt * (S.escuroAlvo > S.escuro ? 7 : 3));
    S.esc.style.opacity = S.escuro.toFixed(3);
    const tr = S.tremor, ox = sorte(-tr, tr), oy = sorte(-tr, tr);
    S.ox = ox; S.oy = oy; // o 3D sacode junto
    S.tremor = tr < 0.3 ? 0 : tr * Math.pow(0.004, dt);
    const tab = S.tab && S.tab();
    if (tab && tab !== S.tabUlt && S.tabUlt) S.tabUlt.style.translate = '';
    S.tabUlt = tab;
    if (tab) tab.style.translate = tr ? `${ox.toFixed(1)}px ${oy.toFixed(1)}px` : '';
    cx.translate(ox, oy);
    let vivos = 0;
    for (let c = 0; c < 3; c++) {
      cx.globalCompositeOperation = c === 2 ? 'lighter' : 'source-over';
      for (const it of S.itens) {
        if (it.morto || it.camada !== c) continue;
        const k = (agora - it.t0) / it.dur;
        if (k < 0) { vivos++; continue; }
        if (k >= 1 || it.d(cx, k, dt) === false) { it.morto = true; continue; }
        vivos++;
      }
    }
    cx.globalCompositeOperation = 'source-over';
    if (S.clarao > 0.005) {
      cx.setTransform(S.dpr, 0, 0, S.dpr, 0, 0);
      cx.fillStyle = `rgba(${S.claraoCor},${Math.min(1, S.clarao).toFixed(3)})`;
      cx.fillRect(0, 0, S.w, S.h);
      S.clarao *= Math.pow(0.0004, dt);
    } else S.clarao = 0;
    S.itens = S.itens.filter((it) => !it.morto);
    if (!vivos && !S.clarao && S.escuro < 0.01 && !S.escuroAlvo) {
      S.raf = 0; S.ox = 0; S.oy = 0;
      cx.clearRect(0, 0, S.w, S.h);
      S.cv.remove(); S.esc.remove();
      if (S.tabUlt) S.tabUlt.style.translate = '';
      S.tab = null; S.tabUlt = null;
      return;
    }
    S.raf = requestAnimationFrame(quadro);
  }

  // ======================= peças do desenho =======================
  // raio torto: divide a linha ao meio e empurra o meio pro lado, várias vezes
  function torto(x0, y0, x1, y1, voltas = 6, desvio = 0.2) {
    let pts = [[x0, y0], [x1, y1]], d = Math.hypot(x1 - x0, y1 - y0) * desvio;
    for (let v = 0; v < voltas; v++) {
      const novo = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const a = pts[i], b = pts[i + 1], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy) || 1, off = sorte(-d, d);
        novo.push([(a[0] + b[0]) / 2 - (dy / l) * off, (a[1] + b[1]) / 2 + (dx / l) * off], b);
      }
      pts = novo;
      d *= 0.55;
    }
    return pts;
  }
  function trilha(cx, pts, ate = pts.length) {
    cx.beginPath();
    cx.moveTo(pts[0][0], pts[0][1]);
    for (let i = 1; i < ate; i++) cx.lineTo(pts[i][0], pts[i][1]);
  }
  // camadas do brilho: [largura, cor, força] — a de fora é o halo, a de dentro o miolo branco
  const LUZ = [[34, '70,110,255', 0.1], [18, '110,150,255', 0.2], [8, '170,205,255', 0.55], [3, '255,255,255', 1]];
  const LUZ_FINA = [[10, '120,150,255', 0.18], [2, '215,228,255', 0.85]];
  function brilhar(cx, pts, esc, forca, luz = LUZ, ate) {
    trilha(cx, pts, ate);
    cx.lineJoin = 'round';
    cx.lineCap = 'round';
    for (const [w, cor, a] of luz) {
      cx.lineWidth = w * esc;
      cx.strokeStyle = `rgba(${cor},${Math.min(1, a * forca).toFixed(3)})`;
      cx.stroke();
    }
  }
  function bola(cx, x, y, r, paradas) {
    if (r <= 0) return;
    const g = cx.createRadialGradient(x, y, 0, x, y, r);
    for (const [o, c] of paradas) g.addColorStop(o, c);
    cx.fillStyle = g;
    cx.beginPath();
    cx.arc(x, y, r, 0, TAU);
    cx.fill();
  }
  // o raio: o "líder" desce aos trancos do céu até a pedra, aí o canal inteiro acende e pisca
  function novoRaio(x0, y0, x1, y1, esc = 1) {
    const main = torto(x0, y0, x1, y1, 7, 0.14);
    const dir = Math.atan2(y1 - y0, x1 - x0), tot = Math.hypot(x1 - x0, y1 - y0), galhos = [];
    const nG = 3 + Math.round(esc * 2.5);
    for (let g = 0; g < nG; g++) {
      const ini = Math.floor(sorte(0.08, 0.78) * main.length), p = main[ini];
      const ang = dir + sorte(0.3, 0.95) * (Math.random() < 0.5 ? -1 : 1), L = tot * sorte(0.1, 0.3);
      const pts = torto(p[0], p[1], p[0] + Math.cos(ang) * L, p[1] + Math.sin(ang) * L, 5, 0.22);
      galhos.push({ ini, pts });
      if (Math.random() < 0.5) {
        const q = pts[Math.floor(pts.length * sorte(0.3, 0.6))], a2 = ang + sorte(-0.6, 0.6);
        galhos.push({ ini: ini + 8, pts: torto(q[0], q[1], q[0] + Math.cos(a2) * L * 0.5, q[1] + Math.sin(a2) * L * 0.5, 4, 0.25) });
      }
    }
    return { main, galhos, x0, y0, x1, y1, esc };
  }
  const PISCA = [[0, 1], [0.07, 0.3], [0.14, 1], [0.24, 0.18], [0.33, 0.9], [0.45, 0.1], [0.56, 0.65], [0.7, 0.06], [0.82, 0.3], [1, 0]];
  function pisca(s) {
    for (let i = 1; i < PISCA.length; i++) {
      const [a, va] = PISCA[i - 1], [b, vb] = PISCA[i];
      if (s <= b) return va + ((vb - va) * (s - a)) / (b - a);
    }
    return 0;
  }
  function raio(r, t0, lider, luz) {
    const dur = lider + luz, n = r.main.length;
    return por({ camada: 2, t0, dur, d(cx, k) {
      const ms = k * dur;
      if (ms < lider) {
        const f = Math.floor(Math.pow(ms / lider, 1.25) * 14) / 14, ate = Math.max(2, Math.ceil(f * n));
        brilhar(cx, r.main, r.esc, 0.9, LUZ_FINA, ate);
        for (const g of r.galhos) if (g.ini < ate) brilhar(cx, g.pts, r.esc * 0.6, 0.6, LUZ_FINA, Math.max(2, Math.ceil(Math.min(1, (ate - g.ini) / 20) * g.pts.length)));
        const p = r.main[ate - 1];
        bola(cx, p[0], p[1], 16 * r.esc, [[0, 'rgba(220,230,255,.9)'], [1, 'rgba(120,150,255,0)']]);
        return;
      }
      const I = pisca((ms - lider) / luz);
      if (I < 0.02) return;
      bola(cx, r.x0, Math.max(0, r.y0), 220 * r.esc, [[0, `rgba(150,180,255,${0.35 * I})`], [1, 'rgba(80,110,255,0)']]);
      bola(cx, r.x1, r.y1, 110 * r.esc, [[0, `rgba(235,242,255,${0.8 * I})`], [0.3, `rgba(150,185,255,${0.4 * I})`], [1, 'rgba(90,120,255,0)']]);
      brilhar(cx, r.main, r.esc * (0.85 + I * 0.4), I);
      for (const g of r.galhos) brilhar(cx, g.pts, r.esc * 0.45, I * 0.75);
    } });
  }
  // eletricidade andando em volta de um ponto (pedra carregada, resto do raio)
  function arcos(x, y, raio, t0, dur, qtd = 3, forca = 1) {
    return por({ camada: 2, t0, dur, d(cx, k) {
      const f = forca * (k < 0.15 ? k / 0.15 : 1) * (Math.random() < 0.15 ? 0.35 : 1);
      bola(cx, x, y, raio * 1.6, [[0, `rgba(150,185,255,${0.28 * f})`], [1, 'rgba(90,120,255,0)']]);
      for (let i = 0; i < qtd; i++) {
        const a = sorte(0, TAU), a2 = a + sorte(-1, 1), r0 = raio * sorte(0.1, 0.5), r1 = raio * sorte(0.9, 1.5);
        brilhar(cx, torto(x + Math.cos(a) * r0, y + Math.sin(a) * r0, x + Math.cos(a2) * r1, y + Math.sin(a2) * r1, 3, 0.35), 0.5, f, LUZ_FINA.concat([[4, '140,175,255', 0.35]]));
      }
    } });
  }
  function anel(x, y, cor, rMax, dur, t0 = performance.now(), larg = 10) {
    return por({ camada: 2, t0, dur, d(cx, k) {
      const e = saida(k);
      cx.beginPath();
      cx.arc(x, y, 4 + rMax * e, 0, TAU);
      cx.lineWidth = Math.max(0.5, larg * (1 - k));
      cx.strokeStyle = `rgba(${cor},${(0.85 * (1 - k)).toFixed(3)})`;
      cx.stroke();
    } });
  }
  // partículas: brasa, faísca, caco, fumaça, chama, texto (emoji)
  function particula(o) {
    const t0 = o.t0 || performance.now();
    const p = { camada: o.camada != null ? o.camada : ({ fumaca: 0, caco: 1, texto: 1, gota: 1 }[o.tipo] != null ? { fumaca: 0, caco: 1, texto: 1, gota: 1 }[o.tipo] : 2),
      t0, dur: o.vida * 1000, x: o.x, y: o.y, vx: o.vx || 0, vy: o.vy || 0, rot: o.rot || 0, px: o.x, py: o.y,
      d(cx, k, dt) {
        this.px = this.x; this.py = this.y;
        if (o.arrasto) { const f = Math.pow(o.arrasto, dt); this.vx *= f; this.vy *= f; }
        this.vy += (o.g || 0) * dt;
        this.x += this.vx * dt; this.y += this.vy * dt;
        this.rot += (o.vr || 0) * dt;
        const a = 1 - k;
        if (o.tipo === 'brasa') {
          cx.lineCap = 'round';
          cx.lineWidth = o.tam * (1 - k * 0.6);
          cx.strokeStyle = `rgba(${o.cor},${a.toFixed(3)})`;
          cx.beginPath(); cx.moveTo(this.px - this.vx * 0.02, this.py - this.vy * 0.02); cx.lineTo(this.x, this.y); cx.stroke();
          bola(cx, this.x, this.y, o.tam * 3, [[0, `rgba(${o.cor},${(0.45 * a).toFixed(3)})`], [1, `rgba(${o.cor},0)`]]);
        } else if (o.tipo === 'faisca') {
          cx.lineCap = 'round';
          cx.lineWidth = o.tam;
          cx.strokeStyle = `rgba(${o.cor},${a.toFixed(3)})`;
          cx.beginPath(); cx.moveTo(this.x - this.vx * 0.045, this.y - this.vy * 0.045); cx.lineTo(this.x, this.y); cx.stroke();
        } else if (o.tipo === 'caco') {
          cx.save();
          cx.translate(this.x, this.y); cx.rotate(this.rot);
          cx.globalAlpha = k > 0.7 ? (1 - k) / 0.3 : 1;
          cx.beginPath();
          o.pts.forEach(([px, py], i) => (i ? cx.lineTo(px, py) : cx.moveTo(px, py)));
          cx.closePath();
          const g = cx.createLinearGradient(-o.tam, -o.tam, o.tam, o.tam);
          g.addColorStop(0, o.cores[0]); g.addColorStop(1, o.cores[1]);
          cx.fillStyle = g; cx.fill();
          const quente = Math.max(0, 1 - k * 2.5);
          if (quente > 0) { cx.lineWidth = 1.5; cx.strokeStyle = `rgba(255,190,110,${quente.toFixed(3)})`; cx.stroke(); }
          cx.restore();
        } else if (o.tipo === 'fumaca') {
          const r = o.tam * (1 + k * 2.2), al = o.a * (k < 0.12 ? k / 0.12 : 1) * a;
          bola(cx, this.x, this.y, r, [[0, `rgba(${o.cor || '38,34,32'},${al.toFixed(3)})`], [0.6, `rgba(${o.cor || '38,34,32'},${(al * 0.5).toFixed(3)})`], [1, `rgba(${o.cor || '38,34,32'},0)`]]);
        } else if (o.tipo === 'chama') {
          bola(cx, this.x, this.y, o.tam * (1 - k * 0.55), [[0, `rgba(255,235,255,${(0.9 * a).toFixed(3)})`], [0.3, `rgba(${o.cor},${(0.8 * a).toFixed(3)})`], [1, `rgba(${o.cor},0)`]]);
        } else if (o.tipo === 'gota') {
          cx.fillStyle = `rgba(${o.cor},${a.toFixed(3)})`;
          cx.beginPath(); cx.ellipse(this.x, this.y, o.tam * 0.7, o.tam, Math.atan2(this.vy, this.vx) - Math.PI / 2, 0, TAU); cx.fill();
        } else if (o.tipo === 'texto') {
          cx.save();
          cx.globalAlpha = Math.min(1, a * 1.6);
          cx.translate(this.x, this.y); cx.rotate(this.rot);
          const t = o.tam * (k < 0.15 ? 0.4 + (k / 0.15) * 0.6 : 1);
          cx.font = `${t.toFixed(1)}px "Apple Color Emoji","Segoe UI Emoji","Noto Color Emoji",sans-serif`;
          cx.textAlign = 'center'; cx.textBaseline = 'middle';
          cx.fillText(o.txt, 0, 0);
          cx.restore();
        }
      } };
    return por(p);
  }
  function pedaco(tam) {
    const k = 3 + Math.floor(Math.random() * 3), a0 = sorte(0, TAU);
    return Array.from({ length: k }, (_, i) => { const a = a0 + (TAU / k) * i + sorte(-0.4, 0.4), r = tam * sorte(0.5, 1); return [Math.cos(a) * r, Math.sin(a) * r]; });
  }
  const CORES = { b: ['#FFF8EC', '#C98F4E'], p: ['#5A524C', '#0E0C0B'], ouro: ['#FFF1C2', '#E08A1E'], laranja: ['#FFB347', '#FF7A1A'] };
  function cacos(x, y, lado, letra, qtd, forca = 1) {
    const cor = letra && letra.toLowerCase() === 'b' ? 'b' : 'p', dama = letra === 'B' || letra === 'P';
    for (let s = 0; s < qtd; s++) {
      const ang = sorte(-Math.PI * 0.95, -Math.PI * 0.05) + (Math.random() < 0.25 ? Math.PI : 0), v = lado * sorte(4, 12) * forca, tam = lado * sorte(0.07, 0.17);
      const tipo = dama && s < 5 ? 'ouro' : cor === 'p' && s % 5 === 0 ? 'laranja' : cor;
      particula({ tipo: 'caco', x: x + sorte(-0.2, 0.2) * lado, y: y + sorte(-0.2, 0.2) * lado, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, g: lado * 24, vr: sorte(-14, 14), rot: sorte(0, TAU), vida: sorte(1.1, 1.9), tam, pts: pedaco(tam), cores: CORES[tipo] });
    }
  }
  function brasas(x, y, lado, qtd, forca = 1, cores = ['255,220,120', '255,160,60', '255,250,220', '255,120,40']) {
    for (let s = 0; s < qtd; s++) {
      const ang = sorte(0, TAU), v = lado * sorte(2, 10) * forca;
      particula({ tipo: 'brasa', x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - lado * 2, g: lado * 7, arrasto: 0.3, vida: sorte(0.5, 1.4), tam: sorte(1.4, 3.2), cor: um(cores) });
    }
  }
  function faiscas(x, y, lado, qtd, forca = 1, cores = ['230,240,255', '255,240,180', '170,200,255']) {
    for (let s = 0; s < qtd; s++) {
      const ang = sorte(0, TAU), v = lado * sorte(9, 20) * forca;
      particula({ tipo: 'faisca', x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v, g: lado * 10, arrasto: 0.05, vida: sorte(0.2, 0.45), tam: sorte(1.2, 2.4), cor: um(cores) });
    }
  }
  function fumaca(x, y, lado, qtd, t0 = performance.now(), cor) {
    for (let s = 0; s < qtd; s++) {
      particula({ tipo: 'fumaca', t0: t0 + sorte(40, 160), x: x + sorte(-0.3, 0.3) * lado, y: y + sorte(-0.2, 0.2) * lado, vx: sorte(-0.7, 0.7) * lado, vy: -sorte(0.3, 1.1) * lado, arrasto: 0.5, vida: sorte(1.3, 2.3), tam: lado * sorte(0.28, 0.5), a: sorte(0.35, 0.55), cor });
    }
  }
  // rachadura com a borda em brasa e marca de queimado na casa
  function cratera(x, y, lado, dur = 2800, t0 = performance.now()) {
    const rachas = [];
    for (let i = 0, n = 6 + Math.floor(Math.random() * 3); i < n; i++) {
      const a = (TAU / n) * i + sorte(-0.3, 0.3), L = lado * sorte(0.35, 0.8);
      const pts = torto(x + Math.cos(a) * lado * 0.12, y + Math.sin(a) * lado * 0.12, x + Math.cos(a) * L, y + Math.sin(a) * L, 3, 0.25);
      rachas.push(pts);
      if (Math.random() < 0.5) { const q = pts[4], a2 = a + sorte(-0.8, 0.8); rachas.push(torto(q[0], q[1], q[0] + Math.cos(a2) * L * 0.45, q[1] + Math.sin(a2) * L * 0.45, 2, 0.3)); }
    }
    return por({ camada: 0, t0, dur, d(cx, k) {
      const a = k < 0.75 ? 1 : (1 - k) / 0.25;
      bola(cx, x, y, lado * 0.7, [[0, `rgba(0,0,0,${0.85 * a})`], [0.45, `rgba(25,12,4,${0.6 * a})`], [1, 'rgba(25,12,4,0)']]);
      cx.lineCap = 'round'; cx.lineJoin = 'round';
      for (const r of rachas) {
        trilha(cx, r);
        cx.lineWidth = 3.2; cx.strokeStyle = `rgba(8,4,2,${0.9 * a})`; cx.stroke();
        const q = Math.max(0, 1 - k * 1.5);
        if (q > 0) { cx.lineWidth = 1.3; cx.strokeStyle = `rgba(255,${(120 + 100 * q) | 0},40,${q})`; cx.stroke(); }
      }
    } });
  }
  function fogo(x, y, lado, esc = 1, t0 = performance.now()) {
    por({ camada: 2, t0, dur: 650 * esc, d(cx, k) {
      const a = Math.pow(1 - k, 1.4);
      bola(cx, x, y, lado * (0.3 + 1.7 * esc * saida(k)), [[0, `rgba(255,255,255,${a})`], [0.22, `rgba(255,240,190,${0.9 * a})`], [0.5, `rgba(255,150,40,${0.6 * a})`], [1, 'rgba(255,60,0,0)']]);
    } });
  }
  // a pedra estoura onde o raio caiu
  function impacto(x, y, lado, letra, esc = 1) {
    const t0 = performance.now();
    S.clarao = Math.max(S.clarao, 0.75 * esc);
    S.claraoCor = '232,240,255';
    S.tremor = Math.max(S.tremor, 11 * esc);
    cratera(x, y, lado * esc, 2600 + 600 * esc, t0);
    fumaca(x, y, lado * esc, Math.round(9 * esc), t0);
    fogo(x, y, lado, esc, t0);
    anel(x, y, '255,225,170', lado * 3.4 * esc, 700, t0, 12 * esc);
    anel(x, y, '150,190,255', lado * 2.4 * esc, 520, t0 + 40, 7 * esc);
    arcos(x, y, lado * 0.8 * esc, t0 + 60, 700, 2, 0.8);
    if (letra && letra !== '.') cacos(x, y, lado, letra, 22 + (letra === 'B' || letra === 'P' ? 6 : 0));
    brasas(x, y, lado, Math.round(48 * esc), esc);
    faiscas(x, y, lado, Math.round(28 * esc), esc);
  }

  // ======================= som =======================
  let ac = null;
  const ruidos = new Map();
  function audio() {
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return null;
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      return ac;
    } catch (e) { return null; }
  }
  function ruido(a, seg) {
    if (!ruidos.has(seg)) {
      const b = a.createBuffer(1, Math.floor(a.sampleRate * seg), a.sampleRate), d = b.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      ruidos.set(seg, b);
    }
    const s = a.createBufferSource();
    s.buffer = ruidos.get(seg);
    return s;
  }
  function saidaSom(a) {
    const comp = a.createDynamicsCompressor(), g = a.createGain();
    g.gain.value = 0.9;
    g.connect(comp).connect(a.destination);
    return g;
  }
  // trovão: estalo seco + corpo + ronco que vai embora + grave no peito
  function trovao(forca = 1) {
    const a = audio();
    if (!a) return;
    try {
      const t = a.currentTime + 0.005, out = saidaSom(a);
      const s1 = ruido(a, 0.3), hp = a.createBiquadFilter(), g1 = a.createGain();
      hp.type = 'highpass'; hp.frequency.value = 1100;
      g1.gain.setValueAtTime(0.6 * forca, t); g1.gain.exponentialRampToValueAtTime(0.001, t + 0.2);
      s1.connect(hp).connect(g1).connect(out); s1.start(t);
      const s2 = ruido(a, 1), lp = a.createBiquadFilter(), g2 = a.createGain();
      lp.type = 'lowpass'; lp.frequency.setValueAtTime(2600, t); lp.frequency.exponentialRampToValueAtTime(260, t + 0.8);
      g2.gain.setValueAtTime(0.0001, t); g2.gain.exponentialRampToValueAtTime(0.55 * forca, t + 0.012); g2.gain.exponentialRampToValueAtTime(0.001, t + 0.9);
      s2.connect(lp).connect(g2).connect(out); s2.start(t);
      const dur = 1.6 + forca * 1.1, s3 = ruido(a, 4), lp3 = a.createBiquadFilter(), g3 = a.createGain();
      lp3.type = 'lowpass'; lp3.Q.value = 2.5; lp3.frequency.setValueAtTime(280, t); lp3.frequency.exponentialRampToValueAtTime(55, t + dur);
      g3.gain.setValueAtTime(0.0001, t); g3.gain.exponentialRampToValueAtTime(0.9 * forca, t + 0.1);
      for (let tt = t + 0.1; tt < t + dur - 0.35;) { tt += sorte(0.1, 0.32); g3.gain.linearRampToValueAtTime(Math.max(0.03, sorte(0.25, 0.85) * forca * (1 - (tt - t) / dur)), tt); }
      g3.gain.exponentialRampToValueAtTime(0.001, t + dur);
      s3.connect(lp3).connect(g3).connect(out); s3.start(t); s3.stop(t + dur + 0.1);
      const o = a.createOscillator(), go = a.createGain();
      o.frequency.setValueAtTime(120, t); o.frequency.exponentialRampToValueAtTime(32, t + 0.55);
      go.gain.setValueAtTime(0.7 * forca, t); go.gain.exponentialRampToValueAtTime(0.001, t + 0.65);
      o.connect(go).connect(out); o.start(t); o.stop(t + 0.7);
    } catch (e) {}
  }
  // zumbido elétrico subindo enquanto as pedras carregam
  function zumbido(seg) {
    const a = audio();
    if (!a) return;
    try {
      const t = a.currentTime + 0.01, out = saidaSom(a);
      const o = a.createOscillator(), bp = a.createBiquadFilter(), g = a.createGain(), lfo = a.createOscillator(), lg = a.createGain();
      o.type = 'sawtooth'; o.frequency.setValueAtTime(55, t); o.frequency.linearRampToValueAtTime(150, t + seg);
      bp.type = 'bandpass'; bp.frequency.value = 950; bp.Q.value = 1.3;
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.13, t + Math.min(0.4, seg * 0.5)); g.gain.setValueAtTime(0.13, t + seg * 0.85); g.gain.exponentialRampToValueAtTime(0.0001, t + seg);
      lfo.frequency.value = 27; lg.gain.value = 0.07;
      lfo.connect(lg).connect(g.gain);
      o.connect(bp).connect(g).connect(out);
      o.start(t); lfo.start(t); o.stop(t + seg + 0.05); lfo.stop(t + seg + 0.05);
      const s = ruido(a, 4), hp = a.createBiquadFilter(), gs = a.createGain();
      hp.type = 'highpass'; hp.frequency.value = 3500;
      gs.gain.setValueAtTime(0.0001, t);
      for (let tt = t; tt < t + seg - 0.05; tt += sorte(0.03, 0.09)) { gs.gain.setValueAtTime(Math.random() < 0.35 ? sorte(0.05, 0.16) : 0.0001, tt); }
      gs.gain.setValueAtTime(0.0001, t + seg);
      s.connect(hp).connect(gs).connect(out); s.start(t); s.stop(t + seg + 0.05);
    } catch (e) {}
  }

  // ======================= combo de raio em 3D (three.js, carregado só quando precisa) =======================
  const TRES = 'https://cdnjs.cloudflare.com/ajax/libs/three.js/r128/three.min.js';
  let tresP = null;
  // chamado quando abre uma partida: baixa o three.js quieto, pra estar pronto no primeiro combo
  function preparar3d() {
    if (window.THREE) return Promise.resolve(window.THREE);
    if (!tresP) {
      tresP = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = TRES;
        s.async = true;
        s.onload = () => (window.THREE ? ok(window.THREE) : falha(new Error('three')));
        s.onerror = () => { tresP = null; falha(new Error('three')); };
        document.head.append(s);
      });
      tresP.catch(() => {});
    }
    return tresP;
  }
  const G = { r: null, falhou: false, coisas: [], cacos: [], raf: 0, ult: 0, tex: null, luzes: [], luzVez: 0, w: 0, h: 0, dist: 1 };
  const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
  const mundo = (px, py) => [px - G.w / 2, G.h / 2 - py];
  const ADD = () => ({ transparent: true, depthWrite: false, blending: THREE.AdditiveBlending });
  function texCanvas(tam, desenhar) {
    const c = document.createElement('canvas');
    c.width = c.height = tam;
    desenhar(c.getContext('2d'), tam);
    return new THREE.CanvasTexture(c);
  }
  function manchas(c, t, qtd, a) {
    for (let i = 0; i < qtd; i++) {
      const x = t / 2 + sorte(-0.2, 0.2) * t, y = t / 2 + sorte(-0.2, 0.2) * t, r = t * sorte(0.14, 0.3);
      const g = c.createRadialGradient(x, y, 0, x, y, r);
      g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
    }
  }
  function texturas() {
    if (G.tex) return G.tex;
    const brilho = texCanvas(128, (c, t) => {
      const g = c.createRadialGradient(t / 2, t / 2, 0, t / 2, t / 2, t / 2);
      g.addColorStop(0, 'rgba(255,255,255,1)'); g.addColorStop(0.18, 'rgba(255,255,255,.85)'); g.addColorStop(0.45, 'rgba(255,255,255,.25)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, t, t);
    });
    const fogo = texCanvas(128, (c, t) => manchas(c, t, 22, 0.5));
    const fumaca = texCanvas(128, (c, t) => manchas(c, t, 16, 0.32));
    // reflexo de lente: risco comprido na horizontal + um menor na vertical
    const estrela = texCanvas(256, (c, t) => {
      for (const [sx, sy, a] of [[1, 0.035, 1], [0.035, 0.55, 0.7], [0.3, 0.3, 0.8]]) {
        c.save(); c.translate(t / 2, t / 2); c.scale(sx, sy);
        const g = c.createRadialGradient(0, 0, 0, 0, 0, t / 2);
        g.addColorStop(0, `rgba(255,255,255,${a})`); g.addColorStop(0.3, `rgba(255,255,255,${a * 0.35})`); g.addColorStop(1, 'rgba(255,255,255,0)');
        c.fillStyle = g; c.beginPath(); c.arc(0, 0, t / 2, 0, TAU); c.fill(); c.restore();
      }
    });
    const anel = texCanvas(256, (c, t) => {
      const g = c.createRadialGradient(t / 2, t / 2, 0, t / 2, t / 2, t / 2);
      g.addColorStop(0, 'rgba(255,255,255,0)'); g.addColorStop(0.72, 'rgba(255,255,255,0)'); g.addColorStop(0.9, 'rgba(255,255,255,1)'); g.addColorStop(0.95, 'rgba(255,255,255,.35)'); g.addColorStop(1, 'rgba(255,255,255,0)');
      c.fillStyle = g; c.fillRect(0, 0, t, t);
    });
    G.tex = { brilho, fogo, fumaca, estrela, anel };
    return G.tex;
  }
  function palco3d() {
    const T = window.THREE;
    if (!T || G.falhou) return false;
    if (!G.r) {
      try { G.r = new T.WebGLRenderer({ alpha: true, antialias: true, powerPreference: 'high-performance' }); } catch (e) { G.falhou = true; return false; }
      G.r.setClearColor(0x000000, 0);
      G.cv = G.r.domElement;
      G.cv.className = 'jg-fx-3d';
      G.cv.setAttribute('aria-hidden', 'true');
      G.cv.addEventListener('webglcontextlost', (e) => { e.preventDefault(); G.falhou = true; });
      G.cena = new T.Scene();
      G.cam = new T.PerspectiveCamera(40, 1, 1, 10000);
      G.cena.add(new T.HemisphereLight(0xe8eeff, 0x2a1a10, 0.75));
      const sol = new T.DirectionalLight(0xffffff, 0.85);
      sol.position.set(-0.45, 0.6, 1);
      G.cena.add(sol);
      for (let i = 0; i < 4; i++) { const l = new T.PointLight(0xffffff, 0, 600, 1); G.luzes.push(l); G.cena.add(l); }
      texturas();
      addEventListener('resize', () => { if (G.r) medir3d(); });
    }
    if (!G.cv.isConnected) document.body.append(G.cv);
    medir3d();
    if (!G.raf) { G.ult = performance.now(); G.raf = requestAnimationFrame(quadro3d); }
    return true;
  }
  // câmera olhando o tabuleiro de cima: no chão (z = 0) 1 unidade = 1 px da tela, então o 3D cai certinho em cima do tabuleiro
  function medir3d() {
    const w = document.documentElement.clientWidth || innerWidth, h = document.documentElement.clientHeight || innerHeight;
    if (G.w === w && G.h === h) return;
    G.w = w; G.h = h;
    G.r.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
    G.r.setSize(w, h, false);
    G.cam.aspect = w / h;
    G.dist = h / 2 / Math.tan(THREE.MathUtils.degToRad(G.cam.fov / 2));
    G.cam.far = G.dist * 8;
    G.cam.updateProjectionMatrix();
  }
  function coisa(atualizar, limpar, t0 = performance.now()) {
    const c = { t0, atualizar, limpar };
    G.coisas.push(c);
    return c;
  }
  function soltar(obj) {
    G.cena.remove(obj);
    obj.traverse((o) => { if (o.geometry) o.geometry.dispose(); if (o.material) [].concat(o.material).forEach((m) => m.dispose()); });
  }
  function luz(x, y, z, cor, forca, alcance) {
    const l = G.luzes[G.luzVez++ % G.luzes.length];
    l.position.set(x, y, z); l.color.setHex(cor); l.intensity = forca; l.distance = alcance;
    return l;
  }
  function quadro3d(agora) {
    const dt = Math.min(0.05, (agora - G.ult) / 1000);
    G.ult = agora;
    for (const c of G.coisas) {
      if (c.morto || agora < c.t0) continue;
      if (c.atualizar(agora - c.t0, dt) === false) { c.morto = true; if (c.limpar) c.limpar(); }
    }
    G.coisas = G.coisas.filter((c) => !c.morto);
    for (const l of G.luzes) l.intensity = l.intensity < 0.02 ? 0 : l.intensity * Math.pow(0.015, dt);
    const ox = S.ox || 0, oy = S.oy || 0;
    G.cam.position.set(-ox, oy, G.dist);
    G.cam.lookAt(-ox, oy, 0);
    G.r.render(G.cena, G.cam);
    if (!G.coisas.length) { G.raf = 0; G.r.clear(); G.cv.remove(); return; }
    G.raf = requestAnimationFrame(quadro3d);
  }
  // linha torta em 3D (divide ao meio e empurra o meio pra um lado qualquer)
  function torto3(a, b, voltas, desvio) {
    let pts = [a, b], d = a.distanceTo(b) * desvio;
    for (let v = 0; v < voltas; v++) {
      const novo = [pts[0]];
      for (let i = 0; i < pts.length - 1; i++) {
        const p = pts[i], q = pts[i + 1], dir = q.clone().sub(p).normalize();
        const r = V3(sorte(-1, 1), sorte(-1, 1), sorte(-1, 1));
        r.sub(dir.clone().multiplyScalar(r.dot(dir))).normalize();
        novo.push(p.clone().lerp(q, 0.5).add(r.multiplyScalar(sorte(-d, d))), q);
      }
      pts = novo;
      d *= 0.55;
    }
    return pts;
  }
  function tubo(pts, raio, mat, lados = 6) {
    const T = THREE, c = new T.CurvePath();
    for (let i = 0; i < pts.length - 1; i++) c.add(new T.LineCurve3(pts[i], pts[i + 1]));
    const m = new T.Mesh(new T.TubeGeometry(c, (pts.length - 1) * 2, raio, lados, false), mat);
    m.userData.segs = (pts.length - 1) * 2;
    m.userData.lados = lados;
    return m;
  }
  const mostrar = (m, f) => m.geometry.setDrawRange(0, Math.floor(m.userData.segs * Math.max(0, Math.min(1, f))) * m.userData.lados * 6);
  function brilho3d(cor, tam, x, y, z, op = 1, tex = 'brilho') {
    const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: G.tex[tex], color: cor, opacity: op, ...ADD() }));
    s.scale.set(tam, tam, 1);
    s.position.set(x, y, z);
    G.cena.add(s);
    return s;
  }

  // ---- a pedra em 3D: cilindro com o aro do site; a dama ganha coroa de ouro ----
  function peca3d(letra, lado) {
    const T = THREE, cor = String(letra).toLowerCase() === 'b' ? 'b' : 'p', dama = letra === 'B' || letra === 'P';
    const R = lado * 0.39, H = lado * 0.2, g = new T.Group();
    const corpo = cor === 'b'
      ? new T.MeshStandardMaterial({ color: 0xF2D6AE, roughness: 0.42, metalness: 0.05 })
      : new T.MeshStandardMaterial({ color: 0x2b2522, roughness: 0.3, metalness: 0.3 });
    const aro = cor === 'p'
      ? new T.MeshStandardMaterial({ color: 0xFF7A1A, emissive: 0xFF6A10, emissiveIntensity: 0.9, roughness: 0.4 })
      : new T.MeshStandardMaterial({ color: 0xC9935A, roughness: 0.5 });
    const c = new T.Mesh(new T.CylinderGeometry(R, R * 0.93, H, 40), corpo);
    c.rotation.x = Math.PI / 2; c.position.z = H / 2;
    g.add(c);
    const a1 = new T.Mesh(new T.TorusGeometry(R * 0.6, R * 0.055, 8, 40), aro);
    a1.position.z = H;
    g.add(a1);
    if (cor === 'p') { const a2 = new T.Mesh(new T.TorusGeometry(R * 0.96, R * 0.065, 8, 48), aro); a2.position.z = H * 0.92; g.add(a2); }
    const coroa = [];
    if (dama) {
      const ouro = new T.MeshStandardMaterial({ color: 0xFFD84D, metalness: 0.85, roughness: 0.25, emissive: 0x7a3a00, emissiveIntensity: 0.7 });
      const base = new T.Mesh(new T.TorusGeometry(R * 0.34, R * 0.08, 8, 30), ouro);
      base.position.z = H + R * 0.03;
      g.add(base); coroa.push(base);
      for (let i = 0; i < 5; i++) {
        const a = (TAU * i) / 5, p = new T.Mesh(new T.ConeGeometry(R * 0.11, R * 0.45, 8), ouro);
        p.rotation.x = Math.PI / 2; p.position.set(Math.cos(a) * R * 0.32, Math.sin(a) * R * 0.32, H + R * 0.24);
        g.add(p); coroa.push(p);
      }
    }
    return { g, R, H, cor, dama, corpo, aro, coroa, quebrada: false };
  }
  // carregada: sobe do tabuleiro, gira tremendo, fica azul e solta faísca pro chão
  function carregar(p, x, y, lado) {
    const T = THREE, [wx, wy] = mundo(x, y);
    p.g.position.set(wx, wy, 0);
    G.cena.add(p.g);
    const mA = new T.MeshBasicMaterial({ color: 0xdfe8ff, opacity: 0.95, ...ADD() });
    const mH = new T.MeshBasicMaterial({ color: 0x5b7dff, opacity: 0.35, ...ADD() });
    const halo = brilho3d(0x7a9cff, lado * 2.6, wx, wy, 0, 0);
    let arcos = [], prox = 0;
    const tirar = () => { arcos.forEach((a) => { G.cena.remove(a); a.geometry.dispose(); }); arcos = []; };
    coisa((t, dt) => {
      if (p.quebrada) return false;
      const k = Math.min(1, t / 320), f = Math.random() < 0.2 ? 0.3 : 1;
      p.g.position.z = lado * 0.42 * saida(k) + Math.sin(t / 60) * lado * 0.025;
      p.g.rotation.x = Math.sin(t / 85) * 0.32 * k;
      p.g.rotation.y = Math.cos(t / 105) * 0.32 * k;
      p.g.rotation.z += dt * 4 * k;
      p.corpo.emissive.setHex(0x3355ff);
      p.corpo.emissiveIntensity = (0.25 + 0.55 * Math.random()) * k;
      halo.material.opacity = 0.75 * k * f;
      halo.position.z = p.g.position.z + p.H;
      if (t >= prox) {
        prox = t + 50;
        tirar();
        for (let i = 0; i < 3; i++) {
          const a = sorte(0, TAU), z = p.g.position.z + p.H * 0.5;
          const ini = V3(wx + Math.cos(a) * p.R, wy + Math.sin(a) * p.R, z);
          const a2 = a + sorte(-0.8, 0.8), r2 = p.R * sorte(1.3, 2.4);
          const pts = torto3(ini, V3(wx + Math.cos(a2) * r2, wy + Math.sin(a2) * r2, Math.random() < 0.6 ? 0 : z * sorte(0.5, 1.4)), 3, 0.3);
          const a1 = tubo(pts, 0.8, mA, 4), a2m = tubo(pts, 3.2, mH, 4);
          arcos.push(a1, a2m);
          G.cena.add(a1, a2m);
        }
      }
    }, () => { tirar(); mA.dispose(); mH.dispose(); soltar(halo); });
  }
  // o raio: o líder desce aos trancos, o canal acende inteiro e pisca; ilumina tudo em volta
  function raio3d(a, b, esc, lado, t0, lider, luzMs, aoBater) {
    const T = THREE, main = torto3(a, b, 7, 0.12), galhos = [], g = new T.Group();
    const dir = b.clone().sub(a).normalize(), tot = a.distanceTo(b);
    for (let i = 0, n = 3 + Math.round(esc * 2); i < n; i++) {
      const ini = Math.floor(sorte(0.08, 0.75) * main.length), p = main[ini];
      const r = V3(sorte(-1, 1), sorte(-1, 1), sorte(-0.3, 0.3)).normalize();
      const fim = p.clone().add(dir.clone().multiplyScalar(0.7).add(r).normalize().multiplyScalar(tot * sorte(0.1, 0.28)));
      galhos.push({ ini, pts: torto3(p, fim, 5, 0.2) });
    }
    const mats = [
      new T.MeshBasicMaterial({ color: 0xffffff, opacity: 1, ...ADD() }),
      new T.MeshBasicMaterial({ color: 0xa8c0ff, opacity: 0.55, ...ADD() }),
      new T.MeshBasicMaterial({ color: 0x4f6fff, opacity: 0.2, ...ADD() }),
    ];
    const base = mats.map((m) => m.opacity);
    const RAIOS = [1.5, 4.5, 12];
    const tMain = RAIOS.map((r, i) => tubo(main, r * esc, mats[i]));
    const tGal = galhos.map((gl) => ({ ini: gl.ini, m: RAIOS.map((r, i) => tubo(gl.pts, r * esc * 0.45, mats[i], 5)) }));
    tMain.forEach((m) => g.add(m));
    tGal.forEach((gl) => gl.m.forEach((m) => g.add(m)));
    const ceu = brilho3d(0x6f8cff, 700 * esc, a.x, a.y, a.z, 0);
    const chao = brilho3d(0xcfdcff, lado * 5 * esc, b.x, b.y, b.z, 0);
    const lente = brilho3d(0xe6eeff, lado * 11 * esc, b.x, b.y, b.z + 4, 0, 'estrela');
    g.visible = false;
    G.cena.add(g);
    const L = G.luzes[G.luzVez++ % G.luzes.length];
    let bateu = false;
    coisa((t) => {
      g.visible = true;
      if (t < lider) {
        const f = Math.floor(Math.pow(t / lider, 1.25) * 14) / 14, m = f * main.length;
        tMain.forEach((x, i) => { mostrar(x, f); x.material.opacity = i === 2 ? 0 : base[i] * 0.55; });
        tGal.forEach((gl) => gl.m.forEach((x) => mostrar(x, (m - gl.ini) / 14)));
        return;
      }
      if (!bateu) {
        bateu = true;
        tMain.forEach((x) => mostrar(x, 1));
        tGal.forEach((gl) => gl.m.forEach((x) => mostrar(x, 1)));
        if (aoBater) aoBater();
      }
      const s = (t - lider) / luzMs;
      if (s >= 1) return false;
      const I = pisca(s);
      mats.forEach((m, i) => { m.opacity = base[i] * I; });
      ceu.material.opacity = 0.5 * I;
      chao.material.opacity = 0.9 * I;
      lente.material.opacity = Math.max(0, 1 - s * 2.2) * I;
      L.position.set(b.x, b.y, b.z + lado * 2); L.color.setHex(0xc8d6ff); L.intensity = 5 * I * esc; L.distance = lado * 16 * esc;
    }, () => { soltar(g); soltar(ceu); soltar(chao); soltar(lente); }, t0);
  }
  // pedra estilhaça: fatias sólidas (como pizza, em 2 camadas) que voam, caem no tabuleiro e quicam
  function quebrar(p, lado, forca = 1) {
    const T = THREE;
    p.quebrada = true;
    p.g.updateMatrixWorld();
    const centro = p.g.position.clone();
    const fatias = 8 + Math.floor(Math.random() * 3), cortes = [0];
    for (let i = 1; i < fatias; i++) cortes.push((TAU * i) / fatias + sorte(-0.25, 0.25));
    cortes.push(TAU);
    const rot0 = p.g.rotation.z;
    const voar = (mesh, dx, dy, alto) => {
      const d = Math.hypot(dx, dy) || 1, sobe = Math.random() < 0.25 ? sorte(18, 30) : sorte(5, 13);
      G.cacos.push(mesh);
      mesh.userData.v = V3((dx / d) * lado * sorte(3, 10) * forca + sorte(-1, 1) * lado, (dy / d) * lado * sorte(3, 10) * forca + sorte(-1, 1) * lado, lado * sobe * forca);
      mesh.userData.w = V3(sorte(-15, 15), sorte(-15, 15), sorte(-10, 10));
      mesh.userData.alto = alto;
      const vida = sorte(2.6, 3.4), mat = mesh.material;
      coisa((t, dt) => {
        const s = t / 1000, v = mesh.userData.v, w = mesh.userData.w;
        v.z -= lado * 42 * dt;
        mesh.position.addScaledVector(v, dt);
        mesh.rotation.x += w.x * dt; mesh.rotation.y += w.y * dt; mesh.rotation.z += w.z * dt;
        if (mesh.position.z < alto && v.z < 0) {
          mesh.position.z = alto;
          v.z *= -0.38; v.x *= 0.72; v.y *= 0.72; w.multiplyScalar(0.65);
          if (Math.abs(v.z) < lado * 1.5) { v.z = 0; v.x *= 0.9; v.y *= 0.9; }
        }
        if (mat.emissiveIntensity != null && mat.userData.quente) mat.emissiveIntensity = Math.max(0, 1.6 * (1 - s / 0.9));
        if (s > vida - 0.6) { mat.transparent = true; mat.opacity = Math.max(0, (vida - s) / 0.6); }
        if (s >= vida) return false;
      }, () => { soltar(mesh); const i = G.cacos.indexOf(mesh); if (i >= 0) G.cacos.splice(i, 1); });
    };
    for (let camada = 0; camada < 2; camada++) {
      for (let i = 0; i < fatias; i++) {
        const th0 = cortes[i] + rot0, th1 = cortes[i + 1] + rot0, sh = new T.Shape(), cr = sorte(0, p.R * 0.18), ca = sorte(0, TAU);
        sh.moveTo(Math.cos(ca) * cr, Math.sin(ca) * cr);
        for (let s = 0; s <= 4; s++) { const th = th0 + ((th1 - th0) * s) / 4, rr = p.R * (s % 4 === 0 ? 1 : sorte(0.88, 1)); sh.lineTo(Math.cos(th) * rr, Math.sin(th) * rr); }
        const geo = new T.ExtrudeGeometry(sh, { depth: p.H / 2, bevelEnabled: false, curveSegments: 1 });
        geo.computeBoundingBox();
        const c = new T.Vector3();
        geo.boundingBox.getCenter(c);
        geo.translate(-c.x, -c.y, -c.z);
        const mat = p.corpo.clone();
        mat.emissive.setHex(0xff5a00);
        mat.emissiveIntensity = 1.6;
        mat.userData.quente = true;
        const m = new T.Mesh(geo, mat);
        m.position.set(centro.x + c.x, centro.y + c.y, centro.z + camada * (p.H / 2) + c.z);
        G.cena.add(m);
        voar(m, c.x, c.y, p.H * 0.25);
      }
    }
    // o aro e a coroa saem voando inteiros
    for (const parte of p.coroa) {
      const wp = new T.Vector3();
      parte.getWorldPosition(wp);
      const m = parte.clone();
      m.material = parte.material.clone();
      m.position.copy(wp);
      G.cena.add(m);
      voar(m, wp.x - centro.x + sorte(-1, 1), wp.y - centro.y + sorte(-1, 1), p.R * 0.1);
    }
    // o aro e a coroa viraram clones que dividem a geometria: só o corpo some daqui
    G.cena.remove(p.g);
    p.g.children[0].geometry.dispose();
    [p.corpo, p.aro].forEach((m) => m.dispose());
  }
  // explosão onde o raio caiu
  function explosao3d(x, y, z, lado, esc = 1) {
    const T = THREE;
    luz(x, y, z + lado * 1.5, 0xff9a40, 4 * esc, lado * 12 * esc);
    // clarão no ponto e reflexo de lente
    const flash = brilho3d(0xffffff, lado * 3, x, y, z + 2, 1);
    coisa((t) => { const k = t / 320; if (k >= 1) return false; flash.scale.setScalar(lado * (2.5 + 2.5 * esc * saida(k))); flash.material.opacity = 0.85 * (1 - k); }, () => soltar(flash));
    // bola de fogo
    const corFogo = [new T.Color(0xffffff), new T.Color(0xffe2a0), new T.Color(0xff8a20), new T.Color(0x5a1a00)];
    for (let i = 0; i < 8; i++) {
      const s = brilho3d(0xffffff, lado, x + sorte(-0.3, 0.3) * lado, y + sorte(-0.3, 0.3) * lado, z + 3, 1, 'fogo');
      s.material.rotation = sorte(0, TAU);
      const vz = lado * sorte(1.5, 5) * esc, dur = sorte(600, 900) * Math.sqrt(esc), ini = sorte(0.5, 0.9) * lado, fim = lado * sorte(1.8, 2.8) * Math.sqrt(esc), rot = sorte(-2, 2);
      coisa((t, dt) => {
        const k = t / dur;
        if (k >= 1) return false;
        s.position.z += vz * dt;
        s.scale.setScalar(ini + (fim - ini) * saida(k));
        s.material.rotation += rot * dt;
        const f = k * 3, j = Math.min(2, Math.floor(f));
        s.material.color.copy(corFogo[j]).lerp(corFogo[j + 1], f - j);
        s.material.opacity = Math.pow(1 - k, 1.6) * (esc > 1.3 ? 0.55 : 1);
      }, () => soltar(s));
    }
    // fumaça subindo em direção à tela
    for (let i = 0; i < 10; i++) {
      const s = new T.Sprite(new T.SpriteMaterial({ map: G.tex.fumaca, color: 0x221d1a, transparent: true, depthWrite: false, opacity: 0 }));
      s.position.set(x + sorte(-0.4, 0.4) * lado, y + sorte(-0.4, 0.4) * lado, z + 2);
      s.material.rotation = sorte(0, TAU);
      G.cena.add(s);
      const vz = lado * sorte(1, 3), vx = sorte(-1, 1) * lado * 0.9, vy = sorte(-1, 1) * lado * 0.9, dur = sorte(1600, 2400), a = sorte(0.4, 0.6), rot = sorte(-0.8, 0.8);
      coisa((t, dt) => {
        const k = t / dur;
        if (k >= 1) return false;
        s.position.x += vx * dt; s.position.y += vy * dt; s.position.z += vz * dt * (1 - k);
        s.scale.setScalar(lado * (0.7 + 1.9 * Math.sqrt(esc) * saida(k)));
        s.material.rotation += rot * dt;
        s.material.opacity = a * (k < 0.1 ? k / 0.1 : 1) * (1 - k);
      }, () => soltar(s), performance.now() + sorte(80, 200));
    }
    // ondas de choque no chão
    for (const [cor, alcance, dur, atraso] of [[0xffd9a0, 3.6, 700, 0], [0x8fb0ff, 2.6, 520, 50], [0xffffff, 1.6, 320, 0]].concat(esc > 1.3 ? [[0xbfd0ff, 9, 1100, 80]] : [])) {
      const m = new T.Mesh(new T.PlaneGeometry(2, 2), new T.MeshBasicMaterial({ map: G.tex.anel, color: cor, opacity: 0.9, ...ADD() }));
      m.position.set(x, y, 1);
      m.scale.setScalar(0.01);
      G.cena.add(m);
      coisa((t) => {
        const k = t / dur;
        if (k >= 1) return false;
        m.scale.setScalar(lado * (0.3 + alcance * Math.sqrt(esc) * saida(k)));
        m.material.opacity = 0.95 * Math.pow(1 - k, 1.4);
      }, () => soltar(m), performance.now() + atraso);
    }
    // brasas (pontos que quicam no chão)
    const nB = Math.round(110 * esc), pos = new Float32Array(nB * 3), cor = new Float32Array(nB * 3), vel = [], vida = [], cores = [];
    for (let i = 0; i < nB; i++) {
      const a = sorte(0, TAU), v = lado * sorte(2, 11) * esc;
      pos.set([x, y, z + 2], i * 3);
      vel.push(V3(Math.cos(a) * v, Math.sin(a) * v, lado * sorte(2, 18) * esc));
      vida.push(sorte(0.6, 1.7));
      cores.push(um([[1, 0.86, 0.5], [1, 0.6, 0.2], [1, 1, 0.9], [0.75, 0.85, 1]]));
    }
    const gB = new T.BufferGeometry();
    gB.setAttribute('position', new T.BufferAttribute(pos, 3));
    gB.setAttribute('color', new T.BufferAttribute(cor, 3));
    const pts = new T.Points(gB, new T.PointsMaterial({ size: lado * 0.16, map: G.tex.brilho, vertexColors: true, sizeAttenuation: true, ...ADD() }));
    G.cena.add(pts);
    coisa((t, dt) => {
      const s = t / 1000;
      if (s > 1.8) return false;
      for (let i = 0; i < nB; i++) {
        const v = vel[i], j = i * 3;
        v.z -= lado * 20 * dt; v.x *= Math.pow(0.4, dt); v.y *= Math.pow(0.4, dt);
        pos[j] += v.x * dt; pos[j + 1] += v.y * dt; pos[j + 2] += v.z * dt;
        if (pos[j + 2] < 1 && v.z < 0) { pos[j + 2] = 1; v.z *= -0.4; }
        const f = Math.max(0, 1 - s / vida[i]), c = cores[i];
        cor[j] = c[0] * f; cor[j + 1] = c[1] * f; cor[j + 2] = c[2] * f;
      }
      gB.attributes.position.needsUpdate = true;
      gB.attributes.color.needsUpdate = true;
    }, () => soltar(pts));
    // faíscas rápidas (riscos)
    const nF = Math.round(60 * esc), lp = new Float32Array(nF * 6), lc = new Float32Array(nF * 6), fv = [], fp = [], fvida = [];
    for (let i = 0; i < nF; i++) {
      const a = sorte(0, TAU), v = lado * sorte(6, 14) * Math.sqrt(esc);
      fp.push(V3(x, y, z + 2));
      fv.push(V3(Math.cos(a) * v, Math.sin(a) * v, lado * sorte(1, 14)));
      fvida.push(sorte(0.15, 0.35));
    }
    const gF = new T.BufferGeometry();
    gF.setAttribute('position', new T.BufferAttribute(lp, 3));
    gF.setAttribute('color', new T.BufferAttribute(lc, 3));
    const linhas = new T.LineSegments(gF, new T.LineBasicMaterial({ vertexColors: true, ...ADD() }));
    G.cena.add(linhas);
    coisa((t, dt) => {
      const s = t / 1000;
      if (s > 0.55) return false;
      for (let i = 0; i < nF; i++) {
        const p = fp[i], v = fv[i], j = i * 6, f = Math.max(0, 1 - s / fvida[i]);
        v.z -= lado * 14 * dt;
        p.addScaledVector(v, dt);
        lp[j] = p.x; lp[j + 1] = p.y; lp[j + 2] = p.z;
        lp[j + 3] = p.x - v.x * 0.04; lp[j + 4] = p.y - v.y * 0.04; lp[j + 5] = p.z - v.z * 0.04;
        lc[j] = lc[j + 3] = f; lc[j + 1] = lc[j + 4] = f * 0.95; lc[j + 2] = lc[j + 5] = f * 0.8;
      }
      gF.attributes.position.needsUpdate = true;
      gF.attributes.color.needsUpdate = true;
    }, () => soltar(linhas));
    // marca de queimado com rachaduras em brasa
    const tam = lado * 1.9 * Math.sqrt(esc), rachas = [];
    for (let i = 0, n = 7 + Math.floor(Math.random() * 3); i < n; i++) {
      const a = (TAU / n) * i + sorte(-0.3, 0.3), L = sorte(0.22, 0.46);
      rachas.push(torto(0.5, 0.5, 0.5 + Math.cos(a) * L, 0.5 + Math.sin(a) * L, 3, 0.25));
    }
    // duas camadas com as mesmas rachaduras: a escura fica, a de brasa apaga antes
    const fazer = (quente) => {
      const tx = texCanvas(256, (c, t) => {
        if (!quente) {
          const g = c.createRadialGradient(t / 2, t / 2, 0, t / 2, t / 2, t / 2);
          g.addColorStop(0, 'rgba(0,0,0,.9)'); g.addColorStop(0.4, 'rgba(20,10,4,.65)'); g.addColorStop(1, 'rgba(20,10,4,0)');
          c.fillStyle = g; c.fillRect(0, 0, t, t);
        }
        c.lineCap = 'round'; c.lineJoin = 'round';
        for (const r of rachas) {
          trilha(c, r.map(([a, b]) => [a * t, b * t]));
          c.lineWidth = quente ? 3 : 7; c.strokeStyle = quente ? 'rgba(255,170,60,1)' : 'rgba(6,3,1,.95)'; c.stroke();
        }
      });
      const m = new T.Mesh(new T.PlaneGeometry(tam, tam), new T.MeshBasicMaterial({ map: tx, transparent: true, depthWrite: false, opacity: 1, blending: quente ? T.AdditiveBlending : T.NormalBlending }));
      m.position.set(x, y, quente ? 0.6 : 0.3);
      G.cena.add(m);
      const dur = quente ? 1800 : 3400 * Math.sqrt(esc);
      coisa((t) => { const k = t / dur; if (k >= 1) return false; m.material.opacity = quente ? 1 - k : k < 0.7 ? 1 : (1 - k) / 0.3; }, () => { tx.dispose(); soltar(m); });
    };
    fazer(false);
    fazer(true);
  }
  // o estouro final joga os cacos que estão no chão pro alto de novo
  function empurrar(x, y, lado, forca) {
    for (const m of G.cacos) {
      const dx = m.position.x - x, dy = m.position.y - y, d = Math.hypot(dx, dy) || 1, f = forca / Math.max(1, d / (lado * 2));
      m.userData.v.x += (dx / d) * lado * 9 * f;
      m.userData.v.y += (dy / d) * lado * 9 * f;
      m.userData.v.z += lado * sorte(10, 22) * f;
      m.userData.w.set(sorte(-18, 18), sorte(-18, 18), sorte(-12, 12));
    }
  }
  function combo3d(alvos, lado, mx, my, som, aoAcabar) {
    const n = alvos.length, t0 = performance.now(), CARGA = 560, GAP = 520, LIDER = 210, LUZ_MS = 680;
    const quando = (k) => CARGA + k * GAP + LIDER;
    const tFinal = quando(n - 1) + 560;
    S.escuroAlvo = 1;
    S.escuroAte = t0 + tFinal + 1600;
    const pecas = alvos.map((a) => {
      const p = peca3d(a.letra && a.letra !== '.' ? a.letra : 'p', lado);
      carregar(p, a.x, a.y, lado);
      return p;
    });
    if (som) zumbido(quando(n - 1) / 1000);
    alvos.forEach((a, k) => {
      const [wx, wy] = mundo(a.x, a.y), p = pecas[k];
      const alvo = V3(wx, wy, lado * 0.42 + p.H);
      const ceu = V3(wx + sorte(-1, 1) * Math.min(G.w * 0.3, 220), G.h / 2 + 140, lado * sorte(9, 13));
      raio3d(ceu, alvo, 1, lado, t0 + CARGA + k * GAP, LIDER, LUZ_MS, () => {
        quebrar(p, lado, 1 + k * 0.1);
        explosao3d(wx, wy, 0, lado, 1 + k * 0.08);
        S.clarao = Math.max(S.clarao, 0.38); S.claraoCor = '205,220,255';
        S.tremor = Math.max(S.tremor, 12 + k * 2);
        if (som) trovao(0.65 + k * 0.1);
        if (navigator.vibrate) navigator.vibrate(40);
      });
    });
    // final: um raio gigante no meio do tabuleiro + dois menores; o estouro joga tudo pro alto
    setTimeout(() => {
      const t1 = performance.now(), [cx, cy] = mundo(mx, my), esc = 2 + Math.min(n - 2, 3) * 0.3;
      for (let s = 0; s < 2; s++) {
        const lx = cx + sorte(-1, 1) * lado * 2.5, ly = cy + sorte(-1, 1) * lado * 2.5;
        raio3d(V3(lx + sorte(-1, 1) * G.w * 0.4, G.h / 2 + 140, lado * 11), V3(lx, ly, 0), 0.8, lado, t1 + s * 110, 150, 520, () => explosao3d(lx, ly, 0, lado, 0.7));
      }
      raio3d(V3(cx + sorte(-30, 30), G.h / 2 + 160, lado * 14), V3(cx, cy, 0), esc, lado, t1 + 260, 170, 1000, () => {
        explosao3d(cx, cy, 0, lado, esc);
        empurrar(cx, cy, lado, 1.4);
        S.clarao = 0.55; S.claraoCor = '205,220,255';
        S.tremor = 28;
        if (som) trovao(1.4);
        if (navigator.vibrate) navigator.vibrate([60, 40, 200]);
        if (aoAcabar) setTimeout(aoAcabar, 2600);
      });
    }, tFinal);
  }

  // ======================= combo em 2D (sem WebGL ou enquanto o three.js não chegou) =======================
  function combo2d(alvos, lado, mx, my, som, aoAcabar) {
    const n = alvos.length, t0 = performance.now(), CARGA = 480, GAP = 460, LIDER = 190, LUZ_MS = 620;
    const quando = (k) => CARGA + k * GAP + LIDER;
    const tFinal = quando(n - 1) + 520;
    S.escuroAlvo = 1;
    S.escuroAte = t0 + tFinal + 1300;
    const fant = alvos.map((a) => {
      if (!a.peca) return null;
      const f = el('i', { class: 'jg-fx-fant', style: `left:${a.x - lado / 2}px;top:${a.y - lado / 2}px;width:${lado}px;height:${lado}px` }, a.peca);
      document.body.append(f);
      return f;
    });
    if (som) zumbido(quando(n - 1) / 1000);
    alvos.forEach((a, k) => {
      arcos(a.x, a.y, lado * 0.6, t0, quando(k), 3);
      raio(novoRaio(a.x + sorte(-1, 1) * Math.min(S.w * 0.25, 170), -30, a.x, a.y, 1), t0 + CARGA + k * GAP, LIDER, LUZ_MS);
      setTimeout(() => {
        if (fant[k]) fant[k].remove();
        impacto(a.x, a.y, lado, a.letra, 1 + k * 0.08);
        if (som) trovao(0.65 + k * 0.1);
        if (navigator.vibrate) navigator.vibrate(35);
      }, quando(k));
    });
    setTimeout(() => {
      const t1 = performance.now(), esc = 1.9 + Math.min(n - 2, 3) * 0.25;
      raio(novoRaio(mx + sorte(-40, 40), -40, mx, my, esc), t1 + 260, 150, 900);
      for (let s = 0; s < 2; s++) raio(novoRaio(mx + sorte(-1, 1) * S.w * 0.4, -40, mx + sorte(-0.4, 0.4) * lado * 4, my + sorte(-0.4, 0.4) * lado * 4, 0.8), t1 + 330 + s * 90, 120, 500);
      setTimeout(() => {
        impacto(mx, my, lado, null, esc);
        S.clarao = 1;
        S.tremor = 26;
        if (som) trovao(1.35);
        if (navigator.vibrate) navigator.vibrate([60, 40, 180]);
        if (aoAcabar) setTimeout(aoAcabar, 2600);
      }, 410);
    }, tFinal);
  }

  /* alvos = [{ x, y, letra, peca }]: o centro de cada pedra comida em px da TELA (getBoundingClientRect), na ordem
     lado = tamanho da casa; tab() = o tabuleiro agora (sacode junto; pode ter sido redesenhado); som = toca o trovão? */
  function combo(alvos, lado, { tab = () => null, som = true, aoAcabar = null } = {}) {
    const n = alvos.length;
    if (n < 2) return;
    if (!window.CanvasRenderingContext2D) { if (aoAcabar) setTimeout(aoAcabar, 0); return; }
    const t = tab(), rt = t && t.getBoundingClientRect();
    const mx = rt ? rt.left + rt.width / 2 : alvos.reduce((s, a) => s + a.x, 0) / n;
    const my = rt ? rt.top + rt.height / 2 : alvos.reduce((s, a) => s + a.y, 0) / n;
    const ir = () => {
      palco();
      S.tab = tab;
      if (window.THREE && palco3d()) combo3d(alvos, lado, mx, my, som, aoAcabar);
      else combo2d(alvos, lado, mx, my, som, aoAcabar);
    };
    if (window.THREE || G.falhou) { ir(); return; }
    // three.js ainda baixando: espera um pouquinho; se não vier, vai de 2D
    let foi = false;
    const uma = () => { if (!foi) { foi = true; ir(); } };
    preparar3d().then(uma, uma);
    setTimeout(uma, 900);
  }

  // ======================= emojis animados (Noto Animated Emoji do Google, licença CC BY 4.0) =======================
  // os desenhos ficam em emojis/<código>.json (Lottie, vetor: fica nítido em qualquer tamanho);
  // o tocador vem do cdnjs só na primeira vez. Sem tocador ou sem desenho, fica o emoji normal.
  const LOTTIE = 'https://cdnjs.cloudflare.com/ajax/libs/lottie-web/5.12.2/lottie_light.min.js';
  const CODIGO = { '😂': '1f602', '🔥': '1f525', '😱': '1f631', '👏': '1f44f', '💀': '1f480', '❤️': '2764_fe0f', '😈': '1f608', '✊': '270a', '😬': '1f62c', '😵': '1f635' };
  const PARADO = { '🔪': '1f52a.svg' }; // a faca não tem versão animada
  // quadro em que o emoji fica parado na barra (o começo do 😱 e do 😈 é uma carinha amarela qualquer)
  const POSE = { '😱': 0.45, '😈': 0.6 };
  const E = { base: 'emojis/', vivos: new Set(), desenhos: new Map(), tocadorP: null, varrendo: false };
  function tocador() {
    if (window.lottie) return Promise.resolve(window.lottie);
    if (!E.tocadorP) {
      E.tocadorP = new Promise((ok, falha) => {
        const s = document.createElement('script');
        s.src = LOTTIE;
        s.async = true;
        s.onload = () => (window.lottie ? ok(window.lottie) : falha(new Error('lottie')));
        s.onerror = () => { E.tocadorP = null; falha(new Error('lottie')); };
        document.head.append(s);
      });
      E.tocadorP.catch(() => {});
    }
    return E.tocadorP;
  }
  function desenhoDe(cod) {
    if (!E.desenhos.has(cod)) {
      const p = fetch(E.base + cod + '.json').then((r) => { if (!r.ok) throw new Error(r.status); return r.text(); });
      p.catch(() => E.desenhos.delete(cod));
      E.desenhos.set(cod, p);
    }
    return E.desenhos.get(cod);
  }
  // animação que saiu da tela é destruída (senão continua rodando escondida)
  function varrer() {
    for (const a of E.vivos) if (!a.wrapper || !a.wrapper.isConnected) { a.destroy(); E.vivos.delete(a); }
    if (E.vivos.size) setTimeout(varrer, 1500);
    else E.varrendo = false;
  }
  // fixo = fica guardado e volta pra tela depois (botões da barra): não entra na varredura
  function animado(emoji, { loop = true, tocar = true, fixo = false, classe = '' } = {}) {
    const n = el('span', { class: ('fx-anim ' + classe).trim(), 'aria-hidden': 'true' });
    if (PARADO[emoji]) { n.append(el('img', { src: E.base + PARADO[emoji], alt: '', draggable: 'false' })); return n; }
    n.textContent = emoji;
    const cod = CODIGO[emoji];
    if (!cod) return n;
    Promise.all([tocador(), desenhoDe(cod)]).then(([L, txt]) => {
      n.textContent = '';
      const a = L.loadAnimation({ container: n, renderer: 'svg', loop, autoplay: tocar, animationData: JSON.parse(txt), rendererSettings: { preserveAspectRatio: 'xMidYMid meet' } });
      n._anim = a;
      if (!tocar) {
        const pose = () => a.goToAndStop(Math.round((a.totalFrames - 1) * (POSE[emoji] || 0)), true);
        pose();
        a.addEventListener('complete', pose); // depois de animar volta pra pose
      }
      if (!fixo) {
        E.vivos.add(a);
        if (!E.varrendo) { E.varrendo = true; setTimeout(varrer, 1500); }
      }
    }).catch(() => {});
    return n;
  }
  // barra de reações viva: um emoji de cada vez faz a animação dele
  function onda(lista) {
    let i = 0;
    setInterval(() => {
      if (!lista.isConnected || document.hidden) return;
      const bs = lista.querySelectorAll('.fx-anim');
      for (let k = 0; k < bs.length; k++) {
        const b = bs[i++ % bs.length];
        if (b._anim) { b._anim.goToAndPlay(0, true); return; }
      }
    }, 1300);
  }
  function tocarBotao(b) {
    const a = b && b.querySelector('.fx-anim');
    if (a && a._anim) a._anim.goToAndPlay(0, true);
  }

  // ======================= reações =======================
  const NOMES = { '😂': 'risada', '🔥': 'fogo', '😱': 'susto', '👏': 'palmas', '💀': 'caveira', '❤️': 'coração', '😈': 'carinha de mal', '🔪': 'faca no pescoço', '✊': 'amassar a dama' };
  // o que voa na tela: todas animadas; as novas ainda têm cena própria (e efeito no canvas)
  // letra = a dama que a mão amassa (a do adversário de quem mandou)
  function figura(emoji, letra, peca) {
    let n;
    if (emoji === '❤️') n = el('span', { class: 'fx fx-cor' }, el('i', {}, animado('❤️')));
    else if (emoji === '😈') n = el('span', { class: 'fx fx-mal' }, el('i', {}, animado('😈')), el('b', { text: 'HEHEHE' }));
    else if (emoji === '🔪') n = el('span', { class: 'fx fx-faca' }, el('i', { class: 'cara a' }, animado('😬')), el('i', { class: 'cara b' }, animado('😵')), el('b', { class: 'corte' }), el('i', { class: 'faca' }, animado('🔪')));
    else if (emoji === '✊') n = el('span', { class: 'fx fx-amassa' }, peca ? peca(letra || 'P') : el('span', { class: 'jg-p p' }), el('i', { class: 'mao' }, animado('✊')));
    else return animado(emoji, { classe: 'grande' });
    requestAnimationFrame(() => reacaoFx(emoji, n, letra || 'P'));
    return n;
  }
  function reacaoFx(emoji, no, letra) {
    if (!no.isConnected || !window.CanvasRenderingContext2D) return;
    palco();
    const em = (ms, fn) => setTimeout(() => {
      if (!no.isConnected) return;
      const r = no.getBoundingClientRect();
      fn(r.left + r.width / 2, r.top, r.width);
    }, ms);
    if (emoji === '❤️') {
      const explode = (x, y, w, qtd, forca) => {
        y += w / 2;
        anel(x, y, '255,110,170', w * 1.6 * forca, 650, undefined, 8);
        por({ camada: 2, t0: performance.now(), dur: 500, d(cx, k) { bola(cx, x, y, w * 1.4 * forca, [[0, `rgba(255,120,180,${0.55 * (1 - k)})`], [1, 'rgba(255,60,140,0)']]); } });
        for (let s = 0; s < qtd; s++) {
          const ang = sorte(0, TAU), v = sorte(70, 190) * forca;
          particula({ tipo: 'texto', txt: um(['❤️', '💖', '💗', '💕', '💘']), x, y, vx: Math.cos(ang) * v, vy: Math.sin(ang) * v - 40, g: 120, arrasto: 0.4, vr: sorte(-2, 2), vida: sorte(0.9, 1.5), tam: sorte(13, 24) });
        }
        brasas(x, y, w / 3, 14, 1.2, ['255,150,200', '255,90,160', '255,220,240']);
      };
      em(130, (x, y, w) => explode(x, y, w, 16, 1));
      em(880, (x, y, w) => explode(x, y, w, 8, 0.7));
      em(1630, (x, y, w) => explode(x, y, w, 10, 0.85));
    } else if (emoji === '😈') {
      em(60, (x, y, w) => {
        S.clarao = Math.max(S.clarao, 0.12); S.claraoCor = '110,30,190';
        anel(x, y + w / 2, '180,110,255', w * 1.5, 600, undefined, 8);
      });
      // chamas roxas subindo atrás da carinha enquanto ela ri
      por({ camada: 2, t0: performance.now(), dur: 2000, d() {
        if (!no.isConnected) return false;
        const r = no.getBoundingClientRect(), x = r.left + r.width / 2, y = r.top + r.height * 0.7;
        for (let i = 0; i < 3; i++) particula({ tipo: 'chama', x: x + sorte(-0.32, 0.32) * r.width, y: y + sorte(-4, 4), vx: sorte(-14, 14), vy: -sorte(50, 130), vida: sorte(0.35, 0.75), tam: sorte(7, 14), cor: um(['170,90,255', '255,70,190', '120,60,255', '210,120,255']) });
      } });
    } else if (emoji === '🔪') {
      // o corte: um risco quente atravessa o pescoço e espirra vermelho
      em(560, (x, y, w) => {
        const yc = y + w * 0.72, x0 = x - w * 1.1, x1 = x + w * 1.1, t0 = performance.now();
        por({ camada: 2, t0, dur: 700, d(cx, k) {
          const p = saida(Math.min(1, k / 0.28)), a = k < 0.3 ? 1 : 1 - (k - 0.3) / 0.7;
          const pts = [[x0, yc - 6], [x0 + (x1 - x0) * p, yc + 6 * p]];
          brilhar(cx, pts, 1, a, [[18, '255,30,30', 0.25], [8, '255,80,80', 0.55], [2.5, '255,245,245', 1]]);
        } });
        setTimeout(() => {
          S.clarao = Math.max(S.clarao, 0.2); S.claraoCor = '255,25,25';
          for (let s = 0; s < 16; s++) particula({ tipo: 'gota', x: x + sorte(-0.4, 0.4) * w, y: yc, vx: sorte(-90, 90), vy: -sorte(30, 160), g: 520, vida: sorte(0.6, 1.1), tam: sorte(2, 4.2), cor: um(['220,20,30', '190,0,20', '255,60,60']) });
          faiscas(x, yc, 10, 10, 1, ['255,230,230', '255,120,120']);
        }, 200);
      });
    } else if (emoji === '✊') {
      // dois socos: o segundo racha a mesa e a dama vira caco
      const soco = (x, y, w, forte) => {
        const yb = y + w * 0.82, lado = w * 0.75;
        anel(x, yb, '255,225,170', lado * (forte ? 2.6 : 1.6), 550, undefined, forte ? 9 : 6);
        fumaca(x, yb, lado * 0.6, forte ? 7 : 4, performance.now(), '120,100,80');
        cacos(x, yb, lado * 0.6, letra, forte ? 14 : 5, forte ? 1 : 0.6);
        faiscas(x, yb, lado * 0.5, forte ? 14 : 6);
        if (forte) { cratera(x, yb, lado, 1600); brasas(x, yb, lado * 0.5, 16); S.tremor = Math.max(S.tremor, 6); S.clarao = Math.max(S.clarao, 0.1); S.claraoCor = '255,200,140'; }
        else S.tremor = Math.max(S.tremor, 3);
      };
      em(510, (x, y, w) => soco(x, y, w, false));
      em(1060, (x, y, w) => soco(x, y, w, true));
    }
  }

  // jogos.js: botão da barra = FX.animado(e, { tocar: false, loop: false, fixo: true }); FX.onda(lista) dá vida à barra
  window.DamasFx = { NOMES, figura, combo, trovao, preparar3d, animado, onda, tocarBotao, tocador, set base(b) { E.base = b; } };
})();
