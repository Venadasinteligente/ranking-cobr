/* Regras da damas brasileira (sem tela, sem banco).
   Funciona no navegador (window.DamasRegras) e no Node (require('./damas-regras.js')).

   Tabuleiro: 32 casas escuras, numeradas 0..31.
   Casa i -> linha Math.floor(i/4) (0 = em cima, lado das pretas; 7 = embaixo, lado das brancas).
   Casa escura no canto inferior esquerdo de cada jogador: na linha par as escuras são as colunas
   1,3,5,7; na linha ímpar, 0,2,4,6.
   tab: 32 letras. b = pedra branca, B = dama branca, p = pedra preta, P = dama preta, . = vazia.
   Brancas começam e sobem (linha diminui); pretas descem. */
(function (raiz, fabrica) {
  if (typeof module === 'object' && module.exports) module.exports = fabrica();
  else raiz.DamasRegras = fabrica();
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  const LIMITE_EMPATE = 20;               // lances seguidos só de damas, sem captura nem pedra andando
  const DIRECOES = [[-1, -1], [-1, 1], [1, -1], [1, 1]];

  // ---------- coordenadas ----------
  function coord(i) {
    const lin = Math.floor(i / 4);
    return { lin, col: (i % 4) * 2 + (lin % 2 === 0 ? 1 : 0) };
  }
  function casa(lin, col) {
    if (lin < 0 || lin > 7 || col < 0 || col > 7) return -1;
    if ((lin + col) % 2 === 0) return -1;  // casa clara
    return lin * 4 + Math.floor(col / 2);
  }
  // nome no tabuleiro visto pelas brancas: colunas a..h da esquerda, fileiras 1..8 de baixo
  function nomeCasa(i) {
    const { lin, col } = coord(i);
    return 'abcdefgh'[col] + (8 - lin);
  }

  // ---------- peças ----------
  const corDe = (p) => (p === 'b' || p === 'B' ? 'b' : p === 'p' || p === 'P' ? 'p' : null);
  const ehDama = (p) => p === 'B' || p === 'P';
  const outra = (cor) => (cor === 'b' ? 'p' : 'b');
  const linhaDama = (cor) => (cor === 'b' ? 0 : 7);
  const frente = (cor) => (cor === 'b' ? -1 : 1);

  function conferirEstado(estado) {
    if (!estado || typeof estado.tab !== 'string' || estado.tab.length !== 32 || /[^bBpP.]/.test(estado.tab))
      throw new Error('estado inválido');
    if (estado.vez !== 'b' && estado.vez !== 'p') throw new Error('estado inválido');
  }

  function estadoInicial() {
    return { tab: 'pppppppppppp........bbbbbbbbbbbb', vez: 'b', semProgresso: 0 };
  }

  // ---------- capturas (busca em profundidade) ----------
  // tab: array com a casa de origem já vazia (a peça saiu de lá). As capturadas continuam no
  // tabuleiro até o fim do lance: não podem ser puladas de novo nem servem de casa livre.
  function capturasDe(tab, origem, cor, dama) {
    const fim = [];
    const passo = (pos, caminho, capturadas) => {
      const { lin, col } = coord(pos);
      let continuou = false;
      for (const [dl, dc] of DIRECOES) {
        let l = lin + dl, c = col + dc;
        if (dama) {
          // anda por casas livres até a primeira peça
          while (casa(l, c) >= 0 && tab[casa(l, c)] === '.') { l += dl; c += dc; }
        }
        const alvo = casa(l, c);
        if (alvo < 0) continue;
        if (corDe(tab[alvo]) !== outra(cor) || capturadas.includes(alvo)) continue;
        // pousos: logo depois (pedra) ou qualquer casa livre seguida depois (dama)
        let pl = l + dl, pc = c + dc;
        while (casa(pl, pc) >= 0 && tab[casa(pl, pc)] === '.') {
          const pouso = casa(pl, pc);
          continuou = true;
          passo(pouso, caminho.concat(pouso), capturadas.concat(alvo));
          if (!dama) break;
          pl += dl; pc += dc;
        }
      }
      if (!continuou && capturadas.length) fim.push({ caminho, capturas: capturadas });
    };
    passo(origem, [origem], []);
    return fim;
  }

  function jogadasValidas(estado, opcoes) {
    conferirEstado(estado);
    const maioria = !opcoes || opcoes.maioria !== false;
    const cor = estado.vez;
    const tab = estado.tab.split('');
    const capturas = [];
    const simples = [];

    for (let i = 0; i < 32; i++) {
      if (corDe(tab[i]) !== cor) continue;
      const dama = ehDama(tab[i]);
      const peca = tab[i];
      tab[i] = '.';
      for (const s of capturasDe(tab, i, cor, dama)) {
        const para = s.caminho[s.caminho.length - 1];
        capturas.push({ caminho: s.caminho, capturas: s.capturas, viraDama: !dama && coord(para).lin === linhaDama(cor) });
      }
      tab[i] = peca;

      const { lin, col } = coord(i);
      for (const [dl, dc] of DIRECOES) {
        if (!dama && dl !== frente(cor)) continue;   // pedra só anda para frente
        let l = lin + dl, c = col + dc;
        while (casa(l, c) >= 0 && tab[casa(l, c)] === '.') {
          const para = casa(l, c);
          simples.push({ caminho: [i, para], capturas: [], viraDama: !dama && l === linhaDama(cor) });
          if (!dama) break;
          l += dl; c += dc;
        }
      }
    }

    if (!capturas.length) return simples;            // captura é obrigatória
    if (!maioria) return capturas;
    const max = Math.max(...capturas.map((j) => j.capturas.length));
    return capturas.filter((j) => j.capturas.length === max);
  }

  const mesmoCaminho = (a, b) => a.length === b.length && a.every((x, k) => x === b[k]);

  function aplicar(estado, caminho, opcoes) {
    conferirEstado(estado);
    if (!Array.isArray(caminho) || caminho.length < 2) throw new Error('jogada inválida');
    const jogada = jogadasValidas(estado, opcoes).find((j) => mesmoCaminho(j.caminho, caminho));
    if (!jogada) throw new Error('jogada inválida');

    const tab = estado.tab.split('');
    const de = jogada.caminho[0];
    const para = jogada.caminho[jogada.caminho.length - 1];
    const peca = tab[de];
    tab[de] = '.';
    for (const c of jogada.capturas) tab[c] = '.';
    tab[para] = jogada.viraDama ? peca.toUpperCase() : peca;

    const soDama = ehDama(peca) && !jogada.capturas.length;
    return Object.assign({}, estado, {
      tab: tab.join(''),
      vez: outra(estado.vez),
      semProgresso: soDama ? (estado.semProgresso || 0) + 1 : 0,
    });
  }

  function resultado(estado) {
    conferirEstado(estado);
    const cor = estado.vez;
    if (![...estado.tab].some((p) => corDe(p) === cor)) return { vencedor: outra(cor), motivo: 'sem_pecas' };
    if (!jogadasValidas(estado).length) return { vencedor: outra(cor), motivo: 'sem_jogadas' };
    if ((estado.semProgresso || 0) >= LIMITE_EMPATE) return { vencedor: null, motivo: 'empate_20' };
    return null;
  }

  return { estadoInicial, jogadasValidas, aplicar, resultado, coord, casa, nomeCasa, LIMITE_EMPATE };
});
