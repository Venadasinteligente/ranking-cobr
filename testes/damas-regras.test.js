// Testes das regras da damas brasileira. Rodar: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../damas-regras.js');

// monta um estado a partir de [linha, coluna, peça]
function montar(pecas, vez = 'b', semProgresso = 0) {
  const tab = Array(32).fill('.');
  for (const [lin, col, p] of pecas) {
    const i = R.casa(lin, col);
    if (i < 0) throw new Error(`casa clara: ${lin},${col}`);
    tab[i] = p;
  }
  return { tab: tab.join(''), vez, semProgresso };
}
const c = (lin, col) => R.casa(lin, col);
const caminhos = (js) => js.map((j) => j.caminho.join('-')).sort();
const cam = (...casas) => casas.map(([l, k]) => c(l, k)).join('-');

test('coordenadas: canto inferior esquerdo escuro para os dois lados', () => {
  assert.ok(c(7, 0) >= 0);           // canto das brancas (a1)
  assert.ok(c(0, 7) >= 0);           // canto das pretas (h8)
  assert.equal(c(7, 1), -1);         // casa clara
  assert.equal(R.nomeCasa(c(7, 0)), 'a1');
  assert.equal(R.nomeCasa(c(0, 7)), 'h8');
  for (let i = 0; i < 32; i++) {
    const { lin, col } = R.coord(i);
    assert.equal(R.casa(lin, col), i);
  }
});

test('posição inicial: brancas começam com 7 jogadas', () => {
  const e = R.estadoInicial();
  assert.deepEqual(e, { tab: 'pppppppppppp........bbbbbbbbbbbb', vez: 'b', semProgresso: 0 });
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 7);
  assert.ok(js.every((j) => j.capturas.length === 0 && !j.viraDama));
  assert.ok(js.every((j) => R.coord(j.caminho[0]).lin === 5 && R.coord(j.caminho[1]).lin === 4));
  assert.equal(R.resultado(e), null);
  // depois de um lance, as pretas também têm 7
  const e2 = R.aplicar(e, js[0].caminho);
  assert.equal(e2.vez, 'p');
  assert.equal(R.jogadasValidas(e2).length, 7);
});

test('pedra não anda para trás', () => {
  const e = montar([[4, 3, 'b']]);
  assert.deepEqual(caminhos(R.jogadasValidas(e)), [cam([4, 3], [3, 2]), cam([4, 3], [3, 4])].sort());
  const p = montar([[3, 4, 'p']], 'p');
  assert.deepEqual(caminhos(R.jogadasValidas(p)), [cam([3, 4], [4, 3]), cam([3, 4], [4, 5])].sort());
});

test('pedra captura para trás', () => {
  const e = montar([[4, 3, 'b'], [5, 4, 'p']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 1);
  assert.equal(js[0].caminho.join('-'), cam([4, 3], [6, 5]));
  assert.deepEqual(js[0].capturas, [c(5, 4)]);
});

test('captura obrigatória: havendo captura, andar normal não aparece', () => {
  const e = montar([[4, 3, 'b'], [3, 4, 'p'], [6, 1, 'b'], [7, 6, 'B']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 1);
  assert.equal(js[0].caminho.join('-'), cam([4, 3], [2, 5]));
  assert.throws(() => R.aplicar(e, [c(6, 1), c(5, 0)]), /jogada inválida/);
});

test('captura múltipla de 2 e de 3 peças', () => {
  // 2 peças: (6,1) pula (5,2) -> (4,3), pula (3,4) -> (2,5)
  const e2 = montar([[6, 1, 'b'], [5, 2, 'p'], [3, 4, 'p']]);
  const j2 = R.jogadasValidas(e2);
  assert.equal(j2.length, 1);
  assert.equal(j2[0].caminho.join('-'), cam([6, 1], [4, 3], [2, 5]));
  assert.deepEqual(j2[0].capturas, [c(5, 2), c(3, 4)]);
  const d2 = R.aplicar(e2, j2[0].caminho);
  assert.equal(d2.tab[c(5, 2)], '.');
  assert.equal(d2.tab[c(3, 4)], '.');
  assert.equal(d2.tab[c(2, 5)], 'b');
  assert.equal(d2.tab[c(6, 1)], '.');

  // 3 peças, com uma captura para trás no meio
  const e3 = montar([[6, 1, 'b'], [5, 2, 'p'], [3, 4, 'p'], [3, 6, 'p']]);
  const j3 = R.jogadasValidas(e3);
  assert.equal(j3.length, 1);
  assert.equal(j3[0].caminho.join('-'), cam([6, 1], [4, 3], [2, 5], [4, 7]));
  assert.equal(j3[0].capturas.length, 3);
});

test('lei da maioria: só a sequência que captura mais vale; desligada, todas valem', () => {
  // pedra A (6,1) captura 3; pedra B (1,0) captura 1 (para trás)
  const e = montar([
    [6, 1, 'b'], [5, 2, 'p'], [3, 4, 'p'], [3, 6, 'p'],
    [1, 0, 'b'], [2, 1, 'p'],
  ]);
  const com = R.jogadasValidas(e, { maioria: true });
  assert.deepEqual(caminhos(com), [cam([6, 1], [4, 3], [2, 5], [4, 7])]);
  assert.deepEqual(caminhos(R.jogadasValidas(e)), caminhos(com));   // padrão: maioria ligada
  assert.throws(() => R.aplicar(e, [c(1, 0), c(3, 2)]), /jogada inválida/);

  const sem = R.jogadasValidas(e, { maioria: false });
  assert.deepEqual(caminhos(sem), [cam([6, 1], [4, 3], [2, 5], [4, 7]), cam([1, 0], [3, 2])].sort());
  assert.doesNotThrow(() => R.aplicar(e, [c(1, 0), c(3, 2)], { maioria: false }));
  // mesmo sem a maioria, a sequência tem que ir até o fim
  assert.throws(() => R.aplicar(e, [c(6, 1), c(4, 3)], { maioria: false }), /jogada inválida/);
});

test('lei da maioria: empate entre sequências, o jogador escolhe', () => {
  const e = montar([[4, 3, 'b'], [3, 2, 'p'], [3, 4, 'p']]);
  assert.deepEqual(caminhos(R.jogadasValidas(e)), [cam([4, 3], [2, 1]), cam([4, 3], [2, 5])].sort());
});

test('lei da maioria: pedra e dama valem igual', () => {
  // uma pedra captura 2 pedras, outra captura 1 dama -> só vale a de 2 (dama não conta mais)
  const e = montar([[6, 1, 'b'], [5, 2, 'p'], [3, 4, 'p'], [7, 6, 'b'], [6, 7, 'P'], [6, 5, 'P']]);
  assert.deepEqual(caminhos(R.jogadasValidas(e)), [cam([6, 1], [4, 3], [2, 5])]);
  // 1 dama ou 1 pedra: as duas valem
  const igual = montar([[4, 3, 'b'], [3, 2, 'p'], [3, 4, 'P']]);
  assert.equal(R.jogadasValidas(igual).length, 2);
});

test('dama voadora: anda longe na diagonal', () => {
  const e = montar([[7, 0, 'B']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 7);
  assert.ok(js.some((j) => j.caminho[1] === c(0, 7)));
  const d = R.aplicar(e, [c(7, 0), c(0, 7)]);
  assert.equal(d.tab[c(0, 7)], 'B');
  // não passa por cima da própria peça
  const bloq = montar([[7, 0, 'B'], [4, 3, 'b']]);
  assert.ok(!R.jogadasValidas(bloq).some((j) => j.caminho[0] === c(7, 0) && j.caminho[1] === c(3, 4)));
});

test('dama voadora: captura à distância e escolhe a casa de pouso', () => {
  const e = montar([[7, 0, 'B'], [4, 3, 'p']]);
  const js = R.jogadasValidas(e);
  assert.deepEqual(caminhos(js), [
    cam([7, 0], [3, 4]), cam([7, 0], [2, 5]), cam([7, 0], [1, 6]), cam([7, 0], [0, 7]),
  ].sort());
  assert.ok(js.every((j) => j.capturas.length === 1 && j.capturas[0] === c(4, 3) && !j.viraDama));
  const d = R.aplicar(e, [c(7, 0), c(1, 6)]);
  assert.equal(d.tab[c(1, 6)], 'B');
  assert.equal(d.tab[c(4, 3)], '.');
  // duas peças juntas na diagonal não podem ser capturadas
  const dupla = montar([[7, 0, 'B'], [5, 2, 'p'], [4, 3, 'p']]);
  assert.ok(R.jogadasValidas(dupla).every((j) => j.capturas.length === 0));
});

test('dama voadora: sequência de capturas (e a maioria escolhe o pouso)', () => {
  // dama pula (5,2); só pousando em (3,4) ela continua e pula (2,3)
  const e = montar([[7, 0, 'B'], [5, 2, 'p'], [2, 3, 'p']]);
  const com = R.jogadasValidas(e);
  assert.deepEqual(caminhos(com), [cam([7, 0], [3, 4], [1, 2]), cam([7, 0], [3, 4], [0, 1])].sort());
  assert.ok(com.every((j) => j.capturas.length === 2));

  const sem = R.jogadasValidas(e, { maioria: false });
  assert.deepEqual(caminhos(sem), [
    cam([7, 0], [3, 4], [1, 2]), cam([7, 0], [3, 4], [0, 1]),
    cam([7, 0], [4, 3]), cam([7, 0], [2, 5]), cam([7, 0], [1, 6]), cam([7, 0], [0, 7]),
  ].sort());
  // pousar em (3,4) e parar não vale: dali ainda dá para capturar
  assert.ok(!caminhos(sem).includes(cam([7, 0], [3, 4])));

  const d = R.aplicar(e, [c(7, 0), c(3, 4), c(0, 1)]);
  assert.equal(d.tab.replace(/\./g, ''), 'B');
});

test('não captura a mesma peça duas vezes', () => {
  // depois de pular (3,4), voltar por cima dela até a origem vazia não vale
  const e = montar([[4, 3, 'b'], [3, 4, 'p']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 1);
  assert.equal(js[0].caminho.join('-'), cam([4, 3], [2, 5]));
  assert.equal(js[0].capturas.length, 1);
});

test('não passa por cima de peça já capturada (ela só sai no fim do lance)', () => {
  // dama em (5,2): pegando (6,1) cai em (7,0), mas (6,1) ainda está lá e bloqueia o caminho até (3,4);
  // pegando (3,4), a volta passa por cima dela de novo. Então o máximo é 1.
  const e = montar([[5, 2, 'B'], [6, 1, 'p'], [3, 4, 'p']]);
  const js = R.jogadasValidas(e, { maioria: false });
  assert.ok(js.length > 0);
  assert.ok(js.every((j) => j.capturas.length === 1));
  assert.ok(js.some((j) => j.caminho.join('-') === cam([5, 2], [7, 0])));
});

test('peças capturadas não liberam casa no meio da sequência', () => {
  // em qualquer sequência: nenhuma peça capturada duas vezes e nenhum pouso em cima de capturada
  const e = montar([[6, 1, 'b'], [5, 2, 'p'], [3, 4, 'p'], [3, 6, 'p'], [5, 6, 'p']]);
  for (const j of R.jogadasValidas(e, { maioria: false })) {
    for (const k of j.caminho.slice(1)) assert.ok(!j.capturas.includes(k));
    assert.equal(new Set(j.capturas).size, j.capturas.length);
  }
});

test('pedra que passa pela última fileira no meio da captura continua pedra', () => {
  // (2,1) pula (1,2) -> (0,3) [última fileira], e continua pulando (1,4) -> (2,5)
  const e = montar([[2, 1, 'b'], [1, 2, 'p'], [1, 4, 'p']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 1);
  assert.equal(js[0].caminho.join('-'), cam([2, 1], [0, 3], [2, 5]));
  assert.equal(js[0].viraDama, false);
  const d = R.aplicar(e, js[0].caminho);
  assert.equal(d.tab[c(2, 5)], 'b');
});

test('pedra que termina o lance na última fileira vira dama', () => {
  // capturando
  const e = montar([[2, 1, 'b'], [1, 2, 'p'], [5, 0, 'p']]);
  const js = R.jogadasValidas(e);
  assert.equal(js.length, 1);
  assert.equal(js[0].caminho.join('-'), cam([2, 1], [0, 3]));
  assert.equal(js[0].viraDama, true);
  assert.equal(R.aplicar(e, js[0].caminho).tab[c(0, 3)], 'B');
  // andando
  const s = montar([[1, 2, 'b'], [5, 0, 'p']]);
  const d = R.aplicar(s, [c(1, 2), c(0, 1)]);
  assert.equal(d.tab[c(0, 1)], 'B');
  // pretas viram dama na linha 7
  const p = montar([[6, 3, 'p'], [0, 1, 'b']], 'p');
  assert.equal(R.aplicar(p, [c(6, 3), c(7, 2)]).tab[c(7, 2)], 'P');
});

test('fim: sem peças', () => {
  const e = montar([[4, 3, 'b'], [3, 4, 'p']]);
  const d = R.aplicar(e, [c(4, 3), c(2, 5)]);
  assert.deepEqual(R.resultado(d), { vencedor: 'b', motivo: 'sem_pecas' });
});

test('fim: sem jogadas', () => {
  // pedra preta (6,1) presa pelas brancas em (7,0) e (7,2)
  const e = montar([[6, 1, 'p'], [7, 0, 'b'], [7, 2, 'b']], 'p');
  assert.equal(R.jogadasValidas(e).length, 0);
  assert.deepEqual(R.resultado(e), { vencedor: 'b', motivo: 'sem_jogadas' });
  assert.equal(R.resultado({ ...e, vez: 'b' }), null);
});

test('empate: 20 lances seguidos só de damas', () => {
  const e = montar([[7, 0, 'B'], [0, 7, 'P']], 'b', R.LIMITE_EMPATE - 1);
  assert.equal(R.resultado(e), null);
  const d = R.aplicar(e, [c(7, 0), c(6, 1)]);
  assert.equal(d.semProgresso, R.LIMITE_EMPATE);
  assert.deepEqual(R.resultado(d), { vencedor: null, motivo: 'empate_20' });
});

test('contador do empate zera com captura ou pedra andando', () => {
  // pedra andando
  const e1 = montar([[7, 0, 'B'], [5, 4, 'b'], [0, 7, 'P']], 'b', 15);
  assert.equal(R.aplicar(e1, [c(5, 4), c(4, 5)]).semProgresso, 0);
  assert.equal(R.aplicar(e1, [c(7, 0), c(6, 1)]).semProgresso, 16);
  // dama capturando
  const e2 = montar([[7, 0, 'B'], [4, 3, 'P'], [0, 1, 'P']], 'b', 15);
  assert.equal(R.aplicar(e2, [c(7, 0), c(3, 4)]).semProgresso, 0);
  // partida começa em 0 mesmo sem o campo
  const e3 = { tab: montar([[7, 0, 'B'], [0, 1, 'P']]).tab, vez: 'b' };
  assert.equal(R.aplicar(e3, [c(7, 0), c(6, 1)]).semProgresso, 1);
});

test('aplicar com caminho inválido lança erro', () => {
  const e = R.estadoInicial();
  assert.throws(() => R.aplicar(e, [c(5, 0), c(3, 2)]), /jogada inválida/);   // longe demais
  assert.throws(() => R.aplicar(e, [c(2, 1), c(3, 0)]), /jogada inválida/);   // peça do outro
  assert.throws(() => R.aplicar(e, [c(6, 1), c(5, 0)]), /jogada inválida/);   // casa ocupada
  assert.throws(() => R.aplicar(e, [c(5, 0)]), /jogada inválida/);
  assert.throws(() => R.aplicar(e, 'qualquer'), /jogada inválida/);
  assert.throws(() => R.aplicar({ tab: 'xx', vez: 'b' }, [0, 4]), /estado inválido/);
  // não muda o estado original
  const antes = JSON.stringify(e);
  R.aplicar(e, R.jogadasValidas(e)[0].caminho);
  assert.equal(JSON.stringify(e), antes);
});

test('partida aleatória inteira termina sem erro e respeita as regras', () => {
  let semente = 12345;
  const sorte = (n) => { semente = (semente * 1103515245 + 12345) % 2147483648; return semente % n; };
  for (let partida = 0; partida < 30; partida++) {
    let e = R.estadoInicial();
    let lances = 0;
    while (!R.resultado(e) && lances < 5000) {
      const js = R.jogadasValidas(e);
      const temCaptura = js.some((j) => j.capturas.length);
      if (temCaptura) assert.ok(js.every((j) => j.capturas.length));
      const total = (t) => [...t].filter((x) => x !== '.').length;
      const j = js[sorte(js.length)];
      const d = R.aplicar(e, j.caminho);
      assert.equal(total(d.tab), total(e.tab) - j.capturas.length);
      e = d;
      lances++;
    }
    assert.ok(R.resultado(e), 'a partida devia ter acabado');
  }
});
