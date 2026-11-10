// Confere e grava as jogadas da Sala de jogos (passo 11 do SQL). O site manda a jogada aqui com o
// login do jogador; as regras do damas-regras.js dizem se vale; quem grava é o banco
// (jogos_gravar_lance, que só a chave service_role chama). Sem dependências: só fetch.
//
//   POST /api/jogos   Authorization: Bearer <access_token do login>
//   { "acao": "jogar", "partida": "<id>", "versao": 12, "caminho": [9, 13] }
//   { "acao": "tempo", "partida": "<id>" }       -> o relógio zerou: o banco confere e aplica
//
// Respostas: 200 {estado, versao, ...} · 400 jogada inválida · 401 sem login · 403 não é sua vez ·
//            404 partida não encontrada · 409 desatualizado / acabou · 410 tempo esgotado
//
// Variáveis na Vercel: SUPABASE_SERVICE_ROLE_KEY (Supabase > Project Settings > API Keys > secret)
// e, se um dia trocar de projeto, SUPABASE_URL. A chave secreta NUNCA vai para o repositório.
const Regras = require('../damas-regras.js');

const URL_PADRAO = 'https://gntibfbrdplmbdgdreeq.supabase.co';
const PADRAO_CFG = { tempo_jogada: 60, ao_acabar_tempo: 'perde_partida', maioria_obrigatoria: true, convite_expira: 60 };
const FOLGA_MS = 2000;   // igual aos 2 s de tolerância do jogos_gravar_lance
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

class Erro extends Error {
  constructor(status, msg) { super(msg); this.status = status; }
}

function ambiente() {
  const url = String(process.env.SUPABASE_URL || URL_PADRAO).replace(/\/+$/, '');
  const chave = String(process.env.SUPABASE_SERVICE_ROLE_KEY || '').trim();
  if (!chave) throw new Erro(503, 'Servidor sem a chave SUPABASE_SERVICE_ROLE_KEY');
  return { url, chave };
}

// cabeçalhos com a chave do servidor. A "secret" nova (sb_secret_...) vai só no apikey;
// a antiga (service_role, um JWT) vai também no Authorization.
function cabServidor(chave) {
  const h = { apikey: chave, 'Content-Type': 'application/json' };
  if (/^eyJ/.test(chave)) h.Authorization = `Bearer ${chave}`;
  return h;
}

async function lerJson(r) {
  const t = await r.text();
  try { return t ? JSON.parse(t) : null; } catch (e) { return null; }
}

async function rest(amb, caminho) {
  const r = await fetch(`${amb.url}/rest/v1/${caminho}`, { headers: cabServidor(amb.chave) });
  if (!r.ok) throw new Erro(502, 'Falha ao ler o banco');
  return (await lerJson(r)) || [];
}

async function rpc(amb, funcao, args) {
  const r = await fetch(`${amb.url}/rest/v1/rpc/${funcao}`, {
    method: 'POST', headers: cabServidor(amb.chave), body: JSON.stringify(args || {}),
  });
  const corpo = await lerJson(r);
  if (!r.ok) {
    // os erros PT404 / PT409 / PT410 do banco chegam com esse mesmo número
    if ([404, 409, 410].includes(r.status)) throw new Erro(r.status, (corpo && corpo.message) || 'Recusado');
    throw new Erro(502, 'Falha ao gravar no banco');
  }
  return corpo;
}

// quem está logado: usuário do Supabase -> jogador do clã
async function quemE(amb, token) {
  if (!token) throw new Erro(401, 'Entre no site pra jogar');
  const r = await fetch(`${amb.url}/auth/v1/user`, { headers: { apikey: amb.chave, Authorization: `Bearer ${token}` } });
  if (r.status >= 500) throw new Erro(502, 'Falha ao conferir o login');
  const u = r.ok ? await lerJson(r) : null;
  if (!u || !UUID.test(String(u.id || ''))) throw new Erro(401, 'Login vencido: entre de novo');
  const [conta] = await rest(amb, `player_contas?user_id=eq.${u.id}&select=player_id`);
  return { userId: u.id, player: conta ? conta.player_id : null };
}

async function lerPartida(amb, id) {
  const [p] = await rest(amb, `jogos_partidas?id=eq.${id}&select=id,jogo,status,brancas,pretas,estado,versao,prazo`);
  if (!p) throw new Erro(404, 'Partida não encontrada');
  return p;
}

function conferirCaminho(c) {
  return Array.isArray(c) && c.length >= 2 && c.length <= 20 && c.every((x) => Number.isInteger(x) && x >= 0 && x <= 31);
}

async function jogar(amb, eu, b) {
  if (!Number.isInteger(b.versao) || b.versao < 0) throw new Erro(400, 'Falta a versão da partida');
  if (!conferirCaminho(b.caminho)) throw new Erro(400, 'Jogada inválida');
  if (!eu.player) throw new Erro(403, 'Só jogador do clã com login pode jogar');

  const [p, cfgBanco] = await Promise.all([lerPartida(amb, b.partida), rpc(amb, 'jogos_cfg')]);
  const cfg = Object.assign({}, PADRAO_CFG, cfgBanco || {});
  if (p.status !== 'andamento') throw new Erro(409, 'A partida já acabou');
  if (eu.player !== p.brancas && eu.player !== p.pretas) throw new Erro(403, 'Você não está nessa partida');
  if (p.versao !== b.versao) throw new Erro(409, 'Desatualizado: o tabuleiro mudou');
  const minhaCor = eu.player === p.brancas ? 'b' : 'p';
  if (!p.estado || p.estado.vez !== minhaCor) throw new Erro(403, 'Não é sua vez');
  if (p.prazo && Date.now() > Date.parse(p.prazo) + FOLGA_MS) {
    // já fecha a partida (ou passa a vez) em vez de esperar o pg_cron
    await rpc(amb, 'jogos_aplicar_tempo', { p_partida: p.id, p_folga: '2 seconds' }).catch(() => {});
    throw new Erro(410, 'Tempo esgotado');
  }

  const opcoes = { maioria: cfg.maioria_obrigatoria !== false };
  const jogada = Regras.jogadasValidas(p.estado, opcoes)
    .find((j) => j.caminho.length === b.caminho.length && j.caminho.every((x, k) => x === b.caminho[k]));
  if (!jogada) throw new Erro(400, 'Jogada inválida');
  const estado = Regras.aplicar(p.estado, jogada.caminho, opcoes);
  const fim = Regras.resultado(estado);

  const r = await rpc(amb, 'jogos_gravar_lance', {
    p_partida: p.id,
    p_versao: p.versao,
    p_novo_estado: estado,
    p_lance: { caminho: jogada.caminho, capturas: jogada.capturas, virou_dama: jogada.viraDama },
    p_fim: fim,
  });
  return {
    estado,
    versao: r.versao,
    status: r.status,
    prazo: r.prazo || null,
    fim,
    lance: { caminho: jogada.caminho, capturas: jogada.capturas, viraDama: jogada.viraDama },
  };
}

// o relógio zerou: qualquer membro do clã avisa, o banco confere a hora (2 s de folga)
async function tempo(amb, eu, b) {
  if (!eu.player) {
    const [adm] = await rest(amb, `admins?user_id=eq.${eu.userId}&select=user_id`);
    if (!adm) throw new Erro(403, 'Só quem é do clã');
  }
  const mudou = await rpc(amb, 'jogos_aplicar_tempo', { p_partida: b.partida, p_folga: '2 seconds' });
  const p = await lerPartida(amb, b.partida);
  return { mudou: mudou === true, status: p.status, estado: p.estado, versao: p.versao, prazo: p.prazo };
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  if (req.method !== 'POST') return res.status(405).json({ erro: 'Use POST' });
  try {
    let b = req.body || {};
    if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = {}; } }
    if (b.acao !== 'jogar' && b.acao !== 'tempo') throw new Erro(400, 'Ação desconhecida');
    if (!UUID.test(String(b.partida || ''))) throw new Erro(400, 'Partida inválida');
    const amb = ambiente();
    const m = /^Bearer\s+(\S+)$/i.exec(String(req.headers.authorization || ''));
    const eu = await quemE(amb, m ? m[1] : '');
    const r = b.acao === 'jogar' ? await jogar(amb, eu, b) : await tempo(amb, eu, b);
    return res.status(200).json(r);
  } catch (e) {
    if (e instanceof Erro) return res.status(e.status).json({ erro: e.message });
    return res.status(500).json({ erro: 'Erro no servidor' });
  }
};
