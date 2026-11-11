/* Sala de jogos (começa pela damas): sala, convites e partida.
   Usa só a ponte window.COBR do app.js (sb, el, avatares, linha de membro...) e as regras do
   damas-regras.js. Nada grava direto nas tabelas: convites, respostas e desistência vão pelas
   funções jogos_* do banco; os lances vão pelo /api/jogos (servidor confere as regras).
   #jogos abre a sala; #jogos/<id> abre a partida. */
(() => {
  'use strict';
  const C = window.COBR;
  if (!C) return;
  const { $, el, trocar, toast } = C;
  const R = window.DamasRegras;

  // ---------- ícones ----------
  function ico(d, t = 18) {
    const w = document.createElement('span');
    w.innerHTML = `<svg aria-hidden="true" width="${t}" height="${t}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round">${d}</svg>`;
    return w.firstChild;
  }
  const IC_PECA = '<ellipse cx="12" cy="7.5" rx="8" ry="3.2"/><path d="M4 7.5v3.6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2V7.5"/><path d="M4 11.1v4.6c0 1.8 3.6 3.2 8 3.2s8-1.4 8-3.2v-4.6"/>';
  const IC_XADREZ = '<path d="M9 21h6M8 18h8l-1-6h-6zM12 3v4M10 5h4M9 12c-1-2 0-4 3-5 3 1 4 3 3 5"/>';
  const IC_VOLTAR = '<path d="M15 5l-7 7 7 7"/>';
  const IC_OLHO = '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>';
  const IC_SOM = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"/>';
  const IC_MUDO = '<path d="M4 9v6h4l5 4V5L8 9z"/><path d="M17 9.5l5 5M22 9.5l-5 5"/>';
  const COROA = `<svg viewBox="0 0 24 24" stroke-width="1.2" stroke-linejoin="round">${C.ICONE_COROA}</svg>`;

  // ---------- estado ----------
  const POR_PAGINA = 6;
  const CAMPOS = 'id,jogo,status,convidou,convidado,brancas,pretas,estado,versao,prazo,empate_proposto_por,vencedor,motivo,revanche_de,criado_em,inicio,fim';
  const J = {
    ligado: false, carregou: false, rt: null, conectou: false, tique: null,
    lista: new Map(),        // partidas vivas (convite e andamento): id -> linha
    ultimas: [], temMais: false,
    placar: null, rankTodo: false, // ranking de damas (jogos_placar)
    perfis: new Map(),       // perfil: player_id -> { em, lista: últimas partidas dele }
    tempoPed: null,          // relógio zerado: pedido de "tempo" já mandado ({ id, versao, em, n })
    aberta: null,            // a partida aberta em #jogos/<id> (pode já ter acabado)
    cfg: { tempo_jogada: 60, ao_acabar_tempo: 'perde_partida', maioria_obrigatoria: true, convite_expira: 60 },
    desvio: 0,               // relógio do servidor menos o do aparelho (ms)
    pop: null, popId: null,
    // partida aberta
    sel: null,               // peça tocada: { id, versao, pre: [casas já escolhidas] }
    ctx: null,               // jogadas possíveis do último desenho
    enviando: false, pendente: null, // jogada otimista esperando o servidor
    visto: null,             // a versão que está na tela (pra saber o que mudou)
    ult: null, anim: null,   // último lance destacado / animação a fazer
    assin: null,             // assinatura do último desenho (não redesenha à toa)
    ultNoticia: 0,           // última notícia da partida aberta (tempo real ou conferida)
    fim: null, fimAss: null, fimTipo: null, fimInfo: null, fimCarregando: null, fimFechado: new Set(),
    mudo: (() => { try { return !!localStorage.getItem('cobr-jogos-mudo'); } catch (e) { return false; } })(),
    // quem assiste e reações (canal partida:<id> de cada partida que está na tela)
    canais: new Map(),       // id -> { ch, ok, papel, marcado, desde }
    verQuem: null,           // faixa de quem assiste aberta? (null = o padrão: aberta pra quem assiste)
    semReacoes: (() => { try { return !!localStorage.getItem('cobr-jogos-sem-reacoes'); } catch (e) { return false; } })(),
    reagiuEm: 0, recebidas: new Map(),
    voos: null,              // camada por cima do tabuleiro (emojis voando e o aviso de dama)
    fogo: null,              // anel de fogo na peça que virou dama: { id, casa, ate }
  };
  const agora = () => Date.now() + J.desvio;
  const ms = (iso) => (iso ? new Date(iso).getTime() : 0);
  const eu = () => C.euId;
  const nick = (id) => { const r = id && C.jogador(id); return r ? r.nick : 'Alguém'; };
  const erroTxt = (e) => String((e && e.message) || 'Não deu certo. Tente de novo.');
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const naSala = () => C.pag === 'jogos' && !partidaDaUrl();
  function partidaDaUrl() {
    const m = /^#jogos\/([0-9a-f-]{36})$/i.exec(location.hash);
    return C.pag === 'jogos' && m ? m[1].toLowerCase() : null;
  }
  const vivo = (p) => p.status === 'andamento' || (p.status === 'convite' && ms(p.prazo) > agora());
  const minhaPartida = () => [...J.lista.values()].find((p) => p.status === 'andamento' && eu() && (p.brancas === eu() || p.pretas === eu())) || null;
  const convitesRecebidos = () => [...J.lista.values()].filter((p) => p.status === 'convite' && p.convidado === eu() && vivo(p)).sort((a, b) => ms(b.criado_em) - ms(a.criado_em));
  const convitesEnviados = () => [...J.lista.values()].filter((p) => p.status === 'convite' && p.convidou === eu() && vivo(p)).sort((a, b) => ms(b.criado_em) - ms(a.criado_em));
  const emAndamento = () => [...J.lista.values()].filter((p) => p.status === 'andamento').sort((a, b) => ms(a.inicio) - ms(b.inicio));
  const MOTIVO = { sem_pecas: 'sem peças', sem_jogadas: 'sem jogadas', desistencia: 'desistência', tempo: 'tempo esgotado', empate_acordo: 'empate combinado', empate_20: 'empate por 20 lances' };
  function haPouco(iso) {
    const s = Math.max(0, (agora() - ms(iso)) / 1000);
    if (s < 60) return 'agora';
    if (s < 3600) return `há ${Math.floor(s / 60)} min`;
    if (s < 86400 && new Date(iso).toDateString() === new Date().toDateString()) return `há ${Math.floor(s / 3600)} h`;
    if (new Date(iso).toDateString() === new Date(Date.now() - 86400000).toDateString()) return 'ontem';
    return new Date(iso).toLocaleDateString('pt-BR', { day: '2-digit', month: 'short' }).replace('.', '');
  }
  const lancesTxt = (n) => `${n} ${n === 1 ? 'lance' : 'lances'}`;

  // ---------- som e vibração (convite chegando) ----------
  let ac = null;
  function tocar(notas) {
    try {
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state === 'suspended') ac.resume().catch(() => {});
      let t = ac.currentTime + 0.02;
      for (const [f, d] of notas) {
        const o = ac.createOscillator(), g = ac.createGain();
        o.type = 'triangle';
        o.frequency.value = f;
        g.gain.setValueAtTime(0.0001, t);
        g.gain.exponentialRampToValueAtTime(0.2, t + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, t + d);
        o.connect(g).connect(ac.destination);
        o.start(t);
        o.stop(t + d + 0.05);
        t += d * 0.75;
      }
    } catch (e) {}
  }
  const somConvite = () => { tocar([[660, 0.16], [880, 0.16], [1320, 0.3]]); if (navigator.vibrate) navigator.vibrate([140, 70, 140]); };

  // ---------- banco ----------
  // o relógio do celular pode estar adiantado/atrasado: pega a hora do servidor uma vez
  async function acertarRelogio() {
    try {
      const t0 = Date.now();
      const r = await fetch('favicon.png', { method: 'HEAD', cache: 'no-store' });
      const t1 = Date.now();
      const d = Date.parse(r.headers.get('date') || '');
      if (!d) return;
      const desvio = d + 500 - (t0 + t1) / 2; // o cabeçalho vem sem os milissegundos
      J.desvio = Math.abs(desvio) < 1500 ? 0 : desvio;
    } catch (e) {}
  }
  async function carregar() {
    const sb = C.sb;
    const [vivas, ult, cfg, placar] = await Promise.all([
      sb.from('jogos_partidas').select(CAMPOS).in('status', ['convite', 'andamento']),
      sb.from('jogos_partidas').select(CAMPOS).eq('jogo', 'damas').eq('status', 'fim').order('fim', { ascending: false }).limit(POR_PAGINA),
      sb.rpc('jogos_cfg'),
      sb.rpc('jogos_placar', { p_jogo: 'damas' }),
    ]);
    if (vivas.error) throw vivas.error;
    J.lista = new Map(vivas.data.map((p) => [p.id, p]));
    // jogada minha ainda a caminho do servidor: não volta o tabuleiro pra trás
    const pend = J.pendente, doBanco = pend && J.lista.get(pend.id);
    if (doBanco && doBanco.status === 'andamento' && doBanco.versao < pend.versao) J.lista.set(pend.id, pend);
    if (!ult.error) { J.ultimas = ult.data; J.temMais = ult.data.length === POR_PAGINA; }
    if (!cfg.error && cfg.data) J.cfg = { ...J.cfg, ...cfg.data };
    if (!placar.error) J.placar = (placar.data || []).slice().sort(ordemPlacar);
    if (J.aberta && J.lista.has(J.aberta.id)) J.aberta = J.lista.get(J.aberta.id);
    J.carregou = true;
    preencherPerfilAberto();
  }
  let recarregando = null;
  function recarregar() {
    if (!J.ligado) return Promise.resolve();
    if (!recarregando) {
      recarregando = carregar()
        .then(async () => {
          // a partida aberta pode ter acabado enquanto o aparelho dormia
          const id = partidaDaUrl();
          if (id && !J.lista.has(id)) { const x = await buscarPartida(id); if (x && partidaDaUrl() === id) J.aberta = x; }
          J.ultNoticia = Date.now();
          desenhar();
        })
        .catch((e) => console.warn('jogos:', e.message))
        .finally(() => { recarregando = null; });
    }
    return recarregando;
  }
  async function buscarPartida(id) {
    const r = await C.sb.from('jogos_partidas').select(CAMPOS).eq('id', id).maybeSingle();
    if (r.error) throw r.error;
    return r.data || null;
  }
  async function maisUltimas(bt) {
    bt.disabled = true;
    const de = J.ultimas.length;
    const r = await C.sb.from('jogos_partidas').select(CAMPOS).eq('jogo', 'damas').eq('status', 'fim').order('fim', { ascending: false }).range(de, de + POR_PAGINA - 1);
    if (r.error) { bt.disabled = false; toast('Não consegui carregar mais partidas.', true); return; }
    const ja = new Set(J.ultimas.map((p) => p.id));
    J.ultimas.push(...r.data.filter((p) => !ja.has(p.id)));
    J.temMais = r.data.length === POR_PAGINA;
    desenhar();
  }

  // ---------- ao vivo ----------
  function ligarAoVivo() {
    J.rt = C.sb.channel('jogos-ao-vivo')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'jogos_partidas' }, mudou)
      .subscribe((st) => {
        if (st !== 'SUBSCRIBED') return;
        if (J.conectou) recarregar(); // voltou depois de cair: pega o que mudou nesse meio tempo
        J.conectou = true;
      });
  }
  function mudou(ev) {
    if (ev.eventType === 'DELETE') { J.lista.delete(ev.old.id); desenhar(); return; }
    const n = ev.new;
    const antes = linhaDe(n.id);
    if (!guardar(n)) return;
    if (n.id === partidaDaUrl()) J.ultNoticia = Date.now();
    if (n.status === 'fim' && !J.ultimas.some((p) => p.id === n.id)) J.ultimas.unshift(n);
    if (n.status === 'fim' && (!antes || antes.status !== 'fim')) atualizarPlacar();
    const meu = eu();
    if (meu) {
      if (ev.eventType === 'INSERT' && n.status === 'convite' && n.convidado === meu) somConvite();
      if (antes && antes.status === 'convite' && n.convidou === meu) {
        if (n.status === 'andamento') { toast(`${nick(n.convidado)} aceitou! Bora jogar.`); C.irPara('#jogos/' + n.id); }
        else if (n.status === 'recusado') toast(`${nick(n.convidado)} recusou o convite.`);
        else if (n.status === 'expirado') toast(`${nick(n.convidado)} não respondeu o convite.`);
      }
      if (antes && antes.status === 'andamento' && n.status === 'fim' && (n.brancas === meu || n.pretas === meu) && partidaDaUrl() !== n.id) {
        toast(n.vencedor === meu ? 'Você venceu a partida de damas!' : n.vencedor ? `Partida encerrada: ${nick(n.vencedor)} venceu.` : 'Partida encerrada: empate.');
      }
      // proposta de empate na minha partida
      if (antes && antes.status === 'andamento' && n.status === 'andamento' && (n.brancas === meu || n.pretas === meu)) {
        const outro = n.brancas === meu ? n.pretas : n.brancas;
        if (n.empate_proposto_por === outro && antes.empate_proposto_por !== outro) {
          toast(`${nick(outro)} propôs empate.`);
          som('vez');
          if (navigator.vibrate) navigator.vibrate([80, 60, 80]);
        } else if (antes.empate_proposto_por === meu && !n.empate_proposto_por && n.versao === antes.versao) {
          toast(`${nick(outro)} recusou o empate.`);
        }
      }
    }
    desenhar();
  }

  // ---------- ações ----------
  async function rpc(nome, args) {
    const r = await C.sb.rpc(nome, args);
    if (r.error) throw r.error;
    return r.data;
  }
  function travar(bt, sim) { (bt.closest('.jg-convite-btns, .ch-membro, .jg-acoes') || bt.parentElement).querySelectorAll('button').forEach((b) => { b.disabled = sim; }); }
  async function desafiar(r, bt) {
    if (!eu()) { toast('Só jogador do clã com login pode jogar.', true); return; }
    travar(bt, true);
    try {
      const id = await rpc('jogos_convidar', { p_jogo: 'damas', p_convidado: r.id });
      toast(`Convite enviado pro ${r.nick}.`);
      const p = await buscarPartida(id);
      if (p && p.status === 'convite') J.lista.set(p.id, p);
      desenhar();
    } catch (e) { toast(erroTxt(e), true); travar(bt, false); }
  }
  async function responder(p, aceitar, bt) {
    travar(bt, true);
    try {
      await rpc('jogos_responder', { p_partida: p.id, p_aceitar: aceitar });
      if (aceitar) {
        const nova = await buscarPartida(p.id);
        if (nova) J.lista.set(nova.id, nova);
        C.irPara('#jogos/' + p.id);
      } else { J.lista.delete(p.id); desenhar(); }
    } catch (e) { toast(erroTxt(e), true); recarregar(); }
  }
  async function cancelar(p, bt) {
    travar(bt, true);
    try { await rpc('jogos_cancelar', { p_partida: p.id }); J.lista.delete(p.id); desenhar(); }
    catch (e) { toast(erroTxt(e), true); recarregar(); }
  }
  // ---------- peças da tela ----------
  const CIRC = 2 * Math.PI * 22;
  // cartão de convite (na sala e no aviso de cima): anel com os segundos que faltam
  function cartaoConvite(p, pop = false) {
    const recebi = p.convidado === eu();
    const outro = recebi ? p.convidou : p.convidado;
    const total = Math.max(1000, ms(p.prazo) - ms(p.criado_em));
    const anel = el('span', { class: 'jg-conta' });
    anel.innerHTML = `<svg viewBox="0 0 50 50" aria-hidden="true"><circle cx="25" cy="25" r="22" fill="none" stroke="#3A2312" stroke-width="4"/><circle cx="25" cy="25" r="22" fill="none" stroke="#FF7A1A" stroke-width="4" stroke-linecap="round" stroke-dasharray="${CIRC.toFixed(1)} 200"/></svg>`;
    const arco = anel.querySelectorAll('circle')[1];
    const num = document.createTextNode('');
    anel.append(num);
    const leg = el('small');
    const caixa = el('div', { class: pop ? 'jg-pop jg-convite' : 'jg-card jg-convite', role: pop ? 'alertdialog' : null, 'aria-label': pop ? `Convite de ${nick(outro)}` : null },
      el('div', { class: 'jg-convite-top' }, C.avatarChat(nick(outro), 'av-m'),
        el('div', { class: 'jg-convite-txt' },
          recebi ? [el('b', { text: nick(outro) }), ' te chamou pra jogar ', el('b', { text: 'damas' }), pop ? ' 🎮' : null]
            : ['Você chamou ', el('b', { text: nick(outro) }), ' pra jogar ', el('b', { text: 'damas' })],
          leg),
        anel),
      el('div', { class: 'jg-convite-btns' + (recebi ? '' : ' um') },
        recebi ? [
          el('button', { type: 'button', class: 'btn btn-pri', text: 'Aceitar', onclick: (e) => responder(p, true, e.currentTarget) }),
          el('button', { type: 'button', class: 'btn btn-sec', text: 'Recusar', onclick: (e) => responder(p, false, e.currentTarget) }),
        ] : el('button', { type: 'button', class: 'btn btn-sec', text: 'Cancelar convite', onclick: (e) => cancelar(p, e.currentTarget) })));
    caixa.classList.add('jg-tiq');
    caixa._tique = () => {
      const resta = Math.max(0, ms(p.prazo) - agora());
      const s = Math.ceil(resta / 1000);
      arco.setAttribute('stroke-dasharray', `${(CIRC * Math.min(1, resta / total)).toFixed(1)} 200`);
      num.textContent = String(s);
      const ha = Math.max(0, Math.floor((agora() - ms(p.criado_em)) / 1000));
      leg.textContent = pop ? `RESPONDA EM ${mmss(s)}`
        : !recebi ? `ESPERANDO RESPOSTA · ${mmss(s)}`
        : ha < 1 ? 'CONVITE · AGORA' : ha < 60 ? `CONVITE · HÁ ${ha} ${ha === 1 ? 'SEGUNDO' : 'SEGUNDOS'}` : 'CONVITE · HÁ 1 MINUTO';
      return resta > 0;
    };
    caixa._tique();
    return caixa;
  }
  const rotulo = (...filhos) => el('div', { class: 'jg-rot' }, ...filhos);
  const rotVivo = () => el('span', { class: 'vivo', text: 'AO VIVO' });

  // ---------- sala (imagem 01) ----------
  function cabecalho() {
    return [
      el('div', { class: 'jg-cab' },
        el('h2', null, 'SALA DE ', el('span', { class: 'laranja', text: 'JOGOS' })),
        el('button', { type: 'button', class: 'info-btn', 'data-info': 'damas', 'aria-label': 'Como funciona a damas', text: 'i' })),
      el('div', { class: 'jg-jogos' },
        el('span', { class: 'jg-jogo ativo' }, ico(IC_PECA), 'Damas'),
        el('span', { class: 'jg-jogo', 'aria-disabled': 'true' }, ico(IC_XADREZ), 'Xadrez ', el('small', { text: 'EM BREVE' }))),
    ];
  }
  function desenharSala() {
    const sec = $('jogos');
    if (!J.carregou) { trocar(sec, cabecalho(), el('p', { class: 'jg-vazio', text: 'Carregando…' })); return; }
    const minha = minhaPartida();
    const rec = convitesRecebidos(), env = convitesEnviados();
    const vivas = emAndamento();
    trocar(sec, cabecalho(),
      minha ? cartaoMinha(minha) : null,
      rec.map((p) => cartaoConvite(p)),
      env.map((p) => cartaoConvite(p)),
      listaOnline(minha, rec, env),
      vivas.length ? [rotulo(el('span', { text: 'ACONTECENDO AGORA' }), rotVivo()), el('div', { class: 'jg-card' }, vivas.map(cartaoVivo))] : null,
      rankingDamas(),
      ultimasPartidas());
  }
  function cartaoMinha(p) {
    const outro = p.brancas === eu() ? p.pretas : p.brancas;
    const vez = (p.estado && p.estado.vez) === (p.brancas === eu() ? 'b' : 'p');
    return el('div', { class: 'jg-card jg-convite jg-minha' },
      el('div', { class: 'jg-convite-top' }, C.avatarChat(nick(outro), 'av-m'),
        el('div', { class: 'jg-convite-txt' }, 'Sua partida com ', el('b', { text: nick(outro) }), ' está rolando',
          el('small', { text: `${vez ? 'SUA VEZ' : `VEZ DE ${nick(outro).toUpperCase()}`} · LANCE ${p.versao}` }))),
      el('div', { class: 'jg-convite-btns um' },
        el('button', { type: 'button', class: 'btn btn-pri', text: 'Voltar pra partida', onclick: () => C.irPara('#jogos/' + p.id) })));
  }
  // quem está online (a presença do chat), com o que dá pra fazer com cada um
  function listaOnline(minha, rec, env) {
    const meu = eu(), vistos = new Set(), gente = [];
    for (const o of C.online().values()) {
      if (!o.player_id || o.player_id === meu || vistos.has(o.player_id)) continue;
      const r = C.jogador(o.player_id);
      if (!r) continue;
      vistos.add(r.id);
      const jogo = emAndamento().find((p) => p.brancas === r.id || p.pretas === r.id);
      const chamou = rec.find((p) => p.convidou === r.id), chamei = env.find((p) => p.convidado === r.id);
      const k = C.chave(r.nick);
      gente.push({ r, k, jogo, chamou, chamei, ordem: C.ehLider(k) ? 0 : chamou || chamei ? 1 : jogo ? 3 : 2 });
    }
    gente.sort((a, b) => a.ordem - b.ordem || C.ptsPat(b.k) - C.ptsPat(a.k) || a.r.nick.localeCompare(b.r.nick, 'pt-BR'));
    const linhas = gente.map(({ r, k, jogo, chamou, chamei }) => {
      let sub, extra;
      if (jogo) {
        sub = `jogando damas com ${nick(jogo.brancas === r.id ? jogo.pretas : jogo.brancas)}`;
        extra = el('span', { class: 'jg-st jogando', text: 'JOGANDO' });
      } else if (chamou) {
        sub = 'te convidou · livre';
        extra = el('span', { class: 'jg-st enviado', text: 'CONVITE' });
      } else if (chamei) {
        sub = 'você convidou · livre';
        extra = el('span', { class: 'jg-st enviado', text: 'CONVITE' });
      } else {
        sub = 'livre';
        extra = el('button', { type: 'button', class: 'btn btn-pri jg-acao', text: 'Desafiar', disabled: !!minha, onclick: (e) => desafiar(r, e.currentTarget) });
      }
      return C.membroLinha({ nick: r.nick, k, st: jogo ? 'jogo' : 'on' }, { sub, extra });
    });
    return [
      rotulo(`ONLINE AGORA — ${linhas.length}`),
      el('div', { class: 'jg-card jg-lista' }, linhas.length ? linhas : el('p', { class: 'jg-vazio', text: 'Ninguém do clã online agora.' })),
    ];
  }
  function cartaoVivo(p) {
    const minha = eu() && (p.brancas === eu() || p.pretas === eu());
    const lado = (id) => el('div', { class: 'jg-vivo-lado' }, C.avatarChat(nick(id), 'av-m'), nick(id));
    return el('div', { class: 'jg-vivo' }, lado(p.brancas),
      el('div', { class: 'jg-vivo-meio' },
        el('div', { class: 'jg-vivo-x', text: '×' }),
        el('div', { class: 'jg-vivo-info', 'data-olhos': p.id, text: infoVivo(p) }),
        el('button', { type: 'button', class: 'btn btn-pri', onclick: () => C.irPara('#jogos/' + p.id) }, minha ? 'Voltar' : [ico(IC_OLHO, 16), 'Assistir'])),
      lado(p.pretas));
  }
  function infoVivo(p) {
    const n = quemAssiste(p.id).length;
    return `lance ${p.versao}${n ? ` · 👀 ${n} assistindo` : ''}`;
  }
  function linhaUltima(p, quem = null) {
    const emp = !p.vencedor;
    const perdeu = emp ? null : p.vencedor === p.brancas ? p.pretas : p.brancas;
    const txt = quem
      ? (emp ? ['empatou com ', el('b', { text: nick(quem === p.brancas ? p.pretas : p.brancas) })]
        : p.vencedor === quem ? ['venceu ', el('b', { text: nick(perdeu) })] : ['perdeu pra ', el('b', { text: nick(p.vencedor) })])
      : (emp ? [el('b', { text: nick(p.brancas) }), ' e ', el('b', { text: nick(p.pretas) }), ' empataram']
        : [el('b', { class: 'ganhou', text: nick(p.vencedor) }), ' venceu ', el('b', { text: nick(perdeu) })]);
    return el('li', null, C.avatarChat(nick(quem ? (quem === p.brancas ? p.pretas : p.brancas) : emp ? p.brancas : p.vencedor), 'av-p'),
      el('div', { class: 'jg-ult-txt' }, txt, el('small', { text: `${MOTIVO[p.motivo] || 'fim'} · ${lancesTxt(p.versao)} · ${haPouco(p.fim)}` })),
      emp ? el('span', { class: 'jg-ult-res emp', text: 'EMPATE' })
        : quem && p.vencedor !== quem ? el('span', { class: 'jg-ult-res perdeu', text: 'DERROTA' })
        : el('span', { class: 'jg-ult-res', text: 'VITÓRIA' }));
  }
  function ultimasPartidas() {
    if (!J.ultimas.length) return null;
    return [
      rotulo('ÚLTIMAS PARTIDAS'),
      el('ul', { class: 'jg-ult' }, J.ultimas.map((p) => linhaUltima(p))),
      J.temMais ? el('button', { type: 'button', class: 'btn btn-sec jg-mais', text: 'Ver mais partidas', onclick: (e) => maisUltimas(e.currentTarget) }) : null,
    ];
  }

  // ---------- ranking de damas (imagem 05): o pódio e a tabela do ranking de massa ----------
  const TABELA_TOPO = 10;
  const pct = (x) => `${x.aproveitamento != null ? x.aproveitamento : Math.round((100 * x.vitorias) / Math.max(1, x.partidas))}%`;
  function fase(x) {
    const s = x.maior_sequencia | 0;
    if (s >= 2) return `${s} vitórias seguidas${s >= 3 ? ' 🔥' : ''}`;
    return `última: ${x.ultimo === 'V' ? 'vitória' : x.ultimo === 'E' ? 'empate' : 'derrota'}`;
  }
  const verPerfil = (nk) => ({ type: 'button', onclick: () => C.abrirPerfil(C.chave(nk)), 'aria-label': `Ver perfil de [${C.TAG}] ${nk}` });
  function podioDamas(pl) {
    const topo = Math.max(1, pl[0].vitorias);
    return el('div', { class: 'podio', id: 'podioDamas' }, [1, 0, 2].filter((i) => pl[i]).map((i) => {
      const x = pl[i];
      return C.comParede(el('article', { class: `lugar l${i + 1}` },
        i === 0 ? C.svg(C.ICONE_COROA, 40, 'class="coroa"') : null,
        C.avatarPodio(x.nick),
        el('div', { class: 'lugar-id' },
          el('div', { class: 'lugar-pos', text: `${i + 1}º LUGAR` }),
          el('button', { ...verPerfil(x.nick), class: 'lugar-nome' }, el('span', { class: 'lugar-tag', text: `[${C.TAG}] ` }), x.nick),
          el('div', { class: 'lugar-pat' }, C.chipPatente(x.nick))),
        el('div', { class: 'lugar-massa', text: String(x.vitorias) }),
        el('div', { class: 'lugar-data', text: `${x.vitorias === 1 ? 'vitória' : 'vitórias'} · ${pct(x)} de aproveit.` }),
        el('div', { class: 'cem-selo', text: `${x.partidas} ${x.partidas === 1 ? 'partida' : 'partidas'}` }),
        el('div', { class: 'barra', 'aria-hidden': 'true' }, el('span', { style: `width:${Math.max(4, Math.round((x.vitorias / topo) * 100))}%` }))), C.chave(x.nick));
    }));
  }
  function tabelaDamas(pl) {
    const meu = eu();
    const iEu = pl.findIndex((x) => x.player_id === meu);
    const cortar = !J.rankTodo && pl.length > TABELA_TOPO + 2;
    const est = (rot, val, cls) => el('span', { class: cls || null }, el('small', { text: rot }), el('b', { text: val }));
    const linhas = [];
    pl.forEach((x, i) => {
      if (cortar && i >= TABELA_TOPO && i !== iEu) return;
      if (cortar && i === iEu && i > TABELA_TOPO) linhas.push(el('tr', { class: 'pulo', 'aria-hidden': 'true' }, el('td', { colspan: '6', text: '⋯' })));
      linhas.push(C.comParede(el('tr', { class: [i === 0 ? 'topo1' : '', x.player_id === meu ? 'eu-linha' : ''].join(' ').trim() || null },
        el('td', { class: `pos p${i + 1}`, text: `#${i + 1}` }),
        el('td', { class: 'nome-cel' },
          el('div', { class: 'nome-linha' }, C.avatarChat(x.nick, 'av-p'),
            el('button', { ...verPerfil(x.nick), class: 'link-nome forte' }, el('span', { class: 'tag-nick', text: `[${C.TAG}] ` }), x.nick),
            el('span', { class: 'nome-chips' }, C.chipPatente(x.nick))),
          el('div', { class: 'nome-melhor' }, 'melhor fase: ', el('b', { text: fase(x) }))),
        el('td', { class: 'dir c-pts num', 'data-un': 'VIT', text: String(x.vitorias) }),
        el('td', { class: 'dir c-cem' }, el('span', { class: 'sec', text: String(x.derrotas) })),
        el('td', { class: 'dir c-rec sec', 'data-un': '', text: String(x.empates) }),
        el('td', { class: 'dir sec c-qtd', text: pct(x) }),
        el('td', { class: 'mob-est', 'aria-hidden': 'true' },
          est('PARTIDAS', String(x.partidas)),
          est('V · D · E', `${x.vitorias} · ${x.derrotas} · ${x.empates}`),
          est('APROVEIT.', pct(x), 'tem-cem'))), C.chave(x.nick), 'linha-parede'));
    });
    return el('div', { class: 'painel', id: 'tabelaDamas' },
      el('div', { class: 'painel-topo' }, el('h2', { text: 'TABELA DE DAMAS' }), el('span', { class: 'ao-vivo' }, el('span', { class: 'ponto' }), 'ao vivo')),
      el('div', { class: 'tabela-box' },
        el('table', null,
          el('thead', null, el('tr', null, el('th', { text: 'POS' }), el('th', { text: 'JOGADOR' }), el('th', { class: 'dir ativo', text: 'VITÓRIAS' }), el('th', { class: 'dir', text: 'DERROTAS' }), el('th', { class: 'dir', text: 'EMPATES' }), el('th', { class: 'dir', text: '%' }))),
          el('tbody', null, linhas))),
      pl.length > TABELA_TOPO + 2 ? el('div', { class: 'ver-mais-box' },
        el('button', { type: 'button', class: 'btn btn-sec ver-mais', text: J.rankTodo ? 'Mostrar só o top 10' : `Ver todos os ${pl.length} jogadores`, onclick: () => { J.rankTodo = !J.rankTodo; desenhar(); } })) : null);
  }
  function rankingDamas() {
    const pl = J.placar;
    if (!pl) return null;
    return el('div', { id: 'jgRanking' },
      rotulo(el('span', { text: 'RANKING DE DAMAS' }), el('button', { type: 'button', class: 'info-btn', 'data-info': 'damas', 'aria-label': 'Como funciona o ranking de damas', text: 'i' })),
      pl.length ? [podioDamas(pl), tabelaDamas(pl)] : el('div', { class: 'jg-card' }, el('p', { class: 'jg-vazio', text: 'Ninguém jogou damas ainda. Desafie alguém!' })));
  }
  // uma partida acabou: placar, ranking e perfis mudam
  let esperaPlacar;
  function atualizarPlacar() {
    clearTimeout(esperaPlacar);
    esperaPlacar = setTimeout(async () => {
      if (!J.ligado) return;
      try {
        const r = await C.sb.rpc('jogos_placar', { p_jogo: 'damas' });
        if (r.error) throw r.error;
        J.placar = (r.data || []).slice().sort(ordemPlacar);
      } catch (e) { return; }
      J.perfis.clear();
      preencherPerfilAberto();
      if (naSala()) desenharSala();
    }, 800);
  }

  // ---------- perfil (imagem 07): seção DAMAS antes das medalhas ----------
  // o app.js chama na hora de montar o perfil; os dados chegam depois e a seção se preenche
  C.perfilDamas = (id) => {
    if (C.DEMO || !id) return null;
    const sec = el('section', { class: 'pp-sec', id: 'ppDamas', 'aria-labelledby': 'ppDamasT', 'data-jogador': id });
    const c = J.perfis.get(id);
    if (c && J.placar) preencherPerfil(sec, id, c.lista); else sec.hidden = true;
    if (J.ligado && (!c || Date.now() - c.em > 30000)) carregarPerfil(id);
    return sec;
  };
  const carregandoPerfil = new Set();
  async function carregarPerfil(id) {
    if (carregandoPerfil.has(id)) return;
    carregandoPerfil.add(id);
    try {
      const [r, pl] = await Promise.all([
        C.sb.from('jogos_partidas').select(CAMPOS).eq('jogo', 'damas').eq('status', 'fim').or(`brancas.eq.${id},pretas.eq.${id}`).order('fim', { ascending: false }).limit(5),
        J.placar ? null : C.sb.rpc('jogos_placar', { p_jogo: 'damas' }),
      ]);
      if (r.error) throw r.error;
      if (pl && !pl.error) J.placar = (pl.data || []).slice().sort(ordemPlacar);
      J.perfis.set(id, { em: Date.now(), lista: r.data || [] });
    } catch (e) { console.warn('jogos:', e.message); }
    carregandoPerfil.delete(id);
    const sec = document.getElementById('ppDamas');
    if (sec && sec.dataset.jogador === id && J.perfis.has(id) && J.placar) preencherPerfil(sec, id, J.perfis.get(id).lista);
  }
  function preencherPerfilAberto() {
    const sec = document.getElementById('ppDamas');
    if (!sec) return;
    const id = sec.dataset.jogador, c = J.perfis.get(id);
    if (c && J.placar) preencherPerfil(sec, id, c.lista);
    else if (J.ligado) carregarPerfil(id);
  }
  function preencherPerfil(sec, id, lista) {
    const pl = J.placar || [];
    const i = pl.findIndex((x) => x.player_id === id);
    if (i < 0) { sec.hidden = true; sec.replaceChildren(); return; }
    const x = pl[i], tot = Math.max(1, x.partidas);
    const larg = (n) => `width:${((100 * n) / tot).toFixed(1)}%`;
    const stat = (rot, n, cls) => el('div', { class: 'pstat' }, el('span', { class: 'pstat-rot', text: rot }), el('span', { class: 'pstat-num' + (cls ? ' ' + cls : ''), text: n }));
    const res = (p) => (!p.vencedor ? 'e' : p.vencedor === id ? 'v' : 'd');
    sec.hidden = false;
    trocar(sec,
      el('h2', { class: 'perfil-h3', id: 'ppDamasT' }, 'DAMAS ', el('span', { class: 'sec', text: `${x.partidas} ${x.partidas === 1 ? 'partida' : 'partidas'}` })),
      el('div', { class: 'jg-pf-pos' }, el('b', { text: `#${i + 1}` }), el('span', null, 'no ranking de damas do clã', el('br'), `${pct(x)} de aproveitamento`)),
      el('div', { class: 'perfil-stats jg-pf-grade' }, stat('VITÓRIAS', String(x.vitorias), 'laranja'), stat('DERROTAS', String(x.derrotas)), stat('EMPATES', String(x.empates)), stat('%', pct(x))),
      el('div', { class: 'jg-pf-barra', role: 'img', 'aria-label': `${x.vitorias} vitórias, ${x.empates} empates, ${x.derrotas} derrotas` },
        el('i', { style: larg(x.vitorias) }), el('i', { style: larg(x.empates) }), el('i', { style: larg(x.derrotas) })),
      el('div', { class: 'jg-pf-leg' }, el('span', { text: 'vitórias' }), el('span', { text: 'empates' }), el('span', { text: 'derrotas' })),
      lista.length ? [
        el('h2', { class: 'perfil-h3', text: lista.length > 1 ? `ÚLTIMAS ${lista.length}` : 'ÚLTIMA' }),
        el('div', { class: 'jg-forma', role: 'img', 'aria-label': 'Da mais recente pra mais antiga: ' + lista.map((p) => ({ v: 'vitória', d: 'derrota', e: 'empate' })[res(p)]).join(', ') },
          lista.map((p) => el('i', { class: res(p), text: res(p).toUpperCase() }))),
        el('ul', { class: 'jg-ult', style: 'margin-top:12px' }, lista.slice(0, 3).map((p) => linhaUltima(p, id))),
      ] : null);
  }

  // ---------- relógio zerado: avisa o servidor (api/jogos {acao:"tempo"}) ----------
  // o banco confere a hora (2 s de folga); se ainda não venceu, tenta de novo daqui a pouco.
  // Ninguém com o site aberto? O pg_cron fecha a partida em até 1 minuto.
  function conferirRelogio() {
    if (!J.ligado || document.hidden) return;
    const id = partidaDaUrl();
    const p = (id && linhaDe(id)) || minhaPartida();
    if (!p || p.status !== 'andamento' || !p.prazo || J.enviando) return;
    if (agora() < ms(p.prazo) + 2500) return;
    const t = J.tempoPed;
    const mesmo = t && t.id === p.id && t.versao === p.versao;
    if (mesmo && (t.indo || t.n >= 8 || Date.now() - t.em < 4000)) return;
    pedirTempo(p, mesmo ? t.n + 1 : 1);
  }
  async function pedirTempo(p, n) {
    const t = { id: p.id, versao: p.versao, em: Date.now(), n, indo: true };
    J.tempoPed = t;
    try {
      const r = await api({ acao: 'tempo', partida: p.id });
      const cur = linhaDe(p.id);
      if (r.status === 'fim') {
        const x = await buscarPartida(p.id).catch(() => null);
        if (x) mudou({ eventType: 'UPDATE', new: x });
      } else if (cur && (r.versao | 0) > (cur.versao | 0)) {
        mudou({ eventType: 'UPDATE', new: { ...cur, status: r.status, estado: r.estado, versao: r.versao, prazo: r.prazo, empate_proposto_por: null } });
      } else if (cur && r.prazo && r.prazo !== cur.prazo) {
        conferir(p.id);
      }
    } catch (e) { /* tenta de novo no próximo segundo (até 8 vezes) */ }
    t.indo = false;
    t.em = Date.now();
  }

  // ---------- partida ao vivo (imagens 02 e 04) ----------
  const opcoes = () => ({ maioria: J.cfg.maioria_obrigatoria !== false });
  const corDe = (x) => (x && x !== '.' ? x.toLowerCase() : null);
  const ultima = (c) => c[c.length - 1];
  const comeca = (c, pre) => pre.every((x, k) => c[k] === x);
  function linhaDe(id) { return J.lista.get(id) || (J.aberta && J.aberta.id === id ? J.aberta : null); }
  function forcar(n) {
    if (n.status === 'convite' || n.status === 'andamento') J.lista.set(n.id, n); else J.lista.delete(n.id);
    if (J.aberta && J.aberta.id === n.id) J.aberta = n;
  }
  // guarda a versão nova de uma partida; notícia velha (ex.: chegou depois da jogada otimista) fica de fora
  function guardar(n) {
    const atual = linhaDe(n.id);
    if (atual && atual.status === 'fim' && n.status !== 'fim') return false;
    if (atual && atual.status === 'andamento' && n.status === 'andamento' && (n.versao | 0) < (atual.versao | 0)) return false;
    forcar(n);
    return true;
  }

  // sons (o botão de som da partida liga/desliga; fica salvo no aparelho)
  const SONS = {
    mover: [[330, 0.07]],
    capturar: [[520, 0.08], [390, 0.13]],
    dama: [[523, 0.09], [659, 0.09], [784, 0.09], [1047, 0.26]],
    vez: [[880, 0.09], [1175, 0.17]],
    vitoria: [[523, 0.12], [659, 0.12], [784, 0.12], [1047, 0.45]],
    derrota: [[392, 0.2], [330, 0.2], [262, 0.45]],
  };
  function som(k) { if (!J.mudo) tocar(SONS[k]); }
  function trocarMudo() {
    J.mudo = !J.mudo;
    try { localStorage.setItem('cobr-jogos-mudo', J.mudo ? '1' : ''); } catch (e) {}
    J.assin = null;
    desenhar();
  }

  // o servidor (api/jogos.js) confere e grava a jogada
  async function api(corpo) {
    let token = '';
    try { const s = await C.sb.auth.getSession(); token = (s.data && s.data.session && s.data.session.access_token) || ''; } catch (e) {}
    let r;
    try {
      r = await fetch('/api/jogos', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token }, body: JSON.stringify(corpo) });
    } catch (e) { throw new Error('Sem internet: a jogada não foi.'); }
    const j = await r.json().catch(() => ({}));
    if (!r.ok) { const e = new Error(j.erro || 'Não deu certo. Tente de novo.'); e.status = r.status; throw e; }
    return j;
  }

  // ---- o que mudou desde o último desenho: lance do outro, sua vez, fim ----
  function diferenca(antes, depois, cor) {
    let de = -1, para = -1;
    const capturas = [];
    for (let i = 0; i < 32; i++) {
      const a = antes[i], d = depois[i];
      if (a === d) continue;
      if (corDe(a) === cor && d === '.') de = i;
      else if (corDe(d) === cor) para = i;
      else if (a !== '.' && d === '.') capturas.push(i);
    }
    return de >= 0 && para >= 0 ? { de, para, capturas } : null;
  }
  async function buscarUltimoLance(p) {
    try {
      const r = await C.sb.from('jogos_lances').select('n,caminho').eq('partida', p.id).order('n', { ascending: false }).limit(1);
      const l = r.data && r.data[0];
      const v = J.visto;
      if (!l || !v || v.id !== p.id || l.n !== v.versao || !l.caminho || l.caminho.length < 2) return;
      J.ult = { id: p.id, versao: l.n, de: l.caminho[0], para: ultima(l.caminho) };
      J.assin = null;
      if (partidaDaUrl() === p.id) desenharPartida(p.id);
    } catch (e) {}
  }
  function notarMudanca(p, est, minhaCor) {
    const v = J.visto;
    J.visto = { id: p.id, versao: p.versao, tab: est.tab, vez: est.vez, status: p.status };
    if (!v || v.id !== p.id) { J.ult = null; J.anim = null; J.sel = null; J.verQuem = null; J.fogo = null; limparVoos(); buscarUltimoLance(p); return; }
    if (p.versao === v.versao + 1 && est.tab !== v.tab) {
      if (!J.anim) { // lance do outro (o meu já foi animado na hora)
        const mov = diferenca(v.tab, est.tab, v.vez);
        if (mov) {
          J.ult = { id: p.id, versao: p.versao, de: mov.de, para: mov.para };
          J.anim = { ...mov, tabAntes: v.tab };
          const virou = v.tab[mov.de] !== est.tab[mov.para];
          if (virou) fezDama(p, v.vez, mov.para, minhaCor);
          som(virou ? 'dama' : mov.capturas.length ? 'capturar' : 'mover');
        } else J.ult = null;
      }
    } else if (p.versao === v.versao + 1 && est.tab === v.tab && est.vez !== v.vez && p.status === 'andamento') {
      // ninguém mexeu peça: o tempo de quem estava na vez acabou e a vez passou (ao_acabar_tempo = perde_vez)
      J.ult = null;
      toast(v.vez === minhaCor ? 'Seu tempo acabou: a vez passou.' : `Acabou o tempo do ${nick(v.vez === 'b' ? p.brancas : p.pretas)}: a vez passou.`);
    } else if (p.versao > v.versao) { J.ult = null; buscarUltimoLance(p); }
    if (minhaCor && p.status === 'andamento' && p.versao > v.versao && v.vez !== est.vez && est.vez === minhaCor) {
      if (navigator.vibrate) navigator.vibrate(80);
      setTimeout(() => som('vez'), 260);
    }
    if (v.status === 'andamento' && p.status === 'fim') {
      const meu = eu();
      if (minhaCor && p.vencedor && p.vencedor !== meu) setTimeout(() => som('derrota'), 300);
      else setTimeout(() => som('vitoria'), 300);
    }
  }

  // ---- tabuleiro ----
  function peca(letra) {
    const s = el('span', { class: `jg-p ${letra.toLowerCase()}` });
    if (letra === 'B' || letra === 'P') s.innerHTML = COROA;
    return s;
  }
  // girar = quem joga de pretas vê o tabuleiro do lado dele (as pretas embaixo)
  function tabuleiro(est, girar, m = null) {
    const box = el('div', { class: 'jg-tab' + (m && m.jogavel ? ' jogavel' : '') });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const lin = girar ? 7 - r : r, col = girar ? 7 - c : c;
      const i = R.casa(lin, col);
      const cls = ['jg-c', i < 0 ? 'cl' : 'es'];
      if (m && i >= 0) {
        if (m.ult && (m.ult.de === i || m.ult.para === i)) cls.push('ult');
        if (m.alvos.has(i)) cls.push('jg-alvo');
        else if (m.meios.has(i)) cls.push('jg-alvo', 'meio');
      }
      const cel = el('div', { class: cls.join(' '), 'data-casa': i < 0 ? null : String(i) });
      if (c === 0) cel.append(el('span', { class: 'crd n', text: String(8 - lin) }));
      if (r === 7) cel.append(el('span', { class: 'crd l', text: 'abcdefgh'[col] }));
      if (i >= 0 && est.tab[i] !== '.') {
        if (m && m.fogo === i) cel.append(el('span', { class: 'jg-dama-fogo', 'aria-hidden': 'true' }));
        const pc = peca(est.tab[i]);
        if (m) {
          if (m.sel === i) pc.classList.add('sel');
          if (m.deve.has(i)) pc.classList.add('deve');
          if (m.vitimas.has(i)) pc.classList.add('vitima');
        }
        cel.append(pc);
      }
      box.append(cel);
    }
    // seta tracejada com o caminho da captura
    if (m && m.caminhos.length) {
      const pt = (i) => { const { lin, col } = R.coord(i); return `${(girar ? 7 - col : col) + 0.5},${(girar ? 7 - lin : lin) + 0.5}`; };
      const w = document.createElement('div');
      w.innerHTML = `<svg class="jg-caminho" viewBox="0 0 8 8" aria-hidden="true"><defs><marker id="jgSeta" viewBox="0 0 10 10" refX="5" refY="5" markerWidth="4" markerHeight="4" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="#FFB347"/></marker></defs>${m.caminhos.map((cm) => `<polyline points="${cm.map(pt).join(' ')}" fill="none" stroke="#FFB347" stroke-width=".07" stroke-dasharray=".18 .12" stroke-linecap="round" stroke-linejoin="round" marker-end="url(#jgSeta)" opacity=".95"/>`).join('')}</svg>`;
      box.append(w.firstChild);
    }
    return box;
  }
  // peça deslizando da casa de origem; capturadas encolhendo uma a uma
  function animar(box) {
    const a = J.anim;
    J.anim = null;
    if (!a) return;
    const cel = (i) => box.querySelector(`[data-casa="${i}"]`);
    const cDe = cel(a.de), cPara = cel(a.para);
    const pc = cPara && cPara.querySelector('.jg-p');
    if (cDe && pc) {
      const r1 = cDe.getBoundingClientRect(), r2 = cPara.getBoundingClientRect();
      pc.style.transition = 'none';
      pc.style.zIndex = '3';
      pc.style.transform = `translate(${r1.left - r2.left}px, ${r1.top - r2.top}px)`;
      pc.getBoundingClientRect();
      pc.style.transition = 'transform .22s ease-out';
      pc.style.transform = '';
      setTimeout(() => { pc.style.transition = ''; pc.style.zIndex = ''; }, 260);
    }
    a.capturas.forEach((i, k) => {
      const c = cel(i), letra = a.tabAntes[i];
      if (!c || !letra || letra === '.') return;
      const f = peca(letra);
      f.classList.add('jg-some');
      f.style.animationDelay = `${140 + k * 90}ms`;
      c.append(f);
      setTimeout(() => f.remove(), 560 + k * 90);
    });
  }
  function tremer() {
    const t = document.querySelector('#jogos .jg-tab');
    if (!t) return;
    t.classList.remove('jg-treme');
    t.getBoundingClientRect();
    t.classList.add('jg-treme');
    if (navigator.vibrate) navigator.vibrate(40);
  }

  // ---- tocar no tabuleiro ----
  function tocarCasa(i) {
    const x = J.ctx;
    if (!x || J.enviando) return;
    const { p, est, jogaveis, origens, minhaCor } = x;
    if (!jogaveis.length) {
      if (corDe(est.tab[i]) === minhaCor && p.status === 'andamento') toast(`Vez do ${nick(est.vez === 'b' ? p.brancas : p.pretas)}.`);
      return;
    }
    const sel = J.sel;
    if (sel) {
      const pre = sel.pre;
      const cands = jogaveis.filter((j) => comeca(j.caminho, pre));
      if (pre.length > 1 && i === ultima(pre)) {
        const j = cands.find((c) => c.caminho.length === pre.length);
        if (j) { jogar(p, j); return; }
      }
      const proximos = cands.filter((j) => j.caminho.length > pre.length && j.caminho[pre.length] === i);
      const seguem = proximos.filter((j) => j.caminho.length > pre.length + 1);
      const terminam = cands.filter((j) => j.caminho.length > pre.length && ultima(j.caminho) === i);
      if (terminam.length === 1 && !seguem.length) { jogar(p, terminam[0]); return; }
      if (proximos.length) { J.sel = { ...sel, pre: pre.concat(i) }; desenharPartida(p.id); return; }
      if (terminam.length > 1) { toast('Dois caminhos chegam nessa casa: toque antes na casa do meio.'); return; }
    }
    if (origens.has(i)) {
      const mesma = sel && sel.pre[0] === i;
      J.sel = mesma && sel.pre.length === 1 && origens.size > 1 ? null : { id: p.id, versao: p.versao, pre: [i] };
      desenharPartida(p.id);
      return;
    }
    if (corDe(est.tab[i]) === minhaCor) {
      toast(x.captura ? 'Captura obrigatória: jogue uma peça marcada.' : 'Essa peça não tem jogada agora.', true);
      tremer();
      return;
    }
    if (sel && (sel.pre.length > 1 || origens.size > 1)) {
      J.sel = sel.pre.length > 1 ? { ...sel, pre: [sel.pre[0]] } : null;
      desenharPartida(p.id);
    }
  }
  // mostra na hora (otimista); se o servidor recusar, desfaz e diz o motivo
  async function jogar(p, j) {
    let novo;
    try { novo = R.aplicar(p.estado, j.caminho, opcoes()); } catch (e) { toast('Jogada inválida.', true); tremer(); return; }
    const seg = Number(J.cfg.tempo_jogada) || 60;
    const otim = { ...p, estado: novo, versao: p.versao + 1, prazo: new Date(agora() + seg * 1000).toISOString(), empate_proposto_por: null };
    const de = j.caminho[0], para = ultima(j.caminho);
    J.sel = null;
    J.enviando = true;
    J.pendente = otim;
    J.anim = { de, para, capturas: j.capturas, tabAntes: p.estado.tab };
    J.ult = { id: p.id, versao: otim.versao, de, para };
    som(j.viraDama ? 'dama' : j.capturas.length ? 'capturar' : 'mover');
    if (j.viraDama) fezDama(p, p.estado.vez, para, p.estado.vez);
    forcar(otim);
    desenhar();
    try {
      const r = await api({ acao: 'jogar', partida: p.id, versao: p.versao, caminho: j.caminho });
      J.pendente = null;
      const cur = linhaDe(p.id) || otim;
      if (r.status === 'fim') {
        const x = await buscarPartida(p.id).catch(() => null);
        guardar(x || { ...cur, status: 'fim', estado: r.estado, versao: r.versao });
      } else if ((cur.versao | 0) <= r.versao) {
        guardar({ ...cur, estado: r.estado, versao: r.versao, status: r.status, prazo: r.prazo || cur.prazo });
      }
    } catch (e) {
      J.pendente = null;
      J.anim = null;
      J.ult = null;
      forcar(p);
      toast(e.message, true);
      J.enviando = false;
      J.assin = null;
      desenhar();
      tremer();
      // confere com o banco: a jogada pode ter chegado, ou o outro já jogou
      const x = await buscarPartida(p.id).catch(() => null);
      if (x) forcar(x);
    }
    J.enviando = false;
    J.assin = null;
    desenhar();
  }

  // ---- empate, desistência, revanche ----
  async function proporEmpate(p, bt) {
    bt.disabled = true;
    try { await rpc('jogos_propor_empate', { p_partida: p.id }); toast(`Empate proposto. Esperando o ${nick(p.brancas === eu() ? p.pretas : p.brancas)}.`); await conferir(p.id); }
    catch (e) { toast(erroTxt(e), true); bt.disabled = false; }
  }
  async function responderEmpate(p, aceitar, bt) {
    travar(bt, true);
    try { await rpc('jogos_responder_empate', { p_partida: p.id, p_aceitar: aceitar }); await conferir(p.id); }
    catch (e) { toast(erroTxt(e), true); travar(bt, false); }
  }
  function desistir(p) {
    const outro = p.brancas === eu() ? p.pretas : p.brancas;
    C.confirmar('DESISTIR DA PARTIDA?', `A vitória vai pro ${nick(outro)}.`, 'Desistir', async () => {
      try { await rpc('jogos_desistir', { p_partida: p.id }); await conferir(p.id); }
      catch (e) { toast(erroTxt(e), true); recarregar(); }
    });
  }
  const pedidoRevanche = (p) => [...J.lista.values()].find((x) => x.revanche_de === p.id && x.status === 'convite' && vivo(x)) || null;
  async function revanche(p, bt) {
    bt.disabled = true;
    try {
      const id = await rpc('jogos_revanche', { p_partida: p.id });
      const x = id ? await buscarPartida(id) : null;
      if (x) guardar(x);
      if (x && x.status === 'andamento') { J.fimFechado.add(p.id); C.irPara('#jogos/' + x.id); return; }
      toast(`Pedido de revanche enviado pro ${nick(p.brancas === eu() ? p.pretas : p.brancas)}.`);
      J.fimAss = null;
      desenhar();
    } catch (e) { toast(erroTxt(e), true); bt.disabled = false; }
  }
  // confere a partida no banco (depois de uma ação, ou quando o tempo real fica quieto demais)
  async function conferir(id) {
    try {
      const x = await buscarPartida(id);
      if (!x) return;
      const cur = linhaDe(id);
      if (!cur || x.versao !== cur.versao || x.status !== cur.status || x.empate_proposto_por !== cur.empate_proposto_por || x.prazo !== cur.prazo) mudou({ eventType: 'UPDATE', new: x });
    } catch (e) {}
  }

  // ---- barras dos jogadores ----
  const contar = (est, cor) => [...est.tab].filter((x) => x.toLowerCase() === cor).length;
  function barraJogador(p, cor, est, vez) {
    const id = cor === 'b' ? p.brancas : p.pretas;
    const outra = cor === 'b' ? 'p' : 'b';
    const n = contar(est, cor), comeu = Math.max(0, 12 - contar(est, outra));
    const rel = el('span', { class: 'jg-relogio jg-tiq' });
    rel._tique = () => {
      if (!vez || !p.prazo) { rel.className = 'jg-relogio jg-tiq'; rel.textContent = mmss(Number(J.cfg.tempo_jogada) || 60); return true; }
      const s = Math.max(0, Math.ceil((ms(p.prazo) - agora()) / 1000));
      rel.className = `jg-relogio jg-tiq ${s <= 10 ? 'acaba' : 'corre'}`;
      rel.textContent = mmss(s);
      return true;
    };
    rel._tique();
    return el('div', { class: `jg-jog ${vez ? 'vez' : ''}` }, C.avatarChat(nick(id), 'av-m'),
      el('div', { class: 'jg-jog-txt' }, el('b', { text: nick(id) }),
        el('small', null, `${cor === 'b' ? 'brancas' : 'pretas'} · ${n} ${n === 1 ? 'peça' : 'peças'}`,
          comeu ? el('span', { class: 'jg-mini', 'aria-label': `${comeu} capturadas` }, Array.from({ length: comeu }, () => el('i', { class: outra === 'p' ? 'es' : 'cl' }))) : null)),
      rel);
  }

  // ---- a tela da partida ----
  function desenharPartida(id) {
    const sec = $('jogos');
    const p = linhaDe(id);
    if (!p) {
      J.assin = null;
      trocar(sec, el('p', { class: 'jg-vazio', text: 'Carregando a partida…' }));
      buscarPartida(id).then((x) => {
        if (partidaDaUrl() !== id) return;
        if (!x) { toast('Partida não encontrada.', true); C.irPara('#jogos'); return; }
        J.aberta = x;
        desenhar(); // abre também o canal de quem assiste
      }).catch(() => toast('Não consegui abrir a partida.', true));
      return;
    }
    J.aberta = p;
    // convite (ainda não aceito ou recusado): a partida não existe, volta pra sala
    if (p.status !== 'andamento' && p.status !== 'fim') { C.irPara('#jogos'); return; }
    const meu = eu(), souB = !!meu && p.brancas === meu, souP = !!meu && p.pretas === meu, jogo = souB || souP;
    const minhaCor = souB ? 'b' : souP ? 'p' : null;
    const est = p.estado || R.estadoInicial();
    const andando = p.status === 'andamento';
    const vez = andando ? est.vez : null;
    const embaixo = souP ? 'p' : 'b', emCima = embaixo === 'b' ? 'p' : 'b';
    const minhaVez = jogo && vez === minhaCor;
    notarMudanca(p, est, minhaCor);

    // jogadas possíveis e o que está selecionado
    let jogaveis = [];
    if (minhaVez && !J.enviando) { try { jogaveis = R.jogadasValidas(est, opcoes()); } catch (e) {} }
    const origens = new Set(jogaveis.map((j) => j.caminho[0]));
    const captura = jogaveis.length > 0 && jogaveis[0].capturas.length > 0;
    let sel = J.sel && J.sel.id === p.id && J.sel.versao === p.versao && origens.has(J.sel.pre[0]) ? J.sel : null;
    if (!sel && captura && origens.size === 1) sel = { id: p.id, versao: p.versao, pre: [jogaveis[0].caminho[0]] };
    J.sel = sel;
    const ult = J.ult && J.ult.id === p.id ? J.ult : null;

    const fogo = J.fogo && J.fogo.id === p.id && Date.now() < J.fogo.ate ? J.fogo.casa : -1;
    const ass = JSON.stringify([p.id, p.versao, p.status, p.prazo, p.empate_proposto_por, p.vencedor, sel, J.enviando, ult, J.mudo, J.fimFechado.has(p.id), meu, fogo, J.semReacoes]);
    if (ass === J.assin && sec.querySelector('.jg-partida')) { desenharFim(p); return; }
    J.assin = ass;

    const cands = sel ? jogaveis.filter((j) => comeca(j.caminho, sel.pre)) : [];
    const m = { jogavel: jogaveis.length > 0, ult, fogo, sel: sel ? sel.pre[0] : -1, deve: captura ? origens : new Set(), alvos: new Set(), meios: new Set(sel ? sel.pre.slice(1) : []), vitimas: new Set(), caminhos: [] };
    for (const j of cands) {
      if (j.caminho.length === sel.pre.length) m.alvos.add(ultima(sel.pre));
      else m.alvos.add(ultima(j.caminho));
      for (let k = sel.pre.length; k < j.caminho.length - 1; k++) m.meios.add(j.caminho[k]);
    }
    if (cands.length) {
      for (const c of cands[0].capturas) if (cands.every((j) => j.capturas.includes(c))) m.vitimas.add(c);
      if (captura) m.caminhos = cands.map((j) => j.caminho);
    }
    J.ctx = { p, est, jogaveis, origens, captura, minhaCor };

    let faixa;
    if (andando && minhaVez) {
      const cap = jogaveis.reduce((mx, j) => Math.max(mx, j.capturas.length), 0);
      faixa = el('div', { class: 'jg-vez' }, 'SUA VEZ', cap ? el('small', { text: `CAPTURA OBRIGATÓRIA · ${cap} ${cap === 1 ? 'PEÇA' : 'PEÇAS'}` }) : null);
    } else if (andando) {
      faixa = el('div', { class: 'jg-vez dele' }, 'VEZ DE ', el('b', { text: nick(vez === 'b' ? p.brancas : p.pretas) }));
    } else {
      faixa = el('div', { class: 'jg-vez dele' }, !p.vencedor ? 'EMPATE' : jogo ? (p.vencedor === meu ? 'VITÓRIA' : 'DERROTA') : ['VITÓRIA DE ', el('b', { text: nick(p.vencedor) })],
        el('small', { text: (MOTIVO[p.motivo] || 'fim').toUpperCase() }));
    }
    const tab = tabuleiro(est, souP, m);
    if (jogo && andando) tab.addEventListener('click', (e) => { const c = e.target.closest('[data-casa]'); if (c) tocarCasa(Number(c.dataset.casa)); });

    let acoes = null;
    if (jogo && andando) {
      const pediu = p.empate_proposto_por;
      acoes = pediu && pediu !== meu
        ? el('div', { class: 'jg-acoes jg-empate-pedido' },
          el('button', { type: 'button', class: 'btn btn-pri', onclick: (e) => responderEmpate(p, true, e.currentTarget) }, '½ Aceitar empate'),
          el('button', { type: 'button', class: 'btn btn-sec', text: 'Recusar', onclick: (e) => responderEmpate(p, false, e.currentTarget) }))
        : el('div', { class: 'jg-acoes' },
          el('button', { type: 'button', class: 'btn btn-sec', disabled: pediu === meu, onclick: (e) => proporEmpate(p, e.currentTarget) }, pediu === meu ? '½ Empate proposto' : '½ Propor empate'),
          el('button', { type: 'button', class: 'btn btn-perigo-sec', text: 'Desistir', onclick: () => desistir(p) }));
    } else if (!andando) {
      acoes = el('div', { class: 'jg-acoes' },
        el('button', { type: 'button', class: 'btn btn-sec', text: 'Ver resultado', onclick: () => { J.fimFechado.delete(p.id); J.assin = null; desenhar(); } }),
        el('button', { type: 'button', class: 'btn btn-sec', text: 'Voltar pra sala', onclick: () => C.irPara('#jogos') }));
    }

    trocar(sec, el('div', { class: 'jg-partida' },
      el('div', { class: 'jg-topo-partida' },
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => C.irPara('#jogos') }, ico(IC_VOLTAR, 16), 'Sala'),
        el('button', { type: 'button', class: 'jg-olhos', id: 'jgOlhos', hidden: true, 'aria-controls': 'jgQuem', 'aria-expanded': 'false', onclick: () => { J.verQuem = !verQuem(p); atualizarOlhos(); } }),
        el('button', { type: 'button', class: 'jg-ico', 'aria-label': J.mudo ? 'Ligar o som' : 'Desligar o som', 'aria-pressed': J.mudo ? 'true' : 'false', onclick: trocarMudo }, ico(J.mudo ? IC_MUDO : IC_SOM))),
      el('div', { class: 'jg-quem', id: 'jgQuem', hidden: true }),
      barraJogador(p, emCima, est, vez === emCima),
      faixa,
      tab,
      barraJogador(p, embaixo, est, vez === embaixo),
      acoes,
      andando ? barraReacoes() : null));
    animar(tab);
    atualizarOlhos();
    desenharFim(p);
  }

  // ---------- quem assiste e reações (imagem 03) ----------
  // cada partida na tela tem o canal partida:<id>: a presença diz quem está jogando e quem está
  // assistindo; o broadcast "reacao" leva os emojis. Na sala só escuta (pro "👀 N assistindo").
  const EMOJIS = ['😂', '🔥', '😱', '👏', '💀'];
  const SESSAO = 'v-' + Math.random().toString(36).slice(2);
  const minhaChave = () => (C.euChat && C.euChat()) || (eu() ? 'p-' + eu() : SESSAO);
  const meuNome = () => { const r = eu() && C.jogador(eu()); return r ? r.nick : (C.meuNick && C.meuNick()) || 'Alguém'; };
  function sincronizarCanais() {
    const quer = new Map();
    if (J.ligado && C.sb) {
      const id = partidaDaUrl(), p = id && linhaDe(id);
      if (p && p.status === 'andamento') quer.set(id, eu() && (p.brancas === eu() || p.pretas === eu()) ? 'jogador' : 'espectador');
      if (naSala()) for (const x of emAndamento()) if (!quer.has(x.id)) quer.set(x.id, null);
    }
    for (const [id, c] of J.canais) if (!quer.has(id)) { if (C.sb) C.sb.removeChannel(c.ch); J.canais.delete(id); }
    for (const [id, papel] of quer) {
      const c = J.canais.get(id) || abrirCanal(id);
      if (c.papel !== papel) { c.papel = papel; marcarPresenca(c); }
    }
  }
  function abrirCanal(id) {
    const c = { ch: null, ok: false, papel: null, marcado: false, desde: Date.now() };
    J.canais.set(id, c);
    c.ch = C.sb.channel('partida:' + id, { config: { presence: { key: minhaChave() }, broadcast: { self: false } } })
      .on('presence', { event: 'sync' }, () => { if (J.canais.get(id) === c) atualizarOlhos(); })
      .on('broadcast', { event: 'reacao' }, ({ payload }) => receberReacao(id, payload))
      .subscribe((st) => {
        c.ok = st === 'SUBSCRIBED';
        if (c.ok) { c.marcado = false; marcarPresenca(c); } // (re)conectou: marca de novo
      });
    return c;
  }
  function marcarPresenca(c) {
    if (!c.ok) return;
    if (c.papel) { c.marcado = true; Promise.resolve(c.ch.track({ player_id: eu() || null, nome: meuNome(), papel: c.papel, desde: c.desde })).catch(() => {}); }
    else if (c.marcado) { c.marcado = false; Promise.resolve(c.ch.untrack()).catch(() => {}); }
  }
  // quem está assistindo (sem os dois jogadores), eu primeiro e depois por ordem de chegada
  function quemAssiste(id) {
    const c = J.canais.get(id);
    if (!c) return [];
    let st = {};
    try { st = c.ch.presenceState() || {}; } catch (e) {}
    const p = linhaDe(id), vistos = new Set(), lista = [];
    for (const [k, metas] of Object.entries(st)) {
      const m = metas && metas[0];
      if (!m || m.papel !== 'espectador') continue;
      const pid = m.player_id || null;
      if (p && pid && (pid === p.brancas || pid === p.pretas)) continue;
      const chave = pid || k;
      if (vistos.has(chave)) continue;
      vistos.add(chave);
      const r = pid && C.jogador(pid);
      lista.push({ k, pid, nome: r ? r.nick : String(m.nome || 'Alguém').slice(0, 24), desde: Number(m.desde) || 0, eu: k === minhaChave() || (!!pid && pid === eu()) });
    }
    return lista.sort((a, b) => b.eu - a.eu || a.desde - b.desde);
  }
  function fraseQuem(l) {
    const n = l.map((x) => x.nome);
    if (n.length === 1) return `${n[0]} está assistindo`;
    if (n.length <= 4) return `${n.slice(0, -1).join(', ')} e ${n[n.length - 1]} estão assistindo`;
    return `${n.slice(0, 3).join(', ')} e mais ${n.length - 3} estão assistindo`;
  }
  const verQuem = (p) => (J.verQuem != null ? J.verQuem : !(eu() && (p.brancas === eu() || p.pretas === eu())));
  // chip "👀 N assistindo" + faixa com os avatares (partida) e "lance 31 · 👀 4 assistindo" (sala)
  function atualizarOlhos() {
    document.querySelectorAll('#jogos [data-olhos]').forEach((d) => { const p = linhaDe(d.dataset.olhos); if (p) d.textContent = infoVivo(p); });
    const chip = document.getElementById('jgOlhos'), faixa = document.getElementById('jgQuem');
    const id = partidaDaUrl(), p = id && linhaDe(id);
    if (!chip || !faixa || !p) return;
    const l = p.status === 'andamento' ? quemAssiste(id) : [];
    chip.hidden = !l.length;
    trocar(chip, '👀 ', el('b', { text: String(l.length) }), ' assistindo');
    const aberta = l.length > 0 && verQuem(p);
    chip.setAttribute('aria-expanded', aberta ? 'true' : 'false');
    faixa.hidden = !aberta;
    if (aberta) trocar(faixa, l.slice(0, 6).map((x) => C.avatarChat(x.nome)), el('span', { text: fraseQuem(l) }));
    posVoos();
  }

  // camada por cima do tabuleiro: fica fora do #jogos, assim os emojis não somem quando o tabuleiro redesenha
  function camada() {
    const t = document.querySelector('#jogos .jg-tab');
    if (!t) return null;
    if (!J.voos) { J.voos = el('div', { class: 'jg-voos', 'aria-hidden': 'true' }); document.body.append(J.voos); }
    posVoos();
    return J.voos;
  }
  function posVoos() {
    const t = J.voos && document.querySelector('#jogos .jg-tab');
    if (!t) return;
    const r = t.getBoundingClientRect();
    J.voos.style.cssText = `left:${r.left + scrollX}px;top:${r.top + scrollY}px;width:${r.width}px;height:${r.height}px`;
  }
  function limparVoos(soEmojis = false) {
    if (!J.voos) return;
    if (soEmojis) J.voos.querySelectorAll('.jg-voa').forEach((v) => v.remove());
    else { J.voos.remove(); J.voos = null; }
  }
  function voar(emoji, nome) {
    const L = camada();
    if (!L) return;
    const vs = L.querySelectorAll('.jg-voa');
    if (vs.length >= 12) vs[0].remove();
    const v = el('div', { class: 'jg-voa', style: `left:${(3 + Math.random() * 66).toFixed(1)}%;top:${(12 + Math.random() * 54).toFixed(1)}%` }, el('span', { text: emoji }), el('small', { text: nome }));
    L.append(v);
    setTimeout(() => v.remove(), 2900);
  }
  function reagir(emoji) {
    const id = partidaDaUrl(), c = id && J.canais.get(id);
    if (!c || J.semReacoes || Date.now() - J.reagiuEm < 1500) return; // 1 a cada 1,5 s
    J.reagiuEm = Date.now();
    voar(emoji, meuNome());
    if (c.ok) Promise.resolve(c.ch.send({ type: 'broadcast', event: 'reacao', payload: { emoji, nome: meuNome(), player_id: eu() || null, k: minhaChave() } })).catch(() => {});
  }
  function receberReacao(id, x) {
    if (!x || id !== partidaDaUrl() || J.semReacoes || !EMOJIS.includes(x.emoji)) return;
    const k = String(x.k || x.player_id || x.nome || '?').slice(0, 64), t = Date.now();
    if (t - (J.recebidas.get(k) || 0) < 1200) return; // quem manda rápido demais fica de fora
    J.recebidas.set(k, t);
    const r = x.player_id && C.jogador(x.player_id);
    voar(x.emoji, r ? r.nick : String(x.nome || 'Alguém').slice(0, 20));
  }
  function trocarReacoes() {
    J.semReacoes = !J.semReacoes;
    try { localStorage.setItem('cobr-jogos-sem-reacoes', J.semReacoes ? '1' : ''); } catch (e) {}
    if (J.semReacoes) limparVoos(true);
    J.assin = null;
    desenhar();
  }
  function barraReacoes() {
    if (J.semReacoes) return el('div', { class: 'jg-reacoes so' }, el('button', { type: 'button', class: 'jg-esconder', text: 'MOSTRAR REAÇÕES', onclick: trocarReacoes }));
    return el('div', { class: 'jg-reacoes', role: 'group', 'aria-label': 'Reações' },
      EMOJIS.map((e) => el('button', { type: 'button', text: e, 'aria-label': `Reagir com ${e}`, onclick: () => reagir(e) })),
      el('button', { type: 'button', class: 'jg-esconder', text: 'OCULTAR', 'aria-label': 'Ocultar as reações', onclick: trocarReacoes }));
  }
  // "👑 NICK FEZ DAMA!" no meio do tabuleiro + anel de fogo na peça, pra todo mundo
  function fezDama(p, cor, casa, minhaCor) {
    const quem = minhaCor && cor === minhaCor ? 'VOCÊ' : nick(cor === 'b' ? p.brancas : p.pretas).toUpperCase();
    const ate = Date.now() + 3500;
    J.fogo = { id: p.id, casa, ate };
    setTimeout(() => {
      if (J.fogo && J.fogo.ate === ate) { J.fogo = null; J.assin = null; desenhar(); }
    }, 3600);
    setTimeout(() => { // depois do tabuleiro novo estar na tela
      const L = camada();
      if (!L) return;
      L.querySelectorAll('.jg-aviso-dama').forEach((a) => a.remove());
      const a = el('div', { class: 'jg-aviso-dama', text: `👑 ${quem} FEZ DAMA!` });
      L.append(a);
      setTimeout(() => a.remove(), 3000);
    }, 0);
  }

  // ---- janela do fim (imagem 04): vitória, derrota ou empate ----
  const TACA = '<svg class="jg-fim-taca" viewBox="0 0 64 64" aria-hidden="true"><defs><linearGradient id="jgOuro" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#FFF1C2"/><stop offset=".5" stop-color="#FFD84D"/><stop offset="1" stop-color="#E08A1E"/></linearGradient></defs>'
    + '<path d="M18 8h28v12c0 9-6 16-14 16S18 29 18 20z" fill="url(#jgOuro)"/><path d="M18 12H10v4c0 6 4 10 9 10M46 12h8v4c0 6-4 10-9 10" fill="none" stroke="url(#jgOuro)" stroke-width="3.5"/>'
    + '<rect x="29" y="35" width="6" height="9" fill="url(#jgOuro)"/><path d="M21 51h22l-3-7H24z" fill="url(#jgOuro)"/><rect x="17" y="51" width="30" height="6" rx="1.5" fill="#9A4F12"/>'
    + '<circle cx="32" cy="19" r="7" fill="#26211E" stroke="#FF7A1A" stroke-width="2"/><circle cx="32" cy="19" r="4" fill="none" stroke="rgba(255,122,26,.5)" stroke-width="1.2"/></svg>';
  function motivoFim(p) {
    const meu = eu(), jogo = !!meu && (p.brancas === meu || p.pretas === meu);
    if (!p.vencedor) return p.motivo === 'empate_20' ? '20 lances seguidos só de damas' : 'Empate combinado';
    const perdeu = p.vencedor === p.brancas ? p.pretas : p.brancas;
    const voce = jogo && perdeu === meu;
    const quem = voce ? 'Você' : nick(perdeu);
    if (p.motivo === 'sem_pecas') return `${quem} ficou sem peças`;
    if (p.motivo === 'sem_jogadas') return `${quem} ficou sem jogadas`;
    if (p.motivo === 'desistencia') return `${quem} desistiu`;
    if (p.motivo === 'tempo') return voce ? 'Seu tempo acabou' : `Acabou o tempo do ${quem}`;
    return `${nick(p.vencedor)} venceu`;
  }
  // números da partida (lances do banco) e se o vencedor assumiu o 1º lugar do ranking de damas
  async function carregarFimInfo(p) {
    if (J.fimCarregando === p.id) return;
    J.fimCarregando = p.id;
    const info = { id: p.id, capturas: {}, damas: {}, assumiu: false };
    try {
      const r = await C.sb.from('jogos_lances').select('player,capturas,virou_dama').eq('partida', p.id);
      for (const l of r.data || []) {
        info.capturas[l.player] = (info.capturas[l.player] || 0) + ((l.capturas && l.capturas.length) || 0);
        if (l.virou_dama) info.damas[l.player] = (info.damas[l.player] || 0) + 1;
      }
      if (p.vencedor && p.vencedor === eu()) info.assumiu = await assumiuPrimeiro(p);
    } catch (e) {}
    J.fimInfo = info;
    J.fimCarregando = null;
    J.fimAss = null;
    const x = linhaDe(p.id);
    if (x && partidaDaUrl() === p.id) desenharFim(x);
  }
  // mesma ordem do jogos_placar: vitórias, aproveitamento, partidas, nick
  function ordemPlacar(a, b) {
    return b.vitorias - a.vitorias || b.vitorias / b.partidas - a.vitorias / a.partidas || b.partidas - a.partidas || String(a.nick).toLowerCase().localeCompare(String(b.nick).toLowerCase());
  }
  async function assumiuPrimeiro(p) {
    const r = await C.sb.rpc('jogos_placar', { p_jogo: 'damas' });
    const depois = (r.data || []).slice().sort(ordemPlacar);
    if (!depois.length || depois[0].player_id !== p.vencedor) return false;
    const perdeu = p.vencedor === p.brancas ? p.pretas : p.brancas;
    const antes = depois.map((x) => {
      if (x.player_id === p.vencedor) return { ...x, partidas: x.partidas - 1, vitorias: x.vitorias - 1 };
      if (x.player_id === perdeu) return { ...x, partidas: x.partidas - 1, derrotas: x.derrotas - 1 };
      return x;
    }).filter((x) => x.partidas > 0).sort(ordemPlacar);
    return !antes.length || antes[0].player_id !== p.vencedor;
  }
  function fecharFim() {
    if (J.fim) { J.fim.remove(); J.fim = null; }
    J.fimAss = null;
  }
  function confete() {
    const cores = ['#FF7A1A', '#FFB347', '#FFD84D', '#F4EDE6', '#E0457B', '#3BA4FF'];
    return Array.from({ length: 46 }, (_, i) => el('span', {
      class: 'jg-confete', 'aria-hidden': 'true',
      style: `left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;background:${cores[i % cores.length]};transform:rotate(${Math.round(Math.random() * 360)}deg);opacity:${(0.6 + Math.random() * 0.4).toFixed(2)};animation-duration:${(1.4 + Math.random() * 1.6).toFixed(2)}s;animation-delay:${(Math.random() * 0.6).toFixed(2)}s`,
    }));
  }
  function desenharFim(p) {
    if (!p || p.status !== 'fim' || partidaDaUrl() !== p.id || J.fimFechado.has(p.id)) { fecharFim(); return; }
    const info = J.fimInfo && J.fimInfo.id === p.id ? J.fimInfo : null;
    if (!info) carregarFimInfo(p);
    const meu = eu(), jogo = !!meu && (p.brancas === meu || p.pretas === meu);
    const rev = jogo ? pedidoRevanche(p) : null;
    const ass = JSON.stringify([p.id, p.vencedor, p.motivo, p.versao, !!info, rev && rev.id, rev && rev.convidou]);
    if (J.fim && J.fimAss === ass) return;
    const tipo = !p.vencedor ? 'empate' : jogo && p.vencedor !== meu ? 'derrota' : 'vitoria';
    const outro = jogo ? (p.brancas === meu ? p.pretas : p.brancas) : null;
    // de quem são os números: o meu (se joguei) ou do vencedor; empate visto de fora: os dois somados
    const quem = jogo ? meu : p.vencedor;
    const soma = (o) => (quem ? o[quem] || 0 : Object.values(o).reduce((a, b) => a + b, 0));
    const esq = jogo ? meu : p.vencedor || p.brancas;
    const dir = esq === p.brancas ? p.pretas : p.brancas;
    const lado = (id) => el('div', { class: p.vencedor && id !== p.vencedor ? 'perdeu' : null }, C.avatarChat(nick(id), 'av-m'), nick(id));
    const stat = (rot, n) => el('div', null, el('small', { text: rot }), el('b', { text: n == null ? '–' : String(n) }));
    let btRev = null;
    if (jogo) {
      const pediuEle = rev && rev.convidou === outro, pediEu = rev && rev.convidou === meu;
      btRev = el('button', { type: 'button', class: 'btn btn-pri btn-grande', disabled: !!pediEu, onclick: (e) => revanche(p, e.currentTarget) },
        pediEu ? `ESPERANDO ${nick(outro).toUpperCase()}…` : pediuEle ? 'ACEITAR REVANCHE' : 'REVANCHE');
    }
    const caixa = el('div', { class: `jg-fim ${tipo}`, role: 'dialog', 'aria-modal': 'true', 'aria-label': tipo === 'vitoria' ? 'Vitória' : tipo === 'derrota' ? 'Derrota' : 'Empate' },
      tipo === 'vitoria' ? el('div', { class: 'jg-fim-raios' }) : null,
      el('div', { class: 'jg-fim-taca-box' }),
      el('h3', { text: tipo === 'vitoria' ? 'VITÓRIA!' : tipo === 'derrota' ? 'DERROTA' : 'EMPATE' }),
      el('p', { class: 'jg-fim-motivo', text: motivoFim(p) }),
      el('div', { class: 'jg-fim-duelo' }, lado(esq), el('span', { class: 'x', text: '×' }), lado(dir)),
      el('div', { class: 'jg-fim-stats' }, stat('LANCES', p.versao), stat('CAPTURAS', info ? soma(info.capturas) : null), stat('DAMAS', info ? soma(info.damas) : null)),
      info && info.assumiu ? el('p', { class: 'jg-fim-sobe', text: '🏆 Você assumiu o 1º lugar do ranking de damas!' }) : null,
      rev && rev.convidou === outro ? el('p', { class: 'jg-fim-sobe', text: `🔁 ${nick(outro)} pediu revanche!` }) : null,
      btRev,
      el('button', { type: 'button', class: 'btn btn-sec btn-grande', text: 'VOLTAR PRA SALA', onclick: () => { J.fimFechado.add(p.id); C.irPara('#jogos'); } }));
    caixa.querySelector('.jg-fim-taca-box').outerHTML = TACA;
    const novo = !J.fim || J.fimTipo !== p.id + tipo;
    const fundo = el('div', { class: 'jg-fim-fundo' + (novo ? ' entra' : '') }, tipo === 'vitoria' && novo ? confete() : (J.fim ? [...J.fim.querySelectorAll('.jg-confete')] : null), caixa);
    // tocar fora da janela fecha e mostra o tabuleiro final
    fundo.addEventListener('click', (e) => { if (e.target === fundo || e.target.classList.contains('jg-confete')) { J.fimFechado.add(p.id); J.assin = null; desenhar(); } });
    if (J.fim) J.fim.replaceWith(fundo); else document.body.append(fundo);
    J.fim = fundo;
    J.fimAss = ass;
    J.fimTipo = p.id + tipo;
  }
  addEventListener('keydown', (e) => {
    if (e.key !== 'Escape' || !J.fim || !J.aberta) return;
    J.fimFechado.add(J.aberta.id);
    J.assin = null;
    desenhar();
  });

  // ---------- convite em qualquer página (imagem 06) ----------
  function desenharPop() {
    const p = !naSala() && !partidaDaUrl() ? convitesRecebidos()[0] : null;
    if (!p) { if (J.pop) { J.pop.remove(); J.pop = null; J.popId = null; } return; }
    if (J.pop && J.popId === p.id) return;
    if (J.pop) J.pop.remove();
    J.pop = cartaoConvite(p, true);
    J.popId = p.id;
    document.body.append(J.pop);
    posicionarPop();
  }
  // logo abaixo do menu de cima (no celular ele sobe e desce com a rolagem)
  function posicionarPop() {
    if (!J.pop) return;
    const topo = document.querySelector('.topo');
    const b = topo ? topo.getBoundingClientRect().bottom : 44;
    J.pop.style.top = Math.max(12, Math.round(b + 14)) + 'px';
  }
  addEventListener('scroll', posicionarPop, { passive: true });
  addEventListener('resize', () => { posicionarPop(); posVoos(); });
  document.addEventListener('transitionend', (e) => { if (e.target.closest && e.target.closest('.topo')) posicionarPop(); });

  function desenharBadge() {
    const n = J.ligado && !naSala() ? convitesRecebidos().length : 0; // na sala o convite já está na tela
    document.querySelectorAll('[data-badge-jogos]').forEach((b) => { b.hidden = !n; b.textContent = String(n); });
  }

  // ---------- tudo ----------
  function desenhar() {
    document.body.classList.toggle('jg-em-partida', !!partidaDaUrl());
    desenharBadge();
    desenharPop();
    const minha = minhaPartida();
    C.marcarJogando(minha ? minha.id : null);
    const id = partidaDaUrl();
    if (!id) { fecharFim(); J.assin = null; J.sel = null; limparVoos(); }
    sincronizarCanais();
    if (C.pag !== 'jogos') return;
    if (!J.ligado) { desenharDemo(); return; }
    if (id) desenharPartida(id); else desenharSala();
  }
  function desenharDemo() {
    trocar($('jogos'), cabecalho(), el('div', { class: 'jg-card jg-aviso', text: C.DEMO ? 'Sala de jogos disponível só com o site ligado' : 'Carregando…' }));
  }
  // a cada segundo: anéis dos convites e relógios; convite que venceu sai da tela
  function tique() {
    let venceu = false;
    document.querySelectorAll('.jg-tiq').forEach((n) => { if (n._tique && n._tique() === false) { n._tique = null; venceu = true; } });
    if (venceu) desenhar();
    conferirRelogio();
    posVoos();
    // o tempo real pode cair sem avisar: com a partida aberta, confere no banco de vez em quando
    const id = J.ligado && partidaDaUrl();
    const p = id && linhaDe(id);
    if (id && !document.hidden && (!p || p.status === 'andamento') && Date.now() - J.ultNoticia > 15000) {
      J.ultNoticia = Date.now();
      conferir(id);
    }
  }

  async function ligar() {
    if (J.ligado || C.DEMO || !C.sb) return;
    J.ligado = true;
    J.carregou = false;
    desenhar();
    await acertarRelogio();
    try { await carregar(); } catch (e) { console.warn('jogos:', e.message); }
    if (!J.ligado) return;
    ligarAoVivo();
    J.tique = setInterval(tique, 1000);
    desenhar();
  }
  function desligar() {
    J.ligado = false;
    if (J.rt && C.sb) C.sb.removeChannel(J.rt);
    J.rt = null; J.conectou = false; J.carregou = false;
    clearInterval(J.tique);
    J.lista.clear(); J.ultimas = []; J.aberta = null; J.placar = null; J.perfis.clear(); J.tempoPed = null; J.rankTodo = false;
    J.sel = null; J.ctx = null; J.visto = null; J.ult = null; J.anim = null; J.assin = null; J.pendente = null; J.fimInfo = null;
    sincronizarCanais(); J.recebidas.clear(); J.fogo = null; J.verQuem = null;
    limparVoos();
    fecharFim();
    if (J.pop) { J.pop.remove(); J.pop = null; J.popId = null; }
    document.body.classList.remove('jg-em-partida');
    desenharBadge();
  }

  // ---------- regras (aba "Damas" do Como funciona) ----------
  C.regras.damas = () => {
    const cfg = J.cfg;
    const seg = Number(cfg.tempo_jogada) || 60;
    return [
      el('div', { class: 'rg-destaque' }, el('span', { class: 'rg-num', text: 'DAMAS' }), el('span', { class: 'sec', text: 'regras da damas brasileira' })),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Tabuleiro', '8×8, 12 peças pra cada'),
        C.linhaRegra('Cores', 'sorteadas; na revanche trocam'),
        C.linhaRegra('Começa', 'quem está de brancas'),
        C.linhaRegra('Pedra', 'anda 1 casa na diagonal, pra frente'),
        C.linhaRegra('Captura', 'obrigatória, pra frente e pra trás'),
        C.linhaRegra('Lei da maioria', cfg.maioria_obrigatoria !== false ? 'captura o máximo de peças possível' : 'desligada'),
        C.linhaRegra('Dama', 'chegou no fim do tabuleiro'),
        C.linhaRegra('Dama anda', 'quantas casas quiser (voadora)')),
      C.tituloRegra('RELÓGIO'),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Por jogada', seg % 60 ? `${seg} segundos` : `${seg / 60} ${seg === 60 ? 'minuto' : 'minutos'}`),
        C.linhaRegra('Acabou o tempo', cfg.ao_acabar_tempo === 'perde_vez' ? 'perde a vez (3 seguidas = derrota)' : 'perde a partida'),
        C.linhaRegra('Convite', `vale ${Number(cfg.convite_expira) || 60} segundos`)),
      C.tituloRegra('FIM'),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Vitória', 'tirou todas as peças ou travou o outro'),
        C.linhaRegra('Empate', 'combinado, ou 20 lances seguidos só de damas'),
        C.linhaRegra('Desistir', 'vitória pro outro')),
      C.tituloRegra('ASSISTIR'),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Quem', 'todo mundo do clã, ao vivo'),
        C.linhaRegra('Reações', '1 a cada 1,5 segundo'),
        C.linhaRegra('Ocultar', 'esconde as reações neste aparelho')),
      C.tituloRegra('RANKING'),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Ordem', 'mais vitórias, depois o aproveitamento'),
        C.linhaRegra('Aproveitamento', 'vitórias ÷ partidas')),
    ];
  };

  // ---------- ligações com o app.js ----------
  document.addEventListener('cobr:site', () => { ligar(); });
  document.addEventListener('cobr:sair', desligar);
  document.addEventListener('cobr:rota', () => {
    if (partidaDaUrl() && J.aberta && J.aberta.id !== partidaDaUrl()) J.aberta = null;
    desenhar();
  });
  let esperaOnline;
  document.addEventListener('cobr:online', () => {
    clearTimeout(esperaOnline);
    esperaOnline = setTimeout(() => { if (J.ligado && naSala()) desenharSala(); }, 150);
  });
  // a internet voltou: pega o que mudou enquanto estava fora
  addEventListener('online', () => { if (J.ligado) recarregar(); });
  let voltouEm = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !J.ligado || Date.now() - voltouEm < 3000) return;
    voltouEm = Date.now();
    recarregar();
  });
  if (C.DEMO) desenharDemo();
  else if (C.aberto) ligar();
  // perfil aberto antes deste arquivo carregar: monta de novo, agora com a seção DAMAS
  if (!C.DEMO && C.redesenharPerfil && !document.getElementById('ppDamas')) C.redesenharPerfil();
})();
