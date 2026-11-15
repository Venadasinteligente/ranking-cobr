/* Robô da damas: acha o melhor lance de uma posição e dá nota a cada lance de uma partida
   (a "análise" do replay: brilhante, erro grave, precisão de cada jogador).
   Mesmas regras do damas-regras.js (os testes conferem que os dois geram exatamente os mesmos
   lances), mas com o tabuleiro em números pra ficar rápido.
   Roda de 3 jeitos: no navegador (window.DamasRobo), como Web Worker (new Worker('damas-robo.js'):
   responde os pedidos de análise sem travar a tela) e no Node (require, pros testes).
   O esforço é contado em posições olhadas (não em tempo): todo aparelho chega na mesma nota. */
(function (raiz, fabrica) {
  const Robo = fabrica();
  if (typeof module === 'object' && module.exports) module.exports = Robo;
  else raiz.DamasRobo = Robo;
  // dentro de um Worker: { id, lances, maioria, nos, indices } -> { id, k, r } por posição e { id, fim }
  if (typeof WorkerGlobalScope !== 'undefined' && raiz instanceof WorkerGlobalScope) {
    raiz.onmessage = (e) => {
      const q = e.data || {};
      try {
        Robo.analisarPartida(q.lances, { maioria: q.maioria, nos: q.nos, indices: q.indices }, (k, r) => raiz.postMessage({ id: q.id, k, r }));
        raiz.postMessage({ id: q.id, fim: true });
      } catch (err) {
        raiz.postMessage({ id: q.id, erro: String((err && err.message) || err) });
      }
    };
  }
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  // ---------- tabuleiro em números ----------
  // casa i: linha i>>2 (0 = em cima, lado das pretas); mesma numeração do damas-regras.js
  // peça: 0 vazia, 1 pedra branca, 2 dama branca, -1 pedra preta, -2 dama preta. cor: 1 brancas, -1 pretas
  const LETRA = { '.': 0, b: 1, B: 2, p: -1, P: -2 };
  const DE_NUM = { 0: '.', 1: 'b', 2: 'B', '-1': 'p', '-2': 'P' };
  const LIN = new Int8Array(32), COL = new Int8Array(32);
  const casa = (l, c) => (l < 0 || l > 7 || c < 0 || c > 7 || (l + c) % 2 === 0 ? -1 : l * 4 + (c >> 1));
  const DIRS = [[-1, -1], [-1, 1], [1, -1], [1, 1]];
  const RAIO = []; // RAIO[i * 4 + d] = casas na direção d, da mais perto pra mais longe
  for (let i = 0; i < 32; i++) {
    LIN[i] = i >> 2;
    COL[i] = (i % 4) * 2 + (LIN[i] % 2 === 0 ? 1 : 0);
  }
  for (let i = 0; i < 32; i++) {
    for (const [dl, dc] of DIRS) {
      const r = [];
      for (let l = LIN[i] + dl, c = COL[i] + dc; casa(l, c) >= 0; l += dl, c += dc) r.push(casa(l, c));
      RAIO.push(Int8Array.from(r));
    }
  }
  const DIAGONAL = new Uint8Array(32); // a grande diagonal (a1-h8): quem segura ela com a dama empata muito final
  for (let i = 0; i < 32; i++) DIAGONAL[i] = LIN[i] + COL[i] === 7 ? 1 : 0;

  function deTexto(tab) {
    const t = new Int8Array(32);
    for (let i = 0; i < 32; i++) t[i] = LETRA[tab[i]] || 0;
    return t;
  }
  function paraTexto(t) {
    let s = '';
    for (let i = 0; i < 32; i++) s += DE_NUM[t[i]];
    return s;
  }

  // ---------- lances (as mesmas regras do damas-regras.js) ----------
  // captura: as comidas ficam no tabuleiro até o fim do lance (não dá pra pular de novo nem pousar nelas)
  const pilhaCam = new Int8Array(48), pilhaCap = new Int8Array(24), marcada = new Uint8Array(32);
  function passo(t, pos, nc, nk, cor, dama, saida) {
    let continuou = false;
    for (let d = 0; d < 4; d++) {
      const r = RAIO[pos * 4 + d], L = r.length;
      let k = 0;
      if (dama) while (k < L && t[r[k]] === 0) k++;
      if (k >= L) continue;
      const alvo = r[k], v = t[alvo];
      if (v === 0 || (v > 0) === (cor > 0) || marcada[alvo]) continue;
      for (let j = k + 1; j < L && t[r[j]] === 0; j++) {
        continuou = true;
        marcada[alvo] = 1;
        pilhaCap[nk] = alvo;
        pilhaCam[nc] = r[j];
        passo(t, r[j], nc + 1, nk + 1, cor, dama, saida);
        marcada[alvo] = 0;
        if (!dama) break;
      }
    }
    if (!continuou && nk) {
      const para = pilhaCam[nc - 1];
      saida.push({ caminho: Array.from(pilhaCam.subarray(0, nc)), capturas: Array.from(pilhaCap.subarray(0, nk)), viraDama: !dama && LIN[para] === (cor > 0 ? 0 : 7) });
    }
  }
  const SEM = [];
  function gerar(t, cor, maioria = true) {
    const caps = [];
    for (let i = 0; i < 32; i++) {
      const v = t[i];
      if (v === 0 || (v > 0) !== (cor > 0)) continue;
      t[i] = 0;
      pilhaCam[0] = i;
      passo(t, i, 1, 0, cor, v === 2 || v === -2, caps);
      t[i] = v;
    }
    if (caps.length) {
      if (!maioria) return caps;
      let max = 0;
      for (const m of caps) if (m.capturas.length > max) max = m.capturas.length;
      return caps.filter((m) => m.capturas.length === max);
    }
    const simples = [];
    const fim = cor > 0 ? 0 : 7;
    for (let i = 0; i < 32; i++) {
      const v = t[i];
      if (v === 0 || (v > 0) !== (cor > 0)) continue;
      if (v === 1 || v === -1) {
        for (let d = cor > 0 ? 0 : 2, ate = d + 2; d < ate; d++) { // pedra só anda pra frente
          const r = RAIO[i * 4 + d];
          if (r.length && t[r[0]] === 0) simples.push({ caminho: [i, r[0]], capturas: SEM, viraDama: LIN[r[0]] === fim });
        }
      } else {
        for (let d = 0; d < 4; d++) {
          const r = RAIO[i * 4 + d];
          for (let k = 0; k < r.length && t[r[k]] === 0; k++) simples.push({ caminho: [i, r[k]], capturas: SEM, viraDama: false });
        }
      }
    }
    return simples;
  }
  // faz e desfaz o lance no mesmo tabuleiro (o desfazer usa o que o fazer guardou no lance)
  function fazer(t, m) {
    const de = m.caminho[0], para = m.caminho[m.caminho.length - 1], pc = t[de];
    m.pc = pc;
    m.tiradas = m.capturas.length ? m.capturas.map((c) => t[c]) : SEM;
    t[de] = 0;
    for (const c of m.capturas) t[c] = 0;
    t[para] = m.viraDama ? pc * 2 : pc;
  }
  function desfazer(t, m) {
    t[m.caminho[m.caminho.length - 1]] = 0;
    for (let k = 0; k < m.capturas.length; k++) t[m.capturas[k]] = m.tiradas[k];
    t[m.caminho[0]] = m.pc;
  }
  const mesmo = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

  // ---------- avaliação: quanto a posição vale pra quem joga (100 = uma pedra) ----------
  const PEDRA = 100, DAMA = 300;
  const AVANCO = [0, 1, 3, 5, 8, 12, 18, 0]; // pedra mais perto de virar dama vale mais
  const MATE = 100000;
  function avaliar(t, cor) {
    let s = 0, pb = 0, pp = 0, db = 0, dp = 0, dpDiag = 0, dbDiag = 0;
    for (let i = 0; i < 32; i++) {
      const v = t[i];
      if (v === 0) continue;
      const l = LIN[i], c = COL[i], meio = l >= 3 && l <= 4 && c >= 2 && c <= 5 ? 4 : 0;
      if (v === 1) { pb++; s += PEDRA + AVANCO[7 - l] + meio; }
      else if (v === -1) { pp++; s -= PEDRA + AVANCO[l] + meio; }
      else if (v === 2) { db++; s += DAMA + (DIAGONAL[i] ? 10 : 0); dbDiag += DIAGONAL[i]; }
      else { dp++; s -= DAMA + (DIAGONAL[i] ? 10 : 0); dpDiag += DIAGONAL[i]; }
    }
    // a última fileira guardada atrapalha o outro de fazer dama (enquanto ele não tem dama)
    if (!dp) for (let i = 28; i < 32; i++) if (t[i] === 1) s += 4;
    if (!db) for (let i = 0; i < 4; i++) if (t[i] === -1) s -= 4;
    // só damas no tabuleiro: 1×1 e 2×1 empatam; 3×1 empata se a dama sozinha segura a grande diagonal
    if (!pb && !pp && db && dp) {
      const empata = (db <= 2 && dp <= 2) || (dp === 1 && db <= 3 && dpDiag) || (db === 1 && dp <= 3 && dbDiag);
      if (empata) s = Math.round(s * 0.1);
    }
    return cor > 0 ? s : -s;
  }
  function material(t, cor) {
    let s = 0;
    for (let i = 0; i < 32; i++) {
      const v = t[i];
      if (v) s += (v === 1 || v === -1 ? PEDRA : DAMA) * (v > 0 ? 1 : -1);
    }
    return cor > 0 ? s : -s;
  }

  // ---------- busca (negamax com poda alfa-beta, tabela de posições e lance forçado estendido) ----------
  // sorteio fixo: a mesma posição dá sempre a mesma chave
  let semente = 0x2545f491;
  const sorteio = () => { semente = (semente + 0x6d2b79f5) | 0; let z = semente; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return (z ^ (z >>> 14)) | 0; };
  const Z1 = new Int32Array(32 * 5), Z2 = new Int32Array(32 * 5);
  for (let i = 0; i < Z1.length; i++) { Z1[i] = sorteio(); Z2[i] = sorteio(); }
  const VEZ1 = sorteio(), VEZ2 = sorteio();
  const EXATO = 0, PISO = 1, TETO = 2;
  const PARAR = { parar: true };
  const S = { tt: new Map(), nos: 0, limite: Infinity, podeParar: false, maioria: true };
  const MAX_PLY = 64;

  function busca(t, cor, prof, alfa, beta, ply) {
    if ((++S.nos & 1023) === 0 && S.podeParar && S.nos > S.limite) throw PARAR;
    const lances = gerar(t, cor, S.maioria);
    if (!lances.length) return -(MATE - ply); // sem peça ou travado: perdeu
    const captura = lances[0].capturas.length > 0;
    if (ply >= MAX_PLY || (prof <= 0 && !captura)) return avaliar(t, cor); // captura é obrigatória: continua até acalmar
    if (lances.length === 1 && prof > 0 && ply < 40) prof++; // lance forçado não gasta profundidade

    let h1 = cor > 0 ? VEZ1 : 0, h2 = cor > 0 ? VEZ2 : 0;
    for (let i = 0; i < 32; i++) if (t[i]) { h1 ^= Z1[i * 5 + t[i] + 2]; h2 ^= Z2[i * 5 + t[i] + 2]; }
    const e = S.tt.get(h1);
    let primeiro = -1;
    if (e && e.h2 === h2) {
      primeiro = e.m;
      if (e.p >= prof) {
        const s = e.s > MATE - 1000 ? e.s - ply : e.s < -MATE + 1000 ? e.s + ply : e.s;
        if (e.f === EXATO) return s;
        if (e.f === PISO && s >= beta) return s;
        if (e.f === TETO && s <= alfa) return s;
      }
    }
    // ordem: o melhor da última vez, depois o que vira dama, depois o resto
    const ordem = lances.map((_, k) => k);
    ordem.sort((a, b) => (b === primeiro) - (a === primeiro) || lances[b].viraDama - lances[a].viraDama);
    const alfa0 = alfa;
    let melhor = -Infinity, mk = ordem[0];
    for (const k of ordem) {
      const m = lances[k];
      fazer(t, m);
      const s = -busca(t, -cor, prof - 1, -beta, -alfa, ply + 1);
      desfazer(t, m);
      if (s > melhor) { melhor = s; mk = k; }
      if (s > alfa) alfa = s;
      if (alfa >= beta) break;
    }
    if (S.tt.size > 400000) S.tt.clear();
    const guarda = melhor > MATE - 1000 ? melhor + ply : melhor < -MATE + 1000 ? melhor - ply : melhor;
    S.tt.set(h1, { h2, p: prof, s: guarda, f: melhor <= alfa0 ? TETO : melhor >= beta ? PISO : EXATO, m: mk });
    return melhor;
  }

  /* nota de cada lance possível da posição (do ponto de vista de quem joga), aprofundando até
     gastar o limite de posições olhadas. Devolve { lances, notas, prof } da última profundidade completa. */
  function pensar(t, cor, { maioria = true, nos = 60000, profMax = 30 } = {}) {
    S.maioria = maioria;
    S.tt.clear();
    S.nos = 0;
    S.limite = nos;
    const lances = gerar(t, cor, maioria);
    if (!lances.length) return { lances, notas: [], prof: 0 };
    let notas = null, prof = 0;
    for (let d = 1; d <= profMax; d++) {
      S.podeParar = d > 1; // a primeira profundidade sempre termina
      const tt = Int8Array.from(t); // se parar no meio, o tabuleiro de trabalho fica pra trás
      const ordem = lances.map((_, k) => k);
      if (notas) ordem.sort((a, b) => notas[b] - notas[a]);
      const nv = new Array(lances.length);
      try {
        for (const k of ordem) {
          fazer(tt, lances[k]);
          nv[k] = -busca(tt, -cor, d - 1, -Infinity, Infinity, 1);
          desfazer(tt, lances[k]);
        }
      } catch (e) {
        if (e !== PARAR) throw e;
        break;
      }
      notas = nv;
      prof = d;
      if (S.nos > S.limite * 0.45) break; // a próxima profundidade não ia caber
      if (lances.length === 1 && d >= 4) break;
      if (notas.every((s) => Math.abs(s) > MATE - 1000)) break; // já viu o fim de tudo
    }
    return { lances, notas, prof };
  }

  // ---------- a partida inteira ----------
  // lances do banco: { caminho, capturas, virou_dama }; caminho vazio = perdeu a vez (tempo)
  // inicio = { tab, vez } pra começar de outra posição (os testes usam)
  function posicoes(lances, inicio = null) {
    let t = deTexto(inicio ? inicio.tab : 'pppppppppppp........bbbbbbbbbbbb'), cor = inicio && inicio.vez === 'p' ? -1 : 1;
    const lista = [{ t, cor }];
    for (const l of lances) {
      t = Int8Array.from(t);
      const c = l.caminho || [];
      if (c.length >= 2) {
        const pc = t[c[0]];
        t[c[0]] = 0;
        for (const x of l.capturas || []) t[x] = 0;
        t[c[c.length - 1]] = l.virou_dama || l.viraDama ? pc * 2 : pc;
      }
      cor = -cor;
      lista.push({ t, cor });
    }
    return lista;
  }
  // primeiro lance que as regras (com ou sem lei da maioria) não reconhecem; -1 = todos certos
  function conferir(lances, maioria = true, inicio = null) {
    const ps = posicoes(lances, inicio);
    for (let k = 0; k < lances.length; k++) {
      const c = lances[k].caminho || [];
      if (c.length < 2) continue;
      if (!gerar(ps[k].t, ps[k].cor, maioria).some((m) => mesmo(m.caminho, c))) return k;
    }
    return -1;
  }
  const valorDe = (v) => (v === 1 || v === -1 ? 1 : v ? 3 : 0);

  /* analisa as posições pedidas (índice k = antes do lance k+1; k = lances.length é a posição final)
     e chama cada(k, r) com r = { e: nota da posição pras brancas, n: quantos lances tinha,
     j: qual foi jogado, m: nota do melhor, s: nota do jogado, s2: a do 2º melhor (as 3 pra quem jogou),
     b: caminho do melhor, bx: quantas o melhor come, mat: material antes, sac: o jogado entregou peça, prof } */
  function analisarPartida(lances, { maioria = true, nos = 60000, indices = null, inicio = null } = {}, cada = () => {}) {
    const ps = posicoes(lances, inicio);
    const ks = indices || ps.map((_, k) => k);
    const saida = {};
    for (const k of ks) {
      const { t, cor } = ps[k];
      const l = lances[k];
      const r = {};
      const pz = pensar(Int8Array.from(t), cor, { maioria, nos });
      if (!pz.lances.length) {
        r.e = cor > 0 ? -MATE : MATE;
        r.n = 0;
      } else {
        let mi = 0;
        for (let i = 1; i < pz.notas.length; i++) if (pz.notas[i] > pz.notas[mi]) mi = i;
        const melhor = pz.notas[mi];
        r.e = cor > 0 ? melhor : -melhor;
        r.n = pz.lances.length;
        r.m = melhor;
        r.b = pz.lances[mi].caminho;
        r.bx = pz.lances[mi].capturas.length;
        r.prof = pz.prof;
        const seg = pz.notas.filter((_, i) => i !== mi);
        r.s2 = seg.length ? Math.max(...seg) : null;
        if (l && l.caminho && l.caminho.length >= 2) {
          r.j = pz.lances.findIndex((m) => mesmo(m.caminho, l.caminho));
          if (r.j >= 0) {
            r.s = pz.notas[r.j];
            // entregou peça? o outro é obrigado a comer mais do que esse lance comeu
            const m = pz.lances[r.j], tt = Int8Array.from(t);
            let comi = 0;
            for (const c of m.capturas) comi += valorDe(tt[c]);
            fazer(tt, m);
            let come = 0;
            for (const o of gerar(tt, -cor, maioria)) {
              let v = 0;
              for (const c of o.capturas) v += valorDe(tt[c]);
              if (v > come) come = v;
            }
            r.sac = come > comi;
            r.mat = material(t, cor);
          }
        }
      }
      saida[k] = r;
      cada(k, r);
    }
    return saida;
  }

  // ---------- nota de cada lance ----------
  // chance de vencer (0..1) pra uma nota (100 = uma pedra a mais ≈ 71%)
  const chance = (s) => (s >= MATE - 1000 ? 1 : s <= -MATE + 1000 ? 0 : 1 / (1 + Math.exp(-s / 110)));
  // precisão de um lance (fórmula do lichess) a partir de quanto % de chance ele jogou fora
  const precisaoDe = (perda) => Math.max(0, Math.min(100, 103.1668 * Math.exp(-0.04354 * perda) - 3.1669));
  const TIPOS = ['brilhante', 'unico', 'melhor', 'excelente', 'bom', 'imprecisao', 'erro', 'grave', 'forcado', 'tempo'];
  /* r = resultado da posição antes do lance. Devolve { tipo, perda } ou null (lance que o robô não reconhece).
     brilhante = entregou peça de propósito, era o melhor e ganha material de volta;
     unico = só esse lance segurava (o 2º melhor perdia muito) */
  function classificar(r, lance) {
    const c = lance && lance.caminho;
    if (!c || c.length < 2) return { tipo: 'tempo', perda: 0 };
    if (!r || r.j == null || r.j < 0 || r.m == null) return null;
    if (r.n === 1) return { tipo: 'forcado', perda: 0 };
    const cm = chance(r.m), cs = chance(r.s);
    const perda = Math.max(0, (cm - cs) * 100);
    const igual = r.s >= r.m;
    const gap2 = r.s2 == null ? 0 : (cm - chance(r.s2)) * 100;
    // (com a partida já ganha de vários jeitos, entregar peça não é brilhante: tem que ser claramente o melhor)
    if ((igual || perda <= 1) && r.sac && cs >= 0.5 && chance(r.mat) <= 0.93 && r.s - r.mat >= 80 && (r.s2 == null || gap2 >= 3)) return { tipo: 'brilhante', perda };
    if ((igual || perda <= 1) && gap2 >= 15 && cs >= 0.3 && cm < 0.98) return { tipo: 'unico', perda };
    if (igual || perda <= 0.6) return { tipo: 'melhor', perda };
    if (perda <= 2.5) return { tipo: 'excelente', perda };
    if (perda <= 6) return { tipo: 'bom', perda };
    if (perda <= 12) return { tipo: 'imprecisao', perda };
    if (perda <= 22) return { tipo: 'erro', perda };
    return { tipo: 'grave', perda };
  }
  // precisão média de quem joga com a cor (1 brancas, -1 pretas); notas[k] = classificar do lance k+1
  function precisao(notas, cor) {
    let soma = 0, n = 0;
    notas.forEach((x, k) => {
      if (!x || x.tipo === 'forcado' || x.tipo === 'tempo') return;
      if ((k % 2 === 0 ? 1 : -1) !== cor) return; // lance k+1: ímpar = brancas
      soma += precisaoDe(x.perda);
      n++;
    });
    return n ? soma / n : null;
  }

  return { gerar, fazer, desfazer, avaliar, pensar, posicoes, conferir, analisarPartida, classificar, precisao, chance, precisaoDe, deTexto, paraTexto, TIPOS, MATE };
});
