// Testes do api/jogos.js sem internet: um Supabase de mentira (fetch trocado) que faz o mesmo que o
// passo 11 do SQL (versão, status, prazo com 2 s de folga, erros PT409/PT410 viram 409/410).
// Roda com: npm test
const { test, beforeEach } = require('node:test');
const assert = require('node:assert/strict');
const Regras = require('../damas-regras.js');
const handler = require('../api/jogos.js');

const URL_SB = 'https://teste.supabase.co';
const CHAVE = 'sb_secret_teste';
const ID = {
  userA: '00000000-0000-4000-8000-0000000000a1', userB: '00000000-0000-4000-8000-0000000000b1',
  userC: '00000000-0000-4000-8000-0000000000c1', userAdm: '00000000-0000-4000-8000-0000000000d1',
  A: '00000000-0000-4000-8000-00000000000a', B: '00000000-0000-4000-8000-00000000000b',
  C: '00000000-0000-4000-8000-00000000000c',
  partida: '11111111-1111-4111-8111-111111111111', outra: '22222222-2222-4222-8222-222222222222',
};
const TOKENS = { tokA: ID.userA, tokB: ID.userB, tokC: ID.userC, tokAdm: ID.userAdm };
const CONTAS = { [ID.userA]: ID.A, [ID.userB]: ID.B, [ID.userC]: ID.C };

let db;        // "banco" da vez
let chamadas;  // o que o handler pediu ao Supabase

function novaPartida(extra) {
  return Object.assign({
    id: ID.partida, jogo: 'damas', status: 'andamento', brancas: ID.A, pretas: ID.B,
    estado: Regras.estadoInicial(), versao: 0, prazo: new Date(Date.now() + 60000).toISOString(),
    tempos_estourados: {}, vencedor: null, motivo: null,
  }, extra || {});
}

beforeEach(() => {
  process.env.SUPABASE_URL = URL_SB;
  process.env.SUPABASE_SERVICE_ROLE_KEY = CHAVE;
  db = { partidas: { [ID.partida]: novaPartida() }, lances: [], cfg: {}, admins: [ID.userAdm] };
  chamadas = [];
});

const resp = (status, corpo) => ({
  ok: status >= 200 && status < 300, status,
  text: async () => (corpo === undefined ? '' : JSON.stringify(corpo)),
});
const erroPg = (code, message) => resp(Number(code.slice(2)), { code, message, details: null, hint: null });

// ---------- o Supabase de mentira ----------
global.fetch = async (url, op = {}) => {
  const u = new URL(url);
  const h = op.headers || {};
  chamadas.push({ caminho: u.pathname, h });
  assert.equal(u.origin, URL_SB);
  assert.equal(h.apikey, CHAVE, 'toda chamada leva a chave do servidor');

  if (u.pathname === '/auth/v1/user') {
    const tok = String(h.Authorization || '').replace(/^Bearer /, '');
    return TOKENS[tok] ? resp(200, { id: TOKENS[tok] }) : resp(401, { message: 'invalid JWT' });
  }
  // chave secreta nova vai só no apikey
  assert.equal(h.Authorization, undefined);
  const q = (k) => (u.searchParams.get(k) || '').replace(/^eq\./, '');
  if (u.pathname === '/rest/v1/player_contas') {
    const p = CONTAS[q('user_id')];
    return resp(200, p ? [{ player_id: p }] : []);
  }
  if (u.pathname === '/rest/v1/admins') return resp(200, db.admins.includes(q('user_id')) ? [{ user_id: q('user_id') }] : []);
  if (u.pathname === '/rest/v1/jogos_partidas') {
    const p = db.partidas[q('id')];
    return resp(200, p ? [JSON.parse(JSON.stringify(p))] : []);
  }
  const a = op.body ? JSON.parse(op.body) : {};
  if (u.pathname === '/rest/v1/rpc/jogos_cfg') return resp(200, Object.assign({}, { tempo_jogada: 60, ao_acabar_tempo: 'perde_partida', maioria_obrigatoria: true, convite_expira: 60 }, db.cfg));
  if (u.pathname === '/rest/v1/rpc/jogos_gravar_lance') {
    const p = db.partidas[a.p_partida];
    if (!p) return erroPg('PT404', 'partida não encontrada');
    if (p.status !== 'andamento') return erroPg('PT409', 'a partida já acabou');
    if (p.versao !== a.p_versao) return erroPg('PT409', 'desatualizado');
    if (Date.parse(p.prazo) < Date.now() - 2000) return erroPg('PT410', 'tempo esgotado');
    const quem = p.estado.vez === 'b' ? p.brancas : p.pretas;
    db.lances.push({ partida: p.id, n: p.versao + 1, player: quem, ...a.p_lance });
    p.estado = a.p_novo_estado; p.versao += 1;
    p.prazo = new Date(Date.now() + 60000).toISOString();
    if (a.p_fim) {
      p.status = 'fim'; p.motivo = a.p_fim.motivo; p.prazo = null;
      p.vencedor = a.p_fim.vencedor === 'b' ? p.brancas : a.p_fim.vencedor === 'p' ? p.pretas : null;
      return resp(200, { versao: p.versao, status: 'fim' });
    }
    return resp(200, { versao: p.versao, status: 'andamento', prazo: p.prazo });
  }
  if (u.pathname === '/rest/v1/rpc/jogos_aplicar_tempo') {
    assert.equal(a.p_folga, '2 seconds');
    const p = db.partidas[a.p_partida];
    if (!p || p.status !== 'andamento' || !(Date.parse(p.prazo) < Date.now() - 2000)) return resp(200, false);
    p.status = 'fim'; p.motivo = 'tempo'; p.prazo = null;
    p.vencedor = p.estado.vez === 'b' ? p.pretas : p.brancas;
    return resp(200, true);
  }
  throw new Error('chamada inesperada: ' + u.pathname);
};

// ---------- chamar o handler como a Vercel chama ----------
async function api(corpo, token, metodo = 'POST') {
  const req = { method: metodo, headers: token ? { authorization: `Bearer ${token}` } : {}, body: corpo };
  const out = { status: 0, corpo: null, cab: {} };
  const res = {
    setHeader(k, v) { out.cab[k] = v; },
    status(s) { out.status = s; return this; },
    json(c) { out.corpo = c; return this; },
    end() { return this; },
  };
  await handler(req, res);
  return out;
}
const jogar = (token, caminho, versao = db.partidas[ID.partida].versao, partida = ID.partida) =>
  api({ acao: 'jogar', partida, versao, caminho }, token);
const tokDaVez = () => (db.partidas[ID.partida].estado.vez === 'b' ? 'tokA' : 'tokB');

// ---------- testes ----------
test('partida inteira só pela API, até o fim', async () => {
  let n = 0;
  while (db.partidas[ID.partida].status === 'andamento') {
    const p = db.partidas[ID.partida];
    const jogadas = Regras.jogadasValidas(p.estado, { maioria: true });
    // alterna entre a primeira e a última jogada válida pra partida andar
    const j = jogadas[n % 2 ? jogadas.length - 1 : 0];
    const r = await jogar(tokDaVez(), j.caminho);
    assert.equal(r.status, 200, JSON.stringify(r.corpo));
    assert.equal(r.corpo.versao, n + 1);
    assert.deepEqual(r.corpo.estado, db.partidas[ID.partida].estado);
    n++;
    assert.ok(n < 500, 'a partida tem que acabar');
  }
  const p = db.partidas[ID.partida];
  assert.equal(p.status, 'fim');
  assert.equal(db.lances.length, n);
  assert.deepEqual(db.lances.map((l) => l.n), Array.from({ length: n }, (_, k) => k + 1));
  const fim = Regras.resultado(p.estado);
  assert.ok(fim, 'o estado final tem resultado');
  assert.equal(p.motivo, fim.motivo);
  // depois do fim, nada mais entra
  const r = await jogar('tokA', [21, 17]);
  assert.equal(r.status, 409);
});

test('jogada válida devolve estado, versão e o lance', async () => {
  const r = await jogar('tokA', [21, 17]);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.versao, 1);
  assert.equal(r.corpo.status, 'andamento');
  assert.equal(r.corpo.estado.vez, 'p');
  assert.deepEqual(r.corpo.lance, { caminho: [21, 17], capturas: [], viraDama: false });
  assert.equal(r.corpo.fim, null);
  assert.equal(db.lances[0].player, ID.A);
  assert.equal(r.cab['Cache-Control'], 'no-store');
});

test('jogada inválida: 400 e nada muda', async () => {
  for (const c of [[21, 13], [21, 25], [10, 14], [21], 'x', [21, 99], [21.5, 17]]) {
    const r = await jogar('tokA', c);
    assert.equal(r.status, 400, `caminho ${JSON.stringify(c)}`);
  }
  assert.equal(db.partidas[ID.partida].versao, 0);
  assert.equal(db.lances.length, 0);
});

test('fora da vez: 403', async () => {
  const r = await jogar('tokB', [9, 13]);
  assert.equal(r.status, 403);
  assert.match(r.corpo.erro, /vez/);
});

test('quem não está na partida: 403', async () => {
  const r = await jogar('tokC', [21, 17]);
  assert.equal(r.status, 403);
});

test('jogada repetida / versão velha: 409', async () => {
  assert.equal((await jogar('tokA', [21, 17], 0)).status, 200);
  const r = await jogar('tokA', [21, 17], 0);
  assert.equal(r.status, 409);
  assert.equal(db.lances.length, 1);
});

test('dois envios ao mesmo tempo: só um entra', async () => {
  const [r1, r2] = await Promise.all([jogar('tokA', [21, 17], 0), jogar('tokA', [22, 17], 0)]);
  assert.deepEqual([r1.status, r2.status].sort(), [200, 409]);
  assert.equal(db.lances.length, 1);
  assert.equal(db.partidas[ID.partida].versao, 1);
});

test('tempo esgotado: 410 e a partida já fecha', async () => {
  db.partidas[ID.partida].prazo = new Date(Date.now() - 3000).toISOString();
  const r = await jogar('tokA', [21, 17]);
  assert.equal(r.status, 410);
  assert.equal(db.partidas[ID.partida].status, 'fim');
  assert.equal(db.partidas[ID.partida].vencedor, ID.B);
});

test('dentro dos 2 s de folga a jogada ainda vale', async () => {
  db.partidas[ID.partida].prazo = new Date(Date.now() - 1000).toISOString();
  assert.equal((await jogar('tokA', [21, 17])).status, 200);
});

test('captura obrigatória e lei da maioria seguem a configuração do banco', async () => {
  // brancas em 21 e 22; pretas em 17 (1 peça) e em 18 + 10 (2 peças em sequência pra 22)
  const tab = Array(32).fill('.');
  tab[21] = 'b'; tab[22] = 'b'; tab[17] = 'p'; tab[18] = 'p'; tab[10] = 'p'; tab[0] = 'p';
  const estado = { tab: tab.join(''), vez: 'b', semProgresso: 0 };
  const todas = Regras.jogadasValidas(estado, { maioria: false });
  const maior = Math.max(...todas.map((j) => j.capturas.length));
  const menor = todas.find((j) => j.capturas.length < maior);
  assert.ok(menor, 'o cenário tem uma captura menor');

  db.partidas[ID.partida].estado = estado;
  assert.equal((await jogar('tokA', menor.caminho)).status, 400, 'maioria ligada: a menor não vale');
  assert.ok(Regras.jogadasValidas({ tab: estado.tab.replace(/p/g, '.'), vez: 'b' }).some((j) => j.caminho.join() === '21,16'));
  assert.equal((await jogar('tokA', [21, 16])).status, 400, 'havendo captura, andar não vale');

  db.cfg.maioria_obrigatoria = false;
  const r = await jogar('tokA', menor.caminho);
  assert.equal(r.status, 200, 'maioria desligada: a menor vale');
  assert.deepEqual(r.corpo.lance.capturas, menor.capturas);
});

test('vitória fecha a partida com o vencedor certo', async () => {
  const tab = Array(32).fill('.');
  tab[21] = 'b'; tab[17] = 'p';   // brancas capturam a última preta
  db.partidas[ID.partida].estado = { tab: tab.join(''), vez: 'b', semProgresso: 0 };
  const [j] = Regras.jogadasValidas(db.partidas[ID.partida].estado);
  const r = await jogar('tokA', j.caminho);
  assert.equal(r.status, 200);
  assert.equal(r.corpo.status, 'fim');
  assert.deepEqual(r.corpo.fim, { vencedor: 'b', motivo: 'sem_pecas' });
  assert.equal(db.partidas[ID.partida].vencedor, ID.A);
});

test('login: sem token 401, token falso 401, sem jogador 403', async () => {
  assert.equal((await jogar(null, [21, 17])).status, 401);
  assert.equal((await jogar('falso', [21, 17])).status, 401);
  assert.equal((await jogar('tokAdm', [21, 17])).status, 403);
});

test('pedido malformado', async () => {
  assert.equal((await api({ acao: 'jogar', partida: ID.partida, versao: 0, caminho: [21, 17] }, 'tokA', 'GET')).status, 405);
  assert.equal((await api({ acao: 'outra', partida: ID.partida }, 'tokA')).status, 400);
  assert.equal((await api({ acao: 'jogar', partida: 'abc', versao: 0, caminho: [21, 17] }, 'tokA')).status, 400);
  assert.equal((await api({ acao: 'jogar', partida: ID.partida, caminho: [21, 17] }, 'tokA')).status, 400);
  assert.equal((await api('{não é json', 'tokA')).status, 400);
  const s = await api(JSON.stringify({ acao: 'jogar', partida: ID.partida, versao: 0, caminho: [21, 17] }), 'tokA');
  assert.equal(s.status, 200, 'corpo em texto também vale');
});

test('partida que não existe: 404', async () => {
  assert.equal((await jogar('tokA', [21, 17], 0, ID.outra)).status, 404);
});

test('tempo: antes do prazo não muda nada; depois, fecha', async () => {
  let r = await api({ acao: 'tempo', partida: ID.partida }, 'tokC');   // espectador do clã
  assert.equal(r.status, 200);
  assert.equal(r.corpo.mudou, false);
  assert.equal(r.corpo.status, 'andamento');

  db.partidas[ID.partida].prazo = new Date(Date.now() - 2500).toISOString();
  r = await api({ acao: 'tempo', partida: ID.partida }, 'tokAdm');      // admin sem jogador também pode
  assert.equal(r.status, 200);
  assert.equal(r.corpo.mudou, true);
  assert.equal(r.corpo.status, 'fim');

  assert.equal((await api({ acao: 'tempo', partida: ID.partida }, 'falso')).status, 401);
  assert.equal((await api({ acao: 'tempo', partida: ID.outra }, 'tokA')).status, 404);
});

test('tempo: quem não é do clã não pode', async () => {
  db.admins = [];
  assert.equal((await api({ acao: 'tempo', partida: ID.partida }, 'tokAdm')).status, 403);
});

test('sem a chave na Vercel: 503 e não chama o Supabase', async () => {
  delete process.env.SUPABASE_SERVICE_ROLE_KEY;
  const r = await jogar('tokA', [21, 17]);
  assert.equal(r.status, 503);
  assert.match(r.corpo.erro, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.equal(chamadas.length, 0);
});

test('chave antiga (JWT service_role) também vai no Authorization', async () => {
  const velha = 'eyJhbGciOiJIUzI1NiJ9.teste.assinatura';
  process.env.SUPABASE_SERVICE_ROLE_KEY = velha;
  const orig = global.fetch;
  const vistos = [];
  global.fetch = async (url, op = {}) => {
    vistos.push(op.headers || {});
    return /auth\/v1\/user/.test(url) ? resp(200, { id: ID.userA }) : resp(200, []);
  };
  let r;
  try {
    r = await jogar('tokA', [21, 17]);
  } finally { global.fetch = orig; }
  assert.equal(r.status, 403);
  assert.equal(vistos[0].Authorization, 'Bearer tokA', 'auth/v1/user leva o login do jogador');
  assert.equal(vistos[0].apikey, velha);
  assert.equal(vistos[1].Authorization, `Bearer ${velha}`, 'no banco vai a chave do servidor');
});
