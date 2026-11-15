/* Replay da damas: a partida volta lance por lance. Tem a linha do tempo (que também é o gráfico de
   quem estava ganhando), a lista de lances, os melhores momentos (com o raio 3D nos combos) e a
   análise do robô (damas-robo.js, rodando em Workers): nota de cada lance, precisão de cada jogador,
   barra de vantagem e o melhor lance desenhado no tabuleiro.
   Não sabe nada do banco: o jogos.js passa a partida, os lances e como desenhar as coisas do site
   (nick, avatar, pedra com a skin, som). DamasReplay.abrir(opções) devolve { raiz, montado, destruir, ir }. */
(() => {
  'use strict';
  const R = window.DamasRegras, Robo = window.DamasRobo;
  const FX = () => window.DamasFx;
  // o Worker do robô sai da mesma pasta deste arquivo
  const BASE = (() => { try { return document.currentScript.src.replace(/[^/]*$/, ''); } catch (e) { return ''; } })();
  const NOS = 60000;      // esforço do robô por posição (em posições olhadas: dá a mesma nota em todo aparelho)
  const PASSO = 420;      // ms de cada pulo da peça (igual à partida ao vivo)
  const VERSAO_CACHE = 1;

  function el(tag, props, ...filhos) {
    const n = document.createElement(tag);
    if (props) for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === 'class') n.className = v;
      else if (k === 'text') n.textContent = v;
      else if (k === 'style') n.setAttribute('style', v);
      else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
      else n.setAttribute(k, v === true ? '' : v);
    }
    for (const f of filhos.flat()) if (f != null && f !== false) n.append(f.nodeType ? f : document.createTextNode(String(f)));
    return n;
  }
  function ico(d, t = 20, extra = '') {
    const w = document.createElement('span');
    w.innerHTML = `<svg aria-hidden="true" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${d}</svg>`;
    return w.firstChild;
  }
  const IC = {
    voltar: '<path d="M15 5l-7 7 7 7"/>',
    replay: '<path d="M3 12a9 9 0 1 0 3-6.7L3 8"/><path d="M3 3v5h5"/><path d="M10 9l5 3-5 3z" fill="currentColor"/>',
    inicio: '<path d="M6 5v14"/><path d="M18 6l-8.5 6 8.5 6z" fill="currentColor"/>',
    ant: '<path d="M15 5l-7 7 7 7"/>',
    prox: '<path d="M9 5l7 7-7 7"/>',
    fim: '<path d="M18 5v14"/><path d="M6 6l8.5 6L6 18z" fill="currentColor"/>',
    play: '<path d="M8 5v14l11-7z" fill="currentColor"/>',
    pausa: '<path d="M8 5v14M16 5v14" stroke-width="3.4"/>',
    girar: '<path d="M4 12a8 8 0 0 1 14.3-4.9L20 9"/><path d="M20 4v5h-5"/><path d="M20 12a8 8 0 0 1-14.3 4.9L4 15"/><path d="M4 20v-5h5"/>',
    compartilhar: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="M8.4 10.7l7.2-4.2M8.4 13.3l7.2 4.2"/>',
    estrela: '<path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z" fill="currentColor"/>',
    som: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>',
    mudo: '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>',
    robo: '<rect x="4" y="8" width="16" height="11" rx="3"/><path d="M12 4.5V8M9 13v.5M15 13v.5M9.5 16.5h5"/><circle cx="12" cy="3.6" r="1.1"/>',
    raio: '<path d="M13 2L4 14h7l-1 8 9-12h-7z" fill="currentColor" stroke-width="1.2"/>',
    coroa: '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z" fill="currentColor" stroke-width="1.2"/>',
  };

  // nota de cada lance (símbolos do jeito que o povo do xadrez online já conhece)
  const TIPO = {
    brilhante: { s: '!!', nome: 'Brilhante', plural: 'Brilhantes', frase: 'Entregou peça de propósito e era o melhor lance.' },
    unico: { s: '!', nome: 'Lance único', plural: 'Lances únicos', frase: 'Só esse lance segurava a partida.' },
    melhor: { s: '★', nome: 'Melhor lance', plural: 'Melhores', frase: 'O mesmo lance que o robô jogaria.' },
    excelente: { s: '✓', nome: 'Excelente', plural: 'Excelentes', frase: 'Quase tão bom quanto o melhor.' },
    bom: { s: '✓', nome: 'Bom', plural: 'Bons', frase: 'Lance bom, mas tinha melhor.' },
    imprecisao: { s: '?!', nome: 'Imprecisão', plural: 'Imprecisões', frase: 'Deixou escapar um pouco da vantagem.' },
    erro: { s: '?', nome: 'Erro', plural: 'Erros', frase: 'Piorou bastante a posição.' },
    grave: { s: '??', nome: 'Erro grave', plural: 'Erros graves', frase: 'Entregou muita vantagem de uma vez.' },
    forcado: { s: '→', nome: 'Forçado', plural: 'Forçados', frase: 'Era o único lance possível.' },
    tempo: { s: '⏱', nome: 'Tempo esgotado', plural: 'Tempos esgotados', frase: 'O tempo acabou e a vez passou.' },
  };
  const ORDEM_TABELA = ['brilhante', 'unico', 'melhor', 'excelente', 'bom', 'imprecisao', 'erro', 'grave'];
  const DESTAQUE = new Set(['brilhante', 'unico', 'erro', 'grave']); // vira bolinha no gráfico
  const VELOCIDADES = [1, 2, 4, 0.5];

  const nota = (l) => (!l.caminho || l.caminho.length < 2 ? 'passou a vez' : l.caminho.map(R.nomeCasa).join(l.capturas && l.capturas.length ? '×' : '-'));
  const virgula = (x, c = 1) => x.toFixed(c).replace('.', ',');
  const contar = (tab, cor) => [...tab].filter((x) => x.toLowerCase() === cor).length;
  const materialDe = (tab) => [...tab].reduce((s, x) => s + (x === 'b' ? 1 : x === 'B' ? 3 : x === 'p' ? -1 : x === 'P' ? -3 : 0), 0);
  function selo(tipo, extra = '') {
    const t = TIPO[tipo];
    return t ? el('i', { class: `jg-rp-selo t-${tipo} ${extra}`.trim(), 'aria-hidden': 'true', text: t.s }) : null;
  }
  function lerPref(k, padrao) { try { const v = localStorage.getItem('cobr-replay-' + k); return v == null ? padrao : v === '1'; } catch (e) { return padrao; } }
  function salvarPref(k, v) { try { localStorage.setItem('cobr-replay-' + k, v ? '1' : '0'); } catch (e) {} }
  // a análise fica guardada no aparelho (as 30 últimas partidas): abrir de novo é na hora
  function lerCache(id, n) {
    try {
      const x = JSON.parse(localStorage.getItem('cobr-analise:' + id) || 'null');
      return x && x.v === VERSAO_CACHE && x.n === n && x.nos === NOS ? x : null;
    } catch (e) { return null; }
  }
  function salvarCache(id, dados) {
    try {
      const lista = JSON.parse(localStorage.getItem('cobr-analises') || '[]').filter((x) => x !== id);
      lista.push(id);
      while (lista.length > 30) localStorage.removeItem('cobr-analise:' + lista.shift());
      localStorage.setItem('cobr-analise:' + id, JSON.stringify(dados));
      localStorage.setItem('cobr-analises', JSON.stringify(lista));
    } catch (e) {}
  }

  /* o = { partida, lances, nick(id), avatar(id), peca(letra), girar, maioria, inicio, mudo(), trocarMudo(),
           tocar(notas), botaoTela(), voltar(), voltarTxt, compartilhar(k), aoMudar(k), resultado: { titulo, motivo } } */
  function abrir(o) {
    const p = o.partida;
    const L = o.lances.slice().sort((a, b) => a.n - b.n).map((l) => ({ caminho: l.caminho || [], capturas: l.capturas || [], virou_dama: !!l.virou_dama }));
    const N = L.length;
    const pos = Robo.posicoes(L).map((x) => ({ tab: Robo.paraTexto(x.t), vez: x.cor > 0 ? 'b' : 'p' }));
    const mat = pos.map((x) => materialDe(x.tab));
    const idDe = (cor) => (cor === 'b' ? p.brancas : p.pretas);
    const nickCor = (cor) => o.nick(idDe(cor));
    const corDoLance = (n) => pos[n - 1].vez; // lance n sai da posição n-1
    const vencCor = p.vencedor ? (p.vencedor === p.brancas ? 'b' : 'p') : null;
    const S = { k: -1, girar: !!o.girar, vel: 1, tocando: false, play: 0, tk: 0, mom: null, verMelhor: lerPref('melhor', true), aba: 'lances', vivo: true, anims: [], fantasmas: [], timers: [] };
    const A = { estado: 'nada', r: {}, notas: new Array(N).fill(null), feito: 0, prec: null, workers: [], id: Math.random().toString(36).slice(2), msg: '' };
    const pend = new Set();
    function aguardar(fn) { return new Promise((res) => { const f = () => { pend.delete(f); res(); }; pend.add(f); fn(f); }); }
    const espera = (ms) => aguardar((f) => { S.timers.push(setTimeout(f, ms)); });
    const depois = (ms, fn) => { S.timers.push(setTimeout(fn, ms)); };
    const som = (notas) => { if (!o.mudo || !o.mudo()) o.tocar && o.tocar(notas); };

    // ---------------- peças da tela ----------------
    const contador = el('span', { class: 'jg-rp-cont' });
    const btSom = el('button', { type: 'button', class: 'jg-ico', onclick: () => { if (o.trocarMudo) o.trocarMudo(); iconeSom(); } });
    function iconeSom() {
      const m = !!(o.mudo && o.mudo());
      btSom.replaceChildren(ico(m ? IC.mudo : IC.som));
      btSom.setAttribute('aria-label', m ? 'Ligar o som' : 'Desligar o som');
      btSom.setAttribute('aria-pressed', m ? 'true' : 'false');
    }
    iconeSom();
    const topo = el('div', { class: 'jg-topo-partida jg-rp-topo' },
      el('button', { type: 'button', class: 'btn btn-sec', onclick: () => o.voltar && o.voltar() }, ico(IC.voltar, 16), o.voltarTxt || 'Voltar'),
      el('span', { class: 'jg-rp-chip' }, ico(IC.replay, 15), el('span', { class: 'jg-rp-chip-t', text: 'REPLAY' }), contador),
      el('button', { type: 'button', class: 'jg-ico', 'aria-label': 'Virar o tabuleiro', title: 'Virar o tabuleiro', onclick: girar }, ico(IC.girar, 18)),
      o.compartilhar ? el('button', { type: 'button', class: 'jg-ico', 'aria-label': 'Compartilhar este lance', title: 'Compartilhar este lance', onclick: () => o.compartilhar(S.k) }, ico(IC.compartilhar, 18)) : null,
      o.botaoTela ? o.botaoTela() : null,
      btSom);

    function barra(cor) {
      const sub = el('small'), prec = el('span', { class: 'jg-rp-pchip', hidden: true });
      const box = el('div', { class: 'jg-jog jg-rp-jog' }, o.avatar(idDe(cor)), el('div', { class: 'jg-jog-txt' }, el('b', { text: nickCor(cor) }), sub), prec);
      box._sub = sub;
      box._prec = prec;
      return box;
    }
    const barras = { b: barra('b'), p: barra('p') };
    const cimaBox = el('div', { class: 'jg-rp-lado cima' }), baixoBox = el('div', { class: 'jg-rp-lado baixo' });

    // tabuleiro: montado uma vez; a cada lance só as pedras que mudaram trocam
    const tab = el('div', { class: 'jg-tab jg-rp-tab' + (o.tema ? ' ' + o.tema : '') });
    const celulas = new Array(32);
    const setas = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    setas.setAttribute('class', 'jg-caminho jg-rp-setas');
    setas.setAttribute('viewBox', '0 0 8 8');
    setas.setAttribute('aria-hidden', 'true');
    function montarTab() {
      tab.replaceChildren();
      for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
        const lin = S.girar ? 7 - r : r, col = S.girar ? 7 - c : c;
        const i = R.casa(lin, col);
        const cel = el('div', { class: 'jg-c ' + (i < 0 ? 'cl' : 'es'), 'data-casa': i < 0 ? null : String(i) });
        if (c === 0) cel.append(el('span', { class: 'crd n', text: String(8 - lin) }));
        if (r === 7) cel.append(el('span', { class: 'crd l', text: 'abcdefgh'[col] }));
        if (i >= 0) { celulas[i] = cel; cel._letra = '.'; }
        tab.append(cel);
      }
      tab.append(setas);
    }
    function porPecas(t) {
      for (let i = 0; i < 32; i++) {
        const cel = celulas[i];
        if (cel._letra === t[i]) continue;
        cel.querySelectorAll('.jg-p').forEach((x) => x.remove());
        if (t[i] !== '.') cel.append(o.peca(t[i]));
        cel._letra = t[i];
      }
    }
    const avalFill = el('i'), avalNum = el('b');
    const aval = el('div', { class: 'jg-rp-aval', role: 'img' }, avalFill, avalNum);
    const tabBox = el('div', { class: 'jg-rp-tabbox' }, aval, tab);
    const leg = el('div', { class: 'jg-rp-leg', 'aria-live': 'polite' });

    // linha do tempo = gráfico de quem estava ganhando (as brancas do lado claro)
    const graf = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
    graf.setAttribute('class', 'jg-rp-graf');
    graf.setAttribute('viewBox', '0 0 1000 100');
    graf.setAttribute('preserveAspectRatio', 'none');
    graf.setAttribute('aria-hidden', 'true');
    graf.innerHTML = '<path class="area"/><line class="meio" x1="0" y1="50" x2="1000" y2="50" vector-effect="non-scaling-stroke"/><path class="curva" fill="none" vector-effect="non-scaling-stroke"/>';
    const gArea = graf.querySelector('.area'), gCurva = graf.querySelector('.curva');
    const marcas = el('div', { class: 'jg-rp-marcas', 'aria-hidden': 'true' });
    const cabecaPt = el('i');
    const cabeca = el('div', { class: 'jg-rp-cabeca', 'aria-hidden': 'true' }, cabecaPt);
    const linha = el('div', { class: 'jg-rp-linha', role: 'slider', tabindex: '0', 'aria-label': 'Linha do tempo da partida', 'aria-valuemin': '0', 'aria-valuemax': String(N) }, graf, marcas, cabeca);

    const btPlay = el('button', { type: 'button', class: 'jg-rp-play', onclick: () => (S.tocando ? pausar() : tocar()) });
    const btVel = el('button', { type: 'button', class: 'jg-rp-vel', 'aria-label': 'Velocidade', onclick: trocarVel });
    const momTxt = el('span', { class: 'jg-rp-mom-t', text: 'Momentos' }), momConta = el('span', { class: 'jg-rp-mom-n' });
    const btMom = el('button', { type: 'button', class: 'jg-rp-mom', title: 'Melhores momentos', onclick: () => (S.mom ? pausar() : momentos()) }, ico(IC.estrela, 16), momTxt, momConta);
    const bt = (d, rot, fn) => el('button', { type: 'button', class: 'jg-rp-bt', 'aria-label': rot, title: rot, onclick: fn }, ico(d, 20));
    const controles = el('div', { class: 'jg-rp-ctl' },
      el('div', { class: 'jg-rp-nav' },
        bt(IC.inicio, 'Começo', () => { pausar(); mostrar(0); }),
        bt(IC.ant, 'Lance anterior', voltar1),
        btPlay,
        bt(IC.prox, 'Próximo lance', avancar1),
        bt(IC.fim, 'Fim', () => { pausar(); mostrar(N); })),
      btVel, btMom);

    const abaBt = (k, txt) => el('button', { type: 'button', role: 'tab', class: 'jg-rp-aba', 'data-aba': k, onclick: () => trocarAba(k) }, txt);
    const abaAnaliseTxt = el('span', { class: 'jg-rp-aba-st' });
    const abas = { lances: abaBt('lances', 'LANCES'), analise: abaBt('analise', ['ANÁLISE ', abaAnaliseTxt]) };
    const painelLances = el('div', { class: 'jg-rp-painel', role: 'tabpanel', 'aria-label': 'Lances' });
    const painelAnalise = el('div', { class: 'jg-rp-painel an', role: 'tabpanel', 'aria-label': 'Análise do robô' });
    const caixaAbas = el('div', { class: 'jg-rp-abas' }, el('div', { class: 'jg-rp-abas-bt', role: 'tablist' }, abas.lances, abas.analise), painelLances, painelAnalise);

    const raiz = el('div', { class: 'jg-rp', role: 'region', 'aria-label': `Replay: ${nickCor('b')} contra ${nickCor('p')}` },
      topo, cimaBox, tabBox, baixoBox, leg, linha, controles, caixaAbas);

    // ---------------- lista de lances ----------------
    const botoesLance = [];
    function montarLista() {
      if (!N) { painelLances.replaceChildren(el('p', { class: 'jg-vazio', text: 'Essa partida não teve lances.' })); return; }
      const g = el('div', { class: 'jg-rp-lista' });
      for (let n = 1; n <= N; n += 2) {
        g.append(el('span', { class: 'jg-rp-num', text: `${(n + 1) / 2}.` }));
        for (const m of [n, n + 1]) {
          if (m > N) { g.append(el('span')); continue; }
          const b = el('button', { type: 'button', class: 'jg-rp-lance', 'aria-label': `Lance ${m}: ${nickCor(corDoLance(m))}, ${nota(L[m - 1])}`, onclick: () => verLance(m) },
            el('span', { class: 'nt', text: nota(L[m - 1]) }));
          if (L[m - 1].capturas.length >= 2) b.append(el('span', { class: 'jg-rp-icone raio' }, ico(IC.raio, 12)));
          if (L[m - 1].virou_dama) b.append(el('span', { class: 'jg-rp-icone coroa' }, ico(IC.coroa, 12)));
          botoesLance[m] = b;
          g.append(b);
        }
      }
      painelLances.replaceChildren(g);
    }
    function selosLista() {
      for (let m = 1; m <= N; m++) {
        const b = botoesLance[m], x = A.notas[m - 1];
        const velho = b.querySelector('.jg-rp-selo');
        const tipo = x && x.tipo !== 'melhor' && x.tipo !== 'excelente' && x.tipo !== 'bom' && x.tipo !== 'forcado' ? x.tipo : null;
        if ((velho && velho.dataset.t) === tipo) continue;
        if (velho) velho.remove();
        if (tipo) { const s = selo(tipo); s.dataset.t = tipo; b.append(s); }
      }
    }
    function marcarNaLista(k) {
      botoesLance.forEach((b, m) => { if (b) b.toggleAttribute('aria-current', m === k); });
      const b = botoesLance[k];
      if (!b || S.aba !== 'lances' || painelLances.hidden) return;
      // rola só a lista (scrollIntoView rolaria a página inteira); o painel é position: relative
      const c = painelLances, top = b.offsetTop, h = c.clientHeight;
      if (c.scrollHeight <= h + 2) return;
      if (top < c.scrollTop + 4 || top + b.offsetHeight > c.scrollTop + h - 4) c.scrollTop = Math.max(0, top - h / 2 + b.offsetHeight / 2);
    }

    // ---------------- desenho de uma posição ----------------
    function chanceB(k) {
      const r = A.r[k];
      return r ? Robo.chance(r.e) : Robo.chance(mat[k] * 95);
    }
    function txtNota(e) {
      if (Math.abs(e) > Robo.MATE - 1000) return '#' + Math.max(1, Math.ceil((Robo.MATE - Math.abs(e)) / 2));
      return virgula(Math.abs(e) / 100);
    }
    function desenharAval(k, anima) {
      const r = A.r[k], fimJogo = k === N && r && r.n === 0;
      const pct = Math.round(chanceB(k) * 1000) / 10;
      const antes = avalFill.style.height;
      avalFill.style.height = pct + '%';
      if (anima && antes && antes !== avalFill.style.height && avalFill.animate) avalFill.animate([{ height: antes }, { height: pct + '%' }], { duration: 380, easing: 'cubic-bezier(.3,.1,.3,1)' });
      aval.classList.toggle('girar', S.girar);
      aval.classList.toggle('aprox', !r);
      const e = r ? r.e : mat[k] * 100;
      avalNum.textContent = fimJogo ? (vencCor ? 'FIM' : '½') : txtNota(e);
      avalNum.className = e >= 0 ? 'b' : 'p';
      const quem = Math.abs(e) < 30 ? 'equilibrada' : `${e > 0 ? 'brancas' : 'pretas'} na frente`;
      aval.setAttribute('aria-label', `Barra de vantagem: ${quem}${r ? '' : ' (contando só as peças)'}`);
    }
    function desenharLados(k) {
      const t = pos[k].tab;
      for (const cor of ['b', 'p']) {
        const outra = cor === 'b' ? 'p' : 'b', n = contar(t, cor), comeu = Math.max(0, 12 - contar(t, outra));
        const bx = barras[cor];
        bx._sub.replaceChildren(`${cor === 'b' ? 'brancas' : 'pretas'} · ${n} ${n === 1 ? 'peça' : 'peças'}`,
          comeu ? el('span', { class: 'jg-mini', 'aria-label': `${comeu} capturadas` }, Array.from({ length: comeu }, () => el('i', { class: outra === 'p' ? 'es' : 'cl' }))) : '');
        bx.classList.toggle('vez', k < N && pos[k].vez === cor);
        bx.classList.toggle('jg-rp-venceu', k === N && vencCor === cor);
        const pr = A.prec && A.prec[cor];
        bx._prec.hidden = pr == null;
        if (pr != null) {
          bx._prec.textContent = `${virgula(pr)}%`;
          bx._prec.title = `Precisão de ${nickCor(cor)} segundo o robô`;
          bx._prec.className = `jg-rp-pchip ${pr >= 85 ? 'alta' : pr >= 65 ? 'media' : 'baixa'}`;
        }
      }
      cimaBox.replaceChildren(barras[S.girar ? 'b' : 'p']);
      baixoBox.replaceChildren(barras[S.girar ? 'p' : 'b']);
    }
    function melhorTxt(k) {
      const r = A.r[k - 1];
      return r && r.b ? r.b.map(R.nomeCasa).join(r.bx ? '×' : '-') : null;
    }
    function desenharLeg(k) {
      if (k === 0) {
        trocar(leg, el('div', { class: 'jg-rp-leg-1' }, el('b', { text: 'Começo da partida' })),
          el('small', { text: N ? `${nickCor('b')} começa de brancas. Toque no ▶ pra assistir.` : 'Essa partida não teve lances.' }));
      } else {
        const l = L[k - 1], cor = corDoLance(k), x = A.notas[k - 1], t = x && TIPO[x.tipo];
        const r = A.r[k - 1];
        let sub = '';
        if (x && ['excelente', 'bom', 'imprecisao', 'erro', 'grave'].includes(x.tipo)) {
          const m = melhorTxt(k);
          const virou = r && Robo.chance(r.m) >= 0.85 && Robo.chance(r.s) <= 0.6;
          sub = `${virou && x.tipo !== 'excelente' && x.tipo !== 'bom' ? 'Tinha a partida na mão e deixou escapar.' : t.frase}${m ? ` O melhor era ${m}.` : ''}`;
        } else if (t) sub = t.frase;
        else if (A.estado === 'rodando') sub = 'O robô ainda está olhando esse lance…';
        else if (!l.caminho.length) sub = TIPO.tempo.frase;
        trocar(leg,
          el('div', { class: 'jg-rp-leg-1' }, t ? selo(x.tipo) : null, el('b', { text: t ? t.nome : `Lance ${k}` }),
            el('span', { class: 'jg-rp-leg-q' }, ` · ${nickCor(cor)} `, el('span', { class: 'nt', text: nota(l) }))),
          sub ? el('small', { text: sub }) : null);
      }
      if (k === N && o.resultado) leg.append(el('div', { class: 'jg-rp-fim' + (vencCor ? '' : ' emp') }, o.resultado.titulo, o.resultado.motivo ? el('small', { text: o.resultado.motivo }) : null));
    }
    function trocar(box, ...f) { box.replaceChildren(...f.flat().filter((x) => x != null && x !== false)); }
    function pontoXY(k) {
      const x = N ? (k / N) * 100 : 0, w = chanceB(k);
      return [x, S.girar ? w * 100 : (1 - w) * 100];
    }
    function desenharGrafico() {
      const base = S.girar ? 0 : 100;
      const pts = [];
      for (let k = 0; k <= N; k++) { const [x, y] = pontoXY(k); pts.push(`${(x * 10).toFixed(1)} ${y.toFixed(1)}`); }
      gArea.setAttribute('d', `M0 ${base} L${pts.join(' L')} L1000 ${base} Z`);
      gCurva.setAttribute('d', `M${pts.join(' L')}`);
      linha.classList.toggle('girar', S.girar);
      linha.classList.toggle('pronta', A.estado === 'pronto');
      const ms = [];
      for (let m = 1; m <= N; m++) {
        const x = A.notas[m - 1], l = L[m - 1];
        const [px, py] = pontoXY(m);
        if (x && DESTAQUE.has(x.tipo)) ms.push(el('i', { class: `jg-rp-marca t-${x.tipo}`, style: `left:${px}%;top:${py}%` }));
        if (l.capturas.length >= 2) ms.push(el('span', { class: 'jg-rp-marca-ev raio', style: `left:${px}%` }, ico(IC.raio, 11)));
        else if (l.virou_dama) ms.push(el('span', { class: 'jg-rp-marca-ev coroa', style: `left:${px}%` }, ico(IC.coroa, 11)));
      }
      marcas.replaceChildren(...ms);
      posCabeca(S.k);
    }
    function posCabeca(k) {
      if (k < 0) return;
      const [x, y] = pontoXY(k);
      cabeca.style.left = x + '%';
      cabecaPt.style.top = y + '%';
      linha.setAttribute('aria-valuenow', String(k));
      linha.setAttribute('aria-valuetext', k === 0 ? 'começo' : `lance ${k} de ${N}`);
    }
    // seta do lance (cor da nota) e, depois de um erro, a seta tracejada verde do melhor
    function desenharSetas(k) {
      celulas.forEach((c) => c.classList.remove('jg-rp-de', 'jg-rp-para'));
      tab.querySelectorAll('.jg-c > .jg-rp-selo').forEach((s) => s.remove());
      if (k === 0) { setas.innerHTML = ''; return; }
      const l = L[k - 1], x = A.notas[k - 1];
      if (!l.caminho.length) { setas.innerHTML = ''; return; }
      const de = l.caminho[0], para = l.caminho[l.caminho.length - 1];
      celulas[de].classList.add('jg-rp-de');
      celulas[para].classList.add('jg-rp-para');
      const pt = (i) => { const { lin, col } = R.coord(i); return `${(S.girar ? 7 - col : col) + 0.5},${(S.girar ? 7 - lin : lin) + 0.5}`; };
      const COR = { brilhante: '#26D9D0', unico: '#5BB4FF', melhor: '#3DDC84', excelente: '#7FD46B', bom: '#A9C59A', imprecisao: '#F2C94C', erro: '#FF9A2E', grave: '#FF5A4E', forcado: '#C9BBAE' };
      const cor = (x && COR[x.tipo]) || '#FFB347';
      const linhas = [];
      const r = A.r[k - 1];
      const ruim = x && ['imprecisao', 'erro', 'grave'].includes(x.tipo);
      if (ruim && S.verMelhor && r && r.b) {
        linhas.push(`<polyline points="${r.b.map(pt).join(' ')}" fill="none" stroke="#3DDC84" stroke-width=".085" stroke-dasharray=".2 .13" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#jgRpSetaM)" opacity=".95"/>`);
      }
      linhas.push(`<polyline points="${l.caminho.map(pt).join(' ')}" fill="none" stroke="${cor}" stroke-width=".09" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#jgRpSetaJ)" opacity=".92"/>`);
      setas.innerHTML = `<defs><marker id="jgRpSetaJ" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.6" markerHeight="3.6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${cor}"/></marker>`
        + `<marker id="jgRpSetaM" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="3.6" markerHeight="3.6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#3DDC84"/></marker></defs>${linhas.join('')}`;
      if (x && TIPO[x.tipo] && x.tipo !== 'forcado') celulas[para].append(selo(x.tipo, 'no-tab'));
    }
    function desenharTudo(k, { setasJa = true, anima = false } = {}) {
      contador.textContent = `${k}/${N}`;
      desenharLados(k);
      desenharAval(k, anima);
      desenharLeg(k);
      posCabeca(k);
      marcarNaLista(k);
      if (setasJa) desenharSetas(k); else { setas.innerHTML = ''; celulas.forEach((c) => c.classList.remove('jg-rp-de', 'jg-rp-para')); tab.querySelectorAll('.jg-c > .jg-rp-selo').forEach((s) => s.remove()); }
      iconePlay();
    }

    // ---------------- animação de um lance ----------------
    function cancelarAnim() {
      S.tk++;
      for (const f of [...pend]) f();
      S.timers.forEach(clearTimeout);
      S.timers = [];
      S.anims.forEach((a) => { try { a.cancel(); } catch (e) {} });
      S.anims = [];
      S.fantasmas.forEach((f) => f.remove());
      S.fantasmas = [];
      tab.querySelectorAll('.jg-dama-fogo').forEach((f) => f.remove());
      tab.querySelectorAll('.jg-p').forEach((x) => { x.style.zIndex = ''; });
    }
    // mostra a posição k; anim = a peça anda casa por casa até lá (só de k-1 pra k)
    function mostrar(k, { anim = false, efeitos = true } = {}) {
      k = Math.max(0, Math.min(N, k));
      cancelarAnim();
      S.k = k;
      porPecas(pos[k].tab);
      if (o.aoMudar) o.aoMudar(k);
      if (!anim || k === 0) { desenharTudo(k); return Promise.resolve(); }
      desenharTudo(k, { setasJa: false, anima: true });
      return animarLance(k, efeitos);
    }
    async function animarLance(k, efeitos) {
      const tk = S.tk;
      const l = L[k - 1], c = l.caminho;
      if (c.length < 2) { await espera(500); return; }
      const antes = pos[k - 1].tab;
      const passo = S.mom ? PASSO : PASSO / S.vel;
      const pulos = c.length - 1;
      const cPara = celulas[c[c.length - 1]], pc = cPara.querySelector('.jg-p');
      const combo = efeitos && !!FX() && l.capturas.length >= 2 && (S.vel <= 2 || !!S.mom);
      if (pc && pc.animate) {
        const r2 = cPara.getBoundingClientRect();
        const quadros = c.map((i) => { const r = celulas[i].getBoundingClientRect(); return { transform: `translate(${r.left - r2.left}px, ${r.top - r2.top}px)`, easing: 'cubic-bezier(.3, .1, .3, 1)' }; });
        pc.style.zIndex = '3';
        S.anims.push(pc.animate(quadros, { duration: pulos * passo, fill: 'backwards' }));
        if (l.virou_dama) S.anims.push(pc.animate([{ scale: 1, filter: 'none' }, { scale: 1.3, filter: 'brightness(1.5) drop-shadow(0 0 14px #FFD84D)', offset: 0.35 }, { scale: 1, filter: 'none' }], { duration: 800, delay: pulos * passo, easing: 'ease-out' }));
      }
      l.capturas.forEach((i, j) => {
        const letra = antes[i];
        if (!letra || letra === '.') return;
        const f = o.peca(letra);
        f.classList.add('jg-some');
        celulas[i].append(f);
        S.fantasmas.push(f);
        if (!f.animate) return;
        // combo: a comida fica no lugar até a peça parar (aí o raio cai nela)
        S.anims.push(combo ? f.animate([{ opacity: 1 }, { opacity: 1 }], { duration: pulos * passo + 60, fill: 'both' })
          : f.animate([{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.15)', opacity: 0 }], { duration: Math.min(420, passo * 1.2), delay: j * passo + passo * 0.5, easing: 'ease-in', fill: 'both' }));
      });
      // som: um toque por casa andada, mais agudo a cada peça comida; fanfarra se virou dama
      if (!l.capturas.length) som(l.virou_dama ? [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.26]] : [[330, 0.07]]);
      else l.capturas.forEach((_, j) => depois(j * passo + passo * 0.5, () => som([[520 + 70 * j, 0.07], [390 + 70 * j, 0.11]])));
      if (l.virou_dama && l.capturas.length) depois(pulos * passo + 60, () => som([[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.26]]));
      await espera(pulos * passo + 40);
      if (tk !== S.tk) return;
      if (pc) pc.style.zIndex = '';
      if (l.virou_dama) {
        const fogo = el('span', { class: 'jg-dama-fogo', 'aria-hidden': 'true' });
        cPara.prepend(fogo);
        if (fogo.animate) S.anims.push(fogo.animate([{ rotate: '0deg', opacity: 0 }, { rotate: '200deg', opacity: 0.95, offset: 0.2 }, { rotate: '700deg', opacity: 0.95, offset: 0.8 }, { rotate: '900deg', opacity: 0 }], { duration: 1800, fill: 'both' }));
        depois(1850, () => fogo.remove());
      }
      desenharSetas(k);
      if (combo) {
        const lado = tab.getBoundingClientRect().width / 8;
        const alvos = l.capturas.map((i) => {
          const r = celulas[i].getBoundingClientRect(), letra = antes[i];
          return { x: r.left + r.width / 2, y: r.top + r.height / 2, letra, peca: letra && letra !== '.' ? o.peca(letra) : null };
        });
        depois(20, () => { S.fantasmas.forEach((f) => f.remove()); S.fantasmas = []; });
        // o raio avisa quando acabou; se der pau no 3D, o replay não fica parado pra sempre
        await aguardar((f) => {
          S.timers.push(setTimeout(f, 9000));
          try { FX().combo(alvos, lado, { tab: () => (tab.isConnected ? tab : null), som: !(o.mudo && o.mudo()), aoAcabar: f }); } catch (e) { f(); }
        });
      } else if (l.virou_dama) await espera(700);
    }

    // ---------------- tocar, voltar, avançar ----------------
    function iconePlay() {
      btPlay.replaceChildren(ico(S.tocando && !S.mom ? IC.pausa : IC.play, 24));
      btPlay.setAttribute('aria-label', S.tocando && !S.mom ? 'Pausar' : S.k >= N ? 'Ver de novo' : 'Tocar');
      btPlay.classList.toggle('chama', !S.tocando && S.k === 0 && N > 0);
      btVel.textContent = `${virgula(S.vel, S.vel < 1 ? 1 : 0)}×`;
      btMom.classList.toggle('ativo', !!S.mom);
      btMom.setAttribute('aria-pressed', S.mom ? 'true' : 'false');
      momTxt.textContent = S.mom ? 'Momento' : 'Momentos';
      momConta.textContent = S.mom ? `${S.mom.i + 1}/${S.mom.lista.length}` : '';
      btMom.setAttribute('aria-label', S.mom ? `Parar os melhores momentos (momento ${S.mom.i + 1} de ${S.mom.lista.length})` : 'Melhores momentos');
      raiz.classList.toggle('tocando', S.tocando);
    }
    function pausar() {
      S.play++;
      S.tocando = false;
      S.mom = null;
      iconePlay();
    }
    async function tocar() {
      if (!N) return;
      pausar();
      const meu = S.play;
      S.tocando = true;
      if (S.k >= N) { await mostrar(0); await espera(500); if (meu !== S.play) return; }
      iconePlay();
      while (S.tocando && meu === S.play && S.k < N) {
        await mostrar(S.k + 1, { anim: true });
        if (meu !== S.play) return;
        await espera(Math.max(100, 480 / S.vel));
        if (meu !== S.play) return;
      }
      if (meu === S.play) { S.tocando = false; iconePlay(); }
    }
    function avancar1() { pausar(); if (S.k < N) mostrar(S.k + 1, { anim: true }); }
    function voltar1() { pausar(); if (S.k > 0) mostrar(S.k - 1); }
    // tocou num lance da lista: mostra ele acontecendo
    function verLance(m) {
      pausar();
      if (S.k === m) { mostrar(m - 1).then(() => mostrar(m, { anim: true })); return; }
      if (S.k !== m - 1) mostrar(m - 1);
      mostrar(m, { anim: true });
    }
    function trocarVel() {
      S.vel = VELOCIDADES[(VELOCIDADES.indexOf(S.vel) + 1) % VELOCIDADES.length];
      iconePlay();
    }
    function girar() {
      S.girar = !S.girar;
      const k = S.k;
      montarTab();
      cancelarAnim();
      celulas.forEach((c) => { c._letra = '.'; });
      porPecas(pos[k].tab);
      desenharTudo(k);
      desenharGrafico();
    }
    // melhores momentos: os lances que decidiram (brilhantes, erros graves, combos, damas e o último)
    function listaMomentos() {
      const pts = [];
      L.forEach((l, j) => {
        const n = j + 1, t = A.notas[j] && A.notas[j].tipo;
        let s = { brilhante: 10, unico: 5, grave: 7, erro: 3 }[t] || 0;
        if (l.capturas.length >= 2) s += 3 + l.capturas.length;
        if (l.virou_dama) s += 4;
        if (n === N && l.caminho.length) s += 5;
        if (s) pts.push({ n, s });
      });
      return pts.sort((a, b) => b.s - a.s || a.n - b.n).slice(0, 7).sort((a, b) => a.n - b.n).map((x) => x.n);
    }
    async function momentos() {
      const lista = listaMomentos();
      if (!lista.length) { if (o.avisar) o.avisar('Essa partida não teve lances marcantes.'); return; }
      pausar();
      const meu = S.play;
      S.tocando = true;
      S.mom = { lista, i: 0 };
      for (let i = 0; i < lista.length; i++) {
        if (meu !== S.play) return;
        S.mom.i = i;
        const m = lista[i];
        await mostrar(m - 1);
        iconePlay();
        await espera(i ? 650 : 400);
        if (meu !== S.play) return;
        await mostrar(m, { anim: true, efeitos: true });
        if (meu !== S.play) return;
        const t = A.notas[m - 1] && A.notas[m - 1].tipo;
        await espera(t === 'brilhante' || t === 'grave' || m === N ? 2600 : 1700);
      }
      if (meu === S.play) { S.tocando = false; S.mom = null; iconePlay(); }
    }

    // ---------------- abas e análise ----------------
    function trocarAba(k) {
      S.aba = k;
      for (const [x, b] of Object.entries(abas)) { b.setAttribute('aria-selected', x === k ? 'true' : 'false'); b.classList.toggle('ativa', x === k); }
      painelLances.hidden = k !== 'lances';
      painelAnalise.hidden = k !== 'analise';
      if (k === 'analise') desenharAnalise();
      else marcarNaLista(S.k);
    }
    function lanceDaPartida() {
      for (const tipo of ['brilhante', 'unico']) {
        const j = A.notas.findIndex((x) => x && x.tipo === tipo);
        if (j >= 0) return { n: j + 1, tipo };
      }
      let mx = 0, n = 0;
      L.forEach((l, j) => { if (l.capturas.length >= 2 && l.capturas.length > mx) { mx = l.capturas.length; n = j + 1; } });
      return n ? { n, tipo: null } : null;
    }
    function desenharAnalise() {
      if (painelAnalise.hidden) return;
      if (A.estado === 'erro') {
        trocar(painelAnalise, el('div', { class: 'jg-rp-an-cab' }, ico(IC.robo, 20), el('b', { text: 'ANÁLISE DO ROBÔ' })), el('p', { class: 'jg-vazio', text: A.msg || 'Não deu pra analisar essa partida.' }));
        return;
      }
      const pronto = A.estado === 'pronto';
      const pct = Math.floor((100 * A.feito) / (N + 1));
      const profs = Object.values(A.r).map((r) => r.prof || 0).filter(Boolean).sort((a, b) => a - b);
      const prof = profs.length ? profs[Math.floor(profs.length / 2)] : 0;
      const card = (cor) => {
        const pr = A.prec && A.prec[cor];
        return el('div', { class: `jg-rp-prec ${cor}${vencCor === cor ? ' venceu' : ''}` }, o.avatar(idDe(cor)),
          el('b', { class: 'nick', text: nickCor(cor) }),
          el('small', { text: 'PRECISÃO' }),
          el('span', { class: `pnum ${pr == null ? '' : pr >= 85 ? 'alta' : pr >= 65 ? 'media' : 'baixa'}`, text: pr == null ? (pronto ? '–' : '…') : virgula(pr) }));
      };
      const conta = (tipo, cor) => A.notas.filter((x, j) => x && x.tipo === tipo && corDoLance(j + 1) === cor).length;
      const ld = lanceDaPartida();
      trocar(painelAnalise,
        el('div', { class: 'jg-rp-an-cab' }, ico(IC.robo, 20), el('b', { text: 'ANÁLISE DO ROBÔ' }),
          el('small', { text: pronto ? (prof ? `pensou até ${prof} lances à frente` : 'pronta') : `analisando… ${pct}%` })),
        pronto ? null : el('div', { class: 'jg-rp-progresso', role: 'progressbar', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(pct) }, el('i', { style: `width:${pct}%` })),
        el('div', { class: 'jg-rp-precs' }, card('b'), card('p')),
        ld ? el('div', { class: 'jg-rp-destaque' },
          el('small', { text: 'LANCE DA PARTIDA' }),
          el('div', { class: 'jg-rp-destaque-l' }, ld.tipo ? selo(ld.tipo) : el('span', { class: 'jg-rp-icone raio' }, ico(IC.raio, 14)),
            el('span', null, el('b', { text: ld.tipo ? TIPO[ld.tipo].nome : `Comeu ${L[ld.n - 1].capturas.length} de uma vez` }), ` · lance ${ld.n} · ${nickCor(corDoLance(ld.n))} `, el('span', { class: 'nt', text: nota(L[ld.n - 1]) }))),
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => verLance(ld.n) }, ico(IC.play, 14), 'Ver o lance')) : null,
        el('table', { class: 'jg-rp-tabela' },
          el('thead', null, el('tr', null, el('th', { text: '' }), el('th', { text: nickCor('b') }), el('th', { text: nickCor('p') }))),
          el('tbody', null, ORDEM_TABELA.map((tipo) => el('tr', { class: `t-${tipo}` },
            el('td', null, selo(tipo), TIPO[tipo].plural),
            el('td', { text: String(conta(tipo, 'b')) }), el('td', { text: String(conta(tipo, 'p')) }))))),
        el('label', { class: 'jg-rp-chave' },
          el('input', { type: 'checkbox', checked: S.verMelhor, onchange: (e) => { S.verMelhor = e.currentTarget.checked; salvarPref('melhor', S.verMelhor); desenharSetas(S.k); } }),
          el('span', { text: 'Depois de um erro, mostrar no tabuleiro o melhor lance (seta verde)' })),
        el('p', { class: 'jg-rp-nota', text: 'O robô analisa no seu aparelho e olha vários lances à frente. É a opinião dele, não regra: em posição muito difícil ele também pode errar.' }));
    }
    let redesenho = 0;
    function agendar() {
      if (redesenho) return;
      redesenho = requestAnimationFrame(() => {
        redesenho = 0;
        if (!S.vivo) return;
        desenharGrafico();
        if (N) selosLista();
        abaAnaliseTxt.textContent = A.estado === 'pronto' ? '' : A.estado === 'rodando' ? `${Math.floor((100 * A.feito) / (N + 1))}%` : '';
        abas.analise.classList.toggle('pronta', A.estado === 'pronto');
        desenharAnalise();
        // a posição na tela: barra, legenda e seta pegam a nota que acabou de chegar
        if (!S.anims.length || S.anims.every((a) => a.playState === 'finished')) { desenharAval(S.k, true); desenharLeg(S.k); desenharLados(S.k); if (!pend.size) desenharSetas(S.k); }
      });
    }
    function chegou(k, r) {
      if (!S.vivo || A.r[k]) return;
      A.r[k] = r;
      A.feito++;
      if (k < N) A.notas[k] = Robo.classificar(r, L[k]);
      if (A.feito >= N + 1) concluir(false);
      agendar();
    }
    function concluir(doCache) {
      if (doCache) { A.feito = N + 1; for (let k = 0; k < N; k++) A.notas[k] = Robo.classificar(A.r[k], L[k]); }
      A.prec = { b: Robo.precisao(A.notas, 1), p: Robo.precisao(A.notas, -1) };
      A.estado = 'pronto';
      A.workers.forEach((w) => w.terminate());
      A.workers = [];
      if (!doCache && p.id) salvarCache(p.id, { v: VERSAO_CACHE, n: N, nos: NOS, maioria: A.maioria, r: A.r });
      agendar();
    }
    function analisar() {
      if (!Robo || !N) { A.estado = 'erro'; A.msg = N ? 'O robô não carregou.' : 'Essa partida não teve lances.'; return; }
      const guardada = p.id && lerCache(p.id, N);
      if (guardada) { A.r = guardada.r; A.maioria = guardada.maioria; concluir(true); return; }
      let maioria = o.maioria !== false;
      if (Robo.conferir(L, maioria) >= 0) {
        if (Robo.conferir(L, !maioria) < 0) maioria = !maioria;
        else { A.estado = 'erro'; A.msg = 'Essa partida tem um lance que o robô não reconhece (as regras mudaram no meio?).'; return; }
      }
      A.maioria = maioria;
      A.estado = 'rodando';
      const ks = Array.from({ length: N + 1 }, (_, k) => k);
      let nW = 0;
      try { nW = typeof Worker === 'function' ? Math.max(1, Math.min(4, (navigator.hardwareConcurrency || 2) - 1)) : 0; } catch (e) { nW = 0; }
      if (!nW) { noAparelho(ks); return; }
      const dados = L.map((l) => ({ caminho: l.caminho, capturas: l.capturas, virou_dama: l.virou_dama }));
      for (let w = 0; w < nW; w++) {
        const meus = ks.filter((k) => k % nW === w); // intercalado: o gráfico enche da esquerda pra direita
        let wk;
        try { wk = new Worker(BASE + 'damas-robo.js'); } catch (e) { noAparelho(meus); continue; }
        A.workers.push(wk);
        const falhou = () => { try { wk.terminate(); } catch (e) {} A.workers = A.workers.filter((x) => x !== wk); noAparelho(meus.filter((k) => !A.r[k])); };
        wk.onmessage = (e) => {
          const d = e.data || {};
          if (d.id !== A.id) return;
          if (d.erro) falhou();
          else if (d.fim) { wk.terminate(); A.workers = A.workers.filter((x) => x !== wk); }
          else chegou(d.k, d.r);
        };
        wk.onerror = (e) => { if (e && e.preventDefault) e.preventDefault(); falhou(); };
        wk.postMessage({ id: A.id, lances: dados, maioria, nos: NOS, indices: meus });
      }
    }
    // sem Worker: analisa aqui mesmo, uma posição por vez (a tela respira entre uma e outra)
    function noAparelho(ks) {
      let i = 0;
      const um = () => {
        if (!S.vivo || i >= ks.length) return;
        const k = ks[i++];
        if (!A.r[k]) chegou(k, Robo.analisarPartida(L, { maioria: A.maioria, nos: NOS, indices: [k] })[k]);
        setTimeout(um, 16);
      };
      setTimeout(um, 30);
    }

    // ---------------- teclado e linha do tempo ----------------
    function tecla(e) {
      if (!S.vivo || !raiz.isConnected || e.ctrlKey || e.metaKey || e.altKey) return;
      if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable="true"]')) return;
      if (document.querySelector('.jg-fim-fundo, dialog[open]')) return;
      if (e.key === 'ArrowRight') { e.preventDefault(); avancar1(); }
      else if (e.key === 'ArrowLeft') { e.preventDefault(); voltar1(); }
      else if (e.key === 'Home') { e.preventDefault(); pausar(); mostrar(0); }
      else if (e.key === 'End') { e.preventDefault(); pausar(); mostrar(N); }
      else if ((e.key === ' ' || e.key === 'k') && !(e.target && e.target.closest && e.target.closest('button'))) { e.preventDefault(); if (S.tocando) pausar(); else tocar(); }
    }
    document.addEventListener('keydown', tecla);
    let arrasta = false;
    function deX(e) {
      const r = linha.getBoundingClientRect();
      const k = Math.round(Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)) * N);
      if (k !== S.k || S.tocando) { pausar(); mostrar(k); }
    }
    linha.addEventListener('pointerdown', (e) => { if (e.button) return; arrasta = true; try { linha.setPointerCapture(e.pointerId); } catch (x) {} deX(e); });
    linha.addEventListener('pointermove', (e) => { if (arrasta) deX(e); });
    for (const ev of ['pointerup', 'pointercancel', 'lostpointercapture']) linha.addEventListener(ev, () => { arrasta = false; });

    // ---------------- começo ----------------
    montarTab();
    montarLista();
    trocarAba('lances');
    mostrar(Math.max(0, Math.min(N, o.inicio | 0)));
    analisar();
    desenharGrafico();
    agendar();
    if (FX() && FX().preparar3d) FX().preparar3d(); // o 3D do raio baixa enquanto a pessoa assiste

    return {
      raiz,
      get k() { return S.k; },
      montado() { desenharGrafico(); marcarNaLista(S.k); },
      ir(k) { pausar(); mostrar(k); },
      destruir() {
        S.vivo = false;
        pausar();
        cancelarAnim();
        A.workers.forEach((w) => w.terminate());
        A.workers = [];
        document.removeEventListener('keydown', tecla);
      },
    };
  }

  window.DamasReplay = { abrir, TIPO };
})();
