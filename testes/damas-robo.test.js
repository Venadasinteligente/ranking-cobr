// Testes do robô da damas (análise do replay). Rodar: npm test
const { test } = require('node:test');
const assert = require('node:assert/strict');
const R = require('../damas-regras.js');
const Robo = require('../damas-robo.js');

// sorteio com semente (o teste sai sempre igual)
function sorteador(s) {
  return () => { s = (s + 0x6d2b79f5) | 0; let z = s; z = Math.imul(z ^ (z >>> 15), z | 1); z ^= z + Math.imul(z ^ (z >>> 7), z | 61); return ((z ^ (z >>> 14)) >>> 0) / 4294967296; };
}
const chave = (js) => js.map((j) => `${j.caminho.join('-')}|${[...j.capturas].sort((a, b) => a - b).join(',')}|${j.viraDama ? 1 : 0}`).sort();
function montar(pecas, vez = 'b') {
  const tab = Array(32).fill('.');
  for (const [lin, col, p] of pecas) tab[R.casa(lin, col)] = p;
  return { tab: tab.join(''), vez, semProgresso: 0 };
}
const cor = (vez) => (vez === 'b' ? 1 : -1);

test('gera exatamente os mesmos lances das regras, em milhares de posições de partidas sorteadas', () => {
  const sorte = sorteador(7);
  let vistas = 0, comDama = 0, capturasMultiplas = 0;
  for (let partida = 0; partida < 260; partida++) {
    let e = R.estadoInicial();
    for (let lance = 0; lance < 160; lance++) {
      for (const maioria of [true, false]) {
        const certo = R.jogadasValidas(e, { maioria });
        const robo = Robo.gerar(Robo.deTexto(e.tab), cor(e.vez), maioria);
        assert.deepEqual(chave(robo), chave(certo), `posição ${e.tab} vez ${e.vez} maioria ${maioria}`);
      }
      vistas++;
      if (/[BP]/.test(e.tab)) comDama++;
      const js = R.jogadasValidas(e);
      if (!js.length || R.resultado(e)) break;
      if (js[0].capturas.length >= 2) capturasMultiplas++;
      e = R.aplicar(e, js[Math.floor(sorte() * js.length)].caminho);
    }
  }
  assert.ok(vistas > 8000, `só ${vistas} posições`);
  assert.ok(comDama > 1000, `poucas posições com dama (${comDama})`);
  assert.ok(capturasMultiplas > 100, `poucas capturas múltiplas (${capturasMultiplas})`);
});

test('fazer e desfazer voltam o tabuleiro igualzinho', () => {
  const sorte = sorteador(3);
  let e = R.estadoInicial();
  for (let i = 0; i < 400; i++) {
    const t = Robo.deTexto(e.tab), antes = Robo.paraTexto(t);
    for (const m of Robo.gerar(t, cor(e.vez))) {
      Robo.fazer(t, m);
      assert.equal(Robo.paraTexto(t), R.aplicar(e, m.caminho).tab);
      Robo.desfazer(t, m);
      assert.equal(Robo.paraTexto(t), antes);
    }
    const js = R.jogadasValidas(e);
    if (!js.length || R.resultado(e)) e = R.estadoInicial();
    else e = R.aplicar(e, js[Math.floor(sorte() * js.length)].caminho);
  }
});

test('acha o golpe: entrega uma pedra pra comer duas de volta', () => {
  // 4×4. Brancas jogam d4-c5: a preta b6 é obrigada a comer (b6xd4) e a branca e3 come duas (e3xc5xe7)
  const e = montar([[4, 3, 'b'], [5, 4, 'b'], [6, 5, 'b'], [4, 1, 'b'], [2, 1, 'p'], [2, 3, 'p'], [0, 7, 'p'], [1, 6, 'p']], 'b');
  const { lances, notas } = Robo.pensar(Robo.deTexto(e.tab), 1, { nos: 60000 });
  const mi = notas.indexOf(Math.max(...notas));
  const melhor = lances[mi];
  assert.equal(melhor.caminho.map(R.nomeCasa).join('-'), 'd4-c5');
  // confere a ideia com as regras: depois do lance a preta é obrigada a comer
  const resp = R.jogadasValidas(R.aplicar(e, melhor.caminho));
  assert.ok(resp.length && resp[0].capturas.length > 0);
  assert.ok(notas[mi] > 100, `nota baixa pro golpe: ${notas[mi]}`);
  // na análise da partida esse lance sai como brilhante
  const r = Robo.analisarPartida([{ caminho: melhor.caminho, capturas: [], virou_dama: false }], { nos: 60000, indices: [0], inicio: e })[0];
  assert.equal(r.sac, true);
  assert.equal(Robo.classificar(r, { caminho: melhor.caminho }).tipo, 'brilhante');
});

test('vê que ficar sem lance é derrota e prefere ganhar logo', () => {
  // dama branca come a última preta: vitória na hora
  const e = montar([[7, 0, 'B'], [5, 2, 'p']], 'b');
  const { lances, notas } = Robo.pensar(Robo.deTexto(e.tab), 1);
  assert.ok(lances.every((m) => m.capturas.length === 1));
  assert.ok(Math.max(...notas) > Robo.MATE - 10);
});

test('analisa uma partida inteira: nota de cada lance, precisão e lance que o robô não reconhece', () => {
  const sorte = sorteador(11);
  let e = R.estadoInicial();
  const lances = [];
  for (let i = 0; i < 40; i++) {
    const js = R.jogadasValidas(e);
    if (!js.length || R.resultado(e)) break;
    const j = js[Math.floor(sorte() * js.length)];
    lances.push({ caminho: j.caminho, capturas: j.capturas, virou_dama: j.viraDama });
    e = R.aplicar(e, j.caminho);
  }
  assert.equal(Robo.conferir(lances), -1);
  const ps = Robo.posicoes(lances);
  assert.equal(Robo.paraTexto(ps[ps.length - 1].t), e.tab);
  const res = Robo.analisarPartida(lances, { nos: 4000 });
  assert.equal(Object.keys(res).length, lances.length + 1);
  const notas = lances.map((l, k) => Robo.classificar(res[k], l));
  assert.ok(notas.every((x) => x && Robo.TIPOS.includes(x.tipo)), JSON.stringify(notas));
  const pb = Robo.precisao(notas, 1), pp = Robo.precisao(notas, -1);
  assert.ok(pb >= 0 && pb <= 100 && pp >= 0 && pp <= 100);
  // lance trocado: o robô avisa qual não reconhece
  const errado = lances.map((l) => ({ ...l }));
  errado[3] = { caminho: [0, 31], capturas: [], virou_dama: false };
  assert.equal(Robo.conferir(errado), 3);
  // perdeu a vez (tempo) não tem nota de precisão
  assert.deepEqual(Robo.classificar({}, { caminho: [] }), { tipo: 'tempo', perda: 0 });
});

test('a nota não depende do aparelho: mesma análise duas vezes dá o mesmo resultado', () => {
  const lances = [];
  let e = R.estadoInicial();
  const sorte = sorteador(5);
  for (let i = 0; i < 16; i++) {
    const js = R.jogadasValidas(e);
    const j = js[Math.floor(sorte() * js.length)];
    lances.push({ caminho: j.caminho, capturas: j.capturas, virou_dama: j.viraDama });
    e = R.aplicar(e, j.caminho);
  }
  const a = Robo.analisarPartida(lances, { nos: 20000, indices: [4, 9, 15] });
  const b = Robo.analisarPartida(lances, { nos: 20000, indices: [15, 9, 4] });
  assert.deepEqual(a, b);
});
