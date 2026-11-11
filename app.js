// Ranking do clã — lógica do site. Não precisa mexer aqui;
// as configurações ficam no config.js.
(() => {
  'use strict';

  const CFG = window.RANKING_CONFIG || {};
  const TAG = (CFG.CLAN_TAG || 'COBR').trim();
  const PRINT_OBRIGATORIO = CFG.PRINT_OBRIGATORIO !== false;
  const configurado = !!CFG.SUPABASE_URL && !!CFG.SUPABASE_KEY &&
    !CFG.SUPABASE_URL.includes('COLE_AQUI') && !CFG.SUPABASE_KEY.includes('COLE_AQUI');
  const DEMO = !configurado;
  const BUCKET = 'prints';
  const MASSA_MIN = 10;
  const MASSA_MAX = 1000000;
  const $ = (id) => document.getElementById(id);
  let sb = null;
  let partidas = [];          // todas as pontuações, mais novas primeiro
  let periodo = 'mes';        // abre na temporada (mês atual)
  let modo = CFG.RANKING_POR === 'massa' ? 'massa' : 'pontos';
  let admin = null;           // { nome } quando quem está usando é admin (login do Supabase)
  let euId = null;            // id no elenco do jogador logado (login de jogador ou admin ligado ao jogador)
  let souAmigo = false;       // a conta é de amigo (não é do clã, o Dono aceitou só pra jogar): o site mostra só os jogos
  let logins = new Map();     // só pro admin: id do jogador -> { email, admin, ultimo_acesso }
  let arquivoPrint = null;
  let jogadores = [];         // elenco do clã (tabela players)
  let amigos = [];            // amigos (players.amigo): jogam na sala de jogos, mas não são do clã (fora do ranking e do elenco)
  let elenco = new Map();     // chave do nick -> jogador do elenco
  let elencoOk = true;        // false se a tabela players ainda não existe no banco
  let jogPorId = new Map();   // id do elenco -> jogador (torneios guardam o id, não o nick)
  let torneios = [];          // tabela torneios (rascunho só vem pra admin)
  let lancamentos = [];       // resultados lançados na mão nos torneios (kills, massa extra...)
  let damasFins = [];         // partidas de damas terminadas (id, brancas, pretas, vencedor, fim), da mais velha pra mais nova
  let torneiosOk = true;      // false se as tabelas de torneio ainda não existem no banco
  let torneioAtual = null;    // id do torneio aberto na página própria
  let vitrineOk = true;       // false se a coluna players.vitrine ainda não existe no banco
  let paredeOk = true;        // false se a coluna players.parede ainda não existe no banco
  const CARGOS = (Array.isArray(CFG.CARGOS) && CFG.CARGOS.length ? CFG.CARGOS : ['Líder', 'Vice-líder', 'Membro'])
    .map((c) => String(c).trim().slice(0, 24)).filter(Boolean);
  const CARGO_PADRAO = CARGOS.includes('Membro') ? 'Membro' : CARGOS[CARGOS.length - 1];

  // ---------- utilidades ----------
  const fmt = (n) => Number(n).toLocaleString('pt-BR');
  const dataCurta = (iso) => new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  const rtf = new Intl.RelativeTimeFormat('pt-BR', { numeric: 'auto' });
  function haQuanto(iso) {
    const s = (new Date(iso).getTime() - Date.now()) / 1000;
    const a = Math.abs(s);
    if (a < 60) return 'agora';
    if (a < 3600) return rtf.format(Math.round(s / 60), 'minute');
    if (a < 86400) return rtf.format(Math.round(s / 3600), 'hour');
    if (a < 86400 * 30) return rtf.format(Math.round(s / 86400), 'day');
    return dataCurta(iso);
  }
  // dia em que a partida entrou, sem hora: o horário do registro não aparece pra ninguém
  function diaTxt(iso) {
    const d = new Date(iso).toDateString();
    if (d === new Date().toDateString()) return 'hoje';
    return d === new Date(Date.now() - 86400000).toDateString() ? 'ontem' : dataCurta(iso);
  }
  const reTag = new RegExp('^\\[?\\s*' + TAG.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '\\s*\\]?\\s*', 'i');
  const limparNick = (v) => String(v || '').replace(reTag, '').replace(/\s+/g, ' ').trim().slice(0, 24);
  const chave = (nome) => limparNick(nome).toLocaleLowerCase('pt-BR');
  const comTag = (nome) => `[${TAG}] ${nome}`;
  function indexarElenco() {
    elenco = new Map(jogadores.map((r) => [chave(r.nick), r]));
    jogPorId = new Map([...jogadores, ...amigos].map((r) => [r.id, r])); // os jogos acham o nick do amigo pelo id
  }
  const exMembro = (k) => { const r = elenco.get(k); return !!r && !r.ativo; };
  const nomeDe = (k, bruto) => (elenco.get(k) ? elenco.get(k).nick : limparNick(bruto));
  // pra busca: sem acento e sem maiúscula ("Grão" acha com "grao")
  const busca = (v) => chave(v).normalize('NFD').replace(/[̀-ͯ]/g, '');

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
  // replaceChildren que ignora os vazios (null vira texto "null" no replaceChildren puro)
  function trocar(box, ...filhos) { box.replaceChildren(...filhos.flat().filter((f) => f != null && f !== false)); }
  function svg(path, size = 20, extra = '') {
    const w = document.createElement('span');
    w.innerHTML = `<svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" ${extra}>${path}</svg>`;
    return w.firstChild;
  }
  const ICONE_COROA = '<path d="M3 8l4 4 5-7 5 7 4-4-2 11H5L3 8z"/>';
  const ICONE_TROFEU = '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0V4z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>';
  const ICONE_MEDALHA = '<path d="M7.5 3h9M7.5 3l3.5 6.3M16.5 3L13 9.3"/><circle cx="12" cy="15" r="6"/><circle cx="12" cy="15" r="2.5"/>';
  const ICONE_LIXO = '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>';

  let toastTimer;
  function toast(msg, ruim = false) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.toggle('ruim', ruim);
    t.hidden = false;
    // por cima de qualquer janela aberta (senão o aviso fica escondido atrás dela)
    if (t.showPopover) { try { if (t.matches(':popover-open')) t.hidePopover(); t.showPopover(); } catch (e) {} }
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => {
      t.hidden = true;
      if (t.hidePopover) { try { t.hidePopover(); } catch (e) {} }
    }, 3800);
  }
  function urlPrint(p) {
    if (p.print_url) return p.print_url;
    if (!p.print_path || !sb) return null;
    return sb.storage.from(BUCKET).getPublicUrl(p.print_path).data.publicUrl;
  }

  // ---------- cálculo do ranking ----------
  // base = instante de referência (o torneio "hora H" olha o ranking como estava naquela hora)
  function inicioPeriodo(per, base = Date.now()) {
    const d = new Date(base);
    d.setHours(0, 0, 0, 0);
    if (per === 'semana') { const dia = (d.getDay() + 6) % 7; d.setDate(d.getDate() - dia); return d.getTime(); }
    if (per === 'mes') { d.setDate(1); return d.getTime(); }
    return 0;
  }

  // ---------- pontos ----------
  // 1 ponto a cada 1.000 de massa + bônus a cada meta batida (100K, 200K ... 1M).
  // O bônus cresce: 1ª meta +30, 2ª +40, 3ª +50...
  const MARCO = Number(CFG.MARCO) || 100000;
  const REGRA = CFG.PONTOS && !Array.isArray(CFG.PONTOS) ? CFG.PONTOS : {};
  const num = (v, padrao) => (v != null && isFinite(v) ? Number(v) : padrao);
  const POR_MIL = num(REGRA.POR_MIL, 1);
  const META = Number(REGRA.META) || 100000;
  const BONUS_META = num(REGRA.BONUS_META, 30);
  const BONUS_SOBE = num(REGRA.BONUS_SOBE, 10);
  const bonusDaMeta = (n) => BONUS_META + (n - 1) * BONUS_SOBE; // bônus da n-ésima meta
  function detalhePontos(massa) {
    const base = Math.floor(massa / 1000) * POR_MIL;
    const metas = Math.floor(massa / META);
    const bonus = metas * BONUS_META + BONUS_SOBE * metas * (metas - 1) / 2;
    return { base, metas, bonus, total: base + bonus };
  }
  const pontosDe = (massa) => detalhePontos(massa).total;
  const marcoTxt = fmtK(MARCO) + '+';
  function fmtK(n) {
    if (n >= 1e6 && n % 1e6 === 0) return `${n / 1e6}M`;
    return n >= 1000 && n % 1000 === 0 ? `${n / 1000}K` : fmt(n);
  }
  const ptsTxt = (n) => `${fmt(n)} ${n === 1 ? 'pt' : 'pts'}`;

  // ---------- leitura da massa ----------
  // Aceita do jeito que o pessoal escreve: 52430, 52.430, 52 430, 52 mil, 52k, 52,4k, 1 milhão.
  // Devolve { valor } ou { vazio | erro | decimal } e, se o número parecer curto demais, { pequeno, sugestao }.
  const SUFIXOS = [
    [/(milhoes|milhões|milhao|milhão|mi|kk)$/, 1e6],
    [/(mil|k)$/, 1e3],
    [/m$/, 0], // "m" sozinho: mil ou milhão, decide pelo tamanho
  ];
  function lerMassa(txt) {
    let s = String(txt || '').toLowerCase().replace(/\s+/g, '').replace(/(de)?massa$/, '');
    if (!s) return { vazio: true };
    let mult = 1;
    for (const [re, m] of SUFIXOS) if (re.test(s)) { s = s.replace(re, ''); mult = m; break; }
    if (!/^\d[\d.,]*$/.test(s) || /[.,]$/.test(s)) return { erro: true };
    let valor;
    if (mult !== 1) {
      // com "mil"/"k": vírgula ou ponto é casa decimal (52,4k = 52.400)
      if ((s.match(/[.,]/g) || []).length > 1) return { erro: true };
      const n = parseFloat(s.replace(',', '.'));
      if (!isFinite(n)) return { erro: true };
      if (mult === 0) mult = n * 1e6 > MASSA_MAX ? 1e3 : 1e6;
      valor = Math.round(n * mult);
    } else if (/^\d+$/.test(s)) {
      valor = parseInt(s, 10);
    } else if (/^\d{1,3}([.,]\d{3})+$/.test(s)) {
      valor = parseInt(s.replace(/[.,]/g, ''), 10); // 52.430 ou 52,430
    } else if (/^\d+[.,]\d{1,2}$/.test(s)) {
      // 52,4 sem "mil": massa não tem casa decimal, provavelmente faltou o "mil"
      return { decimal: true, sugestao: Math.round(parseFloat(s.replace(',', '.')) * 1000) };
    } else {
      return { erro: true };
    }
    const r = { valor };
    if (mult === 1 && valor > 0 && valor < 1000) { r.pequeno = true; r.sugestao = valor * 1000; }
    return r;
  }

  // todos = true inclui quem saiu do clã (ex-membros ficam fora do ranking)
  // per pode ser 'geral' | 'semana' | 'mes' ou um instante de início; ate = fim (exclusivo)
  function montarRanking(per, ordem = modo, todos = false, ate = Infinity) {
    const desde = typeof per === 'number' ? per : inicioPeriodo(per);
    const mapa = new Map();
    // percorre do mais antigo pro mais novo para o nome mais recente prevalecer
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      const t = new Date(p.created_at).getTime();
      if (t < desde || t >= ate) continue;
      const k = chave(p.player);
      if (!todos && exMembro(k)) continue;
      let j = mapa.get(k);
      if (!j) { j = { chave: k, nome: '', melhor: p, qtd: 0, pontos: 0, cem: 0, soma: 0, ultima: p.created_at }; mapa.set(k, j); }
      j.nome = nomeDe(k, p.player);
      j.qtd += 1;
      j.pontos += pontosDe(p.mass);
      j.soma += p.mass;
      j.ultima = p.created_at;
      if (p.mass >= MARCO) j.cem += 1;
      if (p.mass > j.melhor.mass) j.melhor = p;
    }
    const porMassa = (a, b) => b.melhor.mass - a.melhor.mass || new Date(a.melhor.created_at) - new Date(b.melhor.created_at);
    const porPontos = (a, b) => b.pontos - a.pontos || b.cem - a.cem || porMassa(a, b);
    return [...mapa.values()].sort(ordem === 'massa' ? porMassa : porPontos);
  }

  // ---------- temporadas (uma por mês) ----------
  // Da mais nova pra mais velha; a do mês atual vem marcada como em andamento.
  function montarTemporadas() {
    if (!partidas.length) return [];
    const velha = new Date(partidas[partidas.length - 1].created_at);
    const limite = new Date(velha.getFullYear(), velha.getMonth(), 1).getTime();
    const hoje = new Date();
    const lista = [];
    for (let d = new Date(hoje.getFullYear(), hoje.getMonth(), 1); d.getTime() >= limite; d = new Date(d.getFullYear(), d.getMonth() - 1, 1)) {
      const fim = new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime();
      const top = montarRanking(d.getTime(), 'pontos', true, fim).filter((j) => j.pontos > 0);
      if (top.length) lista.push({ inicio: d.getTime(), fim, atual: fim > Date.now(), top });
    }
    return lista;
  }
  // quantas temporadas (já fechadas) cada jogador ganhou
  function contarTitulos(temps) {
    const n = new Map();
    for (const t of temps) if (!t.atual) n.set(t.top[0].chave, (n.get(t.top[0].chave) || 0) + 1);
    return n;
  }
  const nomeMes = (t) => new Date(t).toLocaleDateString('pt-BR', { month: 'long' });

  // ---------- troféus das temporadas ----------
  // Cada temporada tem a pedra do mês dela nas faixas da base, nos olhos das cobras e no globo.
  const GEMAS = [
    ['Granada', '#C21E3A'], ['Ametista', '#9B5DE5'], ['Água-marinha', '#4FD1E6'], ['Diamante', '#DCEBFF'],
    ['Esmeralda', '#14C36B'], ['Pérola', '#EFE4D2'], ['Rubi', '#E8174F'], ['Peridoto', '#A3D930'],
    ['Safira', '#2F63E0'], ['Turmalina', '#FF4FA3'], ['Topázio', '#FF8A2B'], ['Turquesa', '#22C7B8'],
  ];
  function misturar(hex, alvo, t) {
    const a = parseInt(hex.slice(1), 16), b = parseInt(alvo.slice(1), 16);
    const c = (s) => Math.round(((a >> s) & 255) * (1 - t) + ((b >> s) & 255) * t);
    return '#' + ((1 << 24) | (c(16) << 16) | (c(8) << 8) | c(0)).toString(16).slice(1);
  }
  const escXml = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
  let trofeuSeq = 0;
  // mes 0-11; nick vazio = troféu ainda em disputa
  function trofeuSVG(mes, ano, nick) {
    const id = 'tf' + (++trofeuSeq);
    const g = GEMAS[mes % 12][1];
    const gc = misturar(g, '#FFFFFF', 0.55), ge = misturar(g, '#000000', 0.55);
    const mesTxt = new Date(ano, mes, 1).toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '').toUpperCase();
    const bruto = nick ? nick.toUpperCase() : 'EM DISPUTA';
    const placa = escXml(bruto);
    const fonte = Math.min(15, Math.round(80 / (bruto.length * 0.47) * 10) / 10); // nick grande diminui pra caber na placa
    // largura da base cresce pra baixo (estilo taça do mundo)
    const faixa = (y1, y2, fill) => {
      const w = (y) => 30 + (y - 236) * 0.2;
      return `<path d="M${100 - w(y1)} ${y1}H${100 + w(y1)}L${100 + w(y2)} ${y2}H${100 - w(y2)}Z" fill="${fill}"/>`;
    };
    const cobraLow = 'M76 254C68 226 124 222 120 196';
    const cobraUp = 'M120 196C117 166 58 168 56 134C54 112 42 94 48 70C53 48 64 34 80 31';
    const cobra = (d) => `<path d="${d}" stroke="#3E2304" stroke-width="15"/>`
      + `<path d="${d}" stroke="url(#${id}o)" stroke-width="12"/>`
      + `<path d="${d}" stroke="#5A3305" stroke-opacity=".5" stroke-width="7" stroke-dasharray="1.5 4.5"/>`
      + `<path d="${d}" stroke="#FFF8D8" stroke-opacity=".6" stroke-width="2.2" transform="translate(-1.6 -2)"/>`;
    const cabeca = `<g transform="translate(80 31) rotate(-12)">`
      + `<path d="M-7 -9C1 -11 8 -6 13 -3.2C16 -1.6 16 1.6 13 3.2C8 6 1 11 -7 9Z" fill="url(#${id}h)" stroke="#3E2304" stroke-width="1.4"/><path d="M-3 -6C3 -6 8 -3 11 -1" stroke="#FFF8D8" stroke-opacity=".7" stroke-width="1.2" fill="none"/>`
      + `<circle cx="7" cy="2.2" r="2.2" fill="${gc}"/><circle cx="7.3" cy="2.2" r="1.1" fill="${ge}"/>`
      + `<path d="M15.5 0H19M19 0L21 -1.8M19 0L21 1.8" stroke="#FF4D3D" stroke-width="1.1" fill="none"/></g>`;
    const lado = (inv) => `<g${inv ? ' transform="translate(200 0) scale(-1 1)"' : ''}>`;
    return `<svg class="trofeu-svg" viewBox="0 0 200 340" role="img" aria-label="Troféu da temporada de ${mesTxt} ${ano}${nick ? ', campeão ' + escXml(nick) : ''}" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}o" gradientUnits="userSpaceOnUse" x1="36" y1="0" x2="164" y2="0">
<stop offset="0" stop-color="#6B3F07"/><stop offset=".28" stop-color="#F2C64A"/><stop offset=".42" stop-color="#FFF3C0"/><stop offset=".58" stop-color="#E3A92B"/><stop offset="1" stop-color="#5E3505"/></linearGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="0">
<stop offset="0" stop-color="#4A2A04"/><stop offset=".45" stop-color="#C98E1E"/><stop offset="1" stop-color="#3E2304"/></linearGradient>
<radialGradient id="${id}s" cx=".36" cy=".3" r=".75">
<stop offset="0" stop-color="#FFF8D6"/><stop offset=".25" stop-color="#F6CF56"/><stop offset=".7" stop-color="#B57812"/><stop offset="1" stop-color="#4E2B04"/></radialGradient>
<linearGradient id="${id}h" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF0B0"/><stop offset=".5" stop-color="#D99A22"/><stop offset="1" stop-color="#6B3F07"/></linearGradient>
<linearGradient id="${id}g" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="${gc}"/><stop offset=".45" stop-color="${g}"/><stop offset="1" stop-color="${ge}"/></linearGradient>
<linearGradient id="${id}p" x1="0" y1="0" x2="0" y2="1">
<stop offset="0" stop-color="#2E2016"/><stop offset="1" stop-color="#0C0806"/></linearGradient>
<linearGradient id="${id}b" x1="0" y1="0" x2="1" y2="1">
<stop offset=".35" stop-color="#FFF" stop-opacity="0"/><stop offset=".5" stop-color="#FFF" stop-opacity=".75"/><stop offset=".65" stop-color="#FFF" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><circle cx="100" cy="78" r="44"/><path d="M84 236C93 220 95 205 95 190C95 165 86 140 78 120H122C114 140 105 165 105 190C105 205 107 220 116 236Z"/><path d="M70 236H130L142 296H58Z"/></clipPath>
</defs>
<ellipse cx="100" cy="334" rx="74" ry="5" fill="#000" opacity=".55"/>
<path d="M84 236C93 220 95 205 95 190C95 165 86 140 78 120H122C114 140 105 165 105 190C105 205 107 220 116 236Z" fill="url(#${id}c)"/>
<circle cx="100" cy="78" r="44" fill="url(#${id}s)"/>
<g fill="none" stroke="#6B3A06" stroke-opacity=".45" stroke-width="1.4">
<ellipse cx="100" cy="78" rx="18" ry="44"/><ellipse cx="100" cy="78" rx="33" ry="44"/><path d="M56 78H144M61 56C85 64 115 64 139 56M61 100C85 92 115 92 139 100"/></g>
<path d="M100 62L113 74L100 98L87 74Z" fill="url(#${id}g)" stroke="#3E2304" stroke-width="1.2"/>
<path d="M87 74H113M100 62L95 74L100 98L105 74Z" fill="none" stroke="#FFF" stroke-opacity=".45" stroke-width=".8"/>
<ellipse cx="84" cy="56" rx="13" ry="8" fill="#FFF" opacity=".45" transform="rotate(-30 84 56)"/>
<g fill="none" stroke-linecap="round">
${lado(true)}${cobra(cobraLow)}</g>
${lado(false)}${cobra(cobraLow)}${cobra(cobraUp)}</g>
${lado(true)}${cobra(cobraUp)}</g>
</g>
${lado(false)}${cabeca}</g>${lado(true)}${cabeca}</g>
${faixa(236, 245, `url(#${id}o)`)}${faixa(245, 261, `url(#${id}g)`)}${faixa(261, 267, `url(#${id}o)`)}${faixa(267, 283, `url(#${id}g)`)}${faixa(283, 296, `url(#${id}o)`)}
<path d="M72 248H128M70 274H130" stroke="#FFF" stroke-opacity=".35" stroke-width="1"/>
<g class="trofeu-brilho" clip-path="url(#${id}k)"><rect x="-200" y="0" width="160" height="340" fill="url(#${id}b)"/></g>
<path d="M44 296H156L164 332H36Z" fill="url(#${id}p)" stroke="#8A5A14" stroke-width="1.5"/>
<rect x="58" y="303" width="84" height="25" rx="3" fill="url(#${id}o)" stroke="#3E2304" stroke-width="1"/>
<text x="100" y="312.5" text-anchor="middle" font-family="Chakra Petch, sans-serif" font-size="7" font-weight="700" letter-spacing="1.5" fill="#3E2304">${mesTxt} · ${ano}</text>
<text x="100" y="325" text-anchor="middle" font-family="Teko, Impact, sans-serif" font-weight="700" fill="#2A1703" font-size="${fonte}">${placa}</text>
</svg>`;
  }
  function trofeuDe(t, cls = '') {
    const d = new Date(t.inicio);
    const w = el('span', { class: `trofeu ${cls}` });
    w.innerHTML = trofeuSVG(d.getMonth(), d.getFullYear(), t.atual ? '' : t.top[0].nome);
    return w;
  }
  // "2026-09": vai no link ?trofeu= e marca qual cerimônia já foi vista
  const chaveTemp = (t) => { const d = new Date(t.inicio); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  const gemaDe = (t) => GEMAS[new Date(t.inicio).getMonth()];
  function rotTemp(t) {
    const ano = new Date(t.inicio).getFullYear();
    return `${nomeMes(t.inicio).toUpperCase()}${ano !== new Date().getFullYear() ? ' ' + ano : ''}`;
  }

  // k0 = só os momentos de um jogador; limite = quantos devolver
  function montarConquistas(k0 = null, limite = 6) {
    const eventos = [];
    const melhores = new Map();
    const cems = new Map();
    let lider = null; // {chave, nome, massa}
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      const k = chave(p.player);
      const nome = limparNick(p.player);
      let marcou = false;
      if (p.mass >= MARCO) {
        const n = (cems.get(k) || 0) + 1;
        cems.set(k, n);
        eventos.push({ chave: k, tipo: 'cem', quando: p.created_at, partes: [b(nome), ' fez ', b(marcoTxt), ` (${fmt(p.mass)})`, n > 1 ? ` · ${n}ª vez` : ' pela primeira vez'] });
        marcou = true;
      }
      const antes = melhores.get(k) || 0;
      if (p.mass <= antes) continue;
      melhores.set(k, p.mass);
      if (!lider || p.mass > lider.massa) {
        if (!lider) eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' abriu o ranking com ', b(fmt(p.mass))] });
        else if (lider.chave === k) eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' aumentou o recorde do clã para ', b(fmt(p.mass))] });
        else eventos.push({ chave: k, tipo: 'topo', quando: p.created_at, partes: [b(nome), ' passou ', b(lider.nome), ' e agora tem o recorde do clã: ', b(fmt(p.mass))] });
        lider = { chave: k, nome, massa: p.mass };
      } else if (antes > 0 && !marcou) {
        eventos.push({ chave: k, tipo: 'recorde', quando: p.created_at, partes: [b(nome), ' bateu o próprio recorde: ', b(fmt(p.mass))] });
      }
    }
    return eventos.filter((e) => !k0 || e.chave === k0).reverse().slice(0, limite);
  }
  function b(t) { return el('b', { text: t }); }

  // ---------- desenho da página ----------
  function render() {
    cachePat = null;
    cacheTrofeus = null;
    cacheRaras = null;
    cacheRei = undefined;
    const geralMassa = montarRanking('geral', 'massa');
    const geralPontos = montarRanking('geral', 'pontos');
    const rank = montarRanking(periodo, modo);

    // números do topo
    const recordista = geralMassa[0];
    $('stRecorde').textContent = recordista ? fmt(recordista.melhor.mass) : '—';
    $('stRecordeDono').textContent = recordista ? 'por ' + comTag(recordista.nome) : 'ninguém ainda';
    // líder da temporada atual (zera na virada do mês)
    const lider = montarRanking('mes', 'pontos').find((j) => j.pontos > 0);
    $('stLider').textContent = lider ? ptsTxt(lider.pontos) : '—';
    $('stLiderDono').textContent = lider ? comTag(lider.nome) : 'ninguém ainda';
    $('stCem').textContent = fmt(partidas.filter((p) => p.mass >= MARCO).length);
    $('stCemSub').textContent = 'somando o clã todo';

    const temps = montarTemporadas();
    const ctx = { pontos: geralPontos, massa: geralMassa, semana: montarRanking('semana', 'pontos'), temps, titulos: contarTitulos(temps) };
    renderDestaques(ctx);
    renderTorneios();
    renderPodio(rank, ctx);
    renderTabela(rank, ctx);
    renderConquistas();
    renderPatentes();
    renderFimTemporada();
    renderRei();
    renderTemporadas(ctx);
    renderHall();
    renderPartidas();
    renderJogadores();
    if (chat.eu && chatVisivel()) desenharMembrosChat();

    // só admin vê os formulários (e o banco confere de novo em cada ação)
    $('registrar').hidden = !admin;
    $('comoEntrar').hidden = !!admin;
    $('btnTopoRegistrar').hidden = !admin;
    $('bbRegistrar').hidden = !admin;
    $('bbBusca').hidden = !!admin;
    $('formCadastro').hidden = !admin || !elencoOk;
    $('avisoElenco').hidden = !admin || elencoOk;
    document.body.classList.toggle('modo-dono', !!admin);
    $('painel').hidden = !admin;
    $('menuPainel').hidden = !admin;
    $('maisPainel').hidden = !admin;

    // página que ficou vazia (ex.: o único torneio foi apagado) volta pro ranking
    $('menuTrofeus').hidden = $('temporadas').hidden && $('hall').hidden;
    if ($('menuTrofeus').hidden) $('bbTrofeus').hidden = true;
    if (pagAtual && !temConteudo(pagAtual)) mostrarPagina(!perfilAtual && !torneioAtual);
    else marcarMenu();

    if (admin) renderSugNick();
    if ($('dlgBusca').open) renderBusca();
    if (perfilAtual) renderPerfil();
    if (torneioAtual) renderTorneioPagina();
    renderEu();
    tickContagens();
  }

  // ---------- nicks pra tocar e preencher no registro ----------
  // quem jogou por último aparece primeiro; depois o resto do elenco
  function nicksConhecidos() {
    const mapa = new Map();
    for (const p of partidas) { const k = chave(p.player); if (!mapa.has(k) && !exMembro(k)) mapa.set(k, nomeDe(k, p.player)); }
    for (const r of jogadores) if (r.ativo && !mapa.has(chave(r.nick))) mapa.set(chave(r.nick), r.nick);
    return [...mapa.values()];
  }
  function renderSugNick() {
    const q = busca($('fNome').value);
    let lista = nicksConhecidos();
    if (q) {
      lista = lista.filter((n) => busca(n).includes(q) && busca(n) !== q)
        .sort((a, b) => busca(b).startsWith(q) - busca(a).startsWith(q));
    }
    $('sugNick').replaceChildren(...lista.slice(0, q ? 6 : 8).map((n) => el('button', {
      type: 'button', class: 'sug', text: n,
      onclick: () => { $('fNome').value = n; $('fNome').dispatchEvent(new Event('input')); $('fMassa').focus(); },
    })));
  }

  // ---------- campo de massa: mostra como vai entrar antes de enviar ----------
  let confirmarPequena = null;
  function mostrarMassa() {
    const r = lerMassa($('fMassa').value);
    const box = $('valePontos');
    box.className = 'massa-lida';
    $('btnMil').classList.toggle('chama', !!r.sugestao);
    const usar = (v) => el('button', { type: 'button', class: 'usar', text: `Usar ${fmt(v)}`, onclick: () => aplicarMassa(v) });
    if (r.vazio) { box.replaceChildren(); return; }
    if (r.erro) { box.classList.add('ruim'); box.replaceChildren('Não entendi esse número. Escreve tipo 52430 ou 52 mil.'); return; }
    if (r.decimal) { box.classList.add('alerta'); box.replaceChildren(el('span', { class: 'ml-aviso', text: `Massa não tem vírgula. Era ${fmt(r.sugestao)}?` }), usar(r.sugestao)); return; }
    if (r.valor > MASSA_MAX) { box.classList.add('ruim'); box.replaceChildren(`${fmt(r.valor)} passa de ${fmt(MASSA_MAX)}. Confere o número.`); return; }
    const d = detalhePontos(r.valor);
    box.replaceChildren(...[
      el('span', { class: 'ml-rot', text: 'VAI ENTRAR COMO' }),
      el('b', { text: fmt(r.valor) }),
      el('span', { class: 'ml-pts', text: `${d.total ? '+' + ptsTxt(d.total) : 'sem pontos'}${d.bonus ? ` (${fmt(d.base)} + ${fmt(d.bonus)} de bônus)` : ''}${r.valor >= MARCO ? ' · ' + marcoTxt : ''}` }),
      r.pequeno ? el('span', { class: 'ml-aviso' }, `Só ${fmt(r.valor)} de massa? Se for ${fmt(r.sugestao)}: `, usar(r.sugestao)) : null,
    ].filter(Boolean));
    if (r.pequeno) box.classList.add('alerta');
  }
  function aplicarMassa(v) {
    $('fMassa').value = fmt(v);
    confirmarPequena = null;
    mostrarErro(null);
    mostrarMassa();
  }
  function multiplicarMil() {
    const r = lerMassa($('fMassa').value);
    if (r.sugestao) { aplicarMassa(r.sugestao); return; }
    if (r.vazio) { $('fMassa').focus(); toast('Digita o número primeiro, tipo 52, e depois toca em × MIL.'); return; }
    if (r.valor) toast(`${fmt(r.valor)} já está completo, não precisa do × MIL.`);
  }

  // ---------- busca rápida de jogador ----------
  let achados = [];
  function abrirBusca() {
    if (souAmigo) return; // amigo só vê os jogos
    const dlg = $('dlgBusca');
    $('fBuscaGlobal').value = '';
    renderBusca();
    if (!dlg.open) dlg.showModal();
    $('listaBusca').scrollTop = 0;
    $('fBuscaGlobal').focus();
  }
  function renderBusca() {
    const bruto = $('fBuscaGlobal').value.trim();
    const q = busca(bruto);
    const stats = new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j]));
    const pos = new Map(montarRanking('geral', 'pontos').map((j, i) => [j.chave, i + 1]));
    achados = listaElenco()
      .filter((r) => !q || busca(r.nick).includes(q))
      .map((r) => ({ r, s: stats.get(r.chave), pos: pos.get(r.chave) || 0, comeca: !!q && busca(r.nick).startsWith(q) }))
      .sort((a, b) => (b.comeca - a.comeca) || (b.r.ativo - a.r.ativo) || ((a.pos || 1e9) - (b.pos || 1e9)) || a.r.nick.localeCompare(b.r.nick, 'pt-BR'));
    $('buscaAtalhos').hidden = !!q;
    $('buscaAtalhos').querySelector('[href="#hall"]').hidden = $('hall').hidden;
    $('buscaAtalhos').querySelector('[href="#temporadas"]').hidden = $('temporadas').hidden;
    $('buscaAtalhos').querySelector('[href="#torneios"]').hidden = $('torneios').hidden;
    const ul = $('listaBusca');
    if (!achados.length) {
      ul.replaceChildren(el('li', { class: 'busca-vazio', text: q ? `Ninguém com "${bruto}" no nick.` : 'Nenhum jogador ainda.' }));
      return;
    }
    ul.replaceChildren(...achados.slice(0, 80).map(({ r, s, pos: p }) => el('li', null,
      comParede(el('button', { type: 'button', class: 'busca-item', onclick: () => irPerfil(r.chave) },
        el('span', { class: `busca-pos pos p${p}`, text: p ? `#${p}` : '–' }),
        avatarDe(r.nick, ptsPat(r.chave)),
        el('span', { class: 'busca-info' },
          el('span', { class: 'busca-nome' }, el('span', { class: 'busca-nick', text: r.nick }), !r.ativo ? el('span', { class: 'ex-chip', text: 'EX' }) : null),
          el('span', { class: 'busca-sub', text: s ? `${ptsTxt(s.pontos)} · recorde ${fmt(s.melhor.mass)} · ${s.qtd} ${s.qtd === 1 ? 'partida' : 'partidas'}` : 'ainda sem partida' })),
        chipPatente(ptsPat(r.chave), 'busca-pat')), r.chave))));
  }
  function irPerfil(k) {
    $('dlgBusca').close();
    abrirPerfil(k);
  }

  // ---------- páginas ----------
  // Em vez de uma rolagem só com tudo empilhado, cada item do menu abre a sua página
  // (as seções com data-pag="..."). O #endereço diz qual: #torneios, #jogadores...;
  // sem # (ou com um # que não existe) abre o ranking. #hall, #tabela etc. abrem a
  // página de quem eles fazem parte e rolam até lá.
  const PAG_INICIO = 'ranking';
  const RAIZES = new Set(['ranking', 'torneios', 'temporadas', 'jogadores', 'partidas', 'patentes', 'chat', 'painel', 'jogos']); // abrem no topo da página
  let pagAtual = null;
  function alvoDoEndereco(hash) {
    let id = decodeURIComponent(String(hash || '').slice(1));
    if (/^jogos\//.test(id)) id = 'jogos'; // #jogos/<partida>: a partida abre dentro da página de jogos
    const n = id ? document.getElementById(id) : null;
    const sec = n && n.closest('#principal [data-pag]');
    return sec ? { pag: sec.dataset.pag, n, raiz: RAIZES.has(id) } : { pag: PAG_INICIO, n: null, raiz: true };
  }
  const secoesDa = (pag) => [...document.querySelectorAll(`#principal [data-pag="${pag}"]`)];
  const temConteudo = (pag) => secoesDa(pag).some((s) => !s.hidden);
  // pula direto, sem a rolagem suave do site (trocar de página não é rolar)
  function rolarJa(destino) {
    const h = document.documentElement;
    h.style.scrollBehavior = 'auto';
    if (typeof destino === 'number') scrollTo(0, destino); else destino.scrollIntoView({ block: 'start' });
    h.style.scrollBehavior = '';
  }
  function mostrarPagina(rolar = true) {
    let { pag, n, raiz } = alvoDoEndereco(location.hash);
    if (!temConteudo(pag)) { pag = PAG_INICIO; n = null; raiz = true; }
    if (souAmigo && pag !== 'jogos') { pag = 'jogos'; n = null; raiz = true; } // amigo: só a sala de jogos
    const mudou = pag !== pagAtual;
    pagAtual = pag;
    document.querySelectorAll('#principal [data-pag]').forEach((s) => s.classList.toggle('fora', s.dataset.pag !== pag));
    document.body.dataset.pag = pag;
    marcarMenu();
    if (pag === 'chat') abrirChatPagina();
    if (pag === 'painel' && mudou) abrirPainel();
    if (mudou) {
      const m = $('principal');
      m.classList.remove('pag-entra');
      void m.offsetWidth; // reinicia a animação de entrada
      m.classList.add('pag-entra');
    }
    if (rolar) rolarJa(n && !raiz && !n.hidden ? n : 0);
  }
  // menu de cima, barra de baixo e janela "Mais" marcam a página aberta
  function marcarMenu() {
    const pag = perfilAtual || torneioAtual ? null : pagAtual;
    let naBarra = false;
    document.querySelectorAll('.menu a, #barraBaixo a, #maisGrade a').forEach((a) => {
      const sim = !!pag && alvoDoEndereco(a.getAttribute('href')).pag === pag && a.getAttribute('href') !== '#hall';
      a.classList.toggle('ativo', sim);
      if (sim) a.setAttribute('aria-current', 'page'); else a.removeAttribute('aria-current');
      if (sim && !a.hidden && a.closest('#barraBaixo')) naBarra = true;
    });
    $('bbMais').classList.toggle('ativo', !!pag && !naBarra && pag !== PAG_INICIO);
    const ativo = document.querySelector('.menu a.ativo');
    if (ativo !== menuCentrado) { menuCentrado = ativo; centrarNaFaixa(ativo); }
  }
  let menuCentrado = null;

  // faixas que rolam pro lado (menu no celular, canais do chat...): sombra na ponta que tem mais coisa
  function ligarFaixa(box) {
    box.classList.add('fade-x');
    const medir = () => {
      const resto = box.scrollWidth - box.clientWidth - box.scrollLeft;
      box.classList.toggle('f-esq', box.scrollLeft > 2);
      box.classList.toggle('f-dir', resto > 2);
    };
    box.addEventListener('scroll', medir, { passive: true });
    new ResizeObserver(medir).observe(box);
    new MutationObserver(medir).observe(box, { childList: true, subtree: true, attributes: true, attributeFilter: ['hidden'] });
    medir();
  }
  // traz o item escolhido pro meio da faixa, sem mexer na rolagem da página
  function centrarNaFaixa(item) {
    const box = item && item.parentElement;
    if (!box || box.scrollWidth <= box.clientWidth) return;
    const rb = box.getBoundingClientRect(), ri = item.getBoundingClientRect();
    box.scrollTo({ left: box.scrollLeft + ri.left - rb.left - (box.clientWidth - ri.width) / 2, behavior: 'smooth' });
  }
  // celular: rolando pra baixo a linha da logo sobe e só as abas ficam; rolando pra cima ela volta
  function ligarTopoRecolhe() {
    const topo = document.querySelector('.topo'), menu = topo.querySelector('.menu');
    const mq = matchMedia('(max-width: 760px), (max-width: 1100px) and (max-height: 520px)');
    const medir = () => {
      const sobe = menu.getBoundingClientRect().top - topo.getBoundingClientRect().top - parseFloat(getComputedStyle(topo).paddingTop);
      topo.style.setProperty('--topo-sobe', Math.max(0, Math.round(sobe)) + 'px');
    };
    let ultY = scrollY;
    addEventListener('scroll', () => {
      const y = scrollY;
      if (!mq.matches || y <= topo.offsetHeight) { document.body.classList.remove('topo-sobe'); ultY = y; return; }
      if (Math.abs(y - ultY) < 8) return;
      document.body.classList.toggle('topo-sobe', y > ultY);
      ultY = y;
    }, { passive: true });
    new ResizeObserver(medir).observe(topo);
    medir();
  }
  // abre uma página do site (vale também de dentro do perfil ou do torneio)
  function irPara(hash) {
    const url = location.pathname + (hash && hash.length > 1 ? hash : '');
    if (location.pathname + location.search + location.hash !== url) history.pushState({}, '', url);
    mostrarRota(false, false);
  }
  function irRegistrar() {
    irPara('#registrar');
    $('fNome').focus({ preventScroll: true });
  }
  function abrirMais() {
    const dlg = $('dlgMais');
    $('maisTorneios').hidden = $('torneios').hidden || !$('bbTorneios').hidden;
    $('maisTrofeus').hidden = $('temporadas').hidden || !$('bbTrofeus').hidden;
    $('maisHall').hidden = $('hall').hidden;
    if (!dlg.open) dlg.showModal();
    dlg.focus(); // sem anel de foco no X logo de cara
  }

  // ---------- jogadores do clã (elenco + tabelas) ----------
  let perJog = 'geral';
  let vistaJog = 'resumo';
  let filtroJog = 'ativos';
  let buscaJog = '';
  let ordJog = { campo: 'pontos', desc: true };
  let planilha = null;        // o que está na tabela agora, pronto para baixar
  const ICONE_LAPIS = '<path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/>';
  const textoPer = { geral: 'desde o início', semana: 'nesta semana', mes: 'neste mês' };

  // elenco + quem tem partida mas não está cadastrado (não deveria acontecer, mas não some ninguém)
  function listaElenco() {
    const lista = jogadores.map((r) => ({ ...r, chave: chave(r.nick) }));
    const vistos = new Set(lista.map((r) => r.chave));
    for (const p of partidas) {
      const k = chave(p.player);
      if (vistos.has(k)) continue;
      vistos.add(k);
      lista.push({ id: null, nick: limparNick(p.player), cargo: '', ativo: true, created_at: null, chave: k, semCadastro: true });
    }
    return lista;
  }

  function filtrarElenco(lista, temPartida) {
    const q = chave(buscaJog);
    return lista.filter((r) => {
      if (q && !r.chave.includes(q)) return false;
      if (filtroJog === 'ativos') return r.ativo;
      if (filtroJog === 'ex') return !r.ativo;
      if (filtroJog === 'parados') return r.ativo && !temPartida(r.chave);
      return true;
    });
  }

  // Líder primeiro, depois a ordem do CARGOS; cargo desconhecido vai pro fim
  function ordemCargo(c) { const i = CARGOS.indexOf(c); return i < 0 ? CARGOS.length + (c ? 0 : 1) : i; }
  function chipCargo(r) {
    if (!r.cargo) return null;
    const lider = CARGOS.indexOf(r.cargo);
    return el('span', { class: `cargo ${lider === 0 ? 'cargo-1' : lider === 1 && CARGOS.length > 2 ? 'cargo-2' : ''}`, text: r.cargo });
  }

  function cabecalho(colunas) {
    // no celular o cabeçalho some (cada linha vira cartão): a ordem vem deste seletor
    const ords = colunas.filter((c) => c.ord), sel = $('fOrdJog');
    sel.replaceChildren(...ords.map((c) => el('option', { value: c.id, text: `⇅ ${/^c\d+$/.test(c.id) ? c.titulo : /\d/.test(c.rot) ? c.rot : c.rot[0] + c.rot.slice(1).toLowerCase()}` })));
    sel.value = ordJog.campo;
    sel.onchange = () => { const c = ords.find((x) => x.id === sel.value); ordJog = { campo: c.id, desc: !c.texto }; renderJogadores(); };
    $('cabJog').replaceChildren(el('tr', null, ...colunas.map((c) => {
      if (!c.ord) return el('th', { class: c.dir ? 'dir' : null, text: c.rot });
      const ativo = ordJog.campo === c.id;
      return el('th', { class: `${c.dir ? 'dir' : ''} ${ativo ? 'ativo' : ''}`, 'aria-sort': ativo ? (ordJog.desc ? 'descending' : 'ascending') : 'none' },
        el('button', { type: 'button', class: 'ord', title: c.titulo || null, onclick: () => {
          ordJog = ativo ? { campo: c.id, desc: !ordJog.desc } : { campo: c.id, desc: !c.texto };
          renderJogadores();
        } }, c.rot, el('span', { class: 'seta', 'aria-hidden': 'true', text: ativo ? (ordJog.desc ? '▼' : '▲') : '' })));
    })));
  }

  function ordenar(linhas) {
    const { campo, desc } = ordJog;
    const nome = (a, b) => a.nome.localeCompare(b.nome, 'pt-BR');
    return linhas.sort((a, b) => {
      const va = a[campo], vb = b[campo];
      const c = typeof va === 'string' ? va.localeCompare(vb, 'pt-BR') : va - vb;
      return (desc ? -c : c) || b.pontos - a.pontos || nome(a, b);
    });
  }

  function celNome(r, ptsGeral) {
    return comParede(el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' },
      avatarDe(r.nick, ptsGeral, 'av-p'),
      el('button', { type: 'button', class: 'link-nome forte', onclick: () => abrirPerfil(r.chave), 'aria-label': `Ver perfil de ${comTag(r.nick)}` }, r.nick),
      !r.ativo ? el('span', { class: 'ex-chip', text: 'EX-MEMBRO' }) : null,
      r.semCadastro && admin && elencoOk ? el('span', { class: 'ex-chip', text: 'SEM CADASTRO' }) : null)), r.chave);
  }
  function celEditar(r) {
    if (!admin) return null;
    return el('td', { class: 'dir c-ed' }, r.id
      ? el('button', { type: 'button', class: 'editar', 'aria-label': `Editar ${r.nick}`, onclick: () => abrirEditar(r) }, svg(ICONE_LAPIS, 18))
      : null);
  }

  function renderJogadores() {
    const lista = listaElenco();
    const ptsGeral = ptsPat; // a patente é a da temporada
    document.querySelectorAll('.aba[data-vista]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.vista === vistaJog)));
    document.querySelectorAll('.aba[data-perjog]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.perjog === perJog)));
    $('abasPerJog').hidden = vistaJog !== 'resumo';
    $('cabJog').closest('table').className = `tab-jog v-${vistaJog} ${admin ? 'com-ed' : ''}`;

    // números do período
    const doPer = new Map(montarRanking(perJog, 'pontos', true).map((j) => [j.chave, j]));
    const ativos = lista.filter((r) => r.ativo);
    const pontuaram = ativos.filter((r) => (doPer.get(r.chave) || {}).pontos > 0).length;
    const parados = ativos.filter((r) => !doPer.has(r.chave)).length;
    const somaPts = ativos.reduce((s, r) => s + ((doPer.get(r.chave) || {}).pontos || 0), 0);
    const ex = lista.length - ativos.length;
    $('jogResumo').textContent = `${fmt(ativos.length)} ${ativos.length === 1 ? 'jogador' : 'jogadores'} no clã${ex ? ` · ${fmt(ex)} ${ex === 1 ? 'ex-membro' : 'ex-membros'}` : ''}`;
    const quando = vistaJog === 'resumo' ? textoPer[perJog] : textoPer.geral;
    $('jogNumeros').replaceChildren(...[
      ['MEMBROS', fmt(ativos.length), 'no elenco do clã', ''],
      ['PONTUARAM', fmt(pontuaram), quando, 'laranja'],
      ['SEM PARTIDA', fmt(parados), quando, ''],
      ['PONTOS DO CLÃ', fmt(somaPts), `somados ${quando}`, 'laranja'],
    ].map(([r, v, s, c]) => el('div', { class: 'stat' }, el('span', { class: 'stat-rot', text: r }), el('span', { class: `stat-num ${c}`, text: v }), el('span', { class: 'stat-sub', text: s }))));

    if (vistaJog === 'resumo') renderResumo(lista, doPer, ptsGeral);
    else renderPorPeriodo(lista, vistaJog, ptsGeral);
  }

  function renderResumo(lista, doPer, ptsGeral) {
    const colunas = [
      { rot: 'POS' },
      { id: 'nome', rot: 'JOGADOR', ord: true, texto: true },
      { id: 'cargo', rot: 'CARGO', ord: true, texto: true },
      { id: 'ptsGeral', rot: 'PATENTE', ord: true, titulo: 'Patente nesta temporada' },
      { id: 'pontos', rot: 'PONTOS', ord: true, dir: true },
      { id: 'qtd', rot: 'PARTIDAS', ord: true, dir: true },
      { id: 'recorde', rot: 'RECORDE', ord: true, dir: true },
      { id: 'media', rot: 'MÉDIA', ord: true, dir: true },
      { id: 'cem', rot: marcoTxt, ord: true, dir: true },
      { id: 'ultima', rot: 'ÚLTIMA', ord: true, dir: true },
    ];
    if (admin) colunas.push({ rot: '' });
    if (!colunas.some((c) => c.id === ordJog.campo)) ordJog = { campo: 'pontos', desc: true };
    cabecalho(colunas);

    const linhas = ordenar(filtrarElenco(lista, (k) => doPer.has(k)).map((r) => {
      const s = doPer.get(r.chave);
      return {
        r, nome: r.nick, cargo: ordemCargo(r.cargo), ptsGeral: ptsGeral(r.chave),
        pontos: s ? s.pontos : 0, qtd: s ? s.qtd : 0, recorde: s ? s.melhor.mass : 0,
        media: s ? Math.round(s.soma / s.qtd) : 0, cem: s ? s.cem : 0, ultima: s ? Date.parse(s.ultima) : 0,
      };
    }));

    const corpo = $('corpoJog');
    if (!linhas.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: String(colunas.length), class: 'vazio-cel', text: msgVazio() })));
    } else {
      // no celular a linha vira cartão: partidas, recorde, média e 100K+ descem pra faixa .mob-est
      const est = (rot, val, cls) => el('span', { class: cls || null }, el('small', { text: rot }), el('b', { text: val }));
      corpo.replaceChildren(...linhas.map((l, i) => el('tr', { class: l.r.ativo ? null : 'ex' },
        el('td', { class: `pos p${l.qtd ? i + 1 : 0}`, text: `#${i + 1}` }),
        celNome(l.r, l.ptsGeral),
        el('td', { class: `c-cargo ${l.r.cargo ? '' : 'sem'}` }, chipCargo(l.r) || el('span', { class: 'sec', text: '—' })),
        el('td', { class: 'c-pat' }, chipPatente(l.ptsGeral)),
        el('td', { class: 'dir num c-pts', 'data-un': 'PTS', text: fmt(l.pontos) }),
        el('td', { class: 'dir c-qtd', text: l.qtd ? fmt(l.qtd) : '—' }),
        el('td', { class: 'dir c-rec', text: l.qtd ? fmt(l.recorde) : '—' }),
        el('td', { class: 'dir sec c-med', text: l.qtd ? fmt(l.media) : '—' }),
        el('td', { class: 'dir c-cem' }, l.cem ? el('span', { class: 'cem-chip', text: `${l.cem}×` }) : el('span', { class: 'sec', text: '—' })),
        el('td', { class: 'dir sec nowrap c-ult', text: l.ultima ? diaTxt(l.ultima) : 'nunca' }),
        el('td', { class: 'mob-est', 'aria-hidden': 'true' },
          est('PARTIDAS', l.qtd ? fmt(l.qtd) : '—'),
          est('RECORDE', l.qtd ? fmt(l.recorde) : '—'),
          est('MÉDIA', l.qtd ? fmt(l.media) : '—'),
          est(marcoTxt, l.cem ? `${l.cem}×` : '—', l.cem ? 'tem-cem' : null)),
        celEditar(l.r)
      )));
    }
    $('notaJog').textContent = '';

    const dia = (ms) => (ms ? new Date(ms).toLocaleDateString('pt-BR') : '');
    planilha = {
      nome: `jogadores-${perJog}`,
      linhas: [
        ['Posição', 'Jogador', 'Cargo', 'No clã', 'Patente', 'Pontos', 'Partidas', 'Recorde', 'Média', `Partidas ${marcoTxt}`, 'Última partida', 'Cadastrado em'],
        ...linhas.map((l, i) => [i + 1, comTag(l.nome), l.r.cargo || '', l.r.ativo ? 'sim' : 'não', patenteDe(l.ptsGeral).atual.nome,
          l.pontos, l.qtd, l.recorde || '', l.media || '', l.cem, dia(l.ultima), l.r.created_at ? dia(Date.parse(l.r.created_at)) : '']),
      ],
    };
  }

  // colunas de semanas (segunda a domingo) ou meses, da mais nova pra mais antiga
  function colunasPeriodo(tipo) {
    const cols = [];
    const hoje = new Date();
    hoje.setHours(0, 0, 0, 0);
    if (tipo === 'semanas') {
      hoje.setDate(hoje.getDate() - (hoje.getDay() + 6) % 7);
      for (let i = 0; i < 8; i++) {
        const ini = new Date(hoje); ini.setDate(hoje.getDate() - 7 * i);
        const fim = new Date(ini); fim.setDate(ini.getDate() + 7);
        const ult = new Date(fim); ult.setDate(fim.getDate() - 1);
        const dm = (d) => d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
        cols.push({ ini: ini.getTime(), fim: fim.getTime(), rot: i === 0 ? 'ESTA' : dm(ini), titulo: `${dm(ini)} a ${dm(ult)}`, csv: `Semana ${dm(ini)} a ${dm(ult)}` });
      }
    } else {
      for (let i = 0; i < 6; i++) {
        const ini = new Date(hoje.getFullYear(), hoje.getMonth() - i, 1);
        const fim = new Date(hoje.getFullYear(), hoje.getMonth() - i + 1, 1);
        const mes = ini.toLocaleDateString('pt-BR', { month: 'short' }).replace('.', '');
        const longo = ini.toLocaleDateString('pt-BR', { month: 'long', year: 'numeric' });
        cols.push({ ini: ini.getTime(), fim: fim.getTime(), rot: i === 0 ? 'ESTE MÊS' : mes.toUpperCase(), titulo: longo, csv: longo });
      }
    }
    return cols;
  }

  function renderPorPeriodo(lista, tipo, ptsGeral) {
    const cols = colunasPeriodo(tipo);
    const desde = cols[cols.length - 1].ini;
    // pontos de cada jogador em cada coluna
    const grade = new Map();
    for (const p of partidas) {
      const t = new Date(p.created_at).getTime();
      if (t < desde) continue;
      const c = cols.findIndex((x) => t >= x.ini && t < x.fim);
      if (c < 0) continue;
      const k = chave(p.player);
      if (!grade.has(k)) grade.set(k, cols.map(() => ({ pontos: 0, qtd: 0, melhor: 0 })));
      const g = grade.get(k)[c];
      g.pontos += pontosDe(p.mass);
      g.qtd += 1;
      g.melhor = Math.max(g.melhor, p.mass);
    }

    const colunas = [
      { rot: 'POS' },
      { id: 'nome', rot: 'JOGADOR', ord: true, texto: true },
      { id: 'total', rot: 'TOTAL', ord: true, dir: true, titulo: tipo === 'semanas' ? 'Pontos das últimas 8 semanas' : 'Pontos dos últimos 6 meses' },
      ...cols.map((c, i) => ({ id: `c${i}`, rot: c.rot, ord: true, dir: true, titulo: c.titulo })),
    ];
    if (admin) colunas.push({ rot: '' });
    if (!colunas.some((c) => c.id === ordJog.campo)) ordJog = { campo: 'total', desc: true };
    cabecalho(colunas);

    const vazio = cols.map(() => ({ pontos: 0, qtd: 0, melhor: 0 }));
    const linhas = ordenar(filtrarElenco(lista, (k) => grade.has(k)).map((r) => {
      const g = grade.get(r.chave) || vazio;
      const l = { r, nome: r.nick, g, total: g.reduce((s, x) => s + x.pontos, 0), ptsGeral: ptsGeral(r.chave) };
      l.pontos = l.total;
      g.forEach((x, i) => { l[`c${i}`] = x.pontos; });
      return l;
    }));
    // quem fez mais pontos em cada coluna ganha destaque
    const maior = cols.map((_, i) => Math.max(0, ...linhas.map((l) => l.g[i].pontos)));

    const corpo = $('corpoJog');
    if (!linhas.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: String(colunas.length), class: 'vazio-cel', text: msgVazio() })));
    } else {
      corpo.replaceChildren(...linhas.map((l, i) => el('tr', { class: l.r.ativo ? null : 'ex' },
        el('td', { class: `pos p${l.total ? i + 1 : 0}`, text: `#${i + 1}` }),
        celNome(l.r, l.ptsGeral),
        el('td', { class: 'dir num c-pts', 'data-un': 'TOTAL', text: fmt(l.total) }),
        ...l.g.map((x, c) => el('td', {
          'data-rot': cols[c].rot,
          class: `dir cel-per ${x.qtd ? '' : 'sem'} ${maior[c] && x.pontos === maior[c] ? 'melhor-col' : ''}`,
          title: x.qtd ? `${cols[c].titulo}: ${ptsTxt(x.pontos)} em ${x.qtd} ${x.qtd === 1 ? 'partida' : 'partidas'} · maior massa ${fmt(x.melhor)}` : `${cols[c].titulo}: sem partida`,
        }, x.qtd ? [el('b', { text: fmt(x.pontos) }), el('small', { text: `${x.qtd}p` })] : '·')),
        celEditar(l.r)
      )));
    }
    $('notaJog').textContent = `número pequeno = partidas · laranja = quem mais pontuou ${tipo === 'semanas' ? 'na semana' : 'no mês'}`;

    planilha = {
      nome: `jogadores-por-${tipo === 'semanas' ? 'semana' : 'mes'}`,
      linhas: [
        ['Posição', 'Jogador', 'Cargo', 'No clã', 'Total', ...cols.map((c) => `${c.csv} (pontos)`), ...cols.map((c) => `${c.csv} (partidas)`)],
        ...linhas.map((l, i) => [i + 1, comTag(l.nome), l.r.cargo || '', l.r.ativo ? 'sim' : 'não', l.total, ...l.g.map((x) => x.pontos), ...l.g.map((x) => x.qtd)]),
      ],
    };
  }

  function msgVazio() {
    if (buscaJog) return `Ninguém com "${buscaJog}" no nome.`;
    if (filtroJog === 'ex') return 'Nenhum ex-membro.';
    if (filtroJog === 'parados') return 'Todo mundo jogou nesse período. Clã ativo!';
    return admin ? 'Nenhum jogador cadastrado ainda. Cadastre o elenco no quadro acima.' : 'Nenhum jogador cadastrado ainda.';
  }

  // ---------- baixar planilha (CSV que abre no Excel e no Google Planilhas) ----------
  function baixarCsv(nome, linhas) {
    const cel = (v) => { const s = String(v ?? ''); return /[";\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
    const txt = '﻿' + linhas.map((l) => l.map(cel).join(';')).join('\r\n');
    const url = URL.createObjectURL(new Blob([txt], { type: 'text/csv;charset=utf-8' }));
    const hoje = new Date().toLocaleDateString('pt-BR').split('/').reverse().join('-');
    const a = el('a', { href: url, download: `${TAG.toLowerCase()}-${nome}-${hoje}.csv` });
    document.body.append(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 2000);
  }
  function baixarPartidas() {
    if (!partidas.length) { toast('Ainda não tem partida pra baixar.', true); return; }
    baixarCsv('partidas', [
      ['Data', 'Jogador', 'Massa', 'Pontos', `${marcoTxt}`],
      ...partidas.map((p) => {
        const d = new Date(p.created_at);
        const k = chave(p.player);
        return [d.toLocaleDateString('pt-BR'), comTag(nomeDe(k, p.player)), p.mass, pontosDe(p.mass), p.mass >= MARCO ? 'sim' : ''];
      }),
    ]);
  }

  // ---------- cadastro e edição de jogadores (só o dono) ----------
  function nicksDoTexto(txt) {
    const mapa = new Map();
    for (const n of String(txt).split(/[\n,;]+/).map(limparNick).filter(Boolean)) if (!mapa.has(chave(n))) mapa.set(chave(n), n);
    return [...mapa.values()];
  }
  function previaCadastro() {
    const nicks = nicksDoTexto($('fNicks').value);
    if (!nicks.length) { $('previaCadastro').textContent = ''; return; }
    let novos = 0, voltam = 0, ja = 0;
    for (const n of nicks) { const r = elenco.get(chave(n)); if (!r) novos++; else if (!r.ativo) voltam++; else ja++; }
    $('previaCadastro').textContent = [
      novos ? `${novos} ${novos === 1 ? 'novo' : 'novos'}` : '',
      voltam ? `${voltam} ${voltam === 1 ? 'volta' : 'voltam'} pro clã` : '',
      ja ? `${ja} já ${ja === 1 ? 'cadastrado' : 'cadastrados'}` : '',
    ].filter(Boolean).join(' · ');
  }
  function erroCadastro(msg) { $('erroCadastro').textContent = msg || ''; $('erroCadastro').hidden = !msg; }

  async function cadastrar(ev) {
    ev.preventDefault();
    const nicks = nicksDoTexto($('fNicks').value);
    const cargo = $('fCargo').value || CARGO_PADRAO;
    if (!nicks.length) return erroCadastro('Escreve pelo menos um nick.');
    if (nicks.length > 200) return erroCadastro('No máximo 200 de uma vez.');
    if (!admin) return erroCadastro('Entre na área do admin para cadastrar.');
    erroCadastro(null);
    const voltam = nicks.filter((n) => exMembro(chave(n))).length;
    const btn = $('btnCadastrar');
    btn.disabled = true;
    btn.textContent = 'CADASTRANDO…';
    try {
      let n = 0;
      if (DEMO) {
        for (const nick of nicks) {
          const r = elenco.get(chave(nick));
          if (r) { r.ativo = true; continue; }
          jogadores.push({ id: 'dj-' + Date.now() + '-' + n, nick, cargo, ativo: true, created_at: new Date().toISOString() });
          n++;
        }
        indexarElenco();
      } else {
        n = await rpcAdmin('admin_add_players', { p_nicks: nicks, p_cargo: cargo });
        await carregar();
      }
      $('fNicks').value = '';
      $('previaCadastro').textContent = '';
      render();
      const ja = nicks.length - n - voltam;
      const partes = [
        n ? `${n} ${n === 1 ? 'jogador cadastrado' : 'jogadores cadastrados'}` : '',
        voltam ? `${voltam} ${voltam === 1 ? 'voltou' : 'voltaram'} pro clã` : '',
        ja ? `${ja} já ${ja === 1 ? 'estava' : 'estavam'} no elenco` : '',
      ].filter(Boolean);
      toast(partes.join(' · ') + '.');
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      erroCadastro('Não deu pra cadastrar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'CADASTRAR';
    }
  }

  let editJog = null;
  let confirmarApagarJog = false;
  function opcoesCargo(select, atual) {
    const lista = atual && !CARGOS.includes(atual) ? [...CARGOS, atual] : CARGOS;
    select.replaceChildren(...lista.map((c) => el('option', { value: c, text: c })));
    select.value = atual || CARGO_PADRAO;
  }
  function abrirEditar(r) {
    editJog = r;
    confirmarApagarJog = false;
    const qtd = partidas.filter((p) => chave(p.player) === r.chave).length + lancamentos.filter((l) => l.player_id === r.id).length;
    $('fJogNick').value = r.nick;
    opcoesCargo($('fJogCargo'), r.cargo);
    $('fJogAtivo').checked = r.ativo;
    $('erroJogador').hidden = true;
    $('btnApagarJog').hidden = qtd > 0;
    $('btnApagarJog').textContent = 'Apagar';
    $('notaJogador').textContent = qtd
      ? `Tem ${qtd} ${qtd === 1 ? 'partida' : 'partidas'}. Se saiu do clã, desmarque "Ainda está no clã": ele some do ranking e o histórico fica guardado.`
      : 'Ainda não tem partida. Se foi cadastro errado, pode apagar.';
    renderLoginJog(r);
    $('dlgJogador').showModal();
  }
  function erroJogador(msg) { $('erroJogador').textContent = msg || ''; $('erroJogador').hidden = !msg; }

  async function salvarJogador(ev) {
    ev.preventDefault();
    const r = editJog;
    if (!r) return;
    const nick = limparNick($('fJogNick').value);
    const cargo = $('fJogCargo').value;
    const ativo = $('fJogAtivo').checked;
    if (!nick) return erroJogador('Escreve o nick.');
    const outro = elenco.get(chave(nick));
    if (outro && outro.id !== r.id) return erroJogador(`Já existe ${comTag(outro.nick)} no elenco.`);
    const btn = $('btnSalvarJog');
    btn.disabled = true;
    try {
      if (DEMO) {
        const antigo = r.chave;
        const alvo = jogadores.find((x) => x.id === r.id);
        Object.assign(alvo, { nick, cargo, ativo });
        partidas.forEach((p) => { if (chave(p.player) === antigo) p.player = nick; });
        indexarElenco();
      } else {
        const res = await rpcAdmin('admin_update_player', { p_id: r.id, p_nick: nick, p_cargo: cargo, p_ativo: ativo });
        if (res === 'nick_em_uso') return erroJogador('Esse nick já está no elenco.');
        if (res !== 'ok') throw new Error(res);
        await carregar();
      }
      $('dlgJogador').close();
      render();
      toast(ativo === r.ativo ? `${comTag(nick)} atualizado.` : ativo ? `${comTag(nick)} voltou pro clã.` : `${comTag(nick)} agora é ex-membro.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }

  async function apagarJogador() {
    const r = editJog;
    if (!r) return;
    if (!confirmarApagarJog) { confirmarApagarJog = true; $('btnApagarJog').textContent = 'Toque de novo pra apagar'; return; }
    try {
      if (DEMO) {
        jogadores = jogadores.filter((x) => x.id !== r.id);
        indexarElenco();
      } else {
        const res = await rpcAdmin('admin_delete_player', { p_id: r.id });
        if (res === 'tem_partidas') return erroJogador('Ele tem partidas. Desmarque "Ainda está no clã" em vez de apagar.');
        await carregar();
      }
      $('dlgJogador').close();
      render();
      toast(`${comTag(r.nick)} saiu do elenco.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu pra apagar agora. (' + (e.message || 'erro') + ')');
    }
  }

  const geralPts = (j) => ptsPat(j.chave); // pontos que valem pra patente (a da temporada)

  // no pódio: o escudo da patente (se tiver) ou a bolinha com a cor do lugar
  function avatarPodio(j) {
    const { atual } = patenteDe(geralPts(j));
    const letra = j.nome.charAt(0).toUpperCase();
    const av = avatarDoElenco(j.nome);
    if (av) return coroar(avatarFoto(av, atual, 'avatar'), j.chave);
    if (!atual.nivel) return coroar(el('div', { class: 'avatar', 'aria-hidden': 'true', text: letra }), j.chave);
    const a = el('div', { class: `avatar avatar-esc ${atual.diamante ? 'esc-dia' : ''}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(atual, letra);
    return coroar(a, j.chave);
  }
  function renderPodio(rank, ctx) {
    const box = $('podio');
    if (!rank.length) {
      const ultima = ctx.temps.find((t) => !t.atual);
      const msg = periodo === 'geral'
        ? 'Ninguém no ranking ainda.'
        : periodo === 'mes'
          ? `Pódio livre na ${nomeTemp(Date.now())}.${ultima ? ` Último campeão: ${comTag(ultima.top[0].nome)}.` : ''}`
          : 'Ninguém pontuou nesta semana ainda.';
      box.replaceChildren(el('p', { class: 'vazio', text: msg }));
      return;
    }
    const valor = (j) => (modo === 'massa' ? j.melhor.mass : j.pontos);
    const topo = Math.max(1, valor(rank[0]));
    const ordem = [1, 0, 2].filter((i) => rank[i]); // 2º, 1º, 3º
    box.replaceChildren(...ordem.map((i) => {
      const j = rank[i];
      const url = urlPrint(j.melhor);
      const linha = modo === 'massa'
        ? `recorde · ${dataCurta(j.melhor.created_at)} · ${ptsTxt(j.pontos)}`
        : `pontos · recorde ${fmt(j.melhor.mass)}`;
      // no celular os três ficam lado a lado: a tag e as partes "longas" somem pelo CSS
      return comParede(el('article', { class: `lugar l${i + 1}` },
        i === 0 ? svg(ICONE_COROA, 40, 'class="coroa"') : null,
        avatarPodio(j),
        el('div', { class: 'lugar-id' },
          el('div', { class: 'lugar-pos' }, `${i + 1}º LUGAR`, i === 0 ? el('span', { class: 'lugar-rei', text: ' · REI DO CLÃ' }) : null),
          btnPerfil(j, 'lugar-nome', [el('span', { class: 'lugar-tag', text: `[${TAG}] ` }), j.nome]),
          el('div', { class: 'lugar-pat' }, chipPatente(geralPts(j)))),
        el('div', { class: `lugar-massa ${fmt(valor(j)).length > 7 ? 'num-longo' : ''}`, text: fmt(valor(j)) }),
        el('div', { class: 'lugar-data', text: linha }),
        j.cem ? el('div', { class: 'cem-selo', text: `${j.cem}× ${marcoTxt}` }) : null,
        el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, Math.round(valor(j) / topo * 100))}%` })),
        url ? el('button', { type: 'button', class: 'ver-print', text: 'Ver print do recorde', onclick: () => abrirPrint(j.melhor) }) : null
      ), j.chave);
    }));
  }

  function chipTitulos(n) {
    if (!n) return null;
    return el('span', { class: 'titulo-chip', title: `${n}× campeão de temporada` }, svg(ICONE_TROFEU, 12), n > 1 ? `${n}×` : null);
  }

  // a tabela abre com o top 10 (e a sua linha, se você marcou "sou eu"); o resto num toque
  const TABELA_TOPO = 10;
  let tabelaToda = false;
  function renderTabela(rank, ctx) {
    const corpo = $('corpoTabela');
    $('thPontos').classList.toggle('ativo', modo === 'pontos');
    $('thRecorde').classList.toggle('ativo', modo === 'massa');
    corpo.closest('table').classList.toggle('modo-massa', modo === 'massa');
    $('tabelaMaisBox').hidden = true;
    if (!rank.length) {
      corpo.replaceChildren(el('tr', null, el('td', { colspan: '6', class: 'vazio-cel', text: 'A tabela aparece aqui assim que a primeira massa for registrada.' })));
      return;
    }
    const doisDias = Date.now() - 24 * 3600 * 1000;
    const eu = lerEu();
    const iEu = rank.findIndex((j) => j.chave === eu);
    const cortar = !tabelaToda && rank.length > TABELA_TOPO + 2;
    const linhas = rank.map((j, i) => [j, i]).filter(([, i]) => !cortar || i < TABELA_TOPO || i === iEu);
    if (rank.length > TABELA_TOPO + 2) {
      $('tabelaMaisBox').hidden = false;
      $('btnTabelaToda').textContent = tabelaToda ? 'Mostrar só o top 10' : `Ver todos os ${rank.length} jogadores`;
    }
    trocar(corpo, linhas.flatMap(([j, i]) => {
      const novo = new Date(j.melhor.created_at).getTime() > doisDias;
      const pulo = cortar && i === iEu && i > TABELA_TOPO
        ? el('tr', { class: 'pulo', 'aria-hidden': 'true' }, el('td', { colspan: '6', text: '⋯' })) : null;
      // no celular a linha vira cartão: os números que não cabem na coluna descem pra faixa .mob-est
      const est = (rot, val, cls) => el('span', { class: cls || null }, el('small', { text: rot }), el('b', { text: val }));
      return [pulo, comParede(el('tr', { class: [i === 0 ? 'topo1' : '', j.chave === eu ? 'eu-linha' : '', patenteDe(geralPts(j)).atual.diamante ? 'linha-dia' : '', ehRei(j.chave) ? 'linha-rei' : ''].join(' ').trim() || null },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' }, el('div', { class: 'nome-linha' }, avatarDe(j.nome, geralPts(j), 'av-p'), btnPerfil(j, 'link-nome forte', [el('span', { class: 'tag-nick', text: `[${TAG}] ` }), j.nome]),
          el('span', { class: 'nome-chips' }, chipPatente(geralPts(j)), chipRei(j.chave), chipTitulos(ctx.titulos.get(j.chave)), ...chipTorneios(j.chave, true), novo ? el('span', { class: 'chip', title: 'Recorde novo nas últimas 24 horas' }, '▲', el('span', { class: 'chip-longo', text: ' RECORDE NOVO' })) : null)),
          el('div', { class: 'nome-melhor' }, 'melhor: ', b(ptsTxt(pontosDe(j.melhor.mass))), ` · ${fmt(j.melhor.mass)} massa`)),
        el('td', { class: `dir c-pts ${modo === 'pontos' ? 'num' : 'sec'}`, 'data-un': 'PTS', text: fmt(j.pontos) }),
        el('td', { class: 'dir c-cem' }, j.cem ? el('span', { class: 'cem-chip', text: `${j.cem}×` }) : el('span', { class: 'sec', text: '—' })),
        el('td', { class: `dir c-rec ${modo === 'massa' ? 'num' : 'sec'}`, 'data-un': 'MASSA', text: fmt(j.melhor.mass) }),
        el('td', { class: 'dir sec c-qtd', text: fmt(j.qtd) }),
        el('td', { class: 'mob-est', 'aria-hidden': 'true' },
          est('PARTIDAS', fmt(j.qtd)),
          modo === 'pontos' ? est('RECORDE', fmt(j.melhor.mass)) : est('PONTOS', fmt(j.pontos)),
          est(marcoTxt, j.cem ? `${j.cem}×` : '—', j.cem ? 'tem-cem' : null))), j.chave, 'linha-parede')];
    }));
  }

  function renderConquistas() {
    const ev = montarConquistas();
    const ul = $('listaConquistas');
    if (!ev.length) { ul.replaceChildren(el('li', { class: 'sec', text: 'As conquistas do clã aparecem aqui.' })); return; }
    ul.replaceChildren(...ev.map((e) => el('li', null,
      el('span', { class: `bola ${e.tipo}`, 'aria-hidden': 'true' }),
      el('span', { class: 'txt' }, e.partes),
      el('span', { class: 'quando', text: diaTxt(e.quando) })
    )));
  }

  // ---------- partidas: o COBR BOT lança cada massa no feed ----------
  // sem horário em lugar nenhum, só o dia. 12 posts e depois mais 24 a cada toque
  const PARTIDAS_PASSO = 24;
  let partidasQtd = 12;
  const ICONE_BOT = '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 8V4M9 13h.01M15 13h.01M9.5 17h5"/>';
  const ICONE_CHECK = '<path d="M5 12.5l4.5 4.5L19 7"/>';
  const ICONE_SOBE = '<path d="M12 19V5M6 11l6-6 6 6"/>';
  const ICONE_ESTRELA = '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/>';
  let botVistos = null;        // ids já mostrados (null = primeira vez: nada anima)
  let botChegando = null;      // { ids, ate }: o bot "digita" antes de soltar a partida nova
  let botNovos = new Set();
  // número da partida, recorde do mês e recorde pessoal na hora em que ela entrou
  let cacheBot = null;
  function infoBot() {
    if (cacheBot && cacheBot.n === partidas.length && cacheBot.p === partidas[0]) return cacheBot.m;
    const m = new Map(), mes = new Map(), meu = new Map();
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i], k = chave(p.player), mk = mesChave(Date.parse(p.created_at));
      const topoMes = mes.get(mk), topoMeu = meu.get(k);
      m.set(p.id, { n: partidas.length - i, recMes: topoMes != null && p.mass > topoMes, recMeu: topoMeu != null && p.mass > topoMeu });
      if (topoMes == null || p.mass > topoMes) mes.set(mk, p.mass);
      if (topoMeu == null || p.mass > topoMeu) meu.set(k, p.mass);
    }
    cacheBot = { n: partidas.length, p: partidas[0], m };
    return m;
  }
  const diaBot = (iso) => new Date(iso).toDateString();
  function botAvatar(g = '') {
    return el('span', { class: `bot-av ${g}`, 'aria-hidden': 'true' }, el('img', { src: 'logo-cobr.webp', alt: '' }), el('span', { class: 'bot-av-ico' }, svg(ICONE_BOT, g ? 14 : 11)));
  }
  function botCab(extra) {
    return el('div', { class: 'bot-cab' }, el('b', { text: 'COBR BOT' }), el('span', { class: 'bot-tag' }, svg(ICONE_CHECK, 11), 'BOT'), extra);
  }
  function fraseBot(p, nick, info, sobe) {
    const b = el('b', { text: nick });
    if (sobe) return ['sobe', svg(ICONE_SOBE, 15), b, ` subiu pra ${sobe.para.nome}!`];
    if (info.recMes) return ['ouro', svg(ICONE_TROFEU, 15), 'Novo recorde da temporada: ', b, '!'];
    if (p.mass >= MARCO) return ['cem', svg(ICONE_CHAMA, 15), b, ` passou dos ${fmtK(Math.floor(p.mass / MARCO) * MARCO)}!`];
    if (info.recMeu) return ['meu', svg(ICONE_ESTRELA, 15), b, ' bateu o próprio recorde.'];
    const f = [['Massa nova de ', '.'], ['Partida de ', ' lançada.'], ['Mais uma pro ranking: ', '.'], ['Entrou massa de ', '.']][info.n % 4];
    return ['', svg(ICONE_BOT, 15), f[0], b, f[1]];
  }
  function postBot(p, info, novo) {
    const k = chave(p.player), nick = nomeDe(k, p.player), pat = patenteDe(ptsPat(k)).atual;
    const sobe = subidaDe(p.id), url = urlPrint(p), cem = p.mass >= MARCO, pts = pontosDe(p.mass);
    const [tom, ...frase] = fraseBot(p, nick, info, sobe);
    const num = el('span', { text: fmt(p.mass) });
    if (novo) contarAte(num, p.mass);
    const letra = nick.charAt(0).toUpperCase();
    const post = el('article', { class: `bot-post ${novo ? 'novo' : ''}`, 'data-id': p.id },
      botAvatar(),
      el('div', { class: 'bot-corpo' },
        botCab(el('span', { class: 'bot-n', text: `#${String(info.n).padStart(4, '0')}` })),
        el('div', { class: `bot-txt ${tom}` }, ...frase),
        el('div', { class: `bot-card ${cem ? 'cem' : ''}`, style: `--pc:${pat.cor}` },
          el('div', { class: 'bot-card-in' },
            el('div', { class: 'bot-card-esq' },
              el('button', { type: 'button', class: 'bot-quem', disabled: !elenco.has(k), onclick: () => abrirPerfil(k) },
                avatarDe(nick, ptsPat(k), 'av-p'), el('b', { text: comTag(nick) }), chipPatente(ptsPat(k))),
              el('div', { class: 'bot-num' }, num, el('small', { text: 'MASSA' })),
              el('div', { class: 'bot-chips' },
                el('span', { class: 'bot-pts', text: pts ? `+${ptsTxt(pts)}` : 'sem pontos' }),
                cem ? el('span', { class: 'cem-chip', text: marcoTxt }) : null,
                info.recMes ? el('span', { class: 'ch-selo', text: 'RECORDE DO MÊS' }) : null,
                !info.recMes && info.recMeu ? el('span', { class: 'bot-chip', text: 'RECORDE PESSOAL' }) : null)),
            url ? el('button', { type: 'button', class: 'bot-print', 'aria-label': `Ver print de ${nick}`, onclick: () => abrirPrint(p) }, el('img', { src: url, alt: '', loading: 'lazy' })) : null),
          sobe ? el('div', { class: 'ch-sobe', style: `--pc:${sobe.para.cor}` },
            escudoDe(sobe.de, letra, 'av-p ch-sobe-de'),
            el('span', { class: 'ch-sobe-seta' }, svg(ICONE_SETA, 18)),
            escudoDe(sobe.para, letra, 'av-p ch-sobe-para'),
            el('span', { class: 'ch-sobe-txt' }, 'SUBIU PRA', chipPatente(sobe.para.pontos))) : null,
          el('div', { class: 'bot-check' }, ...['massa conferida', 'pontos somados', 'ranking atualizado'].map((t) => el('span', {}, svg(ICONE_CHECK, 12), t))))),
      admin ? el('button', { type: 'button', class: 'apagar', 'aria-label': `Apagar pontuação de ${limparNick(p.player)}`, onclick: () => pedirApagar(p) }, svg(ICONE_LIXO)) : null);
    comParede(post.querySelector('.bot-card'), k);
    return post;
  }
  // o bot fecha cada dia que já passou com um resumo
  function resumoBot(dia) {
    const doDia = partidas.filter((p) => diaBot(p.created_at) === dia);
    if (doDia.length < 2) return null; // dia de uma partida só não precisa de resumo
    const top = doDia.reduce((a, b) => (b.mass > a.mass ? b : a));
    const k = chave(top.player), nick = nomeDe(k, top.player);
    const caixa = (rot, val) => el('div', { class: 'bot-res-cx' }, el('small', { text: rot }), el('b', { text: val }));
    return el('article', { class: 'bot-post bot-resumo' },
      botAvatar(),
      el('div', { class: 'bot-corpo' },
        botCab(null),
        el('div', { class: 'bot-card' },
          el('div', { class: 'bot-res-rot' }, svg(ICONE_OK, 14), `FECHAMENTO · ${rotDia(doDia[0].created_at)}`),
          el('div', { class: 'bot-res' },
            caixa(doDia.length === 1 ? 'PARTIDA' : 'PARTIDAS', fmt(doDia.length)),
            caixa('MASSA DO DIA', fmt(doDia.reduce((s, p) => s + p.mass, 0))),
            el('button', { type: 'button', class: 'bot-res-cx bot-res-top', disabled: !elenco.has(k), onclick: () => abrirPerfil(k) },
              el('small', { text: 'DESTAQUE' }), el('span', { class: 'bot-res-quem' }, avatarDe(nick, ptsPat(k), 'av-p'), el('b', { text: nick })), el('em', { text: fmt(top.mass) }))))));
  }
  function renderBotTopo() {
    const hoje = diaBot(Date.now()), deHoje = partidas.filter((p) => diaBot(p.created_at) === hoje);
    const maior = deHoje.reduce((m, p) => Math.max(m, p.mass), 0);
    const soma = deHoje.reduce((s, p) => s + p.mass, 0);
    const st = (rot, val) => el('div', { class: 'bot-st' }, el('b', { text: val }), el('small', { text: rot }));
    const box = $('botTopo');
    box.classList.toggle('on', DEMO || realtimeOk);
    box.replaceChildren(
      el('span', { class: 'bot-radar', 'aria-hidden': 'true' }),
      el('div', { class: 'bot-id' },
        el('span', { class: 'bot-av-wrap' }, botAvatar('bot-av-g'), el('span', { class: 'bot-luz' })),
        el('div', { class: 'bot-id-txt' },
          botCab(null),
          el('span', { class: 'bot-status' }, el('span', { class: 'so-on', text: 'online · de olho no ranking' }), el('span', { class: 'so-off', text: 'conectando…' })))),
      el('div', { class: 'bot-stats' },
        st('HOJE', fmt(deHoje.length)),
        st('MASSA HOJE', soma >= 1000 ? fmtK(Math.round(soma / 1000) * 1000) : fmt(soma)),
        st('MAIOR HOJE', maior ? fmt(maior) : '—'),
        st('LANÇADAS', fmt(partidas.length))));
  }
  function renderPartidas() {
    const box = $('listaPartidas');
    $('adminTag').hidden = !admin;
    renderBotTopo();
    // partida nova chegou com a página aberta: o bot "digita" um tiquinho antes de lançar
    const ids = partidas.map((p) => p.id);
    if (botVistos) {
      const novas = ids.slice(0, 5).filter((id) => !botVistos.has(id));
      if (novas.length && pagAtual === 'partidas' && !document.hidden) {
        botChegando = { ids: new Set(novas), ate: Date.now() + 1700 };
        botNovos = new Set(novas);
        setTimeout(() => { botChegando = null; renderPartidas(); setTimeout(() => botNovos.clear(), 4000); }, 1750);
      }
    }
    botVistos = new Set(ids);
    const esperando = botChegando && botChegando.ate > Date.now() ? botChegando.ids : null;
    const fila = esperando ? partidas.filter((p) => !esperando.has(p.id)) : partidas;
    const lista = fila.slice(0, partidasQtd);
    const resto = fila.length - lista.length;
    $('partidasMaisBox').hidden = resto <= 0;
    $('btnPartidasMais').textContent = `Ver mais ${fmt(Math.min(resto, PARTIDAS_PASSO))} ${Math.min(resto, PARTIDAS_PASSO) === 1 ? 'partida' : 'partidas'}`;
    const filhos = esperando ? [el('div', { class: 'bot-digitando', role: 'status' }, botAvatar(),
      el('span', { class: 'ch-pontinhos' }, el('i'), el('i'), el('i')), el('b', { text: 'COBR BOT' }), ' está lançando uma partida…')] : [];
    if (!lista.length) { box.replaceChildren(...filhos, el('p', { class: 'vazio', text: 'Nenhuma partida registrada ainda.' })); return; }
    const info = infoBot(), hoje = diaBot(Date.now());
    let dia = null;
    for (const p of lista) {
      const d = diaBot(p.created_at);
      if (d !== dia) {
        dia = d;
        filhos.push(el('div', { class: 'ch-dia bot-dia', text: rotDia(p.created_at) }));
        if (d !== hoje) { const r = resumoBot(d); if (r) filhos.push(r); }
      }
      filhos.push(postBot(p, info.get(p.id) || { n: 0 }, !esperando && botNovos.has(p.id)));
    }
    box.replaceChildren(...filhos);
  }

  function renderTabelaPontos() {
    const linha = (rot, val, cls) => el('li', { class: cls }, el('span', { text: rot }), el('b', { text: val }));
    const exemplo = (m) => {
      const d = detalhePontos(m);
      return linha(`${fmt(m)} de massa`, d.bonus ? `${fmt(d.base)} + ${fmt(d.bonus)} = ${ptsTxt(d.total)}` : ptsTxt(d.total), d.bonus ? 'topo' : null);
    };
    const exemplos = [50000, META - 1000, META, META * 2, META * 5, MASSA_MAX].filter((m, i, a) => m > 0 && m <= MASSA_MAX && a.indexOf(m) === i);
    const metas = [1, 2, 3].filter((n) => bonusDaMeta(n) > 0);
    $('tabelaPontos').replaceChildren(...[
      linha('a cada 1.000 de massa', ptsTxt(POR_MIL)),
      ...metas.map((n) => linha(`bônus ao passar de ${fmtK(META * n)}`, `+${ptsTxt(bonusDaMeta(n))}`, 'topo')),
      BONUS_SOBE && metas.length ? el('li', { class: 'tp-nota', text: `…e cada meta seguinte vale +${fmt(BONUS_SOBE)} a mais, até ${fmtK(MASSA_MAX)}.` }) : null,
      el('li', { class: 'tp-sep', text: 'EXEMPLOS' }),
      ...exemplos.map(exemplo),
    ].filter(Boolean));
  }

  // ---------- patentes ----------
  const CORES_PATENTE = ['#A8998B', '#B98BFF', '#3BA4FF', '#FFB347', '#FF7A1A', '#FFD84D', '#FF5AA0', '#3DDC84'];
  const COR_DIAMANTE = '#7DF9FF';
  const DIAMANTES = { nome: 'Diamantes', pontos: 10000 };
  const ehDiamante = (nome) => /diamante/i.test(String(nome || ''));
  const listaPatentes = Array.isArray(CFG.PATENTES) && CFG.PATENTES.length ? [...CFG.PATENTES] : [
    { nome: 'Recruta', pontos: 0 },
    { nome: 'Guerreiro', pontos: 100 },
    { nome: 'Elite', pontos: 300 },
    { nome: 'Mestre', pontos: 600 },
    { nome: 'Grão-Mestre', pontos: 1200 },
    { nome: 'Lendário', pontos: 2500 },
  ];
  // Diamantes entra mesmo se o config.js tiver a lista antiga
  if (!listaPatentes.some((x) => x && ehDiamante(x.nome))) listaPatentes.push(DIAMANTES);
  const PATENTES = listaPatentes.map((x) => ({ nome: String(x.nome || '?'), pontos: Number(x.pontos) || 0 }))
    .sort((a, b) => a.pontos - b.pontos)
    .map((x, i) => {
      const diamante = ehDiamante(x.nome);
      return { ...x, nivel: i, diamante, chave: busca(x.nome), cor: diamante ? COR_DIAMANTE : CORES_PATENTE[i % CORES_PATENTE.length] };
    });
  if (PATENTES[0].pontos > 0) PATENTES[0].pontos = 0;

  const mesChave = (ms) => { const d = new Date(ms); return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`; };
  function patenteDe(pontos) {
    let atual = PATENTES[0];
    for (const t of PATENTES) if (pontos >= t.pontos) atual = t;
    const prox = PATENTES[atual.nivel + 1] || null;
    const progresso = prox ? (pontos - atual.pontos) / (prox.pontos - atual.pontos) : 1;
    return { atual, prox, progresso: Math.max(0, Math.min(1, progresso)) };
  }

  // ---------- patente por temporada (igual ao ranqueado do Free Fire) ----------
  // A patente vale só na temporada (o mês). Na virada, quem terminou cai 2 patentes e
  // começa a nova no piso dela; os pontos do mês somam em cima disso. Recruta continua Recruta.
  const CAI_NA_VIRADA = 2;
  // Temporada 1 = outubro de 2026 (no modo demonstração, o mês da partida mais velha)
  function inicioTemp1() {
    if (!DEMO || !partidas.length) return new Date(2026, 9, 1);
    const d = new Date(partidas[partidas.length - 1].created_at);
    return new Date(d.getFullYear(), d.getMonth(), 1);
  }
  function numTemp(ms) {
    const d = new Date(ms), t1 = inicioTemp1();
    return (d.getFullYear() - t1.getFullYear()) * 12 + d.getMonth() - t1.getMonth() + 1;
  }
  const nomeTemp = (ms) => (numTemp(ms) >= 1 ? `Temporada ${numTemp(ms)}` : `Temporada de ${nomeMes(ms)}`);
  const fimDoMes = (ms = Date.now()) => { const d = new Date(ms); return new Date(d.getFullYear(), d.getMonth() + 1, 1).getTime(); };
  // em que nível começa a próxima temporada quem terminou em "nivel"
  const nivelNaVirada = (nivel) => Math.max(0, nivel - CAI_NA_VIRADA);

  // "2026-10" -> Map(chave -> { chave, nome, ini, ganho, pts, fim, qtd }); ini/fim = nível da patente
  let cachePat = null;
  function patentesPorTemporada() {
    if (cachePat) return cachePat;
    cachePat = new Map();
    if (!partidas.length) return cachePat;
    const velha = new Date(partidas[partidas.length - 1].created_at);
    let comeca = new Map(); // chave -> { ini, nome } de quem não começa em Recruta
    for (let d = new Date(velha.getFullYear(), velha.getMonth(), 1); d.getTime() <= Date.now(); d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
      const doMes = new Map(montarRanking(d.getTime(), 'pontos', true, fimDoMes(d.getTime())).map((j) => [j.chave, j]));
      const mapa = new Map();
      for (const k of new Set([...comeca.keys(), ...doMes.keys()])) {
        const ini = comeca.has(k) ? comeca.get(k).ini : 0;
        const j = doMes.get(k);
        const ganho = j ? j.pontos : 0;
        const pts = PATENTES[ini].pontos + ganho;
        mapa.set(k, { chave: k, nome: j ? j.nome : comeca.get(k).nome, ini, ganho, pts, fim: patenteDe(pts).atual.nivel, qtd: j ? j.qtd : 0 });
      }
      cachePat.set(mesChave(d), mapa);
      comeca = new Map();
      for (const [k, x] of mapa) if (nivelNaVirada(x.fim) > 0) comeca.set(k, { ini: nivelNaVirada(x.fim), nome: x.nome });
    }
    return cachePat;
  }
  // como o jogador está na temporada de "ms" (null = nunca pontuou e começou em Recruta)
  const patTemp = (k, ms = Date.now()) => (patentesPorTemporada().get(mesChave(ms)) || new Map()).get(k) || null;
  // pontos que valem pra patente agora: o piso de onde começou + os pontos do mês
  function ptsPat(k) { const x = patTemp(k); return x ? x.pts : 0; }
  function chipPatente(pontos, extra = '') {
    const { atual } = patenteDe(pontos);
    return el('span', { class: `patente ${atual.diamante ? 'pat-dia' : ''} ${extra}`, style: `--pc:${atual.cor}` }, svg(atual.diamante ? ICONE_DIAMANTE : ICONE_PATENTE, 12), atual.nome);
  }
  const ICONE_PATENTE = '<path d="M12 3l8 3.5v5.5c0 4.5-3.4 8-8 9.5-4.6-1.5-8-5-8-9.5V6.5z"/><path d="M8 10.5l4 3 4-3"/>';
  const ICONE_DIAMANTE = '<path d="M6 3h12l4 6-10 12L2 9z"/><path d="M2 9h20M10 3 8 9l4 12 4-12-2-6"/>';
  // quem tem patente ganha o escudo dela no lugar da bolinha (Recruta continua com a bolinha);
  // quem montou o avatar aparece com ele, na moldura da patente
  function avatarDe(nome, pontos, tam = '') {
    const { atual } = patenteDe(pontos);
    const letra = nome.charAt(0).toUpperCase();
    const av = avatarDoElenco(nome);
    if (av) return coroar(avatarFoto(av, atual, `av ${tam}`), chave(nome));
    if (!atual.nivel) return coroar(el('span', { class: `av ${tam}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true', text: letra }), chave(nome));
    const a = el('span', { class: `av av-esc ${tam} ${atual.diamante ? 'esc-dia' : ''}`, style: `--pc:${atual.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(atual, letra);
    return coroar(a, chave(nome));
  }

  // ---------- coroa do rei ----------
  // o campeão da temporada que acabou de fechar usa a coroa a temporada seguinte inteira;
  // na virada ela vai pro novo campeão (se ele ganhar de novo, continua com ela)
  let cacheRei;
  function reiAtual() {
    if (cacheRei !== undefined) return cacheRei;
    const ini = new Date(fimDoMes() - 1);
    const atual = new Date(ini.getFullYear(), ini.getMonth(), 1).getTime();
    const ant = new Date(ini.getFullYear(), ini.getMonth() - 1, 1).getTime();
    const top = montarRanking(ant, 'pontos', true, atual).find((j) => j.pontos > 0);
    cacheRei = top && !exMembro(top.chave) ? { chave: top.chave, nome: top.nome, ms: ant } : null;
    return cacheRei;
  }
  const ehRei = (k) => { const r = reiAtual(); return !!r && r.chave === k; };
  let numCoroa = 0;
  function coroaSVG(cls = 'coroa-rei') {
    const id = 'cr' + (++numCoroa);
    const w = el('span', { class: cls, 'aria-hidden': 'true' });
    const corpo = 'M12 54L4 16L18 38L27 7L38 33L50 1L62 33L73 7L82 38L96 16L88 54Z';
    const faixa = 'M9 51Q50 44 91 51L91 66Q50 59 9 66Z';
    const tr = 'stroke="#4A2600" stroke-width="1.8" stroke-linejoin="round"';
    w.innerHTML = `<svg viewBox="-8 -12 116 84">
<defs>
<linearGradient id="${id}o" x1="0" y1="0" x2=".5" y2="1"><stop offset="0" stop-color="#FFF7C2"/><stop offset=".3" stop-color="#FFD84D"/><stop offset=".7" stop-color="#F29A00"/><stop offset="1" stop-color="#8A4300"/></linearGradient>
<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFE98A"/><stop offset=".5" stop-color="#E08A00"/><stop offset="1" stop-color="#7A3A00"/></linearGradient>
<radialGradient id="${id}p" cx=".35" cy=".35" r=".7"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".6" stop-color="#FFF1C9"/><stop offset="1" stop-color="#D9B26A"/></radialGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".9"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="${corpo}"/><path d="${faixa}"/></clipPath>
</defs>
<path d="${corpo}" fill="url(#${id}o)" ${tr}/>
<path d="M14 50L8 24M27 13L30 46M50 8V46M73 13L70 46M86 24L92 50" stroke="#FFF7C2" stroke-opacity=".55" stroke-width="1.4" fill="none"/>
<path d="${faixa}" fill="url(#${id}f)" ${tr}/>
<path d="M11 54Q50 47 89 54" stroke="#FFF7C2" stroke-opacity=".7" stroke-width="1.3" fill="none"/>
${[[4, 16, 4.6], [27, 7, 4.6], [50, 1, 5.8], [73, 7, 4.6], [96, 16, 4.6]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}p)" ${tr}/>`).join('')}
<path d="M50 49L57 56.5L50 64L43 56.5Z" fill="#E8174F" ${tr}/><path d="M48 52L50 50L52 52L50 55Z" fill="#fff" fill-opacity=".85"/>
<ellipse cx="29" cy="58" rx="5.2" ry="4" fill="#2F63E0" ${tr}/><ellipse cx="71" cy="58" rx="5.2" ry="4" fill="#2F63E0" ${tr}/>
<circle cx="15" cy="59.5" r="3" fill="#14C36B" ${tr}/><circle cx="85" cy="59.5" r="3" fill="#14C36B" ${tr}/>
<path d="M50 20L55 28L50 36L45 28Z" fill="#E8174F" ${tr}/>
<g clip-path="url(#${id}k)"><g class="cr-reflexo"><rect x="-70" y="-20" width="26" height="110" fill="url(#${id}e)" transform="skewX(-22)"/></g></g>
<path class="cr-faisca" d="${faisca(-2, 2, 7)}" fill="#FFF7C2"/>
<path class="cr-faisca" style="animation-delay:-.6s" d="${faisca(103, -2, 6)}" fill="#fff"/>
<path class="cr-faisca" style="animation-delay:-1.2s" d="${faisca(64, -8, 4.5)}" fill="#FFE98A"/>
</svg>`;
    return w;
  }
  // põe a coroa na "cabeça" do avatar de quem é o rei
  function coroar(a, k) {
    if (!ehRei(k)) return a;
    a.classList.add('av-rei');
    a.append(coroaSVG());
    a.title = `Dono da coroa · campeão da ${nomeTemp(reiAtual().ms)}`;
    return a;
  }
  // banner do rei (ou da coroa vaga) no ranking: quem tem a coroa e quem tá tomando ela
  function renderRei() {
    const box = $('reiTemporada');
    const rei = reiAtual();
    const mes = montarRanking('mes', 'pontos').filter((j) => j.pontos > 0);
    const lider = mes[0];
    if (!rei && !lider) { box.replaceChildren(); return; }
    const eu = lerEu();
    const pos = rei ? mes.findIndex((j) => j.chave === rei.chave) + 1 : 0;
    const defende = rei && pos === 1;
    const cta = !rei ? 'VALENDO A COROA'
      : eu === rei.chave ? 'DEFENDA A COROA'
        : lider && eu === lider.chave && !defende ? 'TOMANDO A COROA'
          : 'DESTRONE O REI';
    const status = rei
      ? [el('span', { class: `rei-chip ${defende ? 'rei-ok' : 'rei-risco'}`, text: defende ? 'DEFENDENDO · #1' : pos ? `AMEAÇADO · #${pos}` : 'AMEAÇADO · SEM PONTOS' }),
        lider && !defende ? el('span', { class: 'rei-lider' }, el('span', { class: 'rei-lider-rot', text: '1º AGORA' }), btnPerfil(lider, 'rei-lider-nome', [avatarDe(lider.nome, ptsPat(lider.chave), 'av-p'), comTag(lider.nome)])) : null]
      : [el('span', { class: 'rei-lider' }, el('span', { class: 'rei-lider-rot', text: '1º AGORA' }), btnPerfil(lider, 'rei-lider-nome', [avatarDe(lider.nome, ptsPat(lider.chave), 'av-p'), comTag(lider.nome)]))];
    trocar(box, comParede(el('div', { class: `rei-box ${rei ? '' : 'rei-vago'} ${eu && rei && eu === rei.chave ? 'rei-eu' : ''}` },
      el('span', { class: 'rei-raios', 'aria-hidden': 'true' }),
      el('span', { class: 'dia-faiscas rei-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 10 }, () => el('i'))),
      rei
        ? btnPerfil(rei, 'rei-av', avatarDe(rei.nome, ptsPat(rei.chave), 'av-g'))
        : el('span', { class: 'rei-av' }, coroaSVG('coroa-vaga')),
      el('div', { class: 'rei-txt' },
        el('span', { class: 'rei-rot' }, svg(ICONE_COROA, 14), rei ? `DONO DA COROA · CAMPEÃO DA ${nomeTemp(rei.ms).toUpperCase()}` : `COROA EM JOGO · ${nomeTemp(Date.now()).toUpperCase()}`,
          el('button', { type: 'button', class: 'info-btn', 'data-info': 'temporada', 'aria-label': 'Como funciona a coroa', text: 'i' })),
        rei ? btnPerfil(rei, 'rei-nome', comTag(rei.nome)) : el('b', { class: 'rei-nome', text: 'SEM DONO' }),
        el('div', { class: 'rei-status' }, ...status)),
      el('b', { class: 'rei-cta', text: cta })), rei && rei.chave));
  }
  function chipRei(k) {
    if (!ehRei(k)) return null;
    const n = numTemp(reiAtual().ms);
    return el('span', { class: 'rei-tag', title: `Dono da coroa · campeão da ${nomeTemp(reiAtual().ms)}` }, svg(ICONE_COROA, 12), n >= 1 ? `REI T${n}` : 'REI');
  }

  // ---------- top 1: 1º em pontos da temporada que está rolando ----------
  // muda sozinho quando entra massa nova (a chave olha quantas partidas tem)
  let cacheLider = null;
  function liderTemp() {
    const k = `${partidas.length}:${mesChave(Date.now())}`;
    if (cacheLider && cacheLider.k === k) return cacheLider.v;
    const top = montarRanking('mes', 'pontos').find((j) => j.pontos > 0 && !exMembro(j.chave));
    cacheLider = { k, v: top ? { chave: top.chave, nome: top.nome, pontos: top.pontos } : null };
    return cacheLider.v;
  }
  const ehLider = (k) => { const l = liderTemp(); return !!l && l.chave === k; };
  function chipLider(k) {
    if (!ehLider(k)) return null;
    return el('span', { class: 'lider-tag', title: `Top 1 da ${nomeTemp(Date.now())}` }, svg(ICONE_CHAMA, 12), 'TOP 1');
  }

  // ---------- escudo de cada patente ----------
  // sobe de enfeite a cada patente: divisas, filete, asas, estrela e coroa; Diamantes é de cristal
  const tom = (hex, t) => { // t > 0 clareia, t < 0 escurece
    const n = parseInt(hex.slice(1), 16), alvo = t > 0 ? 255 : 0, a = Math.abs(t);
    return '#' + [16, 8, 0].map((s) => { const c = (n >> s) & 255; return Math.round(c + (alvo - c) * a).toString(16).padStart(2, '0'); }).join('');
  };
  function formaEscudo(w, h, t) {
    const l = 60 - w / 2, r = 60 + w / 2, y = (f) => +(t + h * f).toFixed(1);
    return `M60 ${t}L${r} ${y(.1)}L${r} ${y(.48)}C${r} ${y(.76)} ${60 + w * .22} ${y(.9)} 60 ${t + h}C${60 - w * .22} ${y(.9)} ${l} ${y(.76)} ${l} ${y(.48)}L${l} ${y(.1)}Z`;
  }
  const estrela = (cx, cy, r) => Array.from({ length: 10 }, (_, i) => {
    const a = Math.PI / 5 * i - Math.PI / 2, d = i % 2 ? r * .45 : r;
    return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
  }).join(' ');
  // por nível: tamanho do escudo (w, h, topo t), divisas, filete, asas (escala) e enfeite em cima.
  // O último é o Lendário (o Diamantes usa ele em cristal): espadas, asas grandes, coroa, raios
  const ESC_NIVEIS = [
    { w: 84, h: 100, t: 10, div: 0 },
    { w: 84, h: 100, t: 10, div: 1 },
    { w: 84, h: 100, t: 10, div: 2, filete: true },
    { w: 74, h: 90, t: 16, div: 2, filete: true, asa: .62 },
    { w: 68, h: 84, t: 27, div: 2, filete: true, asa: .9, topo: 'estrela' },
    { w: 64, h: 80, t: 34, div: 0, filete: true, lenda: true },
  ];
  const ASA = '<path d="M0 -6C-10 -18 -22 -26 -34 -30C-30 -16 -20 -4 0 6Z"/><path d="M0 4C-12 -2 -24 -6 -36 -8C-30 4 -18 12 0 14Z"/><path d="M0 12C-10 12 -20 14 -30 18C-22 26 -10 26 0 22Z"/>';
  const ASA_G = '<path d="M0 -10C-8 -24 -20 -34 -38 -40C-34 -24 -22 -12 0 0Z"/><path d="M0 -2C-12 -12 -26 -20 -42 -22C-36 -8 -22 2 0 6Z"/><path d="M0 6C-14 2 -28 -2 -42 -2C-34 10 -20 14 0 14Z"/><path d="M0 13C-12 12 -24 12 -36 16C-28 24 -14 24 0 20Z"/><path d="M0 19C-10 21 -18 24 -26 30C-16 34 -6 30 0 25Z"/>';
  // as duas asas: a esquerda e a mesma espelhada
  const parAsas = (desenho, x, y, s, extra = '') => `<g transform="translate(${x} ${y}) scale(${s})${extra}">${desenho}</g><g transform="translate(120 0) scale(-1 1)"><g transform="translate(${x} ${y}) scale(${s})${extra}">${desenho}</g></g>`;
  const faisca = (x, y, r) => `M${x} ${y - r}L${x + r * .28} ${y - r * .28}L${x + r} ${y}L${x + r * .28} ${y + r * .28}L${x} ${y + r}L${x - r * .28} ${y + r * .28}L${x - r} ${y}L${x - r * .28} ${y - r * .28}Z`;
  const gema = (x, y, r) => `M${x} ${y - r}L${x + r * .8} ${y}L${x} ${y + r}L${x - r * .8} ${y}Z`;
  let numEsc = 0;
  function escudoSVG(p, letra = '') {
    const id = 'es' + (++numEsc);
    const dia = p.diamante;
    const n = ESC_NIVEIS[dia ? ESC_NIVEIS.length - 1 : Math.min(p.nivel, ESC_NIVEIS.length - 1)];
    const { w, h, t } = n;
    const c = p.cor;
    const aro = dia ? ['#FFFFFF', '#7DF9FF', '#C6A8FF', '#3A6FD8'] : [tom(c, .65), c, tom(c, -.3), tom(c, -.62)];
    const escuro = dia ? '#06202B' : tom(c, -.8);
    const claro = dia ? '#EFFFFF' : tom(c, .72);
    const campo = dia ? ['#2C6F8A', '#07151D'] : n.lenda ? ['#6A1426', '#16030A'] : [tom(c, -.55), tom(c, -.86)];
    const pedra = dia ? '#FF9FE0' : '#FF3B4A'; // joias da coroa, das espadas e do escudo
    const fora = formaEscudo(w, h, t), dentro = formaEscudo(w - 16, h - 18, t + 8);
    const cy = t + h * (n.div || n.lenda ? .43 : .48);
    const fs = w * .64 * (letra.length > 2 ? .58 : letra.length > 1 ? .76 : 1);
    const l = 60 - w / 2;
    const traco = `stroke="${escuro}" stroke-linejoin="round"`;
    let defs = '', fx = '', atras = '', frente = '';
    let asa = n.asa ? `<g fill="url(#${id}a)" ${traco} stroke-width="1.4">${parAsas(ASA, l + 6, t + h * .3, n.asa)}</g>` : '';
    let topo = n.topo === 'estrela' ? `<polygon points="${estrela(60, t - 11, 12)}" fill="url(#${id}a)" ${traco} stroke-width="1.4"/>` : '';
    if (n.lenda) {
      const meio = t + h * .45;
      // raios de luz girando atrás (dourados no Lendário, arco-íris no Diamantes) e um halo pulsando
      const cores = dia ? ['#7DF9FF', '#FF9FE0', '#C6A8FF', '#FFFFFF'] : ['#FFE58A', '#FFB347'];
      const raios = Array.from({ length: 16 }, (_, i) => {
        const a = Math.PI * 2 * i / 16, pt = (b) => `${(60 + 60 * Math.cos(b)).toFixed(1)},${(meio + 60 * Math.sin(b)).toFixed(1)}`;
        return `<polygon points="60,${meio} ${pt(a - .09)} ${pt(a + .09)}" fill="${cores[i % cores.length]}"/>`;
      }).join('');
      defs += `<radialGradient id="${id}m" gradientUnits="userSpaceOnUse" cx="60" cy="${meio}" r="60"><stop offset=".2" stop-color="#fff"/><stop offset="1" stop-color="#000"/></radialGradient>`
        + `<mask id="${id}r"><rect x="-20" y="-20" width="160" height="160" fill="url(#${id}m)"/></mask>`
        + `<radialGradient id="${id}h"><stop offset="0" stop-color="${dia ? '#7DF9FF' : '#FFD84D'}" stop-opacity=".75"/><stop offset="1" stop-color="${dia ? '#C6A8FF' : '#FF7A1A'}" stop-opacity="0"/></radialGradient>`
        + `<linearGradient id="${id}s" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="${dia ? '#9FF6FF' : '#E9EEF3'}"/><stop offset=".5" stop-color="#FFFFFF"/><stop offset="1" stop-color="${dia ? '#3A8FD8' : '#7D8A99'}"/></linearGradient>`
        + `<linearGradient id="${id}v" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${dia ? '#FFFFFF' : '#FF7B6B'}"/><stop offset=".5" stop-color="${dia ? '#C6A8FF' : '#C21A30'}"/><stop offset="1" stop-color="${dia ? '#4B3BC8' : '#4A0610'}"/></linearGradient>`;
      fx = `<g class="esc-fx"><circle class="esc-halo" cx="60" cy="${meio}" r="${dia ? 58 : 50}" fill="url(#${id}h)"/>`
        + `<g mask="url(#${id}r)" opacity="${dia ? .8 : .6}"><g class="esc-raios" style="transform-origin:60px ${meio}px">${raios}</g></g></g>`;
      // duas espadas cruzadas por cima das asas, atrás do escudo
      const espada = (ang) => `<g transform="translate(60 ${meio}) rotate(${ang})">`
        + `<path d="M0 -66L5 -54L5 32L-5 32L-5 -54Z" fill="url(#${id}s)" ${traco} stroke-width="1.2"/><path d="M0 -53V28" stroke="#fff" stroke-opacity=".6" stroke-width="1"/>`
        + `<rect x="-14" y="30" width="28" height="5.5" rx="2.7" fill="url(#${id}a)" ${traco} stroke-width="1.2"/>`
        + `<rect x="-2.6" y="35.5" width="5.2" height="11" fill="${escuro}"/><circle cy="50" r="4" fill="${pedra}" ${traco} stroke-width="1.2"/></g>`;
      atras = espada(54) + espada(-54);
      // asas grandes: uma camada de trás (carmesim / lilás) e as penas da frente
      asa = `<g fill="url(#${id}v)" ${traco} stroke-width="1.2">${parAsas(ASA_G, l + 4, t + h * .36, 1.02, ' rotate(-10)')}</g>`
        + `<g fill="url(#${id}a)" ${traco} stroke-width="1.3">${parAsas(ASA_G, l + 5, t + h * .32, .86)}</g>`;
      // coroa de 5 pontas com pedras
      const pontas = [[34, t - 14], [49, t - 20], [60, t - 27], [71, t - 20], [86, t - 14]];
      topo = `<path d="M40 ${t + 5}L34 ${t - 14}L45 ${t - 4}L49 ${t - 20}L56 ${t - 7}L60 ${t - 27}L64 ${t - 7}L71 ${t - 20}L75 ${t - 4}L86 ${t - 14}L80 ${t + 5}Z" fill="url(#${id}a)" ${traco} stroke-width="1.4"/>`
        + pontas.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="${i === 2 ? 4 : 3.2}" fill="${i % 2 ? (dia ? '#7DF9FF' : '#FFF3B0') : pedra}" ${traco} stroke-width="1.1"/>`).join('')
        + `<path d="${gema(60, t - 6, 6)}" fill="${pedra}" ${traco} stroke-width="1.1"/><path d="${gema(58.6, t - 8, 1.8)}" fill="#fff" fill-opacity=".8"/>`;
      // pedra no pé do escudo
      frente = `<path d="${gema(60, t + h * .8, 5.5)}" fill="${pedra}" ${traco} stroke-width="1.1"/><path d="${gema(58.8, t + h * .8 - 1.8, 1.6)}" fill="#fff" fill-opacity=".8"/>`;
      // Lendário: brasas subindo · Diamantes: faíscas piscando em volta
      const pts = dia
        ? [[14, 30, 6], [106, 26, 5], [110, 86, 6], [10, 94, 5], [94, 112, 4], [28, 8, 4]]
        : [[30, 104], [42, 110], [55, 106], [66, 111], [78, 105], [90, 109]];
      frente += `<g class="esc-fx">${pts.map(([x, y, r], i) => (dia
        ? `<path class="esc-faisca" style="animation-delay:-${(i * .37).toFixed(2)}s" d="${faisca(x, y, r)}" fill="#fff"/>`
        : `<circle class="esc-brasa" style="animation-delay:-${(i * .47).toFixed(2)}s" cx="${x}" cy="${y}" r="1.7" fill="${i % 2 ? '#FFD84D' : '#FF7A1A'}"/>`)).join('')}</g>`;
    }
    const divisas = Array.from({ length: n.div }, (_, i) => {
      const y = t + h * .7 + i * 8, m = w * .18;
      return `<path d="M${60 - m} ${y}L60 ${y + 7}L${60 + m} ${y}" fill="none" stroke="${aro[0]}" stroke-width="3.6" stroke-linecap="round" stroke-linejoin="round"/>`;
    }).join('');
    // lapidação do cristal: linhas do centro pras pontas do escudo
    const facetas = dia ? `<path d="M60 ${t + 8}L60 ${t + h - 10}M${l + 8} ${t + h * .14}L60 ${t + h * .5}L${120 - l - 8} ${t + h * .14}M${l + 8} ${t + h * .5}L60 ${t + h * .5}L${120 - l - 8} ${t + h * .5}" stroke="#BFFBFF" stroke-opacity=".22" stroke-width="1.2" fill="none"/>` : '';
    const meio = letra
      ? `<text x="60" y="${cy.toFixed(1)}" text-anchor="middle" dominant-baseline="central" font-size="${fs.toFixed(1)}" fill="${claro}" stroke="${escuro}" stroke-width="3" paint-order="stroke">${letra.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')}</text>`
      : `<polygon points="${estrela(60, cy, w * .2)}" fill="${claro}" stroke="${escuro}" stroke-width="2" stroke-linejoin="round"/>`;
    return `<svg class="esc" viewBox="0 0 120 120" aria-hidden="true">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2=".7" y2="1"><stop offset="0" stop-color="${aro[0]}"/><stop offset=".35" stop-color="${aro[1]}"/><stop offset=".7" stop-color="${aro[2]}"/><stop offset="1" stop-color="${aro[3]}"/></linearGradient>
<radialGradient id="${id}b" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="${campo[0]}"/><stop offset="1" stop-color="${campo[1]}"/></radialGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".42"/><stop offset=".48" stop-color="#fff" stop-opacity=".06"/><stop offset=".5" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="${fora}"/></clipPath>${defs}
</defs>
${fx}<g class="esc-cristal">${asa}${atras}${topo}<path d="${fora}" fill="url(#${id}a)" stroke="${escuro}" stroke-width="1.6" stroke-linejoin="round"/></g>
<path d="${dentro}" fill="url(#${id}b)" stroke="${escuro}" stroke-width="1.2"/>
${n.filete ? `<path d="${formaEscudo(w - 8, h - 9, t + 4)}" fill="none" stroke="${aro[0]}" stroke-opacity=".75" stroke-width="1.3"/>` : ''}
${facetas}${divisas}
<path d="${fora}" fill="url(#${id}c)"/>
${meio}
<g clip-path="url(#${id}k)"><g transform="skewX(-20)"><rect class="esc-reflexo" x="-40" y="0" width="20" height="130" fill="#fff" fill-opacity=".38"/></g></g>
${frente}
</svg>`;
  }
  // diamante lapidado (brilhante) com faíscas e um reflexo que passa por cima
  let numGema = 0;
  function diamanteSVG(cls = '') {
    const id = 'gd' + (++numGema);
    const w = el('span', { class: `gema-dia ${cls}`, 'aria-hidden': 'true' });
    w.innerHTML = `<svg viewBox="0 0 100 92" width="100%" height="100%">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFFFFF"/><stop offset=".5" stop-color="#B8FBFF"/><stop offset="1" stop-color="#55D8FF"/></linearGradient>
<linearGradient id="${id}b" x1="1" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#E9D9FF"/><stop offset="1" stop-color="#8E7BFF"/></linearGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#7DF9FF"/><stop offset="1" stop-color="#1F6FD6"/></linearGradient>
<linearGradient id="${id}d" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#FFC6EC"/><stop offset="1" stop-color="#5B8CFF"/></linearGradient>
<linearGradient id="${id}e" x1="0" y1="0" x2="1" y2="0"><stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>
<clipPath id="${id}k"><path d="M25 10H75L95 34L50 88L5 34Z"/></clipPath>
</defs>
<path d="M25 10L5 34H32Z" fill="url(#${id}b)"/>
<path d="M25 10L32 34L50 10Z" fill="url(#${id}a)"/>
<path d="M50 10L32 34H68Z" fill="#F4FEFF"/>
<path d="M50 10L68 34L75 10Z" fill="url(#${id}a)"/>
<path d="M75 10L68 34H95Z" fill="url(#${id}d)"/>
<path d="M5 34H32L50 88Z" fill="url(#${id}c)"/>
<path d="M32 34H68L50 88Z" fill="url(#${id}a)"/>
<path d="M68 34H95L50 88Z" fill="url(#${id}b)"/>
<g clip-path="url(#${id}k)"><g class="gd-reflexo"><rect x="-60" y="-10" width="34" height="120" fill="url(#${id}e)" transform="rotate(20 50 46)"/></g></g>
<path d="M25 10H75L95 34L50 88L5 34Z M5 34H95 M25 10L32 34L50 88L68 34L75 10 M50 10L32 34 M50 10L68 34" fill="none" stroke="#fff" stroke-opacity=".7" stroke-width="1.2" stroke-linejoin="round"/>
<path class="gd-faisca f1" d="M84 4l2.2 6.8L93 13l-6.8 2.2L84 22l-2.2-6.8L75 13l6.8-2.2z" fill="#fff"/>
<path class="gd-faisca f2" d="M12 50l1.4 4.1 4.1 1.4-4.1 1.4L12 61l-1.4-4.1L6.5 55.5l4.1-1.4z" fill="#fff"/>
<path class="gd-faisca f3" d="M70 60l1.2 3.3 3.3 1.2-3.3 1.2L70 69l-1.2-3.3-3.3-1.2 3.3-1.2z" fill="#fff"/>
</svg>`;
    return w;
  }
  // ---------- avatar do jogador ----------
  // a cobrinha montada peça por peça (pele, desenho, olhos, boca, cabeça, rosto, fundo).
  // Tudo desenhado aqui em SVG: fica nítido em qualquer tamanho e não ocupa armazenamento
  const AV_CORES = {
    verde: '#22E07A', lima: '#A6F03C', ciano: '#2FE3F2', azul: '#3B82F6', roxo: '#8B5CF6', rosa: '#FF5FB7',
    vermelho: '#F23B3B', laranja: '#FF7A1A', amarelo: '#FFD23F', dourado: '#E0A526', branco: '#E9ECF4', preto: '#424857',
  };
  const AV_FUNDOS = {
    brasa: ['#6A2A0A', '#150703'], noite: ['#1B3A72', '#060B18'], roxo: ['#47207A', '#0D0518'], mata: ['#12583A', '#03120B'],
    sangue: ['#6E1220', '#140306'], gelo: ['#0F5E6E', '#031317'], ouro: ['#7A5512', '#170F03'], aco: ['#424A58', '#0C0E12'],
  };
  const AV_PARTES = {
    padrao: ['lisa', 'listras', 'pintas', 'losango', 'raio', 'chamas', 'faixa'],
    olhos: ['normal', 'bravo', 'sono', 'feliz', 'fenda', 'neon', 'estrela', 'fofo'],
    boca: ['sorriso', 'lingua', 'presas', 'deboche', 'serio', 'aberta'],
    cabeca: ['nada', 'bone', 'headset', 'bandana', 'gorro', 'chifres', 'aureola', 'cowboy', 'viking'],
    rosto: ['nada', 'escuros', 'visor', 'redondo', 'tapa', 'cicatriz', 'mascara'],
    estampa: ['liso', 'hex', 'raios', 'bolinhas', 'grade'],
  };
  const AV_PADRAO = { pele: 'verde', cor2: 'amarelo', padrao: 'lisa', olhos: 'normal', boca: 'sorriso', cabeca: 'nada', rosto: 'nada', cor3: 'laranja', fundo: 'brasa', estampa: 'hex' };
  // o que veio do banco passa por aqui: valor que não existe vira o padrão
  function avLimpo(a) {
    if (!a || typeof a !== 'object') return null;
    const o = {};
    for (const [k, v] of Object.entries(AV_PADRAO)) {
      const ok = k === 'pele' || k === 'cor2' || k === 'cor3' ? AV_CORES[a[k]] : k === 'fundo' ? AV_FUNDOS[a[k]] : AV_PARTES[k].includes(a[k]);
      o[k] = ok ? a[k] : v;
    }
    if (AV_SKINS[a.skin]) o.skin = a.skin;
    return o;
  }
  const avSorteia = (l) => l[Math.floor(Math.random() * l.length)];
  function avAleatorio() {
    const cores = Object.keys(AV_CORES);
    const pele = avSorteia(cores);
    return {
      pele, cor2: avSorteia(cores.filter((c) => c !== pele)), cor3: avSorteia(cores),
      padrao: avSorteia(AV_PARTES.padrao), olhos: avSorteia(AV_PARTES.olhos), boca: avSorteia(AV_PARTES.boca),
      cabeca: Math.random() < .3 ? 'nada' : avSorteia(AV_PARTES.cabeca), rosto: Math.random() < .55 ? 'nada' : avSorteia(AV_PARTES.rosto),
      fundo: avSorteia(Object.keys(AV_FUNDOS)), estampa: avSorteia(AV_PARTES.estampa),
    };
  }
  // ---------- skins lendárias ----------
  // Só pra quem já foi campeão de temporada: a skin troca a cobra inteira (corpo, cabeça, rosto e fundo)
  // por uma arte pronta e animada. titulos = quantas temporadas precisa ter ganhado.
  // O banco confere de novo na hora de salvar (jogador_avatar), então não dá pra burlar pelo site.
  const AV_SKINS = {
    naja: { nome: 'Naja de Ouro', titulos: 1, anel: ['#FFF3B0', '#F2C14E', '#1F4FD8', '#2EC4B6', '#B07A12', '#FFF3B0'] },
    gelo: { nome: 'Zero Absoluto', titulos: 1, anel: ['#FFFFFF', '#8BE3FF', '#2C7FD6', '#B9F3FF', '#5B6CFF', '#FFFFFF'] },
    ciborgue: { nome: 'Ciborgue', titulos: 2, anel: ['#E8FFE0', '#7CFF4F', '#1FAF5A', '#C9D1DA', '#0B3D24', '#E8FFE0'] },
    cosmica: { nome: 'Cósmica', titulos: 2, anel: ['#7DF9FF', '#C77DFF', '#FF5FB7', '#3A1C9A', '#7DF9FF', '#FFFFFF'] },
    diamante: { nome: 'Rei Diamante', titulos: 3, anel: ['#FFFFFF', '#7DE3FF', '#B79BFF', '#FF8FB1', '#FFD36E', '#8BFFB0'] },
  };
  const RARIDADE = { 1: 'LENDÁRIA', 2: 'MÍTICA', 3: 'SUPREMA' };
  // [x, y, raio] de cada gomo do corpo, do rabo até o pescoço (o mesmo desenho do avatar comum)
  const AV_GOMOS = Array.from({ length: 9 }, (_, i) => {
    const u = i / 8, bz = (p0, p1, p2, p3) => (1 - u) ** 3 * p0 + 3 * (1 - u) ** 2 * u * p1 + 3 * (1 - u) * u * u * p2 + u ** 3 * p3;
    return [+bz(-4, 26, 82, 56).toFixed(1), +bz(100, 80, 112, 76).toFixed(1), +(11 + 5 * Math.min(1, u * 1.6)).toFixed(1)];
  });
  const AV_CAB = 'M50 21C67 21 79 32 79 46C79 61 66 72 50 72C34 72 21 61 21 46C21 32 33 21 50 21Z';
  const AV_OL = [[38.5, 45], [61.5, 45]];
  // faísca de 4 pontas (cx, cy, raio)
  const estrelinha = (x, y, r) => `M${x} ${y - r}Q${x + r * .14} ${y - r * .14} ${x + r} ${y}Q${x + r * .14} ${y + r * .14} ${x} ${y + r}Q${x - r * .14} ${y + r * .14} ${x - r} ${y}Q${x - r * .14} ${y - r * .14} ${x} ${y - r}Z`;
  const f1 = (n) => +n.toFixed(1);

  // devolve { fundo, arte, defs }: fundo fica fora da escala, arte é a cobra (dentro do zoom de 1.14)
  function skinArte(s, id) {
    const u = (g) => `url(#${id}${g})`;
    const tr = (cor, w = 1.6) => `stroke="${cor}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
    const rg = (g, stops, cx = .36, cy = .3, r = .75) => `<radialGradient id="${id}${g}" cx="${cx}" cy="${cy}" r="${r}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</radialGradient>`;
    const lg = (g, stops, x2 = 0, y2 = 1) => `<linearGradient id="${id}${g}" x1="0" y1="0" x2="${x2}" y2="${y2}">${stops.map(([o, c, op = 1]) => `<stop offset="${o}" stop-color="${c}" stop-opacity="${op}"/>`).join('')}</linearGradient>`;
    const brilho = (b = 1.6) => `<filter id="${id}n" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="${b}" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`
      + `<filter id="${id}b" x="-.5" y="-.5" width="2" height="2"><feGaussianBlur stdDeviation="3"/></filter>`;
    let defs = brilho() + `<clipPath id="${id}k"><path d="${AV_CAB}"/></clipPath>`;
    // reflexo que passa pela cabeça de tempos em tempos
    const reflexo = `<g clip-path="${u('k')}"><rect class="sk-reflexo" x="10" y="0" width="12" height="100" transform="skewX(-22)" fill="#fff" fill-opacity=".38"/></g>`;
    const gomos = (fn) => AV_GOMOS.map(([x, y, r], i) => fn(x, y, r, i)).join('');
    const luzGomo = (x, y, r, op = .3) => `<ellipse cx="${f1(x - r * .32)}" cy="${f1(y - r * .48)}" rx="${f1(r * .38)}" ry="${f1(r * .18)}" transform="rotate(-25 ${f1(x - r * .32)} ${f1(y - r * .48)})" fill="#fff" fill-opacity="${op}"/>`;
    const sombraPescoco = `<ellipse cx="52" cy="72" rx="22" ry="5.5" fill="#000" fill-opacity=".38"/>`;
    const estrelas = (lista, cor = '#fff') => lista.map(([x, y, r, d], i) => `<path class="sk-pisca" style="animation-delay:${d ?? (i * .37) % 2.4}s" d="${estrelinha(x, y, r)}" fill="${cor}"/>`).join('');
    let fundo = '', arte = '';

    if (s === 'naja') {
      // faraó: ouro, lápis-lazúli e turquesa; capuz de naja aberto e o sol do deserto atrás
      const OURO = [[0, '#FFF8D6'], [.3, '#FFD95A'], [.65, '#D99A1E'], [1, '#6B3D00']];
      defs += rg('f', [[0, '#1C3E9E'], [.55, '#0A1A52'], [1, '#02061A']], .5, .36, .75)
        + rg('s', [[0, '#FFFBE0'], [.35, '#FFD95A'], [.8, '#F29A00', .5], [1, '#F29A00', 0]], .5, .5, .5)
        + rg('h', OURO, .38, .28) + rg('p', OURO) + lg('c', [[0, '#FFE58A'], [.5, '#E0A526'], [1, '#7A4A00']])
        + rg('l', [[0, '#6E9BFF'], [.5, '#1F4FD8'], [1, '#0B2470']]) + rg('t', [[0, '#C8FFF8'], [.5, '#2EC4B6'], [1, '#0B6B63']])
        + rg('o', [[0, '#F6FFB8'], [.5, '#3BE8C8'], [1, '#04605A']], .45, .4, .6)
        + `<clipPath id="${id}cp"><path d="M50 16C68 16 86 30 88 52C90 68 80 80 66 84L34 84C20 80 10 68 12 52C14 30 32 16 50 16Z"/></clipPath>`;
      const raios = Array.from({ length: 16 }, (_, i) => {
        const g = Math.PI * 2 * i / 16, p = (d) => `${f1(50 + 80 * Math.cos(g + d))},${f1(40 + 80 * Math.sin(g + d))}`;
        return `<polygon points="50,40 ${p(-.06)} ${p(.06)}"/>`;
      }).join('');
      fundo = `<rect width="100" height="100" fill="${u('f')}"/>`
        + estrelas([[12, 14, 1.6], [86, 12, 1.4], [92, 34, 1], [8, 38, 1.1], [24, 6, .9], [74, 4, 1]])
        + `<g class="sk-gira" style="animation-duration:40s"><g fill="#FFD95A" fill-opacity=".16">${raios}</g></g>`
        + `<circle cx="50" cy="40" r="38" fill="${u('s')}"/>`
        + `<path d="M58 100L80 72L102 100Z" fill="#1A0F2E"/><path d="M80 72L102 100H88Z" fill="#000" fill-opacity=".35"/><path d="M76 100L92 80L108 100Z" fill="#120A22"/>`;
      // capuz aberto (atrás da cabeça), com as faixas do colar egípcio
      const capuz = 'M50 16C68 16 86 30 88 52C90 68 80 80 66 84L34 84C20 80 10 68 12 52C14 30 32 16 50 16Z';
      const faixas = [[1, 'l'], [2, 'c'], [3, 't'], [4, 'c'], [5, 'l']].map(([n, g]) => {
        const k = 1 - n * .09;
        return `<path d="M50 ${f1(15 + n * 4)}C${f1(50 + 35 * k)} ${f1(15 + n * 4)} ${f1(50 + 38 * k)} ${f1(52)} ${f1(50 + 38 * k)} ${f1(56)}C${f1(50 + 38 * k)} ${f1(72)} ${f1(50 + 20 * k)} 84 50 84C${f1(50 - 20 * k)} 84 ${f1(50 - 38 * k)} 72 ${f1(50 - 38 * k)} 56C${f1(50 - 38 * k)} 52 ${f1(50 - 35 * k)} ${f1(15 + n * 4)} 50 ${f1(15 + n * 4)}Z" fill="${u(g)}" stroke="#3A1E00" stroke-width=".9"/>`;
      }).join('');
      const corpo = gomos((x, y, r, i) => {
        const lapis = (AV_GOMOS.length - 1 - i) % 2 === 1;
        return `<circle cx="${x}" cy="${y}" r="${r}" fill="${u(lapis ? 'l' : 'p')}" ${tr('#3A1E00', 1.3)}/>`
          + (lapis ? `<circle cx="${x}" cy="${y}" r="${f1(r * .7)}" fill="none" stroke="#FFD95A" stroke-width="1.4"/>` : `<path d="${gema(x, y - r * .1, r * .4)}" fill="${u('t')}" ${tr('#0B4B45', .9)}/>`)
          + luzGomo(x, y, r, .35);
      });
      const olho = ([x, y], lado) => `<path d="M${x - 10 * lado} ${y - 1}Q${x} ${y - 11} ${x + 11 * lado} ${y - 3}L${x + 17 * lado} ${y - 5}L${x + 12 * lado} ${y + 1}Q${x} ${y + 9} ${x - 10 * lado} ${y - 1}Z" fill="#0A0A10"/>`
        + `<ellipse cx="${x}" cy="${y - .5}" rx="7.4" ry="6" fill="${u('o')}" filter="${u('n')}"/>`
        + `<ellipse cx="${x}" cy="${y - .5}" rx="1.6" ry="5.2" fill="#05070A"/><circle cx="${x - 2.6 * lado}" cy="${y - 3}" r="1.4" fill="#fff"/>`
        + `<path d="M${x - 9 * lado} ${y - 6}Q${x + 2 * lado} ${y - 14} ${x + 14 * lado} ${y - 9}" fill="none" stroke="#1F4FD8" stroke-width="2.2" stroke-linecap="round"/>`;
      arte = `<g filter="${u('b')}" opacity=".7"><path d="${capuz}" fill="#FFB020" fill-opacity=".5"/></g>`
        + `<path d="${capuz}" fill="${u('c')}" ${tr('#3A1E00', 1.8)}/><g clip-path="${u('cp')}">${faixas}</g>`
        + `<path d="${capuz}" fill="none" ${tr('#3A1E00', 1.8)}/>`
        + corpo + sombraPescoco
        + `<path d="${AV_CAB}" fill="${u('h')}" ${tr('#3A1E00', 1.8)}/>`
        + `<g clip-path="${u('k')}"><path d="M50 18L56 21L53 36L47 36L44 21Z" fill="${u('l')}" ${tr('#0B2470', .8)}/><path d="M18 60C30 74 70 74 82 60V80H18Z" fill="#5A3000" fill-opacity=".22"/></g>`
        + `<path d="M50 23C53 23 55 26 55 29C55 33 50 37 50 37C50 37 45 33 45 29C45 26 47 23 50 23Z" fill="${u('t')}" ${tr('#3A1E00', 1.2)} filter="${u('n')}"/>`
        + `<ellipse cx="48.4" cy="27.6" rx="1.4" ry="2" fill="#fff" fill-opacity=".8"/>`
        + `<ellipse cx="38" cy="29" rx="10" ry="4.5" transform="rotate(-18 38 29)" fill="#fff" fill-opacity=".38"/>`
        + reflexo + `<path d="${AV_CAB}" fill="none" ${tr('#3A1E00', 1.8)}/>`
        + olho(AV_OL[0], -1) + olho(AV_OL[1], 1)
        + `<ellipse cx="46" cy="57" rx="1.3" ry="1" fill="#3A1E00"/><ellipse cx="54" cy="57" rx="1.3" ry="1" fill="#3A1E00"/>`
        + `<path d="M41 62Q50 67 59 61.5" fill="none" ${tr('#3A1E00', 2.2)}/>`
        + `<path d="M48.8 64.4H51.2V68.6L53.4 72.6L50.9 70.6L50 72.4L49.1 70.6L46.6 72.6L48.8 68.6Z" fill="#E8174F" ${tr('#5A0618', .8)}/>`;
    }

    if (s === 'gelo') {
      // zero absoluto: cristal de gelo, coroa de estalactites e aurora boreal no céu
      const GELO = [[0, '#F4FEFF'], [.35, '#A9EEFF'], [.7, '#3D8EE0'], [1, '#0D2F7A']];
      defs += rg('f', [[0, '#0E2D5C'], [.6, '#061631'], [1, '#01040C']], .5, .3, .8)
        + lg('a1', [[0, '#3DFFB0', 0], [.5, '#3DFFB0', .75], [1, '#3DFFB0', 0]], 1, 0) + lg('a2', [[0, '#7A5BFF', 0], [.5, '#B07CFF', .6], [1, '#7A5BFF', 0]], 1, 0)
        + rg('h', GELO, .38, .26) + rg('p', GELO) + lg('c', [[0, '#FFFFFF'], [.45, '#C9F6FF'], [1, '#4BA8F0']])
        + rg('o', [[0, '#FFFFFF'], [.4, '#CFFBFF'], [1, '#2BB8FF']], .5, .5, .55);
      const neve = [[8, 1.2, 0], [20, .8, 1.6], [33, 1, 3.1], [70, 1.1, .7], [82, .8, 2.3], [93, 1.2, 3.8], [55, .7, 4.6], [44, .9, 2.8]];
      fundo = `<rect width="100" height="100" fill="${u('f')}"/>`
        + `<g filter="${u('b')}"><path class="sk-aurora" d="M-10 30C10 14 30 34 50 20C70 6 90 26 110 12V30C90 44 70 24 50 38C30 52 10 32 -10 46Z" fill="${u('a1')}"/>`
        + `<path class="sk-aurora" style="animation-delay:-3s;animation-duration:9s" d="M-10 16C14 4 30 22 52 10C74 -2 92 14 110 4V16C92 28 74 12 52 24C30 36 14 18 -10 30Z" fill="${u('a2')}"/></g>`
        + estrelas([[14, 8, 1.1], [86, 10, 1.3], [92, 42, .9], [6, 50, 1]], '#E6FBFF')
        + neve.map(([x, r, d]) => `<circle class="sk-neve" style="animation-delay:-${d}s" cx="${x}" cy="0" r="${r}" fill="#fff" fill-opacity=".85"/>`).join('');
      const facetas = (x, y, r) => `<path d="M${x} ${f1(y - r)}L${f1(x + r * .5)} ${y}L${x} ${f1(y + r * .6)}L${f1(x - r * .55)} ${f1(y + r * .1)}Z" fill="#fff" fill-opacity=".18"/><path d="M${x} ${f1(y - r)}L${f1(x + r * .5)} ${y}L${f1(x + r)} ${f1(y - r * .2)}" fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"/>`;
      const corpo = gomos((x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${u('p')}" ${tr('#0A2A66', 1.3)}/>${facetas(x, y, r)}${luzGomo(x, y, r, .5)}`);
      // coroa de gelo: 5 pontas, a do meio maior
      const ponta = (x, base, alt, larg) => `<path d="M${f1(x - larg)} ${base}L${f1(x - larg * .25)} ${f1(base - alt * .55)}L${x} ${f1(base - alt)}L${f1(x + larg * .3)} ${f1(base - alt * .5)}L${f1(x + larg)} ${base}Z" fill="${u('c')}" ${tr('#1D5FB8', 1.1)}/><path d="M${x} ${f1(base - alt)}L${f1(x - larg * .25)} ${f1(base - alt * .55)}L${f1(x - larg * .1)} ${base}" fill="none" stroke="#fff" stroke-opacity=".9" stroke-width=".8"/>`;
      const coroa = ponta(29, 31, 13, 5) + ponta(71, 31, 13, 5) + ponta(39, 25, 19, 5.5) + ponta(61, 25, 19, 5.5) + ponta(50, 23, 26, 6.5);
      const rachas = `<g fill="none" stroke="#fff" stroke-opacity=".5" stroke-width=".9"><path d="M24 40L33 47L29 58M33 47L42 50"/><path d="M76 38L68 46L72 57M68 46L60 49"/><path d="M40 66L50 60L60 66"/></g>`
        + `<g fill="#fff" fill-opacity=".12"><path d="M21 46L35 28L45 46Z"/><path d="M79 46L65 28L55 46Z"/></g>`;
      const olho = ([x, y]) => `<path d="M${x - 9} ${y + 1}Q${x} ${y - 10} ${x + 9} ${y + 1}Q${x} ${y + 7} ${x - 9} ${y + 1}Z" fill="#06122E" ${tr('#0A2A66', 1.4)}/>`
        + `<ellipse class="sk-pulsa" cx="${x}" cy="${y - .4}" rx="6" ry="4.2" fill="${u('o')}" filter="${u('n')}"/>`
        + `<path d="${gema(x, y - .4, 2.6)}" fill="#0B5FD8"/><circle cx="${x - 2.4}" cy="${y - 2.2}" r="1.2" fill="#fff"/>`;
      arte = corpo + sombraPescoco
        + `<g filter="${u('b')}" opacity=".8"><path d="M50 -4L62 20H38Z" fill="#9FF0FF" fill-opacity=".55"/></g>`
        + coroa
        + `<path d="${AV_CAB}" fill="${u('h')}" ${tr('#0A2A66', 1.8)}/>`
        + `<g clip-path="${u('k')}">${rachas}<path d="M18 62C30 76 70 76 82 62V80H18Z" fill="#06205A" fill-opacity=".3"/></g>`
        + `<ellipse cx="38" cy="29" rx="10" ry="4.5" transform="rotate(-18 38 29)" fill="#fff" fill-opacity=".55"/>`
        + reflexo + `<path d="${AV_CAB}" fill="none" ${tr('#0A2A66', 1.8)}/>`
        + `<path d="M22 50L19 56L24 54ZM78 50L81 56L76 54ZM34 70L33 76L37 72ZM66 70L67 76L63 72Z" fill="#E6FBFF" ${tr('#4BA8F0', .6)}/>`
        + AV_OL.map(olho).join('')
        + `<ellipse cx="46" cy="56" rx="1.3" ry="1" fill="#0A2A66" fill-opacity=".8"/><ellipse cx="54" cy="56" rx="1.3" ry="1" fill="#0A2A66" fill-opacity=".8"/>`
        + `<path d="M41 62H59" ${tr('#0A2A66', 2.2)}/><path d="M44 62L45.6 66.5L47.2 62ZM56 62L54.4 66.5L52.8 62Z" fill="#fff" ${tr('#0A2A66', .7)}/>`
        + `<g class="sk-halito" fill="#DDF8FF" fill-opacity=".5" filter="${u('b')}"><ellipse cx="50" cy="70" rx="7" ry="3"/></g>`
        + estrelas([[50, -2, 3.2, 0], [37, 5, 2, .8], [65, 8, 2.2, 1.5], [26, 18, 1.6, 2]]);
    }

    if (s === 'ciborgue') {
      // ciborgue: cobra de metal cromado, circuitos neon com dados correndo, visor que escaneia e chuva de código atrás
      const CROMO = [[0, '#FFFFFF'], [.3, '#DDE3EA'], [.65, '#7D8896'], [1, '#262C35']];
      defs += rg('f', [[0, '#0B3D24'], [.55, '#04170D'], [1, '#010503']], .5, .4, .8)
        + rg('h', CROMO, .38, .26) + rg('p', CROMO) + lg('v', [[0, '#0E2A1A'], [.5, '#03100A'], [1, '#000']])
        + rg('led', [[0, '#F4FFE8'], [.4, '#9CFF6B'], [1, '#1FAF5A']], .5, .5, .55)
        + `<clipPath id="${id}vi"><path d="M21 37.5C35 34 65 34 79 37.5L78 52C65 55 35 55 22 52Z"/></clipPath>`;
      // chuva de código: colunas de tracinhos verdes descendo, a ponta mais clara
      const colunas = [[5, 3.1, 0], [15, 2.6, 1.4], [26, 3.6, .6], [37, 2.9, 2.2], [63, 3.3, 1], [74, 2.7, 2.6], [85, 3.5, .3], [95, 3, 1.8]];
      fundo = `<rect width="100" height="100" fill="${u('f')}"/>`
        + `<g stroke="#7CFF4F" stroke-opacity=".08" stroke-width=".6" fill="none"><path d="M0 20H100M0 40H100M0 60H100M0 80H100M20 0V100M40 0V100M60 0V100M80 0V100"/></g>`
        + colunas.map(([x, dur, atraso]) => `<g class="sk-codigo" style="animation-duration:${dur}s;animation-delay:-${atraso}s">${Array.from({ length: 7 }, (_, i) => `<rect x="${x - .8}" y="${i * 5}" width="1.6" height="${i % 3 ? 2.6 : 3.4}" rx=".4" fill="${i === 6 ? '#F4FFE8' : '#7CFF4F'}" fill-opacity="${f1(.12 + i * .14)}"/>`).join('')}</g>`).join('');
      const circuito = (d) => `<path d="${d}" fill="none" stroke="#1FAF5A" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" opacity=".55"/>`
        + `<path class="sk-circuito" d="${d}" fill="none" stroke="#B8FF8F" stroke-width="1.1" stroke-linecap="round" stroke-dasharray="3 5" filter="${u('n')}"/>`;
      const corpo = gomos((x, y, r) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${u('p')}" ${tr('#1A1F26', 1.3)}/>`
        + `<circle cx="${x}" cy="${y}" r="${f1(r * .62)}" fill="none" stroke="#7CFF4F" stroke-width="1.1" stroke-opacity=".8" filter="${u('n')}"/>`
        + `<circle class="sk-pulsa" cx="${x}" cy="${y}" r="${f1(r * .2)}" fill="${u('led')}"/>` + luzGomo(x, y, r, .45));
      const parafuso = (x, y) => `<circle cx="${x}" cy="${y}" r="4.4" fill="${u('p')}" ${tr('#1A1F26', 1.2)}/><circle cx="${x}" cy="${y}" r="1.8" fill="${u('led')}" filter="${u('n')}"/>`;
      arte = corpo + sombraPescoco
        // antena com a luz piscando
        + `<path d="M50 22V9" stroke="#4A525E" stroke-width="2.4" stroke-linecap="round"/><path d="M50 22V9" stroke="#DDE3EA" stroke-width=".9" stroke-linecap="round"/>`
        + `<circle class="sk-pulsa" cx="50" cy="7.5" r="3.2" fill="${u('led')}" filter="${u('n')}"/>`
        + `<path d="${AV_CAB}" fill="${u('h')}" ${tr('#1A1F26', 1.8)}/>`
        + `<g clip-path="${u('k')}">`
        + `<path d="M50 21V36M30 26L36 35M70 26L64 35M21 58H32L37 64M79 58H68L63 64" fill="none" stroke="#2A313B" stroke-opacity=".55" stroke-width="1"/>`
        + circuito('M27 31H33L37 27H44M73 31H67L63 27H56') + circuito('M24 60L30 66H40M76 60L70 66H60')
        + `<path d="M18 60C30 74 70 74 82 60V80H18Z" fill="#0B0F14" fill-opacity=".25"/></g>`
        + `<ellipse cx="38" cy="29" rx="10" ry="4.5" transform="rotate(-18 38 29)" fill="#fff" fill-opacity=".5"/>`
        + reflexo + `<path d="${AV_CAB}" fill="none" ${tr('#1A1F26', 1.8)}/>`
        + parafuso(21.5, 47) + parafuso(78.5, 47)
        // visor: vidro escuro, dois olhos de luz e a linha que escaneia de um lado pro outro
        + `<path d="M19 36.5C34 32.5 66 32.5 81 36.5L80 53C66 56.5 34 56.5 20 53Z" fill="#14181E" ${tr('#0A0C10', 1.6)}/>`
        + `<path d="M21 37.5C35 34 65 34 79 37.5L78 52C65 55 35 55 22 52Z" fill="${u('v')}"/>`
        + `<g clip-path="${u('vi')}">${AV_OL.map(([x, y]) => `<ellipse cx="${x}" cy="${y}" rx="7.4" ry="3.6" fill="#7CFF4F" filter="${u('n')}"/><ellipse cx="${x}" cy="${y}" rx="4.2" ry="1.6" fill="#F4FFE8"/>`).join('')}`
        + `<rect class="sk-scan" x="48.5" y="33" width="3" height="24" fill="#B8FF8F" fill-opacity=".45" filter="${u('n')}"/>`
        + `<path d="M26 39C38 37 52 37 62 38" stroke="#fff" stroke-opacity=".35" stroke-width="1.4" stroke-linecap="round"/></g>`
        // boca de grade (alto-falante)
        + `<rect x="40" y="59" width="20" height="7.5" rx="3.75" fill="#14181E" ${tr('#0A0C10', 1.3)}/>`
        + `<g stroke="#7CFF4F" stroke-width="1.2" stroke-linecap="round" opacity=".85">${[44, 47.3, 50.6, 53.9, 57].map((x) => `<path d="M${x - .6} 61V64.5"/>`).join('')}</g>`;
    }

    if (s === 'cosmica') {
      // cósmica: o corpo é uma janela pro espaço, com nebulosa, estrelas e um anel de planeta
      defs += rg('f', [[0, '#2A0E5E'], [.55, '#0B0424'], [1, '#000']], .5, .4, .8)
        + rg('gx', [[0, '#FFFFFF'], [.12, '#FFD6F5'], [.4, '#C77DFF', .6], [1, '#3A1C9A', 0]], .5, .5, .5)
        + rg('h', [[0, '#3B2C8F'], [.55, '#120A3D'], [1, '#05021A']], .4, .3) + rg('p', [[0, '#34287F'], [.6, '#110935'], [1, '#04021A']])
        + rg('n1', [[0, '#FF5FB7', .85], [1, '#FF5FB7', 0]], .5, .5, .5) + rg('n2', [[0, '#2FE3F2', .75], [1, '#2FE3F2', 0]], .5, .5, .5)
        + lg('r', [[0, '#FFE3A3'], [.5, '#FF9FE0'], [1, '#7DF9FF']], 1, 0) + lg('ct', [[0, '#7DF9FF'], [.5, '#C77DFF'], [1, '#FF5FB7']], 1, 1)
        + rg('o', [[0, '#FFFFFF'], [.3, '#E9FDFF'], [.7, '#7DF9FF'], [1, '#3A6BFF']], .5, .5, .55)
        + `<pattern id="${id}st" width="20" height="20" patternUnits="userSpaceOnUse"><circle cx="3" cy="4" r=".55" fill="#fff"/><circle cx="13" cy="9" r=".4" fill="#fff" fill-opacity=".8"/><circle cx="8" cy="16" r=".7" fill="#fff"/><circle cx="17" cy="17" r=".35" fill="#fff"/></pattern>`;
      const braco = (rot) => `<path d="M50 44C64 30 86 36 84 52C82 62 70 64 64 58" fill="none" stroke="#C77DFF" stroke-opacity=".5" stroke-width="5" stroke-linecap="round" transform="rotate(${rot} 50 44)"/>`;
      fundo = `<rect width="100" height="100" fill="${u('f')}"/><rect width="100" height="100" fill="${u('st')}" opacity=".7"/>`
        + `<g class="sk-gira" style="animation-duration:60s"><g filter="${u('b')}">${braco(0)}${braco(180)}</g><ellipse cx="50" cy="44" rx="34" ry="34" fill="${u('gx')}" opacity=".5"/></g>`
        + estrelas([[10, 12, 2.2], [88, 20, 1.8], [80, 6, 1.1], [16, 44, 1.3], [92, 52, 1.5], [30, 4, 1.1], [70, 64, 1]]);
      const nebulosa = (dx = 0, dy = 0) => `<circle cx="${30 + dx}" cy="${36 + dy}" r="14" fill="${u('n1')}"/><circle cx="${66 + dx}" cy="${58 + dy}" r="16" fill="${u('n2')}"/><circle cx="${58 + dx}" cy="${28 + dy}" r="9" fill="${u('n1')}" opacity=".6"/>`;
      const corpo = gomos((x, y, r, i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${u('p')}"/>`
        + `<circle cx="${f1(x + (i % 2 ? 3 : -3))}" cy="${f1(y - 2)}" r="${f1(r * .7)}" fill="${u(i % 2 ? 'n1' : 'n2')}"/>`
        + `<circle cx="${x}" cy="${y}" r="${r}" fill="${u('st')}"/><circle cx="${x}" cy="${y}" r="${r}" fill="none" stroke="${u('ct')}" stroke-width="1.4"/>`);
      const anel = (metade) => `<path d="${metade ? 'M8 50A42 11 -12 0 0 92 32' : 'M8 50A42 11 -12 0 1 92 32'}" fill="none" stroke="${u('r')}" stroke-width="${metade ? 3.4 : 2.6}" stroke-linecap="round" ${metade ? '' : 'stroke-opacity=".55"'}/>`
        + (metade ? `<path class="sk-orbita" d="M8 50A42 11 -12 0 0 92 32" fill="none" stroke="#fff" stroke-width="3.6" stroke-linecap="round" stroke-dasharray="4 120" filter="${u('n')}"/>` : '');
      arte = corpo + sombraPescoco + anel(false)
        + `<g filter="${u('b')}" opacity=".9"><path d="${AV_CAB}" fill="none" stroke="#C77DFF" stroke-width="4"/></g>`
        + `<path d="${AV_CAB}" fill="${u('h')}"/>`
        + `<g clip-path="${u('k')}">${nebulosa()}<rect width="100" height="100" fill="${u('st')}"/>`
        + estrelas([[30, 30, 1.6, .3], [70, 30, 1.3, 1.1], [26, 58, 1.1, 1.9], [74, 62, 1.5, .7], [50, 26, 1.2, 2.2]]) + `</g>`
        + `<path d="${AV_CAB}" fill="none" stroke="${u('ct')}" stroke-width="2"/>`
        + `<ellipse cx="38" cy="29" rx="10" ry="4.5" transform="rotate(-18 38 29)" fill="#fff" fill-opacity=".22"/>`
        + AV_OL.map(([x, y], i) => `<circle cx="${x}" cy="${y}" r="8.4" fill="#05021A" stroke="${u('ct')}" stroke-width="1.4"/>`
          + `<circle cx="${x}" cy="${y}" r="6" fill="${u('o')}" filter="${u('n')}"/>`
          + `<path class="sk-gira" style="animation-duration:${i ? 7 : 9}s" d="${estrelinha(x, y, 4.6)}" fill="#fff"/><circle cx="${x}" cy="${y}" r="1.3" fill="#1A0A4A"/>`).join('')
        + `<path d="M41 60.5Q50 68 59 60.5" fill="none" stroke="#7DF9FF" stroke-width="2.2" stroke-linecap="round" filter="${u('n')}"/>`
        + `<circle cx="46" cy="55.6" r="1" fill="#7DF9FF" fill-opacity=".7"/><circle cx="54" cy="55.6" r="1" fill="#7DF9FF" fill-opacity=".7"/>`
        + anel(true);
    }

    if (s === 'diamante') {
      // rei diamante: cobra de diamante lapidado com brilho de arco-íris, coroa de ouro com joias e luz colorida girando atrás
      const PEDRA = [[0, '#FFFFFF'], [.35, '#E4F6FF'], [.7, '#A9C8FF'], [1, '#6A6FD8']];
      const ARCO = ['#FF8FB1', '#FFD36E', '#8BFFB0', '#7DE3FF', '#B79BFF'];
      defs += rg('f', [[0, '#2B2470'], [.55, '#120E3A'], [1, '#05031A']], .5, .4, .8)
        + rg('h', PEDRA, .36, .24) + rg('p', PEDRA) + lg('ou', [[0, '#FFF8D6'], [.35, '#FFD95A'], [.75, '#D9930E'], [1, '#7A4A00']])
        + `<linearGradient id="${id}ar" x1="0" y1="0" x2="1" y2="0">${ARCO.map((c, i) => `<stop offset="${i / 4}" stop-color="${c}"/>`).join('')}</linearGradient>`
        + rg('ir', [[0, '#E9FDFF'], [.45, '#7DC8FF'], [1, '#6A4FE0']], .4, .35, .7)
        + rg('aura', [[0, '#FFFFFF', .7], [.45, '#C9B8FF', .3], [1, '#C9B8FF', 0]], .5, .5, .5);
      const raios = Array.from({ length: 20 }, (_, i) => {
        const g = Math.PI * 2 * i / 20, p = (d) => `${f1(50 + 85 * Math.cos(g + d))},${f1(44 + 85 * Math.sin(g + d))}`;
        return `<polygon points="50,44 ${p(-.07)} ${p(.07)}" fill="${ARCO[i % 5]}"/>`;
      }).join('');
      const pedrinha = (x, y, r, atraso) => `<g class="sk-flutua" style="animation-delay:-${atraso}s"><path d="M${x} ${y - r}L${f1(x + r * .8)} ${y}L${x} ${y + r}L${f1(x - r * .8)} ${y}Z" fill="${u('p')}" stroke="#fff" stroke-width=".6"/><path d="M${f1(x - r * .8)} ${y}H${f1(x + r * .8)}" stroke="#fff" stroke-opacity=".7" stroke-width=".5"/></g>`;
      fundo = `<rect width="100" height="100" fill="${u('f')}"/>`
        + `<g class="sk-gira" style="animation-duration:20s"><g fill-opacity=".2">${raios}</g></g>`
        + `<circle cx="50" cy="44" r="38" fill="${u('aura')}"/>`
        + pedrinha(12, 30, 4, 0) + pedrinha(88, 26, 3.4, 1) + pedrinha(90, 64, 2.6, .5) + pedrinha(9, 62, 3, 1.5)
        + estrelas([[20, 10, 2.2, 0], [80, 8, 2, 1.1], [94, 44, 1.6, .6], [6, 46, 1.6, 1.8], [70, 92, 1.4, .9]]);
      // facetas do diamante: triângulos claros e linhas de lapidação
      const facetas = `<g fill="#fff"><path d="M50 21L36 40H64Z" fill-opacity=".22"/><path d="M21 46L36 40L30 60Z" fill-opacity=".14"/><path d="M79 46L64 40L70 60Z" fill-opacity=".1"/></g>`
        + `<g fill="none" stroke="#fff" stroke-opacity=".55" stroke-width=".8"><path d="M50 21L36 40L21 46M50 21L64 40L79 46M36 40H64M36 40L30 60L40 71M64 40L70 60L60 71"/></g>`;
      const corpo = gomos((x, y, r, i) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${u('p')}" ${tr('#4A4FB0', 1.2)}/>`
        + `<path d="M${f1(x - r * .7)} ${f1(y - r * .1)}L${x} ${f1(y - r * .75)}L${f1(x + r * .7)} ${f1(y - r * .1)}L${x} ${f1(y + r * .55)}Z" fill="#fff" fill-opacity=".16" stroke="#fff" stroke-opacity=".5" stroke-width=".7"/>`
        + `<circle cx="${x}" cy="${y}" r="${f1(r * .92)}" fill="none" stroke="${u('ar')}" stroke-width="1.2" stroke-opacity="${i % 2 ? .5 : .8}"/>` + luzGomo(x, y, r, .55));
      // coroa de ouro com joias e pérolas nas pontas
      const coroa = `<path d="M33 26L30.5 12L39 18.5L44 8.5L50 16L56 8.5L61 18.5L69.5 12L67 26Z" fill="${u('ou')}" ${tr('#5E3300', 1.3)}/>`
        + `<path d="M33.5 24L32 15M44 11L46 22M56 11L54 22M68 15L66.5 24" stroke="#FFF8D6" stroke-opacity=".6" stroke-width=".8"/>`
        + `<rect x="32" y="22.5" width="36" height="6" rx="2.5" fill="${u('ou')}" ${tr('#5E3300', 1.2)}/>`
        + [[30.5, 12], [44, 8.5], [56, 8.5], [69.5, 12]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="1.9" fill="#FFFDF5" ${tr('#5E3300', .7)}/>`).join('')
        + `<path d="${gema(50, 25.5, 2.8)}" fill="#E9FDFF" ${tr('#3A4FB0', .7)}/>`
        + `<circle cx="41" cy="25.5" r="1.7" fill="#3B82F6" ${tr('#1A2E70', .6)}/><circle cx="59" cy="25.5" r="1.7" fill="#22E07A" ${tr('#0B4B2A', .6)}/>`
        + `<path class="sk-pisca" d="${estrelinha(50, 16, 3)}" fill="#fff"/>`;
      arte = corpo + sombraPescoco
        + `<path d="${AV_CAB}" fill="${u('h')}" ${tr('#3A3F9A', 1.8)}/>`
        + `<g clip-path="${u('k')}">${facetas}<rect class="sk-reflexo" x="10" y="0" width="14" height="100" transform="skewX(-22)" fill="${u('ar')}" fill-opacity=".45"/>`
        + `<path d="M18 62C30 76 70 76 82 62V80H18Z" fill="#3A2F9A" fill-opacity=".18"/></g>`
        + `<ellipse cx="38" cy="30" rx="10" ry="4.5" transform="rotate(-18 38 30)" fill="#fff" fill-opacity=".6"/>`
        + `<path d="${AV_CAB}" fill="none" ${tr('#3A3F9A', 1.8)}/>`
        // olhos grandes e simpáticos
        + AV_OL.map(([x, y]) => `<circle cx="${x}" cy="${y + .5}" r="9" fill="#FDFDFF" ${tr('#3A3F9A', 1.6)}/>`
          + `<circle cx="${x + .5}" cy="${y + 1.2}" r="6.4" fill="${u('ir')}"/><circle cx="${x + .6}" cy="${y + 1.4}" r="3.4" fill="#1A1440"/>`
          + `<path d="${gema(x - 2, y - 1.6, 2.2)}" fill="#fff"/><circle cx="${x + 2.8}" cy="${y + 4}" r="1" fill="#fff"/>`).join('')
        + `<ellipse cx="46" cy="56" rx="1.2" ry=".9" fill="#3A3F9A" fill-opacity=".7"/><ellipse cx="54" cy="56" rx="1.2" ry=".9" fill="#3A3F9A" fill-opacity=".7"/>`
        + `<path d="M40.5 60.5Q50 69 59.5 60.5" fill="none" ${tr('#3A3F9A', 2.4)}/>`
        + `<ellipse cx="31" cy="58" rx="4" ry="2.2" fill="#FF8FB1" fill-opacity=".45"/><ellipse cx="69" cy="58" rx="4" ry="2.2" fill="#FF8FB1" fill-opacity=".45"/>`
        + coroa;
    }
    return { fundo, arte, defs };
  }
  let numAv = 0;
  function avatarSVG(av, zoom = false) {
    const a = avLimpo(av) || AV_PADRAO;
    const id = 'av' + (++numAv);
    if (a.skin) { const k = skinArte(a.skin, id); return avEmbrulho(id, zoom, k.defs, k.fundo, k.arte); }
    const c = AV_CORES[a.pele], c2 = AV_CORES[a.cor2], c3 = AV_CORES[a.cor3];
    const [f1, f2] = AV_FUNDOS[a.fundo];
    const linha = tom(c, -.68);
    const tr = (cor = linha, w = 1.6) => `stroke="${cor}" stroke-width="${w}" stroke-linejoin="round" stroke-linecap="round"`;
    const grad = (gid, cor, cx = .36, cy = .3) => `<radialGradient id="${id}${gid}" cx="${cx}" cy="${cy}" r=".75"><stop offset="0" stop-color="${tom(cor, .45)}"/><stop offset=".55" stop-color="${cor}"/><stop offset="1" stop-color="${tom(cor, -.42)}"/></radialGradient>`;
    const lin = (gid, cor) => `<linearGradient id="${id}${gid}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${tom(cor, .35)}"/><stop offset=".5" stop-color="${cor}"/><stop offset="1" stop-color="${tom(cor, -.4)}"/></linearGradient>`;
    const CAB = AV_CAB, OL = AV_OL; // OL = centro dos olhos
    let defs = grad('p', c) + grad('q', c2) + lin('x', c3) + grad('y', c3)
      + `<radialGradient id="${id}h" gradientUnits="userSpaceOnUse" cx="42" cy="32" r="44"><stop offset="0" stop-color="${tom(c, .5)}"/><stop offset=".5" stop-color="${c}"/><stop offset="1" stop-color="${tom(c, -.45)}"/></radialGradient>`
      + `<radialGradient id="${id}f" cx=".5" cy=".38" r=".7"><stop offset="0" stop-color="${f1}"/><stop offset="1" stop-color="${f2}"/></radialGradient>`
      + `<clipPath id="${id}k"><path d="${CAB}"/></clipPath>`;

    // fundo + estampa
    let fundo = `<rect width="100" height="100" fill="url(#${id}f)"/>`;
    const claro = tom(f1, .55);
    if (a.estampa === 'hex') {
      defs += `<pattern id="${id}e" width="14" height="24.25" patternUnits="userSpaceOnUse" patternTransform="translate(3 2)"><path d="M7 0L14 4V12.1L7 16.2L0 12.1V4ZM7 16.2V24.25M0 4L-7 0M14 4L21 0" fill="none" stroke="${claro}" stroke-opacity=".22" stroke-width="1"/></pattern>`;
      fundo += `<rect width="100" height="100" fill="url(#${id}e)"/>`;
    } else if (a.estampa === 'raios') {
      fundo += `<g fill="${claro}" fill-opacity=".14">${Array.from({ length: 12 }, (_, i) => {
        const g = Math.PI * 2 * i / 12, p = (d) => `${(50 + 90 * Math.cos(g + d)).toFixed(1)},${(46 + 90 * Math.sin(g + d)).toFixed(1)}`;
        return `<polygon points="50,46 ${p(-.13)} ${p(.13)}"/>`;
      }).join('')}</g>`;
    } else if (a.estampa === 'bolinhas') {
      defs += `<pattern id="${id}e" width="10" height="10" patternUnits="userSpaceOnUse"><circle cx="2.5" cy="2.5" r="1.4" fill="${claro}" fill-opacity=".25"/><circle cx="7.5" cy="7.5" r="1.4" fill="${claro}" fill-opacity=".25"/></pattern>`;
      fundo += `<rect width="100" height="100" fill="url(#${id}e)"/>`;
    } else if (a.estampa === 'grade') {
      const neon = tom(c3, .2);
      fundo += `<g stroke="${neon}" stroke-width=".8" fill="none" opacity=".55">${[60, 66, 74, 84, 97].map((y) => `<path d="M0 ${y}H100"/>`).join('')}`
        + `${[-60, -30, -10, 10, 30, 50, 70, 90, 110, 130, 160].map((x) => `<path d="M50 54L${x} 100"/>`).join('')}</g>`
        + `<path d="M0 54H100" stroke="${neon}" stroke-width="1.2" opacity=".8"/>`;
    }
    // luz atrás da cabeça
    fundo += `<circle cx="50" cy="44" r="40" fill="${c}" fill-opacity=".16"/>`;

    // corpo: gomos (como no jogo) vindo do rabo, embaixo à esquerda, e subindo até o pescoço
    const gomos = AV_GOMOS;
    const corGomo = (i) => (a.padrao === 'listras' && (gomos.length - 1 - i) % 2 ? 'q' : 'p');
    let corpo = gomos.map(([x, y, r], i) => {
      let s = `<circle cx="${x}" cy="${y}" r="${r}" fill="url(#${id}${corGomo(i)})" ${tr(linha, 1.3)}/>`;
      if (a.padrao === 'pintas') s += `<circle cx="${x - r * .2}" cy="${y - r * .3}" r="${r * .22}" fill="${c2}"/><circle cx="${x + r * .38}" cy="${y + r * .15}" r="${r * .13}" fill="${c2}"/>`;
      if (a.padrao === 'losango' || a.padrao === 'faixa') s += `<path d="${gema(x, y - r * .1, r * .42)}" fill="${c2}" ${tr(tom(c2, -.5), 1)}/>`;
      if (a.padrao === 'raio' || a.padrao === 'chamas') s += `<circle cx="${x}" cy="${y}" r="${(r * .42).toFixed(1)}" fill="${c2}"/>`;
      const hx = (x - r * .32).toFixed(1), hy = (y - r * .48).toFixed(1);
      return s + `<ellipse cx="${hx}" cy="${hy}" rx="${(r * .38).toFixed(1)}" ry="${(r * .18).toFixed(1)}" transform="rotate(-25 ${hx} ${hy})" fill="#fff" fill-opacity=".3"/>`;
    }).join('');
    // sombra da cabeça no pescoço
    corpo += `<ellipse cx="52" cy="72" rx="22" ry="5.5" fill="#000" fill-opacity=".32"/>`;

    // desenho na cabeça (cortado no formato dela)
    const desenhos = {
      lisa: '',
      listras: `<g fill="${c2}" ${tr(tom(c2, -.5), 1)}><path d="M50 18L54 19.5L52 33L48 33L46 19.5Z"/><path d="M35 23L40 21L41.5 32L37.5 33Z"/><path d="M65 23L60 21L58.5 32L62.5 33Z"/><path d="M21 44L30 46L21 50Z"/><path d="M79 44L70 46L79 50Z"/></g>`,
      pintas: `<g fill="${c2}">${[[30, 31, 3.4], [70, 30, 3], [50, 26, 2.6], [25, 52, 2.4], [76, 53, 2.8], [33, 64, 2], [68, 65, 2.2], [43, 30, 1.6], [58, 29, 1.8]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}"/>`).join('')}</g>`,
      losango: `<g fill="${c2}" ${tr(tom(c2, -.5), 1)}><path d="${gema(50, 27, 6)}"/><path d="${gema(50, 37.5, 4.2)}"/><path d="${gema(30, 32, 3.6)}"/><path d="${gema(70, 32, 3.6)}"/></g>`,
      raio: `<path d="M53 18L42 36H49L45 47L58 29H51L55 18Z" fill="${c2}" ${tr(tom(c2, -.5), 1.1)}/>`,
      chamas: `<path d="M14 14H86V30C82 34 80 30 78 37C75 31 72 35 69 30C67 37 63 34 61 39C58 33 55 36 52 31C50 36 47 33 45 39C42 33 39 36 36 30C33 35 31 31 28 36C26 30 22 33 20 38C18 32 16 31 14 34Z" fill="${c2}" ${tr(tom(c2, -.5), 1)}/>`,
      faixa: `<path d="M18 36C30 32 40 34 50 37C60 34 70 32 82 36L82 53C70 51 60 54 50 56C40 54 30 51 18 53Z" fill="${c2}" ${tr(tom(c2, -.5), 1.2)}/>`,
    };
    const cabeca = `<path d="${CAB}" fill="url(#${id}h)" ${tr(linha, 1.8)}/>`
      + `<g clip-path="url(#${id}k)">${desenhos[a.padrao]}<path d="M18 60C30 74 70 74 82 60V80H18Z" fill="#000" fill-opacity=".14"/></g>`
      + `<ellipse cx="38" cy="29" rx="10" ry="4.5" transform="rotate(-18 38 29)" fill="#fff" fill-opacity=".28"/>`
      + `<path d="${CAB}" fill="none" ${tr(linha, 1.8)}/>`;

    // olhos
    const pupila = (x, y, r = 4.6) => `<circle cx="${x + .8}" cy="${y + .9}" r="${r}" fill="#0B0B10"/><circle cx="${x - .6}" cy="${y - 1}" r="${(r * .36).toFixed(2)}" fill="#fff"/>`;
    const branco = (x, y, r = 8.6) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#FDFDFD" ${tr(linha, 1.6)}/>`;
    const palpebra = (x, y, lado, tipo) => {
      // lado: -1 olho esquerdo, 1 direito. Bravo: o canto de dentro (perto do nariz) desce
      const pts = tipo === 'bravo'
        ? [[x + 11 * lado, y - 13], [x - 11 * lado, y - 13], [x - 11 * lado, y - 1.5], [x + 10 * lado, y - 8]]
        : [[x - 11, y - 13], [x + 11, y - 13], [x + 11, y - .5], [x - 11, y - .5]];
      const [, , p3, p4] = pts;
      return `<polygon points="${pts.map((p) => p.join(',')).join(' ')}" fill="url(#${id}h)"/><path d="M${p4.join(' ')}L${p3.join(' ')}" ${tr(linha, 2)}/>`;
    };
    const olhos = OL.map(([x, y], i) => {
      const lado = i ? 1 : -1;
      switch (a.olhos) {
        case 'bravo': return `<g clip-path="url(#${id}o${i})">${branco(x, y)}${pupila(x - lado * .6, y + 1.4)}${palpebra(x, y, lado, 'bravo')}</g>`;
        case 'sono': return `<g clip-path="url(#${id}o${i})">${branco(x, y)}${pupila(x, y + 2.6, 4.2)}${palpebra(x, y, lado, 'sono')}</g>`;
        case 'feliz': return `<path d="M${x - 6.5} ${y + 2.5}Q${x} ${y - 7.5} ${x + 6.5} ${y + 2.5}" fill="none" ${tr(linha, 3)}/>`;
        case 'fenda': return `<circle cx="${x}" cy="${y}" r="8.6" fill="url(#${id}g)" ${tr(linha, 1.6)}/><ellipse cx="${x}" cy="${y}" rx="1.9" ry="6.6" fill="#0B0B10"/><circle cx="${x - 3}" cy="${y - 3.4}" r="1.6" fill="#fff" fill-opacity=".9"/>`;
        case 'neon': return `<circle cx="${x}" cy="${y}" r="8.6" fill="#0A0A12" ${tr(linha, 1.6)}/><circle cx="${x}" cy="${y}" r="5.4" fill="${c3}" filter="url(#${id}n)"/><circle cx="${x}" cy="${y}" r="2.4" fill="#fff"/>`;
        case 'estrela': return `${branco(x, y)}<polygon points="${estrela(x + .4, y + .6, 6.4)}" fill="${tom(c3, -.1)}" ${tr(tom(c3, -.6), 1)}/><circle cx="${x - 1.4}" cy="${y - 1.6}" r="1.3" fill="#fff"/>`;
        case 'fofo': return `${branco(x, y, 9)}<circle cx="${x + .6}" cy="${y + .8}" r="6.6" fill="#0B0B10"/><circle cx="${x - 1.8}" cy="${y - 1.8}" r="2.4" fill="#fff"/><circle cx="${x + 2.6}" cy="${y + 3.2}" r="1.1" fill="#fff"/>`;
        default: return branco(x, y) + pupila(x, y);
      }
    }).join('');
    defs += OL.map(([x, y], i) => `<clipPath id="${id}o${i}"><circle cx="${x}" cy="${y}" r="9.4"/></clipPath>`).join('')
      + `<radialGradient id="${id}g" cx=".4" cy=".35" r=".7"><stop offset="0" stop-color="#F6FF9A"/><stop offset=".6" stop-color="#C8F02A"/><stop offset="1" stop-color="#5E8F00"/></radialGradient>`
      + `<filter id="${id}n" x="-1" y="-1" width="3" height="3"><feGaussianBlur stdDeviation="1.6" result="b"/><feMerge><feMergeNode in="b"/><feMergeNode in="SourceGraphic"/></feMerge></filter>`;
    // contorno de fora dos olhos com pálpebra (o recorte comeu o traço)
    const aro = a.olhos === 'bravo' || a.olhos === 'sono' ? OL.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="8.6" fill="none" ${tr(linha, 1.6)}/>`).join('') : '';

    // focinho e boca
    const narinas = `<ellipse cx="46" cy="56" rx="1.3" ry="1" fill="${linha}" fill-opacity=".75"/><ellipse cx="54" cy="56" rx="1.3" ry="1" fill="${linha}" fill-opacity=".75"/>`;
    const lingua = `<path d="M48.2 62.5H51.8V70.5L55 77L51.4 73.3L50 76.2L48.6 73.3L45 77L48.2 70.5Z" fill="#F0244F" ${tr('#7A0A22', 1)}/>`;
    const bocas = {
      sorriso: `<path d="M40 60.5Q50 68.5 60 60.5" fill="none" ${tr(linha, 2.4)}/>`,
      lingua: `${lingua}<path d="M40 60.5Q50 67 60 60.5" fill="none" ${tr(linha, 2.4)}/>`,
      presas: `<path d="M38.5 59.5Q50 72 61.5 59.5Q50 63.5 38.5 59.5Z" fill="#2A0710" ${tr(linha, 1.8)}/><path d="M43 61.2L45 67.5L47 62.2Z M57 61.2L55 67.5L53 62.2Z" fill="#fff" ${tr(linha, .9)}/>`,
      deboche: `<path d="M41 62.5Q51 65 59.5 58" fill="none" ${tr(linha, 2.4)}/><path d="M58 56.5L61 59.5" ${tr(linha, 2)}/>`,
      serio: `<path d="M42.5 62.5H57.5" ${tr(linha, 2.4)}/>`,
      aberta: `<path d="M40 59.5Q50 58 60 59.5Q59 70 50 70Q41 70 40 59.5Z" fill="#2A0710" ${tr(linha, 1.8)}/><path d="M43.5 66.5Q50 62.5 56.5 66.5Q53 69.5 50 69.5Q47 69.5 43.5 66.5Z" fill="#F0244F"/>`,
    };

    // cabeça (o que vai por cima): atrás = desenhado antes da cabeça
    let atras = '', topo = '';
    const tc3 = tom(c3, -.62);
    switch (a.cabeca) {
      case 'bone':
        topo = `<path d="M21.5 38C21.5 15 78.5 15 78.5 38Z" fill="url(#${id}y)" ${tr(tc3, 1.6)}/>`
          + `<path d="M50 17.5V38M35 21C33 27 32.5 32 33 38M65 21C67 27 67.5 32 67 38" fill="none" stroke="${tc3}" stroke-opacity=".45" stroke-width="1"/>`
          + `<path d="M18 39.5C30 33.5 70 33.5 82 39.5C80 43 70 41.5 50 41.5C30 41.5 20 43 18 39.5Z" fill="${tom(c3, -.25)}" ${tr(tc3, 1.6)}/>`
          + `<circle cx="50" cy="17.6" r="2.4" fill="${tom(c3, -.2)}" ${tr(tc3, 1)}/><circle cx="50" cy="29" r="4.8" fill="#fff" ${tr(tc3, 1)}/><path d="M48 27.4Q50 25.6 52 27.4Q48.4 29.2 51.6 31" fill="none" stroke="${tc3}" stroke-width="1.4" stroke-linecap="round"/>`;
        break;
      case 'headset':
        atras = `<path d="M20 47C18 16 82 16 80 47" fill="none" stroke="#1C1F27" stroke-width="7" stroke-linecap="round"/><path d="M20 47C18 16 82 16 80 47" fill="none" stroke="${c3}" stroke-width="2" stroke-linecap="round" stroke-dasharray="0 12 60 200"/>`;
        topo = `<rect x="13" y="38" width="12" height="20" rx="5" fill="#23262F" ${tr('#0A0B0F', 1.4)}/><rect x="75" y="38" width="12" height="20" rx="5" fill="#23262F" ${tr('#0A0B0F', 1.4)}/>`
          + `<rect x="15.5" y="41" width="4" height="14" rx="2" fill="${c3}" filter="url(#${id}n)"/><rect x="80.5" y="41" width="4" height="14" rx="2" fill="${c3}" filter="url(#${id}n)"/>`
          + `<path d="M19 57C19 66 26 67 35 66" fill="none" stroke="#1C1F27" stroke-width="2.4" stroke-linecap="round"/><rect x="33" y="63.5" width="7" height="5" rx="2.5" fill="#23262F" ${tr('#0A0B0F', 1)}/>`;
        break;
      case 'bandana':
        atras = `<path d="M76 30C84 31 90 34 95 42C88 40 84 38 79 37ZM76 31C83 27 89 27 96 30C89 32 84 34 78 35Z" fill="url(#${id}x)" ${tr(tc3, 1.3)}/>`;
        topo = `<path d="M22.5 37C30 27 70 27 77.5 37L78.5 29.5C70 21 30 21 21.5 29.5Z" fill="url(#${id}x)" ${tr(tc3, 1.5)}/>`
          + `<circle cx="78.5" cy="33" r="3.6" fill="${tom(c3, -.15)}" ${tr(tc3, 1.3)}/>`
          + `<g fill="#fff" fill-opacity=".8"><circle cx="37" cy="29" r="1"/><circle cx="50" cy="27.4" r="1"/><circle cx="63" cy="29" r="1"/><circle cx="43.5" cy="30.6" r=".7"/><circle cx="56.5" cy="30.6" r=".7"/></g>`;
        break;
      case 'gorro':
        topo = `<path d="M21 36C21 12 79 12 79 36Z" fill="url(#${id}y)" ${tr(tc3, 1.6)}/>`
          + `<g stroke="${tc3}" stroke-opacity=".35" stroke-width="1.1">${[28, 34, 40, 46, 54, 60, 66, 72].map((x) => `<path d="M${x} ${x < 50 ? 18 + (50 - x) * .25 : 18 + (x - 50) * .25}V32"/>`).join('')}</g>`
          + `<rect x="18.5" y="31.5" width="63" height="9" rx="4.5" fill="${tom(c3, -.2)}" ${tr(tc3, 1.5)}/>`
          + `<g stroke="${tc3}" stroke-opacity=".5" stroke-width="1.2">${Array.from({ length: 14 }, (_, i) => `<path d="M${23 + i * 4.1} 33V39"/>`).join('')}</g>`
          + `<circle cx="50" cy="12" r="6" fill="url(#${id}q)" ${tr(tom(c2, -.6), 1.4)}/>`;
        break;
      case 'chifres':
        atras = `<path d="M31 29C26 20 25 11 29 3C30 13 35 19 42 23Z" fill="url(#${id}y)" ${tr(tc3, 1.5)}/><path d="M69 29C74 20 75 11 71 3C70 13 65 19 58 23Z" fill="url(#${id}y)" ${tr(tc3, 1.5)}/>`;
        break;
      case 'aureola':
        atras = `<ellipse cx="50" cy="12" rx="19" ry="5" fill="none" stroke="#FFE58A" stroke-width="3.4" filter="url(#${id}n)"/>`;
        topo = `<path d="M31 12.6A19 5 0 0 0 69 12.6" fill="none" stroke="#FFF6C9" stroke-width="2.6" filter="url(#${id}n)"/>`;
        break;
      case 'cowboy':
        topo = `<path d="M34 27C33 15 36 6 42 6C45 6 47 9 50 9C53 9 55 6 58 6C64 6 67 15 66 27Z" fill="url(#${id}y)" ${tr(tc3, 1.6)}/>`
          + `<path d="M34.5 22.5C44 25 56 25 65.5 22.5L66 27C56 29 44 29 34 27Z" fill="${tc3}" fill-opacity=".85"/>`
          + `<path d="M10 22C14 30 26 34 50 34C74 34 86 30 90 22C86 25 76 27 66 26.5C58 28.5 42 28.5 34 26.5C24 27 14 25 10 22Z" fill="${tom(c3, -.2)}" ${tr(tc3, 1.6)}/>`;
        break;
      case 'viking':
        atras = `<path d="M24 32C14 30 8 22 7 10C13 18 19 22 27 23Z" fill="#F3E7C9" ${tr('#6B5A33', 1.4)}/><path d="M76 32C86 30 92 22 93 10C87 18 81 22 73 23Z" fill="#F3E7C9" ${tr('#6B5A33', 1.4)}/>`;
        topo = `<path d="M21 38C21 13 79 13 79 38Z" fill="url(#${id}m)" ${tr('#22262E', 1.6)}/>`
          + `<path d="M50 14V38" stroke="#5B6372" stroke-width="5"/><path d="M50 14V38" stroke="#C9D0DA" stroke-width="1.4"/>`
          + `<rect x="19" y="33" width="62" height="7" rx="3" fill="${tom(c3, -.1)}" ${tr(tc3, 1.4)}/>`
          + `<g fill="#F4F6FA">${[26, 34, 42, 58, 66, 74].map((x) => `<circle cx="${x}" cy="36.5" r="1.2"/>`).join('')}</g>`;
        defs += `<radialGradient id="${id}m" cx=".35" cy=".25" r=".8"><stop offset="0" stop-color="#F2F5F9"/><stop offset=".5" stop-color="#9AA3B2"/><stop offset="1" stop-color="#454C59"/></radialGradient>`;
        break;
    }

    // rosto (por cima dos olhos)
    let rosto = '';
    switch (a.rosto) {
      case 'escuros': {
        const lente = (x) => `<path d="M${x - 11} 39H${x + 11}C${x + 11} 48 ${x + 7} 53 ${x} 53C${x - 7} 53 ${x - 11} 48 ${x - 11} 39Z" fill="url(#${id}l)" stroke="#050506" stroke-width="1.8" stroke-linejoin="round"/>`
          + `<path d="M${x - 7} 42L${x - 2} 42L${x - 8} 49Z" fill="#fff" fill-opacity=".5"/>`;
        rosto = `<path d="M18 41L27 40M73 40L82 41" stroke="#050506" stroke-width="2.4" stroke-linecap="round"/><path d="M27 39.4H73" stroke="#050506" stroke-width="3"/>${lente(38.5)}${lente(61.5)}`;
        defs += `<linearGradient id="${id}l" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#3A3F4B"/><stop offset="1" stop-color="#050506"/></linearGradient>`;
        break;
      }
      case 'visor':
        rosto = `<path d="M19 38.5C34 35 66 35 81 38.5L80 52C66 55 34 55 20 52Z" fill="#05060A" ${tr('#000', 1.6)}/>`
          + `<path d="M23 40.5C36 38 64 38 77 40.5L76.5 49.5C64 52 36 52 23.5 49.5Z" fill="url(#${id}x)" fill-opacity=".9" filter="url(#${id}n)"/>`
          + `<g stroke="#fff" stroke-opacity=".35" stroke-width=".6">${[42.5, 45, 47.5].map((y) => `<path d="M25 ${y}H75"/>`).join('')}</g>`
          + `<path d="M28 42L44 41" stroke="#fff" stroke-opacity=".85" stroke-width="1.6" stroke-linecap="round"/>`;
        break;
      case 'redondo':
        rosto = OL.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="11" fill="#fff" fill-opacity=".1" stroke="${tom(c3, -.2)}" stroke-width="2.6"/><path d="M${x - 6} ${y - 5}A8 8 0 0 1 ${x + 1} ${y - 8}" fill="none" stroke="#fff" stroke-opacity=".6" stroke-width="1.3" stroke-linecap="round"/>`).join('')
          + `<path d="M47.5 44Q50 41.5 52.5 44M27.5 43L21 41M72.5 43L79 41" fill="none" stroke="${tom(c3, -.2)}" stroke-width="2.4" stroke-linecap="round"/>`;
        break;
      case 'tapa':
        rosto = `<path d="M24 29L78 55" stroke="#0E0E12" stroke-width="2"/><path d="M52 36C56 34 70 34 72 39C73 47 68 54 61.5 55C55 54 51 47 52 36Z" fill="#14141A" ${tr('#000', 1.4)}/>`
          + `<path d="M55 39Q61 37 68 39.5" fill="none" stroke="#fff" stroke-opacity=".2" stroke-width="1.2"/>`;
        break;
      case 'cicatriz':
        rosto = `<path d="M29 28Q37 44 45.5 61" fill="none" stroke="${tom(c, -.6)}" stroke-width="4" stroke-linecap="round"/><path d="M29 28Q37 44 45.5 61" fill="none" stroke="#FF9AA8" stroke-width="2" stroke-linecap="round"/>`
          + `<path d="M28.5 35L36.5 32M32 42.5L40 39.5M35.5 50L43.5 47M39 57L46.5 54" stroke="#F7F2EA" stroke-width="1.5" stroke-linecap="round"/>`;
        break;
      case 'mascara':
        rosto = `<path d="M20 52C32 50 42 50.5 50 52C58 50.5 68 50 80 52C79 62 68 71 50 72C32 71 21 62 20 52Z" fill="url(#${id}x)" ${tr(tc3, 1.6)}/>`
          + `<path d="M28 58C38 56.5 62 56.5 72 58M33 64C42 63 58 63 67 64" fill="none" stroke="${tc3}" stroke-opacity=".5" stroke-width="1.1"/>`;
        break;
    }
    const temMascara = a.rosto === 'mascara';
    return avEmbrulho(id, zoom, defs, fundo, `${corpo}${atras}${cabeca}${olhos}${aro}${temMascara ? '' : narinas + bocas[a.boca]}${topo}${rosto}`);
  }
  // o bicho cresce um pouco a partir da testa pra encher o círculo.
  // zoom: só a cara (nos botões do editor, pra ver a diferença de olho, boca...)
  function avEmbrulho(id, zoom, defs, fundo, bicho) {
    return `<svg class="av-arte" viewBox="${zoom ? '14 6 72 72' : '0 0 100 100'}" aria-hidden="true"><defs>${defs}<clipPath id="${id}c"><circle cx="50" cy="50" r="50"/></clipPath></defs>`
      + `<g clip-path="${zoom ? 'none' : `url(#${id}c)`}">${fundo}`
      + `<g transform="translate(50 32) scale(1.14) translate(-50 -32)">${bicho}</g></g></svg>`;
  }
  // o avatar no lugar da bolinha / do escudo: moldura da cor da patente e o escudo dela no cantinho
  // com skin lendária a moldura vira a da skin (as cores dela girando)
  function avatarFoto(av, p, cls) {
    const sk = AV_SKINS[(avLimpo(av) || {}).skin];
    const anel = sk ? 'anel-skin' : p.diamante ? 'anel-dia' : p.nivel >= ESC_NIVEIS.length - 1 ? 'anel-len' : '';
    const cores = sk ? ';' + sk.anel.map((c, i) => `--sk${i + 1}:${c}`).join(';') : '';
    const a = el(cls === 'avatar' ? 'div' : 'span', { class: `${cls} av-img ${anel}`, style: `--pc:${p.cor}${cores}`, 'aria-hidden': 'true' });
    a.innerHTML = avatarSVG(av) + (p.nivel ? `<span class="av-selo ${p.diamante ? 'esc-dia' : ''}">${escudoSVG(p, '')}</span>` : '');
    return a;
  }
  const avatarDoElenco = (nome) => { const r = elenco.get(chave(nome)); return r && r.avatar ? r.avatar : null; };

  // ---------- editor do avatar ----------
  const AV_NOMES = {
    lisa: 'Lisa', listras: 'Listras', pintas: 'Pintas', losango: 'Losango', raio: 'Raio', chamas: 'Chamas', faixa: 'Faixa',
    normal: 'Normal', bravo: 'Bravo', sono: 'Sono', feliz: 'Feliz', fenda: 'Cobra', neon: 'Neon', estrela: 'Estrela', fofo: 'Fofo',
    sorriso: 'Sorriso', lingua: 'Língua', presas: 'Presas', deboche: 'Deboche', serio: 'Sério', aberta: 'Gritando',
    nada: 'Nada', bone: 'Boné', headset: 'Headset', bandana: 'Bandana', gorro: 'Gorro', chifres: 'Chifres', aureola: 'Auréola', cowboy: 'Cowboy', viking: 'Viking',
    escuros: 'Óculos escuros', visor: 'Visor', redondo: 'Óculos', tapa: 'Tapa-olho', cicatriz: 'Cicatriz', mascara: 'Máscara',
    liso: 'Liso', hex: 'Colmeia', raios: 'Raios', bolinhas: 'Bolinhas', grade: 'Grade neon',
  };
  // cada aba: [rótulo, campo, tipo] (tipo: partes = botões com a cobra, cor = bolinhas de cor, fundo = cores do fundo)
  const AV_ABAS = {
    cobra: [['PELE', 'pele', 'cor'], ['DESENHO', 'padrao', 'partes'], ['COR DO DESENHO', 'cor2', 'cor']],
    olhos: [['OLHOS', 'olhos', 'partes'], ['COR DO BRILHO', 'cor3', 'cor']],
    boca: [['BOCA', 'boca', 'partes']],
    cabeca: [['NA CABEÇA', 'cabeca', 'partes'], ['COR', 'cor3', 'cor']],
    rosto: [['NO ROSTO', 'rosto', 'partes'], ['COR', 'cor3', 'cor']],
    fundo: [['FUNDO', 'fundo', 'fundo'], ['ESTAMPA', 'estampa', 'partes']],
    lendarias: [['SKINS LENDÁRIAS', 'skin', 'skins']],
  };
  // quantas temporadas o jogador já ganhou (é o que libera as skins lendárias)
  const titulosDe = (k) => contarTitulos(montarTemporadas()).get(k) || 0;
  const ICONE_CADEADO = '<rect x="4.5" y="10.5" width="15" height="10" rx="2.5"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3"/>';
  const ICONE_DADO = '<rect x="3.5" y="3.5" width="17" height="17" rx="4"/><circle cx="8.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="15.5" cy="15.5" r="1.2" fill="currentColor"/><circle cx="12" cy="12" r="1.2" fill="currentColor"/><circle cx="15.5" cy="8.5" r="1.2" fill="currentColor"/><circle cx="8.5" cy="15.5" r="1.2" fill="currentColor"/>';
  const ICONE_AVATAR = '<circle cx="12" cy="12" r="9"/><circle cx="9" cy="10.5" r="1.4"/><circle cx="15" cy="10.5" r="1.4"/><path d="M8.5 15c2 1.8 5 1.8 7 0"/>';
  let avd = null; // { k, av, aba }
  const podeMudarAvatar = (k) => !!k && (lerEu() === k || !!admin);
  function abrirAvatar(k) {
    const r = elenco.get(k);
    if (!r || !podeMudarAvatar(k)) return;
    const av = avLimpo(r.avatar) || avAleatorio();
    avd = { k, av, aba: av.skin ? 'lendarias' : 'cobra', tinha: !!r.avatar, titulos: titulosDe(k) };
    $('tituloAvatar').replaceChildren(lerEu() === k ? 'SEU ' : `${r.nick.toUpperCase()} · `, el('span', { class: 'laranja', text: 'AVATAR' }));
    $('btnAvTirar').hidden = !avd.tinha;
    desenharAvatarEditor();
    $('dlgAvatar').showModal();
    $('dlgAvatar').focus();
  }
  // mexer em qualquer peça volta pra cobra montada (a skin sai)
  function mudarAvatar(campo, valor) {
    avd.av = { ...avd.av, [campo]: valor };
    if (campo !== 'skin' || !valor) delete avd.av.skin;
    desenharAvatarEditor(true);
  }
  const skinTrancada = (s) => !!s && AV_SKINS[s].titulos > avd.titulos;
  function desenharAvatarEditor(manterRolagem = false) {
    const { av, aba } = avd;
    const p = patenteDe(ptsPat(avd.k)).atual;
    // skin trancada dá pra ver (e babar), mas não dá pra salvar
    const trava = skinTrancada(av.skin);
    const sk = AV_SKINS[av.skin];
    trocar($('avdPreview'), avatarFoto(av, p, 'av av-xg'), sk ? el('span', { class: `avd-raro raro-${sk.titulos} ${trava ? 'trancada' : ''}` },
      trava ? [svg(ICONE_CADEADO, 13), `CAMPEÃO ${sk.titulos}×`] : RARIDADE[sk.titulos]) : null);
    $('avdPreview').classList.toggle('avd-trancado', trava);
    $('btnAvSalvar').disabled = trava;
    $('btnAvSalvar').textContent = trava ? 'Bloqueada' : 'Salvar';
    document.querySelectorAll('.aba[data-avaba]').forEach((b) => b.setAttribute('aria-selected', String(b.dataset.avaba === aba)));
    const corpo = $('avdCorpo');
    const rol = corpo.scrollTop;
    const zoom = aba === 'olhos' || aba === 'boca' || aba === 'rosto';
    trocar(corpo, AV_ABAS[aba].map(([rot, campo, tipo]) => {
      let itens;
      if (tipo === 'skins') {
        const op = (v) => {
          const s = AV_SKINS[v], tranca = skinTrancada(v);
          const b = el('button', { type: 'button', class: `avd-op avd-skin ${s ? 'raro-' + s.titulos : ''} ${tranca ? 'trancada' : ''}`, role: 'radio', 'aria-checked': String((av.skin || '') === v),
            'aria-label': s ? `${s.nome}, ${RARIDADE[s.titulos].toLowerCase()}${tranca ? `, só pra campeão ${s.titulos}×` : ''}` : 'Minha cobra', onclick: () => mudarAvatar('skin', v) });
          b.innerHTML = avatarSVG({ ...av, skin: v || undefined });
          if (tranca) b.append(el('span', { class: 'avd-cadeado' }, svg(ICONE_CADEADO, 16)));
          b.append(el('span', { class: 'avd-nome', text: s ? s.nome : 'Minha cobra' }));
          if (s) b.append(el('span', { class: 'avd-req' }, svg(ICONE_COROA, 11), tranca ? `CAMPEÃO ${s.titulos}×` : RARIDADE[s.titulos]));
          return b;
        };
        itens = el('div', { class: 'avd-grade avd-grade-skin', role: 'radiogroup', 'aria-label': rot }, op(''), ...Object.keys(AV_SKINS).map(op));
        return el('section', { class: 'avd-sec' }, el('h3', { class: 'avd-rot avd-rot-lenda' }, rot,
          el('span', { class: 'avd-titulos', text: avd.titulos ? `${avd.titulos} ${avd.titulos === 1 ? 'TÍTULO' : 'TÍTULOS'}` : 'SÓ CAMPEÃO' })), itens);
      }
      if (tipo === 'partes') {
        itens = el('div', { class: 'avd-grade', role: 'radiogroup', 'aria-label': rot }, ...AV_PARTES[campo].map((v) => {
          const b = el('button', { type: 'button', class: 'avd-op', role: 'radio', 'aria-checked': String(av[campo] === v), onclick: () => mudarAvatar(campo, v) });
          b.innerHTML = avatarSVG({ ...av, [campo]: v }, zoom);
          b.append(el('span', { text: AV_NOMES[v] }));
          return b;
        }));
      } else {
        const lista = tipo === 'fundo' ? Object.entries(AV_FUNDOS).map(([v, [c1, c2]]) => [v, `radial-gradient(circle at 50% 38%, ${tom(c1, .25)}, ${c2} 78%)`])
          : Object.entries(AV_CORES).map(([v, c]) => [v, `radial-gradient(circle at 35% 30%, ${tom(c, .5)}, ${c} 55%, ${tom(c, -.45)})`]);
        itens = el('div', { class: 'avd-cores', role: 'radiogroup', 'aria-label': rot }, ...lista.map(([v, fundo]) => el('button', {
          type: 'button', class: 'avd-cor', role: 'radio', 'aria-checked': String(av[campo] === v), 'aria-label': v, title: v, style: `background:${fundo}`, onclick: () => mudarAvatar(campo, v),
        })));
      }
      return el('section', { class: 'avd-sec' }, el('h3', { class: 'avd-rot', text: rot }), itens);
    }));
    corpo.scrollTop = manterRolagem ? rol : 0;
  }
  async function salvarAvatar(novo) {
    const r = elenco.get(avd.k);
    const btns = [$('btnAvSalvar'), $('btnAvTirar')];
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (!DEMO) {
        const res = await sb.rpc('jogador_avatar', { p_avatar: novo, p_player: r.id });
        if (res.error) throw new Error(res.error.message);
        if (res.data === 'bloqueada') { toast('Essa skin é só pra campeão de temporada.', true); return; }
        if (res.data !== 'ok') throw new Error(res.data);
      }
      r.avatar = novo;
      $('dlgAvatar').close();
      render();
      if (chat.eu && chatVisivel()) desenharChat();
      toast(novo ? 'Avatar salvo! Já aparece pro clã todo.' : 'Avatar tirado.');
    } catch (e) {
      console.error(e);
      toast('Não deu pra salvar o avatar agora. Tenta de novo.', true);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
    }
  }
  // ---------- papéis de parede ----------
  // Cada papel é uma cena inteira desenhada aqui (1600x900, com o foco no meio, porque o ranking corta
  // uma tira e o celular corta as laterais). "base" é a parte parada, "vivo" é o que mexe: no perfil a
  // base vira imagem e só o vivo anima por cima; no resto do site vai tudo junto como imagem parada.
  const sorteio = (s) => () => { s = (s + 0x6D2B79F5) | 0; let t = Math.imul(s ^ (s >>> 15), 1 | s); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const pontos = (l, cor, w, op = 1) => `<path d="${l.map(([x, y]) => `M${f1(x)} ${f1(y)}h.01`).join('')}" stroke="${cor}" stroke-width="${w}" stroke-linecap="round" fill="none"${op < 1 ? ` opacity="${op}"` : ''}/>`;
  const estrelas2 = (rnd, n, h = 900) => [[1.5, .5], [2.3, .75], [3.3, .95]].map(([w, op], i) => pontos(Array.from({ length: n >> (i * 2) }, () => [rnd() * 1600, rnd() * h]), '#fff', w, op)).join('');
  const brilho4 = (x, y, r) => `M${f1(x)} ${f1(y - r)}Q${f1(x)} ${f1(y)} ${f1(x + r)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y + r)}Q${f1(x)} ${f1(y)} ${f1(x - r)} ${f1(y)}Q${f1(x)} ${f1(y)} ${f1(x)} ${f1(y - r)}Z`;
  const anima = (rnd, dur) => `style="animation-delay:-${f1(rnd() * dur)}s;animation-duration:${f1(dur * (.8 + rnd() * .5))}s"`;
  const brilhos = (rnd, n, h, cor = '#fff', de = 6, ate = 15) => Array.from({ length: n }, () => `<path class="pw-pisca" ${anima(rnd, 4)} d="${brilho4(rnd() * 1600, rnd() * h, de + rnd() * (ate - de))}" fill="${cor}"/>`).join('');
  const cadente = (x, y, atraso) => `<path class="pw-cadente" style="animation-delay:-${atraso}s" d="M${x} ${y}l-150 62" stroke="#fff" stroke-width="2.6" stroke-linecap="round" opacity=".85"/>`;
  // serra: contorno de montanha fechado embaixo
  function serra(rnd, y, amp, passo, h = 900) {
    let d = `M-20 ${h}L-20 ${f1(y + rnd() * amp - amp / 2)}`;
    for (let x = 0; x < 1640; x += passo * (.6 + rnd() * .8)) d += `L${f1(x)} ${f1(y + (rnd() - .5) * amp)}`;
    return `${d}L1620 ${h}Z`;
  }
  // duna, onda: contorno suave fechado embaixo
  function curva(y, amp, comp, fase, h = 900) {
    let d = `M-20 ${h}L-20 ${f1(y + Math.sin(fase) * amp)}`;
    for (let x = 0; x <= 1640; x += 40) d += `L${x} ${f1(y + Math.sin(x / comp + fase) * amp + Math.sin(x / comp * 2.3 + fase * 1.7) * amp * .3)}`;
    return `${d}L1620 ${h}Z`;
  }
  // cobra de gomos no estilo do jogo: f(t) dá o ponto do corpo, de 0 (rabo) a 1 (cabeça)
  function cobra(c, nome, f, { n, r, cores, vivo = true }) {
    const g1 = c.rg(`${nome}a`, [[0, tom(cores[0], .55)], [.55, cores[0]], [1, tom(cores[0], -.5)]], .38, .32, .7);
    const g2 = c.rg(`${nome}b`, [[0, tom(cores[1], .55)], [.55, cores[1]], [1, tom(cores[1], -.5)]], .38, .32, .7);
    const pts = Array.from({ length: n }, (_, i) => f(i / (n - 1)));
    const raio = (i) => r * (.32 + .68 * Math.min(1, (i / (n - 1)) * 2.4));
    const luz = `<path d="M${pts.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}" fill="none" stroke="${cores[0]}" stroke-width="${f1(r * 2.6)}" stroke-linecap="round" stroke-linejoin="round" opacity=".42" filter="${c.u('br')}"/>`;
    const gomos = pts.map(([x, y], i) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(raio(i))}" fill="${i % 4 < 2 ? g1 : g2}"/>`).join('');
    const [hx, hy] = pts[n - 1], [ax, ay] = pts[n - 3];
    const ang = Math.atan2(hy - ay, hx - ax), fx = Math.cos(ang), fy = Math.sin(ang), R = r * 1.28;
    const olho = (s) => {
      const x = hx + fx * R * .34 - fy * R * .52 * s, y = hy + fy * R * .34 + fx * R * .52 * s;
      return `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(R * .42)}" fill="#fff"/><circle cx="${f1(x + fx * R * .15)}" cy="${f1(y + fy * R * .15)}" r="${f1(R * .23)}" fill="#0A0E18"/><circle cx="${f1(x + fx * R * .08 - R * .08)}" cy="${f1(y + fy * R * .08 - R * .1)}" r="${f1(R * .08)}" fill="#fff"/>`;
    };
    const cabeca = `<circle cx="${f1(hx)}" cy="${f1(hy)}" r="${f1(R)}" fill="${g1}"/>${olho(1)}${olho(-1)}`;
    const onda = vivo ? pts.filter((_, i) => i % 2 === 0).map(([x, y], i, l) => `<circle class="pw-onda" opacity="0" style="animation-delay:-${f1((l.length - i) * .07)}s" cx="${f1(x - r * .22)}" cy="${f1(y - r * .26)}" r="${f1(r * .26)}" fill="#fff"/>`).join('') : '';
    return [luz + gomos + cabeca, onda];
  }

  const PAREDES = {
    arena: { nome: 'Arena Neon', grupo: 'arena', arte(c, rnd) {
      const f = c.rg('f', [[0, '#1B3C78'], [.5, '#0B1838'], [1, '#03060F']], .5, .46, .72);
      c.defs += `<pattern id="${c.id}hx" width="96" height="166.3" patternUnits="userSpaceOnUse"><path d="M48 0L96 27.7V83.1L48 110.9L0 83.1V27.7ZM48 110.9V166.3" fill="none" stroke="#4FA8FF" stroke-opacity=".2" stroke-width="2"/></pattern>`;
      c.blur('br', 26); c.blur('bm', 7);
      const cor = ['#FF4FA3', '#FFD84D', '#3DDC84', '#7DF9FF', '#FF7A1A', '#B98BFF'];
      const [corpo, onda] = cobra(c, 'c', (t) => [-170 + t * 1060, 450 + Math.sin(t * 7.4 + .6) * 165 * (.55 + t * .45)], { n: 62, r: 42, cores: ['#FF7A1A', '#FFD84D'] });
      const bola = (x, y, r, k) => `<circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="${cor[k]}"/>`;
      let brilho = '', vivas = '';
      for (let i = 0; i < 90; i++) {
        const x = rnd() * 1600, y = rnd() * 900, r = 4 + rnd() * 9, k = Math.floor(rnd() * 6);
        if (i % 3) brilho += bola(x, y, r * 1.6, k); else vivas += `<g class="pw-pisca" ${anima(rnd, 3)}>${bola(x, y, r, k)}<circle cx="${f1(x - r * .3)}" cy="${f1(y - r * .3)}" r="${f1(r * .3)}" fill="#fff"/></g>`;
      }
      return [`<rect width="1600" height="900" fill="${f}"/><rect width="1600" height="900" fill="${c.u('hx')}"/><g filter="${c.u('bm')}" opacity=".9">${brilho}</g>${corpo}`, vivas + onda];
    } },
    duelo: { nome: 'Duelo', grupo: 'arena', arte(c, rnd) {
      c.blur('br', 30); c.blur('bm', 12);
      const fe = c.lg('fe', [[0, '#3A1606'], [1, '#120602']]), fd = c.lg('fd', [[0, '#06204A'], [1, '#020A1E']]);
      const cl = c.rg('cl', [[0, '#FFFFFF', 1], [.14, '#FFF0C2', .95], [.4, '#FFB347', .45], [1, '#FFB347', 0]]);
      const raio = 'M836 -20L770 180L846 240L742 470L836 520L748 920L1600 920L1600 -20Z';
      c.defs += `<pattern id="${c.id}hx" width="96" height="166.3" patternUnits="userSpaceOnUse"><path d="M48 0L96 27.7V83.1L48 110.9L0 83.1V27.7ZM48 110.9V166.3" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/></pattern>`;
      const ge = c.rg('ge', [[0, '#FF7A1A', .55], [1, '#FF7A1A', 0]]), gd = c.rg('gd', [[0, '#3BA4FF', .55], [1, '#3BA4FF', 0]]);
      const [a, av] = cobra(c, 'a', (t) => { const k = 1 - Math.pow(1 - t, 1.5); return [-90 + k * 760, 860 - k * 450 + Math.sin(t * 8) * 70 * (1 - t)]; }, { n: 46, r: 48, cores: ['#FF7A1A', '#FFD84D'] });
      const [b, bv] = cobra(c, 'b', (t) => { const k = 1 - Math.pow(1 - t, 1.5); return [1690 - k * 760, 860 - k * 450 + Math.sin(t * 8 + 2) * 70 * (1 - t)]; }, { n: 46, r: 48, cores: ['#3BA4FF', '#B98BFF'] });
      const raios = Array.from({ length: 26 }, (_, i) => { const g = i / 26 * Math.PI * 2, l = 170 + rnd() * 240; return `<path d="M800 410L${f1(800 + Math.cos(g - .025) * l)} ${f1(410 + Math.sin(g - .025) * l)}L${f1(800 + Math.cos(g + .025) * l)} ${f1(410 + Math.sin(g + .025) * l)}Z" fill="#FFF3C2" opacity="${f1(.25 + rnd() * .5)}"/>`; }).join('');
      const fag = Array.from({ length: 34 }, () => { const g = rnd() * 6.28, l = 60 + rnd() * 320, x = 800 + Math.cos(g) * l, y = 410 + Math.sin(g) * l * .8; return `<path class="pw-pisca" ${anima(rnd, 1.8)} d="${brilho4(x, y, 6 + rnd() * 12)}" fill="${rnd() > .5 ? '#FFD84D' : '#7FC0FF'}"/>`; }).join('');
      return [`<rect width="1600" height="900" fill="${fe}"/><path d="${raio}" fill="${fd}"/><rect width="1600" height="900" fill="${c.u('hx')}"/><circle cx="330" cy="520" r="520" fill="${ge}"/><circle cx="1270" cy="520" r="520" fill="${gd}"/><path d="M836 -20L770 180L846 240L742 470L836 520L748 920" fill="none" stroke="#FFE9B0" stroke-width="7" filter="${c.u('bm')}"/><path d="M836 -20L770 180L846 240L742 470L836 520L748 920" fill="none" stroke="#fff" stroke-width="3"/>${a}${b}<g filter="${c.u('bm')}">${raios}</g><circle cx="800" cy="410" r="240" fill="${cl}"/>`,
        `<circle class="pw-pulsa" cx="800" cy="410" r="120" fill="${cl}"/>${fag}${av}${bv}`];
    } },
    colosso: { nome: 'Serpente Colossal', grupo: 'arena', arte(c, rnd) {
      c.blur('br', 34); c.blur('bm', 60);
      const ceu = c.lg('ceu', [[0, '#04101F'], [.55, '#0B2E3A'], [1, '#124B47']]);
      const lua = c.rg('lua', [[0, '#FBFFE8'], [.7, '#E2F2C8'], [1, '#A9CFA0']], .42, .38, .65), halo = c.rg('halo', [[0, '#D8FFD0', .55], [1, '#D8FFD0', 0]]);
      const m1 = c.lg('m1', [[0, '#0F3A3A'], [1, '#082220']]), m2 = c.lg('m2', [[0, '#072422'], [1, '#020C0C']]);
      const crateras = [[720, 300, 46], [900, 250, 30], [860, 430, 60], [670, 470, 28], [950, 370, 20], [760, 170, 22]].map(([x, y, r]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="#B9D8A8" opacity=".45"/><circle cx="${x + 3}" cy="${y + 4}" r="${r * .82}" fill="#CFE6BC" opacity=".5"/>`).join('');
      const [corpo, onda] = cobra(c, 'c', (t) => { const g = t * Math.PI * 3.7 - .9; const R = 440 - t * 230; return [800 + Math.cos(g) * R, 410 + Math.sin(g) * R * .58 + (1 - t) * 240 - t * 40]; }, { n: 78, r: 62, cores: ['#1FBF7A', '#D6FF6B'] });
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 240, 520)}<circle cx="800" cy="340" r="480" fill="${halo}"/><circle cx="800" cy="340" r="290" fill="${lua}"/>${crateras}`
        + `<path d="${serra(rnd, 640, 120, 90)}" fill="${m1}"/><ellipse cx="800" cy="700" rx="900" ry="100" fill="#A8FFD8" opacity=".14" filter="${c.u('bm')}"/><path d="${serra(rnd, 760, 90, 70)}" fill="${m2}"/>${corpo}`, brilhos(rnd, 12, 480, '#E8FFD8') + onda + cadente(1380, 90, 1)];
    } },
    synth: { nome: 'Sol Retrô', grupo: 'neon', arte(c, rnd) {
      c.blur('bm', 22);
      const ceu = c.lg('ceu', [[0, '#0E0330'], [.34, '#3A0B6B'], [.54, '#A3127A'], [.64, '#FF4F7B']]);
      const sol = c.lg('sol', [[0, '#FFF27A'], [.45, '#FFA02E'], [1, '#FF2F86']]);
      const chao = c.lg('chao', [[0, '#2C0657'], [1, '#07011A']]);
      const mont = (d, cor) => `<path d="${d}" fill="#14063A"/><path d="${d}" fill="none" stroke="${cor}" stroke-width="3" stroke-linejoin="round"/>`;
      const horiz = 590;
      const faixas = [0, 1, 2, 3, 4, 5, 6].map((i) => `<rect x="480" y="${380 + i * 34}" width="640" height="${6 + i * 3}" fill="#25084F"/>`).join('');
      c.defs += `<clipPath id="${c.id}s"><rect x="0" y="0" width="1600" height="${horiz}"/></clipPath>`;
      const vert = Array.from({ length: 41 }, (_, i) => { const x = (i - 20) * 44; return `M${800 + x} ${horiz}L${800 + x * 9} 900`; }).join('');
      const pal = (x, h, inv) => { const fol = [-1.2, -.7, -.2, .3, .8, 1.3].map((a) => `M0 0Q${f1(Math.sin(a) * 70)} ${f1(-34 - Math.cos(a) * 50)} ${f1(Math.sin(a) * 138)} ${f1(14 - Math.cos(a) * 62)}Q${f1(Math.sin(a) * 66)} ${f1(-18 - Math.cos(a) * 30)} 0 0Z`).join(''); return `<g transform="translate(${x} ${900 - h}) scale(${inv ? -1 : 1} 1)"><path d="M-7 0Q30 ${h * .5} 22 ${h}H46Q58 ${h * .5} 7 0Z" fill="#090216"/><path d="${fol}" fill="#090216"/></g>`; };
      const linhas = Array.from({ length: 8 }, (_, i) => `<rect class="pw-avanca" style="animation-delay:-${f1(i * .5)}s" x="-10" y="${horiz}" width="1620" height="3" fill="#FF4FD8"/>`).join('');
      const estat = [0, 7, 22, 46, 84, 140, 215, 306].map((d) => `<rect x="-10" y="${horiz + d}" width="1620" height="${2 + d / 80}" fill="#FF4FD8" opacity=".9"/>`).join('');
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 220, 400)}<circle cx="800" cy="360" r="300" fill="#FF6AA8" opacity=".5" filter="${c.u('bm')}"/><g clip-path="url(#${c.id}s)"><circle cx="800" cy="360" r="262" fill="${sol}"/>${faixas}</g>`
        + mont(`M-20 ${horiz}L120 470L230 530L350 420L470 540L560 500L640 ${horiz}Z`, '#3BE8FF') + mont(`M1620 ${horiz}L1480 460L1370 530L1250 430L1140 535L1040 500L960 ${horiz}Z`, '#3BE8FF')
        + `<rect y="${horiz}" width="1600" height="310" fill="${chao}"/><path d="${vert}" stroke="#FF4FD8" stroke-width="2" opacity=".85" fill="none"/>${estat}<rect y="${horiz - 3}" width="1600" height="6" fill="#FFB8F0"/>${pal(90, 420)}${pal(1510, 420, true)}`,
      `<g class="pw-recorte">${linhas}</g>${brilhos(rnd, 10, 320)}`];
    } },
    cidade: { nome: 'Cidade Cyber', grupo: 'neon', arte(c, rnd) {
      c.blur('bm', 28); c.blur('bp', 4);
      const ceu = c.lg('ceu', [[0, '#05071F'], [.5, '#1B0F52'], [.85, '#7A1F8A'], [1, '#D13A9A']]);
      const lua = c.lg('lua', [[0, '#7DF9FF'], [.6, '#C79BFF'], [1, '#FF6FCF']]);
      const predios = (y, w, cor, jan, pass, op = 1) => {
        let b = '', x = -30, janelas = [];
        while (x < 1640) {
          const lw = w * (.55 + rnd() * .9), ly = y + (rnd() - .4) * 220 * (1 - Math.abs(x - 800) / 1800), topo = rnd();
          b += `<rect x="${f1(x)}" y="${f1(ly)}" width="${f1(lw)}" height="${f1(900 - ly)}" fill="${cor}"/>`;
          if (topo > .7) b += `<path d="M${f1(x + lw / 2)} ${f1(ly)}v-${f1(30 + rnd() * 60)}" stroke="${cor}" stroke-width="4"/>`;
          else if (topo < .25) b += `<path d="M${f1(x)} ${f1(ly)}L${f1(x + lw / 2)} ${f1(ly - 34)}L${f1(x + lw)} ${f1(ly)}Z" fill="${cor}"/>`;
          for (let wx = x + 10; wx < x + lw - 8; wx += pass) for (let wy = ly + 14; wy < 900; wy += pass * 1.3) if (rnd() > .62) janelas.push([wx, wy]);
          x += lw + rnd() * 12;
        }
        const pal = (l, cor2) => `<path d="${l.map(([a, e]) => `M${f1(a)} ${f1(e)}h.01`).join('')}" stroke="${cor2}" stroke-width="${pass * .42}" stroke-linecap="square" opacity="${op}"/>`;
        const n = janelas.length;
        return b + pal(janelas.filter((_, i) => i % 3 === 0), jan[0]) + pal(janelas.filter((_, i) => i % 3 === 1), jan[1]) + pal(janelas.filter((_, i) => i % 3 === 2 && i < n), jan[2]);
      };
      const neon = (x, y, w, h, cor) => `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="none" stroke="${cor}" stroke-width="10" opacity=".5" filter="${c.u('bp')}"/><rect x="${x}" y="${y}" width="${w}" height="${h}" rx="4" fill="#10062A" stroke="${cor}" stroke-width="3"/>`;
      const cob = `M0 0c14-16 28 16 42 0s28 16 42 0`;
      const placa = neon(636, 470, 120, 76, '#3BE8FF') + `<path d="${cob}" transform="translate(654 508)" fill="none" stroke="#3BE8FF" stroke-width="6" stroke-linecap="round"/>` + neon(860, 520, 76, 130, '#FF4FA3') + `<path d="M898 540v90M880 562h36M880 604h36" stroke="#FF4FA3" stroke-width="5" stroke-linecap="round"/>`;
      const carro = (y, cor, dur, atraso, volta) => `<g class="pw-deriva${volta ? ' volta' : ''}" style="animation-duration:${dur}s;animation-delay:-${atraso}s"><path d="M-70 ${y}h46" stroke="${cor}" stroke-width="5" stroke-linecap="round"/><circle cx="-22" cy="${y}" r="5" fill="#fff"/></g>`;
      const chuva = `<g class="pw-chuva" opacity=".5">${Array.from({ length: 70 }, () => { const x = rnd() * 1700, y = rnd() * 1000 - 100; return `<path d="M${f1(x)} ${f1(y)}l-7 34" stroke="#BFE9FF" stroke-width="1.6"/>`; }).join('')}</g>`;
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 120, 340)}<circle cx="800" cy="300" r="270" fill="#C79BFF" opacity=".4" filter="${c.u('bm')}"/><circle cx="800" cy="300" r="205" fill="${lua}"/>`
        + predios(420, 110, '#2A1668', ['#7A4FD0', '#FF6FCF', '#3BE8FF'], 16, .55) + predios(560, 130, '#150A40', ['#FFD36E', '#3BE8FF', '#FF6FCF'], 18, .8) + placa + predios(700, 170, '#070318', ['#FFD36E', '#FF9F4A', '#3BE8FF'], 22, .95), carro(330, '#3BE8FF', 11, 2) + carro(392, '#FF4FA3', 15, 6, true) + carro(446, '#FFD36E', 9, 4) + carro(270, '#fff', 19, 11, true) + chuva];
    } },
    codigo: { nome: 'Código', grupo: 'neon', arte(c, rnd) {
      c.blur('br', 18); c.blur('bm', 34);
      const gr = c.lg('gr', [[0, '#0B3D1C', 0], [.7, '#22C55E', .75], [1, '#CFFFE0']]);
      const pool = '01ABCDEF<>/#$%&=+*{}[]';
      const coluna = (x, y, n, tam, classe = '', extra = '') => {
        const s = Array.from({ length: n }, () => pool[Math.floor(rnd() * pool.length)]).join('').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
        return `<text class="${classe}" ${extra} font-family="monospace" font-weight="700" font-size="${tam}" fill="${c.u('gr')}" x="${Array(n).fill(f1(x)).join(' ')}" y="${Array.from({ length: n }, (_, i) => f1(y + i * tam * 1.14)).join(' ')}">${s}</text>`;
      };
      let base = '', vivo = '';
      for (let i = 0; i < 44; i++) {
        const x = 12 + i * 36 + rnd() * 6, n = 14 + Math.floor(rnd() * 20), y = -40 + rnd() * 500, tam = 22;
        if (i % 3 === 2) vivo += coluna(x, y, n, tam, 'pw-cai pw-lento', anima(rnd, 9)); else base += coluna(x, y, n, tam);
      }
      const gsk = c.rg('gsk', [[0, '#39FF88', .5], [1, '#39FF88', 0]]);
      const [corpo, onda] = cobra(c, 'c', (t) => [420 + t * 450, 470 + Math.sin(t * 8.6 - .8) * 170], { n: 48, r: 36, cores: ['#16A34A', '#7CFF4F'] });
      return [`<rect width="1600" height="900" fill="#010A05"/><rect width="1600" height="900" fill="#02200E" opacity=".6"/>${base}<ellipse cx="800" cy="450" rx="620" ry="330" fill="${gsk}"/>${corpo}`, vivo + onda];
    } },
    circuito: { nome: 'Circuito', grupo: 'neon', arte(c, rnd) {
      c.blur('br', 10); c.blur('bm', 44);
      const f = c.rg('f', [[0, '#0A3548'], [.6, '#051A28'], [1, '#020A12']], .5, .46, .8);
      const ch = c.lg('ch', [[0, '#1A3B4A'], [1, '#0A1A24']]), lg = c.lg('lg', [[0, '#7DF9FF'], [1, '#2FE38A']], 1, 1);
      let tr = '', pads = [], vivo = '', ramos = 44;
      for (let i = 0; i < ramos; i++) {
        const lado = i % 4, t = (Math.floor(i / 4) + .5) / (ramos / 4);
        let x = lado < 2 ? 655 + t * 290 : lado === 2 ? 650 : 950, y = lado < 2 ? (lado ? 305 : 595) : 305 + t * 290;
        const dx = lado === 2 ? -1 : lado === 3 ? 1 : (x < 800 ? -1 : 1), dy = lado === 0 ? 1 : lado === 1 ? -1 : (y < 450 ? -1 : 1);
        let d = `M${f1(x)} ${f1(y)}`;
        const pernas = 3 + Math.floor(rnd() * 3);
        for (let p = 0; p < pernas; p++) {
          const l = 50 + rnd() * 170;
          if (lado < 2 ? p % 2 === 0 : p % 2 === 1) y += dy * l * (lado < 2 ? 1 : .5); else x += dx * l * (lado < 2 ? .5 : 1);
          d += `L${f1(x)} ${f1(y)}`;
          if (p < pernas - 1) { const k = 22; x += dx * k; y += dy * k; d += `L${f1(x)} ${f1(y)}`; }
        }
        pads.push([x, y]);
        const cor = i % 3 ? '#2FE3F2' : '#2FE38A';
        tr += `<path d="${d}" fill="none" stroke="${cor}" stroke-opacity=".5" stroke-width="3" stroke-linejoin="round"/>`;
        if (i % 2 === 0) vivo += `<path class="pw-corre" ${anima(rnd, 5)} d="${d}" fill="none" stroke="#E9FFFF" stroke-width="4" stroke-linecap="round" stroke-dasharray="26 1400"/>`;
      }
      const pernas = Array.from({ length: 11 }, (_, i) => { const p = 660 + i * 28; return `M${p} 300v-18M${p} 600v18M645 ${p - 360 + 5}h-18M955 ${p - 360 + 5}h18`; }).join('');
      const [corpo] = cobra(c, 'c', (t) => [690 + t * 200, 450 + Math.sin(t * 8) * 66], { n: 28, r: 20, cores: ['#2FE3F2', '#2FE38A'], vivo: false });
      return [`<rect width="1600" height="900" fill="${f}"/>${tr}${pontos(pads, '#7DF9FF', 11)}${pontos(pads, '#04121A', 4)}<rect x="630" y="280" width="340" height="340" rx="26" fill="#2FE3F2" opacity=".35" filter="${c.u('bm')}"/><path d="${pernas}" stroke="#7FA9B8" stroke-width="10"/><rect x="645" y="300" width="310" height="300" rx="20" fill="${ch}" stroke="${lg}" stroke-width="5"/><rect x="664" y="318" width="272" height="264" rx="10" fill="none" stroke="#2FE3F2" stroke-opacity=".35" stroke-width="2"/>${corpo}`, vivo + brilhos(rnd, 8, 900, '#7DF9FF')];
    } },
    galaxia: { nome: 'Galáxia', grupo: 'espaco', arte(c, rnd) {
      c.blur('bm', 60); c.blur('bg', 26);
      const f = c.rg('f', [[0, '#1A0E4A'], [.5, '#0A0626'], [1, '#02010A']], .5, .46, .8);
      const nu = c.rg('nu', [[0, '#FFFFFF'], [.1, '#FFE8C2'], [.3, '#FF9FE0', .7], [.65, '#7A5CFF', .28], [1, '#3A1C9A', 0]]);
      const gira = (x, y, a = -.32, ach = .46) => { const yy = y * ach; return [800 + x * Math.cos(a) - yy * Math.sin(a), 440 + x * Math.sin(a) + yy * Math.cos(a)]; };
      const grupos = { a: [], b: [], d: [], e: [] };
      for (let i = 0; i < 2300; i++) {
        const braco = i % 3, t = Math.pow(rnd(), .62), th = t * 6.1 + braco * 2.094, r = 26 + t * 700, esp = (1 - t * .55) * 76 * (rnd() - .5) * (1 + rnd());
        const [x, y] = gira(Math.cos(th) * (r + esp), Math.sin(th) * (r + esp));
        const k = rnd();
        (k < .4 ? grupos.a : k < .7 ? grupos.b : k < .9 ? grupos.d : grupos.e).push([x, y]);
      }
      const nuvem = (l, cor, r) => l.map(([x, y]) => `<circle cx="${x}" cy="${y}" r="${r}" fill="${cor}"/>`).join('');
      return [`<rect width="1600" height="900" fill="${f}"/>${estrelas2(rnd, 340)}<g transform="rotate(-18 800 440)" filter="${c.u('bm')}" opacity=".85">${nuvem([[420, 430], [1180, 450], [620, 330], [980, 550]], '#6A3BFF', 150)}${nuvem([[300, 460], [1300, 420]], '#FF4FA3', 100)}${nuvem([[860, 330], [720, 560]], '#2FE3F2', 90)}</g>`
        + pontos(grupos.a, '#CFE4FF', 2) + pontos(grupos.b, '#FFE4F6', 2.6) + pontos(grupos.d, '#C79BFF', 3.4) + pontos(grupos.e, '#FFFFFF', 4.2)
        + `<ellipse cx="800" cy="440" rx="330" ry="190" transform="rotate(-18 800 440)" fill="${nu}"/>`, brilhos(rnd, 16, 900, '#fff', 5, 13) + cadente(1320, 150, 2) + cadente(560, 80, 7)];
    } },
    saturno: { nome: 'Anéis', grupo: 'espaco', arte(c, rnd) {
      c.blur('bm', 70); c.blur('bg', 18);
      const f = c.lg('f', [[0, '#03071C'], [.6, '#0B1236'], [1, '#160C3A']]);
      const pl = c.lg('pl', [[0, '#FFE9B8'], [.25, '#E9B26A'], [.42, '#FFF0CC'], [.58, '#D08A52'], [.75, '#F2C78A'], [1, '#8A4C2E']]);
      const som = c.rg('som', [[0, '#000', 0], [.62, '#000', 0], [1, '#050310', .9]], .36, .34, .78);
            c.defs += `<clipPath id="${c.id}fr"><path d="M-200 430H1800V1200H-200Z" transform="rotate(-14 800 430)"/></clipPath>`;
      const aneis = [[655, 154, 26, '#FFE9C2', .9], [612, 142, 14, '#C79B6A', .8], [570, 131, 24, '#FFD9A0', .95], [524, 120, 10, '#8A6A5A', .7], [490, 112, 16, '#F2C78A', .85], [454, 103, 7, '#FFF3DC', .6]].map(([x, y, w, cor, op]) => `<ellipse cx="800" cy="430" rx="${x}" ry="${y}" fill="none" stroke="${cor}" stroke-opacity="${op}" stroke-width="${w}" transform="rotate(-14 800 430)"/>`).join('');
      const faixas = [[-140, 44], [-70, 22], [-20, 60], [70, 30], [130, 40]].map(([y, h], i) => `<ellipse cx="800" cy="${430 + y}" rx="300" ry="${h}" fill="${i % 2 ? '#FFF0CC' : '#A85F3A'}" opacity=".24"/>`).join('');
      c.defs += `<clipPath id="${c.id}cp"><circle cx="800" cy="430" r="250"/></clipPath>`;
      return [`<rect width="1600" height="900" fill="${f}"/>${estrelas2(rnd, 420)}<ellipse cx="310" cy="210" rx="360" ry="190" fill="#6A3BFF" opacity=".34" filter="${c.u('bm')}"/><ellipse cx="1320" cy="680" rx="380" ry="200" fill="#FF7AB8" opacity=".24" filter="${c.u('bm')}"/><circle cx="800" cy="430" r="262" fill="#FFD9A0" opacity=".5" filter="${c.u('bg')}"/>${aneis}<circle cx="800" cy="430" r="250" fill="${pl}"/><g clip-path="url(#${c.id}cp)">${faixas}</g><circle cx="800" cy="430" r="250" fill="${som}"/><g clip-path="url(#${c.id}fr)">${aneis}</g>`,
        `<g class="pw-flutua"><circle cx="1250" cy="690" r="46" fill="#CFE4FF"/><circle cx="1240" cy="680" r="34" fill="#F4F9FF" opacity=".6"/><circle cx="1266" cy="706" r="9" fill="#A8BEDC"/></g>${brilhos(rnd, 14, 900, '#fff', 5, 13)}${cadente(420, 110, 3)}`];
    } },
    buraco: { nome: 'Buraco Negro', grupo: 'espaco', arte(c, rnd) {
      c.blur('br', 14); c.blur('bm', 40); c.blur('bg', 100);
      const disco = c.lg('disco', [[0, '#FF6A1A', .08], [.22, '#FF8A2B'], [.5, '#FFFBE8'], [.78, '#FFB347'], [1, '#FF6A1A', .08]], 1, 0);
      const aro = c.rg('aro', [[0, '#000'], [.8, '#000'], [.86, '#FFF3D0'], [.9, '#FFB347', .8], [1, '#FF6A1A', 0]]);
      const dob = c.lg('dob', [[0, '#FFF3D0'], [.5, '#FF9A3D'], [1, '#FF6A1A', 0]]);
      const elipses = Array.from({ length: 12 }, (_, i) => { const rx = 330 + i * 52, ry = 62 + i * 7.5; return `<ellipse cx="800" cy="450" rx="${rx}" ry="${ry}" fill="none" stroke="${disco}" stroke-width="${i < 6 ? 9 : 6}" opacity="${f1(1 - i * .07)}"/>`; }).join('');
      c.defs += `<clipPath id="${c.id}fr"><rect x="0" y="450" width="1600" height="450"/></clipPath>`;
      const vivo = Array.from({ length: 5 }, (_, i) => { const rx = 340 + i * 90, ry = 64 + i * 13; return `<ellipse class="pw-corre lento" clip-path="url(#${c.id}fr)" ${anima(rnd, 6 + i)} cx="800" cy="450" rx="${rx}" ry="${ry}" fill="none" stroke="#FFF3D0" stroke-width="4" stroke-linecap="round" stroke-dasharray="90 1800"/>`; }).join('');
      return [`<rect width="1600" height="900" fill="#020108"/>${estrelas2(rnd, 460)}<ellipse cx="800" cy="450" rx="760" ry="230" fill="#FF7A1A" opacity=".2" filter="${c.u('bg')}"/><g filter="${c.u('br')}">${elipses}</g>${elipses}<circle cx="800" cy="450" r="285" fill="#FF8A2B" opacity=".55" filter="${c.u('bm')}"/><circle cx="800" cy="450" r="272" fill="${aro}"/><path d="M522 450A278 278 0 0 1 1078 450" fill="none" stroke="${dob}" stroke-width="14"/><g clip-path="url(#${c.id}fr)"><g filter="${c.u('br')}">${elipses}</g>${elipses}<path d="M560 450A240 110 0 0 0 1040 450" fill="none" stroke="${disco}" stroke-width="30"/></g>`,
        vivo + brilhos(rnd, 12, 900, '#FFE3C2', 4, 11)];
    } },
    aurora: { nome: 'Aurora Boreal', grupo: 'natureza', arte(c, rnd) {
      c.blur('br', 24); c.blur('bm', 50);
      const ceu = c.lg('ceu', [[0, '#020818'], [.45, '#062A3E'], [.72, '#0E5A5A']]);
      const au = c.lg('au', [[0, '#7A5CFF', 0], [.3, '#B05CFF', .55], [.62, '#2FE3A2', .95], [1, '#7DFFB5', 0]]);
      const au2 = c.lg('au2', [[0, '#2FE3F2', 0], [.5, '#2FE3A2', .85], [1, '#CFFF9F', 0]]);
      const m1 = c.lg('m1', [[0, '#E8FBFF'], [.22, '#8FC9D8'], [.32, '#1D5A6A'], [1, '#0A2C3A']]), m2 = c.lg('m2', [[0, '#123F4C'], [1, '#051720']]);
      const fita = (y0, amp, h, fase, g, n = 100) => {
        let s = '';
        for (let i = 0; i < n; i++) { const x = i / (n - 1) * 1640 - 20, y = y0 + Math.sin(x / 210 + fase) * amp + Math.sin(x / 90 + fase * 2) * amp * .3, a = h * (.7 + rnd() * .5); s += `<rect x="${f1(x)}" y="${f1(y - a)}" width="${f1(13 + rnd() * 7)}" height="${f1(a)}" fill="${g}" opacity="${f1(.35 + rnd() * .55)}"/>`; }
        return s;
      };
      const lago = c.lg('lago', [[0, '#0E5A5A'], [1, '#02101C']]);
      const pinos = (y, e, n, cor) => Array.from({ length: n }, () => { const x = rnd() * 1640, h = e * (.6 + rnd() * .7); return `<path d="M${f1(x)} ${f1(y - h)}L${f1(x + h * .3)} ${y + 6}H${f1(x - h * .3)}Z" fill="${cor}"/>`; }).join('');
      const fundo = `<g filter="${c.u('br')}">${fita(420, 90, 300, .4, au)}${fita(380, 70, 240, 2.2, au2)}</g>${fita(430, 90, 170, .4, au2, 70)}`;
      const mont = `<path d="${serra(rnd, 520, 170, 150, 660)}" fill="${m1}"/><path d="${serra(rnd, 610, 60, 70, 660)}" fill="${m2}"/>`;
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 380, 560)}${fundo}${mont}<rect y="656" width="1600" height="244" fill="${lago}"/><g transform="matrix(1 0 0 -.55 0 1020)" opacity=".5">${fundo}</g><rect y="656" width="1600" height="4" fill="#BFFFE8" opacity=".35"/>${pinos(662, 66, 60, '#04151C')}<path d="${curva(860, 20, 170, 1, 900)}" fill="#020C12"/>${pinos(866, 130, 26, '#010709')}`, brilhos(rnd, 14, 420, '#E8FFF4', 5, 12) + cadente(1190, 70, 4)];
    } },
    oceano: { nome: 'Mar Profundo', grupo: 'natureza', arte(c, rnd) {
      c.blur('br', 18); c.blur('bm', 36);
      const f = c.lg('f', [[0, '#1AA0C8'], [.3, '#0B5E8F'], [.68, '#052A52'], [1, '#010A1E']]);
      const ra = c.lg('ra', [[0, '#DFFFFF', .55], [1, '#DFFFFF', 0]]), ag = c.rg('ag', [[0, '#FF8FE0', .95], [.6, '#A85CFF', .6], [1, '#4B2FD0', .15]], .5, .4, .7), halo = c.rg('halo', [[0, '#D06CFF', .55], [1, '#D06CFF', 0]]);
      const raios = Array.from({ length: 11 }, (_, i) => { const x = 240 + i * 112 + rnd() * 40, w = 28 + rnd() * 60, d = (x - 800) * .95; return `<path d="M${f1(x)} -10H${f1(x + w)}L${f1(x + w * 2.6 + d)} 800H${f1(x + d)}Z" fill="${ra}"/>`; }).join('');
      const agua = (x, y, e) => {
        const tent = [-46, -28, -10, 10, 28, 46].map((a, i) => `<path class="pw-balanca" style="animation-delay:-${f1(i * .4)}s" d="M${a} 8c${a * .3} 44 ${-a * .5} 66 ${a * .24} ${108 + (i % 2) * 34}" fill="none" stroke="#E0A8FF" stroke-opacity=".75" stroke-width="5" stroke-linecap="round"/>`).join('');
        return `<g class="pw-flutua" style="animation-duration:${6 + e * 2}s"><g transform="translate(${x} ${y}) scale(${e})"><ellipse cx="0" cy="-10" rx="170" ry="150" fill="${halo}"/>${tent}<path d="M-72 10C-76 -86 76 -86 72 10C50 22 22 4 0 16C-24 4 -52 22 -72 10Z" fill="${ag}"/><ellipse cx="-24" cy="-40" rx="17" ry="10" fill="#fff" opacity=".6"/><path d="M-50 2C-44 -52 44 -52 50 2" fill="none" stroke="#FFD6F5" stroke-opacity=".6" stroke-width="4"/></g></g>`;
      };
      const coral = (x, h, cor) => { let s = ''; for (let i = 0; i < 7; i++) { const a = -.95 + i * .32, l = h * (.65 + rnd() * .5), mx = x + Math.sin(a) * l * .5, my = 900 - Math.cos(a) * l * .55; s += `<path d="M${x} 900Q${f1(mx)} ${f1(my + 30)} ${f1(x + Math.sin(a) * l)} ${f1(900 - Math.cos(a) * l)}" fill="none" stroke="${cor}" stroke-width="${f1(10 + rnd() * 12)}" stroke-linecap="round"/><circle cx="${f1(x + Math.sin(a) * l)}" cy="${f1(900 - Math.cos(a) * l)}" r="${f1(9 + rnd() * 10)}" fill="${cor}"/>`; } return s; };
      const peixes = Array.from({ length: 26 }, () => { const x = 1000 + rnd() * 420, y = 230 + rnd() * 240, e = .6 + rnd() * .8; return `<path d="M${f1(x)} ${f1(y)}q${f1(16 * e)} ${f1(-9 * e)} ${f1(32 * e)} 0q${f1(-16 * e)} ${f1(9 * e)} ${f1(-32 * e)} 0l${f1(-11 * e)} ${f1(-7 * e)}v${f1(14 * e)}z" fill="#BFF3FF" opacity=".75"/>`; }).join('');
      const bolhas = Array.from({ length: 34 }, () => { const x = rnd() * 1600, y = rnd() * 900, r = 3 + rnd() * 11; return `<g class="pw-sobe" ${anima(rnd, 12)}><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#fff" fill-opacity=".12" stroke="#DFFFFF" stroke-opacity=".75" stroke-width="1.6"/><circle cx="${f1(x - r * .3)}" cy="${f1(y - r * .3)}" r="${f1(r * .22)}" fill="#fff"/></g>`; }).join('');
      return [`<rect width="1600" height="900" fill="${f}"/><g filter="${c.u('br')}">${raios}</g>${peixes}<path d="${serra(rnd, 760, 110, 80)}" fill="#062040"/>${coral(160, 240, '#0E3A5E')}${coral(1400, 260, '#0E3A5E')}<path d="${serra(rnd, 840, 70, 60)}" fill="#020F24"/>${coral(70, 190, '#031A36')}${coral(1520, 200, '#031A36')}${coral(420, 130, '#FF6FA8')}${coral(1180, 120, '#FFB347')}`,
        agua(800, 400, 1.35) + agua(500, 260, .7) + agua(1130, 590, .6) + bolhas];
    } },
    selva: { nome: 'Selva Noturna', grupo: 'natureza', arte(c, rnd) {
      c.blur('br', 22); c.blur('bm', 70);
      const f = c.rg('f', [[0, '#5EE0B0'], [.28, '#1B7E72'], [.65, '#0A3D3F'], [1, '#031517']], .5, .4, .75);
      const lua = c.rg('lua', [[0, '#FFFFF0'], [.8, '#E8FFD8'], [1, '#BFF5C8']]);
      const folha = (x, y, l, a, cor) => { const v = `M0 0C${f1(l * .25)} ${f1(-l * .24)} ${f1(l * .75)} ${f1(-l * .22)} ${l} 0C${f1(l * .75)} ${f1(l * .22)} ${f1(l * .25)} ${f1(l * .24)} 0 0Z`; const nerv = Array.from({ length: 6 }, (_, i) => { const p = l * (.15 + i * .13); return `M${f1(p)} 0L${f1(p + l * .1)} ${f1(-l * .13)}M${f1(p)} 0L${f1(p + l * .1)} ${f1(l * .13)}`; }).join(''); return `<g transform="translate(${f1(x)} ${f1(y)}) rotate(${f1(a)})"><path d="${v}" fill="${cor}"/><path d="M0 0H${l}${nerv}" fill="none" stroke="#fff" stroke-opacity=".08" stroke-width="2"/></g>`; };
      const moita = (x, y, n, l, a0, ab, cor) => Array.from({ length: n }, (_, i) => folha(x + (rnd() - .5) * 60, y + (rnd() - .5) * 60, l * (.7 + rnd() * .5), a0 + ab * (i / n) + rnd() * 12, cor[i % cor.length])).join('');
      const cip = [[300, 0, 300, 470], [1180, 0, 1250, 400], [1330, 0, 1300, 540], [190, 0, 130, 370]].map(([a, b, x, y]) => `<path d="M${a} ${b}Q${(a + x) / 2 + 40} ${y * .5} ${x} ${y}" fill="none" stroke="#04211F" stroke-width="9" stroke-linecap="round"/>`).join('');
      const [corpo, onda] = cobra(c, 'c', (t) => [-40 + t * 860, 210 + Math.sin(t * 6.4) * 34 + t * t * t * t * 250], { n: 50, r: 30, cores: ['#7CFF4F', '#FFD84D'] });
      const galho = `<path d="M-40 250C200 170 460 260 680 190C780 158 880 200 980 150C1220 90 1420 150 1640 90" fill="none" stroke="#0B1F16" stroke-width="42" stroke-linecap="round"/><path d="M-40 240C200 160 460 250 680 180C780 148 880 190 980 140C1220 80 1420 140 1640 80" fill="none" stroke="#1E3F2C" stroke-width="10" stroke-linecap="round"/>`;
      const verdes = ['#0C4A3E', '#0F5A46', '#0A3A34'], escuros = ['#04211E', '#062A25', '#031A18'];
      const vag = Array.from({ length: 30 }, () => { const x = rnd() * 1600, y = 150 + rnd() * 700; return `<g class="pw-vaga" ${anima(rnd, 7)}><circle cx="${f1(x)}" cy="${f1(y)}" r="11" fill="#E6FF7A" opacity=".22"/><circle cx="${f1(x)}" cy="${f1(y)}" r="3.6" fill="#F4FFC2"/></g>`; }).join('');
      return [`<rect width="1600" height="900" fill="${f}"/><circle cx="800" cy="350" r="420" fill="#BFFFE0" opacity=".3" filter="${c.u('bm')}"/><circle cx="800" cy="350" r="170" fill="${lua}"/>${moita(240, 640, 16, 300, -80, 150, verdes)}${moita(1360, 640, 16, 300, 100, 150, verdes)}${cip}${galho}${corpo}${moita(-20, 880, 18, 430, -80, 90, escuros)}${moita(1620, 880, 18, 430, 170, 90, escuros)}${moita(800, 960, 12, 300, -150, 120, escuros)}${moita(1620, 20, 14, 330, 80, 90, escuros)}${moita(-20, 20, 14, 330, 0, 90, escuros)}`, vag + onda];
    } },
    sakura: { nome: 'Sakura', grupo: 'natureza', arte(c, rnd) {
      c.blur('bm', 60);
      const ceu = c.lg('ceu', [[0, '#1E1250'], [.36, '#6E2A86'], [.62, '#E8679E'], [.8, '#FFC3A3']]);
      const sol = c.lg('sol', [[0, '#FFF6E8'], [1, '#FFC2D6']]);
      const fu = c.lg('fu', [[0, '#FFFFFF'], [.2, '#F4D8F0'], [.32, '#7A4A9A'], [1, '#3C2466']]);
      const lago = c.lg('lago', [[0, '#E884AE'], [1, '#2A1650']]);
      const flor = ['#FFD6E8', '#FFB3D1', '#FF8FBC', '#FFE8F2'];
      const copa = (x, y, rx, ry, n) => { let s = ''; for (let i = 0; i < n; i++) { const a = rnd() * 6.28, d = Math.sqrt(rnd()); s += `<circle cx="${f1(x + Math.cos(a) * rx * d)}" cy="${f1(y + Math.sin(a) * ry * d)}" r="${f1(9 + rnd() * 18)}" fill="${flor[i % 4]}" opacity="${f1(.65 + rnd() * .35)}"/>`; } return s; };
      const tronco = `<path d="M-40 900C60 720 40 560 130 430C190 345 300 290 420 210M112 470C70 360 40 270 -40 190M178 370C250 370 330 390 440 370" fill="none" stroke="#2A1230" stroke-width="30" stroke-linecap="round"/><path d="M1640 760C1540 640 1500 480 1430 330C1390 250 1300 190 1190 140M1450 390C1500 310 1560 270 1640 240M1420 310C1350 310 1280 340 1180 330" fill="none" stroke="#2A1230" stroke-width="26" stroke-linecap="round"/>`;
      const pag = `<g fill="#1E0F38"><path d="M1090 640V556H1150V640ZM1062 560L1120 512L1178 560ZM1098 516V470H1142V516ZM1072 474L1120 432L1168 474ZM1104 436V402H1136V436ZM1084 406L1120 370L1156 406Z"/></g>`;
      const pet = Array.from({ length: 44 }, () => { const x = rnd() * 1600, y = rnd() * 900, e = .7 + rnd() * .9; return `<path class="pw-cai pw-roda" ${anima(rnd, 11)} d="M${f1(x)} ${f1(y)}c${f1(6 * e)} ${f1(-8 * e)} ${f1(16 * e)} ${f1(-6 * e)} ${f1(17 * e)} ${f1(2 * e)}c${f1(-5 * e)} ${f1(7 * e)} ${f1(-13 * e)} ${f1(6 * e)} ${f1(-17 * e)} ${f1(-2 * e)}z" fill="${flor[Math.floor(rnd() * 4)]}"/>`; }).join('');
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 70, 230)}<circle cx="800" cy="370" r="330" fill="#FFD6E8" opacity=".55" filter="${c.u('bm')}"/><circle cx="800" cy="370" r="186" fill="${sol}"/><path d="M340 650L700 300Q800 240 900 300L1260 650Z" fill="${fu}"/><path d="${serra(rnd, 610, 54, 90, 650)}" fill="#46286E"/>${pag}<rect y="646" width="1600" height="254" fill="${lago}"/>${[676, 712, 748, 790].map((y, i) => `<rect x="${620 + i * 22}" y="${y}" width="${360 - i * 44}" height="5" rx="2.5" fill="#FFF6E8" opacity=".55"/>`).join('')}<path d="${curva(860, 16, 200, 2, 900)}" fill="#1A0A2E"/>${tronco}${copa(120, 120, 260, 150, 120)}${copa(360, 230, 200, 110, 90)}${copa(1480, 110, 260, 140, 120)}${copa(1240, 190, 190, 100, 80)}`, pet];
    } },
    tempestade: { nome: 'Tempestade', grupo: 'natureza', arte(c, rnd) {
      c.blur('br', 30); c.blur('bm', 12);
      const f = c.lg('f', [[0, '#080A1E'], [.5, '#1A1F4A'], [.75, '#2C3A7A'], [1, '#0A1030']]);
      const nv = (x, y, w, cor, n) => Array.from({ length: n }, () => `<ellipse cx="${f1(x + (rnd() - .5) * w)}" cy="${f1(y + (rnd() - .5) * 110)}" rx="${f1(70 + rnd() * 110)}" ry="${f1(36 + rnd() * 54)}" fill="${cor}"/>`).join('');
      const rioD = 'M812 170L760 330L836 352L742 520L812 540L716 760M760 330L640 410L668 430L590 520M812 540L910 640L892 660L990 760';
      const mar = c.lg('mar', [[0, '#2A4A9A'], [1, '#030818']]);
      const raio = (cl) => `<g class="${cl}"${cl ? ' opacity="0"' : ''}><path d="${rioD}" fill="none" stroke="#9FD0FF" stroke-width="30" stroke-linejoin="round" opacity=".6" filter="${c.u('bm')}"/><path d="${rioD}" fill="none" stroke="#fff" stroke-width="8" stroke-linejoin="round" stroke-linecap="round"/></g>`;
      const chuva = `<g class="pw-chuva" opacity=".55">${Array.from({ length: 110 }, () => { const x = rnd() * 1700, y = rnd() * 1000 - 100; return `<path d="M${f1(x)} ${f1(y)}l-12 46" stroke="#BFD4FF" stroke-width="2"/>`; }).join('')}</g>`;
      return [`<rect width="1600" height="900" fill="${f}"/><ellipse cx="790" cy="430" rx="620" ry="420" fill="${c.rg('cl', [[0, '#7FA8FF', .6], [1, '#7FA8FF', 0]])}"/><g filter="${c.u('br')}">${nv(800, 170, 1800, '#59619E', 22)}${nv(800, 104, 1800, '#2E3370', 26)}${nv(800, 30, 1800, '#12143A', 24)}</g>${raio('')}<path d="${curva(760, 26, 120, .7)}" fill="${mar}"/><path d="${curva(800, 34, 90, 2.4)}" fill="#0C1A4A"/><path d="${curva(850, 26, 70, 4)}" fill="#050C2A"/>`,
        `<rect class="pw-flash" opacity="0" width="1600" height="900" fill="#CFE0FF"/>${raio('pw-flash')}${chuva}`];
    } },
    dunas: { nome: 'Dunas', grupo: 'natureza', arte(c, rnd) {
      c.blur('bm', 50);
      const ceu = c.lg('ceu', [[0, '#1E0E52'], [.3, '#7A2A86'], [.55, '#F2607A'], [.72, '#FFB35C']]);
      const sol = c.lg('sol', [[0, '#FFF7CF'], [1, '#FFC24D']]);
      const d1 = c.lg('d1', [[0, '#C76A52'], [1, '#6E2F54']]), d2 = c.lg('d2', [[0, '#E89158'], [1, '#8A3F4E']]), d3 = c.lg('d3', [[0, '#FFB86B'], [1, '#A84E3E']]), d4 = c.lg('d4', [[0, '#F29E5A'], [1, '#5A2238']]);
      const rastro = (t) => [80 + t * 1440, 742 + Math.sin(t * 13) * 34 + (t - .5) * 40];
      const trilha = Array.from({ length: 70 }, (_, i) => rastro(i / 69));
      const d = `M${trilha.map(([x, y]) => `${f1(x)} ${f1(y)}`).join('L')}`;
      const cacto = (x, y, e, cor) => `<g transform="translate(${x} ${y}) scale(${e})" fill="none" stroke="${cor}" stroke-linecap="round" stroke-width="22"><path d="M0 0V-136"/><path d="M0 -44H-40V-92" stroke-width="16"/><path d="M0 -66H38V-110" stroke-width="16"/></g>`;
      const piram = `<path d="M1090 560L1210 420L1340 575Z" fill="#7A2F5C"/><path d="M1210 420L1340 575L1240 590Z" fill="#4E1E46"/><path d="M1270 560L1340 480L1420 575Z" fill="#6E2A54"/>`;
      const vento = Array.from({ length: 16 }, () => `<path class="pw-deriva" style="animation-duration:${f1(5 + rnd() * 6)}s;animation-delay:-${f1(rnd() * 10)}s" d="M-200 ${f1(560 + rnd() * 320)}h${f1(60 + rnd() * 110)}" stroke="#FFE3B0" stroke-opacity=".5" stroke-width="2.4" stroke-linecap="round"/>`).join('');
      const aves = [[520, 230, 1], [580, 200, .7], [470, 190, .6]].map(([x, y, e]) => `<path class="pw-flutua" d="M${x} ${y}q${14 * e} ${-16 * e} ${28 * e} 0q${14 * e} ${-16 * e} ${28 * e} 0" fill="none" stroke="#2A0E3A" stroke-width="4" stroke-linecap="round"/>`).join('');
      return [`<rect width="1600" height="900" fill="${ceu}"/>${estrelas2(rnd, 80, 240)}<circle cx="800" cy="500" r="380" fill="#FFD27A" opacity=".5" filter="${c.u('bm')}"/><circle cx="800" cy="500" r="205" fill="${sol}"/>${piram}<path d="${curva(590, 34, 190, 1)}" fill="${d1}"/><path d="${curva(650, 42, 150, 3.2)}" fill="${d2}"/><path d="${curva(720, 30, 240, 5)}" fill="${d3}"/>`
        + `<path d="${d}" fill="none" stroke="#7A3A3A" stroke-opacity=".5" stroke-width="16" stroke-linecap="round" stroke-linejoin="round"/><path d="${d}" fill="none" stroke="#FFD9A3" stroke-opacity=".55" stroke-width="5" stroke-linecap="round" stroke-linejoin="round" transform="translate(0 -6)"/>${cacto(250, 700, 1, '#2C1038')}${cacto(1420, 760, .7, '#2C1038')}<path d="${curva(838, 22, 200, 2)}" fill="${d4}"/>${cacto(1500, 860, 1.5, '#1A0A26')}`, aves + vento];
    } },
    trono: { nome: 'Trono de Ouro', grupo: 'campeao', titulos: 1, arte(c, rnd) {
      c.blur('bm', 46); c.blur('bp', 8);
      const f = c.rg('f', [[0, '#7A4A08'], [.45, '#2C1604'], [1, '#080401']], .5, .42, .82);
      const ou = c.lg('ou', [[0, '#FFF8D6'], [.4, '#FFD95A'], [.8, '#D9930E'], [1, '#7A4A00']]);
      const ou2 = c.lg('ou2', [[0, '#7A4A00'], [.5, '#FFD95A'], [1, '#7A4A00']], 1, 0);
      const pil = c.lg('pil', [[0, '#3A2206'], [.3, '#B97F14'], [.5, '#FFE28A'], [.7, '#B97F14'], [1, '#3A2206']], 1, 0);
      const manto = c.lg('manto', [[0, '#5B1FA8'], [1, '#22083F']]);
      const raios = Array.from({ length: 36 }, (_, i) => { const g = i / 36 * Math.PI * 2; return i % 2 ? '' : `<path d="M800 330L${f1(800 + Math.cos(g - .06) * 1100)} ${f1(330 + Math.sin(g - .06) * 1100)}L${f1(800 + Math.cos(g + .06) * 1100)} ${f1(330 + Math.sin(g + .06) * 1100)}Z" fill="#FFD95A" opacity=".13"/>`; }).join('');
      const coluna = (x) => `<rect x="${x}" y="60" width="96" height="780" fill="${c.u('pil')}"/><rect x="${x - 16}" y="40" width="128" height="30" rx="5" fill="${c.u('ou')}"/><rect x="${x - 16}" y="830" width="128" height="30" rx="5" fill="${c.u('ou')}"/>`;
      const coroa = `<path d="M580 470L536 180L676 300L800 90L924 300L1064 180L1020 470Z" fill="${ou}" stroke="#7A4A00" stroke-width="7" stroke-linejoin="round"/><path d="M800 90L800 470M676 300L640 470M924 300L960 470" stroke="#FFF8D6" stroke-opacity=".45" stroke-width="7"/><rect x="566" y="456" width="468" height="62" rx="16" fill="${ou2}" stroke="#7A4A00" stroke-width="6"/>${[[536, 180], [800, 90], [1064, 180]].map(([x, y]) => `<circle cx="${x}" cy="${y}" r="24" fill="#FFFDF0" stroke="#7A4A00" stroke-width="6"/>`).join('')}<path d="M800 338l26 40-26 40-26-40z" fill="#7DF9FF" stroke="#fff" stroke-width="4"/><circle cx="664" cy="487" r="16" fill="#3B82F6" stroke="#FFF8D6" stroke-width="3"/><circle cx="936" cy="487" r="16" fill="#22E07A" stroke="#FFF8D6" stroke-width="3"/><circle cx="800" cy="487" r="18" fill="#FF4F8A" stroke="#FFF8D6" stroke-width="3"/>`;
      const deg = [0, 1, 2].map((i) => `<rect x="${360 - i * 80}" y="${630 + i * 50}" width="${880 + i * 160}" height="${50}" fill="${i % 2 ? '#3A2206' : '#5A3A0E'}"/><rect x="${360 - i * 80}" y="${630 + i * 50}" width="${880 + i * 160}" height="5" fill="#FFD95A" opacity=".7"/>`).join('');
      const fa = Array.from({ length: 36 }, () => { const x = 200 + rnd() * 1200, y = rnd() * 900, r = 3 + rnd() * 7; return `<g class="pw-sobe" ${anima(rnd, 10)}><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#FFD95A"/></g>`; }).join('');
      return [`<rect width="1600" height="900" fill="${f}"/>${raios}<path d="M-40 -10H620C520 180 320 300 110 330L-40 340Z" fill="${manto}"/><path d="M1640 -10H980C1080 180 1280 300 1490 330L1640 340Z" fill="${manto}"/><path d="M-40 330C160 330 480 210 620 -10" fill="none" stroke="#FFD95A" stroke-width="9"/><path d="M1640 330C1440 330 1120 210 980 -10" fill="none" stroke="#FFD95A" stroke-width="9"/>${coluna(170)}${coluna(1334)}${deg}<circle cx="800" cy="320" r="360" fill="#FFD95A" opacity=".42" filter="${c.u('bm')}"/><rect x="540" y="500" width="520" height="132" fill="#2C1604"/><rect x="540" y="500" width="520" height="12" fill="${ou2}"/>${coroa}`,
        `${fa}${brilhos(rnd, 16, 700, '#FFF8D6', 8, 20)}`];
    } },
    salao: { nome: 'Salão dos Campeões', grupo: 'campeao', titulos: 1, arte(c, rnd) {
      c.blur('bm', 40); c.blur('bp', 5);
      const f = c.lg('f', [[0, '#050A1E'], [.55, '#0E1A44'], [.7, '#0A0F2C']]);
      const ch = c.lg('ch', [[0, '#1C2A66'], [1, '#050817']]);
      const ou = c.lg('ou', [[0, '#FFF8D6'], [.35, '#FFD95A'], [.7, '#E39A12'], [1, '#FFE28A']], 1, 0);
      const luz = c.lg('luz', [[0, '#CFE4FF', .6], [1, '#CFE4FF', 0]]);
      const taca = (x, y, e, g) => `<g transform="translate(${x} ${y}) scale(${e})" fill="${g}" stroke="#7A4A00" stroke-width="${f1(4 / e)}" stroke-linejoin="round"><path d="M-74 -212C-132 -212 -128 -118 -56 -106L-50 -130C-92 -138 -94 -188 -70 -190ZM74 -212C132 -212 128 -118 56 -106L50 -130C92 -138 94 -188 70 -190Z"/><path d="M-82 -240H82C82 -110 42 -72 14 -62V-26H-14V-62C-42 -72 -82 -110 -82 -240Z"/><path d="M-46 -26H46L60 0H-60Z"/></g>`;
      const feixe = (x, a) => `<path d="M${x} -20L${x + a - 90} 720H${x + a + 90}Z" fill="${luz}"/>`;
      const prat = (y, l) => `<rect x="${l ? 0 : 1160}" y="${y}" width="440" height="16" fill="#2A3770"/><rect x="${l ? 0 : 1160}" y="${y}" width="440" height="3" fill="#7DA0FF"/>`;
      const fila = (y, l) => [60, 170, 280, 390].map((x, i) => taca(l ? x : 1600 - x, y, .36 + (i % 2) * .05, c.u(i % 3 === 2 ? 'pr' : 'ou'))).join('');
      c.lg('pr', [[0, '#FFFFFF'], [.5, '#AEBBD0'], [1, '#EEF2F8']], 1, 0);
      const pil = (x) => `<rect x="${x}" y="0" width="64" height="660" fill="#101A48"/><rect x="${x}" y="0" width="16" height="660" fill="#22337A"/>`;
      const band = (x, cor) => `<path d="M${x} 90H${x + 150}V330L${x + 75} 270L${x} 330Z" fill="${cor}"/><path d="M${x + 75} 150l13 26 29 4-21 20 5 29-26-14-26 14 5-29-21-20 29-4z" fill="#FFD95A"/>`;
      const refl = `<g transform="matrix(1 0 0 -.5 0 985)" opacity=".28">${taca(800, 640, 1.35, c.u('ou'))}</g>`;
      const fa = Array.from({ length: 30 }, () => { const x = 480 + rnd() * 640, y = rnd() * 700, r = 3 + rnd() * 6; return `<g class="pw-sobe" ${anima(rnd, 11)}><circle cx="${f1(x)}" cy="${f1(y)}" r="${f1(r)}" fill="#FFE8A3"/></g>`; }).join('');
      return [`<rect width="1600" height="900" fill="${f}"/>${pil(446)}${pil(1090)}${band(528, '#3B1E8A')}${band(922, '#0F5E7A')}${prat(380, true)}${prat(380, false)}${prat(620, true)}${prat(620, false)}${fila(380, true)}${fila(380, false)}${fila(620, true)}${fila(620, false)}<rect y="640" width="1600" height="260" fill="${ch}"/><rect y="640" width="1600" height="4" fill="#7DA0FF" opacity=".5"/>${[-3, -2, -1, 0, 1, 2, 3].map((i) => `<path d="M${800 + i * 130} 640L${800 + i * 520} 900" stroke="#3A4FA8" stroke-width="2"/>`).join('')}${[696, 770, 860].map((y) => `<rect y="${y}" width="1600" height="2" fill="#3A4FA8"/>`).join('')}${refl}${feixe(500, 300)}${feixe(1100, -300)}${feixe(800, 0)}<circle cx="800" cy="440" r="280" fill="#FFD95A" opacity=".38" filter="${c.u('bm')}"/><rect x="640" y="640" width="320" height="30" rx="6" fill="#27357A"/><rect x="680" y="608" width="240" height="34" rx="6" fill="#3A4FA8"/>${taca(800, 610, 1.35, c.u('ou'))}`, fa + brilhos(rnd, 12, 640, '#FFF8D6', 8, 20)];
    } },
    supernova: { nome: 'Supernova', grupo: 'campeao', titulos: 2, arte(c, rnd) {
      c.blur('bm', 30); c.blur('bg', 90); c.blur('bp', 10);
      const nu = c.rg('nu', [[0, '#FFFFFF'], [.14, '#FFFFFF'], [.3, '#BFF9FF', .95], [.55, '#FF6FCF', .5], [1, '#7A2FFF', 0]]);
      const raios = Array.from({ length: 150 }, () => { const g = rnd() * 6.283, l = 180 + rnd() * rnd() * 840, w = .008 + rnd() * .02, cor = ['#FFFFFF', '#BFF9FF', '#FF9FE0', '#C79BFF', '#FFE3A3'][Math.floor(rnd() * 5)]; return `<path d="M800 440L${f1(800 + Math.cos(g - w) * l)} ${f1(440 + Math.sin(g - w) * l * .78)}L${f1(800 + Math.cos(g + w) * l)} ${f1(440 + Math.sin(g + w) * l * .78)}Z" fill="${cor}" opacity="${f1(.25 + rnd() * .6)}"/>`; }).join('');
      const nuvem = Array.from({ length: 16 }, (_, i) => { const g = i / 16 * 6.283, d = 300 + rnd() * 260, cor = i % 3 ? '#7A2FFF' : '#FF4FA3'; return `<ellipse cx="${f1(800 + Math.cos(g) * d)}" cy="${f1(440 + Math.sin(g) * d * .7)}" rx="${f1(120 + rnd() * 130)}" ry="${f1(80 + rnd() * 80)}" fill="${cor}" opacity=".5"/>`; }).join('');
      const aneis = [0, 1, 2].map((i) => `<ellipse class="pw-expande" style="animation-delay:-${i * 2}s" cx="800" cy="440" rx="${380}" ry="${300}" fill="none" stroke="#BFF9FF" stroke-width="5"/>`).join('');
      const est = [[300, 3], [460, 2]].map(([r, w]) => `<ellipse cx="800" cy="440" rx="${r}" ry="${r * .78}" fill="none" stroke="#BFF9FF" stroke-opacity=".35" stroke-width="${w}"/>`).join('');
      const est2 = Array.from({ length: 40 }, () => { const g = rnd() * 6.283, l = 220 + rnd() * 560, x = 800 + Math.cos(g) * l, y = 440 + Math.sin(g) * l * .78; return `<path class="pw-pisca" ${anima(rnd, 2.6)} d="${brilho4(x, y, 6 + rnd() * 12)}" fill="#fff"/>`; }).join('');
      return [`<rect width="1600" height="900" fill="#04010F"/>${estrelas2(rnd, 340)}<g filter="${c.u('bg')}">${nuvem}</g><g filter="${c.u('bp')}" opacity=".7">${raios}</g>${raios}${est}<ellipse cx="800" cy="440" rx="520" ry="410" fill="${nu}"/><circle cx="800" cy="440" r="120" fill="#fff" filter="${c.u('bm')}"/>`, aneis + est2];
    } },
    reino: { nome: 'Reino Diamante', grupo: 'campeao', titulos: 3, arte(c, rnd) {
      c.blur('bm', 44); c.blur('bg', 90); c.blur('bp', 5);
      const f = c.rg('f', [[0, '#3A2FA8'], [.5, '#120E3A'], [1, '#03021A']], .5, .42, .85);
      const ARCO = ['#FF8FB1', '#FFD36E', '#8BFFB0', '#7DE3FF', '#B79BFF'];
      const fac = [['#FFFFFF', '#CFEFFF'], ['#BFE3FF', '#7FA8FF'], ['#E8F8FF', '#A9C8FF'], ['#8FA8FF', '#5B5FD8'], ['#D6F2FF', '#8FC8FF']].map(([a, b], i) => c.lg(`g${i}`, [[0, a], [1, b]], 1, 1));
      const cristal = (x, h, w, k) => { const y = 900 - h; return `<path d="M${f1(x - w / 2)} 900L${f1(x - w / 2)} ${f1(y + w * .6)}L${f1(x)} ${f1(y)}V900Z" fill="${fac[k % 5]}"/><path d="M${f1(x + w / 2)} 900L${f1(x + w / 2)} ${f1(y + w * .6)}L${f1(x)} ${f1(y)}V900Z" fill="${fac[(k + 3) % 5]}"/><path d="M${f1(x - w / 2)} ${f1(y + w * .6)}L${f1(x)} ${f1(y)}L${f1(x)} ${f1(y + w * .95)}Z" fill="#fff" fill-opacity=".5"/>`; };
      const atras = Array.from({ length: 16 }, (_, i) => { const x = 40 + i * 104 + rnd() * 30; return { x, h: 170 + Math.abs(x - 800) * .28 + rnd() * 130, w: 90 + rnd() * 70, k: i }; });
      const frente = Array.from({ length: 12 }, (_, i) => { const x = 20 + i * 142 + rnd() * 40; return { x, h: 60 + Math.abs(x - 800) * .24 + rnd() * 100, w: 90 + rnd() * 70, k: i + 2 }; });
      const raiosA = Array.from({ length: 22 }, (_, i) => { const g = i / 22 * 6.283, p = (d) => `${f1(800 + 1100 * Math.cos(g + d))} ${f1(360 + 1100 * Math.sin(g + d))}`; return `<path d="M800 360L${p(-.05)}L${p(.05)}Z" fill="${ARCO[i % 5]}" opacity=".2"/>`; }).join('');
      const X = 800, Y = 350;
      const pt = (a, b) => `${X + a} ${Y + b}`;
      const gem = [[pt(-240, -60), pt(-130, -170), pt(-60, -60), fac[2]], [pt(-130, -170), pt(0, -170), pt(-60, -60), fac[0]], [pt(0, -170), pt(60, -60), pt(-60, -60), fac[4]], [pt(0, -170), pt(130, -170), pt(60, -60), fac[0]], [pt(130, -170), pt(240, -60), pt(60, -60), fac[1]],
        [pt(-240, -60), pt(-60, -60), pt(0, 240), fac[1]], [pt(-60, -60), pt(60, -60), pt(0, 240), fac[0]], [pt(60, -60), pt(240, -60), pt(0, 240), fac[3]]].map(([a, b, d, g]) => `<path d="M${a}L${b}L${d}Z" fill="${g}" stroke="#fff" stroke-opacity=".75" stroke-width="3" stroke-linejoin="round"/>`).join('');
      const fa = Array.from({ length: 34 }, () => { const x = rnd() * 1600, y = rnd() * 760, r = 7 + rnd() * 15; return `<path class="pw-pisca" ${anima(rnd, 3)} d="${brilho4(x, y, r)}" fill="${ARCO[Math.floor(rnd() * 5)]}"/>`; }).join('');
      return [`<rect width="1600" height="900" fill="${f}"/>${estrelas2(rnd, 260, 620)}${raiosA}<ellipse cx="800" cy="360" rx="520" ry="420" fill="#8FA8FF" opacity=".5" filter="${c.u('bg')}"/>${atras.map((a) => cristal(a.x, a.h, a.w, a.k)).join('')}<rect y="560" width="1600" height="340" fill="${c.lg('nev', [[0, '#1A1660', 0], [1, '#0B0830', .85]])}"/>${frente.map((a) => cristal(a.x, a.h, a.w, a.k)).join('')}<ellipse cx="800" cy="350" rx="280" ry="250" fill="#CFE4FF" opacity=".55" filter="${c.u('bm')}"/>`,
        `<g class="pw-flutua" style="animation-duration:7s">${gem}<path class="pw-pisca" d="${brilho4(700, 215, 46)}" fill="#fff"/></g>${fa}`];
    } },
  };
  const GRUPOS_PAREDE = { arena: 'ARENA', neon: 'NEON', espaco: 'ESPAÇO', natureza: 'NATUREZA', campeao: 'SÓ CAMPEÃO' };
  let numParede = 0;
  // parte: 'tudo' (imagem parada), 'base' (só o que não mexe) ou 'vivo' (só o que mexe, sem o fundo)
  function paredeSVG(id, parte = 'tudo') {
    const p = PAREDES[id];
    if (!p) return '';
    const c = { id: `pw${++numParede}`, defs: '' };
    const paradas = (l) => l.map(([o, cor, a]) => `<stop offset="${o}" stop-color="${cor}"${a === undefined ? '' : ` stop-opacity="${a}"`}/>`).join('');
    c.u = (n) => `url(#${c.id}${n})`;
    c.lg = (n, l, x2 = 0, y2 = 1) => { c.defs += `<linearGradient id="${c.id}${n}" x1="0" y1="0" x2="${x2}" y2="${y2}">${paradas(l)}</linearGradient>`; return c.u(n); };
    c.rg = (n, l, cx = .5, cy = .5, r = .5) => { c.defs += `<radialGradient id="${c.id}${n}" cx="${cx}" cy="${cy}" r="${r}">${paradas(l)}</radialGradient>`; return c.u(n); };
    c.blur = (n, d) => { c.defs += `<filter id="${c.id}${n}" x="-60%" y="-60%" width="220%" height="220%"><feGaussianBlur stdDeviation="${d}"/></filter>`; };
    const [base, vivo] = p.arte(c, sorteio(Object.keys(PAREDES).indexOf(id) * 97 + 11));
    const corpo = parte === 'base' ? base : parte === 'vivo' ? vivo : base + vivo;
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1600 900" preserveAspectRatio="xMidYMid slice"${parte === 'vivo' ? ' class="par-vivo" aria-hidden="true"' : ''}><defs>${c.defs}</defs>${corpo}</svg>`;
  }
  // no site: a imagem parada é gerada uma vez só e reaproveitada em todo lugar (não pesa a lista)
  const urlsParede = new Map();
  function urlParede(id, parte = 'tudo') {
    const k = `${id}:${parte}`;
    if (!urlsParede.has(k)) urlsParede.set(k, URL.createObjectURL(new Blob([paredeSVG(id, parte)], { type: 'image/svg+xml' })));
    return urlsParede.get(k);
  }
  const paredeDe = (k) => { const r = elenco.get(k); return r && PAREDES[r.parede] ? r.parede : null; };
  // a plaquinha do jogador (linha do ranking, pódio, membros...): classe e imagem em quem aparece a pessoa
  function comParede(n, k, cls = 'tem-parede') {
    const id = paredeDe(k);
    n.classList.toggle(cls, !!id);
    if (id) n.style.setProperty('--parede', `url("${urlParede(id)}")`); else n.style.removeProperty('--parede');
    return n;
  }
  // a versão animada (atrás do perfil e na prévia): a base parada e só o que mexe por cima
  function paredeAoVivo(box, id) {
    if ((box.dataset.parede || '') === (id || '')) return;
    box.dataset.parede = id || '';
    box.style.backgroundImage = id ? `url("${urlParede(id, 'base')}")` : '';
    box.innerHTML = id ? paredeSVG(id, 'vivo') : '';
  }

  // ---------- escolher o papel de parede ----------
  const ICONE_PAREDE = '<rect x="3" y="4.5" width="18" height="15" rx="2.5"/><circle cx="8.5" cy="9.5" r="1.7"/><path d="M4 18l5-5 3.5 3.5L16 13l4.5 4.5"/>';
  let pad = null; // { k, id, tinha, titulos }
  const podeMudarParede = (k) => paredeOk && podeMudarAvatar(k);
  const paredeTrancada = (id) => !!id && (PAREDES[id].titulos || 0) > pad.titulos;
  function abrirParede(k) {
    const r = elenco.get(k);
    if (!r || !podeMudarParede(k)) return;
    const id = paredeDe(k);
    pad = { k, id, tinha: !!id, titulos: titulosDe(k) };
    $('tituloParede').replaceChildren(lerEu() === k ? 'SEU PAPEL DE ' : `${r.nick.toUpperCase()} · PAPEL DE `, el('span', { class: 'laranja', text: 'PAREDE' }));
    $('btnParTirar').hidden = !pad.tinha;
    const pts = ptsPat(k);
    $('parId').replaceChildren(avatarDe(r.nick, pts, 'av-g'), el('div', { class: 'par-id-txt' },
      el('span', { class: 'pp-tag', text: `[${TAG}]` }), el('b', { text: r.nick }), chipPatente(pts)));
    const ordem = Object.keys(GRUPOS_PAREDE).sort((a, b) => (b === 'campeao') - (a === 'campeao'));
    trocar($('parCorpo'), ordem.map((g) => {
      const lenda = g === 'campeao';
      return el('section', { class: 'avd-sec' },
        el('h3', { class: `avd-rot ${lenda ? 'avd-rot-lenda' : ''}` }, GRUPOS_PAREDE[g],
          lenda ? el('span', { class: 'avd-titulos', text: pad.titulos ? `${pad.titulos} ${pad.titulos === 1 ? 'TÍTULO' : 'TÍTULOS'}` : 'SÓ CAMPEÃO' }) : null),
        el('div', { class: 'par-grade', role: 'radiogroup', 'aria-label': GRUPOS_PAREDE[g] }, ...Object.keys(PAREDES).filter((id) => PAREDES[id].grupo === g).map((id) => {
          const p = PAREDES[id], tranca = paredeTrancada(id);
          return el('button', { type: 'button', class: `par-op ${p.titulos ? 'raro-' + p.titulos : ''} ${tranca ? 'trancada' : ''}`, role: 'radio', 'data-par': id, 'aria-checked': 'false',
            'aria-label': `${p.nome}${tranca ? `, só pra campeão ${p.titulos}×` : ''}`, onclick: () => { pad.id = id; marcarParede(); } },
            el('span', { class: 'par-img', style: `background-image:url("${urlParede(id)}")` }, tranca ? el('span', { class: 'par-cadeado' }, svg(ICONE_CADEADO, 18)) : null),
            el('span', { class: 'par-nome', text: p.nome }),
            p.titulos ? el('span', { class: 'par-req' }, svg(ICONE_COROA, 11), tranca ? `CAMPEÃO ${p.titulos}×` : RARIDADE[p.titulos]) : null);
        })));
    }));
    marcarParede();
    $('dlgParede').showModal();
    $('dlgParede').focus();
  }
  // parede trancada dá pra ver (e babar), mas não dá pra salvar
  function marcarParede() {
    const { id } = pad, p = PAREDES[id], trava = paredeTrancada(id);
    paredeAoVivo($('parFundo'), id);
    $('parPalco').classList.toggle('sem-parede', !id);
    trocar($('parSelo'), !p ? null : trava
      ? el('span', { class: 'avd-raro trancada' }, svg(ICONE_CADEADO, 13), `CAMPEÃO ${p.titulos}×`)
      : el('span', { class: 'par-selo-nome', text: p.nome }));
    document.querySelectorAll('.par-op').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.par === id)));
    $('btnParSalvar').disabled = trava || !id;
    $('btnParSalvar').textContent = trava ? 'Bloqueado' : 'Salvar';
  }
  async function salvarParede(novo) {
    const r = elenco.get(pad.k);
    const btns = [$('btnParSalvar'), $('btnParTirar')];
    btns.forEach((b) => { b.disabled = true; });
    try {
      if (!DEMO) {
        const res = await sb.rpc('jogador_parede', { p_parede: novo, p_player: r.id });
        if (res.error) throw new Error(res.error.message);
        if (res.data === 'bloqueada') { toast('Esse papel de parede é só pra campeão de temporada.', true); return; }
        if (res.data !== 'ok') throw new Error(res.data);
      }
      r.parede = novo;
      $('dlgParede').close();
      render();
      if (chat.eu && chatVisivel()) desenharChat();
      toast(novo ? 'Papel de parede salvo! Já aparece pro clã todo.' : 'Papel de parede tirado.');
    } catch (e) {
      console.error(e);
      toast('Não deu pra salvar o papel de parede agora. Tenta de novo.', true);
    } finally {
      btns.forEach((b) => { b.disabled = false; });
      if ($('dlgParede').open) marcarParede();
    }
  }
  function btnPerfil(j, classe, conteudo) {
    return el('button', { type: 'button', class: classe, onclick: () => abrirPerfil(j.chave), 'aria-label': `Ver perfil de ${comTag(j.nome)}` }, conteudo || comTag(j.nome));
  }

  // ---------- medalhas ----------
  // Cada medalha sobe de nível (bronze, prata, ouro, diamante) e sai toda do histórico:
  // nada some quando o jogador perde uma posição. A vitrine guarda o id de até 3 medalhas.
  const METAIS = {
    bronze: { nome: 'Bronze', ordem: 1, aro: ['#FFE0C2', '#E0955A', '#A35A28', '#4A220A'], face: ['#FBC79A', '#C47838', '#6A3410'], fita: ['#4A2410', '#B8692F'], luz: '#FFB070' },
    prata: { nome: 'Prata', ordem: 2, aro: ['#FFFFFF', '#DCE4EE', '#8E9BAB', '#2E3642'], face: ['#FFFFFF', '#BAC5D2', '#5E6A79'], fita: ['#17407A', '#6FB3FF'], luz: '#CFE6FF' },
    ouro: { nome: 'Ouro', ordem: 3, aro: ['#FFF7C2', '#FFD84D', '#E39A12', '#5E3300'], face: ['#FFF3B0', '#F5BC35', '#8F5600'], fita: ['#A3122A', '#FFD84D'], luz: '#FFE58A' },
    diamante: { nome: 'Diamante', ordem: 4, aro: ['#FFFFFF', '#9FF6FF', '#A48BFF', '#22307E'], face: ['#F2FFFF', '#86DDF7', '#4152C2'], fita: ['#4B2FB0', '#7DF9FF'], luz: '#B8FBFF' },
    lenda: { nome: 'Lendária', ordem: 5, aro: ['#FFE3B0', '#FF8A2B', '#9A2A06', '#1C0703'], face: ['#5A2210', '#24100A', '#0A0302'], fita: ['#120705', '#FF7A1A'], luz: '#FF9A3D' },
  };
  const ORDEM_METAL = ['bronze', 'prata', 'ouro', 'diamante'];
  const plural = (n, um, varios) => `${fmt(n)} ${n === 1 ? um : varios}`;
  // patentes que valem medalha: as 4 de cima (Mestre, Grão-Mestre, Lendário, Diamantes)
  const NIVEIS_PATENTE = PATENTES.slice(-4).map((p) => p.nivel).filter((n) => n > 0);
  const MEDALHAS = [
    { id: 'massa', nome: 'Clube da massa', desc: 'Maior massa numa partida', niveis: [1, 2, 5, 10].map((x) => MARCO * x), massa: true,
      titulo: (v) => `Clube ${fmtK(v)}`, req: (v) => `1 partida de ${fmtK(v)}+`,
      icone: '<circle cx="12" cy="12" r="8.5"/><circle cx="12" cy="12" r="4"/><path d="M12 1.5v3M12 19.5v3M1.5 12h3M19.5 12h3"/>' },
    { id: 'cem', nome: `Máquina de ${fmtK(MARCO)}`, desc: `Partidas de ${marcoTxt}`, niveis: [5, 15, 30, 60],
      req: (v) => `${fmt(v)} partidas de ${marcoTxt}`, icone: '<path d="M13 2L4 14h7l-1 8 9-12h-7z"/>' },
    { id: 'rei', nome: 'Rei do clã', desc: 'Vezes que assumiu o 1º lugar do ranking geral', niveis: [1, 3, 6, 10],
      req: (v) => (v === 1 ? 'assumir o 1º do ranking geral' : `assumir o 1º do geral ${v}×`), icone: ICONE_COROA },
    { id: 'damas', nome: 'Campeão de damas', desc: 'Vezes que assumiu o 1º lugar do ranking de damas', niveis: [1, 3, 6, 10],
      req: (v) => (v === 1 ? 'assumir o 1º do ranking de damas' : `assumir o 1º das damas ${v}×`),
      icone: '<ellipse cx="12" cy="7.5" rx="8" ry="3.2"/><path d="M4 7.5v3.6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7.5"/><path d="M4 11.1v4.6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-4.6"/>' },
    { id: 'recorde', nome: 'Quebra-recorde', desc: 'Vezes que quebrou o recorde de massa do clã', niveis: [1, 2, 4, 7],
      req: (v) => (v === 1 ? 'quebrar o recorde do clã' : `quebrar o recorde do clã ${v}×`), icone: ICONE_ESTRELA },
    { id: 'temporada', nome: 'Campeão de temporada', desc: 'Temporadas ganhas (1º em pontos no mês)', niveis: [1, 2, 4, 6],
      req: (v) => `ganhar ${plural(v, 'temporada', 'temporadas')}`, icone: ICONE_TROFEU },
    { id: 'semana', nome: 'Cobra da semana', desc: 'Semanas fechadas em 1º em pontos', niveis: [1, 3, 8, 20],
      req: (v) => `ganhar ${plural(v, 'semana', 'semanas')}`,
      icone: '<path d="M4 19c3 1.5 7 1.2 9-1.2 2.4-2.8-.6-5.4-3.4-6.6-2.8-1.2-3.8-3.6-1.8-5.6C9.6 3.8 13 3.6 15.4 5"/><path d="M15.4 5l2.6-.6M18 4.4l2.5-1.4M18 4.4l2 1.8"/>' },
    { id: 'torneio', nome: 'Campeão de torneio', desc: 'Torneios do clã ganhos', niveis: [1, 3, 5, 10],
      req: (v) => `ganhar ${plural(v, 'torneio', 'torneios')}`,
      icone: '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>' },
    { id: 'vice', nome: 'Vice de torneio', desc: 'Vezes em 2º num torneio do clã', niveis: [1, 3, 5, 10],
      req: (v) => `${v}× vice de torneio`, icone: ICONE_MEDALHA },
    { id: 'patente', nome: 'Escalada', desc: 'Patente mais alta que já alcançou numa temporada', niveis: NIVEIS_PATENTE, patente: true,
      titulo: (v) => `Patente ${PATENTES[v].nome}`, req: (v) => `chegar em ${PATENTES[v].nome}`, icone: ICONE_PATENTE },
    { id: 'superacao', nome: 'Superação', desc: 'Vezes que bateu o próprio recorde', niveis: [3, 6, 10, 15],
      req: (v) => `bater o próprio recorde ${v}×`, icone: '<path d="M3 17l6-6 4 4 8-8"/><path d="M15 7h6v6"/>' },
    { id: 'chamas', nome: 'Em chamas', desc: 'Mais partidas numa mesma semana', niveis: [3, 7, 12, 20],
      req: (v) => `${v} partidas na mesma semana`, icone: '<path d="M12 22c4 0 7-3 7-7 0-5-4-6-5-11-3 2-4 5-4 8-1-1-2-2-2-4-2 2-3 4-3 7 0 4 3 7 7 7z"/>' },
    { id: 'sequencia', nome: 'Sem folga', desc: 'Dias seguidos com partida', niveis: [3, 7, 14, 30],
      req: (v) => `${v} dias seguidos jogando`, icone: '<rect x="3.5" y="5" width="17" height="15.5" rx="2.5"/><path d="M3.5 10h17M8 3v4M16 3v4M8.5 15l2.5 2.5 4.5-4.5"/>' },
    { id: 'fiel', nome: 'Fiel ao clã', desc: 'Partidas registradas', niveis: [10, 30, 75, 150],
      req: (v) => `${fmt(v)} partidas registradas`, icone: '<path d="M12 21s-7-4.5-7-11a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 6.5-7 11-7 11z"/>' },
    { id: 'veterano', nome: 'Veterano', desc: 'Tempo no clã', niveis: [30, 90, 180, 365],
      req: (v) => (v >= 365 ? '1 ano no clã' : `${v} dias no clã`), icone: '<path d="M7 3h10M7 21h10M8 3c0 5 8 5 8 9s-8 4-8 9M16 3c0 5-8 5-8 9s8 4 8 9"/>' },
    { id: 'estilo', nome: 'Estilo próprio', desc: 'Montou o próprio avatar', niveis: [1], metais: ['bronze'],
      req: () => 'montar o seu avatar', icone: ICONE_AVATAR },
    { id: 'fundador', nome: 'Fundador', desc: 'Jogou na Temporada 1. Não sai nunca mais.', niveis: [1], metais: ['lenda'], unica: true,
      req: () => 'jogar na Temporada 1', icone: '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/><path d="M9.5 6.5v4"/>' },
  ];
  const FAM = Object.fromEntries(MEDALHAS.map((m) => [m.id, m]));
  const metalDo = (m, i) => (m.metais ? m.metais[i] : ORDEM_METAL[ORDEM_METAL.length - m.niveis.length + i]); // i = 0..n-1
  const fimT1 = () => fimDoMes(inicioTemp1().getTime());

  // um passe pelo histórico (do mais velho pro mais novo) monta os números de todo mundo,
  // com a data em que cada nível foi batido
  let cacheMed = null;
  function historicoMedalhas() {
    const ck = `${partidas.length}:${partidas[0] ? partidas[0].id : ''}:${inicioPeriodo('semana')}`;
    if (cacheMed && cacheMed.k === ck) return cacheMed.v;
    const por = new Map();
    const de = (k) => {
      let x = por.get(k);
      if (!x) { x = { v: {}, datas: {}, semanas: new Map(), dia: null, corrida: 0, pontos: 0, t1: null }; por.set(k, x); }
      return x;
    };
    const sobe = (x, fam, valor, quando) => {
      if (valor <= (x.v[fam] || 0)) return;
      x.v[fam] = valor;
      const d = x.datas[fam] || (x.datas[fam] = []);
      FAM[fam].niveis.forEach((n, i) => { if (valor >= n && !d[i]) d[i] = quando; });
    };
    const semanas = new Map(); // início da semana -> Map(chave -> { pontos, cem, melhor })
    const t1 = inicioTemp1().getTime(), t1fim = fimT1();
    let recordeCla = 0, lider = null;
    for (let i = partidas.length - 1; i >= 0; i--) {
      const p = partidas[i];
      const k = chave(p.player), x = de(k), q = p.created_at, ms = Date.parse(q), pts = pontosDe(p.mass);
      const melhor = x.v.massa || 0;
      if (melhor && p.mass > melhor) sobe(x, 'superacao', (x.v.superacao || 0) + 1, q);
      sobe(x, 'massa', p.mass, q);
      if (p.mass >= MARCO) sobe(x, 'cem', (x.v.cem || 0) + 1, q);
      sobe(x, 'fiel', (x.v.fiel || 0) + 1, q);
      const ini = inicioPeriodo('semana', ms);
      const n = (x.semanas.get(ini) || 0) + 1;
      x.semanas.set(ini, n);
      sobe(x, 'chamas', n, q);
      const dia = new Date(ms).setHours(0, 0, 0, 0);
      if (x.dia !== dia) {
        x.corrida = x.dia != null && Math.round((dia - x.dia) / 86400000) === 1 ? x.corrida + 1 : 1;
        x.dia = dia;
        sobe(x, 'sequencia', x.corrida, q);
      }
      if (recordeCla && p.mass > recordeCla) sobe(x, 'recorde', (x.v.recorde || 0) + 1, q);
      recordeCla = Math.max(recordeCla, p.mass);
      x.pontos += pts;
      // os pontos só sobem, então basta comparar quem pontuou com o líder da hora
      if (lider !== k && (!lider || x.pontos > por.get(lider).pontos)) { lider = k; sobe(x, 'rei', (x.v.rei || 0) + 1, q); }
      let sm = semanas.get(ini);
      if (!sm) semanas.set(ini, sm = new Map());
      const w = sm.get(k) || { pontos: 0, cem: 0, melhor: 0 };
      w.pontos += pts; w.melhor = Math.max(w.melhor, p.mass);
      if (p.mass >= MARCO) w.cem += 1;
      sm.set(k, w);
      if (!x.t1 && ms >= t1 && ms < t1fim) x.t1 = q;
    }
    // semanas que já fecharam: quem fez mais pontos leva (desempate igual ao ranking)
    const agora = inicioPeriodo('semana');
    for (const [ini, sm] of [...semanas].sort((a, b) => a[0] - b[0])) {
      if (ini >= agora) continue;
      const [k, w] = [...sm].sort(([, a], [, b]) => b.pontos - a.pontos || b.cem - a.cem || b.melhor - a.melhor)[0];
      if (!w.pontos) continue;
      const x = por.get(k);
      sobe(x, 'semana', (x.v.semana || 0) + 1, new Date(ini + SEMANA_MS - 1).toISOString());
    }
    cacheMed = { k: ck, v: por };
    return por;
  }

  // "Campeão de damas": refaz o ranking de damas partida por partida (mesma ordem do jogos_placar:
  // vitórias, aproveitamento, partidas, nick) e anota quando cada um ASSUME o 1º. chave -> [ms]
  let cacheDamas = null;
  function liderancasDamas() {
    const ck = `${damasFins.length}:${damasFins.length ? damasFins[damasFins.length - 1].id : ''}:${jogPorId.size}`;
    if (cacheDamas && cacheDamas.k === ck) return cacheDamas.v;
    const placar = new Map(); // player id -> { id, p, v, nome }
    const por = new Map();
    const frente = (a, b) => (a.v !== b.v ? a.v > b.v : a.v * b.p !== b.v * a.p ? a.v * b.p > b.v * a.p : a.p !== b.p ? a.p > b.p : a.nome < b.nome);
    let lider = null;
    for (const p of damasFins) {
      for (const id of [p.brancas, p.pretas]) {
        if (!id) continue;
        let x = placar.get(id);
        if (!x) { const r = jogPorId.get(id); placar.set(id, x = { id, p: 0, v: 0, nome: r ? r.nick.toLocaleLowerCase('pt-BR') : '' }); }
        x.p += 1;
        if (p.vencedor === id) x.v += 1;
      }
      let top = null;
      for (const x of placar.values()) if (x.v && (!top || frente(x, top))) top = x;
      if (!top || top.id === lider) continue;
      lider = top.id;
      const r = jogPorId.get(top.id);
      if (!r) continue;
      const k = chave(r.nick);
      if (!por.has(k)) por.set(k, []);
      por.get(k).push(Date.parse(p.fim));
    }
    cacheDamas = { k: ck, v: por };
    return por;
  }
  // o jogos.js avisa quando uma partida de damas termina com o site aberto
  function damasFim(p) {
    // partida de torneio não entra no ranking normal (nem na medalha)
    if (!p || !p.id || !p.fim || p.torneio || (p.jogo && p.jogo !== 'damas') || damasFins.some((x) => x.id === p.id)) return;
    damasFins.push({ id: p.id, brancas: p.brancas, pretas: p.pretas, vencedor: p.vencedor || null, fim: p.fim });
    damasFins.sort((a, b) => Date.parse(a.fim) - Date.parse(b.fim) || (a.id < b.id ? -1 : 1));
    cacheRaras = null;
    if (perfilAtual) renderPerfil();
  }

  // estado de cada medalha do jogador: nivel = quantos níveis já tem (0 = trancada)
  function medalhasDe(k, ctx) {
    const h = historicoMedalhas().get(k) || { v: {}, datas: {} };
    const r = elenco.get(k);
    const v = { ...h.v }, datas = { ...h.datas };
    // contagens com data: ordena as datas e marca quando bateu cada nível
    const porDatas = (fam, lista) => {
      const ord = lista.slice().sort((a, b) => a - b);
      v[fam] = ord.length;
      datas[fam] = FAM[fam].niveis.map((n) => (ord[n - 1] != null ? new Date(ord[n - 1]).toISOString() : null));
    };
    porDatas('temporada', ctx.temps.filter((t) => !t.atual && t.top[0].chave === k).map((t) => t.fim - 1));
    const tn = trofeusDe(k);
    porDatas('torneio', tn.filter((x) => x.pos === 1).map((x) => x.quando));
    porDatas('vice', tn.filter((x) => x.pos === 2).map((x) => x.quando));
    porDatas('damas', liderancasDamas().get(k) || []);
    // patente: a mais alta que já teve; a "data" é a temporada em que chegou
    v.patente = 0; datas.patente = [];
    for (const [mc, mapa] of patentesPorTemporada()) {
      const x = mapa.get(k);
      if (!x) continue;
      const [a, m] = mc.split('-').map(Number);
      const ms = new Date(a, m - 1, 1).getTime();
      v.patente = Math.max(v.patente, x.fim);
      FAM.patente.niveis.forEach((n, i) => { if (x.fim >= n && !datas.patente[i]) datas.patente[i] = { temp: ms }; });
    }
    const desde = r && r.created_at ? Date.parse(r.created_at) : null;
    v.veterano = desde ? Math.floor((Date.now() - desde) / 86400000) : 0;
    datas.veterano = FAM.veterano.niveis.map((n) => (desde && v.veterano >= n ? new Date(desde + n * 86400000).toISOString() : null));
    v.estilo = r && r.avatar ? 1 : 0;
    datas.estilo = [];
    v.fundador = h.t1 ? 1 : 0;
    datas.fundador = [h.t1];
    return MEDALHAS.map((m) => {
      const valor = v[m.id] || 0;
      const nivel = m.niveis.filter((n) => valor >= n).length;
      return { ...m, valor, nivel, datas: datas[m.id] || [], metal: nivel ? metalDo(m, nivel - 1) : null, prox: m.niveis[nivel] ?? null };
    }).filter((m) => !m.unica || m.nivel || Date.now() < fimT1()); // a do Fundador some pra quem não tem quando a T1 acaba
  }
  // 0 a 1 até o próximo nível
  const progMed = (m) => (m.prox == null ? 1 : m.patente ? m.valor / m.prox : Math.min(1, m.valor / m.prox));
  const progTxt = (m) => (m.patente ? PATENTES[m.valor].nome : m.massa
    ? `${fmt(Math.floor(Math.min(m.valor, m.prox) / 1000))}K/${fmtK(m.prox)}` : `${fmt(Math.min(m.valor, m.prox))}/${fmt(m.prox)}`);
  const tituloMed = (m, i = m.nivel - 1) => (m.titulo && i >= 0 ? m.titulo(m.niveis[i]) : m.nome);
  function quandoTxt(d) {
    if (!d) return '';
    if (d.temp) return `na ${nomeTemp(d.temp)}`;
    return `em ${new Date(d).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: '2-digit' }).replace(/\./g, '')}`;
  }

  // quantos do clã têm cada nível de cada medalha (pra raridade e pra lista de quem tem)
  let cacheRaras = null;
  function membrosMed(ctx) {
    const ks = new Set(ctx.pontos.map((j) => j.chave));
    for (const r of jogadores) if (r.ativo) ks.add(chave(r.nick));
    return [...ks];
  }
  function raridades(ctx) {
    if (cacheRaras) return cacheRaras;
    const ks = membrosMed(ctx);
    const donos = new Map(MEDALHAS.map((m) => [m.id, []])); // id -> [{ chave, nivel }]
    for (const k of ks) for (const m of medalhasDe(k, ctx)) if (m.nivel) donos.get(m.id).push({ chave: k, nivel: m.nivel, metal: m.metal });
    for (const l of donos.values()) l.sort((a, b) => b.nivel - a.nivel);
    cacheRaras = { total: ks.length, donos, nomes: new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j.nome])) };
    return cacheRaras;
  }
  const nomeRar = (rar, k) => (elenco.get(k) ? elenco.get(k).nick : rar.nomes.get(k) || k);
  const qtdCom = (rar, id, nivel) => (rar.donos.get(id) || []).filter((x) => x.nivel >= nivel).length;
  function raridade(qtd, total, m = null) {
    if (m && m.unica) return { txt: 'EDIÇÃO ÚNICA', cls: 'r-lenda' };
    const f = qtd / Math.max(1, total);
    return f <= 0.05 ? { txt: 'LENDÁRIA', cls: 'r-lenda' } : f <= 0.15 ? { txt: 'ÉPICA', cls: 'r-epica' } : f <= 0.35 ? { txt: 'RARA', cls: 'r-rara' } : { txt: 'COMUM', cls: 'r-comum' };
  }

  // ---------- desenho da medalha ----------
  // fita, presilha, aro (liso no bronze, perolado na prata, raiado no ouro/diamante) e a face com o símbolo em relevo.
  // metal null = trancada (cinza, com o anel de progresso em volta)
  let numMed = 0;
  function medalhaSVG(m, metal, prog = 0) {
    const id = 'md' + (++numMed);
    const M = METAIS[metal];
    const aro = M ? M.aro : ['#4E423A', '#30271F', '#1E1813', '#0B0806'];
    const face = M ? M.face : ['#2C241E', '#1B1511', '#0E0A08'];
    const fita = M ? M.fita : ['#1A1411', '#33281F'];
    const cx = 50, cy = 76, R = 32;
    const raio = (n, r1, r2, giro = 0) => Array.from({ length: n * 2 }, (_, i) => {
      const a = Math.PI / n * i + giro, d = i % 2 ? r2 : r1;
      return `${(cx + d * Math.cos(a)).toFixed(1)},${(cy + d * Math.sin(a)).toFixed(1)}`;
    }).join(' ');
    const tira = (a, b, c, d, cor) => `<polygon points="${a} ${b} ${c} ${d}" fill="${cor}"/>`;
    let borda = '';
    if (metal === 'ouro' || metal === 'diamante' || metal === 'lenda') borda = `<polygon points="${raio(metal === 'diamante' ? 12 : 18, R + 7, R + 1.5)}" fill="url(#${id}a)" stroke="${aro[3]}" stroke-width=".8" stroke-linejoin="round"/>`;
    const perolas = metal === 'prata' ? Array.from({ length: 26 }, (_, i) => {
      const a = Math.PI * 2 * i / 26;
      return `<circle cx="${(cx + (R - 2.6) * Math.cos(a)).toFixed(1)}" cy="${(cy + (R - 2.6) * Math.sin(a)).toFixed(1)}" r="1.25" fill="${aro[0]}" opacity=".85"/>`;
    }).join('') : '';
    const facetas = metal === 'diamante' ? `<g stroke="#fff" stroke-opacity=".35" stroke-width=".8">${Array.from({ length: 8 }, (_, i) => {
      const a = Math.PI / 4 * i + Math.PI / 8;
      return `<line x1="${cx}" y1="${cy}" x2="${(cx + (R - 5) * Math.cos(a)).toFixed(1)}" y2="${(cy + (R - 5) * Math.sin(a)).toFixed(1)}"/>`;
    }).join('')}</g>` : '';
    const anel = M ? '' : (() => {
      const c = 2 * Math.PI * (R + 5);
      return `<circle cx="${cx}" cy="${cy}" r="${R + 5}" fill="none" stroke="#2A1D14" stroke-width="3"/>`
        + (prog > 0 ? `<circle class="md-anel" cx="${cx}" cy="${cy}" r="${R + 5}" fill="none" stroke="#FF7A1A" stroke-width="3" stroke-linecap="round" stroke-dasharray="${(c * Math.min(1, prog)).toFixed(1)} ${c.toFixed(1)}" transform="rotate(-90 ${cx} ${cy})"/>` : '');
    })();
    const sombraIc = metal === 'lenda' ? '#000' : aro[3];
    const corIc = metal === 'lenda' ? `url(#${id}f)` : M ? aro[3] : '#5A4A40';
    const ic = `<g transform="translate(${cx - 15.6} ${cy - 15.6}) scale(1.3)" fill="none" stroke-linecap="round" stroke-linejoin="round">`
      + (M ? `<g stroke="${M.luz}" stroke-opacity=".75" stroke-width="2.4" transform="translate(.45 .55)">${m.icone}</g>` : '')
      + `<g stroke="${corIc}" stroke-width="2.1">${m.icone}</g>`
      + (M && metal !== 'lenda' ? `<g stroke="${sombraIc}" stroke-opacity=".35" stroke-width="1" transform="translate(-.3 -.35)">${m.icone}</g>` : '')
      + '</g>';
    return `<svg class="md-svg" viewBox="0 0 100 120" aria-hidden="true" xmlns="http://www.w3.org/2000/svg">
<defs>
<linearGradient id="${id}a" x1="0" y1="0" x2=".8" y2="1"><stop offset="0" stop-color="${aro[0]}"/><stop offset=".3" stop-color="${aro[1]}"/><stop offset=".72" stop-color="${aro[2]}"/><stop offset="1" stop-color="${aro[3]}"/></linearGradient>
<radialGradient id="${id}b" cx=".38" cy=".32" r=".78"><stop offset="0" stop-color="${face[0]}"/><stop offset=".55" stop-color="${face[1]}"/><stop offset="1" stop-color="${face[2]}"/></radialGradient>
<linearGradient id="${id}c" x1="0" y1="0" x2="1" y2="1"><stop offset=".38" stop-color="#fff" stop-opacity="0"/><stop offset=".5" stop-color="#fff" stop-opacity=".7"/><stop offset=".62" stop-color="#fff" stop-opacity="0"/></linearGradient>
<linearGradient id="${id}f" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1B8"/><stop offset=".5" stop-color="#FFB347"/><stop offset="1" stop-color="#FF5A1A"/></linearGradient>
<clipPath id="${id}k"><circle cx="${cx}" cy="${cy}" r="${R + 7}"/></clipPath>
</defs>
<g class="md-fita">
${tira('56,0', '78,0', '62,50', '42,46', fita[0])}${tira('63,0', '71,0', '55.5,48.5', '49,47', fita[1])}<polygon points="56,0 78,0 62,50 42,46" fill="#000" opacity=".28"/>
${tira('22,0', '44,0', '58,46', '38,50', fita[0])}${tira('29,0', '37,0', '51,47', '44.5,48.5', fita[1])}
</g>
<rect x="38" y="35" width="24" height="9" rx="3" fill="url(#${id}a)" stroke="${aro[3]}" stroke-width=".8"/>
${anel}${borda}
<circle cx="${cx}" cy="${cy}" r="${R}" fill="url(#${id}a)" stroke="${aro[3]}" stroke-width="1"/>
<circle cx="${cx}" cy="${cy}" r="${R - 5.5}" fill="url(#${id}b)" stroke="${aro[3]}" stroke-opacity=".7" stroke-width="1"/>
<circle cx="${cx}" cy="${cy}" r="${R - 7}" fill="none" stroke="#fff" stroke-opacity="${M ? .22 : .04}" stroke-width=".8"/>
${perolas}${facetas}${ic}
${M ? `<g class="md-brilho" clip-path="url(#${id}k)"><rect x="-80" y="30" width="70" height="90" fill="url(#${id}c)"/></g>` : ''}
</svg>`;
  }
  function medalhaEl(m, metal = m.metal, cls = '') {
    const w = el('span', { class: `md ${metal ? 'md-' + metal : 'md-trancada'} ${cls}` });
    w.innerHTML = medalhaSVG(m, metal, metal ? 0 : progMed(m));
    return w;
  }
  function contexto() {
    const temps = montarTemporadas();
    return { pontos: montarRanking('geral', 'pontos'), massa: montarRanking('geral', 'massa'), semana: montarRanking('semana', 'pontos'), temps, titulos: contarTitulos(temps) };
  }

  // ---------- destaques ----------
  function fechaSemanaTxt() {
    const fim = inicioPeriodo('semana') + 7 * 86400000;
    const h = Math.max(0, Math.round((fim - Date.now()) / 3600000));
    if (h < 1) return 'a semana fecha em instantes';
    if (h < 24) return `a semana fecha em ${h} h`;
    const d = Math.floor(h / 24);
    return `a semana fecha em ${d} ${d === 1 ? 'dia' : 'dias'}${h % 24 ? ` e ${h % 24} h` : ''}`;
  }
  function partidasPara(falta) {
    // quantas partidas de 100K cobrem a diferença
    const vale = pontosDe(META);
    if (!vale) return '';
    const n = Math.ceil(falta / vale);
    return ` (${n} ${n === 1 ? 'partida' : 'partidas'} de ${fmtK(META)})`;
  }

  function renderDestaques(ctx) {
    // cobra da semana
    const s1 = ctx.semana[0];
    $('dqSemana').replaceChildren(
      el('span', { class: 'dq-rot' }, svg(FAM.semana.icone, 16), 'COBRA DA SEMANA'),
      s1 && s1.pontos > 0
        ? el('div', { class: 'dq-corpo' }, avatarDe(s1.nome, ptsPat(s1.chave), 'av-m'),
            el('div', null, btnPerfil(s1, 'dq-nome'), el('div', { class: 'dq-num', text: `+${ptsTxt(s1.pontos)}` }),
              el('div', { class: 'dq-sub', text: `em ${s1.qtd} ${s1.qtd === 1 ? 'partida' : 'partidas'} nesta semana` })))
        : el('div', { class: 'dq-corpo' }, el('div', null, el('div', { class: 'dq-num', text: 'Vaga aberta' }), el('div', { class: 'dq-sub', text: 'Ninguém pontuou nesta semana ainda.' }))),
      el('div', { class: 'dq-pe', text: fechaSemanaTxt() })
    );

    // caça ao recorde
    const r1 = ctx.massa[0], r2 = ctx.massa[1];
    $('dqRecorde').replaceChildren(
      el('span', { class: 'dq-rot' }, svg('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/>', 16), 'CAÇA AO RECORDE'),
      r1
        ? el('div', { class: 'dq-corpo' }, el('div', null, el('div', { class: 'dq-num laranja', text: fmt(r1.melhor.mass) }),
            el('div', { class: 'dq-sub' }, 'recorde de ', btnPerfil(r1, 'link-nome'), ` · ${dataCurta(r1.melhor.created_at)}`)))
        : el('div', { class: 'dq-corpo' }, el('div', { class: 'dq-num', text: '—' })),
      el('div', { class: 'dq-pe' }, r2 ? [`Mais perto: `, btnPerfil(r2, 'link-nome', r2.nome), `, falta ${fmt(r1.melhor.mass - r2.melhor.mass + 1)} de massa`] : 'Quem passar desse número vira o recordista.')
    );

    // disputa pelo topo: só a temporada atual (zera na virada do mês)
    const temp = montarRanking('mes', 'pontos').filter((j) => j.pontos > 0);
    const p1 = temp[0], p2 = temp[1];
    const disputa = $('dqDisputa');
    if (!p1) { disputa.replaceChildren(el('span', { class: 'dq-rot', text: 'DISPUTA PELO TOPO' }), el('div', { class: 'dq-sub', text: 'O primeiro a pontuar assume o trono.' })); return; }
    const tot = Math.max(1, p1.pontos + (p2 ? p2.pontos : 0));
    disputa.replaceChildren(
      el('span', { class: 'dq-rot' }, svg('<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>', 16), 'DISPUTA PELO TOPO'),
      p2
        ? el('div', { class: 'versus' },
            el('div', { class: 'vs-lado' }, btnPerfil(p1, 'dq-nome', p1.nome), el('span', { class: 'vs-pts laranja', text: fmt(p1.pontos) })),
            el('span', { class: 'vs-x', text: '×' }),
            el('div', { class: 'vs-lado dir' }, btnPerfil(p2, 'dq-nome', p2.nome), el('span', { class: 'vs-pts azul', text: fmt(p2.pontos) })))
        : el('div', { class: 'dq-corpo' }, el('div', null, btnPerfil(p1, 'dq-nome'), el('div', { class: 'dq-num laranja', text: ptsTxt(p1.pontos) }))),
      p2 ? el('div', { class: 'vs-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(p1.pontos / tot * 100)}%` })) : null,
      el('div', { class: 'dq-pe', text: p2
        ? (p1.pontos === p2.pontos ? 'Empate em pontos! Quem tem mais 100K+ leva.' : `${p2.nome} precisa de ${ptsTxt(p1.pontos - p2.pontos + 1)} pra virar${partidasPara(p1.pontos - p2.pontos + 1)}`)
        : `${p1.nome} reina sozinho por enquanto.` })
    );
  }

  // ---------- escada de patentes ----------
  function renderPatentes() {
    // quem está em cada degrau nesta temporada (quem desceu na virada já aparece no novo degrau)
    const porNivel = new Map();
    const agora = [...(patentesPorTemporada().get(mesChave(Date.now())) || new Map()).values()]
      .filter((x) => !exMembro(x.chave)).sort((a, b) => b.pts - a.pts);
    for (const x of agora) {
      const j = { chave: x.chave, nome: x.nome, pontos: x.pts };
      if (!porNivel.has(x.fim)) porNivel.set(x.fim, []);
      porNivel.get(x.fim).push(j);
    }
    $('escadaPatentes').replaceChildren(...[...PATENTES].reverse().map((t) => {
      const gente = porNivel.get(t.nivel) || [];
      return el('li', { class: `degrau ${gente.length ? '' : 'vazio-d'} ${t.diamante ? 'degrau-dia' : ''}`, style: `--pc:${t.cor}` },
        t.diamante ? el('span', { class: 'dia-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 9 }, () => el('i'))) : null,
        t.diamante ? diamanteSVG('degrau-gema') : degrauEscudo(t),
        el('div', { class: 'degrau-info' },
          el('span', { class: 'degrau-nome', text: t.nome }),
          el('span', { class: 'degrau-pts', text: t.pontos ? `a partir de ${ptsTxt(t.pontos)}` : 'todo mundo começa aqui' })),
        el('div', { class: 'degrau-gente' },
          gente.length
            ? [...gente.slice(0, 4).map((j) => btnPerfil(j, 'av-btn', avatarDe(j.nome, j.pontos))), gente.length > 4 ? el('span', { class: 'mais', text: `+${gente.length - 4}` }) : null]
            : el('span', { class: 'ninguem', text: 'ninguém ainda' }))
      );
    }));
  }

  function degrauEscudo(t) {
    const s = el('span', { class: 'degrau-ins', 'aria-hidden': 'true' });
    s.innerHTML = escudoSVG(t);
    return s;
  }

  // ---------- campeões das temporadas ----------
  function fechaTemporadaTxt(fim) {
    const h = Math.max(0, Math.round((fim - Date.now()) / 3600000));
    if (h < 24) return h < 1 ? 'fecha em instantes' : `fecha em ${h} h`;
    const d = Math.round(h / 24);
    return `fecha em ${d} ${d === 1 ? 'dia' : 'dias'}`;
  }
  // contagem até a virada da temporada (no ranking e na página de patentes)
  function renderFimTemporada() {
    const agora = Date.now();
    const mes = nomeMes(agora).toUpperCase();
    $('seloPeriodo').textContent = `${nomeTemp(agora).toUpperCase()} · ${mes}`;
    const eu = lerEu();
    const x = eu && !exMembro(eu) ? patTemp(eu) : null;
    const pat = PATENTES[x ? x.fim : 0];
    // cria de novo pra cada caixa (o mesmo nó não pode ficar em dois lugares)
    // "você": patente agora ▸ patente no dia 1 (a queda aparece, sem precisar explicar)
    const minha = () => (eu && elenco.has(eu)
      ? el('span', { class: 'ft-eu', title: pat.nivel ? `No dia 1 você cai pra ${PATENTES[nivelNaVirada(pat.nivel)].nome}` : 'Sua patente nesta temporada' },
          el('span', { class: 'ft-eu-rot', text: 'VOCÊ' }), chipPatente(pat.pontos),
          pat.nivel ? [el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), el('span', { class: 'ft-dia1', text: 'DIA 1' }), chipPatente(PATENTES[nivelNaVirada(pat.nivel)].pontos, 'pat-apagada')] : null)
      : null);
    const montar = () => el('div', { class: 'ft-box' },
      el('div', { class: 'ft-txt' },
        el('span', { class: 'ft-rot' }, el('span', { class: 'ft-vivo', 'aria-hidden': 'true' }), `${nomeTemp(agora).toUpperCase()} · ${mes}`,
          el('button', { type: 'button', class: 'info-btn', 'data-info': 'temporada', 'aria-label': 'Como funciona a temporada', text: 'i' })),
        el('b', { class: 'ft-titulo', text: 'TERMINA EM' }),
        minha()),
      contagem(fimDoMes(agora), ''));
    for (const id of ['fimTemporada', 'fimTemporadaPat']) trocar($(id), montar());
  }

  // ---------- como funciona (regras em abas, no lugar dos textos no meio do site) ----------
  const REGRA_ABAS = ['temporada', 'patentes', 'pontos', 'medalhas', 'chat', 'damas'];
  const REGRAS_EXTRA = {}; // abas montadas fora do app.js (a de damas vem do jogos.js)
  let regraAba = 'temporada';
  // linha de regra: ícone/rótulo curto à esquerda, valor à direita (como tela de regras de jogo)
  const linhaRegra = (rot, ...val) => el('li', { class: 'rg-linha' }, el('span', { class: 'rg-rot', text: rot }), el('span', { class: 'rg-val' }, ...val));
  const tituloRegra = (t) => el('h3', { class: 'rg-h', text: t });
  function abrirRegras(aba = regraAba) {
    regraAba = REGRA_ABAS.includes(aba) ? aba : 'temporada';
    document.querySelectorAll('.aba[data-regra]').forEach((x) => x.setAttribute('aria-selected', String(x.dataset.regra === regraAba)));
    const corpo = ({ temporada: regrasTemporada, patentes: regrasPatentes, pontos: regrasPontos, medalhas: regrasMedalhas, chat: regrasChat }[regraAba] || REGRAS_EXTRA[regraAba] || (() => []))();
    trocar($('regrasCorpo'), corpo);
    const dlg = $('dlgRegras');
    if (!dlg.open) dlg.showModal();
    $('regrasCorpo').scrollTop = 0;
    dlg.focus();
  }
  function regrasTemporada() {
    const agora = Date.now();
    return [
      el('div', { class: 'rg-destaque' },
        el('span', { class: 'rg-num', text: nomeTemp(agora).toUpperCase() }),
        el('span', { class: 'sec', text: `${nomeMes(agora)} · termina dia 1º às 00:00` })),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Duração', '1 mês'),
        linhaRegra('Campeão', 'mais pontos no mês leva a taça'),
        linhaRegra('Coroa', 'o campeão usa a temporada seguinte inteira'),
        linhaRegra('Perde a coroa', 'se não ganhar de novo'),
        linhaRegra('Skins lendárias', 'só quem já foi campeão (pra sempre)'),
        linhaRegra('Papéis de parede raros', 'só quem já foi campeão (pra sempre)'),
        linhaRegra('Pontos do mês', 'zeram no dia 1'),
        linhaRegra('Patente', `cai ${CAI_NA_VIRADA} no dia 1`),
        linhaRegra('Insígnia', 'a patente final fica no perfil'),
        linhaRegra('Ranking geral', 'nunca zera')),
      tituloRegra('NA VIRADA'),
      el('ul', { class: 'rg-virada' }, ...[...PATENTES].reverse().filter((p) => p.nivel).map((p) => {
        const vai = PATENTES[nivelNaVirada(p.nivel)];
        return el('li', null, chipPatente(p.pontos), el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), chipPatente(vai.pontos, 'pat-apagada'),
          el('span', { class: 'rg-mini', text: ptsTxt(vai.pontos) }));
      })),
    ];
  }
  function regrasPatentes() {
    return [
      el('ul', { class: 'rg-escada' }, ...[...PATENTES].reverse().map((p) => el('li', { style: `--pc:${p.cor}` },
        chipPatente(p.pontos),
        el('span', { class: 'rg-mini', text: p.pontos ? ptsTxt(p.pontos) : 'início' })))),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Conta', 'pontos da temporada'),
        linhaRegra('Começo do mês', 'piso da patente que sobrou')),
    ];
  }
  function regrasPontos() {
    const vale = (m) => { const d = detalhePontos(m); return d.bonus ? `${fmt(d.base)} + ${fmt(d.bonus)} = ${ptsTxt(d.total)}` : ptsTxt(d.total); };
    return [
      el('ul', { class: 'rg-lista' },
        linhaRegra('1.000 de massa', ptsTxt(POR_MIL)),
        ...[1, 2, 3].filter((n) => bonusDaMeta(n) > 0).map((n) => linhaRegra(`Passou de ${fmtK(META * n)}`, el('b', { class: 'laranja', text: `+${ptsTxt(bonusDaMeta(n))}` }))),
        BONUS_SOBE ? linhaRegra('Metas seguintes', `+${fmt(BONUS_SOBE)} a mais cada`) : null),
      tituloRegra('EXEMPLOS'),
      el('ul', { class: 'rg-lista' }, ...[50000, META, META * 2, META * 5].filter((m) => m <= MASSA_MAX).map((m) => linhaRegra(`${fmtK(m)}`, vale(m)))),
      tituloRegra('ENTRAR NO RANKING'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Nick', `com a tag [${TAG}]`),
        linhaRegra('Massa', 'vem do servidor, sem print')),
    ];
  }
  function regrasMedalhas() {
    const M = MEDALHAS.filter((m) => !m.unica || Date.now() < fimT1());
    return [
      el('div', { class: 'rg-metais' }, ...ORDEM_METAL.map((x) => el('span', { class: `md-conta pip-${x}` }, el('i', { 'aria-hidden': 'true' }), METAIS[x].nome))),
      el('ul', { class: 'rg-medalhas' }, ...M.map((m) => el('li', null,
        medalhaEl(m, m.metais ? m.metais[0] : 'ouro'),
        el('div', { class: 'rg-md-txt' },
          el('b', { text: m.nome }),
          el('div', { class: 'rg-md-niveis' }, ...m.niveis.map((n, i) => el('span', { class: `rg-md-niv pip-${metalDo(m, i)}` }, el('i', { 'aria-hidden': 'true' }), m.req(n)))))))),
      tituloRegra('RARIDADE'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Até 5% do clã tem', el('span', { class: 'md-rar r-lenda', text: 'LENDÁRIA' })),
        linhaRegra('Até 15%', el('span', { class: 'md-rar r-epica', text: 'ÉPICA' })),
        linhaRegra('Até 35%', el('span', { class: 'md-rar r-rara', text: 'RARA' })),
        linhaRegra('Mais que isso', el('span', { class: 'md-rar r-comum', text: 'COMUM' }))),
      tituloRegra('VITRINE'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Vagas', '3, do lado do nome'),
        linhaRegra('Sem escolher', 'mostra as mais raras')),
    ];
  }
  // sala de troféus: a taça em disputa primeiro, depois as já entregues
  function renderTemporadas(ctx) {
    const temps = ctx.temps;
    $('temporadas').hidden = !temps.length;
    const fechadas = temps.filter((t) => !t.atual).length;
    $('tempQtd').textContent = fechadas ? `${fechadas} ${fechadas === 1 ? 'taça entregue' : 'taças entregues'}` : 'a primeira taça está em disputa';
    $('listaTemporadas').replaceChildren(...temps.map((t) => {
      const c = t.top[0];
      return el('li', { class: `tr-item ${t.atual ? 'tr-disputa' : ''}`, style: `--gema:${gemaDe(t)[1]}` },
        el('button', { type: 'button', class: 'tr-vitrine', onclick: () => abrirTrofeu(chaveTemp(t)), 'aria-label': t.atual ? `Taça de ${nomeMes(t.inicio)}, em disputa` : `Taça de ${nomeMes(t.inicio)}: ${comTag(c.nome)} campeão` },
          trofeuDe(t),
          t.atual ? el('span', { class: 'tr-selo', text: 'EM DISPUTA' }) : null),
        el('div', { class: 'tr-info' },
          el('span', { class: 'tr-num', text: nomeTemp(t.inicio).toUpperCase() }),
          el('div', { class: 'tr-mes' }, el('span', { text: rotTemp(t) }), el('small', { text: t.atual ? fechaTemporadaTxt(t.fim) : 'encerrada' })),
          el('div', { class: 'tr-campeao' },
            el('span', { class: 'tr-rot', text: t.atual ? 'liderando' : 'campeão' }),
            btnPerfil(c, 'link-nome', c.nome),
            el('span', { class: 'tr-pts', text: ptsTxt(c.pontos) })),
          t.top.length > 1 ? el('div', { class: 'tr-vices' }, ...t.top.slice(1, 3).map((j, k) => el('span', { class: `tr-vice v${k + 2}` }, `${k + 2}º `, btnPerfil(j, 'link-nome', j.nome)))) : null)
      );
    }));
  }

  // ---------- cerimônia da taça ----------
  function abrirTrofeu(kt, festa = false) {
    const temps = montarTemporadas();
    const i = temps.findIndex((t) => chaveTemp(t) === kt);
    if (i < 0) return false;
    const t = temps[i];
    const c = t.top[0], vice = t.top[1];
    const [gemaNome, gemaCor] = gemaDe(t);
    const ano = new Date(t.inicio).getFullYear();
    const minha = !t.atual && lerEu() === c.chave;
    const confete = t.atual ? null : el('div', { class: 'cer-confete', 'aria-hidden': 'true' },
      ...Array.from({ length: 70 }, (_, n) => el('i', { style: `--x:${Math.random() * 100}%;--d:${(Math.random() * 2.4).toFixed(2)}s;--t:${(2.6 + Math.random() * 2.2).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${['#FFD84D', '#FFB347', '#FFF3C0', gemaCor, '#FF7A1A'][n % 5]}` })));
    const stat = (rot, v) => el('div', { class: 'cer-stat' }, el('span', { class: 'pstat-rot', text: rot }), el('b', { text: v }));
    trocar($('trofeuCorpo'),
      confete,
      el('div', { class: 'cer-palco', style: `--gema:${gemaCor}` },
        el('div', { class: 'cer-raios', 'aria-hidden': 'true' }),
        trofeuDe(t, `cer-trofeu ${t.atual ? 'tr-fantasma' : ''}`)),
      el('div', { class: 'cer-info' },
        el('span', { class: 'cer-rot', text: festa && !t.atual ? `A ${nomeTemp(t.inicio).toUpperCase()} (${nomeMes(t.inicio).toUpperCase()}) FECHOU!` : `${nomeTemp(t.inicio).toUpperCase()} · ${nomeMes(t.inicio).toUpperCase()} ${ano}` }),
        minha ? el('span', { class: 'cer-eu', text: '👑 ESSA TAÇA É SUA!' }) : null,
        el('span', { class: 'cer-titulo', text: t.atual ? 'LIDERANDO A DISPUTA' : 'CAMPEÃO' }),
        el('h2', { class: 'cer-nome', id: 'cerNome' }, el('span', { class: 'cer-tag', text: `[${TAG}] ` }), c.nome),
        el('p', { class: 'cer-sub', text: t.atual
          ? `A taça de ${nomeMes(t.inicio)} ainda não tem dono. ${fechaTemporadaTxt(t.fim).replace(/^f/, 'F')}.`
          : vice ? `Levou a taça com ${ptsTxt(c.pontos - vice.pontos)} de vantagem sobre ${vice.nome}.` : 'Levou a taça sozinho: ninguém mais pontuou.' }),
        el('div', { class: 'cer-stats' },
          stat('PONTOS', fmt(c.pontos)), stat('PARTIDAS', fmt(c.qtd)), stat('MAIOR MASSA', fmt(c.melhor.mass)), stat(marcoTxt, `${c.cem}×`)),
        el('ol', { class: 'cer-podio' }, ...t.top.slice(0, 5).map((j, k) => el('li', { class: `tt tt${k + 1}` },
          el('span', { class: 'tt-pos', text: `${k + 1}º` }),
          el('span', { class: 'tt-nome' }, btnPerfil(j, 'link-nome', j.nome)),
          el('span', { class: 'tt-pts', text: ptsTxt(j.pontos) })))),
        t.top.length > 5 ? el('p', { class: 'cer-mais', text: `${t.top.length} jogadores pontuaram nessa temporada` }) : null,
        t.atual ? null : patentesDaCerimonia(t),
        el('p', { class: 'cer-gema' }, el('span', { class: 'cer-gema-cor', 'aria-hidden': 'true' }), `Pedra da temporada: ${gemaNome}`),
        el('div', { class: 'linha-btns' },
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharTrofeu(t) }, svg(ICONE_LINK, 18), 'Compartilhar'),
          el('button', { type: 'button', class: 'btn btn-pri', onclick: () => abrirPerfil(c.chave) }, t.atual ? 'Ver o líder' : 'Ver o campeão'))));
    const dlg = $('dlgTrofeu');
    dlg.classList.remove('dlg-dia');
    dlg.style.setProperty('--gema', gemaCor);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    return true;
  }
  // fim de temporada: a sua insígnia (se marcou "sou eu") e a patente final de cada um
  function patentesDaCerimonia(t) {
    const mapa = patentesPorTemporada().get(chaveTemp(t));
    if (!mapa) return null;
    const pos = new Map(t.top.map((j, i) => [j.chave, i + 1]));
    const lista = [...mapa.values()].filter((x) => x.qtd || x.fim).sort((a, b) => b.fim - a.fim || b.pts - a.pts);
    if (!lista.length) return null;
    const ms = t.inicio;
    const eu = mapa.get(lerEu());
    const minha = eu && (eu.qtd || eu.fim) ? (() => {
      const x = { ...eu, ms, atual: false, pat: PATENTES[eu.fim] };
      const prox = PATENTES[nivelNaVirada(eu.fim)];
      return el('div', { class: 'cer-minha', style: `--pc:${x.pat.cor}` },
        insignia(x, 'ins-g'),
        el('div', { class: 'cer-minha-txt' },
          el('span', { class: 'cer-minha-rot', text: 'SUA TEMPORADA' }),
          el('b', { text: `Fechou como ${x.pat.nome}` }),
          el('span', { text: `${pos.get(eu.chave) ? `${pos.get(eu.chave)}º lugar · ` : ''}${ptsTxt(eu.ganho)}` }),
          el('span', { class: 'cer-minha-vai' }, el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), `T${numTemp(fimDoMes(ms))} `, chipPatente(prox.pontos, 'pat-apagada'))));
    })() : null;
    return el('div', { class: 'cer-pats' },
      minha,
      el('span', { class: 'cer-pats-rot', text: 'PATENTES FINAIS' }),
      el('ul', { class: 'cer-pats-lista' }, ...lista.slice(0, 12).map((x) => {
        const p = PATENTES[x.fim];
        return el('li', { style: `--pc:${p.cor}` },
          el('span', { class: 'tt-nome' }, btnPerfil(x, 'link-nome', x.nome)),
          chipPatente(p.pontos),
          el('span', { class: 'cer-pats-vai', title: `começou a ${nomeTemp(fimDoMes(ms))} como ${PATENTES[nivelNaVirada(x.fim)].nome}`, text: `→ ${PATENTES[nivelNaVirada(x.fim)].nome}` }));
      })),
      null);
  }

  // cerimônia de quem virou Diamantes: cacos de diamante explodindo e raios
  function abrirDiamante(k, festa = false) {
    const x = patTemp(k);
    const pat = x && PATENTES[x.fim];
    if (!pat || !pat.diamante) return false;
    // números da temporada (só chega em Diamantes jogando no mês)
    const j = montarRanking('mes', 'pontos', true).find((y) => y.chave === k) || { nome: x.nome, qtd: 0, melhor: { mass: 0 }, cem: 0 };
    const minha = lerEu() === k;
    const cacos = el('div', { class: 'dia-cacos', 'aria-hidden': 'true' },
      ...Array.from({ length: 48 }, (_, n) => el('i', { style: `--a:${Math.round(n * 7.5 + Math.random() * 6)}deg;--l:${Math.round(150 + Math.random() * 260)}px;--d:${(Math.random() * .5).toFixed(2)}s;--s:${(0.5 + Math.random()).toFixed(2)};--c:${['#7DF9FF', '#FFFFFF', '#C6A8FF', '#FF9FE0', '#5BC8FF'][n % 5]}` })));
    const stat = (rot, v) => el('div', { class: 'cer-stat' }, el('span', { class: 'pstat-rot', text: rot }), el('b', { text: v }));
    trocar($('trofeuCorpo'),
      cacos,
      el('div', { class: 'cer-palco dia-palco' },
        el('div', { class: 'dia-raios', 'aria-hidden': 'true' }),
        el('div', { class: 'dia-anel', 'aria-hidden': 'true' }),
        el('span', { class: 'dia-faiscas', 'aria-hidden': 'true' }, ...Array.from({ length: 16 }, () => el('i'))),
        diamanteSVG('dia-gema-cer')),
      el('div', { class: 'cer-info' },
        el('span', { class: 'cer-rot', text: festa ? 'NOVA PATENTE DESBLOQUEADA' : `PATENTE MÁXIMA · ${ptsTxt(pat.pontos).toUpperCase()}+` }),
        minha ? el('span', { class: 'cer-eu dia-eu', text: '💎 VOCÊ É DIAMANTE!' }) : null,
        el('span', { class: 'cer-titulo dia-virou', text: 'VIROU' }),
        el('span', { class: 'dia-titulo', text: pat.nome.toUpperCase() }),
        el('h2', { class: 'cer-nome dia-nome', id: 'cerNome' }, el('span', { class: 'cer-tag', text: `[${TAG}] ` }), j.nome),
        el('p', { class: 'cer-sub', text: `${nomeTemp(Date.now())} · pouca gente chega aqui.` }),
        el('div', { class: 'cer-stats' },
          stat('PONTOS', fmt(x.pts)), stat('PARTIDAS', fmt(j.qtd)), stat('MAIOR MASSA', fmt(j.melhor.mass)), stat(marcoTxt, `${j.cem}×`)),
        el('div', { class: 'linha-btns' },
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => $('dlgTrofeu').close() }, 'Fechar'),
          el('button', { type: 'button', class: 'btn btn-dia', onclick: () => { $('dlgTrofeu').close(); abrirPerfil(k); } }, 'Ver o perfil'))));
    const dlg = $('dlgTrofeu');
    dlg.classList.add('dlg-dia');
    dlg.style.setProperty('--gema', COR_DIAMANTE);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
    return true;
  }
  // quem marcou "sou eu" e virou Diamantes ganha a cerimônia uma vez no aparelho, em cada temporada
  function diamanteAutomatico() {
    const eu = lerEu();
    if (!eu) return false;
    const x = patTemp(eu);
    if (!x || !PATENTES[x.fim].diamante) return false;
    const marca = `${eu}|${mesChave(Date.now())}`;
    try {
      if (localStorage.getItem('ranking_dia_visto') === marca) return false;
      localStorage.setItem('ranking_dia_visto', marca);
    } catch (e) { return false; }
    setTimeout(() => { if (!document.querySelector('dialog[open]') && !perfilAtual && !torneioAtual) abrirDiamante(eu, true); }, 900);
    return true;
  }
  async function compartilharTrofeu(t) {
    const url = `${location.origin}${location.pathname}?trofeu=${chaveTemp(t)}`;
    const txt = t.atual
      ? `A taça de ${nomeMes(t.inicio)} do clã ${TAG} tá em disputa. Quem leva?`
      : `${comTag(t.top[0].nome)} é o campeão de ${nomeMes(t.inicio)} do clã ${TAG}!`;
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share({ title: `Taça de ${nomeMes(t.inicio)} · Clã ${TAG}`, text: txt, url }); return; }
      await navigator.clipboard.writeText(url);
      toast('Link da taça copiado.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie o link da taça:', url);
    }
  }
  // link ?trofeu=2026-09 abre a cerimônia; e a temporada que acabou de fechar
  // é entregue sozinha uma vez em cada aparelho (até 10 dias depois)
  function cerimoniaAutomatica() {
    const q = new URLSearchParams(location.search).get('trofeu');
    if (q) { abrirTrofeu(q, true); return; }
    if (perfilAtual || torneioAtual) return;
    if (diamanteAutomatico()) return;
    const ultima = montarTemporadas().find((t) => !t.atual);
    if (!ultima || Date.now() - ultima.fim > 10 * 86400000) return;
    const kt = chaveTemp(ultima);
    try {
      if (localStorage.getItem('ranking_taca_vista') === kt) return;
      localStorage.setItem('ranking_taca_vista', kt);
    } catch (e) { return; }
    setTimeout(() => { if (!document.querySelector('dialog[open]') && !perfilAtual && !torneioAtual) abrirTrofeu(kt, true); }, 900);
  }

  // troféus que o jogador ganhou, pro perfil
  function secaoTrofeusPerfil(k, ctx) {
    const ganhas = ctx.temps.filter((t) => !t.atual && t.top[0].chave === k);
    if (!ganhas.length) return null;
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppTrof' },
      el('h2', { class: 'perfil-h3', id: 'ppTrof' }, 'TROFÉUS ', el('span', { class: 'sec', text: `${ganhas.length} ${ganhas.length === 1 ? 'taça' : 'taças'}` })),
      el('ul', { class: 'pp-trofeus' }, ...ganhas.map((t) => el('li', null,
        el('button', { type: 'button', class: 'pp-trofeu', style: `--gema:${gemaDe(t)[1]}`, onclick: () => abrirTrofeu(chaveTemp(t)), 'aria-label': `Taça de ${nomeMes(t.inicio)}` },
          trofeuDe(t),
          el('span', { text: rotTemp(t) }))))));
  }

  // insígnias: a patente com que o jogador fechou cada temporada (ficam pra sempre)
  function insigniasDe(k) {
    const lista = [];
    for (const [mc, mapa] of patentesPorTemporada()) {
      const x = mapa.get(k);
      if (!x || (!x.qtd && !x.fim)) continue;
      const [a, m] = mc.split('-').map(Number);
      const ms = new Date(a, m - 1, 1).getTime();
      lista.push({ ...x, ms, atual: fimDoMes(ms) > Date.now(), pat: PATENTES[x.fim] });
    }
    return lista.reverse(); // mais nova primeiro
  }
  function insignia(x, cls = '') {
    const n = numTemp(x.ms);
    const ano = new Date(x.ms).getFullYear();
    const escudo = el('span', { class: 'ins-escudo', 'aria-hidden': 'true' });
    escudo.innerHTML = escudoSVG(x.pat, n >= 1 ? `T${n}` : nomeMes(x.ms).slice(0, 3).toUpperCase());
    return el('div', { class: `insignia ${x.pat.diamante ? 'ins-dia' : ''} ${x.atual ? 'ins-atual' : ''} ${cls}`, style: `--pc:${x.pat.cor}`, title: `${nomeTemp(x.ms)} (${nomeMes(x.ms)} ${ano}): ${x.atual ? 'está' : 'fechou'} como ${x.pat.nome}` },
      escudo,
      el('span', { class: 'ins-nome', text: x.pat.nome }),
      el('span', { class: 'ins-mes', text: `${nomeMes(x.ms).slice(0, 3)} ${String(ano).slice(2)}${x.atual ? ' · agora' : ''}` }));
  }
  function secaoInsigniasPerfil(k) {
    const lista = insigniasDe(k);
    if (!lista.length) return null;
    const fechadas = lista.filter((x) => !x.atual);
    const melhor = fechadas.reduce((m, x) => (!m || x.fim > m.fim ? x : m), null);
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppIns' },
      el('h2', { class: 'perfil-h3', id: 'ppIns' }, 'INSÍGNIAS DE TEMPORADA ', melhor ? el('span', { class: 'sec', text: `melhor: ${melhor.pat.nome}` }) : null),
      el('div', { class: 'insignias' }, ...lista.map((x) => insignia(x))));
  }

  // ---------- hall da fama ----------
  let hallQtd = 6;
  function renderHall() {
    const lista = partidas.filter((p) => p.mass >= MARCO).sort((a, b) => b.mass - a.mass);
    $('hall').hidden = !lista.length;
    $('hallMarco').textContent = marcoTxt;
    $('hallQtd').textContent = `${lista.length} ${lista.length === 1 ? 'partida' : 'partidas'} no clã`;
    const resto = lista.length - hallQtd;
    $('hallMaisBox').hidden = resto <= 0;
    $('btnHallMais').textContent = `Ver mais ${Math.min(resto, 12)}`;
    const pts = new Map(montarRanking('geral', 'pontos').map((j) => [j.chave, j]));
    $('listaHall').replaceChildren(...lista.slice(0, hallQtd).map((p, i) => {
      const j = pts.get(chave(p.player));
      const url = urlPrint(p);
      return el('li', { class: `fama ${i === 0 ? 'fama-1' : ''}` },
        el('span', { class: 'fama-pos', text: `#${i + 1}` }),
        el('div', { class: 'fama-info' },
          el('span', { class: 'fama-massa', text: fmt(p.mass) }),
          j ? btnPerfil(j, 'link-nome fama-nome') : el('span', { class: 'fama-nome', text: comTag(limparNick(p.player)) }),
          el('span', { class: 'fama-data', text: new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '') })),
        url ? el('button', { type: 'button', class: 'fama-print', onclick: () => abrirPrint(p), 'aria-label': 'Ver print' }, el('img', { src: url, alt: '', loading: 'lazy' })) : null
      );
    }));
  }

  // ---------- medalhas no perfil: vitrine, sala de medalhas, detalhe e cerimônia ----------
  const podeMudarVitrine = (k) => vitrineOk && podeMudarAvatar(k);
  // as 3 da vitrine: as escolhidas ou, se não escolheu, as mais valiosas (metal e raridade)
  function vitrineDe(k, meds, rar) {
    const r = elenco.get(k);
    const ganhas = meds.filter((m) => m.nivel);
    const escolhidas = r && Array.isArray(r.vitrine) ? r.vitrine.map((id) => ganhas.find((m) => m.id === id)).filter(Boolean) : [];
    if (escolhidas.length) return escolhidas;
    const valor = (m) => METAIS[m.metal].ordem * 1000 - qtdCom(rar, m.id, m.nivel);
    return ganhas.slice().sort((a, b) => valor(b) - valor(a)).slice(0, 3);
  }
  function vitrinePerfil(k, meds, rar) {
    const lista = vitrineDe(k, meds, rar);
    const pode = podeMudarVitrine(k);
    if (!lista.length && !pode) return null;
    return el('div', { class: 'pp-vitrine' },
      ...lista.map((m) => el('button', { type: 'button', class: `pp-vit md-t-${m.metal}`, title: `${tituloMed(m)} · ${METAIS[m.metal].nome}`, 'aria-label': `Medalha ${tituloMed(m)}, ${METAIS[m.metal].nome}`, onclick: () => abrirMedalha(k, m.id) },
        medalhaEl(m))),
      pode ? el('button', { type: 'button', class: 'pp-vit-editar', onclick: () => abrirVitrine(k), title: 'Escolher as medalhas da vitrine', 'aria-label': 'Escolher as medalhas da vitrine' },
        svg(lista.length ? ICONE_LAPIS : '<path d="M12 5v14M5 12h14"/>', 16), lista.length ? null : el('span', { text: 'Vitrine' })) : null);
  }
  const contaMetais = (meds) => {
    const c = {};
    for (const m of meds) if (m.nivel) c[m.metal] = (c[m.metal] || 0) + 1;
    return ['lenda', 'diamante', 'ouro', 'prata', 'bronze'].filter((x) => c[x]).map((x) => [x, c[x]]);
  };
  function tileMedalha(k, m, rar) {
    const qtd = m.nivel ? qtdCom(rar, m.id, m.nivel) : 0;
    const rr = raridade(qtd, rar.total, m);
    return el('li', null, el('button', { type: 'button', class: `md-tile ${m.nivel ? 'ok md-t-' + m.metal : 'trancada'}`, onclick: () => abrirMedalha(k, m.id),
      'aria-label': `${tituloMed(m)}: ${m.nivel ? METAIS[m.metal].nome : 'trancada'}` },
      medalhaEl(m),
      el('b', { class: 'md-nome', text: m.nivel ? tituloMed(m) : m.nome }),
      m.niveis.length > 1 ? el('span', { class: 'md-pips', 'aria-hidden': 'true' }, ...m.niveis.map((_, i) => el('i', { class: i < m.nivel ? `on pip-${metalDo(m, i)}` : '' }))) : null,
      m.nivel
        ? el('span', { class: `md-rar ${rr.cls}`, title: `${qtd} de ${rar.total} do clã têm` }, rr.txt)
        : el('span', { class: 'md-falta', text: m.valor ? progTxt(m) : m.req(m.niveis[0]) })));
  }
  function secaoMedalhas(k, ctx, meds) {
    const rar = raridades(ctx);
    const eu = lerEu() === k;
    const ganhas = meds.filter((m) => m.nivel);
    const niveis = meds.reduce((s, m) => s + m.nivel, 0), total = meds.reduce((s, m) => s + m.niveis.length, 0);
    // quase lá: as mais perto do próximo nível (tempo de clã não conta, vem sozinho)
    const quase = meds.filter((m) => m.prox != null && m.valor > 0 && m.id !== 'veterano').sort((a, b) => progMed(b) - progMed(a)).slice(0, 3);
    const semAvatar = eu && !meds.find((m) => m.id === 'estilo').nivel;
    const fundador = meds.find((m) => m.id === 'fundador');
    const corre = eu && fundador && !fundador.nivel && Date.now() < fimT1(); // ainda dá pra ganhar a do Fundador
    const ordem = [...ganhas.sort((a, b) => METAIS[b.metal].ordem - METAIS[a.metal].ordem || b.nivel - a.nivel), ...meds.filter((m) => !m.nivel).sort((a, b) => progMed(b) - progMed(a))];
    return el('section', { class: 'pp-sec md-sala', 'aria-labelledby': 'ppMed' },
      el('div', { class: 'md-cab' },
        el('div', { class: 'md-titulo' },
          el('h2', { class: 'perfil-h3', id: 'ppMed' }, 'MEDALHAS',
            el('button', { type: 'button', class: 'info-btn', 'data-info': 'medalhas', 'aria-label': 'Como funcionam as medalhas', text: 'i' })),
          el('div', { class: 'md-placar' },
            el('span', { class: 'md-placar-num' }, el('b', { text: String(ganhas.length) }), `/${meds.length}`),
            el('div', { class: 'md-placar-info' },
              el('div', { class: 'md-metais' }, ...contaMetais(meds).map(([x, n]) => el('span', { class: `md-conta pip-${x}`, title: `${n} de ${METAIS[x].nome}` }, el('i', { 'aria-hidden': 'true' }), String(n)))),
              el('div', { class: 'md-niveis-barra', role: 'progressbar', 'aria-label': 'Níveis de medalha', 'aria-valuemin': '0', 'aria-valuemax': String(total), 'aria-valuenow': String(niveis) },
                el('span', { style: `width:${Math.round(niveis / Math.max(1, total) * 100)}%` })),
              el('span', { class: 'md-niveis-txt', text: `${niveis} de ${total} níveis` })))),
        podeMudarVitrine(k) ? el('button', { type: 'button', class: 'btn btn-sec md-btn-vit', onclick: () => abrirVitrine(k) }, svg(ICONE_ESTRELA, 18), el('span', { text: 'Vitrine' })) : null),
      quase.length || semAvatar || corre ? el('div', { class: 'md-quase' },
        el('span', { class: 'md-quase-rot', text: eu ? 'VOCÊ ESTÁ QUASE LÁ' : 'QUASE LÁ' }),
        el('ul', null,
          corre ? el('li', null, el('button', { type: 'button', class: 'md-q md-q-corre', onclick: () => abrirMedalha(k, 'fundador') },
            medalhaEl(fundador, 'lenda', 'md-q-fantasma'),
            el('span', { class: 'md-q-txt' }, el('b', null, 'Fundador', el('span', { class: 'md-q-metal pip-lenda', text: 'EDIÇÃO ÚNICA' })),
              el('span', { text: `Registra 1 partida até ${new Date(fimT1() - 1).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')}. Depois, nunca mais.` })),
            el('span', { class: 'md-q-acao', text: 'Corre' }))) : null,
          semAvatar ? el('li', null, el('button', { type: 'button', class: 'md-q', onclick: () => abrirAvatar(k) },
            medalhaEl(meds.find((m) => m.id === 'estilo'), 'bronze', 'md-q-fantasma'),
            el('span', { class: 'md-q-txt' }, el('b', { text: 'Estilo próprio' }), el('span', { text: 'Monte o seu avatar e ganhe na hora' })),
            el('span', { class: 'md-q-acao', text: 'Montar' }))) : null,
          ...quase.slice(0, 3 - (semAvatar ? 1 : 0) - (corre ? 1 : 0)).map((m) => {
            const prox = metalDo(m, m.nivel);
            return el('li', null, el('button', { type: 'button', class: `md-q q-${prox}`, onclick: () => abrirMedalha(k, m.id) },
              medalhaEl(m, prox, 'md-q-fantasma'),
              el('span', { class: 'md-q-txt' },
                el('b', null, m.titulo ? tituloMed(m, m.nivel) : m.nome, el('span', { class: `md-q-metal pip-${prox}`, text: METAIS[prox].nome })),
                el('span', { text: m.req(m.prox) }),
                el('span', { class: 'md-q-barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.round(progMed(m) * 100)}%` }))),
              el('span', { class: 'md-q-num', text: progTxt(m) })));
          }))) : null,
      el('ul', { class: 'md-grade' }, ...ordem.map((m) => tileMedalha(k, m, rar))));
  }

  // janela da medalha: grande, girando, com os níveis, a raridade e quem mais tem.
  // novas = cerimônia (medalha que o jogador acabou de ganhar; primeira = as que já tinha)
  function abrirMedalha(k, id, novas = null) {
    const ctx = contexto();
    const meds = medalhasDe(k, ctx);
    const m = meds.find((x) => x.id === id);
    if (!m) return;
    const rar = raridades(ctx);
    const r = elenco.get(k);
    const nome = nomeRar(rar, k);
    const eu = lerEu() === k;
    const festa = !!novas;
    const naVitrine = !!(r && Array.isArray(r.vitrine) && r.vitrine.includes(id));
    const qtd = qtdCom(rar, id, Math.max(1, m.nivel));
    const rr = raridade(qtd, rar.total, m);
    const cor = METAIS[m.metal || 'bronze'].luz;
    const donos = (rar.donos.get(id) || []);
    const confete = festa ? el('div', { class: 'cer-confete', 'aria-hidden': 'true' },
      ...Array.from({ length: 60 }, (_, n) => el('i', { style: `--x:${Math.random() * 100}%;--d:${(Math.random() * 2).toFixed(2)}s;--t:${(2.4 + Math.random() * 2).toFixed(2)}s;--r:${Math.round(Math.random() * 720 - 360)}deg;--c:${[cor, '#FFD84D', '#FFFFFF', '#FF7A1A'][n % 4]}` }))) : null;
    trocar($('medalhaCorpo'),
      confete,
      el('div', { class: `mdd-palco ${m.metal ? '' : 'mdd-trancada'}` },
        el('div', { class: 'mdd-raios', 'aria-hidden': 'true' }),
        medalhaEl(m, m.metal, `mdd-medalha ${festa ? 'mdd-entra' : ''}`)),
      el('div', { class: 'mdd-info' },
        festa ? el('span', { class: 'mdd-festa', text: novas.primeira ? 'SUAS MEDALHAS CHEGARAM!' : 'MEDALHA NOVA!' }) : null,
        el('span', { class: 'mdd-rot', text: m.nivel ? `${METAIS[m.metal].nome.toUpperCase()}${m.niveis.length > 1 ? ` · NÍVEL ${m.nivel} DE ${m.niveis.length}` : ''}` : 'TRANCADA' }),
        el('h2', { class: 'mdd-nome', id: 'mddNome', text: m.nivel ? tituloMed(m) : m.nome }),
        el('p', { class: 'mdd-desc', text: m.desc }),
        el('div', { class: 'mdd-dono' }, avatarDe(nome, ptsPat(k), 'av-p'), m.nivel
          ? el('span', null, eu ? 'Sua' : 'De ', eu ? null : el('b', { text: nome }), m.datas[m.nivel - 1] ? ` · conquistada ${quandoTxt(m.datas[m.nivel - 1])}` : '')
          : el('span', null, eu ? 'Você' : el('b', { text: nome }), ' ainda não tem')),
        m.prox != null && m.niveis.length === 1 ? el('div', { class: 'mdd-prog' },
          el('div', { class: 'mdd-prog-linha' }, el('span', { text: 'Como ganhar' })),
          el('b', { class: 'mdd-como', text: m.unica ? `${m.req(m.prox)} (até ${new Date(fimT1() - 1).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '')})` : m.req(m.prox) })) : null,
        m.prox != null && m.niveis.length > 1 ? el('div', { class: 'mdd-prog' },
          el('div', { class: 'mdd-prog-linha' }, el('span', { text: `Próximo: ${METAIS[metalDo(m, m.nivel)].nome}` }), el('b', { text: progTxt(m) })),
          el('div', { class: 'md-q-barra', role: 'progressbar', 'aria-label': 'Progresso até o próximo nível', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(progMed(m) * 100)) },
            el('span', { style: `width:${Math.round(progMed(m) * 100)}%` })),
          el('span', { class: 'mdd-prog-req', text: m.req(m.prox) })) : null,
        el('div', { class: 'mdd-rar' },
          el('span', { class: `md-rar ${rr.cls}`, text: rr.txt }),
          el('span', { text: qtd ? `${qtd} de ${rar.total} do clã ${qtd === 1 ? 'tem' : 'têm'}${m.niveis.length > 1 && m.nivel ? ' esse nível' : ''}` : 'Ninguém do clã tem ainda' })),
        m.niveis.length > 1 ? el('ol', { class: 'mdd-niveis' }, ...m.niveis.map((n, i) => {
          const ok = i < m.nivel, mt = metalDo(m, i);
          return el('li', { class: ok ? 'ok' : '' },
            medalhaEl(m, mt, ok ? '' : 'md-apagada'),
            el('span', { class: 'mdd-niv-txt' }, el('b', { class: `pip-${mt}`, text: METAIS[mt].nome }), el('span', { text: m.req(n) })),
            el('span', { class: 'mdd-niv-q', text: ok ? (quandoTxt(m.datas[i]).replace(/^(em|na) /, '') || '✓') : `${qtdCom(rar, id, i + 1)} ${qtdCom(rar, id, i + 1) === 1 ? 'tem' : 'têm'}` }));
        })) : null,
        donos.length ? el('div', { class: 'mdd-donos' },
          el('span', { class: 'md-quase-rot', text: 'QUEM TEM NO CLÃ' }),
          el('ul', null, ...donos.slice(0, 14).map((d) => {
            const nm = nomeRar(rar, d.chave);
            return el('li', null, el('button', { type: 'button', class: `mdd-donob ${d.chave === k ? 'eu' : ''}`, onclick: () => { $('dlgMedalha').close(); abrirPerfil(d.chave); }, title: `${nm} · ${METAIS[d.metal].nome}` },
              avatarDe(nm, ptsPat(d.chave), 'av-p'), el('span', { text: nm }), el('i', { class: `pip-${d.metal}`, 'aria-hidden': 'true' })));
          }), donos.length > 14 ? el('li', { class: 'mdd-mais', text: `+${donos.length - 14}` }) : null)) : null,
        festa && novas.length ? el('div', { class: 'mdd-outras' },
          el('span', { class: 'md-quase-rot', text: novas.primeira ? 'E MAIS ESTAS' : 'TAMBÉM GANHOU' }),
          el('div', null, ...novas.slice(0, 8).map((x) => el('button', { type: 'button', class: `mdd-outra md-t-${x.metal}`, title: tituloMed(x), onclick: () => abrirMedalha(k, x.id) }, medalhaEl(x))))) : null,
        el('div', { class: 'linha-btns mdd-btns' },
          eu && m.nivel && podeMudarVitrine(k)
            ? el('button', { type: 'button', class: 'btn btn-sec', onclick: () => alternarVitrine(k, id) }, svg(ICONE_ESTRELA, 18), naVitrine ? 'Tirar da vitrine' : 'Pôr na vitrine')
            : null,
          el('button', { type: 'button', class: 'btn btn-pri', onclick: () => $('dlgMedalha').close() }, festa ? 'Boa!' : 'Fechar'))));
    const dlg = $('dlgMedalha');
    dlg.style.setProperty('--md-cor', cor);
    dlg.classList.toggle('mdd-modo-festa', festa);
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }

  // escolher a vitrine: 3 vagas em cima, as medalhas ganhas embaixo
  let vitEd = null; // { k, lista }
  function abrirVitrine(k) {
    if (!podeMudarVitrine(k)) return;
    const ctx = contexto();
    const meds = medalhasDe(k, ctx);
    vitEd = { k, lista: vitrineDe(k, meds, raridades(ctx)).map((m) => m.id) };
    desenharVitrine();
    const dlg = $('dlgMedalha');
    dlg.style.setProperty('--md-cor', METAIS.ouro.luz);
    dlg.classList.remove('mdd-modo-festa');
    if (!dlg.open) dlg.showModal();
    dlg.scrollTop = 0;
  }
  function desenharVitrine() {
    const { k, lista } = vitEd;
    const meds = medalhasDe(k, contexto());
    const ganhas = meds.filter((m) => m.nivel).sort((a, b) => METAIS[b.metal].ordem - METAIS[a.metal].ordem);
    const de = (id) => ganhas.find((m) => m.id === id);
    const tocar = (id) => {
      const i = vitEd.lista.indexOf(id);
      if (i >= 0) vitEd.lista.splice(i, 1);
      else if (vitEd.lista.length < 3) vitEd.lista.push(id);
      else { toast('A vitrine tem 3 vagas. Toque numa de cima pra tirar.'); return; }
      desenharVitrine();
    };
    trocar($('medalhaCorpo'),
      el('h2', { class: 'vit-titulo', id: 'mddNome' }, lerEu() === k ? 'SUA ' : `${elenco.get(k).nick.toUpperCase()} · `, el('span', { class: 'laranja', text: 'VITRINE' })),
      el('div', { class: 'vit-vagas' }, ...[0, 1, 2].map((i) => {
        const m = de(lista[i]);
        return m
          ? el('button', { type: 'button', class: `vit-vaga cheia md-t-${m.metal}`, onclick: () => tocar(m.id), 'aria-label': `Tirar ${tituloMed(m)} da vitrine` }, medalhaEl(m), el('span', { text: tituloMed(m) }))
          : el('span', { class: 'vit-vaga', text: `${i + 1}` });
      })),
      el('p', { class: 'vit-dica', text: ganhas.length ? 'Toque pra escolher. Elas aparecem do lado do seu nome.' : 'Você ainda não tem medalha. Joga uma partida e volta aqui!' }),
      el('ul', { class: 'md-grade vit-grade' }, ...ganhas.map((m) => el('li', null,
        el('button', { type: 'button', class: `md-tile ok md-t-${m.metal}`, 'aria-pressed': String(lista.includes(m.id)), onclick: () => tocar(m.id) },
          medalhaEl(m), el('b', { class: 'md-nome', text: tituloMed(m) }), el('span', { class: 'md-rar', text: METAIS[m.metal].nome }),
          lista.includes(m.id) ? el('span', { class: 'vit-num', text: String(lista.indexOf(m.id) + 1) }) : null)))),
      el('div', { class: 'linha-btns vit-pe' },
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => $('dlgMedalha').close() }, 'Cancelar'),
        el('button', { type: 'button', class: 'btn btn-pri', id: 'btnVitSalvar', onclick: () => salvarVitrine(k, lista.slice()) }, 'Salvar')));
  }
  function alternarVitrine(k, id) {
    const r = elenco.get(k);
    const atual = r && Array.isArray(r.vitrine) && r.vitrine.length ? r.vitrine.slice() : vitrineDe(k, medalhasDe(k, contexto()), raridades(contexto())).map((m) => m.id);
    const i = atual.indexOf(id);
    if (i >= 0) atual.splice(i, 1);
    else if (atual.length >= 3) { abrirVitrine(k); toast('A vitrine tem 3 vagas. Tira uma pra pôr essa.'); return; }
    else atual.push(id);
    salvarVitrine(k, atual);
  }
  async function salvarVitrine(k, lista) {
    const r = elenco.get(k);
    if (!r) return;
    const bt = $('btnVitSalvar');
    if (bt) bt.disabled = true;
    try {
      if (!DEMO) {
        const res = await sb.rpc('jogador_vitrine', { p_vitrine: lista, p_player: r.id });
        if (res.error) throw new Error(res.error.message);
        if (res.data !== 'ok') throw new Error(res.data);
      }
      r.vitrine = lista;
      $('dlgMedalha').close();
      render();
      toast(lista.length ? 'Vitrine salva! Já aparece no seu perfil.' : 'Vitrine vazia: mostra as suas melhores sozinha.');
    } catch (e) {
      console.error(e);
      toast('Não deu pra salvar a vitrine agora. Tenta de novo.', true);
    } finally {
      if (bt) bt.disabled = false;
    }
  }

  // cerimônia: quem abre o próprio perfil vê as medalhas (ou níveis) que ganhou desde a última vez.
  // Só marca como vista depois que a janela aparece.
  let festaMarcada = false;
  function festejarMedalhas(k, meds) {
    if (festaMarcada || lerEu() !== k) return;
    const chaveLS = 'ranking_medalhas_' + k;
    const agora = meds.filter((m) => m.nivel).map((m) => `${m.id}:${m.nivel}`);
    let antes;
    try { antes = JSON.parse(localStorage.getItem(chaveLS) || 'null'); } catch (e) { return; }
    const novas = meds.filter((m) => m.nivel && !(Array.isArray(antes) && antes.includes(`${m.id}:${m.nivel}`)))
      .sort((a, b) => METAIS[b.metal].ordem - METAIS[a.metal].ordem);
    const guardar = () => { try { localStorage.setItem(chaveLS, JSON.stringify(agora)); } catch (e) {} };
    if (!novas.length) { guardar(); return; }
    festaMarcada = true;
    setTimeout(() => {
      festaMarcada = false;
      if (document.querySelector('dialog[open]') || perfilAtual !== k) return;
      const resto = novas.slice(1);
      resto.primeira = !Array.isArray(antes);
      guardar();
      abrirMedalha(k, novas[0].id, resto);
    }, 900);
  }

  // ---------- perfil do jogador ----------
  function grafico(lista) {
    const W = 560, H = 180, pl = 4, pr = 46, pt = 12, pb = 24;
    const maxV = Math.max(MARCO * 1.12, ...lista.map((p) => p.mass)) * 1.04;
    const y = (v) => pt + (H - pt - pb) * (1 - v / maxV);
    const bw = (W - pl - pr) / Math.max(lista.length, 8);
    const barras = lista.map((p, i) => {
      const x = pl + i * bw + bw * 0.16, w = bw * 0.68, top = y(p.mass);
      const cem = p.mass >= MARCO;
      return `<rect x="${x.toFixed(1)}" y="${top.toFixed(1)}" width="${w.toFixed(1)}" height="${(y(0) - top).toFixed(1)}" rx="3" class="${cem ? 'b-cem' : 'b'}"><title>${fmt(p.mass)} · ${dataCurta(p.created_at)}</title></rect>`;
    }).join('');
    const ym = y(MARCO).toFixed(1);
    const d0 = lista[0] ? dataCurta(lista[0].created_at) : '';
    const d1 = lista.length > 1 ? dataCurta(lista[lista.length - 1].created_at) : '';
    const xUlt = pl + (lista.length - 1) * bw + bw / 2;
    return `<svg viewBox="0 0 ${W} ${H}" class="grafico" role="img" aria-label="Massa das últimas ${lista.length} partidas">
      <line x1="${pl}" x2="${W - pr}" y1="${y(0)}" y2="${y(0)}" class="g-base"/>
      ${barras}
      <line x1="${pl}" x2="${W - pr + 4}" y1="${ym}" y2="${ym}" class="g-marco"/>
      <text x="${W - pr + 8}" y="${(+ym + 4).toFixed(1)}" class="g-marco-txt">${fmtK(MARCO)}</text>
      <text x="${pl}" y="${H - 6}" class="g-txt">${d0}</text>
      ${d1 ? `<text x="${Math.min(xUlt, W - pr).toFixed(1)}" y="${H - 6}" text-anchor="middle" class="g-txt">${d1}</text>` : ''}
    </svg>`;
  }

  function chipsCadastro(r) {
    if (!r) return [];
    const desde = r.created_at ? new Date(r.created_at).toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' }).replace('.', '') : '';
    return [chipCargo(r), !r.ativo ? el('span', { class: 'ex-chip', text: 'EX-MEMBRO' }) : null, desde ? el('span', { class: 'sec', text: `no clã desde ${desde}` }) : null];
  }


  const SEMANA_MS = 7 * 86400000;
  let perfilAtual = null;     // chave do jogador aberto
  let rolagemAntes = 0;       // onde a pessoa estava no ranking antes de abrir
  let perfilMais = false;     // histórico completo aberto
  const ICONE_VOLTAR = '<path d="M15 5l-7 7 7 7"/>';
  const ICONE_LINK = '<path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1"/><path d="M14 10a4 4 0 0 0-5.7 0l-3 3a4 4 0 0 0 5.7 5.7l1-1"/>';
  const ICONE_EU = '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>';
  const ICONE_SAIR = '<path d="M14 4h4a2 2 0 0 1 2 2v12a2 2 0 0 1-2 2h-4"/><path d="M10 16l-4-4 4-4M6 12h10"/>';

  // "eu": quem entrou com o login de jogador (vale em qualquer aparelho); pelo id, então trocar o nick não perde
  function lerEu() { const r = !souAmigo && euId && jogPorId.get(euId); return r ? chave(r.nick) : null; }
  function renderEu() {
    const k = lerEu();
    const btn = $('btnEu');
    // admin sem jogador ligado não precisa do botão (liga em "Editar jogador" > Sou eu)
    btn.hidden = !elencoOk || (!k && !!admin);
    const amigo = souAmigo && jogPorId.get(euId);
    if (amigo) {
      // amigo não tem perfil no clã: o botão é só pra sair da conta
      btn.replaceChildren(avatarDe(amigo.nick, 0, 'av-p'), el('span', { class: 'btn-txt', text: 'Sair' }));
      btn.setAttribute('aria-label', `Sair da conta (${amigo.nick})`);
      return;
    }
    if (!k) {
      const txt = contaSemJogador ? 'Escolher nick' : 'Entrar';
      btn.replaceChildren(svg(ICONE_EU, 20), el('span', { class: 'btn-txt', text: txt }));
      btn.setAttribute('aria-label', contaSemJogador ? 'Escolher o seu nick' : 'Entrar ou criar conta');
      return;
    }
    const r = elenco.get(k);
    btn.replaceChildren(avatarDe(r.nick, ptsPat(k), 'av-p'), el('span', { class: 'btn-txt', text: 'Meu perfil' }));
    btn.setAttribute('aria-label', `Meu perfil: ${comTag(r.nick)}`);
  }

  function chaveDaUrl() {
    const q = new URLSearchParams(location.search).get('jogador');
    return q ? chave(q) : null;
  }
  function linkPerfil(nome) { return `${location.origin}${location.pathname}?jogador=${encodeURIComponent(nome)}`; }

  function abrirPerfil(k) {
    if (souAmigo) return; // amigo não vê os perfis do clã
    if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (!perfilAtual && !torneioAtual) rolagemAntes = scrollY;
    const r = elenco.get(k);
    const nome = r ? r.nick : (montarRanking('geral', 'pontos', true).find((x) => x.chave === k) || {}).nome;
    if (!nome) return;
    history.pushState({ perfil: k, doSite: true }, '', `?jogador=${encodeURIComponent(nome)}`);
    perfilMais = false;
    mostrarRota(true);
  }
  function fecharPerfil() {
    if (history.state && history.state.doSite) { history.back(); return; }
    history.pushState({}, '', location.pathname);
    mostrarRota();
  }
  // voltar = true: saiu do perfil/torneio pelo "voltar", então volta pro ponto onde estava
  function mostrarRota(novo = false, voltar = true) {
    const k = souAmigo ? null : chaveDaUrl(); // amigo: nem perfil nem torneio do clã, só os jogos
    const tn = k || souAmigo ? null : torneioDaUrl();
    const antes = perfilAtual, antesTn = torneioAtual;
    perfilAtual = k;
    torneioAtual = tn;
    $('principal').hidden = !!(k || tn);
    $('perfilPagina').hidden = !k;
    $('torneioPagina').hidden = !tn;
    document.body.classList.toggle('vendo-perfil', !!(k || tn));
    if (k) {
      renderPerfil();
      marcarMenu();
      if (novo || antes !== k) rolarJa(0);
    } else if (tn) {
      renderTorneioPagina();
      tickContagens();
      marcarMenu();
      if (novo || antesTn !== tn) rolarJa(0);
    } else {
      document.title = `Ranking Clã ${TAG}`;
      if ((antes || antesTn) && voltar) { mostrarPagina(false); rolarJa(rolagemAntes); }
      else mostrarPagina(true);
    }
    contarTela();
    avisarJogos('rota', { pag: k || tn ? null : pagAtual });
  }

  async function compartilharPerfil(nome) {
    const url = linkPerfil(nome);
    const dados = { title: `${comTag(nome)} · Ranking Clã ${TAG}`, text: `Perfil de ${comTag(nome)} no ranking do clã`, url };
    try {
      if (navigator.share && matchMedia('(pointer: coarse)').matches) { await navigator.share(dados); return; }
      await navigator.clipboard.writeText(url);
      toast('Link do perfil copiado.');
    } catch (e) {
      if (e && e.name === 'AbortError') return;
      prompt('Copie o link do perfil:', url);
    }
  }

  // posição do jogador num ranking e quanto mudou desde uma data
  function posicao(lista, k) { const i = lista.findIndex((x) => x.chave === k); return i < 0 ? 0 : i + 1; }

  function renderPerfil() {
    const k = perfilAtual;
    const box = $('perfilCorpo');
    const r = elenco.get(k);
    const ctx = contexto();
    const j = ctx.pontos.find((x) => x.chave === k) || montarRanking('geral', 'pontos', true).find((x) => x.chave === k);
    const nome = j ? j.nome : r ? r.nick : null;
    const parede = nome ? paredeDe(k) : null;
    paredeAoVivo($('ppParede'), parede);
    $('perfilPagina').classList.toggle('com-parede', !!parede);

    const barra = el('div', { class: 'pp-barra' },
      el('button', { type: 'button', class: 'btn btn-sec pp-voltar', onclick: fecharPerfil }, svg(ICONE_VOLTAR, 18), 'Ranking'),
      nome ? el('div', { class: 'pp-acoes' },
        r && podeMudarAvatar(k) ? el('button', { type: 'button', class: `btn ${r.avatar ? 'btn-sec' : 'btn-pri btn-avatar-novo'}`, onclick: () => abrirAvatar(k) },
          svg(ICONE_AVATAR, 18), el('span', { class: 'btn-txt', text: r.avatar ? 'Avatar' : 'Criar avatar' })) : null,
        r && podeMudarParede(k) ? el('button', { type: 'button', class: 'btn btn-sec', 'aria-label': 'Mudar o papel de parede', onclick: () => abrirParede(k) }, svg(ICONE_PAREDE, 18), el('span', { class: 'btn-txt', text: 'Papel de parede' })) : null,
        lerEu() === k ? el('button', { type: 'button', class: 'btn btn-sec', 'aria-label': 'Sair da conta', onclick: () => sairConta() }, svg(ICONE_SAIR, 18), el('span', { class: 'btn-txt', text: 'Sair' })) : null,
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => compartilharPerfil(nome) }, svg(ICONE_LINK, 18), el('span', { class: 'btn-txt', text: 'Compartilhar' }))) : null);

    if (!nome) {
      document.title = `Jogador não encontrado · Ranking Clã ${TAG}`;
      box.replaceChildren(barra, el('p', { class: 'vazio', text: 'Não achei esse jogador. Confere o nick no link ou procure na busca.' }));
      return;
    }
    document.title = `${comTag(nome)} · Ranking Clã ${TAG}`;

    const pts = j ? j.pontos : 0;            // pontos gerais (todas as partidas)
    const ptsP = ptsPat(k);                   // pontos que valem pra patente nesta temporada
    const pat = patenteDe(ptsP);
    const ativo = !r || r.ativo;

    // cabeçalho
    const posGeral = posicao(ctx.pontos, k);
    const dia = pat.atual.diamante;
    const meds = medalhasDe(k, ctx);
    const topo = el('header', { class: `pp-topo ${dia ? 'pp-dia' : pat.atual.nivel >= ESC_NIVEIS.length - 1 ? 'pp-len' : ''} ${ehRei(k) ? 'pp-rei' : ''}`, style: `--pc:${pat.atual.cor}` },
      dia ? el('div', { class: 'pp-dia-fx', 'aria-hidden': 'true' }, el('span', { class: 'pp-dia-raios' }), el('span', { class: 'dia-faiscas' }, ...Array.from({ length: 14 }, () => el('i')))) : null,
      dia ? el('button', { type: 'button', class: 'pp-dia-gema', title: 'Ver a cerimônia de Diamantes', 'aria-label': 'Ver a cerimônia de Diamantes', onclick: () => abrirDiamante(k) }, diamanteSVG()) : null,
      el('div', { class: 'pp-id' },
        r && podeMudarAvatar(k)
          ? el('button', { type: 'button', class: 'pp-av-btn', 'aria-label': 'Mudar o avatar', title: 'Mudar o avatar', onclick: () => abrirAvatar(k) },
            avatarDe(nome, ptsP, 'av-xg'), el('span', { class: 'pp-av-lapis', 'aria-hidden': 'true' }, svg(ICONE_LAPIS, 16)))
          : avatarDe(nome, ptsP, 'av-xg'),
        el('div', { class: 'pp-nome-box' },
          el('span', { class: 'pp-tag', text: `[${TAG}]` }),
          el('h1', { id: 'perfilNome', class: 'pp-nome', text: nome }),
          el('div', { class: 'perfil-chips' }, chipPatente(ptsP, 'patente-g'), chipRei(k), chipTitulos(ctx.titulos.get(k)), ...chipTorneios(k), ...chipsCadastro(r)),
          vitrinePerfil(k, meds, raridades(ctx)))),
      posGeral ? el('div', { class: `pp-pos-geral p${posGeral}` },
        el('span', { class: 'pp-pos-num', text: `#${posGeral}` }),
        el('span', { class: 'pp-pos-rot', text: `de ${ctx.pontos.length} no ranking geral` })) : null);

    festejarMedalhas(k, meds);
    if (!j) {
      box.replaceChildren(barra, topo, el('div', { class: 'pp-miolo' }, el('p', { class: 'vazio perfil-vazio', text: 'Sem partidas ainda.' }), secaoDamas(r), secaoMedalhas(k, ctx, meds)));
      return;
    }

    // posições: geral, temporada, semana, maior massa (com quanto subiu/caiu na última semana)
    const semanaPassada = Date.now() - SEMANA_MS;
    const antes = montarRanking('geral', 'pontos', false, semanaPassada);
    const mov = (() => {
      const a = posicao(antes, k);
      if (!posGeral) return null;
      if (!a) return { cls: 'novo', txt: 'novo no ranking' };
      const d = a - posGeral;
      return d > 0 ? { cls: 'sobe', txt: `▲ subiu ${d} em 7 dias` } : d < 0 ? { cls: 'desce', txt: `▼ caiu ${-d} em 7 dias` } : { cls: 'igual', txt: 'estável em 7 dias' };
    })();
    const mes = montarRanking('mes', 'pontos');
    const sem = ctx.semana;
    const cartao = (rot, pos, total, sub, extra) => el('div', { class: `pp-posc ${pos ? 'p' + pos : 'sem-pos'}` },
      el('span', { class: 'pstat-rot', text: rot }),
      el('span', { class: 'pp-posc-num', text: pos ? `#${pos}` : '—' }),
      el('span', { class: 'pp-posc-sub', text: pos ? `de ${total} · ${sub}` : sub }),
      extra || null);
    const jMes = mes.find((x) => x.chave === k), jSem = sem.find((x) => x.chave === k);
    const posicoes = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppPos' },
      el('h2', { class: 'perfil-h3', id: 'ppPos', text: 'POSIÇÕES' }),
      el('div', { class: 'pp-posicoes' },
        cartao('GERAL', posGeral, ctx.pontos.length, ptsTxt(pts), mov ? el('span', { class: `pp-mov ${mov.cls}`, text: mov.txt }) : null),
        cartao('TEMPORADA', posicao(mes, k), mes.length, jMes ? ptsTxt(jMes.pontos) : 'sem partida neste mês'),
        cartao('SEMANA', posicao(sem, k), sem.length, jSem ? ptsTxt(jSem.pontos) : 'sem partida nesta semana'),
        cartao('MAIOR MASSA', posicao(ctx.massa, k), ctx.massa.length, `recorde ${fmt(j.melhor.mass)}`)));

    // patente (da temporada)
    const xt = patTemp(k);
    const desce = PATENTES[nivelNaVirada(pat.atual.nivel)];
    const prog = el('div', { class: 'perfil-prog', style: `--pc:${pat.atual.cor}` },
      el('span', { class: 'prog-temp' }, `PATENTE · ${nomeTemp(Date.now()).toUpperCase()}`,
        el('button', { type: 'button', class: 'info-btn', 'data-info': 'patentes', 'aria-label': 'Como funcionam as patentes', text: 'i' })),
      el('div', { class: 'prog-linha' },
        el('span', { text: pat.atual.nome }),
        el('span', { class: 'sec', text: pat.prox ? `${fmt(ptsP)} / ${fmt(pat.prox.pontos)} pts` : `${fmt(ptsP)} pts` }),
        el('span', { text: pat.prox ? pat.prox.nome : 'NÍVEL MÁXIMO' })),
      el('div', { class: 'barra barra-pat', role: 'progressbar', 'aria-label': 'Progresso da patente', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(pat.progresso * 100)) },
        el('span', { style: `width:${Math.round(pat.progresso * 100)}%` })),
      el('div', { class: 'prog-sub', text: pat.prox
        ? `Faltam ${ptsTxt(pat.prox.pontos - ptsP)} pra virar ${pat.prox.nome}${partidasPara(pat.prox.pontos - ptsP)}`
        : 'Chegou no topo. Agora é defender o trono.' }),
      // começo do mês ▸ agora ▸ dia 1, em chips (sem frase)
      el('div', { class: 'prog-virada' },
        xt && xt.ini ? el('span', { class: 'pv-item', title: `Começou a temporada como ${PATENTES[xt.ini].nome}` }, el('span', { class: 'ft-dia1', text: 'INÍCIO' }), chipPatente(PATENTES[xt.ini].pontos, 'pat-apagada')) : null,
        pat.atual.nivel ? el('span', { class: 'pv-item', title: `No dia 1 cai pra ${desce.nome}` }, el('span', { class: 'ft-dia1', text: 'DIA 1' }), el('span', { class: 'ft-seta', 'aria-hidden': 'true', text: '▸' }), chipPatente(desce.pontos, 'pat-apagada')) : null));
    if (!prog.lastChild.childNodes.length) prog.lastChild.remove();
    if ((pat.prox && pat.prox.diamante) || pat.atual.diamante) prog.classList.add('prog-dia');

    // números
    const minhas = partidas.filter((p) => chave(p.player) === k); // mais novas primeiro
    const media = Math.round(minhas.reduce((s, p) => s + p.mass, 0) / Math.max(1, minhas.length));
    const numeros = el('div', { class: 'perfil-stats' },
      ...[['PONTOS', fmt(pts), 'laranja'], ['RECORDE', fmt(j.melhor.mass), ''], ['MÉDIA', fmt(media), ''], ['PARTIDAS', fmt(j.qtd), ''], [marcoTxt, `${j.cem}×`, j.cem ? 'laranja' : ''], ['ÚLTIMA', diaTxt(j.ultima), 'pstat-txt']]
        .map(([rot, v, c]) => el('div', { class: 'pstat' }, el('span', { class: 'pstat-rot', text: rot }), el('span', { class: `pstat-num ${c} ${v.length > 7 && c !== 'pstat-txt' ? 'pstat-longo' : ''}`, text: v }))));

    // evolução
    const ultimas = minhas.slice(0, 20).reverse();
    const g = document.createElement('div');
    g.className = 'grafico-box';
    g.innerHTML = grafico(ultimas);

    // momentos marcantes do jogador
    const ev = montarConquistas(k, 8);
    const momentos = ev.length ? el('section', { class: 'pp-sec', 'aria-labelledby': 'ppMom' },
      el('h2', { class: 'perfil-h3', id: 'ppMom', text: 'MOMENTOS' }),
      el('ul', { class: 'pp-momentos conquistas-lista' }, ...ev.map((e) => el('li', null,
        el('span', { class: `bola ${e.tipo}`, 'aria-hidden': 'true' }),
        el('span', { class: 'txt' }, e.partes),
        el('span', { class: 'quando', text: dataCurta(e.quando) }))))) : null;

    // histórico de partidas
    const recordeId = j.melhor.id;
    const mostrar = perfilMais ? minhas : minhas.slice(0, 10);
    const historico = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppHist' },
      el('h2', { class: 'perfil-h3', id: 'ppHist' }, 'PARTIDAS ', el('span', { class: 'sec', text: fmt(minhas.length) })),
      el('ul', { class: 'pp-hist' }, ...mostrar.map((p) => {
        const url = urlPrint(p);
        const pp = pontosDe(p.mass);
        return el('li', { class: `pp-hist-item ${p.mass >= MARCO ? 'cem' : ''}` },
          url
            ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${fmt(p.mass)}`, onclick: () => abrirPrint(p) }, el('img', { src: url, alt: '', loading: 'lazy' }))
            : el('span', { class: 'mini', text: 'sem print' }),
          el('div', { class: 'pp-hist-info' },
            el('span', { class: 'partida-massa' }, fmt(p.mass),
              p.id === recordeId ? el('span', { class: 'chip', text: 'RECORDE' }) : null,
              p.mass >= MARCO ? el('span', { class: 'cem-chip', text: marcoTxt }) : null),
            el('span', { class: 'partida-data', text: new Date(p.created_at).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short', year: 'numeric' }).replace(/\./g, '') })),
          el('span', { class: 'pp-hist-pts', text: pp ? `+${ptsTxt(pp)}` : '0 pts' }));
      })),
      minhas.length > mostrar.length ? el('button', { type: 'button', class: 'btn btn-sec pp-mais', onclick: () => { perfilMais = true; renderPerfil(); } }, `Ver todas as ${fmt(minhas.length)} partidas`) : null);

    // em cima: números e conquistas de temporada; no meio, a sala de medalhas inteira; embaixo, a história
    const lado = [secaoTrofeusPerfil(k, ctx), secaoInsigniasPerfil(k)].filter(Boolean);
    const evolucao = el('section', { class: 'pp-sec', 'aria-labelledby': 'ppEvo' }, el('h2', { class: 'perfil-h3', id: 'ppEvo', text: ultimas.length > 1 ? `EVOLUÇÃO · ÚLTIMAS ${ultimas.length} PARTIDAS` : 'EVOLUÇÃO' }), g);
    trocar(box, barra, topo, el('div', { class: 'pp-miolo' },
      el('div', { class: `pp-grade ${lado.length ? '' : 'pp-grade-1'}` },
        el('div', { class: 'pp-col' }, posicoes, prog, numeros, lado.length ? evolucao : null),
        lado.length ? el('div', { class: 'pp-col' }, ...lado) : null),
      lado.length ? null : evolucao,
      secaoDamas(r),
      secaoMedalhas(k, ctx, meds),
      (() => {
        const hist = [secaoTorneiosPerfil(k), momentos].filter(Boolean);
        return el('div', { class: `pp-grade ${hist.length ? '' : 'pp-grade-1'}` },
          hist.length ? el('div', { class: 'pp-col' }, ...hist) : null,
          el('div', { class: 'pp-col' }, historico));
      })()));
  }
  // seção DAMAS (quem monta é o jogos.js; só aparece pra quem já jogou)
  function secaoDamas(r) {
    const f = window.COBR && window.COBR.perfilDamas;
    if (!f || !r) return null;
    try { return f(r.id); } catch (e) { console.warn('damas:', e); return null; }
  }
  // troféu (campeão) e medalha de prata (vice) de torneio; curto = só o número (tabela do ranking)
  function chipTorneios(k, curto = false) {
    const v = vitoriasTorneio(k), p = vicesTorneio(k);
    return [
      v ? el('span', { class: 'titulo-chip tn-chip', title: `${v}× campeão de torneio` }, svg(ICONE_TROFEU, 12), curto ? (v > 1 ? `${v}×` : null) : `${v}× torneio`) : null,
      p ? el('span', { class: 'titulo-chip tn-chip-vice', title: `${p}× vice-campeão de torneio` }, svg(ICONE_MEDALHA, 12), curto ? (p > 1 ? `${p}×` : null) : `${p}× vice`) : null,
    ];
  }

  // ============================================================
  //  TORNEIOS E CAMPEONATOS
  //  O dono monta pelo site: formato, o que conta, datas, quem joga e prêmios.
  //  A classificação é calculada aqui, do mesmo jeito que o ranking.
  // ============================================================
  const ICONE_ESPADAS = '<path d="M14.5 17.5L3 6V3h3l11.5 11.5M13 19l6-6M16 16l4 4M19 21l2-2M9.5 17.5L21 6V3h-3L6.5 14.5M11 19l-6-6M8 16l-4 4M5 21l-2-2"/>';
  const ICONE_RELOGIO = '<circle cx="12" cy="12" r="8.5"/><path d="M12 7.5V12l3 2"/>';
  const ICONE_CONVERSA = '<path d="M4 20l1.4-4.2A8 8 0 1 1 8.2 18.6z"/>';
  const ICONE_BANDEIRA = '<path d="M5 21V4M5 4h12l-2.5 4L17 12H5"/>';
  const FORMATOS = {
    soma: { nome: 'Quem soma mais', curto: 'SOMA TUDO', icone: '<path d="M5 20V12M12 20V5M19 20v-9"/>', desc: 'Todas as partidas somam. Vence o maior total.' },
    melhor: { nome: 'Maior partida', curto: 'MAIOR PARTIDA', icone: '<path d="M12 2l3 6 6 1-4.5 4.5 1 6.5L12 17l-5.5 3 1-6.5L3 9l6-1z"/>', desc: 'Vale só a melhor partida de cada um.' },
    melhores: { nome: 'Melhores partidas', curto: 'MELHORES', icone: '<path d="M12 3l9 5-9 5-9-5z"/><path d="M3 13l9 5 9-5"/>', desc: 'Soma só as melhores de cada um. Jogar mais não dá vantagem.' },
    meta: { nome: 'Corrida até a meta', curto: 'CORRIDA', icone: ICONE_BANDEIRA, desc: 'O primeiro a chegar no número vence.' },
    mata: { nome: 'Mata-mata', curto: 'MATA-MATA', icone: ICONE_ESPADAS, desc: 'Duelos 1 contra 1. Perdeu, tá fora.' },
    hora: { nome: 'Líder na hora H', curto: 'HORA H', icone: ICONE_RELOGIO, desc: 'Quem estiver em 1º no ranking do clã na hora marcada é o campeão.' },
    livre: { nome: 'Regras próprias', curto: 'REGRAS PRÓPRIAS', icone: '<path d="M14 3H6v18h12V7z"/><path d="M14 3v4h4M9 12h6M9 16h4"/>', desc: 'Você escreve as regras e, no fim, escolhe o campeão e o vice.' },
  };
  const formatoDe = (t) => FORMATOS[t.formato] || FORMATOS.soma;
  // como o "hora H" conta: no ranking por pontos soma tudo, no de massa vale a maior partida
  const regraTn = (t) => (t.formato === 'hora' ? (t.metrica === 'massa' ? 'melhor' : 'soma') : t.formato);
  const BASES = { geral: 'ranking geral', mes: 'temporada do mês', semana: 'ranking da semana' };
  const NA_BASE = { geral: 'no ranking geral', mes: 'na temporada do mês', semana: 'no ranking da semana' };
  const baseDe = (t) => (BASES[t.base] ? t.base : 'geral');

  // pontos da patente de cada um (pra cor do avatar)
  const ptsGeralDe = (k) => ptsPat(k);
  // pontos do ranking geral (pra montar a chave do mata-mata pelo ranking)
  let cacheGeral = null;
  function ptsRankingDe(k) {
    if (!cacheGeral || cacheGeral.n !== partidas.length || cacheGeral.p !== partidas[0]) {
      cacheGeral = { n: partidas.length, p: partidas[0], m: new Map(montarRanking('geral', 'pontos', true).map((j) => [j.chave, j.pontos])) };
    }
    return cacheGeral.m.get(k) || 0;
  }

  // até quando valem as partidas: o fim marcado ou a hora em que o dono encerrou
  const fimTn = (t) => Math.min(t.fim ? Date.parse(t.fim) : Infinity, t.encerrado_em ? Date.parse(t.encerrado_em) : Infinity);
  function statusTn(t) {
    const agora = Date.now();
    if (t.formato === 'mata') {
      if (t.encerrado_em || campeaoMata(t)) return 'fim';
    } else if (agora >= fimTn(t) || (t.formato === 'livre' && podioLivre(t)[0])) return 'fim';
    return agora < Date.parse(t.inicio) ? 'breve' : 'vivo';
  }
  const torneiosVisiveis = () => (torneiosOk ? torneios.filter((t) => t.publicado || admin) : []);

  function unidadeTn(t, n = 2) {
    if (t.metrica === 'pontos') return n === 1 ? 'pt' : 'pts';
    if (t.metrica === 'massa') return 'de massa';
    return String(t.unidade || '').trim() || 'pts';
  }
  const valorTn = (t, v) => `${fmt(v)} ${unidadeTn(t, v)}`;
  const nomeMetrica = (t) => (t.metrica === 'pontos' ? 'pontos' : t.metrica === 'massa' ? 'massa' : String(t.unidade || '').trim() || 'pontos');
  const rotMetrica = (t) => nomeMetrica(t).toUpperCase();
  const nickId = (id) => { const r = jogPorId.get(id); return r ? r.nick : '?'; };

  function idsInscritos(t) {
    if (t.todos) return jogadores.filter((r) => r.ativo).map((r) => r.id);
    return [...new Set(t.participantes || [])].filter((id) => jogPorId.has(id));
  }
  // chave do nick -> nome de quem está inscrito
  function inscritosTn(t) {
    return new Map(idsInscritos(t).map((id) => { const r = jogPorId.get(id); return [chave(r.nick), r.nick]; }));
  }

  // tudo que conta no torneio: partidas do ranking no período (se ligado) + resultados lançados na mão
  function entradasTn(t) {
    const lista = [];
    if (t.formato === 'livre') return lista;
    const hora = t.formato === 'hora';
    if (hora || (t.auto && t.metrica !== 'custom' && t.formato !== 'mata')) {
      // hora H: vale o ranking escolhido (geral, do mês ou da semana) como estava na hora marcada
      const fim = fimTn(t);
      const ini = hora ? inicioPeriodo(baseDe(t), isFinite(fim) ? fim : Date.now()) : Date.parse(t.inicio);
      const insc = t.todos ? null : inscritosTn(t);
      for (const p of partidas) {
        const q = Date.parse(p.created_at);
        if (q < ini || q >= fim) continue;
        const k = chave(p.player);
        if (insc && !insc.has(k)) continue;
        lista.push({ id: p.id, k, nome: nomeDe(k, p.player), bruto: p.mass, quando: p.created_at, partida: p });
      }
    }
    for (const l of lancamentos) {
      if (l.torneio_id !== t.id || hora) continue;
      const r = jogPorId.get(l.player_id);
      if (!r) continue;
      lista.push({ id: l.id, k: chave(r.nick), nome: r.nick, bruto: l.valor, quando: l.created_at, lanc: l });
    }
    // em "pontos", o que entra é a massa e vira ponto pela mesma regra do ranking
    for (const e of lista) e.valor = t.metrica === 'pontos' ? pontosDe(e.bruto) : e.bruto;
    return lista.sort((a, b) => Date.parse(b.quando) - Date.parse(a.quando));
  }

  // classificação de torneio por pontos (todos os formatos menos o mata-mata)
  function classificarTn(t, ents = entradasTn(t)) {
    const regra = regraTn(t);
    const mapa = new Map();
    const linha = (k, nome) => {
      let l = mapa.get(k);
      if (!l) { l = { chave: k, nome, ents: [], total: 0, qtd: 0, quando: 0, chegou: null, contadas: new Set() }; mapa.set(k, l); }
      return l;
    };
    for (const [k, nome] of inscritosTn(t)) linha(k, nome);
    for (const e of ents) linha(e.k, e.nome).ents.push(e);
    for (const l of mapa.values()) {
      const crono = [...l.ents].sort((a, b) => Date.parse(a.quando) - Date.parse(b.quando));
      let contam = crono;
      if (regra === 'melhor') contam = crono.length ? [crono.reduce((m, e) => (e.valor > m.valor ? e : m))] : [];
      else if (regra === 'melhores') contam = [...crono].sort((a, b) => b.valor - a.valor || Date.parse(a.quando) - Date.parse(b.quando)).slice(0, Math.max(1, t.qtd || 3));
      l.qtd = crono.length;
      l.contadas = new Set(contam.map((e) => e.id));
      l.total = contam.reduce((s, e) => s + e.valor, 0);
      l.quando = contam.reduce((m, e) => Math.max(m, Date.parse(e.quando)), 0);
      if (t.formato === 'meta' && t.meta) {
        let s = 0;
        for (const e of crono) { s += e.valor; if (s >= t.meta) { l.chegou = Date.parse(e.quando); break; } }
      }
    }
    // empate: ganha quem chegou naquele número primeiro
    const lista = [...mapa.values()].sort((a, b) => {
      if (t.formato === 'meta' && (a.chegou || b.chegou)) return a.chegou && b.chegou ? a.chegou - b.chegou : a.chegou ? -1 : 1;
      return b.total - a.total || (a.quando || Infinity) - (b.quando || Infinity) || a.nome.localeCompare(b.nome, 'pt-BR');
    });
    lista.forEach((l, i) => { l.pos = i + 1; });
    return lista;
  }

  // ---------- mata-mata ----------
  // posições na chave: 1º pega o último, 2º o penúltimo... os favoritos só se cruzam no fim
  function ordemSementes(n) {
    let s = [1, 2];
    while (s.length < n) { const m = s.length * 2 + 1; s = s.flatMap((x) => [x, m - x]); }
    return s;
  }
  function montarSlots(ids) {
    let tam = 2;
    while (tam < ids.length) tam *= 2;
    return ordemSementes(tam).map((sd) => ids[sd - 1] || null); // null = folga (passa direto)
  }
  // A chave guarda só a 1ª rodada e os resultados; as rodadas seguintes saem dos vencedores.
  // Se um resultado antigo muda, o duelo seguinte volta a ficar em aberto sozinho.
  function rodadasMata(t) {
    const c = t.chave;
    if (!c || !Array.isArray(c.slots) || c.slots.length < 2) return null;
    const res = c.res || {};
    const rodadas = [];
    let atuais = c.slots;
    for (let r = 0; atuais.length >= 2; r++) {
      const jogos = [];
      for (let i = 0; i < atuais.length; i += 2) {
        const a = atuais[i] || null, b = atuais[i + 1] || null;
        const j = { id: `${r}-${i / 2}`, r, a, b, va: null, vb: null, v: null, wo: false, bye: false };
        if (r === 0 && (!a || !b)) { j.bye = true; j.v = a || b; }
        else if (a && b) {
          const x = res[j.id];
          if (x && x.a === a && x.b === b && (x.v === a || x.v === b)) Object.assign(j, { va: x.va ?? null, vb: x.vb ?? null, v: x.v, wo: !!x.wo });
        }
        jogos.push(j);
      }
      rodadas.push(jogos);
      atuais = jogos.map((j) => j.v);
    }
    return rodadas;
  }
  function campeaoMata(t) { const rs = rodadasMata(t); return rs ? rs[rs.length - 1][0].v : null; }
  function nomeRodada(r, total) {
    const falta = total - r;
    return falta === 1 ? 'FINAL' : falta === 2 ? 'SEMIFINAL' : falta === 3 ? 'QUARTAS' : falta === 4 ? 'OITAVAS' : `${r + 1}ª RODADA`;
  }
  function naRodada(r, total) {
    const falta = total - r;
    return falta === 1 ? 'na final' : falta === 2 ? 'na semifinal' : falta === 3 ? 'nas quartas' : falta === 4 ? 'nas oitavas' : `na ${r + 1}ª rodada`;
  }
  // até onde cada um chegou: última rodada em que aparece e se perdeu nela
  function chegadaMata(rodadas) {
    const m = new Map();
    for (const jogos of rodadas) for (const j of jogos) for (const id of [j.a, j.b]) if (id) m.set(id, { r: j.r, fora: !!j.v && j.v !== id, jogo: j });
    return m;
  }
  // 1 = campeão, 2 = vice, 3 = semifinal, 0 = o resto
  function lugarMata(rodadas, id) {
    const c = chegadaMata(rodadas).get(id);
    if (!c) return null;
    const total = rodadas.length;
    if (rodadas[total - 1][0].v === id) return { pos: 1, txt: 'Campeão' };
    if (c.fora) return { pos: c.r === total - 1 ? 2 : c.r === total - 2 ? 3 : 0, txt: c.r === total - 1 ? 'Vice-campeão' : `Caiu ${naRodada(c.r, total)}` };
    return { pos: 0, txt: `Está ${naRodada(c.r, total)}` };
  }

  // regras próprias: campeão, vice e 3º escolhidos pelo dono (só quem ainda está no elenco)
  const podioLivre = (t) => (t.podio || []).map((id) => (id && jogPorId.has(id) ? id : null));
  // campeão, vice e 3º de um torneio encerrado: [{chave, nome, txt}] (posição vazia = null)
  function podioTn(t) {
    if (statusTn(t) !== 'fim') return [];
    const doId = (id, txt = '') => (id && jogPorId.has(id) ? { chave: chave(nickId(id)), nome: nickId(id), txt } : null);
    if (t.formato === 'livre') return podioLivre(t).map((id) => doId(id));
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      const fin = rs && rs[rs.length - 1][0];
      if (!fin || !fin.v) return [];
      const vice = fin.v === fin.a ? fin.b : fin.a;
      const pl = (j, id) => (j.va != null && j.vb != null ? `${fmt(id === j.a ? j.va : j.vb)} × ${fmt(id === j.a ? j.vb : j.va)} na final` : '');
      return [doId(fin.v, pl(fin, fin.v)), doId(vice, pl(fin, vice))];
    }
    return classificarTn(t).filter((l) => l.qtd).slice(0, 3).map((l) => ({ chave: l.chave, nome: l.nome, txt: valorTn(t, l.total) }));
  }
  function vencedorTn(t) { return podioTn(t)[0] || null; }

  // troféus de torneio (campeão) e medalhas de prata (vice) de cada jogador, dos torneios publicados.
  // Calculado uma vez por desenho da página (render() limpa o cache).
  let cacheTrofeus = null;
  function trofeusDe(k) {
    if (!cacheTrofeus) {
      cacheTrofeus = new Map();
      for (const t of torneiosVisiveis()) {
        if (!t.publicado) continue;
        podioTn(t).slice(0, 2).forEach((p, i) => {
          if (!p) return;
          if (!cacheTrofeus.has(p.chave)) cacheTrofeus.set(p.chave, []);
          cacheTrofeus.get(p.chave).push({ t, pos: i + 1, txt: p.txt, quando: isFinite(fimTn(t)) ? Math.min(fimTn(t), Date.now()) : Date.parse((t.chave && t.chave.em) || t.inicio) });
        });
      }
      for (const l of cacheTrofeus.values()) l.sort((a, b) => a.pos - b.pos || b.quando - a.quando);
    }
    return (k && cacheTrofeus.get(k)) || [];
  }
  const vitoriasTorneio = (k) => trofeusDe(k).filter((x) => x.pos === 1).length;
  const vicesTorneio = (k) => trofeusDe(k).filter((x) => x.pos === 2).length;

  // ---------- textos ----------
  function tempoAte(alvo) {
    const min = Math.max(0, Math.round((alvo - Date.now()) / 60000));
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60);
    if (h < 24) return `${h} h${min % 60 ? ` e ${min % 60} min` : ''}`;
    const d = Math.floor(h / 24);
    return `${d} ${d === 1 ? 'dia' : 'dias'}${h % 24 ? ` e ${h % 24} h` : ''}`;
  }
  const dataHora = (ms) => new Date(ms).toLocaleString('pt-BR', { weekday: 'short', day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }).replace(/\./g, '');
  function periodoTn(t) {
    const ini = Date.parse(t.inicio);
    if (t.formato === 'hora' && t.fim) return `hora H: ${dataHora(Date.parse(t.fim))}`;
    return t.fim ? `${dataHora(ini)} até ${dataHora(Date.parse(t.fim))}` : `começa ${dataHora(ini)} · sem data pra acabar`;
  }
  function statusTxt(t, st) {
    if (st === 'breve') return `começa em ${tempoAte(Date.parse(t.inicio))}`;
    if (st === 'fim') return 'encerrado';
    if (t.formato === 'hora') return `hora H em ${tempoAte(fimTn(t))}`;
    return isFinite(fimTn(t)) ? `termina em ${tempoAte(fimTn(t))}` : 'rolando agora';
  }
  // as regras em frases curtas, montadas pela configuração do torneio
  function resumoTn(t) {
    const m = nomeMetrica(t);
    const itens = [];
    const quem = t.todos ? 'O clã inteiro joga.' : `${idsInscritos(t).length} ${idsInscritos(t).length === 1 ? 'jogador inscrito' : 'jogadores inscritos'}.`;
    if (t.formato === 'hora') {
      const h = t.fim ? `na hora H (${dataHora(Date.parse(t.fim))})` : 'na hora marcada';
      itens.push(`Quem estiver em 1º ${NA_BASE[baseDe(t)]} (${t.metrica === 'massa' ? 'por massa' : 'por pontos'}) ${h} é o campeão. O 2º leva a medalha de vice.`);
      itens.push(t.metrica === 'massa' ? 'Vale a maior partida de cada um, igualzinho ao ranking.' : 'Contam todas as partidas registradas no ranking, com os mesmos pontos.');
      itens.push('Partida registrada depois da hora H não conta. Até lá, a classificação mostra como está agora.');
      itens.push(quem);
      return itens;
    }
    if (t.formato === 'livre') {
      itens.push('Regras próprias: o dono do clã confere e escolhe o campeão e o vice no fim.');
      if (!t.regras) itens.push('As regras são combinadas no grupo.');
      itens.push(quem);
      return itens;
    }
    if (t.formato === 'soma') itens.push(`Vence quem somar mais ${m} durante o torneio.`);
    if (t.formato === 'melhor') itens.push(t.metrica === 'massa' ? 'Vale só a maior massa de cada um. Vence quem fizer a maior partida.' : `Vale só a melhor partida de cada um. Vence quem fizer mais ${m} numa partida.`);
    if (t.formato === 'melhores') itens.push(`Contam só as ${t.qtd || 3} melhores partidas de cada um, e vence quem somar mais ${m} nelas. Jogar mais não dá vantagem: jogar melhor sim.`);
    if (t.formato === 'meta') itens.push(`Corrida: o primeiro a juntar ${t.meta ? valorTn(t, t.meta) : 'a meta'} vence. Quem chegar depois fica em 2º, 3º…`);
    if (t.formato === 'mata') {
      itens.push('Mata-mata 1 contra 1: quem vence o duelo avança, quem perde tá fora. Até sobrar o campeão.');
      itens.push(`Cada duelo é decidido por ${m}. ${t.semente === 'sorteio' ? 'A chave é sorteada.' : 'A chave segue o ranking: os melhores só se cruzam no fim.'}`);
    } else {
      if (t.auto && t.metrica !== 'custom') itens.push(t.metrica === 'pontos' ? 'Toda partida registrada no ranking durante o torneio conta sozinha, com os mesmos pontos do ranking.' : 'Toda partida registrada no ranking durante o torneio conta sozinha.');
      else itens.push('Os resultados são conferidos e lançados pelo dono do clã.');
      itens.push(t.formato === 'meta' ? 'Se ninguém chegar na meta, ganha quem estiver mais perto no fim.' : 'Empate: ganha quem chegou naquele número primeiro.');
    }
    itens.push(t.todos ? 'O clã inteiro joga.' : `${idsInscritos(t).length} ${idsInscritos(t).length === 1 ? 'jogador inscrito' : 'jogadores inscritos'}.`);
    return itens;
  }
  const linkTorneio = (t) => `${location.origin}${location.pathname}?torneio=${encodeURIComponent(t.id)}`;
  // texto pronto pra colar no grupo do WhatsApp
  function textoGrupo(t) {
    const st = statusTn(t);
    const linhas = [`🏆 *${t.nome.toUpperCase()}*`, `${formatoDe(t).nome} · ${statusTxt(t, st)}`, ''];
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      if (!rs) linhas.push('A chave ainda vai ser montada.');
      else {
        const camp = rs[rs.length - 1][0].v;
        if (camp) linhas.push(`🏆 Campeão: ${comTag(nickId(camp))}`);
        const vice = podioTn(t)[1];
        if (vice) linhas.push(`🥈 Vice: ${comTag(vice.nome)}`);
        const atual = rs.find((js) => js.some((j) => !j.v));
        if (atual) {
          linhas.push(`*${nomeRodada(atual[0].r, rs.length)}*`);
          for (const j of atual) if (!j.bye) linhas.push(`${j.a ? nickId(j.a) : '?'} x ${j.b ? nickId(j.b) : '?'}${j.v ? `  ✅ ${nickId(j.v)}` : ''}`);
        }
      }
    } else if (t.formato === 'livre') {
      const pod = podioTn(t);
      if (pod[0]) ['🏆 Campeão', '🥈 Vice', '🥉 3º'].forEach((r, i) => { if (pod[i]) linhas.push(`${r}: ${comTag(pod[i].nome)}`); });
      else linhas.push(t.regras ? t.regras.slice(0, 400) : 'Valendo! As regras estão no site.');
    } else {
      const cls = classificarTn(t).filter((l) => l.qtd);
      if (st === 'fim' && cls[0]) linhas.push(`🏆 Campeão: ${comTag(cls[0].nome)}${cls[1] ? ` · 🥈 Vice: ${comTag(cls[1].nome)}` : ''}`, '');
      if (!cls.length) linhas.push(st === 'breve' ? 'Prepara a cobra que já vai começar!' : 'Ninguém pontuou ainda. A liderança tá aberta!');
      const med = ['🥇', '🥈', '🥉'];
      cls.slice(0, 10).forEach((l, i) => linhas.push(`${med[i] || `${i + 1}º`} ${l.nome} — ${valorTn(t, l.total)}`));
    }
    if (t.premios && t.premios[0]) linhas.push('', `Prêmio: ${t.premios[0]}`);
    linhas.push('', `Acompanhe ao vivo: ${linkTorneio(t)}`);
    return linhas.join('\n');
  }
  const linkZap = (texto) => `https://wa.me/?text=${encodeURIComponent(texto)}`;

  // ---------- contagem regressiva (atualiza a cada segundo) ----------
  function contagem(alvo, rotulo) {
    if (!isFinite(alvo) || alvo <= Date.now()) return null;
    const un = [['d', 'DIAS'], ['h', 'HORAS'], ['m', 'MIN'], ['s', 'SEG']];
    return el('div', { class: 'tn-conta', 'data-conta': String(alvo) },
      el('span', { class: 'tn-conta-rot', text: rotulo }),
      el('div', { class: 'tn-conta-num', role: 'timer', 'aria-label': `${rotulo.toLowerCase()} ${tempoAte(alvo)}` },
        ...un.map(([u, r]) => el('span', { class: 'tn-cel' }, el('b', { 'data-u': u, text: '--' }), el('small', { text: r })))));
  }
  function contaCurta(alvo) {
    if (!isFinite(alvo) || alvo <= Date.now()) return null;
    return el('span', { class: 'tn-curta', 'data-conta': String(alvo) }, el('span', { 'data-curto': '' }));
  }
  function tickContagens() {
    const agora = Date.now();
    const dd = (x) => String(x).padStart(2, '0');
    let virou = false;
    for (const n of document.querySelectorAll('[data-conta]')) {
      const s = Math.floor((Number(n.dataset.conta) - agora) / 1000);
      if (s < 0) { virou = true; continue; }
      const v = { d: Math.floor(s / 86400), h: Math.floor((s % 86400) / 3600), m: Math.floor((s % 3600) / 60), s: s % 60 };
      for (const b of n.querySelectorAll('[data-u]')) b.textContent = dd(v[b.dataset.u]);
      const c = n.querySelector('[data-curto]');
      if (c) c.textContent = v.d ? `${v.d}d ${dd(v.h)}h ${dd(v.m)}m` : `${dd(v.h)}:${dd(v.m)}:${dd(v.s)}`;
    }
    // começou ou acabou agora: redesenha pra trocar o status
    if (virou) render();
  }

  // ---------- pedaços visuais ----------
  function pilulaStatus(t, st) {
    const txt = { vivo: 'AO VIVO', breve: 'EM BREVE', fim: 'ENCERRADO' }[st];
    return el('span', { class: `tn-pill ${st}` }, st === 'vivo' ? el('span', { class: 'ponto', 'aria-hidden': 'true' }) : null, txt);
  }
  const chipFormato = (t) => el('span', { class: 'tn-fmt' }, svg(formatoDe(t).icone, 14), formatoDe(t).curto);
  const chipRascunho = (t) => (t.publicado ? null : el('span', { class: 'tn-pill rascunho', text: 'RASCUNHO · SÓ ADMIN VÊ' }));
  function linkTn(t, classe, ...filhos) {
    return el('a', {
      href: `?torneio=${encodeURIComponent(t.id)}`, class: classe,
      onclick: (e) => { if (e.ctrlKey || e.metaKey || e.shiftKey || e.button) return; e.preventDefault(); abrirTorneio(t.id); },
    }, ...filhos);
  }

  // ---------- seção de torneios na página inicial ----------
  function renderTorneios() {
    const lista = torneiosVisiveis();
    const sec = $('torneios');
    const tem = lista.length > 0;
    sec.hidden = !tem && !admin;
    $('avisoTorneios').hidden = torneiosOk || !admin;
    $('btnNovoTorneio').hidden = !admin || !torneiosOk;
    $('menuTorneios').hidden = sec.hidden;
    // sem torneio, o lugar dele na barra de baixo fica com a sala de troféus
    $('bbTorneios').hidden = !tem;
    $('bbTrofeus').hidden = tem;
    $('faixaTnBox').hidden = true;
    if (sec.hidden) return;
    const box = $('listaTorneios');
    if (!torneiosOk) { trocar(box); return; }
    if (!tem) {
      trocar(box, el('p', { class: 'vazio', text: 'Nenhum torneio ainda. Toque em "Criar torneio": escolha o formato, as datas e os prêmios, e o clã acompanha o placar ao vivo aqui.' }));
      return;
    }
    const comSt = lista.map((t) => ({ t, st: statusTn(t) }));
    const ativos = comSt.filter((x) => x.st !== 'fim')
      .sort((a, b) => (a.st === b.st ? 0 : a.st === 'vivo' ? -1 : 1) || Date.parse(a.t.inicio) - Date.parse(b.t.inicio));
    renderFaixaTn(ativos);
    const quandoAcabou = (t) => (isFinite(fimTn(t)) ? fimTn(t) : Date.parse((t.chave && t.chave.em) || t.inicio));
    const fechados = comSt.filter((x) => x.st === 'fim').sort((a, b) => quandoAcabou(b.t) - quandoAcabou(a.t));
    trocar(box,
      ativos.length
        ? el('div', { class: 'tn-grade' }, ...ativos.map(({ t, st }) => cardTorneio(t, st)))
        : el('p', { class: 'vazio', text: 'Nenhum torneio rolando agora. O próximo aparece aqui.' }),
      fechados.length ? el('div', { class: 'tn-fechados' },
        el('h3', { class: 'perfil-h3', text: 'JÁ ACABARAM' }),
        el('div', { class: 'tn-grade-p' }, ...fechados.slice(0, 6).map(({ t }) => cardFechado(t)))) : null);
  }

  // aviso curto no ranking: tem torneio rolando? um toque leva pra página dos torneios
  function renderFaixaTn(ativos) {
    const vivos = ativos.filter((x) => x.st === 'vivo');
    const lista = vivos.length ? vivos : ativos;
    if (!lista.length) return;
    const { t, st } = lista[0];
    const conta = contaCurta(st === 'breve' ? Date.parse(t.inicio) : fimTn(t));
    const outros = lista.length - 1;
    trocar($('faixaTn'),
      pilulaStatus(t, st),
      el('span', { class: 'faixa-tn-txt' },
        el('b', { text: t.nome }),
        conta ? el('span', { class: 'faixa-tn-conta' }, st === 'breve' ? 'começa em ' : t.formato === 'hora' ? 'hora H em ' : 'termina em ', conta) : null),
      outros > 0 ? el('span', { class: 'faixa-tn-mais', text: `+${outros} ${st === 'vivo' ? 'rolando' : 'vindo aí'}` }) : null,
      el('span', { class: 'faixa-tn-ver', text: 'Ver torneios →' }));
    $('faixaTnBox').hidden = false;
  }

  function cardTorneio(t, st) {
    const alvo = st === 'breve' ? Date.parse(t.inicio) : fimTn(t);
    let corpo;
    if (t.formato === 'mata') {
      const rs = rodadasMata(t);
      const atual = rs && rs.find((js) => js.some((j) => !j.v));
      const nome = (id) => el('span', { class: 'tn-card-lado', text: id ? nickId(id) : 'a definir' });
      corpo = !rs || !atual
        ? el('p', { class: 'tn-card-info', text: `${idsInscritos(t).length} jogadores · ${rs ? 'chave pronta' : 'a chave sai antes de começar'}` })
        : el('div', { class: 'tn-card-mata' },
            el('span', { class: 'tn-card-rod', text: `${nomeRodada(atual[0].r, rs.length)} · ${atual.filter((j) => !j.v).length} ${atual.filter((j) => !j.v).length === 1 ? 'duelo' : 'duelos'} pra rolar` }),
            ...atual.filter((j) => !j.bye && !j.v).slice(0, 3).map((j) => el('div', { class: 'tn-card-duelo' }, nome(j.a), el('span', { class: 'vs-x', text: '×' }), nome(j.b))));
    } else if (t.formato === 'livre') {
      corpo = el('p', { class: 'tn-card-info tn-card-regras', text: t.regras || 'Regras próprias, combinadas no grupo. O dono escolhe o campeão no fim.' });
    } else {
      const cls = classificarTn(t).filter((l) => l.qtd);
      corpo = cls.length
        ? el('ol', { class: 'tn-mini' }, ...cls.slice(0, 3).map((l, i) => el('li', { class: `tt tt${i + 1}` },
            el('span', { class: 'tt-pos', text: `${i + 1}º` }),
            el('span', { class: 'tt-nome' }, el('span', { class: 'tn-mini-nome', text: l.nome })),
            el('span', { class: 'tt-pts', text: valorTn(t, l.total) }))))
        : el('p', { class: 'tn-card-info', text: st === 'breve' ? `${t.todos ? 'O clã inteiro' : `${idsInscritos(t).length} jogadores`} na disputa.` : 'Ninguém pontuou ainda. A liderança tá aberta!' });
    }
    const conta = contaCurta(alvo);
    return linkTn(t, `tn-card st-${st}`,
      el('div', { class: 'tn-card-topo' }, pilulaStatus(t, st), chipFormato(t), chipRascunho(t)),
      el('h3', { class: 'tn-card-nome', text: t.nome }),
      conta ? el('div', { class: 'tn-card-conta' }, el('span', { text: st === 'breve' ? 'começa em' : t.formato === 'hora' ? 'hora H em' : 'termina em' }), conta) : null,
      corpo,
      t.premios && t.premios[0] ? el('div', { class: 'tn-card-premio' }, svg(ICONE_TROFEU, 16), el('span', { text: t.premios[0] })) : null,
      el('span', { class: 'tn-card-ver', text: 'Ver torneio →' }));
  }

  function cardFechado(t) {
    const [v, vice] = podioTn(t);
    return linkTn(t, 'tn-fechado',
      el('span', { class: 'tn-fechado-ic', 'aria-hidden': 'true' }, svg(ICONE_TROFEU, 20)),
      el('span', { class: 'tn-fechado-info' },
        el('b', { text: t.nome }),
        el('span', { text: v ? `${comTag(v.nome)} campeão${v.txt ? ` · ${v.txt}` : ''}` : 'encerrado sem campeão' }),
        vice ? el('span', { class: 'tn-fechado-vice' }, svg(ICONE_MEDALHA, 13), `vice: ${vice.nome}`) : null),
      chipRascunho(t));
  }

  // ---------- página do torneio ----------
  function abrirTorneio(id) {
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    if (!perfilAtual && !torneioAtual) rolagemAntes = scrollY;
    history.pushState({ torneio: id, doSite: true }, '', `?torneio=${encodeURIComponent(id)}`);
    mostrarRota(true);
  }
  function fecharTorneio() {
    if (history.state && history.state.doSite) { history.back(); return; }
    irPara('#torneios');
  }
  function torneioDaUrl() { return new URLSearchParams(location.search).get('torneio'); }

  async function copiarTexto(texto, ok) {
    try {
      await navigator.clipboard.writeText(texto);
      toast(ok);
    } catch (e) {
      prompt('Copie:', texto);
    }
  }

  let formLanc = null;        // formulário de lançar resultado (fica no HTML; a página só muda ele de lugar)
  const fl = (id) => formLanc.querySelector('#' + id);

  function renderTorneioPagina() {
    const box = $('torneioCorpo');
    const t = torneios.find((x) => x.id === torneioAtual && (x.publicado || admin));
    const voltar = el('button', { type: 'button', class: 'btn btn-sec pp-voltar', onclick: fecharTorneio }, svg(ICONE_VOLTAR, 18), 'Torneios');
    if (!t) {
      document.title = `Torneio não encontrado · Ranking Clã ${TAG}`;
      formLanc.hidden = true;
      trocar(box, el('div', { class: 'pp-barra' }, voltar), el('p', { class: 'vazio', text: 'Não achei esse torneio. Pode ter sido apagado ou ainda não foi publicado.' }));
      return;
    }
    document.title = `${t.nome} · Torneio Clã ${TAG}`;
    const st = statusTn(t);
    const mata = t.formato === 'mata';
    const livre = t.formato === 'livre';
    const rodadas = mata ? rodadasMata(t) : null;
    const ents = mata || livre ? [] : entradasTn(t);
    const cls = mata || livre ? null : classificarTn(t, ents);
    const eu = lerEu();

    const barra = el('div', { class: 'pp-barra' }, voltar,
      el('div', { class: 'pp-acoes' },
        el('a', { class: 'btn btn-sec', href: linkZap(textoGrupo(t)), target: '_blank', rel: 'noopener' }, svg(ICONE_CONVERSA, 18), el('span', { class: 'btn-txt', text: 'Mandar no grupo' })),
        el('button', { type: 'button', class: 'btn btn-sec', 'aria-label': 'Copiar link do torneio', onclick: () => copiarTexto(linkTorneio(t), 'Link do torneio copiado.') }, svg(ICONE_LINK, 18), el('span', { class: 'btn-txt', text: 'Link' })),
        admin ? el('button', { type: 'button', class: 'btn btn-pri', onclick: () => abrirBuilder(t) }, svg(ICONE_LAPIS, 18), el('span', { class: 'btn-txt', text: 'Editar' })) : null));

    // topo: nome, status e contagem regressiva (ou o campeão)
    const [camp, vice] = podioTn(t);
    let lado;
    if (st === 'breve') lado = contagem(Date.parse(t.inicio), 'COMEÇA EM');
    else if (st === 'vivo') {
      lado = contagem(fimTn(t), t.formato === 'hora' ? 'HORA H EM' : 'TERMINA EM');
      const atual = rodadas && rodadas.find((js) => js.some((j) => !j.v));
      if (!lado && atual) lado = el('div', { class: 'tn-conta' }, el('span', { class: 'tn-conta-rot', text: 'RODADA ATUAL' }), el('b', { class: 'tn-rodada', text: nomeRodada(atual[0].r, rodadas.length) }));
      if (!lado && livre) lado = el('div', { class: 'tn-conta' }, el('span', { class: 'tn-conta-rot', text: 'VALENDO' }), el('b', { class: 'tn-rodada', text: 'O DONO DÁ O RESULTADO' }));
    } else {
      lado = camp
        ? comParede(el('div', { class: 'tn-campeao' },
            el('span', { class: 'tn-taca', 'aria-hidden': 'true' }, svg(ICONE_TROFEU, 40)),
            avatarDe(camp.nome, ptsGeralDe(camp.chave), 'av-g'),
            el('span', { class: 'tn-campeao-rot', text: 'CAMPEÃO' }),
            el('button', { type: 'button', class: 'tn-campeao-nome', onclick: () => abrirPerfil(camp.chave), text: camp.nome }),
            camp.txt ? el('span', { class: 'tn-campeao-val', text: camp.txt }) : null,
            vice ? el('button', { type: 'button', class: 'tn-vice', onclick: () => abrirPerfil(vice.chave) },
              el('span', { class: 'tn-vice-ic', 'aria-hidden': 'true' }, svg(ICONE_MEDALHA, 18)),
              el('span', { class: 'tn-vice-txt' }, el('small', { text: 'VICE' }), el('b', { text: vice.nome }))) : null), camp.chave)
        : el('div', { class: 'tn-campeao' }, el('span', { class: 'tn-campeao-rot', text: 'ENCERRADO SEM CAMPEÃO' }),
            admin && livre ? el('span', { class: 'tn-campeao-val', text: 'Escolha o campeão logo abaixo.' }) : null);
    }
    const hero = el('header', { class: `tn-hero st-${st}` },
      el('div', { class: 'tn-hero-txt' },
        el('div', { class: 'tn-chips' }, pilulaStatus(t, st), chipFormato(t), chipRascunho(t)),
        el('h1', { class: 'tn-nome', text: t.nome }),
        el('p', { class: 'tn-periodo' }, svg(ICONE_RELOGIO, 16), periodoTn(t))),
      lado);

    const conteudo = [barra, hero, cartaoEu(t, st, cls, rodadas, eu), admin ? barraAdminTn(t, st, rodadas) : null];

    const regras = el('section', { class: 'pp-sec', 'aria-label': 'Regras' },
      el('h2', { class: 'perfil-h3', text: 'REGRAS' }),
      el('div', { class: 'tn-regras' },
        el('ul', null, ...resumoTn(t).map((x) => el('li', { text: x }))),
        t.regras ? el('p', { class: 'tn-regras-txt', text: t.regras }) : null));
    const lateral = [regras, blocoPremios(t, st, cls, rodadas), blocoInscritos(t)];

    if (mata) {
      formLanc.hidden = true;
      conteudo.push(blocoChave(t, st, rodadas, eu), el('div', { class: 'tn-info-grade' }, ...lateral));
      trocar(box, conteudo);
      return;
    }
    if (livre) {
      formLanc.hidden = true;
      conteudo.push(el('div', { class: 'pp-grade' },
        el('div', { class: 'pp-col' }, blocoResultadoLivre(t, st), admin ? blocoEscolherPodio(t) : null),
        el('div', { class: 'pp-col' }, ...lateral.filter(Boolean))));
      trocar(box, conteudo);
      return;
    }
    const esq = el('div', { class: 'pp-col' }, blocoClassificacao(t, st, cls, eu));
    if (admin) { esq.append(formLanc); formLanc.hidden = false; prepararLanc(t); } else formLanc.hidden = true;
    const res = blocoResultados(t, ents, cls);
    if (res) esq.append(res);
    conteudo.push(el('div', { class: 'pp-grade' }, esq, el('div', { class: 'pp-col' }, ...lateral.filter(Boolean))));
    trocar(box, conteudo);
  }

  // "você": a posição de quem marcou "Sou eu" no perfil
  function cartaoEu(t, st, cls, rodadas, eu) {
    const r = eu ? elenco.get(eu) : null;
    const inscrito = r && (t.todos ? r.ativo : (t.participantes || []).includes(r.id));
    const card = (rot, forte, fraco, extra) => el('div', { class: 'tn-eu' },
      r ? avatarDe(r.nick, ptsGeralDe(eu), 'av-m') : null,
      el('div', { class: 'tn-eu-txt' }, el('span', { class: 'tn-eu-rot', text: rot }), el('b', { text: forte }), fraco ? el('span', { text: fraco }) : null),
      extra || null);
    const convite = () => {
      if (st === 'fim' || t.todos || admin) return null;
      const msg = `Quero entrar no torneio "${t.nome}"! Meu nick: ${r ? comTag(r.nick) : comTag('')}`;
      return el('div', { class: 'tn-eu convite' },
        el('div', { class: 'tn-eu-txt' }, el('span', { class: 'tn-eu-rot', text: 'QUER JOGAR?' }), el('b', { text: 'Pede pro dono do clã te colocar.' }), el('span', { text: 'A mensagem já vai pronta com o seu nick.' })),
        el('a', { class: 'btn btn-pri', href: linkZap(msg), target: '_blank', rel: 'noopener' }, svg(ICONE_CONVERSA, 18), 'Pedir pra entrar'));
    };
    if (t.formato === 'mata') {
      if (!r) return convite();
      if (!rodadas) return inscrito ? card('VOCÊ', 'Você está inscrito.', 'A chave sai antes de começar. Fica de olho!') : convite();
      const c = chegadaMata(rodadas).get(r.id);
      if (!c) return inscrito ? card('VOCÊ', 'Você está inscrito, mas ficou fora da chave.', 'Fala com o dono do clã.') : convite();
      const total = rodadas.length;
      const outro = c.jogo.a === r.id ? c.jogo.b : c.jogo.a;
      if (rodadas[total - 1][0].v === r.id) return card('VOCÊ', 'Você é o CAMPEÃO! 👑', 'Ninguém te parou.');
      if (c.fora) return card('VOCÊ', c.r === total - 1 ? 'Vice-campeão. Bateu na trave!' : `Você caiu ${naRodada(c.r, total)}.`, outro ? `Quem te tirou: ${nickId(outro)}.` : null);
      return card('VOCÊ', c.jogo.bye ? 'Você passou direto pra próxima rodada.' : outro ? `Seu duelo ${naRodada(c.r, total)}: contra ${nickId(outro)}.` : `Você está ${naRodada(c.r, total)}.`, outro ? 'Vence e avança. Perde e tá fora.' : 'Esperando o adversário.');
    }
    if (t.formato === 'livre') {
      if (!r) return convite();
      const i = podioLivre(t).indexOf(r.id);
      if (i === 0) return card('VOCÊ', 'Você é o CAMPEÃO! 🏆', 'O troféu já está no seu perfil.');
      if (i === 1) return card('VOCÊ', 'Vice-campeão! 🥈', 'A medalha de prata já está no seu perfil.');
      if (i === 2) return card('VOCÊ', '3º lugar! 🥉', 'Pódio garantido.');
      return inscrito ? (st === 'fim' ? null : card('VOCÊ', 'Você está no torneio.', 'Lê as regras e manda ver!')) : convite();
    }
    if (!r) return convite();
    const i = cls.findIndex((l) => l.chave === eu);
    if (i < 0) return inscrito ? null : convite();
    const l = cls[i];
    if (!l.qtd) return card('VOCÊ', st === 'breve' ? 'Você está no torneio.' : 'Você ainda não pontuou.', st === 'breve' ? 'Quando começar, cada partida conta. Prepara a cobra!' : 'Joga com a tag no nick: o dono puxa as massas do servidor.');
    const n = cls.filter((x) => x.qtd).length;
    const acima = cls[i - 1];
    let fraco;
    if (i === 0) fraco = st === 'fim' ? 'Você ganhou o torneio! 🏆 O troféu já está no seu perfil.' : t.formato === 'hora' ? 'Você está em 1º. Segura até a hora H!' : 'Você lidera. Segura o trono!';
    else if (i === 1 && st === 'fim') fraco = 'Vice-campeão! 🥈 A medalha de prata já está no seu perfil.';
    else if (t.formato === 'meta' && t.meta && !l.chegou) fraco = `Faltam ${valorTn(t, t.meta - l.total)} pra meta.`;
    else if (acima.total > l.total) fraco = `Faltam ${valorTn(t, acima.total - l.total)} pra alcançar ${acima.nome} (${i}º).`;
    else fraco = `Empatado com ${acima.nome}, que chegou primeiro.`;
    return card('SUA POSIÇÃO', `#${i + 1} de ${n} · ${valorTn(t, l.total)}`, fraco);
  }

  function barraAdminTn(t, st, rodadas) {
    const salvar = (mud, msg) => salvarTn(t, mud).then(() => toast(msg)).catch((e) => { if (!erroSessao(e)) toast('Não deu pra salvar agora. (' + (e.message || 'erro') + ')', true); });
    const itens = [el('span', { class: 'admin-tag', text: 'ADMIN' })];
    if (!t.publicado) itens.push(el('button', { type: 'button', class: 'btn btn-pri', onclick: () => salvar({ publicado: true }, 'Publicado! Agora o clã inteiro vê.') }, 'Publicar pro clã'));
    if (st !== 'fim') itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('ENCERRAR AGORA?', `"${t.nome}" acaba agora e o placar congela. Dá pra reabrir depois.`, 'Encerrar', () => salvar({ encerrado_em: new Date().toISOString() }, 'Torneio encerrado.')) }, 'Encerrar agora'));
    else if (t.encerrado_em && !(t.fim && Date.parse(t.fim) <= Date.now()) && !(t.formato === 'mata' && campeaoMata(t))) {
      itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => salvar({ encerrado_em: null }, 'Torneio reaberto.') }, 'Reabrir'));
    }
    if (t.formato === 'mata' && rodadas) {
      itens.push(el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('REFAZER A CHAVE?', `A chave de "${t.nome}" é montada de novo com os inscritos de agora (${t.semente === 'sorteio' ? 'novo sorteio' : 'pelo ranking'}). Os resultados já lançados somem.`, 'Refazer', () => montarChaveTn(t)) }, 'Refazer a chave'));
    }
    const fora = t.formato === 'mata' && rodadas ? idsInscritos(t).filter((id) => !t.chave.slots.includes(id)) : [];
    return el('div', { class: 'tn-admin' }, ...itens,
      fora.length ? el('p', { class: 'tn-admin-aviso', text: `${fora.map(nickId).join(', ')} ${fora.length === 1 ? 'está inscrito mas ficou' : 'estão inscritos mas ficaram'} fora da chave. Pra incluir, refaça a chave.` }) : null);
  }

  function blocoClassificacao(t, st, cls, eu) {
    const com = cls.filter((l) => l.qtd);
    const sem = cls.filter((l) => !l.qtd);
    const meta = t.formato === 'meta' && t.meta;
    const pctMeta = (l) => Math.min(100, Math.round((l.total / t.meta) * 100));
    const podio = com.length
      ? el('div', { class: 'podio tn-podio' }, ...[1, 0, 2].filter((i) => com[i]).map((i) => {
          const l = com[i];
          return comParede(el('article', { class: `lugar l${i + 1}` },
            i === 0 ? svg(st === 'fim' ? ICONE_TROFEU : ICONE_COROA, 34, 'class="coroa"') : i === 1 && st === 'fim' ? svg(ICONE_MEDALHA, 26, 'class="tn-med-ic"') : null,
            el('div', { class: 'avatar', 'aria-hidden': 'true', text: l.nome.charAt(0).toUpperCase() }),
            el('div', null,
              el('div', { class: 'lugar-pos', text: i === 0 ? (st === 'fim' ? '1º · CAMPEÃO' : '1º · LIDERANDO') : i === 1 && st === 'fim' ? '2º · VICE' : `${i + 1}º LUGAR` }),
              btnPerfil(l, 'lugar-nome', l.nome)),
            el('div', { class: 'lugar-massa', text: fmt(l.total) }),
            el('div', { class: 'lugar-data', text: `${unidadeTn(t, l.total)} · ${l.qtd} ${l.qtd === 1 ? 'partida' : 'partidas'}` }),
            meta ? el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, pctMeta(l))}%` })) : null,
            t.premios && t.premios[i] ? el('div', { class: 'cem-selo', text: t.premios[i] }) : null), l.chave);
        }))
      : el('p', { class: 'vazio', text: st === 'breve' ? 'O placar abre quando o torneio começar.' : 'Ninguém pontuou ainda. O primeiro resultado já assume a liderança!' });

    const lider = com[0];
    const linhas = com.map((l, i) => {
      let sub = null;
      if (meta) sub = l.chegou ? `chegou na meta ${dataHora(l.chegou)}` : `faltam ${valorTn(t, t.meta - l.total)} · ${pctMeta(l)}%`;
      else if (i > 0) sub = lider.total > l.total ? `a ${valorTn(t, lider.total - l.total)} do 1º` : 'empatado com o 1º (vale quem chegou antes)';
      return el('tr', { class: `${i === 0 ? 'topo1' : ''} ${l.chave === eu ? 'tn-eu-linha' : ''}` },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' },
          el('div', { class: 'nome-linha' },
            avatarDe(l.nome, ptsGeralDe(l.chave), 'av-p'),
            btnPerfil(l, 'link-nome forte', l.nome),
            l.chave === eu ? el('span', { class: 'chip', text: 'VOCÊ' }) : null,
            meta && l.chegou ? el('span', { class: 'cem-chip', text: '✓ META' }) : null),
          meta ? el('div', { class: 'tn-prog', 'aria-hidden': 'true' }, el('span', { style: `width:${pctMeta(l)}%` })) : null,
          sub ? el('div', { class: 'nome-melhor', text: sub }) : null),
        el('td', { class: 'dir num', text: fmt(l.total) }),
        el('td', { class: 'dir sec', text: t.formato === 'melhores' ? `${Math.min(l.qtd, t.qtd || 3)} de ${l.qtd}` : fmt(l.qtd) }));
    });
    const semTxt = sem.length ? el('p', { class: 'tn-sem', text: `${sem.length} ${sem.length === 1 ? 'ainda sem resultado' : 'ainda sem resultado'}: ${sem.slice(0, 15).map((l) => l.nome).join(', ')}${sem.length > 15 ? '…' : ''}` }) : null;
    return el('section', { class: 'pp-sec', 'aria-label': 'Classificação' },
      el('h2', { class: 'perfil-h3' }, 'CLASSIFICAÇÃO ', el('span', { class: 'sec', text: st !== 'vivo' ? '' : t.formato === 'hora' ? `· ${BASES[baseDe(t)]} agora` : '· ao vivo' })),
      podio,
      com.length || sem.length ? el('div', { class: 'painel tn-tabela' },
        com.length ? el('div', { class: 'tabela-box' }, el('table', null,
          el('thead', null, el('tr', null,
            el('th', { text: 'POS' }), el('th', { text: 'JOGADOR' }),
            el('th', { class: 'dir', text: rotMetrica(t) }),
            el('th', { class: 'dir', text: t.formato === 'melhores' ? 'CONTAM' : 'PARTIDAS' }))),
          el('tbody', null, ...linhas))) : null,
        semTxt) : null);
  }

  let tnMaisRes = null;       // torneio com a lista completa de resultados aberta
  function blocoResultados(t, ents, cls) {
    if (!ents.length) return null;
    const porJog = new Map(cls.map((l) => [l.chave, l]));
    const soma = t.formato !== 'melhor' && t.metrica !== 'massa';
    return el('section', { class: 'pp-sec', 'aria-label': 'Últimos resultados' },
      el('h2', { class: 'perfil-h3' }, 'ÚLTIMOS RESULTADOS ', el('span', { class: 'sec', text: fmt(ents.length) })),
      el('ul', { class: 'pp-hist' }, ...ents.slice(0, tnMaisRes === t.id ? 300 : 8).map((e) => {
        const conta = (porJog.get(e.k) || { contadas: new Set() }).contadas.has(e.id);
        const fonte = e.partida || e.lanc;
        const url = urlPrint(fonte);
        const detalhe = [diaTxt(e.quando), e.partida ? 'do ranking' : e.lanc.nota, t.metrica === 'pontos' ? `${fmt(e.bruto)} de massa` : null].filter(Boolean).join(' · ');
        return el('li', { class: `pp-hist-item ${conta ? '' : 'nao-conta'}` },
          url
            ? el('button', { type: 'button', class: 'mini', 'aria-label': `Ver print de ${e.nome}`, onclick: () => abrirPrintLivre(url, `${comTag(e.nome)} · ${valorTn(t, e.valor)} · ${t.nome}`) }, el('img', { src: url, alt: '', loading: 'lazy' }))
            : el('span', { class: 'mini' }, avatarDe(e.nome, ptsGeralDe(e.k), 'av-p')),
          el('div', { class: 'pp-hist-info' },
            el('span', { class: 'tn-res-nome' }, btnPerfil({ chave: e.k, nome: e.nome }, 'link-nome forte', e.nome), !conta ? el('span', { class: 'ex-chip', text: 'NÃO CONTA' }) : null),
            el('span', { class: 'partida-data', text: detalhe })),
          el('span', { class: 'pp-hist-pts', text: `${soma ? '+' : ''}${valorTn(t, e.valor)}` }),
          admin && e.lanc ? el('button', { type: 'button', class: 'apagar', 'aria-label': `Apagar resultado de ${e.nome}`, onclick: () => pedirApagarLanc(t, e) }, svg(ICONE_LIXO)) : null);
      })),
      ents.length > 8 && tnMaisRes !== t.id ? el('button', { type: 'button', class: 'btn btn-sec pp-mais', onclick: () => { tnMaisRes = t.id; renderTorneioPagina(); } }, `Ver todos os ${fmt(ents.length)} resultados`) : null,
      regraTn(t) === 'melhor' || t.formato === 'melhores' ? el('p', { class: 'form-nota tn-nota', text: '"Não conta" = partida que ficou fora das que valem pro torneio.' }) : null);
  }

  function blocoPremios(t, st, cls, rodadas) {
    if (!t.premios || !t.premios.some(Boolean)) return null;
    let ganhou = [];
    if (st === 'fim') {
      if (rodadas) {
        const fin = rodadas[rodadas.length - 1][0];
        const semi = rodadas.length > 1 ? rodadas[rodadas.length - 2].map((j) => (j.v && j.v === j.a ? j.b : j.a)).filter(Boolean) : [];
        ganhou = [fin.v ? nickId(fin.v) : null, fin.v ? nickId(fin.v === fin.a ? fin.b : fin.a) : null, semi.length ? semi.map(nickId).join(' e ') : null];
      } else ganhou = podioTn(t).map((p) => (p ? p.nome : null));
    }
    return el('section', { class: 'pp-sec', 'aria-label': 'Prêmios' },
      el('h2', { class: 'perfil-h3', text: 'PRÊMIOS' }),
      el('ol', { class: 'tn-premios-lista' }, ...t.premios.map((p, i) => (p ? el('li', { class: `tn-pr p${i + 1}` },
        el('span', { class: 'tn-pr-pos', text: `${i + 1}º` }),
        el('span', { class: 'tn-pr-txt' }, el('b', { text: p }), ganhou[i] ? el('span', { text: `ficou com ${ganhou[i]}` }) : null)) : null))));
  }

  // ---------- regras próprias: resultado escolhido pelo dono ----------
  const ROT_PODIO = ['CAMPEÃO', 'VICE', '3º LUGAR'];
  function blocoResultadoLivre(t, st) {
    const pod = podioTn(t);
    const eu = lerEu();
    return el('section', { class: 'pp-sec', 'aria-label': 'Resultado' },
      el('h2', { class: 'perfil-h3', text: 'RESULTADO' }),
      pod[0]
        ? el('div', { class: 'podio tn-podio' }, ...[1, 0, 2].filter((i) => pod[i]).map((i) => {
            const p = pod[i];
            return comParede(el('article', { class: `lugar l${i + 1}` },
              i === 0 ? svg(ICONE_TROFEU, 34, 'class="coroa"') : svg(ICONE_MEDALHA, 26, 'class="tn-med-ic"'),
              el('div', { class: 'avatar', 'aria-hidden': 'true', text: p.nome.charAt(0).toUpperCase() }),
              el('div', null,
                el('div', { class: 'lugar-pos', text: `${i + 1}º · ${ROT_PODIO[i]}` }),
                btnPerfil(p, 'lugar-nome', p.nome),
                p.chave === eu ? el('span', { class: 'chip', text: 'VOCÊ' }) : null),
              t.premios && t.premios[i] ? el('div', { class: 'cem-selo', text: t.premios[i] }) : null), p.chave);
          }))
        : el('p', { class: 'vazio', text: st === 'breve' ? 'O torneio ainda não começou. Lê as regras e se prepara!' : 'Valendo! Quando acabar, o dono do clã confere e o campeão e o vice aparecem aqui com troféu e medalha.' }));
  }
  // admin escolhe campeão, vice e 3º (pode ser depois do evento: já entrega o troféu e a medalha)
  function blocoEscolherPodio(t) {
    const atual = podioLivre(t);
    const ids = new Set([...idsInscritos(t), ...atual.filter(Boolean)]);
    const lista = [...ids].map((id) => jogPorId.get(id)).filter(Boolean).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
    const sels = [0, 1, 2].map((i) => el('select', { id: `tnPodio${i}`, 'aria-label': ROT_PODIO[i] },
      el('option', { value: '', text: i === 0 ? '— escolha —' : '— ninguém —' }),
      ...lista.map((r) => el('option', { value: r.id, text: r.nick, selected: atual[i] === r.id }))));
    const erro = el('p', { class: 'erro', role: 'alert', hidden: true });
    const salvar = async (podio) => {
      erro.hidden = true;
      try {
        await salvarTn(t, { podio });
        toast(podio.length ? `Pronto! ${nickId(podio[0])} levou o troféu${podio[1] ? ` e ${nickId(podio[1])} a medalha de vice` : ''}.` : 'Resultado apagado. O torneio voltou a valer.');
      } catch (e) {
        if (!erroSessao(e)) { erro.textContent = 'Não deu pra salvar agora. (' + (e.message || 'erro') + ')'; erro.hidden = false; }
      }
    };
    return el('section', { class: 'pp-sec tn-escolhe-podio', 'aria-label': 'Definir resultado' },
      el('h2', { class: 'perfil-h3' }, el('span', { class: 'admin-tag', text: 'ADMIN' }), ' DEFINIR RESULTADO'),
      el('form', { class: 'painel tn-podio-form', onsubmit: (ev) => {
        ev.preventDefault();
        const v = sels.map((s) => s.value);
        if (!v[0]) { erro.textContent = 'Escolhe pelo menos o campeão.'; erro.hidden = false; return; }
        if (!v[1] && v[2]) { erro.textContent = 'Escolhe o vice antes do 3º.'; erro.hidden = false; return; }
        const podio = v.filter(Boolean);
        if (new Set(podio).size !== podio.length) { erro.textContent = 'O mesmo jogador não pode ficar em dois lugares.'; erro.hidden = false; return; }
        salvar(podio);
      } },
        ...sels.map((s, i) => el('label', { class: `tn-premio p${i + 1}` }, el('span', { text: `${i + 1}º` }), s)),
        el('p', { class: 'form-nota', text: lista.length ? 'Salvou o campeão, o torneio encerra e o troféu (e a medalha do vice) aparece no perfil deles.' : 'Ninguém inscrito. Edite o torneio e escolha quem joga.' }),
        erro,
        el('div', { class: 'tn-podio-acoes' },
          atual[0] ? el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('APAGAR RESULTADO?', `O pódio de "${t.nome}" some e os troféus saem dos perfis.`, 'Apagar', () => salvar([])) }, 'Apagar resultado') : null,
          el('button', { type: 'submit', class: 'btn btn-pri' }, svg(ICONE_TROFEU, 18), atual[0] ? 'Salvar resultado' : 'Entregar troféus'))));
  }

  function blocoInscritos(t) {
    const ids = idsInscritos(t);
    return el('section', { class: 'pp-sec', 'aria-label': 'Quem joga' },
      el('h2', { class: 'perfil-h3' }, 'QUEM JOGA ', el('span', { class: 'sec', text: t.todos ? `o clã inteiro · ${ids.length}` : fmt(ids.length) })),
      ids.length
        ? el('div', { class: 'tn-inscritos' }, ...ids.slice(0, 64).map((id) => {
            const r = jogPorId.get(id);
            const k = chave(r.nick);
            return btnPerfil({ chave: k, nome: r.nick }, 'tn-insc', [avatarDe(r.nick, ptsGeralDe(k), 'av-p'), el('span', { text: r.nick })]);
          }), ids.length > 64 ? el('span', { class: 'mais', text: `+${ids.length - 64}` }) : null)
        : el('p', { class: 'sec', text: 'Ninguém inscrito ainda.' }));
  }

  // ---------- chave do mata-mata ----------
  function blocoChave(t, st, rodadas, eu) {
    if (!rodadas) {
      const n = idsInscritos(t).length;
      return el('section', { class: 'pp-sec', 'aria-label': 'Chave' },
        el('h2', { class: 'perfil-h3', text: 'CHAVE' }),
        el('div', { class: 'painel tn-chave-vazia' },
          el('p', { class: 'vazio', text: n < 2 ? 'O mata-mata precisa de pelo menos 2 jogadores inscritos.' : `${n} jogadores inscritos. A chave aparece aqui quando o dono montar.` }),
          admin && n >= 2 ? el('button', { type: 'button', class: 'btn btn-pri btn-grande', onclick: () => montarChaveTn(t) }, svg(ICONE_ESPADAS, 20), t.semente === 'sorteio' ? 'SORTEAR A CHAVE' : 'MONTAR A CHAVE PELO RANKING') : null));
    }
    const total = rodadas.length;
    const euR = eu ? elenco.get(eu) : null;
    const euId = euR ? euR.id : null;
    const cols = rodadas.map((jogos, r) => {
      const ultima = r === total - 1;
      const pares = [];
      for (let i = 0; i < jogos.length; i += 2) pares.push(jogos.slice(i, i + 2));
      return el('div', { class: `mm-rod ${ultima ? 'mm-final' : ''}` },
        el('div', { class: 'mm-rod-tit', text: nomeRodada(r, total) }),
        el('div', { class: 'mm-jogos' }, ...(ultima
          ? [el('div', { class: 'mm-dupla mm-unica' }, cartaoJogo(t, jogos[0], euId, total))]
          : pares.map((p) => el('div', { class: 'mm-dupla' }, ...p.map((j) => cartaoJogo(t, j, euId, total)))))));
    });
    const camp = rodadas[total - 1][0].v;
    cols.push(el('div', { class: 'mm-rod mm-camp-col' },
      el('div', { class: 'mm-rod-tit', text: 'CAMPEÃO' }),
      el('div', { class: 'mm-jogos' }, el('div', { class: `mm-campeao ${camp ? 'ok' : ''}` },
        svg(ICONE_COROA, 30),
        camp ? el('b', { text: nickId(camp) }) : el('span', { text: 'quem vai ser?' })))));
    const abertos = rodadas.flat().filter((j) => j.a && j.b && !j.v).length;
    return el('section', { class: 'pp-sec', 'aria-label': 'Chave' },
      el('h2', { class: 'perfil-h3' }, 'CHAVE ', el('span', { class: 'sec', text: camp ? '· encerrada' : `· ${abertos} ${abertos === 1 ? 'duelo' : 'duelos'} pra rolar` })),
      el('div', { class: 'painel tn-chave' },
        el('p', { class: 'dica-arrastar tn-dica', 'aria-hidden': 'true', text: 'Arraste pro lado pra ver a chave toda →' }),
        el('div', { class: 'mm' }, ...cols),
        el('p', { class: 'jog-nota', text: admin ? 'Toque num duelo pra lançar o resultado. Quem vence avança sozinho pra próxima rodada.' : 'Folga = passou direto pra próxima rodada.' })));
  }

  function cartaoJogo(t, j, euId, total) {
    const lado = (id, v) => {
      const ganhou = !!j.v && j.v === id;
      return el('div', { class: `mm-lado ${ganhou ? 'ganhou' : j.v && id ? 'perdeu' : ''} ${id && id === euId ? 'eu' : ''}` },
        id ? avatarDe(nickId(id), ptsGeralDe(chave(nickId(id))), 'av-p') : el('span', { class: 'av av-p mm-vazio', 'aria-hidden': 'true', text: '?' }),
        el('span', { class: 'mm-nome', text: id ? nickId(id) : j.bye ? 'folga' : 'a definir' }),
        el('span', { class: 'mm-val', text: v != null ? fmt(v) : ganhou && j.wo ? 'W.O.' : '' }));
    };
    const filhos = [lado(j.a, j.va), lado(j.b, j.vb)];
    const cls = `mm-jogo ${j.bye ? 'bye' : ''} ${j.v ? 'feito' : j.a && j.b ? 'aberto' : ''}`;
    if (admin && j.a && j.b && !j.bye) {
      return el('button', { type: 'button', class: cls, onclick: () => abrirDuelo(t, j, total), 'aria-label': `${nomeRodada(j.r, total)}: ${nickId(j.a)} contra ${nickId(j.b)}. Lançar resultado` }, ...filhos);
    }
    return el('div', { class: cls }, ...filhos);
  }

  function embaralhar(lista) {
    const a = [...lista];
    for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
    return a;
  }
  async function gravarChave(t, c) {
    if (DEMO) { const alvo = torneios.find((x) => x.id === t.id); if (alvo) alvo.chave = c; }
    else { await rpcAdmin('admin_salvar_chave', { p_id: t.id, p_chave: c }); await carregar(); }
    render();
  }
  async function montarChaveTn(t) {
    let ids = idsInscritos(t);
    if (ids.length < 2) { toast('Precisa de pelo menos 2 jogadores inscritos.', true); return; }
    if (ids.length > 64) { toast('O mata-mata aceita até 64 jogadores. Tira alguns da lista.', true); return; }
    if (t.semente === 'sorteio') ids = embaralhar(ids);
    else ids.sort((a, b) => ptsRankingDe(chave(nickId(b))) - ptsRankingDe(chave(nickId(a))) || nickId(a).localeCompare(nickId(b), 'pt-BR'));
    try {
      await gravarChave(t, { slots: montarSlots(ids), res: {}, em: new Date().toISOString() });
      toast(t.semente === 'sorteio' ? 'Chave sorteada! Boa sorte pra todos.' : 'Chave montada pelo ranking. Que vença o melhor!');
    } catch (e) {
      console.error(e);
      if (!erroSessao(e)) toast('Não deu pra salvar a chave. (' + (e.message || 'erro') + ')', true);
    }
  }

  // ---------- resultado de duelo (só admin) ----------
  let duelo = null;           // { t, j, total, v }
  function lerInteiro(txt) {
    const s = String(txt || '').replace(/[\s.]/g, '');
    if (!s) return { vazio: true };
    return /^\d{1,9}$/.test(s) ? { valor: parseInt(s, 10) } : { erro: true };
  }
  // massa aceita "52 mil"; o resto é número inteiro
  function lerValorTn(t, txt) {
    if (t.metrica !== 'massa') return lerInteiro(txt);
    const r = lerMassa(txt);
    if (r.vazio || r.erro) return r;
    if (r.decimal) return { erro: true };
    return { valor: r.valor };
  }
  function abrirDuelo(t, j, total) {
    duelo = { t, j, total, v: j.v };
    $('dueloRodada').textContent = `${t.nome} · ${nomeRodada(j.r, total)}`;
    const lado = (id, val, campo) => el('div', { class: 'duelo-lado', 'data-id': id },
      avatarDe(nickId(id), ptsGeralDe(chave(nickId(id))), 'av-m'),
      el('b', { class: 'duelo-nome', text: nickId(id) }),
      el('label', { class: 'duelo-rot', for: campo, text: rotMetrica(t) }),
      el('input', { id: campo, type: 'text', inputmode: t.metrica === 'massa' ? 'decimal' : 'numeric', autocomplete: 'off', placeholder: '—', value: val != null ? fmt(val) : null, oninput: autoVencedor }),
      el('button', { type: 'button', class: 'duelo-venceu', 'aria-pressed': 'false', onclick: () => { duelo.v = id; marcarVencedor(); } }, svg(ICONE_COROA, 16), 'Venceu'));
    trocar($('dueloLados'), lado(j.a, j.va, 'dueloVa'), el('span', { class: 'vs-x', text: '×' }), lado(j.b, j.vb, 'dueloVb'));
    $('dueloWo').checked = !!j.wo;
    $('btnLimparDuelo').hidden = !j.v;
    erroDuelo(null);
    marcarVencedor();
    $('dlgDuelo').showModal();
  }
  function autoVencedor() {
    if (!duelo) return;
    const a = lerValorTn(duelo.t, $('dueloVa').value), b = lerValorTn(duelo.t, $('dueloVb').value);
    if (a.valor != null && b.valor != null && a.valor !== b.valor) duelo.v = a.valor > b.valor ? duelo.j.a : duelo.j.b;
    marcarVencedor();
  }
  function marcarVencedor() {
    for (const n of $('dueloLados').querySelectorAll('.duelo-lado')) {
      const sim = n.dataset.id === duelo.v;
      n.classList.toggle('venc', sim);
      n.querySelector('.duelo-venceu').setAttribute('aria-pressed', String(sim));
    }
    const prox = duelo.j.r + 1 < duelo.total ? naRodada(duelo.j.r + 1, duelo.total).replace(/^na/, 'pra') : null;
    $('dueloNota').textContent = duelo.v
      ? (prox ? `${nickId(duelo.v)} vai ${prox}.` : `${nickId(duelo.v)} vira o CAMPEÃO.`)
      : 'Escreve o resultado de cada um (quem fizer mais vence) ou toque em quem venceu.';
  }
  function erroDuelo(msg) { $('erroDuelo').textContent = msg || ''; $('erroDuelo').hidden = !msg; }
  async function salvarDuelo(ev) {
    ev.preventDefault();
    if (!duelo) return;
    const { t, j } = duelo;
    const a = lerValorTn(t, $('dueloVa').value), b = lerValorTn(t, $('dueloVb').value);
    if (a.erro || b.erro) return erroDuelo('Só número no resultado. Ex: 12' + (t.metrica === 'massa' ? ' ou 52 mil' : '') + '.');
    if (!duelo.v) return erroDuelo('Toque em "Venceu" de quem ganhou o duelo.');
    if (!admin) return erroDuelo('Entre na área do admin.');
    const atual = torneios.find((x) => x.id === t.id);
    if (!atual || !atual.chave) return erroDuelo('A chave mudou. Fecha e abre de novo.');
    const c = { ...atual.chave, res: { ...(atual.chave.res || {}) } };
    c.res[j.id] = { a: j.a, b: j.b, va: a.valor ?? null, vb: b.valor ?? null, v: duelo.v, wo: $('dueloWo').checked };
    const btn = $('btnSalvarDuelo');
    btn.disabled = true;
    try {
      const venc = duelo.v;
      await gravarChave(atual, c);
      $('dlgDuelo').close();
      const camp = campeaoMata(torneios.find((x) => x.id === t.id) || atual);
      toast(camp === venc ? `👑 ${comTag(nickId(venc))} é o CAMPEÃO de ${t.nome}!` : `${comTag(nickId(venc))} venceu e avançou!`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgDuelo').close(); return; }
      erroDuelo('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }
  async function limparDuelo() {
    if (!duelo) return;
    const atual = torneios.find((x) => x.id === duelo.t.id);
    if (!atual || !atual.chave) return;
    const c = { ...atual.chave, res: { ...(atual.chave.res || {}) } };
    delete c.res[duelo.j.id];
    try {
      await gravarChave(atual, c);
      $('dlgDuelo').close();
      toast('Resultado apagado. O duelo voltou a ficar em aberto.');
    } catch (e) {
      if (erroSessao(e)) { $('dlgDuelo').close(); return; }
      erroDuelo('Não deu pra limpar agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- lançar resultado (kills, massa de partida especial...) ----------
  let arquivoLanc = null;
  function prepararLanc(t) {
    const insc = idsInscritos(t).map((id) => jogPorId.get(id));
    const porNome = (a, b) => a.nick.localeCompare(b.nick, 'pt-BR');
    const resto = t.todos ? [] : jogadores.filter((r) => r.ativo && !insc.includes(r)).sort(porNome);
    const sel = fl('lancJog');
    const antes = formLanc.dataset.torneio === t.id ? sel.value : '';
    trocar(sel,
      el('option', { value: '', text: 'Escolhe o jogador' }),
      el('optgroup', { label: t.todos ? 'Clã' : 'Inscritos' }, ...[...insc].sort(porNome).map((r) => el('option', { value: r.id, text: r.nick }))),
      resto.length ? el('optgroup', { label: 'Outros (entram no torneio)' }, ...resto.map((r) => el('option', { value: r.id, text: r.nick }))) : null);
    sel.value = [...sel.options].some((o) => o.value === antes) ? antes : '';
    if (formLanc.dataset.torneio !== t.id) {
      fl('lancValor').value = '';
      fl('lancNota').value = '';
      limparPrintLanc();
      erroLanc(null);
    }
    formLanc.dataset.torneio = t.id;
    const massa = t.metrica !== 'custom';
    fl('lancValorRot').textContent = massa ? 'MASSA DA PARTIDA' : `QUANTOS ${rotMetrica(t)}`;
    fl('lancValor').placeholder = massa ? 'ex: 52.430 ou 52 mil' : 'ex: 12';
    fl('lancValor').inputMode = massa ? 'decimal' : 'numeric';
    fl('lancSub').textContent = t.auto && massa
      ? 'As partidas registradas no ranking já entram sozinhas. Use aqui só pra resultado extra, que vale só no torneio.'
      : `Confere o print e escreve ${massa ? 'a massa' : `quantos ${nomeMetrica(t)}`} que o jogador fez. Vale só pro torneio, não mexe no ranking.`;
    mostrarLanc();
  }
  function lerLanc(t) {
    if (t.metrica === 'custom') return lerInteiro(fl('lancValor').value);
    return lerMassa(fl('lancValor').value);
  }
  function mostrarLanc() {
    const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
    if (!t) return;
    const r = lerLanc(t);
    const box = fl('lancLido');
    if (r.vazio) { box.textContent = ''; return; }
    if (r.erro) { box.textContent = 'Não entendi esse número.'; return; }
    if (r.decimal) { box.textContent = `Massa não tem vírgula. Era ${fmt(r.sugestao)}? Escreve "${fl('lancValor').value.trim()} mil".`; return; }
    const v = r.valor;
    box.textContent = t.metrica === 'custom' ? `Vai entrar: ${valorTn(t, v)}`
      : `Vai entrar: ${fmt(v)} de massa${t.metrica === 'pontos' ? ` = ${ptsTxt(pontosDe(v))} no torneio` : ''}${r.pequeno ? ` · só ${fmt(v)}? Se for ${fmt(r.sugestao)}, escreve "${fmt(v)} mil"` : ''}`;
  }
  function erroLanc(msg) { fl('erroLanc').textContent = msg || ''; fl('erroLanc').hidden = !msg; }
  function limparPrintLanc() { arquivoLanc = null; fl('lancPrint').value = ''; fl('lancPrintNome').textContent = ''; }

  // sobe a imagem no armazenamento (só admin logado consegue)
  async function subirPrint(blob, pasta) {
    const ext = blob.type === 'image/png' ? 'png' : blob.type === 'image/webp' ? 'webp' : 'jpg';
    const caminho = `${pasta}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    const up = await sb.storage.from(BUCKET).upload(caminho, blob, { contentType: blob.type || 'image/jpeg', upsert: false });
    if (up.error) {
      if (/row-level security|unauthorized|jwt/i.test(up.error.message)) { await sairAdmin(true); throw Object.assign(new Error('sessão'), { sessao: true }); }
      throw new Error('print: ' + up.error.message);
    }
    return caminho;
  }

  async function lancar(ev) {
    ev.preventDefault();
    const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
    if (!t) return;
    const id = fl('lancJog').value;
    const r = lerLanc(t);
    const massa = t.metrica !== 'custom';
    if (!id) return erroLanc('Escolhe o jogador.');
    if (r.vazio) return erroLanc(massa ? 'Escreve a massa da partida. Ex: 52430 ou 52 mil.' : `Escreve quantos ${nomeMetrica(t)} ele fez.`);
    if (r.erro || r.decimal || r.valor == null) return erroLanc('Não entendi o número.');
    if (massa && (r.valor < MASSA_MIN || r.valor > MASSA_MAX)) return erroLanc(`A massa tem que ficar entre ${fmt(MASSA_MIN)} e ${fmt(MASSA_MAX)}.`);
    if (!admin) return erroLanc('Entre na área do admin.');
    erroLanc(null);
    const btn = fl('btnLanc');
    btn.disabled = true;
    btn.textContent = 'LANÇANDO…';
    try {
      const nota = fl('lancNota').value.replace(/\s+/g, ' ').trim().slice(0, 80);
      let print_path = null, print_url = null;
      if (arquivoLanc) {
        const blob = await comprimir(arquivoLanc);
        if (DEMO) print_url = URL.createObjectURL(blob);
        else print_path = await subirPrint(blob, `torneios/${t.id}`);
      }
      if (DEMO) {
        lancamentos.unshift({ id: 'dl-' + Date.now(), torneio_id: t.id, player_id: id, valor: r.valor, nota, print_path: null, print_url, created_at: new Date().toISOString() });
        if (!t.todos && !t.participantes.includes(id)) t.participantes.push(id);
      } else {
        await rpcAdmin('admin_add_lancamento', { p_torneio: t.id, p_player: id, p_valor: r.valor, p_nota: nota, p_print_path: print_path });
        await carregar();
      }
      fl('lancValor').value = '';
      fl('lancNota').value = '';
      limparPrintLanc();
      render();
      const atual = torneios.find((x) => x.id === t.id) || t;
      const nick = nickId(id);
      const l = classificarTn(atual).find((x) => x.chave === chave(nick));
      const vale = t.metrica === 'pontos' ? pontosDe(r.valor) : r.valor;
      toast(`Lançado! ${comTag(nick)} ${valorTn(t, vale)}${l && l.qtd ? ` · agora em ${l.pos}º` : ''}.`);
      fl('lancValor').focus();
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      erroLanc('Não deu pra lançar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'LANÇAR';
    }
  }

  function pedirApagarLanc(t, e) {
    confirmar('APAGAR RESULTADO?', `${comTag(e.nome)} · ${valorTn(t, e.valor)} no torneio "${t.nome}" (${diaTxt(e.quando)}). Isso não pode ser desfeito.`, 'Apagar', async () => {
      try {
        if (DEMO) lancamentos = lancamentos.filter((l) => l.id !== e.lanc.id);
        else {
          const caminho = await rpcAdmin('admin_apagar_lancamento', { p_id: e.lanc.id });
          if (caminho) await sb.storage.from(BUCKET).remove([caminho]);
          await carregar();
        }
        render();
        toast('Resultado apagado.');
      } catch (err) {
        if (!erroSessao(err)) toast('Não deu pra apagar agora. Tenta de novo.', true);
      }
    });
  }

  // ---------- criar / editar torneio (só admin) ----------
  let editTn = null;          // torneio sendo editado (null = novo)
  let confirmaApagarTn = false;
  const tnEstado = { formato: 'soma', metrica: 'pontos', todos: true, sel: new Set() };
  const paraInput = (ms) => { const d = new Date(ms); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 16); };
  const doInput = (v) => (v ? new Date(v).getTime() : NaN); // "2026-10-20T20:00" = hora local
  function fimDaSemana(base = Date.now()) { const d = new Date(base); d.setDate(d.getDate() + ((7 - d.getDay()) % 7)); d.setHours(23, 59, 0, 0); return d.getTime(); }
  function dadosDe(t) {
    const { nome, formato, metrica, unidade, auto, qtd, meta, semente, inicio, fim, encerrado_em, todos, participantes, premios, regras, publicado } = t;
    return { nome, formato, metrica, unidade, auto, qtd, meta, semente, inicio, fim, encerrado_em, todos, participantes, premios, regras, publicado, base: baseDe(t), podio: (t.podio || []).filter(Boolean) };
  }
  async function salvarTn(t, mudancas) {
    const dados = { ...dadosDe(t), ...mudancas };
    if (DEMO) { const alvo = torneios.find((x) => x.id === t.id); if (alvo) Object.assign(alvo, dados); }
    else { await rpcAdmin('admin_salvar_torneio', { p_id: t.id, p_dados: dados }); await carregar(); }
    render();
  }

  function montarFormatos() {
    trocar($('tnFormatos'), Object.entries(FORMATOS).map(([id, f]) => el('button', {
      type: 'button', class: 'tn-formato', role: 'radio', 'data-formato': id, 'aria-checked': 'false',
      onclick: () => { tnEstado.formato = id; atualizarBuilder(); },
    }, el('span', { class: 'tn-formato-ic', 'aria-hidden': 'true' }, svg(f.icone, 22)), el('b', { text: f.nome }), el('span', { text: f.desc }))));
    trocar($('tnUnidadeSug'), ['kills', 'abates', 'vitórias', 'tops', 'mortes'].map((u) => el('button', {
      type: 'button', class: 'sug', text: u, onclick: () => { $('tnUnidade').value = u; atualizarBuilder(); },
    })));
  }

  function abrirBuilder(t = null) {
    editTn = t;
    confirmaApagarTn = false;
    const agora = new Date();
    agora.setSeconds(0, 0);
    tnEstado.formato = t ? t.formato : 'soma';
    tnEstado.metrica = t ? t.metrica : 'pontos';
    tnEstado.todos = t ? t.todos : true;
    tnEstado.sel = new Set(t ? (t.participantes || []).filter((id) => jogPorId.has(id)) : []);
    $('tituloTn').textContent = t ? 'EDITAR TORNEIO' : 'NOVO TORNEIO';
    $('btnSalvarTn').textContent = t ? 'Salvar' : 'Criar torneio';
    $('btnApagarTn').hidden = !t;
    $('btnApagarTn').textContent = 'Apagar';
    $('tnNome').value = t ? t.nome : '';
    $('tnUnidade').value = t ? t.unidade || '' : '';
    $('tnAuto').checked = t ? t.auto : true;
    $('tnQtd').value = t && t.qtd ? t.qtd : 3;
    $('tnMeta').value = t && t.meta ? fmt(t.meta) : '';
    $('tnSemente').value = t ? t.semente || 'ranking' : 'ranking';
    $('tnBase').value = t ? baseDe(t) : periodo === 'semana' || periodo === 'geral' ? periodo : 'mes';
    $('tnInicio').value = paraInput(t ? Date.parse(t.inicio) : agora.getTime());
    $('tnFim').value = t ? (t.fim ? paraInput(Date.parse(t.fim)) : '') : paraInput(fimDaSemana(agora.getTime() + 86400000));
    [1, 2, 3].forEach((i) => { $('tnPremio' + i).value = (t && t.premios && t.premios[i - 1]) || ''; });
    $('tnRegras').value = t ? t.regras || '' : '';
    $('tnPublicado').checked = t ? t.publicado : true;
    $('tnBuscaJog').value = '';
    erroTn(null);
    atualizarBuilder();
    $('dlgTorneio').showModal();
    $('dlgTorneio').querySelector('.tn-form-corpo').scrollTop = 0;
    // no celular não abre o teclado sozinho (deixa ver os formatos primeiro)
    if (!t && matchMedia('(pointer: fine)').matches) $('tnNome').focus({ preventScroll: true });
  }

  function atualizarBuilder() {
    const { formato, metrica, todos } = tnEstado;
    const mata = formato === 'mata';
    const hora = formato === 'hora', livre = formato === 'livre';
    // hora H só olha o ranking (pontos ou massa); regras próprias não tem métrica
    if (hora && metrica === 'custom') { tnEstado.metrica = 'pontos'; return atualizarBuilder(); }
    document.querySelectorAll('.tn-formato').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.formato === formato)));
    document.querySelectorAll('#tnMetricas [data-metrica]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.metrica === metrica)));
    document.querySelectorAll('#tnQuem [data-todos]').forEach((b) => b.setAttribute('aria-checked', String((b.dataset.todos === '1') === todos)));
    $('tnMetricaRot').textContent = mata ? 'O QUE DECIDE O DUELO' : hora ? 'QUAL RANKING VALE' : 'O QUE CONTA';
    $('tnMetricaBloco').hidden = livre;
    document.querySelector('#tnMetricas [data-metrica="custom"]').hidden = hora;
    $('tnBaseBox').hidden = !hora;
    $('tnUnidadeBox').hidden = metrica !== 'custom';
    $('tnAutoBox').hidden = mata || hora || metrica === 'custom';
    $('tnFimRot').textContent = hora ? 'HORA H (VALE O 1º DESSA HORA)' : livre ? 'TERMINA (OPCIONAL)' : 'TERMINA';
    $('tnRegrasRot').replaceChildren(livre ? 'REGRAS DO TORNEIO ' : 'REGRAS EXTRAS ', el('span', { class: 'sec', text: livre ? '(obrigatório: explica como ganha)' : '(opcional)' }));
    $('tnRegras').placeholder = livre ? 'ex: às 21h quem estiver em 1º na sala do clã é o campeão. Vale print com o horário.' : 'ex: só vale print com o nick visível. Partida em sala lotada.';
    $('tnQtdBox').hidden = formato !== 'melhores';
    $('tnMetaBox').hidden = formato !== 'meta';
    $('tnSementeBox').hidden = !mata;
    $('tnEscolherBox').hidden = todos;
    $('tnMeta').placeholder = metrica === 'massa' ? 'ex: 500 mil' : metrica === 'pontos' ? 'ex: 1000' : 'ex: 50';
    const meta = lerMetaBuilder();
    $('tnMetaLida').textContent = formato === 'meta' && meta ? `Meta: ${valorTn({ metrica, unidade: $('tnUnidade').value }, meta)}` : '';
    renderAtalhosData();
    renderEscolher();
    renderResumoBuilder();
  }

  function lerMetaBuilder() {
    const txt = $('tnMeta').value;
    if (tnEstado.metrica === 'massa') { const r = lerMassa(txt); return r.valor > 0 ? Math.min(r.valor, 100000000) : null; }
    const r = lerInteiro(txt);
    return r.valor > 0 ? Math.min(r.valor, 100000000) : null;
  }

  function renderAtalhosData() {
    const ini = doInput($('tnInicio').value);
    const base = isFinite(ini) ? ini : Date.now();
    const fimEm = (ms) => { $('tnFim').value = paraInput(ms); };
    const ops = [
      ['Começa agora', () => { const d = new Date(); d.setSeconds(0, 0); $('tnInicio').value = paraInput(d.getTime()); }],
      ['Até domingo', () => fimEm(fimDaSemana(base + 3600000))],
      ['7 dias', () => fimEm(base + 7 * 86400000)],
      ['15 dias', () => fimEm(base + 15 * 86400000)],
      ['Até o fim do mês', () => { const d = new Date(base); fimEm(new Date(d.getFullYear(), d.getMonth() + 1, 0, 23, 59).getTime()); }],
      tnEstado.formato === 'mata' || tnEstado.formato === 'livre' ? ['Sem data pra acabar', () => { $('tnFim').value = ''; }] : null,
    ].filter(Boolean);
    if (tnEstado.formato === 'hora') {
      const hj = (h) => { const d = new Date(); d.setHours(h, 0, 0, 0); return d.getTime(); };
      ops.splice(1, ops.length,
        ['Daqui 1 hora', () => { const d = new Date(); d.setSeconds(0, 0); fimEm(d.getTime() + 3600000); }],
        ['Hoje às 21h', () => fimEm(hj(21))],
        ['Hoje às 23h', () => fimEm(hj(23))],
        ['Domingo 23:59', () => fimEm(fimDaSemana(base + 3600000))]);
    }
    trocar($('tnAtalhosData'), ops.map(([rot, f]) => el('button', { type: 'button', class: 'sug', text: rot, onclick: () => { f(); atualizarBuilder(); } })));
  }

  function renderEscolher() {
    if (tnEstado.todos) return;
    const q = busca($('tnBuscaJog').value);
    const lista = jogadores.filter((r) => r.ativo || tnEstado.sel.has(r.id))
      .filter((r) => !q || busca(r.nick).includes(q))
      .sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
    trocar($('tnListaJog'), lista.length
      ? lista.map((r) => el('button', {
          type: 'button', class: 'tn-jog', 'aria-pressed': String(tnEstado.sel.has(r.id)),
          onclick: (e) => {
            if (tnEstado.sel.has(r.id)) tnEstado.sel.delete(r.id); else tnEstado.sel.add(r.id);
            e.currentTarget.setAttribute('aria-pressed', String(tnEstado.sel.has(r.id)));
            contarSel();
            renderResumoBuilder();
          },
        }, avatarDe(r.nick, ptsGeralDe(chave(r.nick)), 'av-p'), r.nick))
      : el('span', { class: 'sec', text: jogadores.length ? 'Ninguém com esse nome.' : 'Cadastre o elenco em "Jogadores do clã" primeiro.' }));
    contarSel();
  }
  function contarSel() {
    const n = tnEstado.sel.size;
    $('tnQtdSel').textContent = n ? `${n} ${n === 1 ? 'jogador escolhido' : 'jogadores escolhidos'}` : 'Toque nos jogadores que vão jogar.';
  }

  // o torneio do jeito que está no formulário (pra mostrar o resumo antes de salvar)
  function tnDoForm() {
    const ini = doInput($('tnInicio').value), fim = doInput($('tnFim').value);
    return {
      id: editTn ? editTn.id : '', formato: tnEstado.formato, metrica: tnEstado.metrica, unidade: $('tnUnidade').value.trim(),
      auto: $('tnAuto').checked, qtd: parseInt($('tnQtd').value, 10) || 3, meta: lerMetaBuilder(), semente: $('tnSemente').value, base: $('tnBase').value, podio: [],
      inicio: new Date(isFinite(ini) ? ini : Date.now()).toISOString(), fim: isFinite(fim) ? new Date(fim).toISOString() : null,
      todos: tnEstado.todos, participantes: [...tnEstado.sel], premios: [], regras: $('tnRegras').value.trim(), publicado: true, chave: null,
    };
  }
  function renderResumoBuilder() {
    const t = tnDoForm();
    const ini = Date.parse(t.inicio), fim = t.fim ? Date.parse(t.fim) : null;
    const dur = fim && fim > ini ? Math.round((fim - ini) / 3600000) : 0;
    const durTxt = !fim ? 'sem data pra acabar' : dur < 1 ? null : dur < 48 ? `dura ${dur} h` : `dura ${Math.round(dur / 24)} dias`;
    trocar($('tnResumo'),
      el('b', { text: 'COMO VAI FUNCIONAR' }),
      el('ul', null, ...resumoTn(t).map((x) => el('li', { text: x })),
        el('li', { text: `${fim && fim <= ini ? 'Atenção: o fim está antes do começo.' : `${periodoTn(t)}${durTxt ? ` (${durTxt})` : ''}.`}` })));
  }

  function erroTn(msg) { $('erroTn').textContent = msg || ''; $('erroTn').hidden = !msg; }
  function lerBuilder() {
    const { formato, metrica, todos, sel } = tnEstado;
    const nome = $('tnNome').value.replace(/\s+/g, ' ').trim();
    if (!nome) return { erro: 'Dá um nome pro torneio.', campo: 'tnNome' };
    const unidade = $('tnUnidade').value.replace(/\s+/g, ' ').trim().slice(0, 20);
    if (metrica === 'custom' && formato !== 'livre' && !unidade) return { erro: 'Escreve o que vai ser contado (ex: kills).', campo: 'tnUnidade' };
    const qtd = parseInt($('tnQtd').value, 10);
    if (formato === 'melhores' && !(qtd >= 1 && qtd <= 100)) return { erro: 'Quantas partidas contam? De 1 a 100.', campo: 'tnQtd' };
    const meta = lerMetaBuilder();
    if (formato === 'meta' && !meta) return { erro: 'Escreve a meta da corrida.', campo: 'tnMeta' };
    const ini = doInput($('tnInicio').value);
    if (!isFinite(ini)) return { erro: 'Escolhe quando o torneio começa.', campo: 'tnInicio' };
    const fim = doInput($('tnFim').value);
    if (!$('tnFim').value && formato === 'hora') return { erro: 'Escolhe a hora H: quem estiver em 1º nessa hora é o campeão.', campo: 'tnFim' };
    if (!$('tnFim').value && formato !== 'mata' && formato !== 'livre') return { erro: 'Escolhe quando o torneio termina.', campo: 'tnFim' };
    if (formato === 'livre' && !$('tnRegras').value.trim()) return { erro: 'Escreve as regras: como se ganha esse torneio?', campo: 'tnRegras' };
    if ($('tnFim').value && !(fim > ini)) return { erro: 'O fim tem que ser depois do começo.', campo: 'tnFim' };
    const ids = [...sel].filter((id) => jogPorId.has(id));
    if (!todos && ids.length < (formato === 'mata' ? 2 : 1)) return { erro: formato === 'mata' ? 'Escolhe pelo menos 2 jogadores pro mata-mata.' : 'Escolhe quem vai jogar.', campo: 'tnBuscaJog' };
    const qtdJog = todos ? jogadores.filter((r) => r.ativo).length : ids.length;
    if (formato === 'mata' && qtdJog > 64) return { erro: `O mata-mata aceita até 64 jogadores (tem ${qtdJog}). Escolhe quem joga.` };
    if (ids.length > 256) return { erro: 'No máximo 256 jogadores escolhidos.' };
    const premios = [1, 2, 3].map((i) => $('tnPremio' + i).value.replace(/\s+/g, ' ').trim().slice(0, 60));
    while (premios.length && !premios[premios.length - 1]) premios.pop();
    return { dados: {
      nome: nome.slice(0, 60), formato, metrica: formato === 'livre' ? 'pontos' : metrica, unidade: metrica === 'custom' && formato !== 'livre' ? unidade : '',
      auto: formato === 'hora' || (formato !== 'mata' && formato !== 'livre' && metrica !== 'custom' && $('tnAuto').checked),
      base: BASES[$('tnBase').value] ? $('tnBase').value : 'geral', podio: editTn ? (editTn.podio || []).filter(Boolean) : [],
      qtd: formato === 'melhores' ? qtd : null, meta: formato === 'meta' ? meta : null,
      semente: $('tnSemente').value === 'sorteio' ? 'sorteio' : 'ranking',
      inicio: new Date(ini).toISOString(), fim: $('tnFim').value ? new Date(fim).toISOString() : null,
      encerrado_em: editTn ? editTn.encerrado_em || null : null,
      todos, participantes: ids, premios, regras: $('tnRegras').value.trim().slice(0, 2000), publicado: $('tnPublicado').checked,
    } };
  }

  async function salvarBuilder(ev) {
    ev.preventDefault();
    const r = lerBuilder();
    if (r.erro) { erroTn(r.erro); if (r.campo) $(r.campo).focus(); return; }
    if (!admin) return erroTn('Entre na área do admin.');
    erroTn(null);
    const btn = $('btnSalvarTn');
    btn.disabled = true;
    try {
      let id;
      if (DEMO) {
        if (editTn) { id = editTn.id; Object.assign(torneios.find((x) => x.id === id), r.dados); }
        else { id = 'dt-' + Date.now(); torneios.unshift({ id, ...r.dados, chave: null, created_at: new Date().toISOString() }); }
      } else {
        id = await rpcAdmin('admin_salvar_torneio', { p_id: editTn ? editTn.id : null, p_dados: r.dados });
        if (!id) throw new Error('torneio não encontrado');
        await carregar();
      }
      const novo = !editTn;
      $('dlgTorneio').close();
      render();
      if (novo) abrirTorneio(id);
      toast(novo ? (r.dados.publicado ? 'Torneio criado! Manda no grupo pelo botão "Mandar no grupo".' : 'Rascunho salvo. Só admin vê até você publicar.') : 'Torneio atualizado.');
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgTorneio').close(); return; }
      erroTn('Não deu pra salvar agora. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
    }
  }

  async function apagarTn() {
    const t = editTn;
    if (!t) return;
    if (!confirmaApagarTn) { confirmaApagarTn = true; $('btnApagarTn').textContent = 'Toque de novo pra apagar'; return; }
    try {
      if (DEMO) {
        torneios = torneios.filter((x) => x.id !== t.id);
        lancamentos = lancamentos.filter((l) => l.torneio_id !== t.id);
      } else {
        const caminhos = await rpcAdmin('admin_apagar_torneio', { p_id: t.id });
        if (caminhos && caminhos.length) await sb.storage.from(BUCKET).remove(caminhos);
        await carregar();
      }
      $('dlgTorneio').close();
      if (torneioAtual === t.id) { history.replaceState({}, '', location.pathname + '#torneios'); mostrarRota(); }
      render();
      toast(`Torneio "${t.nome}" apagado.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgTorneio').close(); return; }
      erroTn('Não deu pra apagar agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- torneios no perfil do jogador ----------
  function torneiosDoJogador(k) {
    const r = elenco.get(k);
    const out = [];
    for (const t of torneiosVisiveis()) {
      if (!t.publicado) continue;
      const st = statusTn(t);
      if (t.formato === 'mata') {
        const rs = rodadasMata(t);
        const lg = rs && r ? lugarMata(rs, r.id) : null;
        if (!lg) continue;
        out.push({ t, st, pos: lg.pos, txt: lg.txt });
      } else if (t.formato === 'livre') {
        const i = r ? podioLivre(t).indexOf(r.id) : -1;
        const insc = r && idsInscritos(t).includes(r.id);
        if (i < 0 && !(insc && st !== 'fim')) continue;
        out.push({ t, st, pos: i + 1, txt: i >= 0 ? ['Campeão', 'Vice-campeão', '3º lugar'][i] : 'Inscrito · regras próprias' });
      } else {
        const cls = classificarTn(t);
        const l = cls.find((x) => x.chave === k);
        if (!l || !l.qtd) continue;
        out.push({ t, st, pos: l.pos, txt: `${l.pos}º de ${cls.filter((x) => x.qtd).length} · ${valorTn(t, l.total)}` });
      }
    }
    const peso = { vivo: 0, breve: 1, fim: 2 };
    return out.sort((a, b) => peso[a.st] - peso[b.st] || Date.parse(b.t.inicio) - Date.parse(a.t.inicio));
  }
  function secaoTorneiosPerfil(k) {
    const lista = torneiosDoJogador(k);
    const premios = trofeusDe(k);
    if (!lista.length && !premios.length) return null;
    // estante: um troféu por título e uma medalha de prata por vice
    const estante = premios.length ? el('ul', { class: 'tnt-estante', 'aria-label': 'Troféus e medalhas de torneio' }, ...premios.map(({ t, pos }) => el('li', null,
      linkTn(t, `tnt-item tnt-p${pos}`,
        el('span', { class: 'tnt-ic', 'aria-hidden': 'true' }, svg(pos === 1 ? ICONE_TROFEU : ICONE_MEDALHA, 30)),
        el('b', { class: 'tnt-rot', text: pos === 1 ? 'CAMPEÃO' : 'VICE' }),
        el('span', { class: 'tnt-nome', text: t.nome }))))) : null;
    const v = vitoriasTorneio(k), p = vicesTorneio(k);
    const conta = [v ? `${v} ${v === 1 ? 'troféu' : 'troféus'}` : null, p ? `${p} ${p === 1 ? 'medalha' : 'medalhas'} de vice` : null].filter(Boolean).join(' · ');
    return el('section', { class: 'pp-sec', 'aria-labelledby': 'ppTn' },
      el('h2', { class: 'perfil-h3', id: 'ppTn' }, 'TORNEIOS ', el('span', { class: 'sec', text: conta || fmt(lista.length) })),
      estante,
      lista.length ? el('ul', { class: 'pp-tns' }, ...lista.map(({ t, st, pos, txt }) => {
        const ganhou = pos === 1 && st === 'fim';
        const vice = pos === 2 && st === 'fim';
        return el('li', null, linkTn(t, `pp-tn ${ganhou ? 'campeao' : vice ? 'vice' : ''}`,
          el('span', { class: `pp-tn-pos p${pos}` }, ganhou ? svg(ICONE_TROFEU, 20) : vice ? svg(ICONE_MEDALHA, 20) : pos ? `${pos}º` : '–'),
          el('span', { class: 'pp-tn-info' }, el('b', { text: t.nome }), el('span', { text: ganhou && !/^Campeão/.test(txt) ? `Campeão · ${txt}` : vice && !/^Vice/.test(txt) ? `Vice-campeão · ${txt}` : txt })),
          pilulaStatus(t, st)));
      })) : null);
  }

  // ---------- print ----------
  function abrirPrintLivre(url, legenda) {
    $('imgPrint').src = url;
    $('legendaPrint').textContent = legenda;
    $('dlgPrint').showModal();
  }
  function abrirPrint(p) {
    const url = urlPrint(p);
    if (!url) return;
    $('imgPrint').src = url;
    $('legendaPrint').textContent = `${comTag(limparNick(p.player))} · ${fmt(p.mass)} de massa · ${new Date(p.created_at).toLocaleDateString('pt-BR')}`;
    $('dlgPrint').showModal();
  }

  async function comprimir(arquivo) {
    try {
      const bmp = await createImageBitmap(arquivo);
      const max = 1400;
      const esc = Math.min(1, max / Math.max(bmp.width, bmp.height));
      const c = document.createElement('canvas');
      c.width = Math.round(bmp.width * esc);
      c.height = Math.round(bmp.height * esc);
      c.getContext('2d').drawImage(bmp, 0, 0, c.width, c.height);
      const blob = await new Promise((r) => c.toBlob(r, 'image/jpeg', 0.85));
      return blob || arquivo;
    } catch (e) {
      return arquivo;
    }
  }

  function escolherArquivo(f) {
    if (!f) return;
    if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { mostrarErro('O print precisa ser uma imagem PNG, JPG ou WEBP.'); return; }
    if (f.size > 15 * 1024 * 1024) { mostrarErro('Essa imagem é grande demais (máximo 15 MB).'); return; }
    arquivoPrint = f;
    const prev = $('previaPrint');
    if (prev.dataset.url) URL.revokeObjectURL(prev.dataset.url);
    prev.dataset.url = URL.createObjectURL(f);
    prev.src = prev.dataset.url;
    prev.hidden = false;
    $('txtPrint').hidden = true;
    mostrarErro(null);
  }

  // ---------- registrar ----------
  function mostrarErro(msg) {
    const e = $('erroForm');
    e.textContent = msg || '';
    e.hidden = !msg;
  }

  async function enviar(ev) {
    ev.preventDefault();
    const nome = limparNick($('fNome').value);
    const lida = lerMassa($('fMassa').value);
    const massa = lida.valor;
    if (!nome) return mostrarErro('Escreve o nick do jogador.');
    if (lida.vazio) return mostrarErro('Escreve a massa final da partida. Ex: 52430 ou 52 mil.');
    if (lida.erro) return mostrarErro('Não entendi a massa. Escreve só o número (52430) ou com "mil" (52 mil).');
    if (lida.decimal) return mostrarErro(`Massa não tem vírgula. Se for ${fmt(lida.sugestao)}, toque em × MIL.`);
    if (massa < MASSA_MIN) return mostrarErro(lida.sugestao ? `Massa baixa demais. Se for ${fmt(lida.sugestao)}, toque em × MIL.` : 'Escreve a massa final da partida. Ex: 52430 ou 52 mil.');
    if (massa > MASSA_MAX) return mostrarErro(`Massa acima de ${fmt(MASSA_MAX)}? Confere o número.`);
    if (lida.pequeno && confirmarPequena !== massa) {
      confirmarPequena = massa;
      return mostrarErro(`Só ${fmt(massa)} de massa? Se for ${fmt(lida.sugestao)}, toque em × MIL. Se for ${fmt(massa)} mesmo, toque em COLOCAR NO RANKING de novo.`);
    }
    if (PRINT_OBRIGATORIO && !arquivoPrint) return mostrarErro('Escolhe o print da partida. Ele é a prova da massa.');
    if (!admin) return mostrarErro('Entre na área do admin para registrar.');
    mostrarErro(null);

    const btn = $('btnEnviar');
    btn.disabled = true;
    btn.textContent = 'ENVIANDO…';
    try {
      // quem era o 1º antes deste envio
      const reiAntes = montarRanking('geral')[0];
      const ptsAntes = ptsPat(chave(nome));
      const jogNovo = elencoOk && !elenco.has(chave(nome));
      let print_path = null;
      let print_url = null;
      if (arquivoPrint) {
        const blob = await comprimir(arquivoPrint);
        if (DEMO) {
          print_url = URL.createObjectURL(blob);
        } else {
          print_path = await subirPrint(blob, new Date().toISOString().slice(0, 10));
        }
      }
      if (DEMO) {
        partidas.unshift({ id: 'demo-' + Date.now(), player: nome, mass: massa, print_path: null, print_url, created_at: new Date().toISOString() });
        const r = elenco.get(chave(nome));
        if (r) r.ativo = true;
        else jogadores.push({ id: 'dj-' + Date.now(), nick: nome, cargo: CARGO_PADRAO, ativo: true, created_at: new Date().toISOString() });
        indexarElenco();
      } else {
        await rpcAdmin('admin_add_score', { p_player: nome, p_mass: massa, p_print_path: print_path });
        await carregar();
      }
      $('fNome').value = '';
      $('fMassa').value = '';
      arquivoPrint = null;
      $('fPrint').value = '';
      $('previaPrint').hidden = true;
      $('txtPrint').hidden = false;
      render();
      const reiAgora = montarRanking('geral')[0];
      const ganhou = (pontosDe(massa) ? ` +${ptsTxt(pontosDe(massa))}.` : '') + (jogNovo ? ' Novo no elenco do clã!' : '');
      const ptsDepois = ptsPat(chave(nome));
      const patAntes = patenteDe(ptsAntes).atual, patDepois = patenteDe(ptsDepois).atual;
      if (patDepois.nivel > patAntes.nivel) {
        toast(`${patDepois.diamante ? '💎' : '⬆'} ${comTag(nome)} subiu pra ${patDepois.nome.toUpperCase()}!${ganhou}`);
        if (patDepois.diamante) abrirDiamante(chave(nome), true);
      } else if (reiAgora && chave(reiAgora.nome) === chave(nome) && (!reiAntes || chave(reiAntes.nome) !== chave(nome))) {
        toast(`👑 ${comTag(nome)} agora é o REI DO CLÃ!${ganhou}`);
      } else if (massa >= MARCO) {
        toast(`🔥 ${comTag(nome)} fez ${marcoTxt}!${ganhou}`);
      } else {
        const pos = montarRanking(periodo).findIndex((j) => j.chave === chave(nome)) + 1;
        toast(`Registrado!${ganhou} ${comTag(nome)} está em ${pos}º lugar.`);
      }
      confirmarPequena = null;
      mostrarMassa();
      $('avisoNick').textContent = '';
      renderSugNick();
      $('fNome').focus();
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) return;
      mostrarErro('Não deu pra enviar agora. Confere a internet e tenta de novo. (' + (e.message || 'erro') + ')');
    } finally {
      btn.disabled = false;
      btn.textContent = 'COLOCAR NO RANKING';
    }
  }

  // ---------- admin (login com e-mail e senha, pelo Supabase Auth) ----------
  // Quem decide se a conta é admin é o banco (tabela admins): cada função de
  // registrar/apagar confere de novo lá. O site só mostra ou esconde os botões.
  function aplicarAdmin(novo) {
    admin = novo;
    if (!admin) logins = new Map();
    $('btnAdmin').textContent = admin ? `Sair da área do admin (${admin.nome})` : 'Área do admin';
    render();
    if (admin) carregarLogins();
  }

  // chama uma função de admin no banco; se a sessão caiu, sai do modo admin
  async function rpcAdmin(nome, args) {
    const r = await sb.rpc(nome, args);
    if (r.error) {
      if (r.error.code === '42501' || /jwt|permission denied|acesso negado/i.test(r.error.message)) {
        await sairAdmin(true);
        throw Object.assign(new Error('sessão de admin acabou'), { sessao: true });
      }
      throw new Error(r.error.message);
    }
    return r.data;
  }
  function erroSessao(e) {
    if (!e || !e.sessao) return false;
    toast('Sua sessão de admin acabou. Entre de novo.', true);
    return true;
  }

  // janela de "tem certeza?" (apagar partida, apagar resultado, encerrar torneio...)
  let acaoConfirma = null;
  function confirmar(titulo, texto, botao, acao) {
    $('tituloConfirma').textContent = titulo;
    $('txtConfirma').textContent = texto;
    $('btnSimApagar').textContent = botao;
    acaoConfirma = acao;
    $('dlgConfirma').showModal();
  }
  function confirmou() {
    const acao = acaoConfirma;
    acaoConfirma = null;
    $('dlgConfirma').close();
    if (acao) acao();
  }

  function pedirApagar(p) {
    confirmar('APAGAR PONTUAÇÃO?', `${comTag(limparNick(p.player))} · ${fmt(p.mass)} de massa (${diaTxt(p.created_at)}). Isso não pode ser desfeito.`, 'Apagar', () => apagarPartida(p.id));
  }

  async function apagarPartida(id) {
    if (!id) return;
    try {
      if (DEMO) {
        partidas = partidas.filter((p) => p.id !== id);
      } else {
        const caminho = await rpcAdmin('admin_delete_score', { p_id: id });
        // apaga o print junto pra não sobrar imagem perdida no armazenamento
        if (caminho) await sb.storage.from(BUCKET).remove([caminho]);
        await carregar();
      }
      render();
      toast('Pontuação apagada.');
    } catch (e) {
      if (!erroSessao(e)) toast('Não deu pra apagar agora. Tenta de novo.', true);
    }
  }

  async function sairAdmin(silencioso = false) {
    const era = admin;
    await sairDaConta();
    if (era && !silencioso) toast('Você saiu da área do admin.');
  }

  // ---------- portão: o site é só pra membro do clã logado ----------
  // Sem login (ou com a conta esperando aprovação) aparece só a tela de entrada.
  // Quem fecha de verdade é o banco: visitante e conta sem nick não leem nada (passo 5e do SQL).
  let siteAberto = false;   // já carregou os dados e ligou o tempo real uma vez
  const podeVer = () => !!admin || !!euId;
  function trancar(estado) {
    const st = estado || (meuPedido ? 'pedido' : contaSemJogador ? 'sem-nick' : 'visitante');
    document.body.classList.add('trancado');
    $('portao').hidden = false;
    $('portao').dataset.estado = st;
    $('portaoTxt').replaceChildren(...({
      carregando: ['Carregando…'],
      visitante: ['O ranking do clã é só pra membros. Entre ou crie a sua conta.'],
      'sem-nick': ['Falta escolher o seu nick no clã.'],
      pedido: ['Pedido enviado: ', el('b', { text: comTag(meuPedido || '') }), '. Um admin do clã vai aprovar e aí você entra.'],
    })[st]);
    document.querySelectorAll('#portao [data-portao]').forEach((b) => { b.hidden = !b.dataset.portao.split(' ').includes(st); });
    montarEscadaPortao();
    ligarFundo();
  }
  function destrancar() {
    document.body.classList.remove('trancado');
    $('portao').hidden = true;
    pararFundo();
  }

  // escudos das patentes, crescendo até Diamantes (vitrine do que dá pra conquistar)
  function montarEscadaPortao() {
    const box = $('portaoPatentes');
    if (box.childElementCount) return;
    const lista = PATENTES.filter((p) => p.nivel > 0);
    lista.forEach((p, i) => {
      const tam = Math.round(34 + 30 * (i / Math.max(1, lista.length - 1)));
      const a = el('span', { class: `av av-esc ${i >= lista.length - 2 ? 'av-g' : 'av-m'} ${p.diamante ? 'esc-dia' : ''}`, title: p.nome,
        style: `--pc:${p.cor};width:${tam}px;height:${tam}px;animation-delay:${(.45 + i * .09).toFixed(2)}s` });
      a.innerHTML = escudoSVG(p, '');
      box.append(a);
    });
    const ult = lista[lista.length - 1];
    $('portaoEscada').replaceChildren(`DE ${lista[0].nome.toUpperCase()} A `, el('b', { text: ult.nome.toUpperCase() }));
  }

  // ---------- fundo do portão: cobras neon deslizando (estilo slither.io) ----------
  const fundo = { raf: 0, ctx: null, w: 0, h: 0, cobras: [], comida: [], sprites: {} };
  const CORES_COBRA = [['#FF7A1A', '#B34A06'], ['#FFD84D', '#B88A12'], ['#FF3B4A', '#9E1622'], ['#C6A8FF', '#6E4FC2'], ['#7DF9FF', '#2A8FA8'], ['#FFB347', '#A8620F']];
  const quieto = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function medirFundo() {
    const cv = $('portaoFundo');
    const dpr = Math.min(devicePixelRatio || 1, 2);
    fundo.w = innerWidth;
    fundo.h = innerHeight;
    cv.width = Math.round(fundo.w * dpr);
    cv.height = Math.round(fundo.h * dpr);
    fundo.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  // bolinha de comida brilhando, desenhada uma vez por cor
  function spriteComida(cor) {
    if (fundo.sprites[cor]) return fundo.sprites[cor];
    const c = document.createElement('canvas');
    c.width = c.height = 32;
    const g = c.getContext('2d');
    const rg = g.createRadialGradient(16, 16, 0, 16, 16, 16);
    rg.addColorStop(0, '#FFFFFF');
    rg.addColorStop(.18, cor);
    rg.addColorStop(.45, cor + '55');
    rg.addColorStop(1, cor + '00');
    g.fillStyle = rg;
    g.fillRect(0, 0, 32, 32);
    return (fundo.sprites[cor] = c);
  }
  function novaComida() {
    const cor = CORES_COBRA[Math.floor(Math.random() * CORES_COBRA.length)][0];
    return { x: Math.random() * fundo.w, y: Math.random() * fundo.h, r: 2 + Math.random() * 3, fase: Math.random() * 6.3, img: spriteComida(cor) };
  }
  function novaCobra(i) {
    const [cor, escura] = CORES_COBRA[i % CORES_COBRA.length];
    const x = Math.random() * fundo.w, y = Math.random() * fundo.h, a = Math.random() * Math.PI * 2;
    const vel = 1.3 + Math.random() * 1.3;
    const corpo = Array.from({ length: Math.round(70 + Math.random() * 110) }, (_, k) => ({ x: x - Math.cos(a) * k * vel, y: y - Math.sin(a) * k * vel }));
    return { cor, escura, r: 5 + Math.random() * 6, a, vel, giro: 0, t: Math.random() * 100, corpo };
  }
  function passoFundo() {
    const { w, h } = fundo;
    for (const c of fundo.cobras) {
      const cab = c.corpo[0];
      const m = 160;
      c.t += .016;
      if (cab.x < -m || cab.x > w + m || cab.y < -m || cab.y > h + m) {
        // saiu da tela: faz a curva e volta
        const d = Math.atan2(h / 2 - cab.y, w / 2 - cab.x) - c.a;
        c.a += Math.atan2(Math.sin(d), Math.cos(d)) * .05;
      } else {
        c.giro = Math.max(-.045, Math.min(.045, (c.giro + (Math.random() - .5) * .018) * .97));
        c.a += c.giro + Math.sin(c.t * 1.4) * .01;
      }
      c.corpo.unshift({ x: cab.x + Math.cos(c.a) * c.vel, y: cab.y + Math.sin(c.a) * c.vel });
      c.corpo.pop();
      // come a comida que passa perto da cabeça
      for (const f of fundo.comida) {
        if (Math.abs(f.x - cab.x) < c.r + 6 && Math.abs(f.y - cab.y) < c.r + 6) Object.assign(f, novaComida());
      }
    }
  }
  function desenharFundo() {
    const { ctx, w, h } = fundo;
    ctx.clearRect(0, 0, w, h);
    ctx.globalCompositeOperation = 'lighter';
    for (const f of fundo.comida) {
      f.fase += .05;
      const s = f.r * (1 + .3 * Math.sin(f.fase)) * 3;
      ctx.globalAlpha = .45 + .35 * Math.sin(f.fase);
      ctx.drawImage(f.img, f.x - s, f.y - s, s * 2, s * 2);
    }
    ctx.lineCap = ctx.lineJoin = 'round';
    for (const c of fundo.cobras) {
      // rastro de luz em volta do corpo
      ctx.beginPath();
      c.corpo.forEach((p, k) => (k ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
      ctx.strokeStyle = c.cor;
      ctx.globalAlpha = .07;
      ctx.lineWidth = c.r * 5;
      ctx.stroke();
      ctx.globalAlpha = .1;
      ctx.lineWidth = c.r * 2.6;
      ctx.stroke();
    }
    ctx.globalCompositeOperation = 'source-over';
    for (const c of fundo.cobras) {
      // gomos listrados do rabo pra cabeça (o rabo some aos poucos)
      const n = c.corpo.length;
      for (let k = n - 1; k >= 0; k -= 3) {
        const p = c.corpo[k], f = 1 - k / n;
        const r = c.r * (.5 + .5 * Math.min(1, f * 2.5));
        ctx.globalAlpha = .18 + .62 * f;
        ctx.fillStyle = Math.floor(k / 9) % 2 ? c.escura : c.cor;
        ctx.beginPath();
        ctx.arc(p.x, p.y, r, 0, 6.2832);
        ctx.fill();
      }
      // olhos
      const cab = c.corpo[0], px = Math.cos(c.a + 1.57), py = Math.sin(c.a + 1.57);
      const fx = Math.cos(c.a) * c.r * .35, fy = Math.sin(c.a) * c.r * .35;
      ctx.globalAlpha = .95;
      for (const lado of [-1, 1]) {
        const ox = cab.x + px * c.r * .5 * lado + fx, oy = cab.y + py * c.r * .5 * lado + fy;
        ctx.fillStyle = '#FFFFFF';
        ctx.beginPath(); ctx.arc(ox, oy, c.r * .38, 0, 6.2832); ctx.fill();
        ctx.fillStyle = '#0B0806';
        ctx.beginPath(); ctx.arc(ox + Math.cos(c.a) * c.r * .14, oy + Math.sin(c.a) * c.r * .14, c.r * .2, 0, 6.2832); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }
  function ligarFundo() {
    if (fundo.raf) return;
    const cv = $('portaoFundo');
    if (!fundo.ctx) {
      fundo.ctx = cv.getContext('2d');
      if (!fundo.ctx) return;
      addEventListener('resize', () => { if (fundo.ctx && !$('portao').hidden) { medirFundo(); if (quieto()) desenharFundo(); } });
    }
    medirFundo();
    if (!fundo.cobras.length) {
      const qtd = Math.max(5, Math.min(10, Math.round(fundo.w * fundo.h / 110000)));
      fundo.cobras = Array.from({ length: qtd }, (_, i) => novaCobra(i));
      fundo.comida = Array.from({ length: Math.round(qtd * 9) }, novaComida);
    }
    if (quieto()) { desenharFundo(); return; } // movimento reduzido: só a foto parada
    const quadro = () => { passoFundo(); desenharFundo(); fundo.raf = requestAnimationFrame(quadro); };
    fundo.raf = requestAnimationFrame(quadro);
  }
  function pararFundo() {
    cancelAnimationFrame(fundo.raf);
    fundo.raf = 0;
  }
  // carrega tudo e mostra o site (depois de entrar ou ao abrir já logado)
  async function abrirSite() {
    // amigo (não é do clã): só a sala de jogos. Sem chat, ranking, perfis e torneios do clã;
    // entra só na presença, pra aparecer "online" e ser chamado pra jogar
    document.body.classList.toggle('so-jogos', souAmigo);
    const site = carregar();
    if (souAmigo) ligarPresencaJogos(site); else ligarChat(site);
    await site;
    destrancar();
    aplicarAdmin(admin);
    avisarJogos('site');
    mostrarRota();
    if (!souAmigo) ligarUso();
    if (!siteAberto) {
      siteAberto = true;
      if (!souAmigo) cerimoniaAutomatica();
      ligarTempoReal();
    }
  }
  // sai da conta e esconde tudo de novo (num aparelho emprestado, ninguém vê o que ficou)
  async function sairDaConta() {
    admin = null;
    euId = null;
    meuPedido = null;
    contaSemJogador = false;
    souAmigo = false;
    contaUid = null;
    document.body.classList.remove('so-jogos');
    logins = new Map();
    pedidos = [];
    pd.dados = null;
    usoTela = null;
    avisarJogos('sair');
    await desligarChat();
    if (!DEMO && sb) await sb.auth.signOut().catch(() => {});
    if (!DEMO) { partidas = []; jogadores = []; amigos = []; torneios = []; lancamentos = []; indexarElenco(); }
    document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    $('btnAdmin').textContent = 'Área do admin';
    trancar('visitante');
  }

  // ---------- entrar (jogador e admin usam a mesma conta: e-mail + senha) ----------
  // O jogador cria a conta com o e-mail dele e o nick. Depois de confirmar o e-mail:
  // nick do elenco liga na hora; nick novo fica esperando um admin aprovar.
  // Admin é quem está na tabela admins: o banco confere em cada ação.
  let modoEntrar = 'entrar';
  let contaSemJogador = false; // logou, mas a conta não tem nick (o escolhido já tinha dono)
  let meuPedido = null;        // nick novo esperando aprovação
  let contaUid = null;         // id da conta logada (o amigo entra na presença da sala de jogos com ele)
  let linkEmail = null;        // { tipo: 'signup' | 'recovery' } quando a pessoa chegou pelo link do e-mail
  let pedidos = [];            // só pro admin: contas esperando aprovação
  // demonstração: VENO já tem conta (veno@demo.com, senha 1234); outro e-mail com 1234 entra como admin
  const demoContas = new Map([['veno@demo.com', { senha: '1234', player: 'dj0' }]]);
  const TEXTO_ENTRAR = {
    entrar: { titulo: 'ENTRAR', botao: 'Entrar', campos: ['email', 'senha'] },
    criar: { titulo: 'CRIAR CONTA', botao: 'Criar conta', campos: ['nick', 'email', 'senha'] },
    esqueci: { titulo: 'ESQUECI A SENHA', botao: 'Mandar link', campos: ['email'], txt: 'Mandamos um link pro seu e-mail pra você criar uma senha nova.' },
    nova: { titulo: 'SENHA NOVA', botao: 'Salvar senha', campos: ['senha'] },
    nick: { titulo: 'QUAL É O SEU NICK?', botao: 'Pronto', campos: ['nick'], txt: 'O seu nick no clã. Um admin confere e libera a sua entrada.' },
    enviado: { titulo: 'OLHA O SEU E-MAIL', botao: null, campos: [] },
  };

  // lê quem está logado: admin, jogador, pedido esperando; e manda o nick escolhido no cadastro
  async function lerConta() {
    if (DEMO) return;
    const { data } = await sb.auth.getSession();
    const s = data.session;
    admin = null; euId = null; meuPedido = null; contaSemJogador = false; souAmigo = false; contaUid = null;
    if (!s) return;
    contaUid = s.user ? s.user.id : null;
    const [ra, rj, rp, rm] = await Promise.all([sb.rpc('admin_eu'), sb.rpc('jogador_eu'), sb.rpc('meu_pedido'), sb.rpc('sou_amigo')]);
    admin = !ra.error && ra.data ? { nome: ra.data } : null;
    euId = !rj.error && rj.data ? rj.data : null;
    souAmigo = !admin && !!euId && !rm.error && rm.data === true; // sem o SQL novo: ninguém é amigo
    meuPedido = !rp.error && rp.data ? rp.data : null;
    const meta = (s.user && s.user.user_metadata) || {};
    if (!euId && !admin && !meuPedido && meta.nick) {
      // primeira vez depois de confirmar o e-mail: vira pedido pra um admin aprovar
      const rv = await sb.rpc('jogador_pedir_nick', { p_nick: meta.nick });
      if (!rv.error && rv.data === 'pedido') meuPedido = meta.nick;
    }
    contaSemJogador = !euId && !admin && !meuPedido;
  }

  function trocarModoEntrar(m) {
    modoEntrar = m;
    const t = TEXTO_ENTRAR[m];
    $('tituloEntrar').textContent = t.titulo;
    $('abasEntrar').hidden = m !== 'entrar' && m !== 'criar';
    document.querySelectorAll('[data-entrar]').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.entrar === m)));
    document.querySelectorAll('#formEntrar [data-campo]').forEach((n) => { n.hidden = !t.campos.includes(n.dataset.campo); });
    const nova = m === 'criar' || m === 'nova';
    $('rotEntSenha').textContent = m === 'nova' ? 'SENHA NOVA' : nova ? 'CRIE UMA SENHA' : 'SENHA';
    $('fEntSenha').autocomplete = nova ? 'new-password' : 'current-password';
    $('fEntSenha').placeholder = nova ? 'mínimo 8, com letras e números' : '';
    $('captchaEntrar').hidden = !precisaCaptcha(m);
    $('txtEntrar').hidden = !t.txt;
    if (t.txt) $('txtEntrar').textContent = t.txt;
    $('btnEntrarJog').hidden = !t.botao;
    if (t.botao) $('btnEntrarJog').textContent = t.botao;
    $('btnCancelarEntrar').textContent = t.botao ? 'Cancelar' : 'Fechar';
    $('btnEsqueci').hidden = m !== 'entrar';
    $('erroEntrar').hidden = true;
  }
  function focoEntrar() {
    const campo = TEXTO_ENTRAR[modoEntrar].campos.map((c) => $({ nick: 'fEntNick', email: 'fEntEmail', senha: 'fEntSenha' }[c])).find((n) => !n.value);
    (campo || $('btnEntrarJog')).focus();
  }
  function abrirEntrar(m = 'entrar') {
    if (document.querySelector('dialog[open]')) document.querySelectorAll('dialog[open]').forEach((d) => d.close());
    // quem tinha marcado "Sou eu" no aparelho (sistema antigo) já vem com o nick preenchido
    if (!$('fEntNick').value) { const k = lerEuAntigo(); if (k) $('fEntNick').value = k; }
    $('fEntSenha').value = '';
    trocarModoEntrar(m);
    $('dlgEntrar').showModal();
    mostrarCaptcha();
    focoEntrar();
  }
  function lerEuAntigo() { try { return localStorage.getItem('ranking_eu'); } catch (e) { return null; } }

  // Verificação de robô (Cloudflare Turnstile) no entrar, criar conta e esqueci a senha.
  // Só liga com TURNSTILE_SITE_KEY no config.js; quem confere o token é o Supabase.
  const CAPTCHA_KEY = DEMO ? '' : String(CFG.TURNSTILE_SITE_KEY || '').trim();
  let captchaId = null, captchaToken = null, captchaCarregando = null;
  const precisaCaptcha = (m) => !!CAPTCHA_KEY && ['entrar', 'criar', 'esqueci'].includes(m);
  function carregarCaptcha() {
    if (window.turnstile) return Promise.resolve();
    if (!captchaCarregando) captchaCarregando = new Promise((ok, falha) => {
      const s = document.createElement('script');
      s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
      s.async = true;
      s.onload = ok;
      s.onerror = () => { captchaCarregando = null; falha(new Error('captcha')); };
      document.head.appendChild(s);
    });
    return captchaCarregando;
  }
  async function mostrarCaptcha() {
    if (!CAPTCHA_KEY) return;
    try { await carregarCaptcha(); } catch (e) { return; }
    if (captchaId !== null) return novoCaptcha();
    captchaId = window.turnstile.render('#captchaEntrar', {
      sitekey: CAPTCHA_KEY, theme: 'dark', language: 'pt-br', size: 'flexible',
      callback: (t) => { captchaToken = t; },
      'expired-callback': () => { captchaToken = null; },
      'error-callback': () => { captchaToken = null; },
    });
  }
  // cada token só vale uma vez: depois de cada tentativa pede outro
  function novoCaptcha() {
    captchaToken = null;
    if (captchaId !== null && window.turnstile) window.turnstile.reset(captchaId);
  }

  // senha nova: 8+ caracteres, com letra e número (o Supabase também confere) e nada fácil de adivinhar
  const SENHAS_FRACAS = ['123456789', '1234567890', 'a1234567', 'abcd1234', 'qwer1234', 'q1w2e3r4', 'password1'];
  function problemaSenha(senha, nick, email) {
    if (senha.length < 8) return 'A senha precisa ter pelo menos 8 caracteres.';
    if (!/\p{L}/u.test(senha) || !/\d/.test(senha)) return 'A senha precisa ter letras e números.';
    const s = senha.toLocaleLowerCase('pt-BR');
    const nomes = [chave(nick), (email || '').split('@')[0]].filter((n) => n.length >= 3);
    if (SENHAS_FRACAS.includes(s) || /^(cobr|senha|abc|qwerty|password|ffire|freefire|slither)\d+$/.test(s)
      || nomes.some((n) => s.includes(n))) return 'Essa senha é fácil de adivinhar. Escolha outra.';
    return null;
  }

  function msgLogin(error) {
    if (error.status === 429 || /rate limit|too many/i.test(error.message)) return 'Muitas tentativas agora. Espera um pouco e tenta de novo.';
    if (/invalid login credentials/i.test(error.message)) return 'E-mail ou senha errados.';
    if (/email not confirmed/i.test(error.message)) return 'Falta confirmar o e-mail: abra o link que mandamos (olhe no spam também).';
    if (/password/i.test(error.message) && /(least|short|weak|character)/i.test(error.message)) return 'A senha precisa ter pelo menos 8 caracteres, com letras e números.';
    if (/captcha/i.test(error.message)) return 'A verificação "não sou robô" falhou. Espera ela ficar verde e tenta de novo.';
    if (/database error saving new user/i.test(error.message)) return 'Muitas contas novas criadas agora. Tenta de novo mais tarde.';
    if (/invalid.*email|email.*invalid/i.test(error.message)) return 'Esse e-mail não parece certo. Confere.';
    return 'Não deu certo agora. Tenta de novo.';
  }

  async function enviarEntrar(ev) {
    ev.preventDefault();
    const erro = $('erroEntrar');
    const falhar = (msg) => { erro.textContent = msg; erro.hidden = false; };
    erro.hidden = true;
    const m = modoEntrar;
    const campos = TEXTO_ENTRAR[m].campos;
    const email = $('fEntEmail').value.trim().toLowerCase();
    const senha = $('fEntSenha').value;
    const nick = limparNick($('fEntNick').value);
    if (campos.includes('nick') && !nick) return falhar('Escreve o seu nick no clã.');
    if (campos.includes('email') && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return falhar('Escreve o seu e-mail.');
    if (campos.includes('senha')) {
      if (!senha) return falhar('Escreve a senha.');
      const fraca = (m === 'criar' || m === 'nova') && problemaSenha(senha, nick, email);
      if (fraca) return falhar(fraca);
    }
    const captcha = precisaCaptcha(m);
    if (captcha && !captchaToken) return falhar('Espera a verificação "não sou robô" terminar (ou toque nela).');
    const btn = $('btnEntrarJog');
    btn.disabled = true;
    try {
      if (m === 'entrar') await fazerLogin(email, senha, falhar);
      else if (m === 'criar') await criarConta(nick, email, senha, falhar);
      else if (m === 'esqueci') await esqueciSenha(email, falhar);
      else if (m === 'nova') await salvarSenhaNova(senha, falhar);
      else if (m === 'nick') await escolherNick(nick, falhar);
    } catch (e) {
      console.error(e);
      falhar('Não consegui agora. Confere a internet e tenta de novo.');
    } finally {
      btn.disabled = false;
      if (captcha) novoCaptcha();
    }
  }

  // demonstração: o nick digitado vira o jogador do elenco (ou pedido, se for novo)
  function demoNick(nick) { return jogadores.find((r) => chave(r.nick) === chave(nick)) || null; }
  function demoLer(c) {
    euId = c ? c.player : null;
    meuPedido = c && !c.player ? c.pedido : null;
    contaSemJogador = !!c && !c.player && !c.pedido;
  }

  async function fazerLogin(email, senha, falhar) {
    if (DEMO) {
      const c = demoContas.get(email);
      if (c ? c.senha !== senha : senha !== '1234') return falhar('E-mail ou senha errados. (Na demonstração, a senha é 1234.)');
      admin = c ? null : { nome: email.split('@')[0] };
      demoLer(c);
    } else {
      const { error } = await sb.auth.signInWithPassword({ email, password: senha, options: { captchaToken: captchaToken || undefined } });
      if (error) return falhar(msgLogin(error));
      await lerConta();
    }
    $('fEntSenha').value = '';
    $('dlgEntrar').close();
    await depoisDeEntrar();
  }
  // depois de entrar (senha ou link do e-mail): abre o site, ou mostra o que falta
  async function depoisDeEntrar(confirmou = false) {
    if (!podeVer()) {
      trancar();
      if (contaSemJogador) abrirEntrar('nick');
      else if (meuPedido && confirmou) toast('E-mail confirmado! Agora é só esperar um admin aprovar.');
      return;
    }
    try { if (euId) localStorage.removeItem('ranking_eu'); } catch (e) {}
    await abrirSite();
    const r = euId && jogPorId.get(euId);
    if (admin) {
      const n = pedidos.length;
      toast(`Bem-vindo, ${admin.nome}.` + (n ? ` ${n} ${n === 1 ? 'pedido esperando' : 'pedidos esperando'} aprovação em Jogadores.` : ' Área do admin liberada.'));
    } else if (r) {
      const quem = souAmigo ? r.nick : comTag(r.nick); // amigo não leva a tag do clã
      toast(confirmou ? `E-mail confirmado! Bem-vindo, ${quem}.` : `Bem-vindo, ${quem}!` + (souAmigo ? ' Bora jogar?' : ''));
    }
  }

  async function criarConta(nick, email, senha, falhar) {
    if (DEMO) {
      const r = demoNick(nick);
      if (r && [...demoContas.values()].some((c) => c.player === r.id)) return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      if (demoContas.has(email)) return falhar('Esse e-mail já tem conta. Toque em "Entrar".');
      demoContas.set(email, { senha, player: null, pedido: nick });
    } else {
      const st = await sb.rpc('nick_status', { p_nick: nick });
      if (st.error) throw new Error(st.error.message);
      if (st.data === 'tem_login') return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      const { data, error } = await sb.auth.signUp({
        email, password: senha,
        options: { emailRedirectTo: location.origin + location.pathname, data: { nick }, captchaToken: captchaToken || undefined },
      });
      if (error) {
        // o e-mail grátis do Supabase manda poucos por hora
        if (error.status === 429 || /rate limit/i.test(error.message)) return falhar('Muita gente se cadastrando agora e o e-mail de confirmação não saiu. Tenta de novo daqui a uma hora.');
        return falhar(msgLogin(error));
      }
      // e-mail que já tinha conta: o Supabase finge que deu certo, mas não manda nada
      if (data.user && Array.isArray(data.user.identities) && !data.user.identities.length) return falhar('Esse e-mail já tem conta. Toque em "Entrar".');
      if (data.session) {
        await lerConta();
        $('fEntSenha').value = '';
        $('dlgEntrar').close();
        await depoisDeEntrar();
        return;
      }
    }
    $('fEntSenha').value = '';
    trocarModoEntrar('enviado');
    $('txtEntrar').hidden = false;
    $('txtEntrar').replaceChildren('Mandamos um link pra ', el('b', { text: email }), '. Abra e toque nele pra confirmar (olhe no spam também).',
      ' Depois um admin do clã confere e libera a sua entrada.');
  }

  async function esqueciSenha(email, falhar) {
    if (!DEMO) {
      const { error } = await sb.auth.resetPasswordForEmail(email, { redirectTo: location.origin + location.pathname, captchaToken: captchaToken || undefined });
      if (error) return falhar(error.status === 429 || /rate limit/i.test(error.message) ? 'O e-mail não saiu agora (limite por hora). Tenta de novo mais tarde.' : msgLogin(error));
    }
    trocarModoEntrar('enviado');
    $('txtEntrar').hidden = false;
    $('txtEntrar').replaceChildren('Se ', el('b', { text: email }), ' tem conta, o link pra criar a senha nova chegou lá. Olhe no spam também.');
  }

  async function salvarSenhaNova(senha, falhar) {
    if (!DEMO) {
      const { error } = await sb.auth.updateUser({ password: senha });
      if (error) return falhar(/different from the old/i.test(error.message) ? 'Essa é a senha antiga. Escolha outra.' : msgLogin(error));
      await lerConta();
    }
    $('fEntSenha').value = '';
    $('dlgEntrar').close();
    toast('Senha nova salva!');
    if (podeVer() && siteAberto) { aplicarAdmin(admin); return; }
    await depoisDeEntrar();
  }

  async function escolherNick(nick, falhar) {
    let res;
    if (DEMO) {
      res = 'pedido';
      meuPedido = nick;
      const c = [...demoContas.values()].find((x) => !x.player && !x.pedido);
      if (c) c.pedido = nick;
    } else {
      const rv = await sb.rpc('jogador_pedir_nick', { p_nick: nick });
      if (rv.error) throw new Error(rv.error.message);
      res = rv.data;
      if (res === 'tem_login') return falhar('Esse nick já tem conta. Se é você, fala com um admin do clã.');
      if (res === 'pedido') meuPedido = nick;
      else return falhar('Não deu certo. Tenta de novo.');
    }
    contaSemJogador = false;
    $('dlgEntrar').close();
    await depoisDeEntrar();
    if (res === 'pedido') toast('Pedido enviado! Um admin do clã vai aprovar.');
  }

  // "Já fui aprovado": confere de novo sem precisar sair e entrar
  async function conferirPedido() {
    const btn = $('btnPortaoConferir');
    btn.disabled = true;
    try {
      if (DEMO) { const c = [...demoContas.values()].find((x) => x.pedido === meuPedido || (x.player && jogPorId.get(x.player) && chave(jogPorId.get(x.player).nick) === chave(meuPedido || ''))); demoLer(c); }
      else await lerConta();
      if (podeVer()) await depoisDeEntrar(); else { trancar(); toast('Ainda não foi aprovado. Tenta de novo mais tarde.'); }
    } catch (e) {
      console.error(e);
      toast('Não consegui conferir agora.', true);
    } finally {
      btn.disabled = false;
    }
  }

  async function sairConta() {
    await sairDaConta();
    toast('Você saiu.');
  }

  // ---------- admin: quem já tem login e quem pediu pra entrar ----------
  async function carregarLogins() {
    if (DEMO) { pedidos = [...demoContas.entries()].filter(([, c]) => c.pedido).map(([email, c]) => ({ user_id: email, email, nick: c.pedido, created_at: new Date().toISOString() })); renderPedidos(); return; }
    if (!admin) return;
    const [r, rp] = await Promise.all([sb.rpc('admin_logins'), sb.rpc('admin_pedidos')]);
    if (r.error) console.warn('logins:', r.error.message);
    else logins = new Map((r.data || []).map((x) => [x.player_id, x]));
    if (rp.error) console.warn('pedidos:', rp.error.message);
    else pedidos = rp.data || [];
    renderPedidos();
    if ($('dlgJogador').open && editJog) renderLoginJog(editJog);
  }
  // cada pedido: quem é (e-mail), o nick que digitou e de quem é o perfil (o admin confere e escolhe)
  function renderPedidos() {
    const box = $('pedidos');
    box.hidden = !admin;
    if (box.hidden) return;
    $('qtdPedidos').textContent = pedidos.length || '';
    $('qtdPedidos').hidden = !pedidos.length;
    renderAmigos();
    if (!pedidos.length) { $('listaPedidos').replaceChildren(el('li', { class: 'pedido-vazio', text: 'Nenhum pedido esperando.' })); return; }
    const qtdPartidas = (r) => partidas.filter((x) => chave(x.player) === chave(r.nick)).length;
    // perfis que ainda não têm dono, quem está no clã primeiro
    const livres = jogadores.filter((r) => !loginDe(r.id)).sort((a, b) => (b.ativo - a.ativo) || a.nick.localeCompare(b.nick, 'pt-BR'));
    $('listaPedidos').replaceChildren(...pedidos.map((p) => {
      const nick = limparNick(p.nick);
      const igual = elenco.get(chave(nick));
      const sel = el('select', { class: 'pedido-perfil', 'aria-label': `Perfil de ${p.email}` },
        el('option', { value: '', text: `Jogador novo: ${nick}` }),
        ...livres.map((r) => { const n = qtdPartidas(r); return el('option', { value: r.id, text: `${r.nick}${n ? ` · ${n} ${n === 1 ? 'partida' : 'partidas'}` : ''}${r.ativo ? '' : ' · ex-membro'}` }); }));
      if (igual && !loginDe(igual.id)) sel.value = igual.id;
      const aviso = el('small', { class: 'pedido-aviso' });
      const avisar = () => {
        const r = jogPorId.get(sel.value);
        aviso.textContent = r ? `Vai ficar com o perfil de ${comTag(r.nick)}${qtdPartidas(r) ? ' e as partidas dele' : ''}. Confere se é ele mesmo.` : 'Entra no elenco como jogador novo.';
      };
      sel.addEventListener('change', avisar);
      avisar();
      return el('li', { class: 'pedido' },
        el('div', { class: 'pedido-txt' },
          el('b', { text: p.email }),
          el('small', { text: `Digitou ${comTag(nick)}${igual && loginDe(igual.id) ? ' (esse já tem dono)' : ''} · ${haQuanto(p.created_at)}` })),
        el('label', { class: 'pedido-campo' }, el('span', { text: 'PERFIL' }), sel),
        aviso,
        el('div', { class: 'pedido-btns' },
          el('button', { type: 'button', class: 'btn btn-perigo-sec', onclick: () => confirmar('RECUSAR PEDIDO?', `${p.email} não entra no site e a conta é apagada.`, 'Recusar', () => responderPedido(p, false)) }, 'Recusar'),
          // amigo: não é do clã, só joga. Vê só a sala de jogos, fica fora do ranking, do elenco e do chat
          el('button', { type: 'button', class: 'btn btn-sec', title: 'Não é do clã: só joga na sala de jogos', disabled: !!igual, // nick de alguém do clã não vira amigo
            onclick: () => confirmar('ACEITAR COMO AMIGO?', `${nick} entra só pra jogar: vê a sala de jogos e mais nada (sem ranking, chat, jogadores e torneios do clã). Depois dá pra passar pra membro.`, 'Aceitar como amigo', () => responderPedido(p, true, null, true)) }, 'Como amigo'),
          el('button', { type: 'button', class: 'btn btn-pri', onclick: (e) => { e.currentTarget.disabled = true; responderPedido(p, true, sel.value || null); } }, 'Aprovar')));
    }));
  }
  async function responderPedido(p, aprovar, perfil = null, amigo = false) {
    try {
      if (DEMO) {
        const c = demoContas.get(p.user_id);
        if (aprovar) {
          let id = amigo ? null : perfil;
          if (!id) {
            id = 'dj' + (jogadores.length + amigos.length + 10);
            const novo = { id, nick: limparNick(p.nick), cargo: amigo ? 'Amigo' : CARGO_PADRAO, ativo: true, amigo, created_at: new Date().toISOString() };
            (amigo ? amigos : jogadores).push(novo);
            indexarElenco();
          }
          c.player = id; c.pedido = null;
        } else demoContas.delete(p.user_id);
      } else {
        if (aprovar) {
          const res = await rpcAdmin('admin_aprovar_pedido', amigo ? { p_user: p.user_id, p_player: null, p_amigo: true } : { p_user: p.user_id, p_player: perfil });
          if (res === 'nick_do_cla') { toast('Esse nick é de alguém do clã. Pra aceitar como amigo, a pessoa precisa usar outro nick.', true); renderPedidos(); return; }
          if (res === 'tem_login') { toast('Esse perfil já tem conta de outra pessoa. Escolha outro ou tire o login dele antes.', true); await carregarLogins(); return; }
        } else await rpcAdmin('admin_recusar_pedido', { p_user: p.user_id });
        await carregar();
      }
      await carregarLogins();
      render();
      const dono = perfil && jogPorId.get(perfil);
      toast(!aprovar ? 'Pedido recusado.'
        : amigo ? `${p.email} aceito como amigo (${limparNick(p.nick)}). Já pode entrar e jogar.`
        : `${p.email} aprovado como ${comTag(dono ? dono.nick : limparNick(p.nick))}. Já pode entrar.`);
    } catch (e) {
      console.error(e);
      if (!erroSessao(e)) { toast('Não deu agora. Tenta de novo.', true); renderPedidos(); }
    }
  }

  // amigos aceitos (só jogam): o admin passa pra membro quando entram no clã, ou tira o acesso
  function renderAmigos() {
    const box = $('amigosBox');
    if (!box) return;
    box.hidden = !admin || !amigos.length;
    if (box.hidden) return;
    const lista = [...amigos].sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR'));
    $('listaAmigos').replaceChildren(...lista.map((r) => {
      const l = loginDe(r.id);
      return el('li', { class: 'pedido' },
        el('div', { class: 'pedido-txt' },
          el('b', { text: r.nick }),
          el('small', { text: l ? `${l.email}${l.ultimo_acesso ? ` · entrou ${haQuanto(l.ultimo_acesso)}` : ''}` : 'sem login (tiraram o acesso)' })),
        el('div', { class: 'pedido-btns' },
          l ? el('button', { type: 'button', class: 'btn btn-perigo-sec', onclick: () => confirmar('TIRAR O ACESSO?', `${r.nick} não entra mais no site. As partidas que jogou continuam no histórico.`, 'Tirar acesso', () => mexerAmigo(r, 'tirar')) }, 'Tirar acesso') : null,
          el('button', { type: 'button', class: 'btn btn-sec', onclick: () => confirmar('PASSAR PRA MEMBRO?', `${r.nick} entrou no clã: passa a ver o site inteiro e entra no elenco como ${comTag(r.nick)}.`, 'Virar membro', () => mexerAmigo(r, 'membro')) }, 'Virar membro')));
    }));
  }
  async function mexerAmigo(r, acao) {
    try {
      if (DEMO) {
        if (acao === 'membro') { amigos = amigos.filter((x) => x.id !== r.id); jogadores.push({ ...r, amigo: false, cargo: CARGO_PADRAO }); indexarElenco(); }
        else for (const c of demoContas.values()) if (c.player === r.id) c.player = null;
      } else {
        if (acao === 'membro') await rpcAdmin('admin_mudar_amigo', { p_player: r.id, p_amigo: false });
        else await rpcAdmin('admin_tirar_login', { p_player: r.id });
        await carregar();
      }
      await carregarLogins();
      render();
      toast(acao === 'membro' ? `${comTag(r.nick)} agora é membro do clã.` : `${r.nick} ficou sem acesso.`);
    } catch (e) {
      console.error(e);
      if (!erroSessao(e)) toast('Não deu agora. Tenta de novo.', true);
    }
  }

  function loginDe(id) {
    if (!DEMO) return logins.get(id) || null;
    const e = [...demoContas.entries()].find(([, c]) => c.player === id);
    return e ? { email: e[0], admin: false, ultimo_acesso: null } : null;
  }
  function renderLoginJog(r) {
    const l = loginDe(r.id);
    $('jogLogin').hidden = !r.id;
    $('jogLoginTxt').replaceChildren(...(l
      ? [el('b', { text: l.email }), l.admin ? ' · conta de admin' : '', l.ultimo_acesso ? ` · entrou ${haQuanto(l.ultimo_acesso)}` : '']
      : ['Ainda não criou a conta.']));
    $('btnTirarLogin').hidden = !l;
    $('btnTirarLogin').textContent = 'Tirar login';
    confirmarTirar = false;
    // admin que também joga: liga a própria conta ao jogador dele
    $('btnSouEuAdmin').hidden = DEMO || !!l || !!euId;
  }

  let confirmarTirar = false;
  async function tirarLogin() {
    const r = editJog;
    if (!r) return;
    if (!confirmarTirar) { confirmarTirar = true; $('btnTirarLogin').textContent = 'Toque de novo pra tirar'; return; }
    try {
      if (DEMO) {
        for (const c of demoContas.values()) if (c.player === r.id) c.player = null;
      } else {
        await rpcAdmin('admin_tirar_login', { p_player: r.id });
        await carregarLogins();
      }
      if (euId === r.id) euId = null;
      renderLoginJog(r);
      render();
      toast(`${comTag(r.nick)} ficou sem login. Quem tinha a conta escolhe outro nick ao entrar.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu agora. (' + (e.message || 'erro') + ')');
    }
  }

  async function souEuAdmin() {
    const r = editJog;
    if (!r) return;
    try {
      const res = await rpcAdmin('jogador_vincular', { p_player: r.id });
      if (res === 'tem_login') return erroJogador('Esse jogador já tem conta própria.');
      if (res !== 'ok') throw new Error(res);
      euId = r.id;
      await carregarLogins();
      renderLoginJog(r);
      render();
      toast(`Sua conta agora é a de ${comTag(r.nick)}. "Meu perfil" fica no topo.`);
    } catch (e) {
      console.error(e);
      if (erroSessao(e)) { $('dlgJogador').close(); return; }
      erroJogador('Não deu agora. (' + (e.message || 'erro') + ')');
    }
  }

  // ---------- dados ----------
  // o Supabase entrega no máximo 1000 linhas por vez; lê em páginas pra não cortar ninguém
  async function lerTudo(consulta) {
    const todos = [];
    for (let de = 0; de < 50000; de += 1000) {
      const r = await consulta().range(de, de + 999);
      if (r.error) return r;
      todos.push(...(r.data || []));
      if (!r.data || r.data.length < 1000) break;
    }
    return { data: todos, error: null };
  }

  async function carregar() {
    if (DEMO) return;
    let [r, rj, rt, rl, rd] = await Promise.all([
      lerTudo(() => sb.from('scores').select('id, player, mass, print_path, created_at').order('created_at', { ascending: false }).order('id')),
      lerTudo(() => sb.from('players').select('id, nick, cargo, ativo, amigo, avatar, vitrine, parede, created_at').order('nick').order('id')),
      lerTudo(() => sb.from('torneios').select('*').order('inicio', { ascending: false }).order('id')),
      lerTudo(() => sb.from('torneio_lancamentos').select('id, torneio_id, player_id, valor, nota, print_path, created_at').order('created_at', { ascending: false }).order('id')),
      lerTudo(() => sb.from('jogos_partidas').select('id, brancas, pretas, vencedor, fim').eq('jogo', 'damas').eq('status', 'fim').is('torneio', null).order('fim').order('id')),
    ]);
    if (r.error) throw new Error(r.error.message);
    partidas = r.data || [];
    // sem a coluna amigo (SQL antigo): ninguém é amigo
    if (rj.error) rj = await lerTudo(() => sb.from('players').select('id, nick, cargo, ativo, avatar, vitrine, parede, created_at').order('nick').order('id'));
    paredeOk = !rj.error;
    if (rj.error) rj = await lerTudo(() => sb.from('players').select('id, nick, cargo, ativo, avatar, vitrine, created_at').order('nick').order('id'));
    vitrineOk = !rj.error;
    if (rj.error) rj = await lerTudo(() => sb.from('players').select('id, nick, cargo, ativo, avatar, created_at').order('nick').order('id'));
    // sem a tabela players (script novo ainda não rodado) o site continua funcionando
    elencoOk = !rj.error;
    if (rj.error) console.warn('elenco:', rj.error.message);
    // amigo (só joga) fica fora do elenco: ranking, jogadores, torneios e chat são só do clã
    jogadores = (rj.data || []).filter((x) => !x.amigo);
    amigos = (rj.data || []).filter((x) => x.amigo);
    indexarElenco();
    // mesma coisa com os torneios: sem as tabelas, a seção só some
    torneiosOk = !rt.error && !rl.error;
    if (!torneiosOk) console.warn('torneios:', (rt.error || rl.error).message);
    torneios = (rt.data || []).map((t) => ({ ...t, participantes: t.participantes || [], premios: t.premios || [] }));
    lancamentos = rl.data || [];
    // sem a seção 11 do SQL a medalha de damas só fica trancada
    if (rd.error) console.warn('damas:', rd.error.message);
    damasFins = rd.error ? [] : rd.data || [];
  }

  function dadosDemo() {
    const h = (horas) => new Date(Date.now() - horas * 3600 * 1000).toISOString();
    const lista = [
      ['VENO', 112430, 2], ['Mamba', 15400, 5], ['VETERANO', 18420, 9], ['Kaiser', 27800, 20], ['Shawdow', 104210, 30],
      ['VETERANO', 52040, 48], ['Kaiser', 35100, 70], ['VENO', 61877, 80], ['Mamba', 9800, 100], ['VETERANO', 41902, 120],
      ['Shawdow', 54105, 150], ['Mamba', 25300, 170], ['VENO', 101990, 200], ['Kaiser', 12900, 230], ['Shawdow', 22310, 260],
      ['VETERANO', 33700, 300], ['VENO', 104500, 320], ['Shawdow', 66780, 350], ['VENO', 58200, 400], ['Shawdow', 51200, 450],
      ['VENO', 73400, 500], ['Shawdow', 30100, 560], ['VETERANO', 26700, 600], ['VENO', 120880, 640],
      ['Shawdow', 215000, 1000], ['Kaiser', 88000, 1100], ['Shawdow', 78000, 1200], ['VENO', 64000, 1300],
      ['Mamba', 47000, 1500], ['Kaiser', 39000, 1600], ['VETERANO', 31000, 1700],
      // Shawdow passa de 10.000 pts: mostra a patente Diamantes no modo demonstração
      ['Shawdow', 1000000, 1250], ['Shawdow', 980000, 1300], ['Shawdow', 1000000, 1350], ['Shawdow', 990000, 1400], ['Shawdow', 1000000, 1450], ['Shawdow', 1000000, 1550],
    ];
    return lista.map(([player, mass, horas], i) => ({ id: 'd' + i, player, mass, created_at: h(horas) }));
  }
  function elencoDemo() {
    const d = (dias) => new Date(Date.now() - dias * 86400000).toISOString();
    return [
      ['VENO', 'Líder', true, 60], ['Shawdow', 'Vice-líder', true, 55], ['VETERANO', 'Membro', true, 50], ['Kaiser', 'Membro', true, 40],
      ['Mamba', 'Membro', true, 30], ['Naja', 'Membro', true, 6], ['Cascavel', 'Membro', true, 2], ['Sucuri', 'Membro', false, 45],
    ].map(([nick, cargo, ativo, dias], i) => ({ id: 'dj' + i, nick, cargo, ativo, avatar: AVATARES_DEMO[nick] || null, vitrine: nick === 'Shawdow' ? ['massa', 'rei', 'fundador'] : null, parede: PAREDES_DEMO[nick] || null, created_at: d(dias) }));
  }
  const PAREDES_DEMO = { VENO: 'trono', Shawdow: 'buraco', VETERANO: 'aurora', Kaiser: 'cidade', Mamba: 'selva', Naja: 'duelo' };
  const AVATARES_DEMO = {
    Shawdow: { pele: 'preto', cor2: 'ciano', padrao: 'raio', olhos: 'neon', boca: 'presas', cabeca: 'headset', rosto: 'nada', cor3: 'ciano', fundo: 'noite', estampa: 'grade' },
    Kaiser: { pele: 'vermelho', cor2: 'amarelo', padrao: 'chamas', olhos: 'bravo', boca: 'deboche', cabeca: 'bone', rosto: 'escuros', cor3: 'preto', fundo: 'brasa', estampa: 'raios' },
    VETERANO: { pele: 'verde', cor2: 'amarelo', padrao: 'losango', olhos: 'fenda', boca: 'lingua', cabeca: 'viking', rosto: 'cicatriz', cor3: 'laranja', fundo: 'mata', estampa: 'hex' },
    Mamba: { pele: 'rosa', cor2: 'branco', padrao: 'pintas', olhos: 'fofo', boca: 'sorriso', cabeca: 'gorro', rosto: 'nada', cor3: 'roxo', fundo: 'roxo', estampa: 'bolinhas' },
  };
  // dj0 VENO · dj1 Shawdow · dj2 VETERANO · dj3 Kaiser · dj4 Mamba · dj5 Naja · dj6 Cascavel
  function torneiosDemo() {
    const h = (horas) => new Date(Date.now() + horas * 3600 * 1000).toISOString();
    const base = { unidade: '', auto: true, qtd: null, meta: null, semente: 'ranking', fim: null, encerrado_em: null, todos: true, participantes: [], premios: [], regras: '', chave: null, publicado: true, base: 'geral', podio: [] };
    const lista = [
      { ...base, id: 'dt1', nome: 'Copa COBR de Outubro', formato: 'soma', metrica: 'pontos', inicio: h(-240), fim: h(53.2),
        premios: ['Cargo Elite por 1 mês', 'Destaque no grupo', 'Respeito'], regras: 'Só vale partida com print mostrando o nick com a tag.\nQuem for pego com print editado é eliminado.' },
      { ...base, id: 'dt2', nome: 'X1 dos Brabos', formato: 'mata', metrica: 'custom', unidade: 'kills', auto: false, inicio: h(-48), fim: h(120), todos: false,
        participantes: ['dj0', 'dj1', 'dj2', 'dj3', 'dj4', 'dj5'], premios: ['Título de Brabo do Clã', 'Vice-Brabo'],
        regras: 'Duelo na mesma sala, 10 minutos. Vence quem matar mais.',
        chave: { slots: ['dj0', null, 'dj2', 'dj4', 'dj1', null, 'dj3', 'dj5'], em: h(-47), res: {
          '0-1': { a: 'dj2', b: 'dj4', va: 14, vb: 9, v: 'dj2' },
          '0-3': { a: 'dj3', b: 'dj5', va: 7, vb: 11, v: 'dj5' },
          '1-0': { a: 'dj0', b: 'dj2', va: 18, vb: 12, v: 'dj0' },
        } } },
      { ...base, id: 'dt3', nome: 'Caça às Kills', formato: 'melhores', metrica: 'custom', unidade: 'kills', auto: false, qtd: 3, inicio: h(-30), fim: h(90), todos: false,
        participantes: ['dj0', 'dj1', 'dj3', 'dj5', 'dj6'], premios: ['Skin escolhida pelo campeão'] },
      { ...base, id: 'dt4', nome: 'Rei da Massa', formato: 'melhor', metrica: 'massa', inicio: h(74), fim: h(242), premios: ['Coroa no nick por 1 semana'] },
      { ...base, id: 'dt6', nome: 'Rei das 21h', formato: 'hora', metrica: 'pontos', base: 'semana', inicio: h(-30), fim: h(-1.5), premios: ['Cargo Elite por 1 semana', 'Destaque no grupo'] },
      { ...base, id: 'dt7', nome: 'Primeiro da Sala', formato: 'livre', inicio: h(-6), fim: null, todos: true, podio: ['dj1', 'dj3'],
        regras: 'Às 22h em ponto, quem estiver em 1º no placar da sala do clã é o campeão. Vale print com o horário aparecendo.', premios: ['Coroa no nick por 1 semana'] },
      { ...base, id: 'dt8', nome: 'Topo da Temporada às 23h', formato: 'hora', metrica: 'pontos', base: 'mes', inicio: h(-2), fim: h(4.5) },
      { ...base, id: 'dt9', nome: 'Desafio do Dono', formato: 'livre', inicio: h(-3), fim: h(20), todos: false, participantes: ['dj0', 'dj2', 'dj4', 'dj5'],
        regras: 'Quem fizer mais kills usando só a skin padrão. Manda o print pro dono até o fim do dia.' },
      { ...base, id: 'dt5', nome: 'Corrida dos 250K', formato: 'meta', metrica: 'massa', meta: 250000, inicio: h(-1680), fim: h(-720), premios: ['Cargo Vice-líder honorário'] },
    ];
    const lanc = [['dt3', 'dj0', 12, -26], ['dt3', 'dj1', 15, -20], ['dt3', 'dj5', 9, -18], ['dt3', 'dj0', 8, -12], ['dt3', 'dj5', 11, -9], ['dt3', 'dj5', 4, -6], ['dt3', 'dj3', 6, -3], ['dt3', 'dj0', 13, -1]]
      .map(([torneio_id, player_id, valor, horas], i) => ({ id: 'dl' + i, torneio_id, player_id, valor, nota: i % 3 === 0 ? 'sala lotada' : '', print_path: null, created_at: h(horas) }));
    return { lista, lanc };
  }

  let realtimeOk = false;
  function ligarTempoReal() {
    const aoVivo = $('aoVivo');
    if (DEMO) { aoVivo.lastChild.textContent = 'demonstração'; return; }
    let espera;
    const recarregar = () => {
      clearTimeout(espera);
      espera = setTimeout(() => { if (podeVer()) carregar().then(render).catch(() => {}); }, 400);
    };
    sb.channel('scores-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'scores' }, recarregar)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'players' }, recarregar)
      .subscribe((status) => {
        realtimeOk = status === 'SUBSCRIBED';
        aoVivo.classList.toggle('on', realtimeOk);
        $('botTopo').classList.toggle('on', realtimeOk);
      });
    // canal separado: se as tabelas de torneio ainda não existem, não derruba o do ranking
    if (torneiosOk) {
      sb.channel('torneios-ao-vivo')
        .on('postgres_changes', { event: '*', schema: 'public', table: 'torneios' }, recarregar)
        .on('postgres_changes', { event: '*', schema: 'public', table: 'torneio_lancamentos' }, recarregar)
        .subscribe();
    }
    // reserva: atualiza a cada minuto mesmo sem tempo real
    setInterval(() => {
      if (document.hidden || !podeVer()) return;
      carregar().then(render).catch(() => {});
      if (admin) carregarLogins().catch(() => {});
    }, 60000);
  }

  // ---------- chat do clã ----------
  // Só membro lê e fala (o banco confere, passo 7 do SQL). Mensagens, reações, bonde e "tô jogando"
  // chegam ao vivo; quem está com o site aberto aparece online (presença do Supabase).
  // Dono (quem é admin do site) escolhe os ADMs do chat; ADM do chat só modera o chat.
  const ICONE_HASH = '<path d="M5 9h14M5 15h14M10 4 8 20M16 4l-2 16"/>';
  const ICONE_BONDE = '<path d="M6 11h4M8 9v4M15 12h.01M18 10h.01"/><path d="M17.3 5H6.7a4 4 0 0 0-4 3.6l-.7 6.5A2.7 2.7 0 0 0 6.6 17l2.1-2h6.6l2.1 2a2.7 2.7 0 0 0 4.6-1.9l-.7-6.5A4 4 0 0 0 17.3 5z"/>';
  const ICONE_CHAMA = '<path d="M12 22c4 0 7-3 7-7 0-5-4-6-5-11-3 2-4 5-4 8-1-1-2-2-2-4-2 2-3 4-3 7 0 4 3 7 7 7z"/>';
  const ICONE_MEGAFONE = '<path d="M3 11v2a1 1 0 0 0 1 1h2l5 4V6L6 10H4a1 1 0 0 0-1 1z"/><path d="M15 9a3 3 0 0 1 0 6M18 6a7 7 0 0 1 0 12"/>';
  const ICONE_TRAVA = '<rect x="5" y="11" width="14" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 8 0v4"/>';
  const ICONE_ENVIAR = '<path d="M4 12 20 4l-4 16-4-7z"/><path d="M12 13 20 4"/>';
  const ICONE_SORRISO = '<circle cx="12" cy="12" r="9"/><path d="M8.5 14a4 4 0 0 0 7 0M9 9.5h.01M15 9.5h.01"/>';
  const ICONE_RESPONDER = '<path d="M9 14 4 9l5-5"/><path d="M4 9h10a6 6 0 0 1 6 6v4"/>';
  const ICONE_FIXAR = '<path d="M12 17v5M9 3h6l-1 6 4 4H6l4-4z"/>';
  const ICONE_GENTE = '<circle cx="9" cy="8" r="4"/><path d="M2 21a7 7 0 0 1 14 0M16 4a4 4 0 0 1 0 8M22 21a7 7 0 0 0-5-6.7"/>';
  const ICONE_CITA = '<path d="M4 4v7a4 4 0 0 0 4 4h12"/><path d="M16 11l4 4-4 4"/>';
  const ICONE_MUDO = '<path d="M11 5 6 9H3v6h3l5 4z"/><path d="M22 9l-6 6M16 9l6 6"/>';
  const ICONE_MODERAR = '<path d="M12 3l8 3.5v5.5c0 4.5-3.4 8-8 9.5-4.6-1.5-8-5-8-9.5V6.5z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>';
  const ICONE_SETA = '<path d="M5 12h14M13 6l6 6-6 6"/>';
  const ICONE_DESCE = '<path d="M12 5v14M6 13l6 6 6-6"/>';
  const ICONE_FOTO = '<rect x="3" y="5" width="18" height="15" rx="2"/><circle cx="12" cy="12.5" r="3.5"/><path d="M8 5l1.5-2h5L16 5"/>';
  const ICONE_MIC = '<rect x="9" y="3" width="6" height="11" rx="3"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0M12 17.5V21"/>';
  const ICONE_PLAY = '<path d="M8 5.5v13l10.5-6.5z" fill="currentColor"/>';
  const ICONE_PAUSA = '<rect x="7" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/><rect x="13.5" y="5" width="3.5" height="14" rx="1" fill="currentColor" stroke="none"/>';
  const ICONE_MAIS = '<path d="M12 5v14M5 12h14"/>';
  const ICONE_SINO = '<path d="M6 16V11a6 6 0 0 1 12 0v5l2 2H4z"/><path d="M10 20a2 2 0 0 0 4 0"/>';
  const CANAIS_CHAT = [
    { id: 'geral', nome: 'geral', ico: ICONE_HASH, vazio: 'Manda o primeiro oi pro clã.' },
    { id: 'bonde', nome: 'bonde', ico: ICONE_BONDE, vazio: 'Toque no controle pra chamar o bonde.' },
    { id: 'recordes', nome: 'recordes', ico: ICONE_CHAMA, soSite: true, vazio: 'Cada massa registrada aparece aqui.' },
    { id: 'avisos', nome: 'avisos', ico: ICONE_MEGAFONE, soAdm: true, vazio: 'Nenhum aviso ainda.' },
  ];
  const REACOES_CHAT = ['🔥', '😂', '💀', '👑', '🐍', '💯', '👍', 'GG'];
  const POR_CANAL = 80;               // mensagens que carrega de cada canal (o resto vem ao subir a tela)
  const MAIS_ANTIGAS = 50;
  const BONDE_DURA = 3 * 3600000;     // depois disso o bonde fecha
  const EDITA_ATE = 15 * 60000;       // dá pra editar a própria mensagem até 15 min depois
  const LENTOS = [[0, 'Desligado'], [10, '10 s'], [30, '30 s'], [60, '1 min'], [300, '5 min']];
  const chat = {
    ligado: false, eu: null, canal: 'geral', resp: null, editando: null, rt: null, presenca: null, conectou: false,
    msgs: Object.fromEntries(CANAIS_CHAT.map((c) => [c.id, []])),
    temMais: {},                      // canal -> ainda tem mensagem mais velha no banco
    porId: new Map(),                 // id -> mensagem
    reac: new Map(),                  // id -> Map(emoji -> Set(user_id))
    bonde: new Map(),                 // id -> [{ user_id, player_id, nome }]
    status: new Map(),                // user_id -> { player_id, nome, jogando_ate }
    online: new Map(),                // user_id -> { player_id, nome }
    equipe: new Map(),                // user_id -> 'dono' | 'adm'
    cfg: new Map(),                   // canal -> { travado, lento }
    criados: [],                      // canais que os ADMs criaram (só os que esta conta vê)
    meus: null,                       // Set dos canais que esta conta vê (null = ainda não sabe: mostra os do site)
    digitando: new Map(), lido: {}, novas: 0, denuncias: 0, antigas: false,
  };
  // tocou numa notificação com o app fechado: o site abre com ?canal= e o chat vai direto pra ele
  let canalPedido = null;
  try {
    const u = new URL(location.href);
    canalPedido = u.searchParams.get('canal');
    if (canalPedido) { u.searchParams.delete('canal'); history.replaceState(history.state, '', u.pathname + u.search + u.hash); }
  } catch (e) {}
  const euChat = () => (chat.eu && chat.eu.user_id) || null;
  const admChat = () => !!(chat.eu && chat.eu.adm);
  const donoChat = () => !!(chat.eu && chat.eu.dono);
  const papelDe = (u) => (u ? chat.equipe.get(u) || null : null);
  // os 4 do site com o que o Dono mudou neles (nome, ícone, quem vê, quem escreve)
  function canalBase(c) {
    const g = chat.cfg.get(c.id) || {}, fala = c.soSite ? null : g.fala || (c.soAdm ? 'adm' : 'todos');
    return { ...c, base: true, nome: g.nome || c.nome, emoji: g.emoji || null, ve: g.ve || 'todos', fala, soAdm: fala === 'adm' };
  }
  // chat.meus: os do site que esta conta vê (null = todos)
  const todosCanais = () => [...CANAIS_CHAT.map(canalBase).filter((c) => !chat.meus || chat.meus.has(c.id)), ...chat.criados];
  const canalChat = (id) => todosCanais().find((c) => c.id === id) || canalBase(CANAIS_CHAT[0]);
  const nomeCanal = (id, nome) => (todosCanais().find((c) => c.id === id) || {}).nome || nome || id;
  const cfgCanal = (c) => chat.cfg.get(c) || { travado: false, lento: 0, desligado: false };
  // o Dono pode desligar #bonde, #recordes e #avisos: somem pra todo mundo até ele ligar de novo
  const canaisChat = () => todosCanais().filter((c) => !cfgCanal(c.id).desligado);
  const icoCanal = (c, tam) => (c.emoji ? el('span', { class: 'ch-emoji-canal', style: `font-size:${Math.round(tam * 0.9)}px`, 'aria-hidden': 'true', text: c.emoji }) : svg(c.ico, tam));
  function canalCriado(c) {
    return {
      id: c.id, nome: c.nome, emoji: c.emoji, ve: c.ve, fala: c.fala, criado_por: c.criado_por, ordem: c.ordem, criado: true, soAdm: c.fala === 'adm',
      vazio: c.ve === 'adm' ? 'Só o Dono e os ADMs veem este canal.' : 'Manda a primeira mensagem.',
    };
  }
  // troca a lista de canais criados (e esquece as mensagens dos que sumiram)
  function aplicarCriados(lista) {
    chat.criados = lista.map(canalCriado).sort((a, b) => (a.ordem || 0) - (b.ordem || 0));
    const ids = new Set(todosCanais().map((c) => c.id));
    for (const id of Object.keys(chat.msgs)) {
      if (ids.has(id)) continue;
      for (const m of chat.msgs[id]) chat.porId.delete(m.id);
      delete chat.msgs[id];
    }
    for (const c of todosCanais()) if (!chat.msgs[c.id]) { chat.msgs[c.id] = []; chat.temMais[c.id] = false; }
  }
  const horaChat = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const nickDoPlayer = (pid, nome) => (pid && jogPorId.get(pid) ? jogPorId.get(pid).nick : nome || 'Membro');
  const nickMsg = (m) => (m.tipo === 'massa' ? 'COBR' : nickDoPlayer(m.player_id, m.nome));
  const meuNick = () => (chat.eu ? nickDoPlayer(chat.eu.player_id, chat.eu.nome) : '');
  const jogandoAte = (s) => (s && s.jogando_ate && Date.parse(s.jogando_ate) > Date.now() ? s.jogando_ate : null);
  const tempoTxt = (s) => (LENTOS.find(([v]) => v === s) || [s, `${s} s`])[1];
  function punicaoAtiva(eu = chat.eu) {
    const p = eu && eu.punicao;
    return p && (!p.ate || Date.parse(p.ate) > Date.now()) ? p : null;
  }
  const foraDoChat = (eu = chat.eu) => { const p = punicaoAtiva(eu); return !!p && p.tipo === 'ban'; };
  function ateTxt(iso) {
    if (!iso) return 'até um ADM liberar';
    const d = new Date(iso);
    return d.toDateString() === new Date().toDateString() ? `até ${horaChat(iso)}` : `até ${d.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })} ${horaChat(iso)}`;
  }
  function rotDia(iso) {
    const d = new Date(iso).toDateString(), ontem = new Date(Date.now() - 86400000).toDateString();
    return d === new Date().toDateString() ? 'HOJE' : d === ontem ? 'ONTEM' : dataCurta(iso).toUpperCase();
  }
  const meMarcou = (m) => !!m.txt && !!meuNick() && new RegExp('@' + escRe(meuNick()) + '(?![\\p{L}\\p{N}_])', 'iu').test(m.txt);
  const chatVisivel = () => pagAtual === 'chat' && !perfilAtual && !torneioAtual && !document.hidden && !document.body.classList.contains('trancado');
  const podeFalar = (c) => !!chat.eu && !punicaoAtiva() && !canalChat(c).soSite && (!canalChat(c).soAdm || admChat()) && (!cfgCanal(c).travado || admChat());
  // bonde chamado no #geral ou num canal criado fica nele; nos outros, vai pro #bonde
  const canalDoBonde = () => (chat.canal === 'geral' || canalChat(chat.canal).criado ? chat.canal : 'bonde');

  // ---------- falar com o banco (na demonstração tudo fica só nesta tela) ----------
  async function chatRpc(nome, args) {
    if (DEMO) return demoChatRpc(nome, args);
    const r = await sb.rpc(nome, args);
    if (r.error) throw Object.assign(new Error(r.error.message), { code: r.error.code });
    return r.data;
  }
  function erroChat(e) {
    const t = String((e && e.message) || '');
    if (/silenciado/.test(t)) { toast('Você está silenciado no chat.', true); recarregarEuChat(); }
    else if (/devagar/.test(t)) toast('Calma! Espera uns segundos pra mandar de novo.', true);
    else if (/lento/.test(t)) toast(`Modo lento: 1 mensagem a cada ${tempoTxt(cfgCanal(chat.canal).lento)} neste canal.`, true);
    else if (/travado/.test(t)) toast('Canal travado pelo ADM.', true);
    else if (/tarde/.test(t)) toast('Só dá pra editar até 15 minutos depois de mandar.', true);
    else if (/foto/.test(t)) toast('Não deu pra enviar essa foto. Tenta outra.', true);
    else if (/audio/.test(t)) toast('Não deu pra enviar o áudio. Tenta de novo.', true);
    else if (/muitos canais/.test(t)) toast('Já tem 20 canais criados. Apague um antes.', true);
    else if ((e && e.code === '42501') || /acesso negado/.test(t)) toast('Sem permissão pra isso.', true);
    else toast('Não deu agora. Tenta de novo.', true);
  }

  // ---------- carregar ----------
  function limparChat() {
    chat.msgs = Object.fromEntries(CANAIS_CHAT.map((c) => [c.id, []]));
    chat.temMais = {};
    chat.criados = []; chat.meus = null;
    chat.porId.clear(); chat.reac.clear(); chat.bonde.clear(); chat.status.clear(); chat.digitando.clear(); chat.equipe.clear(); chat.cfg.clear();
    chat.resp = null; chat.editando = null; chat.novas = 0; chat.denuncias = 0;
  }
  function guardarMsg(m) {
    chat.porId.set(m.id, m);
    const l = chat.msgs[m.canal];
    let i = l.length;
    while (i > 0 && l[i - 1].id > m.id) i--;
    l.splice(i, 0, m);
    return i;
  }
  // mensagens de um canal já com as reações e o bonde de cada uma (uma ida só ao banco)
  const COM_EXTRAS = '*, chat_reacoes(user_id, emoji), chat_bonde(user_id, player_id, nome, created_at)';
  let semExtras = false; // o banco não juntou: as reações vêm numa busca à parte
  async function buscarMsgs(canal, qtd, antesDe = 0) {
    const q = (sel) => {
      let b = sb.from('chat_mensagens').select(sel).eq('canal', canal);
      if (antesDe) b = b.lt('id', antesDe);
      return b.order('id', { ascending: false }).limit(qtd);
    };
    let r = await q(semExtras ? '*' : COM_EXTRAS);
    if (r.error && !semExtras) { semExtras = true; r = await q('*'); }
    if (r.error) throw new Error(r.error.message);
    return r.data;
  }
  // tira as reações e o bonde de dentro das mensagens (ou busca à parte, se não vieram juntos)
  async function extrasDe(lista) {
    const reac = [], bonde = [];
    const juntos = lista.filter((m) => 'chat_reacoes' in m);
    for (const m of juntos) {
      for (const r of m.chat_reacoes || []) reac.push({ msg_id: m.id, ...r });
      for (const b of m.chat_bonde || []) bonde.push({ msg_id: m.id, ...b });
      delete m.chat_reacoes; delete m.chat_bonde;
    }
    const ids = lista.filter((m) => !juntos.includes(m)).map((m) => m.id);
    const bondes = lista.filter((m) => m.tipo === 'bonde' && ids.includes(m.id)).map((m) => m.id);
    if (ids.length) {
      const [rr, rb] = await Promise.all([
        sb.from('chat_reacoes').select('msg_id, user_id, emoji').in('msg_id', ids),
        bondes.length ? sb.from('chat_bonde').select('msg_id, user_id, player_id, nome, created_at').in('msg_id', bondes) : { data: [] },
      ]);
      reac.push(...(rr.data || [])); bonde.push(...(rb.data || []));
    }
    bonde.sort((a, b) => Date.parse(a.created_at) - Date.parse(b.created_at));
    return { reac, bonde };
  }
  function aplicarExtras({ reac, bonde }) {
    for (const r of reac) mexerReac(r.msg_id, r.emoji, r.user_id, true, false);
    for (const b of bonde) mexerBonde(b, true, false);
  }
  let cargaChat = 0;
  async function carregarChat() {
    if (DEMO) { demoChatSemear(); return depoisDeCarregarChat(); }
    const vez = ++cargaChat;
    // tudo de uma vez: quem sou eu, canais, quem está jogando, equipe e as mensagens dos canais fixos
    const [re, rc, rm, rcf, rst, req, ...rb] = await Promise.all([
      sb.rpc('chat_eu'),
      sb.from('chat_canais').select('id, nome, emoji, ve, fala, ordem, criado_por').order('ordem').order('created_at'),
      sb.rpc('chat_meus_canais'),
      sb.from('chat_canais_cfg').select('canal, travado, lento, desligado, nome, emoji, ve, fala'),
      sb.from('chat_status').select('user_id, player_id, nome, jogando_ate').gt('jogando_ate', new Date().toISOString()),
      sb.rpc('chat_equipe'),
      ...CANAIS_CHAT.map((c) => buscarMsgs(c.id, POR_CANAL).catch((e) => e)),
    ]);
    if (re.error) throw new Error(re.error.message);
    const fora = foraDoChat(re.data), criados = fora || rc.error ? [] : rc.data;
    let lotes = [], extras = { reac: [], bonde: [] };
    if (!fora) {
      // os canais criados só dá pra pedir depois de saber quais são
      const rcr = await Promise.all(criados.map((c) => buscarMsgs(c.id, POR_CANAL)));
      lotes = [...CANAIS_CHAT.map((c, i) => [c.id, rb[i]]), ...criados.map((c, i) => [c.id, rcr[i]])];
      for (const [, l] of lotes) if (l instanceof Error) throw l;
      extras = await extrasDe(lotes.flatMap(([, l]) => l));
    }
    if (vez !== cargaChat) return; // outra carga começou depois desta: vale a dela

    // troca tudo de uma vez: o chat na tela não fica vazio enquanto carrega
    const velhas = [...chat.porId.values()], ultimaVelha = velhas.reduce((x, m) => Math.max(x, m.id), 0);
    const { resp, editando, denuncias } = chat;
    chat.eu = re.data;
    limparChat();
    if (!fora) {
      for (const c of rcf.data || []) chat.cfg.set(c.canal, c);
      chat.meus = rm.error ? null : new Set(rm.data || []);
      aplicarCriados(criados);
      for (const [id, l] of lotes) {
        if (!chat.msgs[id]) continue;
        chat.temMais[id] = l.length === POR_CANAL;
        for (const m of l) guardarMsg(m);
      }
      // chegou ao vivo enquanto carregava: não se perde
      for (const m of velhas) if (m.id > ultimaVelha && chat.msgs[m.canal] && !chat.porId.has(m.id)) guardarMsg(m);
      aplicarExtras(extras);
      for (const s of rst.data || []) chat.status.set(s.user_id, s);
      for (const e of req.data || []) chat.equipe.set(e.user_id, e.papel);
      chat.resp = resp && chat.porId.get(resp.id) || null;
      chat.editando = editando && chat.porId.get(editando.id) || null;
      if (admChat()) { chat.denuncias = denuncias; contarDenuncias().catch(() => {}); faxinaSozinha(); }
    }
    depoisDeCarregarChat();
  }
  function depoisDeCarregarChat() {
    if (canalPedido && canaisChat().some((c) => c.id === canalPedido)) chat.canal = canalPedido;
    canalPedido = null;
    lerLidosChat();
    atualizarBadgesChat();
    if (!chatVisivel()) return;
    // recarregou com a pessoa lendo mais acima: a tela fica onde estava
    const box = $('chatMsgs'), topo = box.scrollTop, fim = pertoDoFimChat();
    desenharChat();
    if (!fim) box.scrollTop = topo;
  }
  async function carregarAntigas() {
    const c = chat.canal, l = chat.msgs[c];
    if (DEMO || chat.antigas || !chat.temMais[c] || !l.length) return;
    chat.antigas = true;
    try {
      const data = await buscarMsgs(c, MAIS_ANTIGAS, l[0].id);
      chat.temMais[c] = data.length === MAIS_ANTIGAS;
      const extras = await extrasDe(data);
      const novas = data.filter((m) => !chat.porId.has(m.id));
      for (const m of novas) guardarMsg(m);
      aplicarExtras(extras);
      if (chat.canal === c && chatVisivel()) {
        // segura a tela no mesmo lugar enquanto as mais velhas entram em cima
        const box = $('chatMsgs'), doFim = box.scrollHeight - box.scrollTop;
        desenharMsgsChat(false);
        box.scrollTop = box.scrollHeight - doFim;
      }
    } catch (e) { console.warn('chat:', e.message); } finally { chat.antigas = false; }
  }
  async function recarregarEuChat() {
    if (DEMO) return;
    const antes = { ban: foraDoChat(), adm: admChat() };
    const re = await sb.rpc('chat_eu');
    if (re.error) return;
    chat.eu = re.data;
    if (antes.ban !== foraDoChat()) { carregarChat().catch(() => {}); return; }
    if (!antes.adm && admChat()) { toast('Você agora é ADM do chat.'); contarDenuncias(false); }
    if (antes.adm && !admChat()) toast('Você não é mais ADM do chat.');
    if (chatVisivel()) desenharChat();
  }
  async function recarregarEquipe() {
    if (DEMO) return;
    const r = await sb.rpc('chat_equipe');
    if (r.error) return;
    chat.equipe = new Map((r.data || []).map((e) => [e.user_id, e.papel]));
    if (chatVisivel()) desenharMsgsChat(false);
  }
  async function contarDenuncias(redesenhar = true) {
    if (DEMO) { chat.denuncias = new Set(demoChat.denuncias.map((d) => d.msg_id)).size; }
    else {
      const r = await sb.from('chat_denuncias').select('msg_id');
      chat.denuncias = r.error ? 0 : new Set(r.data.map((d) => d.msg_id)).size;
    }
    if (redesenhar && chatVisivel()) desenharTopoChat();
  }

  // ---------- ao vivo ----------
  // começa junto com o resto do site (site = a carga dele); o ao vivo só liga quando os dois terminam
  function ligarChat(site = Promise.resolve()) {
    if (chat.ligado) return;
    chat.ligado = true;
    (DEMO ? site.then(carregarChat) : Promise.all([carregarChat(), site]))
      .then(() => { if (!DEMO) { ligarChatAoVivo(); religarPush(); } })
      .catch((e) => { console.warn('chat:', e.message); chat.ligado = false; });
  }
  function ligarChatAoVivo() {
    const tabela = (t, fn) => ['postgres_changes', { event: '*', schema: 'public', table: t }, fn];
    chat.rt = sb.channel('chat-ao-vivo')
      .on(...tabela('chat_mensagens', (p) => { if (p.eventType === 'DELETE') sumiuMsg(p.old.id); else chegouMsg(p.new); }))
      .on(...tabela('chat_reacoes', (p) => { const r = p.eventType === 'DELETE' ? p.old : p.new; mexerReac(r.msg_id, r.emoji, r.user_id, p.eventType !== 'DELETE'); }))
      .on(...tabela('chat_bonde', (p) => mexerBonde(p.eventType === 'DELETE' ? p.old : p.new, p.eventType !== 'DELETE')))
      .on(...tabela('chat_status', (p) => { if (p.new && p.new.user_id) { chat.status.set(p.new.user_id, p.new); if (chatVisivel()) { desenharMembrosChat(); desenharTopoChat(); } } }))
      .on(...tabela('chat_punicoes', () => { recarregarEuChat(); if (admChat() && $('dlgModeracao').open) abrirModeracao(); }))
      .on(...tabela('chat_adms', () => { recarregarEquipe(); recarregarEuChat(); canaisMudaram(); }))
      .on(...tabela('chat_canais', canaisMudaram))
      .on(...tabela('chat_canal_membros', canaisMudaram))
      .on(...tabela('chat_canais_cfg', (p) => {
        if (!p.new || !p.new.canal) return;
        const antes = chat.cfg.get(p.new.canal);
        chat.cfg.set(p.new.canal, p.new);
        // o Dono mudou quem vê um canal do site: recarrega (pode ter aparecido ou sumido pra esta conta)
        if (((antes && antes.ve) || null) !== (p.new.ve || null)) { canaisMudaram(); return; }
        atualizarBadgesChat(); if (chatVisivel()) desenharChat();
      }))
      .on(...tabela('chat_denuncias', (p) => {
        if (!admChat()) return;
        contarDenuncias();
        if (p.eventType === 'INSERT') toast('Nova denúncia no chat. Veja em Moderação.');
        if ($('dlgModeracao').open) abrirModeracao();
      }))
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED') return;
        // voltou depois de cair (celular em segundo plano): pega o que chegou nesse meio tempo
        if (chat.conectou) carregarChat().catch(() => {});
        chat.conectou = true;
      });
    ligarPresenca();
  }
  // quem está online: a mesma presença serve o chat e a sala de jogos
  function ligarPresenca(soJogos = false) {
    const pr = sb.channel('chat-online', { config: { presence: { key: euChat() } } });
    pr.on('presence', { event: 'sync' }, () => {
      chat.online = new Map(Object.entries(pr.presenceState()).map(([k, l]) => [k, l[0] || {}]));
      if (!soJogos && chatVisivel()) desenharMembrosChat();
      avisarJogos('online');
    });
    if (!soJogos) {
      pr.on('broadcast', { event: 'digitando' }, ({ payload }) => alguemDigitando(payload))
        .on('broadcast', { event: 'toque' }, ({ payload }) => tocaramChat(payload).catch(() => {}));
    }
    pr.subscribe((st) => { if (st === 'SUBSCRIBED') { chat.presencaOk = true; marcarOnline(); } });
    chat.presenca = pr;
  }
  // amigo: não lê o chat, só entra na presença (aparece online na sala de jogos e pode ser chamado)
  function ligarPresencaJogos(site = Promise.resolve()) {
    if (chat.ligado || DEMO) return;
    chat.ligado = true;
    chat.eu = { user_id: contaUid, player_id: euId, nome: '', adm: false, dono: false, punicao: null };
    site.then(() => { if (chat.ligado && !chat.presenca) ligarPresenca(true); })
      .catch((e) => { console.warn('presença:', e.message); chat.ligado = false; });
  }
  // o "online" do chat é o mesmo da sala de jogos: junto vai a partida de damas em que a pessoa está
  function marcarOnline() {
    if (chat.presenca && chat.presencaOk && chat.eu) chat.presenca.track({ player_id: chat.eu.player_id, nome: meuNick(), jogando: chat.jogando || null }).catch(() => {});
  }
  function marcarJogando(id) {
    if ((chat.jogando || null) === (id || null)) return;
    chat.jogando = id || null;
    marcarOnline();
  }
  // ao sair da conta: este aparelho para de receber as notificações dela
  async function desligarChat() {
    if (!DEMO && sb && chat.eu) {
      try {
        const reg = 'serviceWorker' in navigator ? await navigator.serviceWorker.getRegistration() : null;
        const sub = reg && reg.pushManager ? await reg.pushManager.getSubscription() : null;
        if (sub) { await sb.rpc('push_sair', { p_endpoint: sub.endpoint }); await sub.unsubscribe(); }
      } catch (e) {}
    }
    if (sb && chat.rt) sb.removeChannel(chat.rt);
    if (sb && chat.presenca) sb.removeChannel(chat.presenca);
    chat.rt = null; chat.presenca = null; chat.presencaOk = false; chat.jogando = null; chat.conectou = false; chat.ligado = false; chat.eu = null;
    chat.online.clear();
    limparChat();
    atualizarBadgesChat();
  }

  // criaram, mudaram ou apagaram um canal (ou esta conta entrou ou saiu de um): carrega tudo de novo
  let canaisTimer = 0;
  function canaisMudaram() {
    clearTimeout(canaisTimer);
    canaisTimer = setTimeout(() => carregarChat().catch((e) => console.warn('chat:', e.message)), 500);
  }
  function chegouMsg(m) {
    if (chat.porId.has(m.id)) { atualizarMsg(m); return; }
    if (!chat.msgs[m.canal]) { if (!DEMO) canaisMudaram(); return; }
    if (m.fixada) for (const x of chat.msgs[m.canal]) x.fixada = false;
    chat.digitando.delete(m.user_id);
    const i = guardarMsg(m), l = chat.msgs[m.canal];
    const meu = !!m.user_id && m.user_id === euChat();
    if (chatVisivel() && chat.canal === m.canal) {
      if (i !== l.length - 1) { desenharMsgsChat(); return; }
      const box = $('chatMsgs'), fim = pertoDoFimChat() || meu;
      const ant = l[i - 1];
      box.querySelector('.ch-vazio')?.remove();
      if (!ant || new Date(ant.created_at).toDateString() !== new Date(m.created_at).toDateString()) box.append(el('div', { class: 'ch-dia', text: rotDia(m.created_at) }));
      if (m.tipo === 'massa') m._conta = true;
      const n = linhaChat(m, ant && new Date(ant.created_at).toDateString() === new Date(m.created_at).toDateString() ? ant : null);
      n.classList.add('entra');
      box.append(n);
      if (fim) { descerChat(true); marcarLidoChat(); } else mostrarNovasChat();
      desenharDigitando();
      if (m.fixada) desenharFixadaChat();
    } else if (!meu && meMarcou(m)) {
      toast(`${nickMsg(m)} te marcou no #${nomeCanal(m.canal)}`);
    }
    atualizarBadgesChat();
  }
  function atualizarMsg(novo) {
    const m = chat.porId.get(novo.id);
    if (!m) return;
    if (novo.fixada && !m.fixada) for (const x of chat.msgs[m.canal]) x.fixada = false;
    Object.assign(m, novo);
    if (m.apagada) chat.reac.delete(m.id);
    trocarLinhaChat(m);
    if (chatVisivel() && chat.canal === m.canal) desenharFixadaChat();
    atualizarBadgesChat();
  }
  // redesenhar false: quem chamou redesenha uma vez só no fim (limpeza de muitas)
  function sumiuMsg(id, redesenhar = true) {
    const m = chat.porId.get(id);
    if (!m) return;
    chat.porId.delete(id); chat.reac.delete(id); chat.bonde.delete(id);
    chat.msgs[m.canal] = chat.msgs[m.canal].filter((x) => x.id !== id);
    // quem respondeu fica só sem a citação (o banco faz o mesmo)
    for (const x of chat.msgs[m.canal]) if (x.resp === id) x.resp = null;
    if ((chat.resp && chat.resp.id === id) || (chat.editando && chat.editando.id === id)) cancelarRespChat();
    if (!redesenhar) return;
    if (chatVisivel() && chat.canal === m.canal) { desenharMsgsChat(false); desenharFixadaChat(); }
    atualizarBadgesChat();
  }
  function mexerReac(id, emoji, user, liga, redesenhar = true) {
    let r = chat.reac.get(id);
    if (!r) chat.reac.set(id, (r = new Map()));
    let s = r.get(emoji);
    if (!s) { s = new Set(); r.set(emoji, s); }
    const tinha = s.has(user);
    if (liga) s.add(user); else s.delete(user);
    if (redesenhar && tinha !== liga && chat.porId.has(id)) trocarLinhaChat(chat.porId.get(id), liga ? emoji : null);
  }
  function mexerBonde(b, entra, redesenhar = true) {
    const l = (chat.bonde.get(b.msg_id) || []).filter((x) => x.user_id !== b.user_id);
    if (entra) l.push({ user_id: b.user_id, player_id: b.player_id, nome: b.nome });
    chat.bonde.set(b.msg_id, l);
    if (redesenhar && chat.porId.has(b.msg_id)) trocarLinhaChat(chat.porId.get(b.msg_id));
  }

  // ---------- não lidas (guardado neste aparelho) ----------
  function lerLidosChat() {
    let salvo = null;
    try { salvo = JSON.parse(localStorage.getItem('chat_lido_' + euChat()) || 'null'); } catch (e) {}
    chat.lido = salvo || {};
    // primeira vez neste aparelho: começa sem nada pendente
    for (const c of todosCanais()) if (!(c.id in chat.lido)) { const l = chat.msgs[c.id]; chat.lido[c.id] = l.length ? l[l.length - 1].id : 0; }
    salvarLidosChat();
  }
  function salvarLidosChat() { try { localStorage.setItem('chat_lido_' + euChat(), JSON.stringify(chat.lido)); } catch (e) {} }
  const naoLidasChat = (c) => chat.msgs[c].filter((m) => m.id > (chat.lido[c] || 0) && m.user_id !== euChat() && !m.apagada).length;
  function marcarLidoChat() {
    if (!chatVisivel()) return;
    const l = chat.msgs[chat.canal];
    const ult = l.length ? l[l.length - 1].id : 0;
    if ((chat.lido[chat.canal] || 0) >= ult) return;
    chat.lido[chat.canal] = ult;
    salvarLidosChat();
    atualizarBadgesChat();
  }
  function atualizarBadgesChat() {
    const total = chat.eu ? canaisChat().reduce((s, c) => s + naoLidasChat(c.id), 0) : 0;
    document.querySelectorAll('[data-badge-chat]').forEach((b) => { b.hidden = !total; b.textContent = total > 99 ? '99+' : String(total); });
    if (chatVisivel()) desenharCanaisChat();
  }

  // ---------- desenho ----------
  function avatarChat(nick, tam = '') {
    if (nick === 'COBR') { const a = el('span', { class: `av av-bot ${tam}`, 'aria-hidden': 'true' }); a.append(el('img', { src: 'logo-cobr.webp', alt: '' })); return a; }
    return avatarDe(nick, ptsPat(chave(nick)), tam);
  }
  function escudoDe(p, letra, tam = 'av-m') {
    if (!p.nivel) return el('span', { class: `av ${tam}`, style: `--pc:${p.cor}`, 'aria-hidden': 'true', text: letra });
    const a = el('span', { class: `av av-esc ${tam} ${p.diamante ? 'esc-dia' : ''}`, style: `--pc:${p.cor}`, 'aria-hidden': 'true' });
    a.innerHTML = escudoSVG(p, letra);
    return a;
  }
  const tagPapel = (papel) => (papel === 'dono' ? el('span', { class: 'ch-tag ch-tag-dono', text: 'DONO' })
    : papel === 'adm' ? el('span', { class: 'ch-tag ch-tag-adm', text: 'ADM' }) : null);
  function tagsChat(m, nick) {
    if (nick === 'COBR') return [el('span', { class: 'ch-tag ch-tag-bot', text: 'AUTOMÁTICO' })];
    const k = chave(nick);
    return [chipLider(k), chipPatente(ptsPat(k)), chipRei(k), papelDe(m.user_id) === 'adm' ? tagPapel('adm') : null]; // no chat só o ADM leva etiqueta; a de Dono fica nas telas de equipe
  }
  function textoChat(txt, editada = false) {
    const s = el('div', { class: 'ch-txt' });
    const eu = chave(meuNick());
    for (const parte of String(txt || '').split(/(@[\p{L}\p{N}_.-]+)/u)) {
      const k = parte.startsWith('@') ? chave(parte.slice(1)) : null;
      if (k && elenco.has(k)) s.append(el('span', { class: `ch-mencao ${k === eu ? 'eu' : ''}`, text: parte }));
      else if (parte) s.append(parte);
    }
    if (editada) s.append(el('span', { class: 'ch-editada', text: 'editada' }));
    return s;
  }
  function resumoChat(m) {
    if (m.apagada) return 'mensagem apagada';
    if (m.tipo === 'massa') return `${nomeDe(chave(m.dados.player || ''), m.dados.player || '')} fez ${fmt(m.dados.mass || 0)} de massa`;
    if (m.tipo === 'bonde') return `bonde · ${(m.dados && m.dados.srv) || 'Servidor BR'}`;
    if (m.tipo === 'foto') return m.txt ? `📷 ${m.txt}` : '📷 Foto';
    if (m.tipo === 'audio') return `🎤 Áudio ${tempoAudio((m.dados && m.dados.dur) || 0)}`;
    return m.txt;
  }
  // a partida dessa massa fez o jogador subir de patente na temporada?
  function subidaDe(id) {
    const p = partidas.find((x) => x.id === id);
    if (!p) return null;
    const k = chave(p.player), t = Date.parse(p.created_at), d = new Date(t);
    const x = patTemp(k, t), desde = new Date(d.getFullYear(), d.getMonth(), 1).getTime();
    let antes = PATENTES[x ? x.ini : 0].pontos;
    for (const q of partidas) {
      const tq = Date.parse(q.created_at);
      if (q !== p && chave(q.player) === k && tq >= desde && tq <= t && (tq < t || q.id < p.id)) antes += pontosDe(q.mass);
    }
    const de = patenteDe(antes).atual, para = patenteDe(antes + pontosDe(p.mass)).atual;
    return para.nivel > de.nivel ? { de, para } : null;
  }
  function recordeDoMes(id) {
    const p = partidas.find((x) => x.id === id);
    if (!p) return false;
    const mk = mesChave(Date.parse(p.created_at));
    return !partidas.some((q) => q !== p && q.mass > p.mass && mesChave(Date.parse(q.created_at)) === mk);
  }
  function contarAte(span, alvo) {
    const ini = performance.now(), dur = 1200;
    const passo = (t) => {
      const k = Math.min(1, (t - ini) / dur);
      span.textContent = fmt(Math.round(alvo * (1 - Math.pow(1 - k, 3))));
      if (k < 1) requestAnimationFrame(passo);
    };
    requestAnimationFrame(passo);
  }
  function cartaoMassa(m) {
    const d = m.dados || {}, k = chave(d.player || ''), nick = nomeDe(k, d.player || '');
    const num = el('span', { text: fmt(d.mass || 0) });
    if (m._conta) { m._conta = false; contarAte(num, d.mass || 0); }
    const sobe = subidaDe(d.score_id);
    return el('div', { class: 'ch-cv ch-cv-massa' },
      el('div', { class: 'ch-cv-rot' }, svg(ICONE_CHAMA, 14), 'NOVA MASSA NO RANKING'),
      el('button', { type: 'button', class: 'ch-cv-quem', onclick: () => abrirPerfil(k) }, avatarChat(nick, 'av-p'), el('b', { text: nick })),
      el('div', { class: 'ch-cv-num' }, num, el('small', { text: 'MASSA' })),
      el('div', { class: 'ch-cv-linha' },
        el('span', { class: 'ch-cv-pts', text: `+${ptsTxt(pontosDe(d.mass || 0))}` }),
        d.mass >= META ? el('span', { text: `passou de ${fmtK(Math.floor(d.mass / META) * META)}` }) : null,
        recordeDoMes(d.score_id) ? el('span', { class: 'ch-selo', text: 'RECORDE DO MÊS' }) : null),
      sobe ? el('div', { class: 'ch-sobe', style: `--pc:${sobe.para.cor}` },
        escudoDe(sobe.de, nick.charAt(0).toUpperCase(), 'av-m ch-sobe-de'),
        el('span', { class: 'ch-sobe-seta' }, svg(ICONE_SETA, 22)),
        escudoDe(sobe.para, nick.charAt(0).toUpperCase(), 'av-m ch-sobe-para'),
        el('span', { class: 'ch-sobe-txt' }, 'SUBIU PRA', chipPatente(sobe.para.pontos))) : null);
  }
  function cartaoBonde(m) {
    const d = m.dados || {}, max = d.max || 6, gente = chat.bonde.get(m.id) || [];
    const dentro = gente.some((g) => g.user_id === euChat());
    const fechado = Date.now() - Date.parse(m.created_at) > BONDE_DURA;
    const cheio = gente.length >= max;
    const pode = !fechado && !punicaoAtiva() && (dentro || !cheio);
    return el('div', { class: `ch-cv ch-cv-bonde ${fechado ? 'fechado' : ''}` },
      el('div', { class: 'ch-cv-rot' }, svg(ICONE_BONDE, 14), m.user_id === euChat() ? 'SEU BONDE' : `BONDE DO ${nickMsg(m).toUpperCase()}`),
      el('div', { class: 'ch-cv-tit', text: d.srv || 'Servidor BR' }),
      m.txt ? el('div', { class: 'ch-cv-nota', text: m.txt }) : null,
      el('div', { class: 'ch-bonde-gente' },
        ...gente.map((g) => { const n = nickDoPlayer(g.player_id, g.nome); return el('span', { class: 'ch-bonde-av', title: n }, avatarChat(n, 'av-p')); }),
        ...Array.from({ length: Math.max(0, max - gente.length) }, () => el('span', { class: 'ch-vaga' }))),
      el('div', { class: 'ch-bonde-pe' },
        el('span', { class: 'ch-bonde-cont' }, `${gente.length}/${max}`, el('small', { text: fechado ? 'ENCERRADO' : cheio ? 'LOTADO' : 'NO BONDE' })),
        pode ? el('button', { type: 'button', class: `btn ${dentro ? 'btn-sec' : 'btn-bonde'}`, onclick: () => entrarNoBonde(m, !dentro), text: dentro ? 'Sair' : 'Tô dentro' }) : null));
  }
  // fotos ficam numa pasta fechada: o link vale por algumas horas
  const urlsFoto = new Map();
  async function urlFoto(path) {
    const c = urlsFoto.get(path);
    if (c && c.ate > Date.now()) return c.url;
    if (DEMO || !path) return null;
    const { data } = await sb.storage.from('chat').createSignedUrl(path, 6 * 3600);
    if (!data) return null;
    urlsFoto.set(path, { url: data.signedUrl, ate: Date.now() + 5 * 3600000 });
    return data.signedUrl;
  }
  function cartaoFoto(m) {
    const d = m.dados || {};
    // a faxina tira o arquivo depois de 30 dias
    if (d.expirada || !d.path) return [el('div', { class: 'ch-foto sem ch-foto-exp' }, svg(ICONE_FOTO, 18), 'foto expirada'), m.txt ? textoChat(m.txt, m.editada) : null];
    const img = el('img', { alt: m.txt ? `Foto: ${m.txt}` : 'Foto', decoding: 'async' });
    const box = el('button', { type: 'button', class: 'ch-foto', 'aria-label': 'Ver foto grande', style: `aspect-ratio:${d.w || 4} / ${d.h || 3}`,
      onclick: () => { if (img.src) abrirPrintLivre(img.src, `${nickMsg(m)} · ${horaChat(m.created_at)}${m.txt ? ' · ' + m.txt : ''}`); } }, img);
    urlFoto(d.path).then((u) => { if (u) img.src = u; else box.classList.add('sem'); });
    return [box, m.txt ? textoChat(m.txt, m.editada) : null];
  }
  // áudio: o desenho da onda vem na mensagem (um dígito de 0 a 9 por barrinha). Toca um por vez.
  const BARRAS_AUDIO = 40;
  const tempoAudio = (s) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const tocando = { a: null, id: null, m: null, box: null, vel: 1, vez: 0, raf: 0 };
  const velTxt = () => `${String(tocando.vel).replace('.', ',')}x`;
  const durDe = (a, m) => (a && isFinite(a.duration) && a.duration > 0 ? a.duration : (m && m.dados && m.dados.dur) || 1);
  function cartaoAudio(m) {
    const d = m.dados || {};
    if (d.expirada || !d.path) return el('div', { class: 'ch-foto sem ch-foto-exp' }, svg(ICONE_MIC, 18), 'áudio expirado');
    const onda = /^[0-9]+$/.test(d.onda || '') ? [...d.onda].map(Number) : [];
    const box = el('div', { class: 'ch-audio' });
    box.append(
      el('button', { type: 'button', class: 'ch-au-play', 'aria-label': 'Tocar áudio', onclick: () => tocarAudio(m, box) }, svg(ICONE_PLAY, 16)),
      el('div', { class: 'ch-au-onda', onclick: (e) => pularAudio(m, box, e) },
        ...Array.from({ length: BARRAS_AUDIO }, (_, i) => el('i', { style: `--h:${(onda.length ? onda[Math.floor((i * onda.length) / BARRAS_AUDIO)] : 2) / 9}` }))),
      el('button', { type: 'button', class: 'ch-au-vel', 'aria-label': 'Velocidade do áudio', onclick: velAudio, text: velTxt() }),
      el('span', { class: 'ch-au-tempo', text: tempoAudio(d.dur || 0) }));
    // a linha é redesenhada (reação nova etc.) enquanto toca: o player novo assume
    if (tocando.id === m.id && tocando.a) { tocando.box = box; pintarAudio(box, tocando.a, durDe(tocando.a, m)); }
    return box;
  }
  function pintarAudio(box, a, dur) {
    const p = a ? Math.min(1, a.currentTime / dur) : 0, toca = !!a && !a.paused;
    box.classList.toggle('toca', !!a);
    box.querySelectorAll('.ch-au-onda i').forEach((b, i) => b.classList.toggle('on', i < Math.round(p * BARRAS_AUDIO)));
    box.querySelector('.ch-au-tempo').textContent = tempoAudio(a ? a.currentTime : dur);
    const bt = box.querySelector('.ch-au-play');
    if (bt.dataset.toca !== String(toca)) {
      bt.dataset.toca = String(toca);
      bt.replaceChildren(svg(toca ? ICONE_PAUSA : ICONE_PLAY, 16));
      bt.setAttribute('aria-label', toca ? 'Pausar áudio' : 'Tocar áudio');
    }
  }
  function rodarAudio() {
    const t = tocando;
    cancelAnimationFrame(t.raf);
    if (!t.a) return;
    if (!t.box.isConnected) { pararAudio(); return; } // a mensagem sumiu ou trocou de canal
    pintarAudio(t.box, t.a, durDe(t.a, t.m));
    if (!t.a.paused) t.raf = requestAnimationFrame(rodarAudio);
  }
  function pararAudio() {
    const t = tocando, a = t.a;
    cancelAnimationFrame(t.raf);
    t.vez++;
    if (a) { a.onplay = a.onpause = a.onended = a.onerror = null; a.pause(); }
    if (t.box && t.m) pintarAudio(t.box, null, (t.m.dados && t.m.dados.dur) || 0);
    Object.assign(t, { a: null, id: null, m: null, box: null });
  }
  async function tocarAudio(m, box) {
    const t = tocando;
    if (t.id === m.id && t.a) {
      t.box = box;
      if (t.a.paused) t.a.play().catch(() => {}); else t.a.pause();
      return;
    }
    pararAudio();
    const vez = t.vez, bt = box.querySelector('.ch-au-play');
    bt.disabled = true;
    const url = await urlFoto(m.dados.path);
    bt.disabled = false;
    if (vez !== t.vez) return;
    if (!url) { toast('Não deu pra carregar o áudio.', true); return; }
    const a = new Audio(url);
    a.playbackRate = t.vel;
    Object.assign(t, { a, id: m.id, m, box });
    a.onplay = rodarAudio;
    a.onpause = rodarAudio;
    a.onended = pararAudio;
    a.onerror = () => { pararAudio(); toast('Este aparelho não conseguiu tocar esse áudio.', true); };
    try { await a.play(); } catch (e) { if (t.a === a && e.name !== 'AbortError') a.onerror(); }
  }
  async function pularAudio(m, box, e) {
    const r = e.currentTarget.getBoundingClientRect(), f = Math.max(0, Math.min(1, (e.clientX - r.left) / r.width));
    const t = tocando;
    if (t.id !== m.id || !t.a) await tocarAudio(m, box);
    if (t.id !== m.id || !t.a) return;
    t.a.currentTime = f * durDe(t.a, m);
    rodarAudio();
  }
  function velAudio() {
    const t = tocando;
    t.vel = t.vel === 1 ? 1.5 : t.vel === 1.5 ? 2 : 1;
    if (t.a) t.a.playbackRate = t.vel;
    if (t.box) t.box.querySelector('.ch-au-vel').textContent = velTxt();
  }
  const protegido = (u) => !!papelDe(u);
  const podeEditar = (m, meu) => meu && (m.tipo === 'msg' || m.tipo === 'foto') && !punicaoAtiva() && Date.now() - Date.parse(m.created_at) < EDITA_ATE;
  function acoesChat(m, nick, meu) {
    const b = (ico, rot, fn, cls = '') => el('button', { type: 'button', class: cls, title: rot, 'aria-label': rot, onclick: fn }, svg(ico, 17));
    const voz = !!chat.eu && !punicaoAtiva();
    const mexe = admChat() && m.tipo !== 'massa' && (!protegido(m.user_id) || donoChat());
    return el('div', { class: 'ch-acoes' },
      voz ? b(ICONE_SORRISO, 'Reagir', (e) => abrirEmojisChat(e.currentTarget, (x) => reagirChat(m, x))) : null,
      podeFalar(m.canal) ? b(ICONE_RESPONDER, 'Responder', () => responderChat(m)) : null,
      podeEditar(m, meu) ? b(ICONE_LAPIS, 'Editar', () => editarChat(m)) : null,
      admChat() && m.tipo !== 'massa' ? b(ICONE_FIXAR, m.fixada ? 'Desafixar' : 'Fixar no topo', () => fixarChat(m, !m.fixada), m.fixada ? 'on' : '') : null,
      admChat() && m.user_id && !meu && !protegido(m.user_id) ? b(ICONE_MUDO, `Punir ${nick}`, () => abrirPunir({ user_id: m.user_id, nick })) : null,
      !admChat() && !meu && m.user_id ? b(ICONE_BANDEIRA, 'Denunciar pros ADMs', () => denunciarChat(m, nick)) : null,
      meu || mexe ? b(ICONE_LIXO, 'Apagar', () => apagarChat(m, nick, meu), 'perigo') : null);
  }
  function linhaChat(m, ant, pop = null) {
    const nick = nickMsg(m), meu = !!m.user_id && m.user_id === euChat();
    const cont = !!ant && !!m.user_id && ant.user_id === m.user_id && m.tipo === 'msg' && ant.tipo === 'msg' && m.canal !== 'avisos'
      && !m.resp && Date.parse(m.created_at) - Date.parse(ant.created_at) < 4 * 60000;
    const brabo = !!m.user_id && ehLider(chave(nick));
    const n = el('div', { class: `ch-m ${cont ? 'cont' : ''} ${brabo ? 'lider' : ''} ${!m.apagada && !meu && meMarcou(m) ? 'mencao' : ''}`, 'data-id': m.id });
    n.append(el('div', { class: 'ch-m-av' }, cont ? el('span', { class: 'ch-hora-lado', text: horaChat(m.created_at) }) : avatarChat(nick)));
    const corpo = el('div', { class: 'ch-m-corpo' });
    if (!cont) {
      const temPerfil = nick !== 'COBR' && elenco.has(chave(nick));
      corpo.append(el('div', { class: 'ch-m-cab' },
        el('button', { type: 'button', class: `ch-nick ${brabo ? 'lider-nick' : ''}`, disabled: !temPerfil, style: `--pc:${nick === 'COBR' ? 'var(--laranja-claro)' : patenteDe(ptsPat(chave(nick))).atual.cor}`, onclick: () => abrirPerfil(chave(nick)), text: nick }),
        ...tagsChat(m, nick), m.tipo === 'massa' ? null : el('span', { class: 'ch-hora', text: horaChat(m.created_at) })));
    }
    if (m.resp) {
      const r = chat.porId.get(m.resp);
      corpo.append(el('button', { type: 'button', class: 'ch-cita', onclick: () => r && irParaMsg(r.id) },
        svg(ICONE_CITA, 13), r ? el('b', { text: nickMsg(r) }) : null, el('span', { text: r ? resumoChat(r) : 'mensagem antiga' })));
    }
    if (m.apagada) corpo.append(el('div', { class: 'ch-txt apagada', text: 'mensagem apagada' }));
    else if (m.tipo === 'massa') corpo.append(cartaoMassa(m));
    else if (m.tipo === 'bonde') corpo.append(cartaoBonde(m));
    else if (m.tipo === 'foto') corpo.append(...cartaoFoto(m).filter(Boolean));
    else if (m.tipo === 'audio') corpo.append(cartaoAudio(m));
    else if (m.canal === 'avisos') corpo.append(el('div', { class: 'ch-cv ch-cv-aviso' }, el('div', { class: 'ch-cv-rot' }, svg(ICONE_MEGAFONE, 14), 'AVISO'), textoChat(m.txt, m.editada)));
    else corpo.append(textoChat(m.txt, m.editada));
    const reacs = [...(chat.reac.get(m.id) || new Map())].filter(([, s]) => s.size);
    if (reacs.length && !m.apagada) corpo.append(el('div', { class: 'ch-reacoes' }, ...reacs.map(([e, s]) =>
      el('button', { type: 'button', class: `ch-reac ${s.has(euChat()) ? 'minha' : ''} ${pop === e ? 'pop' : ''}`, 'aria-label': `${e} ${s.size}`, onclick: () => reagirChat(m, e) },
        el('span', { class: e === 'GG' ? 'ch-gg' : '', text: e }), String(s.size)))));
    n.append(corpo);
    if (!m.apagada) n.append(acoesChat(m, nick, meu));
    return n;
  }
  function anteriorNoDia(m) {
    const l = chat.msgs[m.canal], i = l.indexOf(m), a = l[i - 1];
    return a && new Date(a.created_at).toDateString() === new Date(m.created_at).toDateString() ? a : null;
  }
  function trocarLinhaChat(m, pop = null) {
    if (!chatVisivel() || chat.canal !== m.canal) return;
    const velho = $('chatMsgs').querySelector(`.ch-m[data-id="${m.id}"]`);
    if (!velho) return;
    const novo = linhaChat(m, anteriorNoDia(m), pop);
    if (velho.classList.contains('ativa')) novo.classList.add('ativa');
    velho.replaceWith(novo);
  }
  const pertoDoFimChat = () => { const b = $('chatMsgs'); return b.scrollHeight - b.scrollTop - b.clientHeight < 140; };
  const descerChat = (suave) => { const b = $('chatMsgs'); b.scrollTo({ top: b.scrollHeight, behavior: suave ? 'smooth' : 'auto' }); };
  function mostrarNovasChat() {
    chat.novas++;
    const b = $('chatNovas');
    trocar(b, svg(ICONE_DESCE, 14), `${chat.novas} ${chat.novas > 1 ? 'NOVAS' : 'NOVA'}`);
    b.hidden = false;
  }
  function irParaMsg(id) {
    const n = $('chatMsgs').querySelector(`.ch-m[data-id="${id}"]`);
    if (!n) return;
    n.scrollIntoView({ behavior: 'smooth', block: 'center' });
    n.classList.remove('brilha'); void n.offsetWidth; n.classList.add('brilha');
  }

  function desenharChat() {
    if (!chat.eu) { trocar($('chatMsgs'), el('div', { class: 'ch-vazio', text: 'Carregando o chat…' })); return; }
    if (cfgCanal(chat.canal).desligado || !canaisChat().some((c) => c.id === chat.canal)) chat.canal = 'geral';
    desenharCanaisChat(); desenharTopoChat(); desenharBraboChat(); desenharMsgsChat(); desenharComporChat(); desenharMembrosChat(); desenharDigitando();
  }
  function desenharCanaisChat() {
    trocar($('chatCanais'), el('div', { class: 'ch-lado-rot', text: 'CANAIS' }), ...canaisChat().map((c) => {
      const n = chat.eu ? naoLidasChat(c.id) : 0;
      const travado = c.soAdm || cfgCanal(c.id).travado;
      return el('button', { type: 'button', class: `ch-canal ${n ? 'tem' : ''}`, 'aria-current': String(c.id === chat.canal), onclick: () => abrirCanalChat(c.id) },
        icoCanal(c, 17), el('span', { class: 'ch-canal-nome', text: c.nome }),
        c.ve === 'adm' ? el('span', { class: 'ch-canal-tag', text: 'ADM', title: 'Só Dono e ADMs veem' })
          : c.ve === 'escolhidos' ? svg(ICONE_GENTE, 13, 'class="ch-trava"') : null,
        travado ? svg(ICONE_TRAVA, 13, 'class="ch-trava"') : null,
        n ? el('span', { class: 'ch-badge', text: n > 99 ? '99+' : String(n) }) : null);
    }), admChat() && !foraDoChat() ? el('button', { type: 'button', class: 'ch-canal ch-canal-novo', onclick: () => abrirCanalForm() }, svg(ICONE_MAIS, 17), el('span', { class: 'ch-canal-nome', text: 'Novo canal' })) : null);
  }
  function desenharTopoChat() {
    const cfg = cfgCanal(chat.canal);
    trocar($('chatTitulo'), el('span', { class: 'laranja', text: '#' }), canalChat(chat.canal).nome,
      cfg.travado ? el('span', { class: 'ch-estado', text: 'TRAVADO' }) : cfg.lento ? el('span', { class: 'ch-estado', text: `LENTO · ${tempoTxt(cfg.lento)}` }) : null);
    const ate = jogandoAte(chat.status.get(euChat()));
    const b = $('chatJogando');
    b.hidden = !chat.eu || foraDoChat();
    b.classList.toggle('on', !!ate);
    b.setAttribute('aria-pressed', String(!!ate));
    trocar(b, el('i', { class: 'ch-bola' }), ate ? `JOGANDO · até ${horaChat(ate)}` : 'TÔ JOGANDO');
    const ed = $('chatCanalBtn'), c = canalChat(chat.canal);
    ed.hidden = !podeEditarCanal(c);
    if (!ed.firstChild) ed.append(svg(ICONE_LAPIS, 18));
    ed.onclick = () => abrirCanalForm(c);
    const mod = $('chatModBtn');
    mod.hidden = !admChat();
    trocar(mod, svg(ICONE_MODERAR, 18), el('span', { class: 'ch-mod-rot', text: 'Moderação' }), chat.denuncias ? el('span', { class: 'ch-badge', text: String(chat.denuncias) }) : null);
  }
  // faixa do 1º da temporada no topo do chat, em todo canal
  function desenharBraboChat() {
    const f = $('chatBrabo'), l = foraDoChat() ? null : liderTemp();
    f.hidden = !l;
    if (!l) return;
    const n = numTemp(Date.now()), eu = l.chave === chave(meuNick());
    f.classList.toggle('eu', eu);
    comParede(f, l.chave);
    trocar(f, el('span', { class: 'ch-brabo-av' }, avatarChat(l.nome, 'av-p')),
      el('span', { class: 'ch-brabo-rot' }, svg(ICONE_CHAMA, 13), n >= 1 ? `TOP 1 · T${n}` : 'TOP 1'),
      el('b', { class: 'ch-brabo-nick', text: l.nome }),
      el('span', { class: 'ch-brabo-pts', text: ptsTxt(l.pontos) }));
    f.onclick = () => abrirPerfil(l.chave);
  }
  function desenharMsgsChat(descer = true) {
    const box = $('chatMsgs');
    if (descer) { chat.novas = 0; $('chatNovas').hidden = true; }
    if (foraDoChat()) {
      const p = punicaoAtiva();
      trocar(box, el('div', { class: 'ch-fora' }, svg(ICONE_TRAVA, 34), el('b', { text: 'VOCÊ ESTÁ FORA DO CHAT' }), el('span', { text: ateTxt(p.ate) + (p.motivo ? ` · ${p.motivo}` : '') })));
      $('chatFixada').hidden = true;
      return;
    }
    const lista = chat.msgs[chat.canal], filhos = [];
    let ant = null, dia = null;
    if (!lista.length) filhos.push(el('div', { class: 'ch-vazio' }, icoCanal(canalChat(chat.canal), 30), el('span', { text: canalChat(chat.canal).vazio })));
    else filhos.push(el('div', { class: 'ch-inicio', text: chat.temMais[chat.canal] ? 'Carregando as mais antigas…' : `Começo do #${canalChat(chat.canal).nome}` }));
    for (const m of lista) {
      const d = new Date(m.created_at).toDateString();
      if (d !== dia) { dia = d; ant = null; filhos.push(el('div', { class: 'ch-dia', text: rotDia(m.created_at) })); }
      filhos.push(linhaChat(m, ant));
      ant = m;
    }
    trocar(box, filhos);
    if (descer) box.scrollTop = box.scrollHeight;
    desenharFixadaChat();
    marcarLidoChat();
  }
  function desenharFixadaChat() {
    const f = $('chatFixada'), m = foraDoChat() ? null : chat.msgs[chat.canal].find((x) => x.fixada && !x.apagada);
    f.hidden = !m;
    if (m) trocar(f, svg(ICONE_FIXAR, 15), el('b', { text: 'FIXADA' }), el('span', { text: `${nickMsg(m)}: ${resumoChat(m).replace(/\n/g, ' ')}` }));
    f.onclick = () => m && irParaMsg(m.id);
  }
  function desenharComporChat() {
    const c = canalChat(chat.canal), p = punicaoAtiva(), cfg = cfgCanal(c.id);
    const trava = !chat.eu ? 'Carregando…'
      : p ? (p.tipo === 'ban' ? 'Você está fora do chat' : `Você está silenciado ${ateTxt(p.ate)}`)
      : c.soSite ? 'O site posta aqui quando alguém registra massa'
      : c.soAdm && !admChat() ? `Só ADM escreve em #${c.nome}`
      : cfg.travado && !admChat() ? 'Canal travado pelo ADM' : null;
    $('chatCaixa').hidden = !!trava;
    $('chatTrancado').hidden = !trava;
    if (trava) trocar($('chatTrancado'), svg(p ? ICONE_MUDO : ICONE_TRAVA, 15), trava);
    $('chatTxt').placeholder = chat.editando ? 'Edite a sua mensagem'
      : c.id === 'avisos' ? 'Escreva um aviso pro clã'
      : cfg.lento && !admChat() ? `Modo lento · 1 a cada ${tempoTxt(cfg.lento)}` : `Mensagem em #${c.nome}`;
    $('chatBondeBtn').hidden = c.id === 'avisos';
    const mic = podeGravar() && !chat.editando;
    $('chatAudioBtn').hidden = !mic;
    $('chatCaixa').classList.toggle('tem-mic', mic);
  }
  function desenharDigitando() {
    const agora = Date.now();
    const l = [...chat.digitando.values()].filter((d) => d.ate > agora && d.canal === chat.canal);
    if (!l.length) { $('chatDigitando').replaceChildren(); return; }
    const nomes = l.slice(0, 2).map((d) => d.nome).join(' e ');
    const fazendo = l.every((d) => d.audio) ? 'gravando áudio…' : 'digitando…';
    trocar($('chatDigitando'), el('span', { class: 'ch-pontinhos' }, el('i'), el('i'), el('i')), el('b', { text: nomes }), l.length > 1 ? ` estão ${fazendo}` : ` está ${fazendo}`);
  }

  // quem está jogando, online e offline (online = com o site aberto agora)
  function membrosChat() {
    const jogP = new Map(), jogU = new Map(), onP = new Set(), semPerfil = [];
    for (const s of chat.status.values()) { const ate = jogandoAte(s); if (!ate) continue; if (s.player_id) jogP.set(s.player_id, ate); jogU.set(s.user_id, ate); }
    for (const [u, o] of chat.online) { if (o.player_id) onP.add(o.player_id); else semPerfil.push({ user_id: u, nome: o.nome || 'Dono' }); }
    const lista = jogadores.filter((r) => r.ativo).map((r) => ({ nick: r.nick, k: chave(r.nick), st: jogP.has(r.id) ? 'jogo' : onP.has(r.id) ? 'on' : 'off', ate: jogP.get(r.id) }));
    for (const o of semPerfil) lista.push({ nick: o.nome, k: chave(o.nome), st: jogU.has(o.user_id) ? 'jogo' : 'on', ate: jogU.get(o.user_id), semPerfil: true });
    return lista.sort((a, b) => ehLider(b.k) - ehLider(a.k) || ptsPat(b.k) - ptsPat(a.k) || a.nick.localeCompare(b.nick, 'pt-BR'));
  }
  function desenharMembrosChat() {
    const lista = membrosChat();
    const grupo = (st, rot) => {
      const l = lista.filter((x) => x.st === st);
      return l.length ? [el('div', { class: 'ch-lado-rot', text: `${rot} — ${l.length}` }), ...l.map((x) => membroChat(x))] : [];
    };
    trocar($('chatMembros'),
      el('div', { class: 'ch-membros-topo' }, el('b', { text: 'MEMBROS' }), el('button', { type: 'button', class: 'tn-x', 'aria-label': 'Fechar', onclick: () => $('chatMembros').classList.remove('aberto'), text: '×' })),
      ...grupo('jogo', 'JOGANDO'), ...grupo('on', 'ONLINE'), ...grupo('off', 'OFFLINE'));
    trocar($('chatMembrosBtn'), svg(ICONE_GENTE, 18), el('span', { text: String(lista.filter((x) => x.st !== 'off').length) }));
  }
  // o = { sub, extra }: a sala de jogos usa a mesma linha com outra legenda e um botão à direita
  // (aí a linha é uma div: botão dentro de botão não vale)
  function membroChat(x, o = {}) {
    const p = patenteDe(ptsPat(x.k)).atual, brabo = !x.semPerfil && ehLider(x.k);
    const sub = o.sub != null ? o.sub : x.st === 'jogo' ? (x.ate ? `jogando · até ${horaChat(x.ate)}` : 'jogando') : brabo ? `top 1 · ${nomeTemp(Date.now()).toLowerCase()}` : p.nome;
    return comParede(el(o.extra ? 'div' : 'button', { type: o.extra ? null : 'button', class: `ch-membro ${x.st} ${brabo ? 'lider' : ''}`, disabled: !o.extra && !!x.semPerfil,
      onclick: (e) => { if (!x.semPerfil && !e.target.closest('.jg-acao')) abrirPerfil(x.k); } },
      el('span', { class: 'ch-membro-av' }, avatarChat(x.nick), el('span', { class: `ch-st ${x.st}` })),
      el('span', { class: 'ch-membro-txt' }, el('b', { class: brabo ? 'lider-nick' : '', style: `--pc:${p.cor}`, text: x.nick }),
        el('span', { class: 'ch-membro-sub', text: sub })), o.extra), x.k);
  }

  // ---------- página ----------
  function abrirChatPagina() {
    $('chatMembros').classList.remove('aberto');
    desenharChat();
    ajustarChat();
  }
  function abrirCanalChat(id) {
    chat.canal = id;
    cancelarRespChat();
    $('chatMencoes').hidden = true;
    desenharChat();
    centrarNaFaixa(document.querySelector('#chatCanais [aria-current="true"]'));
  }
  // o chat ocupa a tela toda entre o topo e a barra de baixo
  function ajustarChat() {
    if (pagAtual !== 'chat') return;
    const app = $('chatApp'), bb = $('barraBaixo');
    const alto = window.visualViewport ? visualViewport.height : innerHeight;
    const topo = app.getBoundingClientRect().top + (window.visualViewport ? visualViewport.offsetTop : 0);
    const baixo = getComputedStyle(bb).display === 'none' ? 16 : bb.offsetHeight + 8;
    app.style.height = Math.max(340, Math.round(alto - Math.max(0, topo) - baixo)) + 'px';
    if (pertoDoFimChat()) descerChat();
  }

  // ---------- ações ----------
  async function enviarChat() {
    const campo = $('chatTxt'), txt = campo.value.trim();
    if (chat.editando) return salvarEdicao(txt);
    if (!txt || !podeFalar(chat.canal)) return;
    const resp = chat.resp;
    campo.value = '';
    $('chatEnviar').disabled = true;
    $('chatMencoes').hidden = true;
    cancelarRespChat();
    try {
      const id = await chatRpc('chat_enviar', { p_canal: chat.canal, p_txt: txt, p_resp: resp ? resp.id : null });
      tocarChat('msg', id);
      await buscarMsgChat(id);
    } catch (e) {
      if (!campo.value) campo.value = txt;
      $('chatEnviar').disabled = !campo.value.trim();
      erroChat(e);
    }
  }
  // não espera o tempo real pra mostrar o que a própria pessoa mandou
  async function buscarMsgChat(id) {
    if (DEMO || !id || chat.porId.has(id)) return;
    const { data } = await sb.from('chat_mensagens').select('*').eq('id', id).maybeSingle();
    if (data) chegouMsg(data);
  }
  // o tempo real do banco leva uns segundos pra chegar nos outros: quem mandou avisa na hora pela
  // conexão do chat e cada um busca no banco (o aviso só leva o id, então não dá pra forjar mensagem)
  function tocarChat(tipo, id) {
    if (DEMO || !id || !chat.presenca) return;
    try { chat.presenca.send({ type: 'broadcast', event: 'toque', payload: { tipo, id } }).catch(() => {}); } catch (e) {}
  }
  async function tocaramChat(p) {
    if (!p || !p.id || !chat.eu) return;
    if (p.tipo === 'msg') {
      const { data, error } = await sb.from('chat_mensagens').select('*').eq('id', p.id).maybeSingle();
      if (error) return;
      if (!data) { sumiuMsg(p.id); return; }
      if (data.tipo === 'bonde' && !chat.porId.has(data.id)) await puxarBonde(data.id, false);
      chegouMsg(data);
    } else if (p.tipo === 'reac') {
      const { data, error } = await sb.from('chat_reacoes').select('user_id, emoji').eq('msg_id', p.id);
      if (error) return;
      const r = new Map();
      for (const x of data || []) { if (!r.has(x.emoji)) r.set(x.emoji, new Set()); r.get(x.emoji).add(x.user_id); }
      chat.reac.set(p.id, r);
      if (chat.porId.has(p.id)) trocarLinhaChat(chat.porId.get(p.id));
    } else if (p.tipo === 'bonde') await puxarBonde(p.id, true);
  }
  async function puxarBonde(id, redesenhar) {
    const { data, error } = await sb.from('chat_bonde').select('msg_id, user_id, player_id, nome').eq('msg_id', id).order('created_at');
    if (error) return;
    chat.bonde.set(id, (data || []).map((b) => ({ user_id: b.user_id, player_id: b.player_id, nome: b.nome })));
    if (redesenhar && chat.porId.has(id)) trocarLinhaChat(chat.porId.get(id));
  }
  async function reagirChat(m, e) {
    try {
      const ficou = await chatRpc('chat_reagir', { p_msg: m.id, p_emoji: e });
      tocarChat('reac', m.id);
      mexerReac(m.id, e, euChat(), !!ficou);
    } catch (err) { erroChat(err); }
  }
  function barraResp(...conteudo) {
    trocar($('chatResp'), ...conteudo, el('button', { type: 'button', 'aria-label': 'Cancelar', onclick: cancelarRespChat }, '×'));
    $('chatResp').hidden = false;
  }
  function responderChat(m) {
    if (chat.editando) cancelarRespChat();
    chat.resp = m;
    barraResp(svg(ICONE_RESPONDER, 14), el('span', null, 'Respondendo ', el('b', { text: nickMsg(m) }), ` · ${resumoChat(m)}`));
    $('chatTxt').focus();
  }
  function editarChat(m) {
    chat.resp = null;
    chat.editando = m;
    barraResp(svg(ICONE_LAPIS, 14), el('span', null, el('b', { text: 'Editando' }), ' a sua mensagem'));
    const campo = $('chatTxt');
    campo.value = m.txt;
    $('chatEnviar').disabled = m.tipo === 'msg' && !m.txt.trim();
    desenharComporChat();
    campo.focus();
  }
  function cancelarRespChat() {
    if (chat.editando) { chat.editando = null; $('chatTxt').value = ''; $('chatEnviar').disabled = true; desenharComporChat(); }
    chat.resp = null;
    $('chatResp').hidden = true;
  }
  async function salvarEdicao(txt) {
    const m = chat.editando;
    if (!m || (m.tipo === 'msg' && !txt)) return;
    try {
      const novo = await chatRpc('chat_editar', { p_msg: m.id, p_txt: txt });
      tocarChat('msg', m.id);
      cancelarRespChat();
      atualizarMsg({ id: m.id, txt: novo ?? txt, editada: true });
    } catch (e) { erroChat(e); }
  }
  async function entrarNoBonde(m, entra) {
    try {
      const r = await chatRpc('chat_bonde_entrar', { p_msg: m.id, p_entrar: entra });
      if (r === 'lotado') { toast('Esse bonde lotou.', true); return; }
      if (r === 'fechado') { toast('Esse bonde já acabou.', true); trocarLinhaChat(m); return; }
      tocarChat('bonde', m.id);
      mexerBonde({ msg_id: m.id, user_id: euChat(), player_id: chat.eu.player_id, nome: meuNick() }, entra);
      meuStatusChat(entra ? new Date(Date.now() + 90 * 60000).toISOString() : null);
      if (entra) toast('Você entrou no bonde. Bom jogo!');
    } catch (e) { erroChat(e); }
  }
  function meuStatusChat(ate) {
    chat.status.set(euChat(), { user_id: euChat(), player_id: chat.eu.player_id, nome: meuNick(), jogando_ate: ate });
    if (chatVisivel()) { desenharTopoChat(); desenharMembrosChat(); }
  }
  async function alternarJogando() {
    const liga = !jogandoAte(chat.status.get(euChat()));
    try {
      const ate = await chatRpc('chat_jogando', { p_ligar: liga });
      meuStatusChat(ate || null);
      toast(liga ? `Status: jogando ${ateTxt(ate)}.` : 'Status de jogando desligado.');
    } catch (e) { erroChat(e); }
  }
  function abrirBonde() {
    const canal = canalDoBonde();
    if (!podeFalar(canal)) { toast(punicaoAtiva() ? 'Você está silenciado no chat.' : 'Canal travado pelo ADM.', true); return; }
    $('fBondeSrv').value = $('fBondeSrv').value || 'Servidor BR';
    $('fBondeNota').value = '';
    document.querySelectorAll('[data-vagas]').forEach((b) => b.setAttribute('aria-checked', String(b.dataset.vagas === '6')));
    $('dlgBonde').showModal();
  }
  async function chamarBonde() {
    const vagas = Number((document.querySelector('[data-vagas][aria-checked="true"]') || {}).dataset?.vagas || 6);
    const canal = canalDoBonde();
    $('dlgBonde').close();
    try {
      const id = await chatRpc('chat_enviar', { p_canal: canal, p_txt: $('fBondeNota').value.trim(), p_tipo: 'bonde', p_dados: { srv: $('fBondeSrv').value.trim() || 'Servidor BR', max: vagas } });
      tocarChat('msg', id);
      if (!DEMO) {
        const { data } = await sb.from('chat_bonde').select('msg_id, user_id, player_id, nome').eq('msg_id', id);
        for (const b of data || []) mexerBonde(b, true, false);
      }
      if (canal !== chat.canal) abrirCanalChat(canal);
      await buscarMsgChat(id);
      meuStatusChat(new Date(Date.now() + 90 * 60000).toISOString());
    } catch (e) { erroChat(e); }
  }
  // foto: diminui no próprio celular (até 1280 px) antes de subir, pra caber no armazenamento grátis
  function comprimirFoto(arquivo) {
    return new Promise((ok, falha) => {
      const img = new Image(), u = URL.createObjectURL(arquivo);
      img.onload = () => {
        const k = Math.min(1, 1280 / Math.max(img.naturalWidth, img.naturalHeight));
        const w = Math.max(1, Math.round(img.naturalWidth * k)), h = Math.max(1, Math.round(img.naturalHeight * k));
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        URL.revokeObjectURL(u);
        cv.toBlob((b) => {
          if (b && b.type === 'image/webp') ok({ blob: b, w, h });
          else cv.toBlob((j) => (j ? ok({ blob: j, w, h }) : falha(new Error('foto'))), 'image/jpeg', 0.82);
        }, 'image/webp', 0.8);
      };
      img.onerror = () => { URL.revokeObjectURL(u); falha(new Error('foto')); };
      img.src = u;
    });
  }
  async function enviarFoto(arquivo) {
    if (!arquivo || !podeFalar(chat.canal)) return;
    if (!/^image\//.test(arquivo.type)) { toast('Escolha uma imagem.', true); return; }
    let path = null, subiu = false;
    toast('Enviando foto…');
    try {
      const { blob, w, h } = await comprimirFoto(arquivo);
      path = `${euChat()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${blob.type === 'image/webp' ? 'webp' : 'jpg'}`;
      if (!DEMO) {
        const up = await sb.storage.from('chat').upload(path, blob, { contentType: blob.type, cacheControl: '31536000' });
        if (up.error) throw new Error('foto: ' + up.error.message);
        subiu = true;
      }
      urlsFoto.set(path, { url: URL.createObjectURL(blob), ate: Date.now() + 3600000 });
      const resp = chat.resp;
      const id = await chatRpc('chat_enviar', { p_canal: chat.canal, p_txt: $('chatTxt').value.trim(), p_resp: resp ? resp.id : null, p_tipo: 'foto', p_dados: { path, w, h } });
      tocarChat('msg', id);
      $('chatTxt').value = '';
      $('chatEnviar').disabled = true;
      cancelarRespChat();
      await buscarMsgChat(id);
    } catch (e) {
      if (subiu) sb.storage.from('chat').remove([path]).catch(() => {});
      erroChat(e);
    }
  }
  const apagarFotos = (lista) => { if (!DEMO && lista && lista.length) sb.storage.from('chat').remove(lista).catch(() => {}); };

  // ---------- áudio: grava no próprio aparelho e sobe pra mesma pasta fechada das fotos ----------
  const AUDIO_MAX = 120; // segundos
  const podeGravar = () => !!(window.MediaRecorder && navigator.mediaDevices && navigator.mediaDevices.getUserMedia);
  // mp4 (AAC) toca em todo celular; quem não grava mp4 vai de webm
  function formatoAudio() {
    const ok = (t) => { try { return MediaRecorder.isTypeSupported(t); } catch (e) { return false; } };
    return ['audio/mp4;codecs=mp4a.40.2', 'audio/webm;codecs=opus', 'audio/mp4', 'audio/webm', 'audio/ogg;codecs=opus'].find(ok) || '';
  }
  const grav = { rec: null, pedindo: false };
  async function gravarAudio() {
    if (grav.rec || grav.pedindo || !podeFalar(chat.canal)) return;
    grav.pedindo = true;
    let stream;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) {
      toast(e && (e.name === 'NotAllowedError' || e.name === 'SecurityError') ? 'O microfone está bloqueado pro site. Libere nas permissões do navegador.' : 'Não achei o microfone deste aparelho.', true);
      return;
    } finally { grav.pedindo = false; }
    const formato = formatoAudio();
    let rec;
    try { rec = new MediaRecorder(stream, formato ? { mimeType: formato, audioBitsPerSecond: 48000 } : { audioBitsPerSecond: 48000 }); }
    catch (e) { stream.getTracks().forEach((t) => t.stop()); toast('Este navegador não grava áudio.', true); return; }
    pararAudio();
    const g = Object.assign(grav, { rec, stream, partes: [], ini: Date.now(), fim: 0, enviar: false, canal: chat.canal, niveis: [], ctx: null, an: null });
    // o volume ao vivo (pra desenhar a onda); se o aparelho não deixar, grava sem desenho
    try {
      g.ctx = new (window.AudioContext || window.webkitAudioContext)();
      g.an = g.ctx.createAnalyser();
      g.an.fftSize = 512;
      g.ctx.createMediaStreamSource(stream).connect(g.an);
      g.ctx.resume().catch(() => {});
    } catch (e) { g.ctx = null; g.an = null; }
    rec.ondataavailable = (e) => { if (e.data && e.data.size) g.partes.push(e.data); };
    rec.onstop = fimGravacao;
    rec.start(1000);
    $('chatLinha').hidden = true;
    $('chatGravando').hidden = false;
    $('chatAudioOnda').replaceChildren();
    $('chatAudioTempo').textContent = '0:00';
    g.timer = setInterval(tiqueGravacao, 100);
    if (navigator.vibrate) navigator.vibrate(30);
  }
  function tiqueGravacao() {
    const g = grav;
    if (!g.rec || g.fim) return;
    // saiu do chat, trocou de canal ou perdeu a voz: joga fora
    if (!chatVisivel() || chat.canal !== g.canal || !podeFalar(g.canal)) { pararGravacao(false); return; }
    const s = (Date.now() - g.ini) / 1000;
    $('chatAudioTempo').textContent = tempoAudio(s);
    let v = 0;
    if (g.an) {
      const buf = new Uint8Array(g.an.fftSize);
      g.an.getByteTimeDomainData(buf);
      let q = 0;
      for (const x of buf) q += ((x - 128) / 128) ** 2;
      v = Math.min(1, Math.sqrt(q / buf.length) * 4);
    }
    g.niveis.push(v);
    const onda = $('chatAudioOnda');
    onda.append(el('i', { style: `--h:${v.toFixed(2)}` }));
    while (onda.childElementCount > 90) onda.firstChild.remove();
    avisarDigitando(true);
    if (s >= AUDIO_MAX) pararGravacao(true);
  }
  function pararGravacao(enviar) {
    const g = grav;
    if (!g.rec || g.fim) return;
    g.fim = Date.now();
    g.enviar = enviar;
    clearInterval(g.timer);
    $('chatGravando').hidden = true;
    $('chatLinha').hidden = false;
    try { if (g.rec.state !== 'inactive') g.rec.stop(); else fimGravacao(); } catch (e) { fimGravacao(); }
  }
  function fimGravacao() {
    const g = grav;
    if (!g.rec) return;
    const { rec, stream, partes, ini, fim, enviar, canal, niveis, ctx, an } = g;
    g.rec = null;
    stream.getTracks().forEach((t) => t.stop());
    if (ctx) ctx.close().catch(() => {});
    if (!enviar) return;
    const dur = Math.min(AUDIO_MAX, Math.round(((fim || Date.now()) - ini) / 1000));
    if (dur < 1 || !partes.length) { toast('Áudio curto demais.', true); return; }
    const blob = new Blob(partes, { type: rec.mimeType || partes[0].type || 'audio/webm' });
    enviarAudio(blob, dur, canal, an ? resumirOnda(niveis) : '');
  }
  // o volume de cada pedaço do áudio, de 0 a 9, relativo ao mais alto
  function resumirOnda(n) {
    if (!n.length) return '';
    const top = Math.max(...n) || 1;
    return Array.from({ length: BARRAS_AUDIO }, (_, i) => {
      const a = Math.floor((i * n.length) / BARRAS_AUDIO), b = Math.max(a + 1, Math.floor(((i + 1) * n.length) / BARRAS_AUDIO));
      return Math.round((Math.max(...n.slice(a, b)) / top) * 9);
    }).join('');
  }
  async function enviarAudio(blob, dur, canal, onda) {
    if (!podeFalar(canal)) return;
    if (blob.size > 2 * 1024 * 1024) { toast('Esse áudio ficou grande demais. Manda em partes menores.', true); return; }
    const tipo = (blob.type || 'audio/webm').split(';')[0];
    const ext = { 'audio/mp4': 'm4a', 'audio/ogg': 'ogg', 'audio/mpeg': 'mp3', 'audio/aac': 'aac' }[tipo] || 'webm';
    const path = `${euChat()}/${Date.now()}-${Math.random().toString(36).slice(2, 8)}.${ext}`;
    let subiu = false;
    toast('Enviando áudio…');
    try {
      if (!DEMO) {
        const up = await sb.storage.from('chat').upload(path, new Blob([blob], { type: tipo }), { contentType: tipo, cacheControl: '31536000' });
        if (up.error) throw new Error('audio: ' + up.error.message);
        subiu = true;
      }
      urlsFoto.set(path, { url: URL.createObjectURL(blob), ate: Date.now() + 3600000 });
      const resp = chat.resp && chat.resp.canal === canal ? chat.resp : null;
      const id = await chatRpc('chat_enviar', { p_canal: canal, p_txt: '', p_resp: resp ? resp.id : null, p_tipo: 'audio', p_dados: { path, dur, onda } });
      tocarChat('msg', id);
      if (resp) cancelarRespChat();
      await buscarMsgChat(id);
    } catch (e) {
      if (subiu) sb.storage.from('chat').remove([path]).catch(() => {});
      erroChat(e);
    }
  }
  function apagarChat(m, nick, meu) {
    confirmar('APAGAR MENSAGEM?', meu ? 'Ela some de vez pra todo mundo.' : `Mensagem de ${nick}. Some de vez pra todo mundo e fica no histórico da moderação.`, 'Apagar', async () => {
      try {
        const foto = await chatRpc('chat_apagar', { p_msg: m.id });
        tocarChat('msg', m.id);
        if (foto) apagarFotos([foto]);
        sumiuMsg(m.id);
        toast('Mensagem apagada.');
        if (admChat()) contarDenuncias();
      } catch (e) { erroChat(e); }
    });
  }
  async function fixarChat(m, fixar) {
    try {
      await chatRpc('chat_fixar', { p_msg: m.id, p_fixar: fixar });
      tocarChat('msg', m.id);
      if (fixar) for (const x of chat.msgs[m.canal]) if (x.fixada && x !== m) { x.fixada = false; trocarLinhaChat(x); }
      atualizarMsg({ id: m.id, fixada: fixar });
      toast(fixar ? 'Mensagem fixada no topo do canal.' : 'Mensagem desafixada.');
    } catch (e) { erroChat(e); }
  }
  function denunciarChat(m, nick) {
    confirmar('DENUNCIAR MENSAGEM?', `Os ADMs vão olhar essa mensagem de ${nick}.`, 'Denunciar', async () => {
      try { await chatRpc('chat_denunciar', { p_msg: m.id, p_motivo: '' }); toast('Denúncia enviada pros ADMs.'); }
      catch (e) { erroChat(e); }
    });
  }

  // ---------- canais criados pelos ADMs ----------
  // Quem cria escolhe nome, ícone, quem vê (todo o clã, só ADMs ou escolhidos) e quem escreve.
  // Quem criou e o Dono editam e apagam; o #adm (que já vem pronto) só o Dono.
  // Os 4 do site o Dono também edita; #bonde, #recordes e #avisos ele desliga (o #geral fica sempre, pra todo mundo).
  const EMOJIS_CANAL = ['💬', '🛡️', '🏆', '🔥', '🐍', '🎮', '⚔️', '📢', '👑', '💎', '🎯', '🤝', '😂', '📸', '🎉', '🔒'];
  let formCanal = null;
  const podeEditarCanal = (c) => !!c && admChat() && (c.base ? donoChat() : !!c.criado && (donoChat() || (!!c.criado_por && c.criado_por === euChat())));
  async function abrirCanalForm(c = null) {
    formCanal = { id: c ? c.id : null, base: c && c.base ? c : null, emoji: c ? c.emoji : EMOJIS_CANAL[0], ve: c ? c.ve : 'todos', fala: (c && c.fala) || 'todos', membros: new Set(), contas: null };
    trocar($('tituloCanal'), c ? 'EDITAR ' : 'NOVO ', el('span', { class: 'laranja', text: 'CANAL' }));
    $('fCanalNome').value = c ? c.nome : '';
    $('fCanalBusca').value = '';
    $('btnApagarCanal').hidden = !c || c.id === 'geral';
    $('btnApagarCanal').textContent = c && c.base ? 'Desligar' : 'Apagar';
    $('rotCanalVe').hidden = $('canalVe').hidden = !!c && c.id === 'geral';
    $('rotCanalFala').hidden = $('canalFala').hidden = !!c && !!c.soSite;
    $('btnSalvarCanal').textContent = c ? 'Salvar' : 'Criar';
    desenharCanalForm();
    $('dlgCanal').showModal();
    if (!c) $('fCanalNome').focus();
    try {
      const [contas, membros] = await Promise.all([chatRpc('chat_contas', {}), c ? membrosDoCanal(c.id) : []]);
      if (!formCanal || formCanal.id !== (c ? c.id : null)) return;
      formCanal.contas = (contas || []).filter((x) => !protegido(x.user_id));
      for (const u of membros) formCanal.membros.add(u);
      desenharMembrosCanal();
    } catch (e) { erroChat(e); }
  }
  async function membrosDoCanal(id) {
    if (DEMO) return [...(demoChat.membros.get(id) || [])];
    const { data, error } = await sb.from('chat_canal_membros').select('user_id').eq('canal', id);
    if (error) throw new Error(error.message);
    return data.map((x) => x.user_id);
  }
  function desenharCanalForm() {
    const f = formCanal;
    const opc = (campo, valor, txt) => el('button', { type: 'button', class: 'aba', role: 'radio', 'aria-checked': String(f[campo] === valor), text: txt,
      onclick: () => { f[campo] = valor; desenharCanalForm(); } });
    // canal do site: o primeiro é o ícone dele mesmo (emoji vazio)
    trocar($('canalEmojis'), f.base ? el('button', { type: 'button', role: 'radio', 'aria-checked': String(!f.emoji), 'aria-label': 'Ícone do site',
      onclick: () => { f.emoji = null; desenharCanalForm(); } }, svg(f.base.ico, 18)) : null,
    EMOJIS_CANAL.map((e) => el('button', { type: 'button', role: 'radio', 'aria-checked': String(f.emoji === e), 'aria-label': e, text: e,
      onclick: () => { f.emoji = e; desenharCanalForm(); } })));
    trocar($('canalVe'), opc('ve', 'todos', 'Todo o clã'), opc('ve', 'adm', 'Só ADMs'), opc('ve', 'escolhidos', 'Escolhidos'));
    trocar($('canalFala'), opc('fala', 'todos', 'Quem vê'), opc('fala', 'adm', 'Só ADMs'));
    $('canalMembros').hidden = f.ve !== 'escolhidos';
    desenharMembrosCanal();
  }
  function desenharMembrosCanal() {
    const f = formCanal;
    if (!f || f.ve !== 'escolhidos') return;
    $('canalQtd').textContent = f.contas ? `${f.membros.size} ${f.membros.size === 1 ? 'escolhido' : 'escolhidos'} · Dono e ADMs sempre veem` : 'Carregando…';
    if (!f.contas) { $('canalLista').replaceChildren(); return; }
    const q = busca($('fCanalBusca').value.trim());
    const lista = f.contas.filter((x) => !q || busca(nickDoPlayer(x.player_id, x.nome)).includes(q))
      .sort((a, b) => f.membros.has(b.user_id) - f.membros.has(a.user_id) || nickDoPlayer(a.player_id, a.nome).localeCompare(nickDoPlayer(b.player_id, b.nome), 'pt-BR'));
    trocar($('canalLista'), lista.length ? lista.map((x) => {
      const nick = nickDoPlayer(x.player_id, x.nome);
      const cx = el('input', { type: 'checkbox' });
      cx.checked = f.membros.has(x.user_id);
      cx.addEventListener('change', () => {
        if (cx.checked) f.membros.add(x.user_id); else f.membros.delete(x.user_id);
        $('canalQtd').textContent = `${f.membros.size} ${f.membros.size === 1 ? 'escolhido' : 'escolhidos'} · Dono e ADMs sempre veem`;
      });
      return el('label', { class: 'ch-check canal-pessoa' }, cx, avatarChat(nick, 'av-p'), el('span', { text: nick }));
    }) : [el('p', { class: 'mod-sub', text: 'Ninguém com esse nome.' })]);
  }
  async function salvarCanal() {
    const f = formCanal, nome = $('fCanalNome').value.trim().replace(/^#+/, '').trim();
    if (!f) return;
    if (!nome) { $('fCanalNome').focus(); return; }
    if (f.ve === 'escolhidos' && !f.contas) return;
    const bt = $('btnSalvarCanal');
    bt.disabled = true;
    try {
      const id = await chatRpc('chat_salvar_canal', { p_id: f.id, p_nome: nome, p_emoji: f.emoji || '', p_ve: f.ve, p_fala: f.fala, p_membros: f.ve === 'escolhidos' ? [...f.membros] : [] });
      $('dlgCanal').close();
      if (DEMO) { aplicarCriados(demoChat.canais); lerLidosChat(); } else await carregarChat();
      abrirCanalChat(id);
      toast(f.id ? 'Canal salvo.' : `#${nome} criado.`);
    } catch (e) { erroChat(e); } finally { bt.disabled = false; }
  }
  function apagarCanal() {
    const f = formCanal, c = f && canalChat(f.id);
    if (c && c.base && c.id !== 'geral') {
      confirmar('DESLIGAR O CANAL?', `#${c.nome} some pra todo mundo. As mensagens ficam guardadas e dá pra ligar de novo em Moderação › Canais.`, 'Desligar', async () => {
        try {
          await chatRpc('dono_canal', { p_canal: c.id, p_ligado: false });
          chat.cfg.set(c.id, { ...cfgCanal(c.id), canal: c.id, desligado: true });
          $('dlgCanal').close();
          atualizarBadgesChat();
          if (chatVisivel()) desenharChat();
          toast(`#${c.nome} desligado.`);
        } catch (e) { erroChat(e); }
      });
      return;
    }
    if (!c || !c.criado) return;
    confirmar('APAGAR O CANAL?', `#${c.nome} e todas as mensagens dele somem pra todo mundo. Não dá pra desfazer.`, 'Apagar', async () => {
      try {
        const fotos = await chatRpc('chat_apagar_canal', { p_id: c.id });
        apagarFotos(fotos);
        $('dlgCanal').close();
        aplicarCriados(DEMO ? demoChat.canais : chat.criados.filter((x) => x.id !== c.id));
        if (chat.canal === c.id) chat.canal = 'geral';
        atualizarBadgesChat();
        if (chatVisivel()) desenharChat();
        toast(`#${c.nome} apagado.`);
      } catch (e) { erroChat(e); }
    });
  }

  // ---------- moderação (ADM do chat e Dono) ----------
  let punindo = null;
  const PRAZOS = [['10 min', 10], ['1 hora', 60], ['1 dia', 1440], ['7 dias', 10080], ['Sem prazo', null]];
  function abrirPunir(alvo) {
    punindo = { ...alvo, tipo: 'silencio', min: 60 };
    $('tituloPunir').textContent = `PUNIR ${alvo.nick.toUpperCase()}`;
    $('fPunirMotivo').value = '';
    $('fPunirLimpar').checked = false;
    desenharPunir();
    if ($('dlgModeracao').open) $('dlgModeracao').close();
    $('dlgPunir').showModal();
  }
  function desenharPunir() {
    const opc = (atual, valor, txt, fn) => el('button', { type: 'button', class: 'aba', role: 'radio', 'aria-checked': String(atual === valor), onclick: fn, text: txt });
    trocar($('punirTipo'),
      opc(punindo.tipo, 'silencio', 'Silenciar', () => { punindo.tipo = 'silencio'; desenharPunir(); }),
      opc(punindo.tipo, 'ban', 'Tirar do chat', () => { punindo.tipo = 'ban'; desenharPunir(); }));
    trocar($('punirPrazo'), ...PRAZOS.map(([t, v]) => opc(punindo.min, v, t, () => { punindo.min = v; desenharPunir(); })));
    $('punirExplica').textContent = punindo.tipo === 'ban' ? 'Não lê nem escreve no chat.' : 'Lê o chat, mas não escreve nem reage.';
  }
  async function aplicarPunicao() {
    const p = punindo;
    if (!p) return;
    try {
      const r = await chatRpc('chat_punir', { p_user: p.user_id, p_tipo: p.tipo, p_minutos: p.min, p_motivo: $('fPunirMotivo').value.trim() });
      $('dlgPunir').close();
      if (r === 'adm') { toast('ADM e Dono não podem ser punidos.', true); return; }
      if ($('fPunirLimpar').checked) await limparMensagens(p.user_id, 24, false);
      const prazo = PRAZOS.find(([, v]) => v === p.min)[0].toLowerCase();
      toast(`${p.nick} ${p.tipo === 'ban' ? 'saiu do chat' : 'foi silenciado'} · ${p.min ? prazo : 'até um ADM liberar'}.`);
    } catch (e) { erroChat(e); }
  }
  async function limparMensagens(user, horas, avisar = true) {
    const r = await chatRpc('chat_limpar', { p_user: user, p_horas: horas });
    apagarFotos(r && r.fotos);
    for (const m of [...chat.porId.values()]) {
      if (m.user_id === user && (horas == null || Date.now() - Date.parse(m.created_at) < horas * 3600000)) sumiuMsg(m.id);
    }
    if (avisar) toast(`${(r && r.qtd) || 0} mensagens apagadas.`);
  }
  // faxina: foto vence com 30 dias e mensagem com 90 (#avisos e fixadas ficam). O banco diz quais
  // fotos venceram, este aparelho (de ADM) apaga os arquivos e o banco marca e apaga as linhas.
  const FAXINA_CADA = 6 * 3600000;
  async function faxinaChat(manual = false) {
    const tot = { fotos: 0, msgs: 0 };
    for (let volta = 0; volta < 10; volta++) {
      const lista = (await chatRpc('chat_faxina_fotos', {})) || [];
      if (lista.length && !DEMO) {
        const r = await sb.storage.from('chat').remove(lista);
        if (r.error) throw new Error(r.error.message);
      }
      const r = await chatRpc('chat_faxina', { p_fotos: lista, p_manual: manual });
      tot.fotos += r.fotos; tot.msgs += r.msgs;
      if (lista.length < 200) break;
    }
    return tot;
  }
  // sozinha: quando um ADM abre o chat, no máximo a cada 6 h por aparelho
  function faxinaSozinha() {
    if (DEMO || !admChat()) return;
    const k = 'chat_faxina_' + euChat();
    try {
      if (Date.now() - Number(localStorage.getItem(k) || 0) < FAXINA_CADA) return;
      localStorage.setItem(k, String(Date.now()));
    } catch (e) {}
    faxinaChat().catch((e) => console.warn('faxina:', e.message));
  }
  let abaMod = 'denuncias';
  async function abrirModeracao(aba = abaMod) {
    const soDono = (x) => x === 'equipe' || x === 'limpar';
    abaMod = soDono(aba) && !donoChat() ? 'denuncias' : aba;
    document.querySelectorAll('[data-mod]').forEach((b) => {
      b.setAttribute('aria-selected', String(b.dataset.mod === abaMod));
      if (soDono(b.dataset.mod)) b.hidden = !donoChat();
    });
    const dlg = $('dlgModeracao');
    if (!dlg.open) { trocar($('modCorpo'), el('p', { class: 'mod-sub', text: 'Carregando…' })); dlg.showModal(); }
    let d, equipe = null;
    try {
      d = await chatRpc('chat_moderacao', {});
      if (soDono(abaMod)) equipe = await chatRpc('dono_equipe', {});
    } catch (e) { erroChat(e); return; }
    chat.denuncias = new Set(d.denuncias.map((x) => x.msg_id)).size;
    desenharTopoChat();
    const n = { denuncias: d.denuncias.length, punidos: d.punidos.length };
    document.querySelectorAll('[data-mod]').forEach((b) => { const q = n[b.dataset.mod]; b.querySelector('i').textContent = q ? String(q) : ''; });
    const vazio = (t) => el('div', { class: 'mod-vazio' }, svg(ICONE_MODERAR, 28), el('span', { text: t }));
    let corpo;
    if (abaMod === 'denuncias') corpo = d.denuncias.length ? d.denuncias.map(itemDenuncia) : [vazio('Nenhuma denúncia aberta.')];
    else if (abaMod === 'punidos') corpo = d.punidos.length ? d.punidos.map(itemPunido) : [vazio('Ninguém punido agora.')];
    else if (abaMod === 'canais') corpo = painelCanais(d);
    else if (abaMod === 'limpar') corpo = [painelLimpeza(equipe || []), painelFaxina(d.faxina)];
    else if (abaMod === 'equipe') corpo = painelEquipe(equipe || []);
    else corpo = d.historico.length ? [el('ul', { class: 'mod-hist' }, ...d.historico.map(itemHistorico))] : [vazio('Nada feito ainda.')];
    trocar($('modCorpo'), corpo);
  }
  function itemDenuncia(x) {
    const nick = nickDoPlayer(null, x.nome);
    const acao = (txt, cls, fn) => el('button', { type: 'button', class: `btn ${cls}`, onclick: fn, text: txt });
    return el('div', { class: 'mod-item' },
      el('div', { class: 'mod-cab' }, avatarChat(nick, 'av-p'), el('b', { text: nick }),
        el('span', { class: 'mod-sub', text: `#${nomeCanal(x.canal)} · ${haQuanto(x.created_at)}` }),
        el('span', { class: 'mod-qtd', text: `${x.qtd} ${x.qtd > 1 ? 'denúncias' : 'denúncia'}` })),
      el('p', { class: 'mod-txt', text: x.tipo === 'bonde' ? `[bonde] ${x.txt || ''}` : x.tipo === 'foto' ? `[foto] ${x.txt || ''}` : x.tipo === 'audio' ? '[áudio]' : x.txt || '—' }),
      el('div', { class: 'mod-sub', text: 'denunciou: ' + x.quem.map((q) => q.quem).join(', ') }),
      el('div', { class: 'linha-btns' },
        acao('Ignorar', 'btn-sec', async () => { try { await chatRpc('chat_ignorar_denuncia', { p_msg: x.msg_id }); abrirModeracao(); } catch (e) { erroChat(e); } }),
        x.user_id && !protegido(x.user_id) ? acao('Punir', 'btn-sec', () => abrirPunir({ user_id: x.user_id, nick })) : null,
        acao('Apagar', 'btn-perigo', async () => {
          try {
            const foto = await chatRpc('chat_apagar', { p_msg: x.msg_id });
            tocarChat('msg', x.msg_id);
            if (foto) apagarFotos([foto]);
            sumiuMsg(x.msg_id);
            toast('Mensagem apagada.');
            abrirModeracao();
          } catch (e) { erroChat(e); }
        })));
  }
  function itemPunido(x) {
    const nick = nickDoPlayer(x.player_id, x.nome);
    return el('div', { class: 'mod-item mod-linha' },
      avatarChat(nick, 'av-p'),
      el('div', { class: 'mod-linha-txt' },
        el('b', { text: nick }),
        el('span', { class: `mod-pena ${x.tipo}`, text: x.tipo === 'ban' ? 'FORA DO CHAT' : 'SILENCIADO' }),
        el('span', { class: 'mod-sub', text: [ateTxt(x.ate), x.motivo, x.por ? `por ${x.por}` : null].filter(Boolean).join(' · ') })),
      el('div', { class: 'mod-linha-btns' },
        el('button', { type: 'button', class: 'btn btn-sec', text: 'Apagar msgs', title: 'Apaga as mensagens dele das últimas 24 h', onclick: async () => {
          try { await limparMensagens(x.user_id, 24); } catch (e) { erroChat(e); }
        } }),
        el('button', { type: 'button', class: 'btn btn-sec', text: 'Liberar', onclick: async () => {
          try { await chatRpc('chat_perdoar', { p_user: x.user_id }); toast(`${nick} liberado no chat.`); abrirModeracao(); } catch (e) { erroChat(e); }
        } })));
  }
  // travar canal, modo lento e a lista de palavrões
  function painelCanais(d) {
    const linhas = canaisChat().filter((c) => !c.soSite).map((c) => {
      const cfg = (d.canais && d.canais[c.id]) || { travado: false, lento: 0 };
      const salvar = async (novo) => {
        try {
          await chatRpc('chat_config_canal', { p_canal: c.id, p_travado: novo.travado, p_lento: novo.lento });
          chat.cfg.set(c.id, { ...cfgCanal(c.id), canal: c.id, ...novo });
          desenharComporChat(); desenharTopoChat(); desenharCanaisChat();
          abrirModeracao('canais');
        } catch (e) { erroChat(e); }
      };
      return el('div', { class: 'mod-item mod-canal' },
        el('div', { class: 'mod-cab' }, icoCanal(c, 16), el('b', { text: `#${c.nome}` })),
        el('div', { class: 'mod-canal-ops' },
          el('button', { type: 'button', class: 'ch-switch', role: 'switch', 'aria-checked': String(!!cfg.travado), onclick: () => salvar({ travado: !cfg.travado, lento: cfg.lento }) },
            el('i'), cfg.travado ? 'Travado' : 'Aberto'),
          el('div', { class: 'abas mod-lento', role: 'radiogroup', 'aria-label': `Modo lento no #${c.nome}` },
            ...LENTOS.map(([v, t]) => el('button', { type: 'button', class: 'aba', role: 'radio', 'aria-checked': String((cfg.lento || 0) === v), onclick: () => salvar({ travado: cfg.travado, lento: v }), text: v ? t : 'Normal' })))));
    });
    const caixa = el('textarea', { id: 'fPalavroes', rows: '4', placeholder: 'uma palavra por linha', 'aria-label': 'Palavrões' });
    caixa.value = (d.palavroes || []).join('\n');
    return [
      el('div', { class: 'mod-rot', text: 'TRAVADO: SÓ ADM FALA · LENTO: TEMPO ENTRE MENSAGENS' }),
      ...linhas,
      ...(donoChat() ? painelDesligar(d.canais || {}) : []),
      el('div', { class: 'mod-item' },
        el('div', { class: 'mod-cab' }, el('b', { text: 'Palavrões' }), el('span', { class: 'mod-sub', text: 'viram *** no chat' })),
        caixa,
        el('div', { class: 'linha-btns' }, el('button', { type: 'button', class: 'btn btn-pri', text: 'Salvar lista', onclick: async () => {
          try {
            const n = await chatRpc('chat_salvar_palavroes', { p_lista: caixa.value.split(/[\n,;]+/).map((x) => x.trim()).filter(Boolean) });
            toast(`Lista salva: ${n} ${n === 1 ? 'palavra' : 'palavras'}.`);
          } catch (e) { erroChat(e); }
        } }))),
    ];
  }
  // só o Dono: desliga #bonde, #recordes ou #avisos pra todo mundo, ou liga de volta (o #geral fica sempre)
  function painelDesligar(canais) {
    return CANAIS_CHAT.filter((x) => x.id !== 'geral').map((x) => {
      const c = canalBase(x), ligado = !(canais[c.id] && canais[c.id].desligado);
      return el('div', { class: 'mod-item mod-canal' },
        el('div', { class: 'mod-cab' }, icoCanal(c, 16), el('b', { text: `#${c.nome}` }), el('span', { class: 'mod-sub', text: 'só o Dono liga e desliga' })),
        el('div', { class: 'mod-canal-ops' },
          el('button', { type: 'button', class: 'ch-switch', role: 'switch', 'aria-checked': String(ligado), onclick: async () => {
            try {
              await chatRpc('dono_canal', { p_canal: c.id, p_ligado: !ligado });
              chat.cfg.set(c.id, { ...cfgCanal(c.id), canal: c.id, desligado: ligado });
              atualizarBadgesChat(); desenharChat();
              toast(ligado ? `#${c.nome} desligado.` : `#${c.nome} ligado de novo.`);
              abrirModeracao('canais');
            } catch (e) { erroChat(e); }
          } }, el('i'), ligado ? 'Ligado' : 'Desligado')));
    });
  }
  const qtdTxt = (n, um, varios) => `${fmt(n)} ${n === 1 ? um : varios}`;
  const vidaTxt = (n) => (n ? `${n} ${n === 1 ? 'dia' : 'dias'}` : 'nunca');
  // só o Dono: apaga o que ele escolher (canais, tipos, de quem e de quando), vendo antes quanto vai sumir
  const TIPOS_LIMPEZA = [['msg', 'Textos'], ['foto', 'Fotos'], ['audio', 'Áudios'], ['bonde', 'Bondes'], ['massa', 'Massas']];
  const IDADES_LIMPEZA = [[null, 'Qualquer data'], [-24, 'Só das últimas 24 h'], [24, '+1 dia'], [72, '+3 dias'], [168, '+7 dias'], [720, '+30 dias']];
  const limpeza = { canais: null, tipos: new Set(TIPOS_LIMPEZA.map(([v]) => v)), user: '', idade: null, fixadas: false, vez: 0 };
  function painelLimpeza(contas) {
    const canais = todosCanais();
    // começa com todos menos o #avisos
    if (!limpeza.canais) limpeza.canais = new Set(canais.filter((c) => c.id !== 'avisos').map((c) => c.id));
    for (const id of [...limpeza.canais]) if (!canais.some((c) => c.id === id)) limpeza.canais.delete(id);
    if (limpeza.user && !contas.some((x) => x.user_id === limpeza.user)) limpeza.user = '';
    const nomeConta = (x) => nickDoPlayer(x.player_id, x.nome);
    const filtro = () => ({ p_canais: [...limpeza.canais], p_tipos: [...limpeza.tipos], p_user: limpeza.user || null, p_idade: limpeza.idade, p_fixadas: limpeza.fixadas });
    const fx = el('div', { class: 'mod-fx mod-fx-3' });
    const bt = el('button', { type: 'button', class: 'btn btn-perigo', text: 'Apagar', disabled: true });
    let prev = null;
    const num = (n, rot) => el('div', { class: 'mod-fx-num' }, el('b', { text: fmt(n) }), el('span', { text: rot }));
    const mostrar = (r) => {
      prev = r;
      trocar(fx, num(r.msgs, r.msgs === 1 ? 'mensagem' : 'mensagens'), num(r.fotos, r.fotos === 1 ? 'foto' : 'fotos'), num(r.audios, r.audios === 1 ? 'áudio' : 'áudios'));
      bt.textContent = r.msgs ? `Apagar ${qtdTxt(r.msgs, 'mensagem', 'mensagens')}` : 'Nada pra apagar';
      bt.disabled = !r.msgs;
    };
    // a prévia: o banco conta o que esse filtro pega (só vale a resposta do último pedido)
    async function contar() {
      const vez = ++limpeza.vez;
      prev = null; bt.disabled = true;
      if (!limpeza.canais.size || !limpeza.tipos.size) { mostrar({ msgs: 0, fotos: 0, audios: 0 }); return; }
      try {
        const r = await chatRpc('dono_limpeza', { ...filtro(), p_apagar: false });
        if (vez === limpeza.vez) mostrar(r);
      } catch (e) { if (vez === limpeza.vez) { trocar(fx, el('span', { class: 'mod-sub', text: 'Não deu pra contar agora.' })); erroChat(e); } }
    }
    const marcas = [];
    const mudou = () => { marcas.forEach((f) => f()); contar(); };
    const opc = (role, ligado, txt, fn) => {
      const b = el('button', { type: 'button', class: 'aba', role, text: txt, onclick: () => { fn(); mudou(); } });
      const f = () => b.setAttribute('aria-checked', String(ligado()));
      marcas.push(f); f();
      return b;
    };
    const alternar = (set, v) => (set.has(v) ? set.delete(v) : set.add(v));
    const grupo = (rot, role, ...filhos) => el('div', { class: 'abas mod-lento', role: role === 'radio' ? 'radiogroup' : 'group', 'aria-label': rot }, ...filhos);
    const todos = () => canais.every((c) => limpeza.canais.has(c.id));
    const quem = el('select', { 'aria-label': 'De quem', onchange: (e) => { limpeza.user = e.target.value; contar(); } },
      el('option', { value: '', text: 'Todo mundo' }),
      ...[...contas].sort((a, b) => nomeConta(a).localeCompare(nomeConta(b), 'pt-BR')).map((x) => el('option', { value: x.user_id, text: nomeConta(x) })));
    quem.value = limpeza.user;
    const fixadas = el('input', { type: 'checkbox', onchange: (e) => { limpeza.fixadas = e.target.checked; contar(); } });
    fixadas.checked = limpeza.fixadas;

    bt.addEventListener('click', () => {
      const r = prev;
      if (!r || !r.msgs) return;
      const onde = todos() ? 'todos os canais' : canais.filter((c) => limpeza.canais.has(c.id)).map((c) => `#${c.nome}`).join(', ');
      const conta = limpeza.user && contas.find((x) => x.user_id === limpeza.user);
      const arq = [r.fotos ? qtdTxt(r.fotos, 'foto', 'fotos') : '', r.audios ? qtdTxt(r.audios, 'áudio', 'áudios') : ''].filter(Boolean).join(' e ');
      confirmar('APAGAR DO CHAT?',
        `Somem ${qtdTxt(r.msgs, 'mensagem', 'mensagens')}${arq ? ` (com ${arq})` : ''}${conta ? ` de ${nomeConta(conta)}` : ''} em ${onde}. Não dá pra desfazer.`,
        'Apagar', async () => {
          bt.disabled = true;
          try {
            const x = await chatRpc('dono_limpeza', { ...filtro(), p_apagar: true });
            const arqs = x.arquivos || [];
            for (let i = 0; i < arqs.length; i += 100) apagarFotos(arqs.slice(i, i + 100));
            for (const id of x.ids || []) sumiuMsg(id, false);
            if (chatVisivel()) { desenharMsgsChat(false); desenharFixadaChat(); }
            atualizarBadgesChat();
            toast(x.msgs ? `Pronto: ${qtdTxt(x.msgs, 'mensagem apagada', 'mensagens apagadas')}.` : 'Nada pra apagar.');
          } catch (e) { erroChat(e); }
          abrirModeracao('limpar');
        });
    });

    const caixa = el('div', { class: 'mod-item' },
      el('div', { class: 'mod-cab' }, svg(ICONE_LIXO, 16), el('b', { text: 'Limpar o chat' }), el('span', { class: 'mod-sub', text: 'escolha o que some' })),
      el('div', { class: 'mod-rot', text: 'CANAIS' }),
      grupo('Canais', 'checkbox',
        opc('checkbox', todos, 'Todos', () => { limpeza.canais = new Set(todos() ? [] : canais.map((c) => c.id)); }),
        ...canais.map((c) => opc('checkbox', () => limpeza.canais.has(c.id), `#${c.nome}`, () => alternar(limpeza.canais, c.id)))),
      el('div', { class: 'mod-rot', text: 'O QUE' }),
      grupo('O que', 'checkbox', ...TIPOS_LIMPEZA.map(([v, t]) => opc('checkbox', () => limpeza.tipos.has(v), t, () => alternar(limpeza.tipos, v)))),
      el('div', { class: 'mod-rot', text: 'DE QUEM' }),
      quem,
      el('div', { class: 'mod-rot', text: 'DE QUANDO' }),
      grupo('De quando', 'radio', ...IDADES_LIMPEZA.map(([v, t]) => opc('radio', () => limpeza.idade === v, t, () => { limpeza.idade = v; }))),
      el('label', { class: 'ch-check' }, fixadas, 'Apagar as fixadas também'),
      fx,
      el('div', { class: 'linha-btns' }, bt));
    contar();
    return caixa;
  }
  // só o Dono: quantos dias cada coisa dura na faxina automática, e o botão pra fazer na hora
  const DIAS_FOTO = [[7, '7 dias'], [15, '15 dias'], [30, '30 dias'], [null, 'Nunca']];
  const DIAS_MSG = [[7, '7 dias'], [30, '30 dias'], [90, '90 dias'], [null, 'Nunca']];
  function painelFaxina(fx) {
    const f = fx || { fotos: 0, msgs: 0 };
    // (antes do SQL novo o banco não manda os dias: era 30 e 90)
    const dFoto = 'dias_foto' in f ? f.dias_foto : 30, dMsg = 'dias_msg' in f ? f.dias_msg : 90;
    const vidaFoto = dFoto && dMsg ? Math.min(dFoto, dMsg) : dFoto || dMsg;
    const salvar = async (foto, msg) => {
      try { await chatRpc('dono_faxina_cfg', { p_dias_foto: foto, p_dias_msg: msg }); toast('Faxina automática salva.'); } catch (e) { erroChat(e); }
      abrirModeracao('limpar');
    };
    const opcoes = (rot, lista, atual, fn) => el('div', { class: 'abas mod-lento', role: 'radiogroup', 'aria-label': rot },
      ...lista.map(([v, t]) => el('button', { type: 'button', class: 'aba', role: 'radio', 'aria-checked': String(atual === v), onclick: () => { if (atual !== v) fn(v); }, text: t })));
    const num = (n, um, varios, rot) => el('div', { class: 'mod-fx-num' }, el('b', { text: fmt(n) }), el('span', { text: `${n === 1 ? um : varios} ${rot}` }));
    const bt = el('button', { type: 'button', class: 'btn btn-sec', text: 'Faxina agora', disabled: !fx });
    bt.addEventListener('click', () => confirmar('FAXINA AGORA?',
      `Somem ${qtdTxt(f.fotos, 'foto ou áudio', 'fotos e áudios')} e ${qtdTxt(f.msgs, 'mensagem', 'mensagens')} que já venceram. #${nomeCanal('avisos')} e fixadas ficam. Não dá pra desfazer.`,
      'Limpar', async () => {
        bt.disabled = true;
        try {
          const r = await faxinaChat(true);
          toast(r.fotos || r.msgs ? `Faxina feita: ${qtdTxt(r.fotos, 'foto ou áudio', 'fotos e áudios')} e ${qtdTxt(r.msgs, 'mensagem', 'mensagens')}.` : 'Nada vencido. Chat em dia!');
        } catch (e) { erroChat(e); }
        abrirModeracao('limpar');
      }));
    return el('div', { class: 'mod-item' },
      el('div', { class: 'mod-cab' }, svg(ICONE_RELOGIO, 16), el('b', { text: 'Faxina automática' }),
        el('span', { class: 'mod-sub', text: f.ultima ? `última ${haQuanto(f.ultima)}` : 'roda quando um ADM abre o chat' })),
      el('div', { class: 'mod-rot', text: 'FOTOS E ÁUDIOS SOMEM COM' }),
      opcoes('Fotos e áudios somem com', DIAS_FOTO, dFoto, (v) => salvar(v, dMsg)),
      el('div', { class: 'mod-rot', text: 'MENSAGENS SOMEM COM' }),
      opcoes('Mensagens somem com', DIAS_MSG, dMsg, (v) => salvar(dFoto, v)),
      el('div', { class: 'mod-fx' }, num(f.fotos, 'foto/áudio', 'fotos e áudios', vidaFoto ? `+${vidaTxt(vidaFoto)}` : ''), num(f.msgs, 'mensagem', 'mensagens', dMsg ? `+${vidaTxt(dMsg)}` : '')),
      el('div', { class: 'mod-sub', text: `#${nomeCanal('avisos')} e fixadas nunca somem sozinhas` }),
      el('div', { class: 'linha-btns' }, bt));
  }
  // só o Dono: quem é ADM do chat, e expulsar do clã
  function painelEquipe(lista) {
    const linha = (x) => {
      const nick = nickDoPlayer(x.player_id, x.nome);
      const btn = (txt, cls, fn) => el('button', { type: 'button', class: `btn ${cls}`, text: txt, onclick: fn });
      return el('div', { class: 'mod-item mod-linha' },
        avatarChat(nick, 'av-p'),
        el('div', { class: 'mod-linha-txt' }, el('b', { text: nick }), tagPapel(x.papel) || el('span', { class: 'mod-sub', text: 'Membro' })),
        x.papel === 'dono' ? null : el('div', { class: 'mod-linha-btns' },
          btn(x.papel === 'adm' ? 'Tirar ADM' : 'Tornar ADM', 'btn-sec', async () => {
            try {
              await chatRpc('dono_promover', { p_user: x.user_id, p_adm: x.papel !== 'adm' });
              toast(x.papel === 'adm' ? `${nick} não é mais ADM.` : `${nick} agora é ADM do chat.`);
              await recarregarEquipe();
              abrirModeracao('equipe');
            } catch (e) { erroChat(e); }
          }),
          btn('Expulsar', 'btn-perigo', () => confirmar('EXPULSAR DO CLÃ?', `${nick} perde a conta no site e vira ex-membro. As partidas continuam no ranking.`, 'Expulsar', async () => {
            try {
              await chatRpc('dono_expulsar', { p_user: x.user_id });
              toast(`${nick} foi expulso do clã.`);
              if (!DEMO) { await carregar(); render(); }
              abrirModeracao('equipe');
            } catch (e) { erroChat(e); }
          }))));
    };
    return [el('div', { class: 'mod-rot', text: 'ADM DO CHAT: SÓ MODERA O CHAT · DONO: O SITE TODO' }), ...lista.map(linha)];
  }
  function itemHistorico(h) {
    return el('li', null, el('b', { text: h.quem || 'ADM' }), ` ${textoHistorico(h)}`, el('span', { class: 'mod-sub', text: haQuanto(h.created_at) }));
  }
  // o que ficou no admin_log, em português de gente
  function textoHistorico(h) {
    const d = h.detalhe || {};
    const prazo = d.minutos ? (PRAZOS.find(([, v]) => v === d.minutos) || [`${d.minutos} min`])[0] : 'sem prazo';
    const jog = (id) => (jogPorId.get(id) || {}).nick || 'um jogador';
    const tn = (id) => { const t = torneios.find((x) => x.id === id); return t ? t.nome : 'um torneio'; };
    return {
      registrar: `registrou ${fmt(d.massa || 0)} de massa de ${d.jogador || '?'}`,
      'apagar partida': `apagou ${fmt(d.massa || 0)} de massa de ${d.jogador || '?'}`,
      'cadastrar jogadores': `cadastrou ${(d.nicks || []).join(', ') || 'jogadores'}`,
      'editar jogador': `editou o jogador ${d.nick || ''}`.trim(),
      'apagar jogador': 'apagou um jogador do elenco',
      'criar torneio': `criou o torneio ${d.nome || ''}`.trim(),
      'editar torneio': `editou o torneio ${d.nome || ''}`.trim(),
      chaveamento: `mexeu no chaveamento de ${tn(d.torneio)}`,
      'apagar torneio': `apagou o torneio ${d.nome || ''}`.trim(),
      'lançar resultado': `lançou ${fmt(d.valor || 0)} pra ${jog(d.jogador)} em ${tn(d.torneio)}`,
      'apagar resultado': `apagou um resultado de ${jog(d.jogador)}`,
      'prêmios': 'mudou os prêmios',
      'tirar login': `tirou o login de ${d.nick || '?'}`,
      'aprovar pedido': `aprovou a entrada de ${d.nick || '?'}`,
      'recusar pedido': `recusou a entrada de ${d.nick || '?'}`,
      chat_apagar: `apagou mensagem de ${d.autor || '?'}${d.texto ? `: "${String(d.texto).slice(0, 60)}"` : ''}`,
      chat_fixar: 'fixou uma mensagem', chat_desafixar: 'desafixou uma mensagem',
      chat_punir: `${d.tipo === 'ban' ? 'tirou do chat' : 'silenciou'} ${d.quem || '?'} · ${prazo}${d.motivo ? ` · ${d.motivo}` : ''}`,
      chat_perdoar: `liberou ${d.quem || '?'}`, chat_ignorar_denuncia: 'ignorou uma denúncia',
      chat_limpar: `apagou as mensagens de ${d.quem || '?'}${d.horas ? ` das últimas ${d.horas} h` : ''}`,
      chat_canal: `#${nomeCanal(d.canal)}: ${d.travado ? 'travou' : 'abriu'}${d.lento ? ` · lento ${tempoTxt(d.lento)}` : ''}`,
      chat_canal_criar: `criou o canal #${d.nome || '?'}${d.ve === 'adm' ? ' (só ADMs)' : d.ve === 'escolhidos' ? ' (escolhidos)' : ''}`,
      chat_canal_editar: `editou o canal #${d.nome || '?'}${d.antes && d.antes !== d.nome ? ` (era #${d.antes})` : ''}`,
      chat_canal_apagar: `apagou o canal #${d.nome || '?'}`,
      chat_palavroes: `mudou a lista de palavrões (${d.qtd || 0})`,
      chat_faxina: `${d.manual ? 'fez a faxina' : 'faxina automática'}: ${d.fotos || 0} ${d.fotos === 1 ? 'foto' : 'fotos'} e ${d.msgs || 0} ${d.msgs === 1 ? 'mensagem' : 'mensagens'}`,
      dono_promover: `tornou ${d.quem || '?'} ADM do chat`, dono_rebaixar: `tirou o ADM de ${d.quem || '?'}`,
      dono_expulsar: `expulsou ${d.quem || '?'} do clã`,
      dono_canal: `${d.ligado ? 'ligou' : 'desligou'} o #${nomeCanal(d.canal || 'recordes')}`,
      dono_limpeza: `limpou o chat: ${qtdTxt(d.msgs || 0, 'mensagem', 'mensagens')}${d.quem ? ` de ${d.quem}` : ''}`,
      dono_faxina_cfg: `mudou a faxina: fotos e áudios ${vidaTxt(d.dias_foto)}, mensagens ${vidaTxt(d.dias_msg)}`,
    }[h.acao] || 'fez uma alteração';
  }

  // ---------- painel do dono ----------
  // O site de cada membro avisa o banco quando abre, quando troca de tela e a cada minuto aberto
  // na tela (site_marcar, passo 8 do SQL). O Dono vê tudo junto no #painel (dono_painel).
  const NOMES_TELA = {
    ranking: 'Ranking', chat: 'Chat', torneios: 'Torneios', trofeus: 'Troféus', jogadores: 'Jogadores', partidas: 'Partidas',
    patentes: 'Patentes', perfil: 'Perfil de jogador', torneio: 'Página de torneio', painel: 'Painel do dono', outra: 'Outras',
  };
  const LIMITE_BANCO = 500 * 1048576;       // plano grátis do Supabase
  const LIMITE_ARQUIVOS = 1024 * 1048576;
  const VS_PERIODO = { 1: 'que ontem', 7: 'que os 7 dias antes', 30: 'que os 30 dias antes' };
  const ICONE_CELULAR = '<rect x="7" y="2.5" width="10" height="19" rx="2"/><path d="M11 18h2"/>';
  const ICONE_PC = '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>';
  const ICONE_OK = '<circle cx="12" cy="12" r="9"/><path d="M8 12.5l2.5 2.5 5-5.5"/>';
  const ICONE_ALERTA = '<path d="M12 3.5 2.5 20h19z"/><path d="M12 10v4.5M12 17.5v.01"/>';
  let usoTela = null, usoTimer = 0, usoEscondido = 0;
  const pd = { dias: 7, dados: null, erro: false, carregando: false, aba: 'ativos', histTodo: false };
  const telaAtual = () => (perfilAtual ? 'perfil' : torneioAtual ? 'torneio' : pagAtual || PAG_INICIO);
  const aparelho = () => (ehIOS || /Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent) ? 'celular' : 'computador');

  function marcarUso(tipo) {
    if (DEMO || !sb || !podeVer()) return;
    if (tipo !== 'ping') usoTela = telaAtual();
    sb.rpc('site_marcar', { p_tela: telaAtual(), p_tipo: tipo, p_aparelho: aparelho(), p_app: appInstalado() }).then(() => {}, () => {});
  }
  function ligarUso() {
    marcarUso('abriu');
    if (usoTimer) return;
    usoTimer = setInterval(() => { if (!document.hidden) marcarUso('ping'); }, 60000);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) { usoEscondido = Date.now(); return; }
      // voltou depois de muito tempo (celular no bolso): conta como outra visita
      if (usoEscondido && Date.now() - usoEscondido > 30 * 60000) marcarUso('abriu');
      usoEscondido = 0;
      if (painelVisivel()) carregarPainel();
    });
  }
  // trocou de tela (mostrarRota chama sempre; só conta quando muda mesmo)
  function contarTela() {
    if (usoTela && telaAtual() !== usoTela) marcarUso('tela');
  }

  const painelVisivel = () => !!admin && pagAtual === 'painel' && !perfilAtual && !torneioAtual && !document.hidden;
  function abrirPainel() {
    desenharPainel();
    carregarPainel();
  }
  async function carregarPainel() {
    if (!admin || pd.carregando) return;
    pd.carregando = true;
    const dias = pd.dias;
    try {
      let dados;
      if (DEMO) dados = demoPainel(dias);
      else {
        const r = await sb.rpc('dono_painel', { p_dias: dias });
        if (r.error) throw new Error(r.error.message);
        dados = r.data;
      }
      if (dias === pd.dias) { pd.dados = { ...dados, periodo: dias }; pd.erro = false; }
    } catch (e) {
      console.warn('painel:', e.message);
      pd.erro = true;
    }
    pd.carregando = false;
    if (dias !== pd.dias) { carregarPainel(); return; }
    if (pagAtual === 'painel') desenharPainel();
  }

  const somaDe = (l, k) => l.reduce((s, x) => s + Number(x[k] || 0), 0);
  function horasTxt(min) {
    min = Math.round(min || 0);
    if (min < 60) return `${min} min`;
    const h = Math.floor(min / 60), m = min % 60;
    return h >= 10 || !m ? `${fmt(h)} h` : `${h} h ${m}`;
  }
  function tamanhoTxt(b) {
    b = Number(b || 0);
    if (b < 1048576) return `${Math.max(1, Math.round(b / 1024))} KB`;
    if (b < 1073741824) return `${(b / 1048576).toLocaleString('pt-BR', { maximumFractionDigits: b < 10485760 ? 1 : 0 })} MB`;
    return `${(b / 1073741824).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} GB`;
  }
  const diaDe = (iso) => new Date(`${iso}T12:00:00`);
  const cartaoPd = (titulo, extra, ...filhos) => el('section', { class: 'painel pd-card' },
    el('div', { class: 'pd-card-topo' }, el('h3', { class: 'painel-h3', text: titulo }), extra || null), ...filhos);

  function desenharPainel() {
    const box = $('pdCorpo');
    document.querySelectorAll('[data-pd]').forEach((b) => b.setAttribute('aria-selected', String(Number(b.dataset.pd) === pd.dias)));
    const d = pd.dados && pd.dados.periodo === pd.dias ? pd.dados : null;
    $('pdSub').textContent = d && d.desde ? `Atualiza sozinho · contando desde ${dataCurta(`${d.desde}T12:00:00`)}` : 'O site na sua mão.';
    if (!d) {
      trocar(box, el('p', { class: 'pd-carregando', text: pd.erro ? 'Não deu pra carregar o painel agora. Tenta de novo daqui a pouco.' : 'Carregando…' }));
      return;
    }
    const dias = d.dias || [];
    const atual = dias.slice(-pd.dias), antes = dias.slice(0, -pd.dias);
    // uso do site só compara quando já contava no período anterior inteiro
    const usoAntesOk = !!(d.desde && antes.length && d.desde <= antes[0].dia);
    const membros = (d.membros || []).map((m) => ({ ...m, nick: nickDoPlayer(m.player_id, m.nome) }));
    trocar(box,
      el('div', { class: 'pd-duas pd-topo' }, cartaoAgora(d), cartaoAtencao(d, membros)),
      el('div', { class: 'pd-kpis' },
        kpi('PESSOAS', d.pessoas || 0, usoAntesOk ? d.pessoas_antes || 0 : null, fmt, pd.dias === 1 ? 'entraram hoje' : 'entraram no site'),
        kpi('VISITAS', somaDe(atual, 'visitas'), usoAntesOk ? somaDe(antes, 'visitas') : null, fmt, 'vezes que abriram'),
        kpi('TEMPO NO SITE', somaDe(atual, 'minutos'), usoAntesOk ? somaDe(antes, 'minutos') : null, horasTxt, 'somando todo mundo'),
        kpi('MASSAS', somaDe(atual, 'massas'), somaDe(antes, 'massas'), fmt),
        kpi('MENSAGENS', somaDe(atual, 'msgs'), somaDe(antes, 'msgs'), fmt),
        kpi('CONTAS NOVAS', somaDe(atual, 'contas'), somaDe(antes, 'contas'), fmt)),
      pd.dias > 1 ? cartaoPd('PESSOAS POR DIA', null, colunasPd(atual.map((x, i) => {
        const dt = diaDe(x.dia), ult = i === atual.length - 1;
        const rot = atual.length > 10 ? ((atual.length - 1 - i) % 5 ? '' : String(dt.getDate())) : dt.toLocaleDateString('pt-BR', { weekday: 'short' }).replace('.', '');
        return {
          v: x.pessoas, rot, destaque: ult,
          tip: `${dt.toLocaleDateString('pt-BR', { weekday: 'long', day: 'numeric', month: 'short' })}|${x.pessoas} ${x.pessoas === 1 ? 'pessoa' : 'pessoas'} · ${fmt(x.visitas)} ${x.visitas === 1 ? 'visita' : 'visitas'} · ${horasTxt(x.minutos)}`,
        };
      }), 'pd-graf-dias')) : null,
      el('div', { class: 'pd-duas' },
        cartaoPd('TELAS MAIS ABERTAS', null, barrasTelas(d.telas || {})),
        el('div', { class: 'pd-pilha' }, cartaoHoras(d.horas || {}), cartaoAparelhos(d))),
      cartaoMembros(membros),
      el('div', { class: 'pd-duas' }, cartaoHistorico(d.historico || []), cartaoEspaco(d.espaco || {})));
  }

  function kpi(rot, num, antes, formato, sub = '') {
    const dif = antes == null ? null : num - antes;
    return el('div', { class: 'stat pd-kpi' },
      el('span', { class: 'stat-rot', text: rot }),
      el('span', { class: 'stat-num', text: formato(num) }),
      dif == null ? el('span', { class: 'stat-sub', text: sub })
        : el('span', { class: 'stat-sub' },
          el('span', { class: `pd-dif ${dif > 0 ? 'sobe' : dif < 0 ? 'desce' : ''}`, text: dif > 0 ? `▲ ${formato(dif)}` : dif < 0 ? `▼ ${formato(-dif)}` : '= igual' }),
          dif ? ` ${dif > 0 ? 'a mais' : 'a menos'} ${VS_PERIODO[pd.dias]}` : ` ${VS_PERIODO[pd.dias]}`));
  }

  // colunas: [{ v, rot, tip: 'título|linha', destaque }]; o número aparece no maior e no destacado
  function colunasPd(itens, classe = '', numeros = true) {
    const max = Math.max(1, ...itens.map((x) => x.v));
    const iMax = itens.findIndex((x) => x.v === max);
    return el('div', { class: `pd-graf ${classe}`, style: `--n:${itens.length}`, role: 'list' },
      ...itens.map((x, i) => {
        const [t1, t2] = x.tip.split('|');
        return el('div', { class: `pd-coluna ${x.destaque ? 'destaque' : ''}`, role: 'listitem', tabindex: '0', 'data-tip': x.tip, 'aria-label': `${t1}: ${t2}` },
          el('span', { class: 'pd-coluna-val', text: numeros && x.v && (i === iMax || x.destaque) ? fmt(x.v) : '' }),
          el('span', { class: 'pd-coluna-area' }, el('span', { class: 'pd-coluna-barra', style: `height:${x.v ? Math.max(3, (x.v / max) * 100) : 0}%` })),
          el('span', { class: 'pd-coluna-rot', text: x.rot }));
      }));
  }

  function cartaoAgora(d) {
    const l = d.agora || [];
    return el('section', { class: 'painel pd-card pd-agora' },
      el('div', { class: 'pd-agora-topo' },
        el('span', { class: `pd-pulso ${l.length ? 'on' : ''}`, 'aria-hidden': 'true' }),
        el('b', { class: 'pd-agora-num', text: String(l.length) }),
        el('span', { class: 'pd-agora-rot', text: l.length === 1 ? 'PESSOA NO SITE AGORA' : 'PESSOAS NO SITE AGORA' })),
      l.length
        ? el('ul', { class: 'pd-agora-lista' }, ...l.map((a) => {
          const nick = nickDoPlayer(a.player_id, a.nome);
          return el('li', null, avatarChat(nick, 'av-p'), el('b', { text: nick }),
            el('span', { class: 'pd-chip', text: NOMES_TELA[a.tela] || 'Site' }),
            el('span', { class: 'pd-aparelho', title: a.aparelho === 'computador' ? 'Computador' : 'Celular' }, svg(a.aparelho === 'computador' ? ICONE_PC : ICONE_CELULAR, 16)));
        }))
        : el('p', { class: 'pd-nada', text: 'Ninguém com o site aberto agora.' }));
  }

  function cartaoAtencao(d, membros) {
    const comConta = new Set(membros.map((m) => m.player_id).filter(Boolean));
    const semConta = jogadores.filter((r) => r.ativo && !comConta.has(r.id)).length;
    const esp = d.espaco || {};
    const cheio = Math.max(Number(esp.banco || 0) / LIMITE_BANCO, somaArquivos(esp) / LIMITE_ARQUIVOS);
    const plural = (n, um, varios) => `${n} ${n === 1 ? um : varios}`;
    // forte = precisa de uma ação do Dono; o resto é só pra saber
    const itens = [
      d.pedidos > 0 && { forte: true, txt: plural(d.pedidos, 'pedido pra entrar no clã', 'pedidos pra entrar no clã'), botao: 'Aprovar', acao: () => irPara('#pedidos') },
      d.denuncias > 0 && { forte: true, txt: plural(d.denuncias, 'denúncia no chat', 'denúncias no chat'), botao: 'Ver', acao: () => { irPara('#chat'); abrirModeracao('denuncias'); } },
      cheio >= 0.8 && { forte: true, txt: 'Espaço do site quase cheio', botao: 'Ver', acao: () => $('pdEspaco').scrollIntoView({ block: 'center' }) },
      semConta > 0 && { txt: plural(semConta, 'jogador do elenco sem conta', 'jogadores do elenco sem conta'), botao: 'Ver', acao: () => { pd.aba = 'semconta'; desenharPainel(); $('pdMembros').scrollIntoView({ block: 'start' }); } },
      d.punidos > 0 && { txt: plural(d.punidos, 'pessoa punida no chat', 'pessoas punidas no chat'), botao: 'Ver', acao: () => { irPara('#chat'); abrirModeracao('punidos'); } },
    ].filter(Boolean);
    return cartaoPd('PRECISA DE VOCÊ', null,
      itens.length
        ? el('ul', { class: 'pd-alertas' }, ...itens.map((x) => el('li', { class: x.forte ? 'forte' : '' },
          svg(x.forte ? ICONE_ALERTA : ICONE_OK, 18), el('span', { text: x.txt }), el('button', { type: 'button', class: 'btn btn-sec pd-btn', onclick: x.acao, text: x.botao }))))
        : el('p', { class: 'pd-tudo-ok' }, svg(ICONE_OK, 22), 'Tudo em dia.'));
  }

  function barrasTelas(telas) {
    const lista = Object.entries(telas).map(([k, n]) => [k, Number(n)]).filter(([, n]) => n > 0).sort((a, b) => b[1] - a[1]);
    if (!lista.length) return el('p', { class: 'pd-nada', text: 'Ainda sem dados.' });
    const total = lista.reduce((s, [, n]) => s + n, 0), max = lista[0][1];
    return el('ul', { class: 'pd-barras' }, ...lista.map(([k, n]) => el('li', null,
      el('span', { class: 'pd-barras-nome', text: NOMES_TELA[k] || NOMES_TELA.outra }),
      el('span', { class: 'pd-barras-trilho' }, el('span', { class: 'pd-barras-fill', style: `width:${Math.max(2, (n / max) * 100)}%` })),
      el('span', { class: 'pd-barras-num' }, el('b', { text: fmt(n) }), ` · ${Math.round((n / total) * 100)}%`))));
  }

  function cartaoHoras(horas) {
    const v = Array.from({ length: 24 }, (_, h) => Number(horas[h] || 0));
    const pico = v.some(Boolean) ? v.indexOf(Math.max(...v)) : -1;
    return cartaoPd('HORÁRIO DE MOVIMENTO', pico >= 0 ? el('span', { class: 'pd-pico' }, 'Pico ', el('b', { text: `${pico}h` })) : null,
      pico < 0 ? el('p', { class: 'pd-nada', text: 'Ainda sem dados.' })
        : colunasPd(v.map((n, h) => ({ v: n, rot: h % 6 ? '' : `${h}h`, destaque: h === pico, tip: `${h}h às ${(h + 1) % 24}h|${horasTxt(n)} de site aberto` })), 'pd-graf-horas', false));
  }

  function cartaoAparelhos(d) {
    const ap = d.aparelhos || {};
    const cel = Number(ap.celular || 0), pc = Number(ap.computador || 0), tot = cel + pc;
    if (!tot) return cartaoPd('CELULAR OU COMPUTADOR', null, el('p', { class: 'pd-nada', text: 'Ainda sem dados.' }));
    const pCel = Math.round((cel / tot) * 100);
    const lado = (ico, nome, n, p, cls) => el('div', { class: `pd-ap ${cls}` }, svg(ico, 20), el('span', null, el('b', { text: `${p}%` }), ` ${nome}`, el('small', { text: `${n} ${n === 1 ? 'pessoa' : 'pessoas'}` })));
    return cartaoPd('CELULAR OU COMPUTADOR', null,
      el('div', { class: 'pd-divisao', role: 'img', 'aria-label': `Celular ${pCel}%, computador ${100 - pCel}%` },
        cel ? el('span', { class: 'pd-div-cel', style: `flex:${cel}` }) : null, pc ? el('span', { class: 'pd-div-pc', style: `flex:${pc}` }) : null),
      el('div', { class: 'pd-ap-linha' }, lado(ICONE_CELULAR, 'celular', cel, pCel, 'cel'), lado(ICONE_PC, 'computador', pc, 100 - pCel, 'pc')),
      d.app ? el('p', { class: 'pd-nota', text: `${d.app} ${d.app === 1 ? 'pessoa usa' : 'pessoas usam'} o app instalado` }) : null);
  }

  function cartaoMembros(membros) {
    const comConta = new Set(membros.map((m) => m.player_id).filter(Boolean));
    const limite = Date.now() - 7 * 86400000;
    const ms = (m) => (m.ultimo ? Date.parse(m.ultimo) : 0);
    const listas = {
      ativos: membros.filter((m) => m.dias > 0).sort((a, b) => b.dias - a.dias || b.minutos - a.minutos),
      sumidos: membros.filter((m) => ms(m) < limite).sort((a, b) => ms(a) - ms(b)),
      semconta: jogadores.filter((r) => r.ativo && !comConta.has(r.id)).sort((a, b) => a.nick.localeCompare(b.nick, 'pt-BR')),
    };
    const abas = [['ativos', 'Mais ativos'], ['sumidos', 'Sumidos'], ['semconta', 'Sem conta']];
    const linha = (nick, papel, forte, sub, temPerfil) => el(temPerfil ? 'button' : 'div', { type: temPerfil ? 'button' : null, class: 'pd-membro', onclick: temPerfil ? () => abrirPerfil(chave(nick)) : null },
      avatarChat(nick, 'av-p'),
      el('span', { class: 'pd-membro-nome' }, el('b', { text: nick }), tagPapel(papel)),
      el('span', { class: 'pd-membro-num' }, el('b', { text: forte }), el('small', { text: sub })));
    const itens = {
      ativos: (m) => linha(m.nick, m.papel, pd.dias === 1 ? horasTxt(m.minutos) : `${m.dias} de ${pd.dias} dias`,
        pd.dias === 1 ? `${m.visitas} ${m.visitas === 1 ? 'visita' : 'visitas'}` : `${horasTxt(m.minutos)} no site`, !!m.player_id),
      sumidos: (m) => linha(m.nick, m.papel, m.ultimo ? haQuanto(m.ultimo) : 'nunca entrou', m.ultimo ? 'última vez' : `conta desde ${dataCurta(m.conta_desde)}`, !!m.player_id),
      semconta: (r) => linha(r.nick, null, 'sem conta', r.cargo || 'no elenco', true),
    };
    const vazio = { ativos: 'Ninguém entrou nesse período.', sumidos: 'Ninguém sumido: todo mundo entrou nos últimos 7 dias.', semconta: 'Todo o elenco tem conta.' };
    const lista = listas[pd.aba];
    return el('section', { class: 'painel pd-card', id: 'pdMembros' },
      el('div', { class: 'pd-card-topo' }, el('h3', { class: 'painel-h3', text: `MEMBROS · ${membros.length} ${membros.length === 1 ? 'CONTA' : 'CONTAS'}` }),
        el('div', { class: 'abas pd-abas', role: 'tablist', 'aria-label': 'Membros' }, ...abas.map(([id, nome]) => el('button', {
          type: 'button', role: 'tab', class: 'aba', 'aria-selected': String(pd.aba === id),
          onclick: () => { pd.aba = id; desenharPainel(); },
        }, nome, el('span', { class: 'pd-qtd', text: String(listas[id].length) }))))),
      lista.length ? el('div', { class: 'pd-membros' }, ...lista.map(itens[pd.aba])) : el('p', { class: 'pd-nada', text: vazio[pd.aba] }));
  }

  function cartaoHistorico(hist) {
    const mostra = pd.histTodo ? hist : hist.slice(0, 8);
    return cartaoPd('O QUE A EQUIPE FEZ', null,
      hist.length ? el('ul', { class: 'pd-hist' }, ...mostra.map((h) => el('li', null,
        el('span', null, el('b', { text: h.quem || 'Admin' }), ` ${textoHistorico(h)}`),
        el('span', { class: 'pd-hist-quando', text: haQuanto(h.created_at) })))) : el('p', { class: 'pd-nada', text: 'Nada ainda.' }),
      hist.length > 8 ? el('button', { type: 'button', class: 'link-btn pd-mais', onclick: () => { pd.histTodo = !pd.histTodo; desenharPainel(); }, text: pd.histTodo ? 'Mostrar menos' : 'Ver mais' }) : null);
  }

  const somaArquivos = (esp) => Object.values(esp.arquivos || {}).reduce((s, n) => s + Number(n || 0), 0);
  function cartaoEspaco(esp) {
    const medidor = (nome, usado, limite) => {
      const p = Math.min(100, (usado / limite) * 100);
      const nivel = p >= 90 ? 'cheio' : p >= 70 ? 'meio' : 'ok';
      return el('div', { class: `pd-medidor ${nivel}` },
        el('div', { class: 'pd-medidor-txt' }, el('b', { text: nome }), el('span', { text: `${tamanhoTxt(usado)} de ${tamanhoTxt(limite)}` })),
        el('div', { class: 'pd-medidor-trilho', role: 'meter', 'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.round(p)), 'aria-label': nome },
          el('span', { style: `width:${Math.max(1, p)}%` })),
        el('small', { text: p >= 90 ? `${Math.round(p)}% usado · quase cheio` : `${p < 1 ? 'menos de 1' : Math.round(p)}% usado` }));
    };
    return el('section', { class: 'painel pd-card', id: 'pdEspaco' },
      el('div', { class: 'pd-card-topo' }, el('h3', { class: 'painel-h3', text: 'ESPAÇO DO SITE' }), el('span', { class: 'pd-pico', text: 'plano grátis' })),
      medidor('Dados do site', Number(esp.banco || 0), LIMITE_BANCO),
      medidor('Fotos e prints', somaArquivos(esp), LIMITE_ARQUIVOS));
  }

  // dica que aparece ao passar o dedo/mouse numa coluna dos gráficos
  function ligarDicasPainel() {
    const box = $('pdCorpo');
    const dica = el('div', { class: 'pd-dica', role: 'tooltip', hidden: true });
    document.body.append(dica);
    const mostrar = (alvo) => {
      const [t1, t2] = alvo.dataset.tip.split('|');
      trocar(dica, el('b', { text: t1 }), el('span', { text: t2 }));
      dica.hidden = false;
      const r = alvo.getBoundingClientRect(), w = dica.offsetWidth, h = dica.offsetHeight;
      dica.style.left = `${Math.min(innerWidth - w - 8, Math.max(8, r.left + r.width / 2 - w / 2))}px`;
      dica.style.top = `${Math.max(8, r.top - h - 8)}px`;
    };
    const esconder = () => { dica.hidden = true; };
    box.addEventListener('pointerover', (e) => { const a = e.target.closest('[data-tip]'); if (a) mostrar(a); });
    box.addEventListener('pointerout', (e) => { if (e.target.closest('[data-tip]') && !(e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('[data-tip]'))) esconder(); });
    box.addEventListener('focusin', (e) => { const a = e.target.closest('[data-tip]'); if (a) mostrar(a); });
    box.addEventListener('focusout', esconder);
    addEventListener('scroll', esconder, { passive: true });
  }

  // demonstração: números inventados, com o elenco de exemplo
  function demoPainel(n) {
    const iso = (dt) => dt.toLocaleDateString('sv-SE');
    const dias = [];
    for (let i = 2 * n - 1; i >= 0; i--) {
      const dt = new Date(Date.now() - i * 86400000);
      const p = Math.min(6, 2 + Math.round(3 * Math.abs(Math.sin(i * 1.3))) + ([0, 6].includes(dt.getDay()) ? 1 : 0));
      dias.push({ dia: iso(dt), pessoas: p, visitas: p * 2 + (i % 3), minutos: p * 24 + ((i * 7) % 40), massas: (i * 5) % 4, msgs: p * 7 + (i % 5) * 3, contas: i % 9 === 4 ? 1 : 0 });
    }
    const ativos = jogadores.filter((r) => r.ativo);
    const dh = (d) => new Date(Date.now() - d * 86400000).toISOString();
    const membros = ativos.slice(0, ativos.length - 1).map((r, i) => {
      const sumido = i === 4 || i === 5;
      return { user_id: `u${i}`, player_id: r.id, nome: r.nick, papel: i === 0 ? 'dono' : i === 2 ? 'adm' : 'membro', conta_desde: dh(30 - i),
        ultimo: i === 5 ? null : dh(sumido ? 12 : i * 0.08), dias: sumido ? 0 : Math.max(1, Math.min(n, n - i)), minutos: sumido ? 0 : Math.max(5, Math.round((260 - i * 45) * Math.min(n, 7) / 7)), visitas: sumido ? 0 : 14 - i * 2 };
    });
    const k = Math.max(1, n) / 7;
    const telas = Object.fromEntries(Object.entries({ ranking: 140, chat: 118, perfil: 64, torneios: 31, jogadores: 22, trofeus: 16, partidas: 12, patentes: 8, painel: 5 }).map(([t, v]) => [t, Math.max(1, Math.round(v * k))]));
    const horas = Object.fromEntries(Array.from({ length: 24 }, (_, h) => [h, Math.round(k * (h < 7 ? (h < 2 ? 18 - h * 8 : 1) : 6 + 70 * Math.exp(-((h - 21) ** 2) / 10) + 20 * Math.exp(-((h - 13) ** 2) / 6)))]));
    return {
      hoje: iso(new Date()), desde: iso(new Date(Date.now() - 40 * 86400000)), pessoas: Math.min(membros.length, 3 + n), pessoas_antes: Math.min(membros.length, 2 + n),
      agora: membros.slice(0, 3).map((m, i) => ({ ...m, tela: ['chat', 'ranking', 'perfil'][i], aparelho: i === 1 ? 'computador' : 'celular', ultimo: dh(0) })),
      dias, telas, horas, aparelhos: { celular: 5, computador: 2 }, app: 3, membros, pedidos: 1, denuncias: 2, punidos: 0,
      espaco: { banco: 13.6 * 1048576, arquivos: { prints: 4.2 * 1048576, chat: 22528 } },
      historico: [
        { quem: 'VENO', acao: 'registrar', detalhe: { jogador: 'Shawdow', massa: 104210 }, created_at: dh(0.02) },
        { quem: 'VENO', acao: 'aprovar pedido', detalhe: { nick: 'Cascavel' }, created_at: dh(0.3) },
        { quem: 'Kaiser', acao: 'chat_punir', detalhe: { quem: 'Naja', tipo: 'silencio', minutos: 60, motivo: 'flood' }, created_at: dh(1.2) },
        { quem: 'VENO', acao: 'criar torneio', detalhe: { nome: 'Copa COBR' }, created_at: dh(2) },
        { quem: 'VENO', acao: 'chat_faxina', detalhe: { fotos: 2, msgs: 14, manual: false }, created_at: dh(3) },
      ],
    };
  }

  // ---------- notificações no celular e app instalado ----------
  let pedidoInstalar = null;
  const ehIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  const appInstalado = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const pushPossivel = () => 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window && location.protocol === 'https:';
  function registrarSW() {
    if (DEMO || !('serviceWorker' in navigator) || location.protocol !== 'https:') return;
    navigator.serviceWorker.register('sw.js').catch(() => {});
    // tocou na notificação com o site já aberto: vai pro chat
    navigator.serviceWorker.addEventListener('message', (e) => {
      if (!e.data || !e.data.ir) return;
      irPara(e.data.ir);
      if (e.data.canal && chat.eu && canaisChat().some((c) => c.id === e.data.canal)) abrirCanalChat(e.data.canal);
      else if (e.data.canal) canalPedido = e.data.canal;
    });
  }
  addEventListener('beforeinstallprompt', (e) => {
    e.preventDefault();
    pedidoInstalar = e;
    mostrarBotoesApp();
    if ($('dlgAvisos').open) desenharAvisos();
    if ($('dlgInstalar').open) desenharInstalar();
  });
  addEventListener('appinstalled', () => { pedidoInstalar = null; instalouAgora = true; mostrarBotoesApp(); $('dlgInstalar').close(); toast('App do clã instalado! Abra pelo ícone COBR.'); });

  // ---------- baixar o app: botão à vista + passo a passo de cada celular ----------
  // Android com Chrome: um toque abre o "Instalar" do próprio Chrome.
  // iPhone (e Android sem esse pedido): a janela mostra onde tocar, com o desenho do botão.
  const UA = navigator.userAgent;
  const ehAndroid = /android/i.test(UA);
  const ehCelular = ehIOS || ehAndroid || /mobile/i.test(UA);
  const ehSamsung = /SamsungBrowser/i.test(UA);
  const iosOutroNav = ehIOS && /CriOS|FxiOS|EdgiOS|OPiOS/.test(UA);
  // navegador de dentro de outro app (Instagram, Facebook, TikTok…): de lá não dá pra instalar
  const appDeDentro = (() => {
    const m = UA.match(/Instagram|FBAN|FBAV|FB_IAB|Line\/|TikTok|musical_ly|BytedanceWebview|Snapchat|Telegram|Discord/i);
    if (m) return { fban: 'Facebook', fbav: 'Facebook', fb_iab: 'Facebook', 'line/': 'Line', musical_ly: 'TikTok', bytedancewebview: 'TikTok' }[m[0].toLowerCase()] || m[0];
    if (ehAndroid && /; wv\)/.test(UA)) return 'app';
    if (ehIOS && !/Safari\//.test(UA) && !appInstalado()) return 'app';
    return null;
  })();
  const ICONE_BAIXAR_APP = '<rect x="6" y="2.5" width="12" height="19" rx="2.5"/><path d="M12 7.5v7M9 11.5l3 3 3-3"/>';
  const ICONE_COMPARTILHAR = '<path d="M12 3v12M8 7l4-4 4 4"/><path d="M8 10H6v11h12V10h-2"/>';
  const ICONE_ADD_TELA = '<rect x="4" y="4" width="16" height="16" rx="3.5"/><path d="M12 8.5v7M8.5 12h7"/>';
  const ICONE_3PONTOS_V = '<circle cx="12" cy="5" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="19" r="1.6" fill="currentColor" stroke="none"/>';
  const ICONE_3PONTOS_H = '<circle cx="5" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.6" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.6" fill="currentColor" stroke="none"/>';
  const ICONE_MENU = '<path d="M4 7h16M4 12h16M4 17h16"/>';
  const ICONE_BUSSOLA = '<circle cx="12" cy="12" r="9"/><path d="M15.5 8.5l-2 5-5 2 2-5z"/>';
  const linkSite = () => location.origin + '/';
  let instalouAgora = false; // instalou nesta aba: o botão some mesmo continuando no navegador
  function mostrarBotoesApp() {
    const pode = !appInstalado() && !instalouAgora && (ehCelular || !!pedidoInstalar);
    document.querySelectorAll('[data-app]').forEach((b) => { b.hidden = !pode; });
    let fechou = 0;
    try { fechou = Number(localStorage.getItem('app_faixa_fechada') || 0); } catch (e) {}
    $('faixaAppBox').hidden = !pode || !ehCelular || Date.now() - fechou < 7 * 864e5;
  }
  async function baixarApp() {
    if ($('dlgMais').open) $('dlgMais').close();
    if (pedidoInstalar) {
      const p = pedidoInstalar;
      pedidoInstalar = null; // o Chrome só deixa usar uma vez
      p.prompt();
      await p.userChoice.catch(() => {});
      mostrarBotoesApp();
      return;
    }
    abrirInstalar();
  }
  let instPlat = 'android';
  function abrirInstalar() {
    instPlat = ehIOS ? 'iphone' : 'android';
    desenharInstalar();
    const d = $('dlgInstalar');
    if (!d.open) d.showModal();
    d.focus();
  }
  async function copiarLinkSite() {
    try { await navigator.clipboard.writeText(linkSite()); toast('Link copiado! Cole no navegador.'); }
    catch (e) { toast(linkSite()); }
  }
  const tecla = (icone, rotulo) => el('span', { class: 'inst-tecla' }, icone && svg(icone, 16), rotulo);
  const passo = (n, ...txt) => el('li', { class: 'inst-passo' }, el('span', { class: 'inst-n', text: n }), el('span', { class: 'inst-txt' }, ...txt));
  function desenharInstalar() {
    document.querySelectorAll('[data-inst]').forEach((a) => a.setAttribute('aria-selected', String(a.dataset.inst === instPlat)));
    const iphone = instPlat === 'iphone';
    const aqui = iphone === ehIOS; // é o celular que está com o site aberto (a aba pode ser a do amigo)
    const abrirChrome = `intent://${location.host}/#Intent;scheme=https;package=com.android.chrome;end`;
    const abrirSafari = `x-safari-${linkSite()}`;
    let alerta = null, rapido = null, passos, dica = null;
    if (aqui && appDeDentro) {
      alerta = el('div', { class: 'inst-alerta' },
        el('b', { text: appDeDentro === 'app' ? 'Abra no navegador primeiro' : `Você abriu pelo ${appDeDentro}` }),
        el('span', { text: `Daqui não dá pra instalar. Abra no ${iphone ? 'Safari' : 'Chrome'} e siga os passos.` }),
        el('a', { class: 'btn btn-pri', href: iphone ? abrirSafari : abrirChrome, text: `ABRIR NO ${iphone ? 'SAFARI' : 'CHROME'}` }),
        el('button', { type: 'button', class: 'link-btn', text: 'Copiar o link do site', onclick: copiarLinkSite }));
    }
    if (!iphone && aqui && pedidoInstalar) {
      rapido = el('button', { type: 'button', class: 'btn btn-pri btn-grande', onclick: baixarApp }, svg(ICONE_BAIXAR_APP, 20), 'INSTALAR AGORA');
    }
    if (iphone) {
      passos = [
        iosOutroNav && aqui
          ? passo('1', 'Toque em ', tecla(ICONE_COMPARTILHAR, 'Compartilhar'), ' ao lado do endereço')
          : passo('1', 'No Safari, toque em ', tecla(ICONE_COMPARTILHAR, 'Compartilhar'), ' (se não aparecer, toque em ', tecla(ICONE_3PONTOS_H), ' antes)'),
        passo('2', 'Role e toque em ', tecla(ICONE_ADD_TELA, 'Adicionar à Tela de Início')),
        passo('3', 'Toque em ', tecla(null, 'Adicionar'), ' no canto de cima'),
      ];
      if (!(aqui && appDeDentro)) dica = el('p', { class: 'inst-dica' }, 'Abriu pelo WhatsApp? Toque em ', tecla(ICONE_BUSSOLA), ' pra abrir no Safari.');
    } else if (ehSamsung && aqui) {
      passos = [
        passo('1', 'Toque em ', tecla(ICONE_MENU, 'Menu'), ' embaixo'),
        passo('2', 'Toque em ', tecla(ICONE_ADD_TELA, 'Adicionar página a')),
        passo('3', 'Escolha ', tecla(null, 'Tela inicial')),
      ];
    } else {
      passos = [
        passo('1', 'No Chrome, toque em ', tecla(ICONE_3PONTOS_V), ' no canto de cima'),
        passo('2', 'Toque em ', tecla(ICONE_BAIXAR_APP, 'Instalar app'), ' ou ', tecla(ICONE_ADD_TELA, 'Adicionar à tela inicial')),
        passo('3', 'Confirme em ', tecla(null, 'Instalar')),
      ];
      if (!(aqui && appDeDentro)) dica = el('p', { class: 'inst-dica' }, 'Abriu pelo WhatsApp? ', aqui ? el('a', { href: abrirChrome, text: 'Abra no Chrome' }) : 'Abra no Chrome', ' antes.');
    }
    trocar($('instalarCorpo'),
      alerta,
      rapido,
      rapido && el('div', { class: 'mod-rot', text: 'OU PELO MENU' }),
      el('ol', { class: 'inst-passos' }, passos),
      el('div', { class: 'inst-final' },
        el('img', { src: 'icon-192.png', alt: '', width: 52, height: 52 }),
        el('span', {}, el('b', { text: 'Pronto!' }), ' O ícone COBR aparece na tela do celular. Entre por ele.')),
      dica);
  }
  const b64uBytes = (s) => { const b = atob((s + '='.repeat((4 - s.length % 4) % 4)).replace(/-/g, '+').replace(/_/g, '/')); return Uint8Array.from(b, (c) => c.charCodeAt(0)); };
  async function minhaInscricao() {
    if (!pushPossivel()) return null;
    const reg = await navigator.serviceWorker.getRegistration();
    return reg && reg.pushManager ? reg.pushManager.getSubscription() : null;
  }
  async function abrirAvisos() {
    $('dlgMais').close();
    trocar($('avisosCorpo'), el('p', { class: 'mod-sub', text: 'Carregando…' }));
    $('dlgAvisos').showModal();
    desenharAvisos();
  }
  async function desenharAvisos() {
    let sub = null, eu = { prefs: { mencao: true, resposta: true, aviso: true, bonde: true, tudo: false, mudos: [] }, inscrito: false };
    try { sub = await minhaInscricao(); eu = await chatRpc('push_eu', { p_endpoint: sub ? sub.endpoint : null }) || eu; } catch (e) {}
    const ligado = !!sub && eu.inscrito && typeof Notification !== 'undefined' && Notification.permission === 'granted';
    let estado, botao = null;
    if (!pushPossivel()) estado = ehIOS && !appInstalado() ? 'No iPhone, as notificações só funcionam com o app instalado (veja abaixo).' : 'Este navegador não mostra notificações.';
    else if (Notification.permission === 'denied') { estado = 'Notificações bloqueadas neste aparelho.'; problemaPush = 'sem_pedido'; }
    else if (ligado) { estado = 'Ligadas neste aparelho.'; problemaPush = null; botao = el('button', { type: 'button', class: 'btn btn-sec', text: 'Desligar', onclick: desligarPush }); }
    else { estado = 'Desligadas neste aparelho.'; botao = el('button', { type: 'button', class: 'btn btn-pri', text: 'Ligar notificações', onclick: ligarPush }); }
    const prefs = { tudo: false, ...eu.prefs, mudos: new Set(eu.prefs.mudos || []) };
    const salvar = async () => {
      try {
        await chatRpc('push_salvar_prefs', { p_mencao: prefs.mencao, p_resposta: prefs.resposta, p_aviso: prefs.aviso, p_bonde: prefs.bonde, p_tudo: prefs.tudo, p_mudos: [...prefs.mudos] });
      } catch (e) { erroChat(e); }
    };
    const chave = (k, txt, depois) => el('button', { type: 'button', class: 'ch-switch', role: 'switch', 'aria-checked': String(!!prefs[k]), onclick: (ev) => {
      prefs[k] = !prefs[k];
      ev.currentTarget.setAttribute('aria-checked', String(prefs[k]));
      const salvou = salvar();
      if (depois) depois(salvou);
    } }, el('i'), txt);
    // convite da sala de jogos: preferência própria (ligada pra todo mundo até a pessoa desligar)
    let jogosLigado = eu.prefs.jogos !== false;
    const chaveJogos = DEMO ? null : el('button', { type: 'button', class: 'ch-switch', role: 'switch', 'aria-checked': String(jogosLigado), onclick: (ev) => {
      jogosLigado = !jogosLigado;
      ev.currentTarget.setAttribute('aria-checked', String(jogosLigado));
      chatRpc('push_salvar_jogos', { p_ligado: jogosLigado }).catch(erroChat);
    } }, el('i'), 'Me chamarem pra jogar');
    // ligar "Todas as mensagens" com este aparelho desligado: pede a permissão e liga junto
    const tudoMudou = (salvou) => {
      mostrarCanais();
      if (prefs.tudo && !ligado && pushPossivel() && Notification.permission !== 'denied') salvou.then(ligarPush);
    };
    // com "todas as mensagens" ligado, cada canal pode ir pro mudo (marcação e resposta continuam chegando)
    const canais = el('div', { class: 'av-prefs av-canais' }, ...canaisChat().filter((c) => !c.soSite).map((c) => el('button', {
      type: 'button', class: 'ch-switch', role: 'switch', 'aria-checked': String(!prefs.mudos.has(c.id)), onclick: (ev) => {
        if (prefs.mudos.has(c.id)) prefs.mudos.delete(c.id); else prefs.mudos.add(c.id);
        ev.currentTarget.setAttribute('aria-checked', String(!prefs.mudos.has(c.id)));
        salvar();
      },
    }, el('i'), icoCanal(c, 15), `#${c.nome}`)));
    const canaisRot = el('div', { class: 'mod-rot', text: 'CANAIS QUE TOCAM' });
    const mostrarCanais = () => { canais.hidden = canaisRot.hidden = !prefs.tudo; };
    mostrarCanais();
    let app;
    if (appInstalado()) app = el('p', { class: 'av-app-ok', text: 'App instalado neste aparelho.' });
    else if (ehCelular || pedidoInstalar) app = el('button', { type: 'button', class: 'btn btn-pri', text: 'Baixar o app', onclick: () => { $('dlgAvisos').close(); baixarApp(); } });
    else app = el('p', { class: 'mod-sub', text: 'No menu do navegador: "Instalar app" ou "Adicionar à tela inicial".' });
    trocar($('avisosCorpo'),
      el('div', { class: 'mod-rot', text: 'NESTE APARELHO' }),
      el('div', { class: 'av-estado' }, el('span', { class: `ch-bola ${ligado ? 'on' : ''}` }), el('span', { text: estado }), botao),
      problemaPush ? ajudaPush(problemaPush) : null,
      el('div', { class: 'mod-rot', text: 'ME AVISAR QUANDO' }),
      el('div', { class: 'av-prefs' }, chave('tudo', 'Todas as mensagens', tudoMudou), chave('mencao', 'Me marcarem com @'), chave('resposta', 'Responderem minha mensagem'), chave('aviso', `Sair aviso no #${nomeCanal('avisos')}`), chave('bonde', 'Alguém chamar o bonde'), chaveJogos),
      canaisRot, canais,
      el('div', { class: 'mod-rot', text: 'APP DO CLÃ' }),
      app);
  }
  // quem apertou "Desligar" neste aparelho não volta a receber sozinho
  const chaveSemPush = () => 'push_desligado_' + euChat();
  async function inscreverAparelho() {
    const chavePub = await chatRpc('push_chave', {});
    if (!chavePub) return false;
    const reg = await navigator.serviceWorker.ready;
    let sub = await reg.pushManager.getSubscription();
    if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64uBytes(chavePub) });
    const j = sub.toJSON();
    await chatRpc('push_inscrever', { p_endpoint: j.endpoint, p_p256dh: j.keys.p256dh, p_auth: j.keys.auth });
    return true;
  }
  let problemaPush = null;          // o que deu errado na última vez que tentou ligar: sem_pedido | servidor | erro
  const comPrazo = (p, ms) => Promise.race([p, new Promise((_, nao) => setTimeout(() => nao(new Error('prazo')), ms))]);
  async function ligarPush(ev) {
    const bt = ev && ev.currentTarget;
    if (bt) { bt.disabled = true; bt.textContent = 'Ligando…'; }
    problemaPush = null;
    try {
      const perm = Notification.permission === 'granted' ? 'granted' : await comPrazo(Notification.requestPermission(), 60000);
      if (perm !== 'granted') problemaPush = 'sem_pedido';
      else if (!(await comPrazo(inscreverAparelho(), 20000))) problemaPush = 'servidor';
      else {
        try { localStorage.removeItem(chaveSemPush()); } catch (e) {}
        toast('Notificações ligadas neste aparelho.');
      }
    } catch (e) {
      console.warn('push:', e.message);
      problemaPush = e.message === 'prazo' && Notification.permission !== 'granted' ? 'sem_pedido' : 'erro';
    }
    desenharAvisos();
  }
  // o celular não deixou: como liberar em cada aparelho
  function ajudaPush(tipo) {
    if (tipo === 'servidor') return el('div', { class: 'av-ajuda' }, el('b', { text: 'As notificações ainda não foram ligadas no servidor.' }));
    if (tipo === 'erro') return el('div', { class: 'av-ajuda' }, el('b', { text: 'Não deu pra ligar agora.' }), el('span', { text: 'Feche o app (tire da lista de abertos), abra de novo e tente outra vez.' }));
    const passos = ehIOS ? ['Ajustes do iPhone', 'Notificações', 'COBR', 'Permitir Notificações']
      : ehAndroid && appInstalado() ? ['Segure o ícone do COBR na tela', 'Informações do app', 'Notificações', 'Ligar']
      : ehAndroid ? ['No Chrome, toque em ⋮', 'Configurações', 'Configurações do site', 'Notificações', location.hostname, 'Permitir']
      : ['Clique no cadeado ao lado do endereço', 'Notificações', 'Permitir'];
    return el('div', { class: 'av-ajuda' },
      el('b', { text: 'O celular não deixou ligar. Libere assim:' }),
      el('ol', null, ...passos.map((x) => el('li', { text: x }))),
      el('span', { text: 'Depois volte aqui e toque em Ligar notificações.' }));
  }
  async function desligarPush() {
    try {
      const sub = await minhaInscricao();
      if (sub) { await chatRpc('push_sair', { p_endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); }
      try { localStorage.setItem(chaveSemPush(), '1'); } catch (e) {}
      toast('Notificações desligadas neste aparelho.');
    } catch (e) { erroChat(e); }
    desenharAvisos();
  }
  // o aparelho já deu a permissão (saiu e entrou na conta, reinstalou o app, o celular trocou a inscrição):
  // ao abrir o chat ele volta a receber sozinho
  async function religarPush() {
    try {
      if (!pushPossivel() || Notification.permission !== 'granted') return;
      try { if (localStorage.getItem(chaveSemPush())) return; } catch (e) {}
      await inscreverAparelho();
    } catch (e) { console.warn('push:', e.message); }
  }

  // ---------- digitando, @menção e emojis ----------
  let ultDigitou = 0;
  function avisarDigitando(audio = false) {
    if (DEMO || !chat.presenca || Date.now() - ultDigitou < 2500) return;
    ultDigitou = Date.now();
    chat.presenca.send({ type: 'broadcast', event: 'digitando', payload: { user_id: euChat(), nome: meuNick(), canal: chat.canal, audio } });
  }
  function alguemDigitando(p) {
    if (!p || p.user_id === euChat()) return;
    chat.digitando.set(p.user_id, { ...p, ate: Date.now() + 3500 });
    if (chatVisivel()) { desenharDigitando(); setTimeout(desenharDigitando, 3600); }
  }
  function sugerirMencao() {
    const campo = $('chatTxt'), caixa = $('chatMencoes');
    const m = campo.value.slice(0, campo.selectionStart).match(/@([\p{L}\p{N}_.-]*)$/u);
    if (!m) { caixa.hidden = true; return; }
    const q = busca(m[1]);
    const lista = jogadores.filter((r) => r.ativo && busca(r.nick).startsWith(q) && r.id !== (chat.eu && chat.eu.player_id)).slice(0, 6);
    if (!lista.length) { caixa.hidden = true; return; }
    trocar(caixa, lista.map((r, i) => el('button', {
      type: 'button', class: i === 0 ? 'sel' : '',
      onclick: () => {
        const ini = campo.selectionStart - m[0].length;
        campo.value = campo.value.slice(0, ini) + '@' + r.nick + ' ' + campo.value.slice(campo.selectionStart);
        caixa.hidden = true;
        $('chatEnviar').disabled = false;
        campo.focus();
      },
    }, avatarChat(r.nick, 'av-p'), el('b', { text: r.nick }), chipPatente(ptsPat(chave(r.nick))))));
    caixa.hidden = false;
  }
  function abrirEmojisChat(alvo, escolher) {
    const pop = $('chatEmojis');
    trocar(pop, REACOES_CHAT.map((e) => el('button', { type: 'button', class: e === 'GG' ? 'ch-gg' : '', 'aria-label': e, onclick: () => { pop.hidden = true; escolher(e); }, text: e })));
    pop.hidden = false;
    const r = alvo.getBoundingClientRect(), w = pop.offsetWidth, h = pop.offsetHeight;
    pop.style.left = Math.max(8, Math.min(innerWidth - w - 8, r.right - w)) + 'px';
    pop.style.top = (r.top - h - 8 < 8 ? r.bottom + 8 : r.top - h - 8) + 'px';
  }

  function ligarControlesChat() {
    $('chatBondeBtn').append(svg(ICONE_BONDE, 20));
    $('chatFotoBtn').append(svg(ICONE_FOTO, 20));
    $('chatEmojiBtn').append(svg(ICONE_SORRISO, 20));
    $('chatEnviar').append(svg(ICONE_ENVIAR, 18));
    $('chatAudioBtn').append(svg(ICONE_MIC, 20));
    $('chatAudioLixo').append(svg(ICONE_LIXO, 20));
    $('chatAudioEnviar').append(svg(ICONE_ENVIAR, 18));
    $('chatAudioBtn').addEventListener('click', gravarAudio);
    $('chatAudioLixo').addEventListener('click', () => pararGravacao(false));
    $('chatAudioEnviar').addEventListener('click', () => pararGravacao(true));
    $('chatAvisosBtn').append(svg(ICONE_SINO, 18));
    const campo = $('chatTxt');
    campo.addEventListener('input', () => { $('chatEnviar').disabled = !campo.value.trim() && !(chat.editando && chat.editando.tipo === 'foto'); sugerirMencao(); if (campo.value) avisarDigitando(); });
    campo.addEventListener('keydown', (e) => {
      const caixa = $('chatMencoes');
      if (caixa.hidden) { if (e.key === 'Escape' && (chat.resp || chat.editando)) cancelarRespChat(); return; }
      const bs = [...caixa.querySelectorAll('button')], i = bs.findIndex((b) => b.classList.contains('sel'));
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); const k = (i + (e.key === 'ArrowDown' ? 1 : -1) + bs.length) % bs.length; bs.forEach((b, j) => b.classList.toggle('sel', j === k)); }
      else if ((e.key === 'Enter' || e.key === 'Tab') && i >= 0) { e.preventDefault(); bs[i].click(); }
      else if (e.key === 'Escape') caixa.hidden = true;
    });
    $('chatCompor').addEventListener('submit', (e) => { e.preventDefault(); enviarChat(); });
    $('chatEmojiBtn').addEventListener('click', (e) => abrirEmojisChat(e.currentTarget, (x) => {
      const i = campo.selectionStart ?? campo.value.length;
      campo.value = campo.value.slice(0, i) + x + ' ' + campo.value.slice(i);
      $('chatEnviar').disabled = false;
      campo.focus();
    }));
    $('chatFotoBtn').addEventListener('click', () => $('chatFotoArq').click());
    $('chatFotoArq').addEventListener('change', (e) => { const f = e.target.files && e.target.files[0]; e.target.value = ''; enviarFoto(f); });
    $('chatBondeBtn').addEventListener('click', abrirBonde);
    $('formBonde').addEventListener('submit', (e) => { e.preventDefault(); chamarBonde(); });
    $('btnCancelarBonde').addEventListener('click', () => $('dlgBonde').close());
    document.querySelectorAll('[data-vagas]').forEach((b) => b.addEventListener('click', () => {
      document.querySelectorAll('[data-vagas]').forEach((x) => x.setAttribute('aria-checked', String(x === b)));
    }));
    $('chatJogando').addEventListener('click', alternarJogando);
    $('chatModBtn').addEventListener('click', () => abrirModeracao('denuncias'));
    $('chatAvisosBtn').addEventListener('click', abrirAvisos);
    $('maisApp').addEventListener('click', abrirAvisos);
    $('btnFecharAvisos').addEventListener('click', () => $('dlgAvisos').close());
    document.querySelectorAll('[data-app-abrir]').forEach((b) => b.addEventListener('click', baixarApp));
    $('btnFecharFaixaApp').addEventListener('click', () => {
      try { localStorage.setItem('app_faixa_fechada', String(Date.now())); } catch (e) {}
      $('faixaAppBox').hidden = true;
    });
    $('btnFecharInstalar').addEventListener('click', () => $('dlgInstalar').close());
    document.querySelectorAll('[data-inst]').forEach((a) => a.addEventListener('click', () => { instPlat = a.dataset.inst; desenharInstalar(); }));
    $('chatMembrosBtn').addEventListener('click', () => $('chatMembros').classList.toggle('aberto'));
    $('chatNovas').addEventListener('click', () => descerChat(true));
    $('chatMsgs').addEventListener('scroll', () => {
      if (pertoDoFimChat()) { $('chatNovas').hidden = true; chat.novas = 0; marcarLidoChat(); }
      if ($('chatMsgs').scrollTop < 80) carregarAntigas();
    });
    // no celular: tocar na mensagem mostra as ações dela
    $('chatMsgs').addEventListener('click', (e) => {
      if (e.target.closest('button')) return;
      const n = e.target.closest('.ch-m');
      const ja = n && n.classList.contains('ativa');
      $('chatMsgs').querySelectorAll('.ch-m.ativa').forEach((x) => x.classList.remove('ativa'));
      if (n && !ja) n.classList.add('ativa');
    });
    document.addEventListener('pointerdown', (e) => {
      const pop = $('chatEmojis');
      if (!pop.hidden && !pop.contains(e.target) && !e.target.closest('.ch-acoes, #chatEmojiBtn')) pop.hidden = true;
    });
    document.querySelectorAll('[data-mod]').forEach((b) => b.addEventListener('click', () => abrirModeracao(b.dataset.mod)));
    $('btnFecharMod').addEventListener('click', () => $('dlgModeracao').close());
    $('btnCancelarPunir').addEventListener('click', () => $('dlgPunir').close());
    $('formCanal').addEventListener('submit', (e) => { e.preventDefault(); salvarCanal(); });
    $('btnCancelarCanal').addEventListener('click', () => $('dlgCanal').close());
    $('btnApagarCanal').addEventListener('click', apagarCanal);
    $('fCanalBusca').addEventListener('input', desenharMembrosCanal);
    $('btnAplicarPunir').addEventListener('click', aplicarPunicao);
    addEventListener('resize', ajustarChat);
    if (window.visualViewport) visualViewport.addEventListener('resize', ajustarChat);
    document.addEventListener('visibilitychange', () => { if (chatVisivel()) marcarLidoChat(); });
    // bonde que fecha, "jogando" que vence, silêncio que acaba: a tela acompanha
    setInterval(() => {
      if (!chat.eu || !chatVisivel()) return;
      desenharTopoChat(); desenharMembrosChat(); desenharComporChat();
    }, 30000);
    registrarSW();
    mostrarBotoesApp();
  }

  // ---------- demonstração: o chat funciona só nesta tela ----------
  const demoChat = {
    id: 0, denuncias: [], punidos: [], historico: [], adms: new Set(['u-dj1']), palavroes: [], prefs: { mencao: true, resposta: true, aviso: true, bonde: true, tudo: false, mudos: [] },
    canais: [{ id: 'adm', nome: 'adm', emoji: '🛡️', ve: 'adm', fala: 'todos', ordem: 0, criado_por: null }], membros: new Map(), canalN: 0,
    dias: { dias_foto: 30, dias_msg: 90 },
  };
  function demoChatSemear() {
    limparChat();
    const nomeEu = admin && !euId ? admin.nome : nickDoPlayer(euId, 'Você');
    chat.eu = { user_id: 'eu', player_id: euId, nome: nomeEu, adm: !!admin, dono: !!admin, punicao: null };
    const u = (pid) => 'u-' + pid;
    chat.equipe = new Map([['u-dj0', 'dono'], ...[...demoChat.adms].map((x) => [x, 'adm'])]);
    if (admin) chat.equipe.set('eu', 'dono');
    // o membro comum não vê o #adm (nem canal de escolhidos em que não está)
    aplicarCriados(demoChat.canais.filter((c) => !!admin || c.ve === 'todos' || (c.ve === 'escolhidos' && (demoChat.membros.get(c.id) || new Set()).has('eu'))));
    const min = (m) => new Date(Date.now() - m * 60000).toISOString();
    const msg = (canal, pid, txt, m, extra = {}) => {
      const r = jogPorId.get(pid);
      const x = { id: ++demoChat.id, canal, user_id: u(pid), player_id: pid, nome: r ? r.nick : '', adm: false, tipo: 'msg', txt, dados: {}, resp: null, fixada: false, apagada: false, editada: false, created_at: min(m), ...extra };
      guardarMsg(x);
      return x;
    };
    const massa = (canal, p) => guardarMsg({ id: ++demoChat.id, canal, user_id: null, player_id: null, nome: 'COBR', adm: false, tipo: 'massa', txt: '', dados: { score_id: p.id, player: p.player, mass: p.mass }, resp: null, fixada: false, apagada: false, created_at: p.created_at });
    const recentes = partidas.slice(0, 6).reverse();
    for (const p of recentes) massa('recordes', p);
    // pra faxina ter o que limpar: uma mensagem de 100 dias, uma foto de 40 e uma que já expirou
    msg('bonde', 'dj2', 'bora fechar sala de 4?', 100 * 1440);
    msg('bonde', 'dj6', 'print da massa de ontem', 40 * 1440, { tipo: 'foto', dados: { path: 'demo/velha.webp', w: 4, h: 3 } });
    msg('bonde', 'dj1', '', 35 * 1440, { tipo: 'foto', dados: { w: 4, h: 3, expirada: true } });
    msg('geral', 'dj1', 'boa noite família 🐍', 300);
    msg('geral', 'dj3', 'boa! hoje tem treino pra copa?', 296);
    msg('geral', 'dj4', '', 293, { tipo: 'audio', dados: { path: 'demo/audio.webm', dur: 14, onda: '1357864579865432125678976543234567898642' } });
    const a = msg('geral', 'dj0', 'tem sim, 21h no servidor BR. quem for da copa cola', 290);
    a.fixada = true;
    mexerReac(a.id, '🔥', u('dj1'), true, false); mexerReac(a.id, '🔥', u('dj3'), true, false); mexerReac(a.id, '👍', u('dj4'), true, false);
    const big = recentes.filter((p) => p.mass >= 100000).pop();
    let mm = null;
    if (big) { mm = massa('geral', big); mexerReac(mm.id, '🔥', u('dj4'), true, false); mexerReac(mm.id, 'GG', u('dj3'), true, false); }
    const b = msg('geral', 'dj4', mm ? '100k?? tá de hack kkkk' : 'alguém on?', 100, { resp: mm ? mm.id : null });
    mexerReac(b.id, '😂', u('dj1'), true, false);
    const bonde = msg('geral', 'dj3', '', 20, { tipo: 'bonde', dados: { srv: 'Servidor BR · 21h', max: 6 } });
    for (const pid of ['dj3', 'dj4', 'dj5']) mexerBonde({ msg_id: bonde.id, user_id: u(pid), player_id: pid, nome: jogPorId.get(pid).nick }, true, false);
    msg('geral', 'dj5', `@${nickDoPlayer('dj3', '')} guarda vaga pra mim`, 12, { editada: true });
    msg('bonde', 'dj6', 'alguém pra jogar de madrugada?', 50);
    msg('avisos', 'dj0', 'Copa COBR no sábado às 21h. Cada um com a tag [COBR] no nick.', 900);
    if (chat.msgs.adm) {
      msg('adm', 'dj0', 'galera da staff: sábado cada um fica de olho num grupo da copa', 240);
      msg('adm', 'dj1', 'fechou, fico com o grupo A', 230);
    }
    for (const pid of ['dj3', 'dj4', 'dj5']) chat.status.set(u(pid), { user_id: u(pid), player_id: pid, nome: jogPorId.get(pid).nick, jogando_ate: new Date(Date.now() + 70 * 60000).toISOString() });
    chat.online = new Map([['eu', { player_id: euId, nome: nomeEu }], ...['dj0', 'dj1', 'dj6'].map((pid) => [u(pid), { player_id: pid, nome: jogPorId.get(pid).nick }])]);
    demoChat.denuncias = [{ msg_id: b.id, user_id: u('dj2') }];
  }
  function demoChatRpc(nome, a) {
    const agora = new Date().toISOString();
    const eu = chat.eu;
    const m = a && a.p_msg ? chat.porId.get(a.p_msg) : null;
    const punicao = (u) => demoChat.punidos.find((p) => p.user_id === u && (!p.ate || Date.parse(p.ate) > Date.now()));
    const log = (acao, detalhe) => demoChat.historico.unshift({ acao, detalhe, created_at: agora, quem: eu.nome });
    const nomeDaConta = (u) => (u === 'eu' ? meuNick() : nickDoPlayer(String(u).replace('u-', ''), '?'));
    // as mesmas regras de chat_foto_vencida e chat_msg_vencida
    const velha = (x, dias) => !x.fixada && x.canal !== 'avisos' && Date.now() - Date.parse(x.created_at) > dias * 86400000;
    const { dias_foto: dFoto, dias_msg: dMsg } = demoChat.dias;
    const vidaFoto = dFoto && dMsg ? Math.min(dFoto, dMsg) : dFoto || dMsg;
    const fotoVencida = (x) => (x.tipo === 'foto' || x.tipo === 'audio') && !!(x.dados && x.dados.path) && !!vidaFoto && velha(x, vidaFoto);
    const msgVencida = (x) => !(x.dados && x.dados.path) && !!dMsg && velha(x, dMsg);
    // as mesmas regras de chat_limpeza_pega
    const pega = (x) => a.p_canais.includes(x.canal) && a.p_tipos.includes(x.tipo) && (!a.p_user || x.user_id === a.p_user) && (a.p_fixadas || !x.fixada)
      && (a.p_idade == null || (a.p_idade > 0 ? Date.now() - Date.parse(x.created_at) > a.p_idade * 3600000 : Date.now() - Date.parse(x.created_at) < -a.p_idade * 3600000));
    switch (nome) {
      case 'dono_faxina_cfg': demoChat.dias = { dias_foto: a.p_dias_foto, dias_msg: a.p_dias_msg }; log('dono_faxina_cfg', demoChat.dias); return null;
      case 'dono_limpeza': {
        const l = [...chat.porId.values()].filter(pega);
        const r = { msgs: l.length, fotos: l.filter((x) => x.tipo === 'foto').length, audios: l.filter((x) => x.tipo === 'audio').length };
        if (!a.p_apagar) return r;
        for (const x of l) sumiuMsg(x.id, false);
        if (r.msgs) log('dono_limpeza', { ...r, quem: a.p_user ? nomeDaConta(a.p_user) : null });
        return { ...r, arquivos: [], ids: l.map((x) => x.id) };
      }
      case 'chat_faxina_fotos': return [...chat.porId.values()].filter(fotoVencida).map((x) => x.dados.path);
      case 'chat_faxina': {
        const fotos = [...chat.porId.values()].filter((x) => fotoVencida(x) && a.p_fotos.includes(x.dados.path));
        for (const x of fotos) { const { path, ...resto } = x.dados; atualizarMsg({ id: x.id, dados: { ...resto, expirada: true } }); }
        const msgs = [...chat.porId.values()].filter(msgVencida);
        for (const x of msgs) sumiuMsg(x.id);
        const r = { fotos: fotos.length, msgs: msgs.length };
        if (a.p_manual || r.fotos + r.msgs) { log('chat_faxina', { ...r, manual: a.p_manual }); demoChat.faxina = agora; }
        return r;
      }
      case 'chat_enviar': {
        const x = { id: ++demoChat.id, canal: a.p_canal, user_id: eu.user_id, player_id: eu.player_id, nome: meuNick(), adm: eu.adm, tipo: a.p_tipo || 'msg', txt: a.p_txt || '', dados: a.p_dados || {}, resp: a.p_resp || null, fixada: false, apagada: false, editada: false, created_at: agora };
        if (x.tipo === 'bonde') chat.bonde.set(x.id, [{ user_id: eu.user_id, player_id: eu.player_id, nome: meuNick() }]);
        chegouMsg(x);
        return x.id;
      }
      case 'chat_editar': return a.p_txt;
      case 'chat_reagir': { const s = chat.reac.get(a.p_msg)?.get(a.p_emoji); return !(s && s.has(eu.user_id)); }
      case 'chat_bonde_entrar': return 'ok';
      case 'chat_jogando': return a.p_ligar ? new Date(Date.now() + 90 * 60000).toISOString() : null;
      case 'chat_denunciar': demoChat.denuncias.push({ msg_id: a.p_msg, user_id: eu.user_id }); return null;
      case 'chat_apagar': if (m && m.user_id !== eu.user_id) log('chat_apagar', { autor: m.nome, texto: m.txt }); demoChat.denuncias = demoChat.denuncias.filter((d) => d.msg_id !== a.p_msg); return null;
      case 'chat_limpar': log('chat_limpar', { quem: nomeDaConta(a.p_user), horas: a.p_horas }); return { qtd: [...chat.porId.values()].filter((x) => x.user_id === a.p_user && !x.apagada).length, fotos: [] };
      case 'chat_fixar': log(a.p_fixar ? 'chat_fixar' : 'chat_desafixar', {}); return null;
      case 'chat_punir': {
        if (chat.equipe.has(a.p_user)) return 'adm';
        const quem = nomeDaConta(a.p_user);
        demoChat.punidos = demoChat.punidos.filter((p) => p.user_id !== a.p_user);
        demoChat.punidos.unshift({ user_id: a.p_user, nome: quem, player_id: a.p_user.replace('u-', ''), tipo: a.p_tipo, ate: a.p_minutos ? new Date(Date.now() + a.p_minutos * 60000).toISOString() : null, motivo: a.p_motivo, por: eu.nome, created_at: agora });
        log('chat_punir', { quem, tipo: a.p_tipo, minutos: a.p_minutos, motivo: a.p_motivo });
        return 'ok';
      }
      case 'chat_perdoar': { const p = demoChat.punidos.find((x) => x.user_id === a.p_user); demoChat.punidos = demoChat.punidos.filter((x) => x.user_id !== a.p_user); log('chat_perdoar', { quem: p && p.nome }); return null; }
      case 'chat_ignorar_denuncia': demoChat.denuncias = demoChat.denuncias.filter((d) => d.msg_id !== a.p_msg); log('chat_ignorar_denuncia', {}); return null;
      case 'chat_config_canal': log('chat_canal', { canal: a.p_canal, travado: a.p_travado, lento: a.p_lento }); return null;
      case 'dono_canal': log('dono_canal', { canal: a.p_canal, ligado: a.p_ligado }); return null;
      case 'chat_salvar_palavroes': demoChat.palavroes = [...new Set(a.p_lista.map((x) => x.toLowerCase()))]; log('chat_palavroes', { qtd: demoChat.palavroes.length }); return demoChat.palavroes.length;
      case 'chat_moderacao': {
        const grupos = new Map();
        for (const d of demoChat.denuncias) {
          const x = chat.porId.get(d.msg_id);
          if (!x) continue;
          const g = grupos.get(d.msg_id) || { msg_id: x.id, canal: x.canal, user_id: x.user_id, nome: x.nome, txt: x.txt, tipo: x.tipo, created_at: x.created_at, qtd: 0, quem: [] };
          g.qtd++; g.quem.push({ quem: nomeDaConta(d.user_id), motivo: '' });
          grupos.set(d.msg_id, g);
        }
        return { denuncias: [...grupos.values()], punidos: demoChat.punidos.filter((p) => punicao(p.user_id)), historico: demoChat.historico,
          canais: Object.fromEntries([...chat.cfg].map(([k, v]) => [k, v])), palavroes: demoChat.palavroes,
          faxina: { fotos: [...chat.porId.values()].filter((x) => fotoVencida(x) && !x.apagada).length, msgs: [...chat.porId.values()].filter(msgVencida).length, ultima: demoChat.faxina || null, ...demoChat.dias } };
      }
      case 'dono_equipe': return jogadores.filter((r) => r.ativo && r.id !== 'dj7').map((r) => ({ user_id: u(r.id), player_id: r.id, nome: r.nick, papel: chat.equipe.get(u(r.id)) || 'membro' }));
      case 'dono_promover': if (a.p_adm) { demoChat.adms.add(a.p_user); chat.equipe.set(a.p_user, 'adm'); } else { demoChat.adms.delete(a.p_user); chat.equipe.delete(a.p_user); } log(a.p_adm ? 'dono_promover' : 'dono_rebaixar', { quem: nomeDaConta(a.p_user) }); return 'ok';
      case 'dono_expulsar': { const r = jogPorId.get(a.p_user.replace('u-', '')); if (r) r.ativo = false; log('dono_expulsar', { quem: nomeDaConta(a.p_user) }); return 'ok'; }
      case 'push_eu': return { prefs: demoChat.prefs, inscrito: false };
      case 'push_salvar_prefs': demoChat.prefs = { mencao: a.p_mencao, resposta: a.p_resposta, aviso: a.p_aviso, bonde: a.p_bonde, tudo: a.p_tudo ?? demoChat.prefs.tudo, mudos: a.p_mudos ?? demoChat.prefs.mudos }; return null;
      case 'chat_contas': return [...jogadores.filter((r) => r.ativo && r.id !== 'dj7').map((r) => ({ user_id: u(r.id), player_id: r.id, nome: r.nick })), ...(admin && !euId ? [{ user_id: 'eu', player_id: null, nome: admin.nome }] : [])];
      case 'chat_salvar_canal': {
        const dados = { nome: a.p_nome.slice(0, 24), emoji: a.p_emoji, ve: a.p_ve, fala: a.p_fala };
        const base = CANAIS_CHAT.find((x) => x.id === a.p_id);
        if (base) {
          const g = chat.cfg.get(base.id) || {};
          chat.cfg.set(base.id, { ...cfgCanal(base.id), canal: base.id, nome: dados.nome, emoji: a.p_emoji || null,
            ve: base.id === 'geral' ? 'todos' : a.p_ve, fala: base.soSite ? null : a.p_fala });
          demoChat.membros.set(base.id, new Set(a.p_ve === 'escolhidos' && base.id !== 'geral' ? a.p_membros : []));
          log('chat_canal_editar', { canal: base.id, ...dados, antes: g.nome || base.nome });
          return base.id;
        }
        let c = demoChat.canais.find((x) => x.id === a.p_id);
        if (c) { Object.assign(c, dados); log('chat_canal_editar', { canal: c.id, ...dados }); }
        else {
          c = { id: 'c' + (++demoChat.canalN), ...dados, ordem: demoChat.canais.length, criado_por: eu.user_id };
          demoChat.canais.push(c);
          log('chat_canal_criar', dados);
        }
        demoChat.membros.set(c.id, new Set(a.p_ve === 'escolhidos' ? a.p_membros : []));
        return c.id;
      }
      case 'chat_apagar_canal': {
        const c = demoChat.canais.find((x) => x.id === a.p_id);
        demoChat.canais = demoChat.canais.filter((x) => x.id !== a.p_id);
        if (c) log('chat_canal_apagar', { canal: c.id, nome: c.nome });
        return [];
      }
      case 'push_chave': return null;
    }
    return null;
    function u(pid) { return 'u-' + pid; }
  }

  // regras do chat (aba "Chat" do Como funciona)
  function regrasChat() {
    return [
      el('ul', { class: 'rg-lista' },
        linhaRegra(`#${nomeCanal('geral')}`, 'papo do clã'),
        cfgCanal('bonde').desligado ? null : linhaRegra(`#${nomeCanal('bonde')}`, 'chamada pra jogar junto'),
        cfgCanal('recordes').desligado ? null : linhaRegra(`#${nomeCanal('recordes')}`, 'cada massa registrada cai sozinha'),
        cfgCanal('avisos').desligado ? null : linhaRegra(`#${nomeCanal('avisos')}`, canalBase(CANAIS_CHAT[3]).soAdm ? 'só ADM escreve' : 'recado pro clã todo'),
        linhaRegra('#adm', 'só Dono e ADMs veem'),
        linhaRegra('Canal novo', 'o ADM cria e escolhe quem vê e quem escreve'),
        linhaRegra('Massa de 100k+', `aparece também no #${nomeCanal('geral')}`),
        linhaRegra('Editar', 'até 15 min depois de mandar')),
      tituloRegra('NOTIFICAÇÕES'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Todas as mensagens', 'liga no sino do chat'),
        linhaRegra('Canal no mudo', 'só toca se te marcarem ou responderem')),
      tituloRegra('STATUS'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Online', 'com o site aberto'),
        linhaRegra('Jogando', 'tocou em "Tô jogando" ou entrou num bonde'),
        linhaRegra('Jogando some', 'sozinho depois de 90 min'),
        linhaRegra('Bonde', 'fecha 3 h depois de criado')),
      tituloRegra('FAXINA'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Foto', 'some depois de 30 dias'),
        linhaRegra('Mensagem', 'some depois de 90 dias'),
        linhaRegra(`#${nomeCanal('avisos')} e fixadas`, 'nunca somem')),
      tituloRegra('QUEM MANDA'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Dono', 'o site todo e escolhe os ADMs'),
        linhaRegra('ADM', 'só o chat'),
        linhaRegra('ADM e Dono', 'não podem ser punidos')),
      tituloRegra('MODERAÇÃO'),
      el('ul', { class: 'rg-lista' },
        linhaRegra('Denunciar', 'manda a mensagem pros ADMs'),
        linhaRegra('Silenciado', 'lê, mas não escreve nem reage'),
        linhaRegra('Fora do chat', 'não lê nem escreve'),
        linhaRegra('Canal travado', 'só ADM escreve'),
        linhaRegra('Modo lento', 'espera entre mensagens'),
        linhaRegra('Palavrão da lista', 'vira ***'),
        linhaRegra('Limite', '5 mensagens a cada 10 segundos')),
    ];
  }

  // ---------- início ----------
  function iniciar() {
    // volta do link do e-mail (confirmar conta / senha nova): o Supabase manda tudo depois do #
    const h = new URLSearchParams(location.hash.slice(1));
    linkEmail = h.has('access_token') ? { tipo: h.get('type') } : null;
    if (h.has('error_code') || h.has('error_description')) {
      history.replaceState(null, '', location.pathname + location.search);
      setTimeout(() => toast(h.get('error_code') === 'otp_expired'
        ? 'Esse link venceu ou já foi usado. Entre com e-mail e senha, ou peça outro.'
        : 'Não deu pra abrir esse link. Tenta entrar de novo.', true), 600);
    }
    document.querySelectorAll('[data-tag]').forEach((n) => { n.textContent = TAG; });
    document.title = `Ranking Clã ${TAG}`;
    const mes = new Date().toLocaleDateString('pt-BR', { month: 'long' });
    $('seloPeriodo').textContent = `TEMPORADA DE ${mes.toUpperCase()}`;
    $('printOpc').textContent = PRINT_OBRIGATORIO ? '' : '(opcional)';

    renderTabelaPontos();
    ligarControlesChat();
    document.querySelectorAll('.menu, #chatCanais, .busca-atalhos, .sugestoes').forEach(ligarFaixa);
    ligarTopoRecolhe();
    $('stCemRot').textContent = `PARTIDAS ${marcoTxt}`;
    $('thCem').textContent = marcoTxt;

    // abas de período e de ordem
    document.querySelectorAll('.aba[data-periodo]').forEach((a) => a.addEventListener('click', () => {
      periodo = a.dataset.periodo;
      document.querySelectorAll('.aba[data-periodo]').forEach((x) => x.setAttribute('aria-selected', String(x === a)));
      render();
    }));
    document.querySelectorAll('.aba[data-modo]').forEach((a) => {
      a.setAttribute('aria-selected', String(a.dataset.modo === modo));
      a.addEventListener('click', () => {
        modo = a.dataset.modo;
        document.querySelectorAll('.aba[data-modo]').forEach((x) => x.setAttribute('aria-selected', String(x === a)));
        render();
      });
    });
    $('fNome').addEventListener('input', () => {
      const k = chave($('fNome').value);
      const r = elenco.get(k);
      $('avisoNick').textContent = !k || !elencoOk ? '' : !r ? 'Jogador novo: entra no elenco do clã ao registrar.' : !r.ativo ? 'Era ex-membro: volta pro clã ao registrar.' : '';
      renderSugNick();
    });
    $('fNome').addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); $('fMassa').focus(); } });

    // jogadores do clã
    opcoesCargo($('fCargo'), CARGO_PADRAO);
    document.querySelectorAll('.aba[data-perjog]').forEach((a) => a.addEventListener('click', () => { perJog = a.dataset.perjog; renderJogadores(); }));
    document.querySelectorAll('.aba[data-vista]').forEach((a) => a.addEventListener('click', () => { vistaJog = a.dataset.vista; renderJogadores(); }));
    $('fBusca').addEventListener('input', () => { buscaJog = $('fBusca').value.trim(); renderJogadores(); });
    $('fFiltro').addEventListener('change', () => { filtroJog = $('fFiltro').value; renderJogadores(); });
    $('btnCsv').addEventListener('click', () => {
      if (!planilha || planilha.linhas.length < 2) { toast('A tabela está vazia.', true); return; }
      baixarCsv(planilha.nome, planilha.linhas);
    });
    $('btnCsvPartidas').addEventListener('click', baixarPartidas);
    $('formCadastro').addEventListener('submit', cadastrar);
    $('fNicks').addEventListener('input', previaCadastro);
    $('formJogador').addEventListener('submit', salvarJogador);
    $('btnCancelarJog').addEventListener('click', () => $('dlgJogador').close());
    $('btnApagarJog').addEventListener('click', apagarJogador);

    // torneios
    formLanc = $('formLanc');
    montarFormatos();
    $('btnNovoTorneio').addEventListener('click', () => abrirBuilder());
    $('formTorneio').addEventListener('submit', salvarBuilder);
    $('btnCancelarTn').addEventListener('click', () => $('dlgTorneio').close());
    $('btnFecharTn').addEventListener('click', () => $('dlgTorneio').close());
    $('btnApagarTn').addEventListener('click', apagarTn);
    document.querySelectorAll('#tnMetricas [data-metrica]').forEach((b) => b.addEventListener('click', () => { tnEstado.metrica = b.dataset.metrica; atualizarBuilder(); }));
    document.querySelectorAll('#tnQuem [data-todos]').forEach((b) => b.addEventListener('click', () => { tnEstado.todos = b.dataset.todos === '1'; atualizarBuilder(); }));
    ['tnUnidade', 'tnQtd', 'tnMeta', 'tnInicio', 'tnFim', 'tnAuto', 'tnSemente', 'tnBase'].forEach((id) => $(id).addEventListener(id === 'tnAuto' || id === 'tnSemente' || id === 'tnBase' ? 'change' : 'input', atualizarBuilder));
    $('tnRegras').addEventListener('change', renderResumoBuilder);
    $('tnMeta').addEventListener('blur', () => { const v = lerMetaBuilder(); if (v) $('tnMeta').value = fmt(v); });
    $('tnBuscaJog').addEventListener('input', renderEscolher);
    $('tnBuscaJog').addEventListener('keydown', (e) => { if (e.key === 'Enter') e.preventDefault(); });
    $('tnMarcarTodos').addEventListener('click', () => {
      const q = busca($('tnBuscaJog').value);
      jogadores.filter((r) => r.ativo && (!q || busca(r.nick).includes(q))).forEach((r) => tnEstado.sel.add(r.id));
      renderEscolher();
      renderResumoBuilder();
    });
    $('tnLimpar').addEventListener('click', () => { tnEstado.sel.clear(); renderEscolher(); renderResumoBuilder(); });
    formLanc.addEventListener('submit', lancar);
    fl('lancValor').addEventListener('input', mostrarLanc);
    fl('lancValor').addEventListener('blur', () => {
      const t = torneios.find((x) => x.id === formLanc.dataset.torneio);
      const r = t ? lerLanc(t) : {};
      if (r.valor != null && !r.erro) fl('lancValor').value = fmt(r.valor);
    });
    fl('lancPrint').addEventListener('change', (e) => {
      const f = e.target.files[0];
      if (!f) return;
      if (!/^image\/(png|jpeg|webp)$/.test(f.type)) { limparPrintLanc(); erroLanc('O print precisa ser PNG, JPG ou WEBP.'); return; }
      if (f.size > 15 * 1024 * 1024) { limparPrintLanc(); erroLanc('Imagem grande demais (máximo 15 MB).'); return; }
      arquivoLanc = f;
      fl('lancPrintNome').textContent = f.name;
      erroLanc(null);
    });
    $('formDuelo').addEventListener('submit', salvarDuelo);
    $('btnCancelarDuelo').addEventListener('click', () => $('dlgDuelo').close());
    $('btnLimparDuelo').addEventListener('click', limparDuelo);
    setInterval(tickContagens, 1000);

    $('fMassa').addEventListener('input', () => { confirmarPequena = null; mostrarMassa(); });
    // ao sair do campo, deixa o número no formato certo (52 mil -> 52.000)
    $('fMassa').addEventListener('blur', () => {
      const r = lerMassa($('fMassa').value);
      if (r.valor && r.valor <= MASSA_MAX) $('fMassa').value = fmt(r.valor);
    });
    $('btnMil').addEventListener('mousedown', (e) => e.preventDefault()); // não fecha o teclado do celular
    $('btnMil').addEventListener('click', multiplicarMil);

    // busca rápida e barra de baixo
    $('btnBusca').addEventListener('click', abrirBusca);
    $('bbBusca').addEventListener('click', abrirBusca);
    $('bbRegistrar').addEventListener('click', irRegistrar);
    $('btnFecharBusca').addEventListener('click', () => $('dlgBusca').close());
    $('fBuscaGlobal').addEventListener('input', renderBusca);
    $('fBuscaGlobal').addEventListener('keydown', (e) => { if (e.key === 'Enter' && achados[0]) { e.preventDefault(); irPerfil(achados[0].r.chave); } });
    $('buscaAtalhos').addEventListener('click', (e) => { if (e.target.closest('a')) $('dlgBusca').close(); });
    $('bbMais').addEventListener('click', abrirMais);
    // painel do dono: período, dicas dos gráficos e atualização sozinha a cada 30 s
    document.querySelectorAll('[data-pd]').forEach((b) => b.addEventListener('click', () => {
      pd.dias = Number(b.dataset.pd);
      pd.histTodo = false;
      desenharPainel();
      carregarPainel();
    }));
    ligarDicasPainel();
    setInterval(() => { if (painelVisivel()) carregarPainel(); }, 30000);
    $('btnTabelaToda').addEventListener('click', () => {
      tabelaToda = !tabelaToda;
      render();
      if (!tabelaToda) rolarJa($('tabela'));
    });
    $('btnPartidasMais').addEventListener('click', () => { partidasQtd += PARTIDAS_PASSO; renderPartidas(); });
    $('btnHallMais').addEventListener('click', () => { hallQtd += 12; renderHall(); });
    $('btnFecharMais').addEventListener('click', () => $('dlgMais').close());
    // botões ⓘ (data-info="temporada" | "patentes" | "pontos") abrem as regras
    document.addEventListener('click', (e) => {
      const bt = e.target.closest('[data-info]');
      if (!bt) return;
      e.preventDefault();
      if ($('dlgMais').open) $('dlgMais').close();
      abrirRegras(bt.dataset.info);
    });
    document.querySelectorAll('.aba[data-regra]').forEach((a) => a.addEventListener('click', () => abrirRegras(a.dataset.regra)));
    $('btnFecharRegras').addEventListener('click', () => $('dlgRegras').close());
    // editor do avatar
    document.querySelectorAll('.aba[data-avaba]').forEach((b) => b.addEventListener('click', () => { avd.aba = b.dataset.avaba; desenharAvatarEditor(); }));
    $('btnAvDado').addEventListener('click', () => {
      avd.av = avAleatorio();
      desenharAvatarEditor(true);
      const pv = $('avdPreview');
      pv.classList.remove('avd-pula');
      void pv.offsetWidth; // reinicia a animação
      pv.classList.add('avd-pula');
    });
    $('btnFecharAvatar').addEventListener('click', () => $('dlgAvatar').close());
    $('btnAvCancelar').addEventListener('click', () => $('dlgAvatar').close());
    $('btnAvSalvar').addEventListener('click', () => salvarAvatar(avd.av));
    $('btnAvTirar').addEventListener('click', () => salvarAvatar(null));
    $('btnFecharParede').addEventListener('click', () => $('dlgParede').close());
    $('btnParCancelar').addEventListener('click', () => $('dlgParede').close());
    $('btnParSalvar').addEventListener('click', () => salvarParede(pad.id));
    $('btnParTirar').addEventListener('click', () => salvarParede(null));
    ligarFaixa(document.querySelector('.avd-abas'));
    $('maisGrade').addEventListener('click', (e) => { if (e.target.closest('a')) $('dlgMais').close(); });
    document.addEventListener('keydown', (e) => {
      if (e.key !== '/' || e.ctrlKey || e.metaKey || e.altKey || document.querySelector('dialog[open]')) return;
      if (e.target.closest('input, textarea, select, [contenteditable]')) return;
      e.preventDefault();
      abrirBusca();
    });
    // já abre na página certa, antes mesmo dos dados chegarem
    mostrarPagina(false);

    // formulário
    $('registrar').addEventListener('submit', enviar);
    $('fPrint').addEventListener('change', (e) => escolherArquivo(e.target.files[0]));
    const zona = $('zonaPrint');
    zona.addEventListener('dragover', (e) => { e.preventDefault(); zona.classList.add('arrastando'); });
    zona.addEventListener('dragleave', () => zona.classList.remove('arrastando'));
    zona.addEventListener('drop', (e) => { e.preventDefault(); zona.classList.remove('arrastando'); escolherArquivo(e.dataTransfer.files[0]); });
    document.addEventListener('paste', (e) => {
      const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
      if (item) escolherArquivo(item.getAsFile());
    });

    // admin
    $('btnAdmin').addEventListener('click', () => { if (admin) sairAdmin(); else abrirEntrar('entrar'); });
    $('btnNaoApagar').addEventListener('click', () => $('dlgConfirma').close());
    $('btnSimApagar').addEventListener('click', confirmou);
    // o PIN antigo ficava salvo no aparelho; não serve mais pra nada
    try { localStorage.removeItem('ranking_pin'); sessionStorage.removeItem('ranking_pin'); } catch (e) {}

    // perfil: página com link próprio, botão voltar do celular/navegador funciona
    $('btnEu').addEventListener('click', () => {
      if (souAmigo) { confirmar('SAIR DA CONTA?', 'Pra jogar de novo é só entrar com o seu e-mail e senha.', 'Sair', sairConta); return; }
      const k = lerEu(); if (k) abrirPerfil(k); else abrirEntrar(contaSemJogador ? 'nick' : 'entrar');
    });
    // entrar / criar conta
    $('formEntrar').addEventListener('submit', enviarEntrar);
    $('btnCancelarEntrar').addEventListener('click', () => $('dlgEntrar').close());
    $('btnEsqueci').addEventListener('click', () => { trocarModoEntrar('esqueci'); focoEntrar(); });
    document.querySelectorAll('[data-entrar]').forEach((a) => a.addEventListener('click', () => { trocarModoEntrar(a.dataset.entrar); focoEntrar(); }));
    $('btnTirarLogin').addEventListener('click', tirarLogin);
    $('btnSouEuAdmin').addEventListener('click', souEuAdmin);
    addEventListener('popstate', () => mostrarRota());
    // links do menu (#ranking, #jogadores...): o site troca de página sozinho, de qualquer lugar
    document.addEventListener('click', (e) => {
      const a = e.target.closest('a[href^="#"]');
      if (!a || e.ctrlKey || e.metaKey || e.shiftKey || e.button) return;
      e.preventDefault();
      irPara(a.getAttribute('href'));
    });
    // fechou a taça aberta pelo link: tira o ?trofeu= pra não abrir de novo no F5 e mostra a sala de troféus
    $('dlgTrofeu').addEventListener('close', () => {
      if (new URLSearchParams(location.search).has('trofeu')) { history.replaceState({}, '', location.pathname + '#temporadas'); mostrarRota(false, false); }
    });
    // fechar janelas tocando fora delas
    ['dlgPrint', 'dlgBusca', 'dlgTrofeu', 'dlgMais', 'dlgRegras'].forEach((id) => $(id).addEventListener('click', (e) => {
      const r = e.currentTarget.getBoundingClientRect();
      const fora = e.clientX < r.left || e.clientX > r.right || e.clientY < r.top || e.clientY > r.bottom;
      if (e.target === e.currentTarget && fora) e.currentTarget.close();
    }));

    // portão: entrar, criar conta, escolher nick, conferir pedido, sair
    $('btnPortaoEntrar').addEventListener('click', () => abrirEntrar('entrar'));
    $('btnPortaoCriar').addEventListener('click', () => abrirEntrar('criar'));
    $('btnPortaoNick').addEventListener('click', () => abrirEntrar('nick'));
    $('btnPortaoConferir').addEventListener('click', conferirPedido);
    $('btnPortaoSair').addEventListener('click', sairConta);
    trancar('carregando');

    if (DEMO) {
      $('avisoDemo').hidden = false;
      partidas = dadosDemo();
      jogadores = elencoDemo();
      indexarElenco();
      const tn = torneiosDemo();
      torneios = tn.lista;
      lancamentos = tn.lanc;
      trancar('visitante');
      return;
    }

    if (!window.supabase) {
      $('portaoTxt').textContent = 'Não consegui carregar o sistema do ranking. Confere a internet e recarrega a página.';
      return;
    }
    sb = window.supabase.createClient(CFG.SUPABASE_URL, CFG.SUPABASE_KEY);
    // sessão expirou ou saiu em outra aba: fecha o site de novo
    // link de senha nova do e-mail: abre a janela pra criar a senha
    sb.auth.onAuthStateChange((evento) => {
      if (evento === 'SIGNED_OUT' && (admin || euId || meuPedido || contaSemJogador)) setTimeout(() => sairDaConta(), 0);
      if (evento === 'PASSWORD_RECOVERY') setTimeout(() => { if (!($('dlgEntrar').open && modoEntrar === 'nova')) abrirEntrar('nova'); }, 0);
    });
    lerConta()
      .catch((e) => { console.error(e); admin = null; euId = null; meuPedido = null; contaSemJogador = false; })
      .then(async () => {
        if (/access_token=/.test(location.hash)) history.replaceState(history.state, '', location.pathname + location.search);
        if (linkEmail && linkEmail.tipo === 'recovery') {
          if (podeVer()) await abrirSite(); else trancar();
          if (!$('dlgEntrar').open) abrirEntrar('nova');
        } else if (linkEmail && linkEmail.tipo === 'signup') {
          await depoisDeEntrar(true);
        } else if (podeVer()) {
          await abrirSite();
        } else {
          trancar();
          if (contaSemJogador) abrirEntrar('nick');
        }
      })
      .catch((e) => {
        console.error(e);
        trancar(podeVer() ? 'carregando' : undefined);
        $('portaoTxt').textContent = 'Não consegui ler o ranking agora. Confere a internet e recarrega a página.';
      });
  }

  // ---------- ponte pra sala de jogos (jogos.js) ----------
  // O jogos.js fica fora deste arquivo e usa só o que está aqui. O app.js avisa por eventos:
  // cobr:site (entrou e carregou), cobr:sair (saiu da conta), cobr:rota (trocou de página;
  // detail.pag = página aberta ou null no perfil/torneio) e cobr:online (mudou quem está online).
  function avisarJogos(tipo, detail = {}) {
    if (tipo === 'site' || tipo === 'sair') window.COBR.aberto = tipo === 'site'; // o jogos.js pode carregar depois do aviso
    document.dispatchEvent(new CustomEvent('cobr:' + tipo, { detail }));
  }
  window.COBR = {
    DEMO, aberto: false, $, el, trocar, svg, toast, chave, confirmar, irPara, abrirPerfil, abrirRegras, linhaRegra, tituloRegra,
    avatarChat, comParede, ehLider, ptsPat, ICONE_COROA, regras: REGRAS_EXTRA, TAG,
    avatarPodio: (nick) => avatarPodio({ nome: nick, chave: chave(nick) }),
    chipPatente: (nick) => chipPatente(ptsPat(chave(nick))),
    perfilDamas: null, // o jogos.js põe aqui a seção DAMAS do perfil (antes das medalhas)
    redesenharPerfil: () => { if (perfilAtual) renderPerfil(); },
    membroLinha: (x, o) => membroChat(x, o),
    euChat: () => euChat(), meuNick: () => meuNick(), // quem assiste uma partida (jogos.js)
    marcarJogando, damasFim,
    get sb() { return sb; },
    get euId() { return euId; },
    get ehAdmin() { return !!admin; }, // admin abre e cancela torneio de damas
    get pag() { return perfilAtual || torneioAtual ? null : pagAtual; },
    jogador: (id) => jogPorId.get(id) || null,
    online: () => chat.online,
  };

  iniciar();
})();
