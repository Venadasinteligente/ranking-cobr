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
  const COROA = `<svg viewBox="0 0 24 24" stroke-width="1.2" stroke-linejoin="round">${C.ICONE_COROA}</svg>`;

  // ---------- estado ----------
  const POR_PAGINA = 6;
  const CAMPOS = 'id,jogo,status,convidou,convidado,brancas,pretas,estado,versao,prazo,empate_proposto_por,vencedor,motivo,criado_em,inicio,fim';
  const J = {
    ligado: false, carregou: false, rt: null, conectou: false, tique: null,
    lista: new Map(),        // partidas vivas (convite e andamento): id -> linha
    ultimas: [], temMais: false,
    aberta: null,            // a partida aberta em #jogos/<id> (pode já ter acabado)
    cfg: { tempo_jogada: 60, ao_acabar_tempo: 'perde_partida', maioria_obrigatoria: true, convite_expira: 60 },
    desvio: 0,               // relógio do servidor menos o do aparelho (ms)
    pop: null, popId: null,
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
    const [vivas, ult, cfg] = await Promise.all([
      sb.from('jogos_partidas').select(CAMPOS).in('status', ['convite', 'andamento']),
      sb.from('jogos_partidas').select(CAMPOS).eq('status', 'fim').order('fim', { ascending: false }).limit(POR_PAGINA),
      sb.rpc('jogos_cfg'),
    ]);
    if (vivas.error) throw vivas.error;
    J.lista = new Map(vivas.data.map((p) => [p.id, p]));
    if (!ult.error) { J.ultimas = ult.data; J.temMais = ult.data.length === POR_PAGINA; }
    if (!cfg.error && cfg.data) J.cfg = { ...J.cfg, ...cfg.data };
    if (J.aberta && J.lista.has(J.aberta.id)) J.aberta = J.lista.get(J.aberta.id);
    J.carregou = true;
  }
  let recarregando = null;
  function recarregar() {
    if (!J.ligado) return Promise.resolve();
    if (!recarregando) {
      recarregando = carregar()
        .then(async () => {
          // a partida aberta pode ter acabado enquanto o aparelho dormia
          const id = partidaDaUrl();
          if (id && !J.lista.has(id)) await buscarPartida(id);
          desenhar();
        })
        .catch((e) => console.warn('jogos:', e.message))
        .finally(() => { recarregando = null; });
    }
    return recarregando;
  }
  async function buscarPartida(id) {
    const r = await C.sb.from('jogos_partidas').select(CAMPOS).eq('id', id).maybeSingle();
    J.aberta = r.data || null;
    return J.aberta;
  }
  async function maisUltimas(bt) {
    bt.disabled = true;
    const de = J.ultimas.length;
    const r = await C.sb.from('jogos_partidas').select(CAMPOS).eq('status', 'fim').order('fim', { ascending: false }).range(de, de + POR_PAGINA - 1);
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
    const antes = J.lista.get(n.id) || (J.aberta && J.aberta.id === n.id ? J.aberta : null);
    if (n.status === 'convite' || n.status === 'andamento') J.lista.set(n.id, n); else J.lista.delete(n.id);
    if (J.aberta && J.aberta.id === n.id) J.aberta = n;
    if (n.status === 'fim' && !J.ultimas.some((p) => p.id === n.id)) J.ultimas.unshift(n);
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
      J.aberta = null;
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
  function desistir(p) {
    const outro = p.brancas === eu() ? p.pretas : p.brancas;
    C.confirmar('DESISTIR DA PARTIDA?', `A vitória vai pro ${nick(outro)}.`, 'Desistir', async () => {
      try { await rpc('jogos_desistir', { p_partida: p.id }); await buscarPartida(p.id); J.lista.delete(p.id); desenhar(); }
      catch (e) { toast(erroTxt(e), true); recarregar(); }
    });
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
        el('div', { class: 'jg-vivo-info', text: `lance ${p.versao}` }),
        el('button', { type: 'button', class: 'btn btn-pri', onclick: () => C.irPara('#jogos/' + p.id) }, minha ? 'Voltar' : [ico(IC_OLHO, 16), 'Assistir'])),
      lado(p.pretas));
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

  // ---------- partida (por enquanto só olhar; o tabuleiro de tocar vem na fase 5) ----------
  function peca(letra) {
    const s = el('span', { class: `jg-p ${letra.toLowerCase()}` });
    if (letra === 'B' || letra === 'P') s.innerHTML = COROA;
    return s;
  }
  // girar = quem joga de pretas vê o tabuleiro do lado dele (as pretas embaixo)
  function tabuleiro(est, girar) {
    const box = el('div', { class: 'jg-tab' });
    for (let r = 0; r < 8; r++) for (let c = 0; c < 8; c++) {
      const lin = girar ? 7 - r : r, col = girar ? 7 - c : c;
      const i = R.casa(lin, col);
      const cel = el('div', { class: `jg-c ${i < 0 ? 'cl' : 'es'}`, 'data-casa': i < 0 ? null : String(i) });
      if (c === 0) cel.append(el('span', { class: 'crd n', text: String(8 - lin) }));
      if (r === 7) cel.append(el('span', { class: 'crd l', text: 'abcdefgh'[col] }));
      if (i >= 0 && est.tab[i] !== '.') cel.append(peca(est.tab[i]));
      box.append(cel);
    }
    return box;
  }
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
  function maiorCaptura(est) {
    try {
      const l = R.jogadasValidas(est, { maioria: J.cfg.maioria_obrigatoria !== false });
      return l.reduce((m, j) => Math.max(m, j.capturas.length), 0);
    } catch (e) { return 0; }
  }
  function desenharPartida(id) {
    const sec = $('jogos');
    const p = J.lista.get(id) || (J.aberta && J.aberta.id === id ? J.aberta : null);
    if (!p) {
      trocar(sec, el('p', { class: 'jg-vazio', text: 'Carregando a partida…' }));
      buscarPartida(id).then((x) => {
        if (partidaDaUrl() !== id) return;
        if (!x) { toast('Partida não encontrada.', true); C.irPara('#jogos'); return; }
        desenharPartida(id);
      }).catch(() => toast('Não consegui abrir a partida.', true));
      return;
    }
    J.aberta = p;
    // convite (ainda não aceito ou recusado): a partida não existe, volta pra sala
    if (p.status !== 'andamento' && p.status !== 'fim') { C.irPara('#jogos'); return; }
    const meu = eu(), souB = !!meu && p.brancas === meu, souP = !!meu && p.pretas === meu, jogo = souB || souP;
    const est = p.estado || R.estadoInicial();
    const andando = p.status === 'andamento';
    const vez = andando ? est.vez : null;
    const embaixo = souP ? 'p' : 'b', emCima = embaixo === 'b' ? 'p' : 'b';
    const minhaVez = jogo && vez === (souB ? 'b' : 'p');
    let faixa;
    if (andando && minhaVez) {
      const cap = maiorCaptura(est);
      faixa = el('div', { class: 'jg-vez' }, 'SUA VEZ', cap ? el('small', { text: `CAPTURA OBRIGATÓRIA · ${cap} ${cap === 1 ? 'PEÇA' : 'PEÇAS'}` }) : null);
    } else if (andando) {
      faixa = el('div', { class: 'jg-vez dele' }, 'VEZ DE ', el('b', { text: nick(vez === 'b' ? p.brancas : p.pretas) }));
    } else {
      faixa = el('div', { class: 'jg-vez dele' }, !p.vencedor ? 'EMPATE' : jogo ? (p.vencedor === meu ? 'VITÓRIA' : 'DERROTA') : ['VITÓRIA DE ', el('b', { text: nick(p.vencedor) })],
        el('small', { text: (MOTIVO[p.motivo] || 'fim').toUpperCase() }));
    }
    trocar(sec, el('div', { class: 'jg-partida' },
      el('div', { class: 'jg-topo-partida' },
        el('button', { type: 'button', class: 'btn btn-sec', onclick: () => C.irPara('#jogos') }, ico(IC_VOLTAR, 16), 'Sala')),
      barraJogador(p, emCima, est, vez === emCima),
      faixa,
      tabuleiro(est, souP),
      barraJogador(p, embaixo, est, vez === embaixo),
      jogo && andando ? el('div', { class: 'jg-acoes' },
        el('button', { type: 'button', class: 'btn btn-perigo-sec', text: 'Desistir', onclick: () => desistir(p) })) : null,
      !andando ? el('div', { class: 'jg-acoes' },
        el('button', { type: 'button', class: 'btn btn-sec', text: 'Voltar pra sala', onclick: () => C.irPara('#jogos') })) : null));
  }

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
  addEventListener('resize', posicionarPop);
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
    if (C.pag !== 'jogos') return;
    if (!J.ligado) { desenharDemo(); return; }
    const id = partidaDaUrl();
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
    J.lista.clear(); J.ultimas = []; J.aberta = null;
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
  let voltouEm = 0;
  document.addEventListener('visibilitychange', () => {
    if (document.hidden || !J.ligado || Date.now() - voltouEm < 3000) return;
    voltouEm = Date.now();
    recarregar();
  });
  if (C.DEMO) desenharDemo();
  else if (C.aberto) ligar();
})();
