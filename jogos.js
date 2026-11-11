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
  const IC_TELA = '<path d="M4 9V4h5M15 4h5v5M20 15v5h-5M9 20H4v-5"/>';
  const IC_TELA_SAIR = '<path d="M9 4v5H4M20 9h-5V4M15 20v-5h5M4 15h5v5"/>';
  const IC_CONVERSA = '<path d="M21 11.5a8.4 8.4 0 0 1-12.3 7.5L3 20.5l1.5-5.2A8.5 8.5 0 1 1 21 11.5z"/>';
  const IC_ENVIAR = '<path d="M4 12l16-8-6 16-2.5-6.5z"/><path d="M11.5 13.5L20 4"/>';
  const IC_FECHAR = '<path d="M6 6l12 12M18 6L6 18"/>';
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
    // conversa da partida (só os dois jogadores escrevem; quem assiste lê)
    conversa: null,          // { id, msgs, ok, ult, lidas, busca, em } da partida aberta
    cvAberta: false, cvEl: null, falouEm: 0,
    baloes: new Map(),       // player_id -> { texto, k, ate }: balão em cima da barra do jogador
    semConversa: (() => { try { return !!localStorage.getItem('cobr-jogos-sem-conversa'); } catch (e) { return false; } })(),
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
  // iPhone/Safari: o áudio só sai depois de um toque na página. Destrava no primeiro toque
  // (e de novo se o sistema suspender), pra o lance do outro e o convite tocarem som.
  function destravarSom() {
    try {
      if (ac && ac.state === 'running') return;
      ac = ac || new (window.AudioContext || window.webkitAudioContext)();
      if (ac.state !== 'running') ac.resume().catch(() => {});
      const s = ac.createBufferSource();
      s.buffer = ac.createBuffer(1, 1, 22050);
      s.connect(ac.destination);
      s.start(0);
    } catch (e) {}
  }
  addEventListener('touchend', destravarSom, { capture: true, passive: true });
  addEventListener('pointerdown', destravarSom, { capture: true, passive: true });
  addEventListener('keydown', destravarSom, true);
  function tocar(notas) {
    // antes do primeiro toque na página o navegador não deixa tocar: nem tenta
    if (navigator.userActivation && !navigator.userActivation.hasBeenActive) return;
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
    if (n.status === 'fim' && n.fim && C.damasFim) C.damasFim(n); // medalha "Campeão de damas"
  }
  // guarda a versão nova de uma partida; notícia velha (ex.: chegou depois da jogada otimista) fica de fora
  function guardar(n) {
    const atual = linhaDe(n.id);
    if (atual && atual.status === 'fim' && n.status !== 'fim') return false;
    if (atual && atual.status === 'andamento' && n.status === 'andamento' && (n.versao | 0) < (atual.versao | 0)) return false;
    forcar(n);
    return true;
  }

  const PASSO = 420; // ms de cada pulo da peça na animação do lance (o dono pediu mais devagar)
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
  function somLance(capturas, virou) {
    if (J.mudo) return;
    if (!capturas) { tocar(SONS[virou ? 'dama' : 'mover']); return; }
    for (let k = 0; k < capturas; k++) setTimeout(() => tocar([[520 + 70 * k, 0.07], [390 + 70 * k, 0.11]]), k * PASSO + PASSO * 0.5);
    if (virou) setTimeout(() => tocar(SONS.dama), capturas * PASSO + 60);
  }
  const calmo = () => !!(window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches);
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
    if (!v || v.id !== p.id) { J.ult = null; J.anim = null; J.animando = null; J.sel = null; J.verQuem = null; J.fogo = null; limparVoos(); buscarUltimoLance(p); return; }
    if (p.versao === v.versao + 1 && est.tab !== v.tab) {
      if (!J.anim) { // lance do outro (o meu já foi animado na hora)
        const mov = diferenca(v.tab, est.tab, v.vez);
        if (mov) {
          J.ult = { id: p.id, versao: p.versao, de: mov.de, para: mov.para };
          const virou = v.tab[mov.de] !== est.tab[mov.para];
          const j = caminhoDe(v, mov);
          J.anim = { id: p.id, caminho: j ? j.caminho : [mov.de, mov.para], capturas: j ? j.capturas : mov.capturas, virou, tabAntes: v.tab };
          if (virou) fezDama(p, v.vez, mov.para, minhaCor);
          somLance(mov.capturas.length, virou);
        } else J.ult = null;
      }
    } else if (p.versao === v.versao + 1 && est.tab === v.tab && est.vez !== v.vez && p.status === 'andamento') {
      // ninguém mexeu peça: o tempo de quem estava na vez acabou e a vez passou (ao_acabar_tempo = perde_vez)
      J.ult = null;
      toast(v.vez === minhaCor ? 'Seu tempo acabou: a vez passou.' : `Acabou o tempo do ${nick(v.vez === 'b' ? p.brancas : p.pretas)}: a vez passou.`);
    } else if (p.versao > v.versao) { J.ult = null; buscarUltimoLance(p); }
    if (minhaCor && p.status === 'andamento' && p.versao > v.versao && v.vez !== est.vez && est.vez === minhaCor) {
      if (navigator.vibrate) navigator.vibrate(80);
      setTimeout(() => som('vez'), 260 + (J.anim ? (J.anim.caminho.length - 1) * PASSO : 0));
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
  // o caminho do lance do outro (o banco só manda o tabuleiro novo): a jogada válida que bate
  function caminhoDe(v, mov) {
    try {
      return R.jogadasValidas({ tab: v.tab, vez: v.vez, semProgresso: 0 }, opcoes()).find((j) => j.caminho[0] === mov.de && ultima(j.caminho) === mov.para
        && j.capturas.length === mov.capturas.length && mov.capturas.every((c) => j.capturas.includes(c))) || null;
    } catch (e) { return null; }
  }
  // peça deslizando casa por casa (PASSO ms cada pulo); cada capturada encolhe quando a peça passa por ela;
  // virou dama: brilho dourado no fim. Redesenhou no meio (ex.: o servidor confirmou): continua de onde estava.
  function animar(box) {
    if (J.anim) { J.animando = { ...J.anim, t0: performance.now() }; J.anim = null; }
    const a = J.animando;
    if (!a) return;
    const pulos = a.caminho.length - 1, ja = performance.now() - a.t0;
    if (a.id !== partidaDaUrl() || ja > pulos * PASSO + 900) { J.animando = null; return; }
    if (calmo() || !box.animate) return;
    const cel = (i) => box.querySelector(`[data-casa="${i}"]`);
    const cPara = cel(ultima(a.caminho));
    const pc = cPara && cPara.querySelector('.jg-p');
    const rodar = (alvo, quadros, o) => { const x = alvo.animate(quadros, { fill: 'both', ...o }); x.currentTime = ja; return x; };
    if (pc && a.caminho.every((i) => cel(i))) {
      const r2 = cPara.getBoundingClientRect();
      const quadros = a.caminho.map((i) => {
        const r = cel(i).getBoundingClientRect();
        return { transform: `translate(${r.left - r2.left}px, ${r.top - r2.top}px)`, easing: 'cubic-bezier(.3, .1, .3, 1)' };
      });
      pc.style.zIndex = '3';
      rodar(pc, quadros, { duration: pulos * PASSO, fill: 'backwards' }).finished.then(() => { pc.style.zIndex = ''; }).catch(() => {});
      if (a.virou) {
        rodar(pc, [{ scale: 1, filter: 'none' }, { scale: 1.28, filter: 'brightness(1.45) drop-shadow(0 0 12px #FFD84D)', offset: 0.35 }, { scale: 1, filter: 'none' }],
          { duration: 700, delay: pulos * PASSO, easing: 'ease-out', fill: 'none' });
      }
    }
    a.capturas.forEach((i, k) => {
      const c = cel(i), letra = a.tabAntes[i];
      if (!c || !letra || letra === '.') return;
      const f = peca(letra);
      f.classList.add('jg-some');
      c.append(f);
      rodar(f, [{ transform: 'scale(1)', opacity: 1 }, { transform: 'scale(.15)', opacity: 0 }], { duration: 420, delay: k * PASSO + PASSO * 0.5, easing: 'ease-in' })
        .finished.then(() => f.remove()).catch(() => {});
    });
  }
  // tela baixa (iPhone SE, 360×780): o tabuleiro encolhe pra partida inteira caber sem rolar (mínimo 280px)
  // tela deitada (PC, celular deitado): o tabuleiro vai ao lado dos jogadores e o CSS já usa a altura toda
  const LARGO = '(orientation: landscape) and (min-width: 700px)';
  function ajustarTab() {
    const box = document.querySelector('#jogos .jg-partida'), t = box && box.querySelector('.jg-tab');
    if (!t) return;
    t.style.maxWidth = '';
    if (matchMedia(LARGO).matches) return;
    const resto = box.lastElementChild.getBoundingClientRect().bottom + scrollY - t.offsetHeight;
    const fundo = parseFloat(getComputedStyle(box.parentElement).paddingBottom) || 0;
    const cabe = Math.floor(innerHeight - resto - Math.max(4, fundo));
    if (cabe < t.offsetWidth) t.style.maxWidth = `${Math.max(280, cabe)}px`;
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
      // casa por casa: a peça para em cada casa e a comida some na hora; a última casa fecha a jogada
      const proximos = cands.filter((j) => j.caminho.length > pre.length && j.caminho[pre.length] === i);
      if (proximos.length) {
        const fecha = proximos.find((j) => j.caminho.length === pre.length + 1);
        if (fecha) { jogar(p, fecha, pre.length - 1); return; }
        const comida = proximos[0].capturas[pre.length - 1];
        J.anim = { id: p.id, caminho: [ultima(pre), i], capturas: comida == null ? [] : [comida], virou: false, tabAntes: est.tab };
        if (!J.mudo) setTimeout(() => tocar([[520 + 70 * (pre.length - 1), 0.07], [390 + 70 * (pre.length - 1), 0.11]]), PASSO * 0.5);
        J.sel = { ...sel, pre: pre.concat(i) };
        desenharPartida(p.id);
        return;
      }
      // no meio da captura não dá pra trocar de peça nem voltar: tem que continuar comendo
      if (pre.length > 1) { toast('Continue comendo: toque na casa marcada.'); return; }
      if (cands.some((j) => j.caminho.indexOf(i, pre.length + 1) > 0)) { toast('Vá casa por casa: toque na casa marcada.'); return; }
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
  // feito = casas da captura que a peça já andou na tela (a animação continua só dali)
  async function jogar(p, j, feito = 0) {
    let novo;
    try { novo = R.aplicar(p.estado, j.caminho, opcoes()); } catch (e) { toast('Jogada inválida.', true); tremer(); return; }
    const seg = Number(J.cfg.tempo_jogada) || 60;
    const otim = { ...p, estado: novo, versao: p.versao + 1, prazo: new Date(agora() + seg * 1000).toISOString(), empate_proposto_por: null };
    const de = j.caminho[0], para = ultima(j.caminho);
    J.sel = null;
    J.enviando = true;
    J.pendente = otim;
    J.anim = { id: p.id, caminho: j.caminho.slice(feito), capturas: j.capturas.slice(feito), virou: j.viraDama, tabAntes: p.estado.tab };
    J.ult = { id: p.id, versao: otim.versao, de, para };
    somLance(j.capturas.length - feito, j.viraDama);
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
      J.animando = null;
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
    return el('div', { class: `jg-jog ${vez ? 'vez' : ''}`, 'data-jog': id }, C.avatarChat(nick(id), 'av-m'),
      el('div', { class: 'jg-jog-txt' }, el('b', { text: nick(id) }),
        el('small', null, `${cor === 'b' ? 'brancas' : 'pretas'} · ${n} ${n === 1 ? 'peça' : 'peças'}`,
          comeu ? el('span', { class: 'jg-mini', 'aria-label': `${comeu} capturadas` }, Array.from({ length: comeu }, () => el('i', { class: outra === 'p' ? 'es' : 'cl' }))) : null)),
      rel);
  }

  // ---- tela cheia de verdade (some a barra do navegador; Android e PC: o iPhone não deixa) ----
  const telaCheiaPode = () => !!(document.fullscreenEnabled || document.webkitFullscreenEnabled);
  const emTelaCheia = () => !!(document.fullscreenElement || document.webkitFullscreenElement);
  function trocarTelaCheia() {
    try {
      const r = document.documentElement;
      const x = emTelaCheia()
        ? (document.exitFullscreen || document.webkitExitFullscreen).call(document)
        : (r.requestFullscreen || r.webkitRequestFullscreen).call(r, { navigationUI: 'hide' });
      if (x && x.catch) x.catch(() => toast('Não deu pra abrir em tela cheia neste aparelho.', true));
    } catch (e) { toast('Não deu pra abrir em tela cheia neste aparelho.', true); }
  }
  function sairTelaCheia() {
    if (!emTelaCheia()) return;
    try { const x = (document.exitFullscreen || document.webkitExitFullscreen).call(document); if (x && x.catch) x.catch(() => {}); } catch (e) {}
  }
  function botaoTela(b) {
    const em = emTelaCheia();
    b.replaceChildren(ico(em ? IC_TELA_SAIR : IC_TELA));
    b.setAttribute('aria-label', em ? 'Sair da tela cheia' : 'Tela cheia');
    b.setAttribute('aria-pressed', em ? 'true' : 'false');
  }
  for (const ev of ['fullscreenchange', 'webkitfullscreenchange']) {
    document.addEventListener(ev, () => { const b = document.getElementById('jgTela'); if (b) botaoTela(b); });
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
    if (!J.conversa || J.conversa.id !== p.id) buscarConversa(p.id);
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
    // no meio da captura a peça já está parada na casa que tocou e as comidas até ali saíram (só na tela)
    const andou = sel && cands.length ? sel.pre.length - 1 : 0;
    let vis = est;
    if (andou) {
      const t = est.tab.split(''), pc = t[sel.pre[0]];
      t[sel.pre[0]] = '.';
      for (const c of cands[0].capturas.slice(0, andou)) t[c] = '.';
      t[ultima(sel.pre)] = pc;
      vis = { ...est, tab: t.join('') };
    }
    const m = { jogavel: jogaveis.length > 0, ult, fogo, sel: sel ? ultima(sel.pre) : -1, deve: captura && !andou ? origens : new Set(), alvos: new Set(), meios: new Set(), vitimas: new Set(), caminhos: [] };
    // só a próxima casa fica marcada (a captura vai casa por casa, sem pular pra última)
    for (const j of cands) if (j.caminho.length > sel.pre.length) m.alvos.add(j.caminho[sel.pre.length]);
    if (cands.length) {
      for (const c of cands[0].capturas.slice(andou)) if (cands.every((j) => j.capturas.includes(c))) m.vitimas.add(c);
      if (captura) m.caminhos = [...new Set(cands.map((j) => JSON.stringify(j.caminho.slice(andou, andou + 2))))].map((s) => JSON.parse(s));
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
    const tab = tabuleiro(vis, souP, m);
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

    const tela = el('button', { type: 'button', class: 'jg-ico', id: 'jgTela', hidden: !telaCheiaPode(), onclick: trocarTelaCheia });
    botaoTela(tela);
    const cima = barraJogador(p, emCima, est, vez === emCima), baixo = barraJogador(p, embaixo, est, vez === embaixo);
    cima.classList.add('jg-cima');
    baixo.classList.add('jg-baixo');
    trocar(sec, el('div', { class: 'jg-partida' },
      el('div', { class: 'jg-topo-partida' },
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => C.irPara('#jogos') }, ico(IC_VOLTAR, 16), 'Sala'),
        el('button', { type: 'button', class: 'jg-olhos', id: 'jgOlhos', hidden: true, 'aria-controls': 'jgQuem', 'aria-expanded': 'false', onclick: () => { J.verQuem = !verQuem(p); atualizarOlhos(); } }),
        botaoConversa('jg-ico'),
        tela,
        el('button', { type: 'button', class: 'jg-ico', 'aria-label': J.mudo ? 'Ligar o som' : 'Desligar o som', 'aria-pressed': J.mudo ? 'true' : 'false', onclick: trocarMudo }, ico(J.mudo ? IC_MUDO : IC_SOM))),
      el('div', { class: 'jg-quem', id: 'jgQuem', hidden: true }),
      cima,
      faixa,
      tab,
      baixo,
      acoes,
      andando ? barraReacoes() : null));
    pendurarBaloes();
    ajustarTab();
    animar(tab);
    atualizarOlhos();
    desenharFim(p);
    if (J.cvAberta) desenharConversa();
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
      else if (p && conversaViva(p)) quer.set(id, null); // acabou: o canal fica só pro "GG" da conversa chegar na hora
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
      // "fala" só avisa que tem mensagem nova; o texto vem do banco (ninguém fala no nome de outro)
      .on('broadcast', { event: 'fala' }, () => { if (id === partidaDaUrl()) buscarConversa(id); })
      .subscribe((st) => {
        c.ok = st === 'SUBSCRIBED';
        if (c.ok) { c.marcado = false; marcarPresenca(c); } // (re)conectou: marca de novo
        if (c.ok && id === partidaDaUrl() && J.conversa && J.conversa.id === id && J.conversa.ok) buscarConversa(id);
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

  // ---------- conversa da partida ----------
  // os dois jogadores escrevem (texto ou as prontas); quem assiste só lê, assim ninguém sopra jogada.
  // Vale até 10 min depois do fim. O banco filtra palavrão e barra quem está silenciado no chat.
  const PRONTAS = ['Bom jogo! 🤝', 'Boa sorte! 🍀', 'Boa jogada! 👏', 'Uau! 😮', 'Quase! 😬', 'Foi mal 😅', 'Pensa logo! ⏳', 'Valeu! 🙏', 'GG 🏆', 'Revanche? 🔁'];
  const CV_CAMPOS = 'id,partida,player,texto,criado_em';
  const CV_DEPOIS = 10 * 60 * 1000; // a conversa fica aberta 10 min depois do fim
  const CV_MAX = 140;
  const conversaViva = (p) => !!p && (p.status === 'andamento' || (p.status === 'fim' && agora() - ms(p.fim) < CV_DEPOIS));
  const souJogador = (p) => !!eu() && !!p && (p.brancas === eu() || p.pretas === eu());
  const podeFalar = (p) => souJogador(p) && conversaViva(p);
  function conversaDe(id) {
    if (!J.conversa || J.conversa.id !== id) J.conversa = { id, msgs: [], ok: false, ult: 0, lidas: 0, busca: null, denovo: false, em: 0 };
    return J.conversa;
  }
  // primeira vez: as últimas 100; depois só as novas (id maior que a última)
  function buscarConversa(id) {
    if (!J.ligado || !C.sb) return Promise.resolve();
    const cv = conversaDe(id);
    if (cv.busca) { cv.denovo = true; return cv.busca; }
    cv.em = Date.now();
    cv.busca = (async () => {
      const q = C.sb.from('jogos_mensagens').select(CV_CAMPOS).eq('partida', id);
      const r = cv.ok ? await q.gt('id', cv.ult).order('id', { ascending: true }).limit(100)
        : await q.order('id', { ascending: false }).limit(100);
      if (r.error) throw r.error;
      if (J.conversa !== cv) return;
      const primeira = !cv.ok;
      cv.ok = true;
      receberMsgs(cv, primeira ? (r.data || []).slice().reverse() : r.data || [], primeira);
    })()
      .catch((e) => console.warn('conversa:', e.message))
      .finally(() => {
        cv.busca = null;
        if (cv.denovo && J.conversa === cv) { cv.denovo = false; buscarConversa(id); }
      });
    return cv.busca;
  }
  function receberMsgs(cv, lista, primeira = false) {
    const ja = new Set(cv.msgs.map((m) => m.id));
    const novas = lista.filter((m) => m && !ja.has(m.id));
    if (!novas.length) { if (primeira) atualizarConversa(); return; }
    cv.msgs.push(...novas);
    cv.msgs.sort((a, b) => (a.pend ? 1 : 0) - (b.pend ? 1 : 0) || a.id - b.id);
    if (cv.msgs.length > 200) cv.msgs.splice(0, cv.msgs.length - 200);
    for (const m of novas) if (typeof m.id === 'number' && m.id > cv.ult) cv.ult = m.id;
    if (primeira) cv.lidas = cv.ult; // o que já estava lá quando abriu não conta como novidade
    else {
      const deles = novas.filter((m) => m.player !== eu());
      if (deles.length && cv.id === partidaDaUrl() && !J.semConversa) {
        const m = deles[deles.length - 1];
        if (!J.cvAberta) {
          mostrarBalao(m.player, m.texto);
          if (J.fim) toast(`💬 ${nick(m.player)}: ${m.texto}`);
        }
        if (!J.mudo) tocar([[740, 0.06], [988, 0.1]]);
      }
    }
    if (J.cvAberta) cv.lidas = cv.ult;
    atualizarConversa();
  }
  const naoLidas = () => {
    const cv = J.conversa;
    if (!cv || cv.id !== partidaDaUrl() || J.semConversa) return 0;
    return cv.msgs.filter((m) => typeof m.id === 'number' && m.id > cv.lidas && m.player !== eu()).length;
  };
  // o botão 💬 (barra de cima da partida e janela do fim) com o número de mensagens novas
  function botaoConversa(cls) {
    const n = naoLidas();
    return el('button', { type: 'button', class: `${cls} jg-cv-bt${J.semConversa ? ' mudo' : ''}`, 'aria-label': 'Conversa da partida', onclick: abrirConversa },
      ico(IC_CONVERSA, cls === 'jg-ico' ? 18 : 17), cls === 'jg-ico' ? null : 'CONVERSA',
      el('span', { class: 'jg-cv-n', 'data-cv-badge': '', hidden: !n, text: n > 9 ? '9+' : String(n) }));
  }
  function atualizarConversa() {
    const n = naoLidas();
    document.querySelectorAll('[data-cv-badge]').forEach((b) => { b.hidden = !n; b.textContent = n > 9 ? '9+' : String(n); });
    document.querySelectorAll('.jg-cv-bt').forEach((b) => b.classList.toggle('mudo', J.semConversa));
    if (J.cvAberta) desenharConversa();
  }

  // balão em cima (ou embaixo) da barra de quem falou, some sozinho
  function mostrarBalao(pid, texto) {
    if (J.semConversa) return;
    const k = Date.now() + Math.random();
    J.baloes.set(pid, { texto, k, ate: Date.now() + 4500 });
    const b = document.querySelector(`#jogos .jg-jog[data-jog="${pid}"]`);
    if (b) { b.querySelectorAll('.jg-balao').forEach((x) => x.remove()); b.append(el('div', { class: 'jg-balao', 'aria-hidden': 'true' }, el('span', { text: texto }))); }
    setTimeout(() => {
      const x = J.baloes.get(pid);
      if (!x || x.k !== k) return;
      J.baloes.delete(pid);
      document.querySelectorAll(`#jogos .jg-jog[data-jog="${pid}"] .jg-balao`).forEach((n) => { n.classList.add('sai'); setTimeout(() => n.remove(), 260); });
    }, 4500);
  }
  function tirarBalao(pid) {
    J.baloes.delete(pid);
    document.querySelectorAll(`#jogos .jg-jog[data-jog="${pid}"] .jg-balao`).forEach((n) => n.remove());
  }
  // a barra foi desenhada de novo: o balão que ainda vale volta (sem animar de novo)
  function pendurarBaloes() {
    if (J.semConversa) return;
    for (const [pid, x] of J.baloes) {
      if (x.ate < Date.now()) continue;
      const b = document.querySelector(`#jogos .jg-jog[data-jog="${pid}"]`);
      if (b && !b.querySelector('.jg-balao')) b.append(el('div', { class: 'jg-balao ja', 'aria-hidden': 'true' }, el('span', { text: x.texto })));
    }
  }

  // o painel da conversa (sobe de baixo)
  function abrirConversa() {
    const id = partidaDaUrl();
    if (!id) return;
    J.cvAberta = true;
    if (!J.conversa || J.conversa.id !== id) buscarConversa(id);
    desenharConversa(true);
  }
  function fecharConversa() {
    J.cvAberta = false;
    if (J.cvEl) { J.cvEl.remove(); J.cvEl = null; }
    atualizarConversa();
  }
  function trocarSemConversa() {
    J.semConversa = !J.semConversa;
    try { localStorage.setItem('cobr-jogos-sem-conversa', J.semConversa ? '1' : ''); } catch (e) {}
    if (J.semConversa) for (const pid of [...J.baloes.keys()]) tirarBalao(pid);
    if (J.cvEl) { J.cvEl.remove(); J.cvEl = null; } // monta de novo com o botão trocado
    atualizarConversa();
  }
  const horaCv = (iso) => new Date(iso).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  function desenharConversa(focar = false) {
    const id = partidaDaUrl(), p = id && linhaDe(id);
    if (!J.cvAberta || !p) { if (J.cvEl) { J.cvEl.remove(); J.cvEl = null; } J.cvAberta = false; return; }
    const cv = conversaDe(id);
    cv.lidas = Math.max(cv.lidas, cv.ult);
    document.querySelectorAll('[data-cv-badge]').forEach((b) => { b.hidden = true; });
    if (!J.cvEl) {
      const lista = el('div', { class: 'jg-cv-lista', role: 'log', 'aria-live': 'polite' });
      const pe = el('div', { class: 'jg-cv-pe' });
      const caixa = el('div', { class: 'jg-cv', role: 'dialog', 'aria-modal': 'true', 'aria-label': 'Conversa da partida' },
        el('div', { class: 'jg-cv-cab' },
          ico(IC_CONVERSA, 18),
          el('div', { class: 'jg-cv-tit' }, el('b', { text: 'CONVERSA' }), el('small', { text: `${nick(p.brancas)} × ${nick(p.pretas)}` })),
          el('button', { type: 'button', class: 'jg-esconder', 'aria-pressed': J.semConversa ? 'true' : 'false', onclick: trocarSemConversa, text: J.semConversa ? 'LIGAR AVISOS' : 'SILENCIAR' }),
          el('button', { type: 'button', class: 'jg-ico', 'aria-label': 'Fechar a conversa', onclick: fecharConversa }, ico(IC_FECHAR, 18))),
        lista, pe);
      const fundo = el('div', { class: 'jg-cv-fundo' }, caixa);
      fundo.addEventListener('click', (e) => { if (e.target === fundo) fecharConversa(); });
      document.body.append(fundo);
      J.cvEl = fundo;
      J.cvEl._lista = lista; J.cvEl._pe = pe; J.cvEl._tipo = null;
      encaixarCv();
    }
    // as mensagens
    const lista = J.cvEl._lista;
    const noFim = lista.scrollHeight - lista.scrollTop - lista.clientHeight < 40;
    const jogo = souJogador(p), direita = jogo ? eu() : p.brancas; // quem assiste: brancas na direita
    if (!cv.ok) trocar(lista, el('p', { class: 'jg-cv-vazio', text: 'Carregando…' }));
    else if (!cv.msgs.length) trocar(lista, el('p', { class: 'jg-cv-vazio', text: podeFalar(p) ? 'Ninguém falou nada ainda. Manda um “Bom jogo!” 🤝' : 'Ninguém falou nada nesta partida.' }));
    else {
      trocar(lista, cv.msgs.map((m, i) => {
        const dir = m.player === direita, minha = m.player === eu(), ant = cv.msgs[i - 1], cont = ant && ant.player === m.player;
        const cor = m.player === p.brancas ? 'b' : 'p';
        return el('div', { class: `jg-cv-m${dir ? ' dir' : ''}${minha ? ' eu' : ''}${cont ? ' cont' : ''}${m.pend ? ' pend' : ''}` },
          minha ? null : el('span', { class: 'jg-cv-av' }, cont ? null : C.avatarChat(nick(m.player), 'av-p')),
          el('div', { class: 'jg-cv-bolha' },
            cont || jogo ? null : el('b', null, el('i', { class: `jg-cv-cor ${cor}` }), nick(m.player)),
            el('span', { class: 'jg-cv-txt', text: m.texto }),
            el('small', { text: m.pend ? 'enviando…' : horaCv(m.criado_em) })));
      }));
    }
    if (noFim || focar || (cv.msgs.length && cv.msgs[cv.msgs.length - 1].player === eu())) lista.scrollTop = lista.scrollHeight;
    // o rodapé: escrever (jogador), só ler (quem assiste) ou encerrada
    const tipo = tipoConversa(p);
    const pe = J.cvEl._pe;
    if (J.cvEl._tipo !== tipo) {
      J.cvEl._tipo = tipo;
      if (tipo === 'fala') {
        const inp = el('input', { type: 'text', maxlength: String(CV_MAX), placeholder: 'Mensagem…', 'aria-label': 'Mensagem', enterkeyhint: 'send', autocomplete: 'off' });
        trocar(pe,
          el('div', { class: 'jg-cv-prontas', role: 'group', 'aria-label': 'Mensagens prontas' },
            PRONTAS.map((t) => el('button', { type: 'button', text: t, onclick: () => falar(t, true) }))),
          el('form', { class: 'jg-cv-form', onsubmit: (e) => { e.preventDefault(); falar(inp.value); } },
            inp, el('button', { type: 'submit', class: 'btn btn-pri', 'aria-label': 'Enviar' }, ico(IC_ENVIAR, 18))),
          el('small', { class: 'jg-cv-nota', text: '👀 Quem assiste também lê' }));
        if (focar && matchMedia('(hover: hover)').matches) setTimeout(() => inp.focus(), 50); // no celular o teclado não sobe sozinho
      } else {
        trocar(pe, el('p', { class: 'jg-cv-nota so', text: tipo === 'le' ? '👀 Só quem está jogando escreve aqui' : 'Conversa encerrada' }));
      }
    }
  }
  const tipoConversa = (p) => (podeFalar(p) ? 'fala' : souJogador(p) ? 'fechou' : 'le');
  async function falar(texto, pronta = false) {
    const id = partidaDaUrl(), p = id && linhaDe(id);
    const t = String(texto || '').replace(/\s+/g, ' ').trim().slice(0, CV_MAX);
    if (!p || !t || !podeFalar(p)) return;
    if (Date.now() - J.falouEm < 1100) { toast('Calma, uma mensagem por vez.', true); return; }
    J.falouEm = Date.now();
    const cv = conversaDe(id);
    const tmp = { id: 'tmp-' + J.falouEm, partida: id, player: eu(), texto: t, criado_em: new Date(agora()).toISOString(), pend: true };
    cv.msgs.push(tmp);
    const inp = J.cvEl && J.cvEl.querySelector('.jg-cv-form input');
    if (!pronta && inp) inp.value = '';
    if (pronta) fecharConversa(); else desenharConversa();
    mostrarBalao(eu(), t);
    try {
      const { data, error } = await C.sb.rpc('jogos_falar', { p_partida: id, p_texto: t });
      if (error) throw error;
      cv.msgs = cv.msgs.filter((m) => m !== tmp);
      const m = { id: Number(data.id), partida: id, player: eu(), texto: data.texto, criado_em: data.criado_em };
      if (m.texto !== t && J.baloes.has(eu())) mostrarBalao(eu(), m.texto); // o filtro trocou palavrão por ***
      receberMsgs(cv, [m]);
      const c = J.canais.get(id);
      if (c && c.ok) Promise.resolve(c.ch.send({ type: 'broadcast', event: 'fala', payload: {} })).catch(() => {});
    } catch (e) {
      cv.msgs = cv.msgs.filter((m) => m !== tmp);
      tirarBalao(eu());
      const i = J.cvEl && J.cvEl.querySelector('.jg-cv-form input');
      if (!pronta && i && !i.value) i.value = t;
      const msg = erroTxt(e);
      toast(/silenciado/i.test(msg) ? 'Você está silenciado no chat: não dá pra mandar mensagem.' : msg, true);
      atualizarConversa();
    }
  }
  // teclado do celular aberto: o painel fica na parte que sobra da tela (a caixa de escrever não some atrás dele)
  function encaixarCv() {
    const v = window.visualViewport;
    if (!J.cvEl || !v) return;
    J.cvEl.style.top = `${Math.round(v.offsetTop)}px`;
    J.cvEl.style.height = `${Math.round(v.height)}px`;
    J.cvEl.style.bottom = 'auto';
  }
  if (window.visualViewport) { visualViewport.addEventListener('resize', encaixarCv); visualViewport.addEventListener('scroll', encaixarCv); }
  addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && J.cvAberta) { e.stopPropagation(); fecharConversa(); }
  }, true);
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
    if (calmo()) return [];
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
      jogo ? botaoConversa('btn btn-sec btn-grande') : null,
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
  addEventListener('resize', () => { posicionarPop(); ajustarTab(); posVoos(); });
  // o que fica em cima/dentro da partida muda de altura sem redesenhar (faixa de quem assiste, cabeçalho): mede de novo
  if (window.ResizeObserver) {
    let rq = 0;
    new ResizeObserver(() => { if (!rq) rq = requestAnimationFrame(() => { rq = 0; ajustarTab(); posVoos(); }); }).observe(document.body);
  }
  document.addEventListener('transitionend', (e) => { if (e.target.closest && e.target.closest('.topo')) posicionarPop(); });

  function desenharBadge() {
    const n = J.ligado && !naSala() ? convitesRecebidos().length : 0; // na sala o convite já está na tela
    document.querySelectorAll('[data-badge-jogos]').forEach((b) => { b.hidden = !n; b.textContent = String(n); });
  }

  // ---------- tudo ----------
  function desenhar() {
    // partida aberta = imersão: o site some (topo, menu, rodapé, barra de baixo) e fica só a damas
    const imerso = J.ligado && !!partidaDaUrl();
    if (imerso && !document.body.classList.contains('jg-em-partida')) scrollTo(0, 0);
    document.body.classList.toggle('jg-em-partida', imerso);
    if (!imerso) sairTelaCheia();
    desenharBadge();
    desenharPop();
    const minha = minhaPartida();
    C.marcarJogando(minha ? minha.id : null);
    const id = partidaDaUrl();
    if (!id) { fecharFim(); J.assin = null; J.sel = null; limparVoos(); }
    if (!id || (J.conversa && J.conversa.id !== id)) { if (J.cvAberta) fecharConversa(); J.conversa = null; J.baloes.clear(); }
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
    const cv = id && J.conversa;
    if (cv && cv.id === id && cv.ok && p && conversaViva(p) && !document.hidden && Date.now() - cv.em > 15000) buscarConversa(id);
    if (J.cvAberta && J.cvEl && p && tipoConversa(p) !== J.cvEl._tipo) desenharConversa();
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
    J.sel = null; J.ctx = null; J.visto = null; J.ult = null; J.anim = null; J.animando = null; J.assin = null; J.pendente = null; J.fimInfo = null;
    sincronizarCanais(); J.recebidas.clear(); J.fogo = null; J.verQuem = null;
    if (J.cvAberta) fecharConversa(); J.conversa = null; J.baloes.clear();
    limparVoos();
    fecharFim();
    if (J.pop) { J.pop.remove(); J.pop = null; J.popId = null; }
    document.body.classList.remove('jg-em-partida');
    sairTelaCheia();
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
      C.tituloRegra('CONVERSA'),
      el('ul', { class: 'rg-lista' },
        C.linhaRegra('Quem escreve', 'só os 2 jogadores'),
        C.linhaRegra('Quem assiste', 'lê, mas não escreve'),
        C.linhaRegra('Prontas', '“Bom jogo!”, “GG”… com 1 toque'),
        C.linhaRegra('Depois do fim', 'fica aberta mais 10 minutos'),
        C.linhaRegra('Silenciar', 'tira os balões e o som neste aparelho')),
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
