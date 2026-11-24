// @ts-check
// THE SERVER is the only one that decides who hears whom. It decodes nothing, keeps nothing and records nothing: it receives
// an opaque audio packet (bytes) and, for each person who CAN hear, relays the same packet with the name and position
// of whoever spoke. In order, the questions it asks before relaying a byte:
//
//   1. is the game rule `voz_proximidade:voz` on in this world?         (if not: nothing goes out)
//   2. is the speaker muted by moderation (`player.muted`)?              (if so: nothing goes out — the chat mute applies here)
//   3. who is nearby, in the SAME dimension and out of a match?          (ctx.server.playersNear, the radius is the rule)
//   4. does that listener ignore the speaker (`/ignorar`) or mute in the mod?  (then they do not receive)
//   5. does some other mod veto that pair?                               (the service filter, below)
//   6. is their channel open on the same version (`canSend`)?            (if not there is nowhere to send)
//
// The MAX_OUVINTES cap closes the bandwidth budget: in a crowd, one voice is relayed to the twelve nearest
// people, and not to the forty that are within the radius.
import { CommandType } from './mineclaude-sdk.js';
import { declareChannels, MAX_OUVINTES, RAIO_PADRAO, RAIO_MAX } from './channels.ts';

const CACHE_MS = 200; // how long the list of "who is near the speaker" is reused
const FALANDO_MS = 700; // without a packet for that time, the person stopped speaking (the HUD indicator goes out)

class ComandoVoz extends CommandType {
  declare api: any;
  help = '/voz — abre as opções da voz por proximidade (ou `/voz raio <blocos>` para um admin)';
  /** @param {any} e */
  run(e) {
    const api = /** @type {any} */ (this).api;
    const arg = String(e.args?.[0] ?? '').toLowerCase();
    if (arg === 'raio') {
      if (!e.player.isAdmin) return e.reply('voz: só um admin muda o raio (ou use /gamerule voz_proximidade:raio)');
      const n = Number(e.args?.[1]);
      if (!Number.isInteger(n) || n < 4 || n > RAIO_MAX) return e.reply(`voz: o raio vai de 4 a ${RAIO_MAX} blocos`);
      e.server.rules.set('voz_proximidade:raio', n);
      return e.reply(`voz: alcance agora é de ${n} blocos`);
    }
    if (arg === 'estado') return e.reply(api.resumo(e.player));
    const ok = e.player.openScreen('voz_proximidade:voz');
    e.reply(ok ? 'voz: opções abertas' : `voz: não deu para abrir a tela — ${api.resumo(e.player)}`);
  }
}

/** @param {any} ctx */
export default function register(ctx) {
  const { fala, ouve, ajuste, estado } = declareChannels(ctx);

  /** What each player asked for and what they are doing, by name (never persisted: it is session state). */
  const porJogador = new Map(); // nome -> { silenciados: Set<string>, falandoEm: number, cache: { at, lista }, visto: string }
  const dados = (nome) => {
    let d = porJogador.get(nome);
    if (!d) porJogador.set(nome, (d = { silenciados: new Set(), falandoEm: 0, cache: null, visto: '' }));
    return d;
  };

  const ligada = () => ctx.rules.get('voz') !== false;
  const raio = () => { const r = ctx.rules.get('raio'); return Number.isInteger(r) && r > 0 ? r : RAIO_PADRAO; };

  // ---- The hook for other mods (ctx.services): no minigame logic lives here.
  // `filter` is the CANCELLABLE event: a minigame mod receives the pair (speaker, would-be listener) and returns false, or
  // calls e.cancel(), to silence a pair — "only my team hears each other" is a three-line filter in the game's mod.
  // `listeners` is the other half: whoever is IN A MATCH does not appear in ctx.server.playersNear (a room is a place
  // apart), so whoever wants voice inside the room says who its listeners are.
  const filtros = [];
  const provedores = [];
  const serviceApi = {
    /** filter(fn): fn({ from, to, distance, radius, room, cancel() }) -> false/cancel() silences that pair. */
    filter(fn) {
      if (typeof fn !== 'function') throw new Error('voz.filter precisa de uma função');
      if (filtros.length >= 8) throw new Error('voz.filter: no máximo 8 filtros');
      filtros.push(fn);
    },
    /** listeners(fn): fn({ from, room, radius }) -> the list of who can hear someone that is in a match. */
    listeners(fn) {
      if (typeof fn !== 'function') throw new Error('voz.listeners precisa de uma função');
      if (provedores.length >= 4) throw new Error('voz.listeners: no máximo 4 provedores');
      provedores.push(fn);
    },
    /** The state in one line, for another mod (or `/voz estado`) to show. */
    resumo(player) {
      const d = porJogador.get(player?.name);
      return `voz ${ligada() ? 'ligada' : 'desligada'}, raio ${raio()} blocos, canal ${player && ouve.canSend(player) ? 'aberto' : 'fechado'}${d?.silenciados.size ? `, ${d.silenciados.size} silenciado(s)` : ''}`;
    },
    // Methods, not getters: a published service's table refuses getters (docs/sdk-services.md).
    enabled: () => ligada(),
    radius: () => raio(),
  };
  ctx.services.provide('voz', 1, serviceApi);

  /** Runs other mods' filters for a pair. A filter that throws is logged and silences nobody. */
  const permitido = (from, to, distance, room) => {
    for (const fn of filtros) {
      const e = { from, to, distance, radius: raio(), room, cancelled: false, cancel() { this.cancelled = true; } };
      let r;
      try { r = fn(e); } catch (err) { console.error(`[voz_proximidade] filtro de outro mod estourou: ${err?.message ?? err}`); continue; }
      if (e.cancelled || r === false) return false;
    }
    return true;
  };

  /** Who can hear `player` now: those nearby in the world, or what the providers say from inside the room. */
  function ouvintes(player) {
    const r = raio();
    const room = player.room;
    if (room && room !== 'mundo') {
      const out = [];
      for (const fn of provedores) {
        let lista;
        try { lista = fn({ from: player, room, radius: r }); } catch (err) { console.error(`[voz_proximidade] listeners de outro mod estourou: ${err?.message ?? err}`); continue; }
        if (Array.isArray(lista)) for (const p of lista) if (p && typeof p === 'object' && typeof p.name === 'string') out.push(p);
      }
      return out;
    }
    return ctx.server.playersNear(player, r);
  }

  /** The speaker's listeners, reused for CACHE_MS: 17 packets per second do not need 17 scans. */
  function listaDeOuvintes(player, agora) {
    const d = dados(player.name);
    if (d.cache && agora - d.cache.at < CACHE_MS) return d.cache.lista;
    const lista = ouvintes(player).filter((p) => p.name !== player.name);
    // The nearest first, and only the first MAX_OUVINTES: it is the bandwidth budget's cap.
    const pos = player.pos;
    lista.sort((a, b) => dist2(a.pos, pos) - dist2(b.pos, pos));
    d.cache = { at: agora, lista: lista.slice(0, MAX_OUVINTES) };
    return d.cache.lista;
  }
  const dist2 = (a, b) => (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;

  // ---- The relay.
  fala.on((player, data) => {
    const agora = Date.now();
    if (!ligada()) return;
    // The moderation mute applies to voice too: whoever cannot write in chat cannot speak in the ear.
    if (player.muted) return;
    if (!data.q.length) return;
    const d = dados(player.name);
    d.falandoEm = agora;
    const pos = player.pos;
    const room = player.room;
    for (const ouvinte of listaDeOuvintes(player, agora)) {
      if (ouvinte.ignores(player)) continue; // the game's /ignorar
      if (dados(ouvinte.name).silenciados.has(player.name.toLowerCase())) continue; // muted only by this listener
      const distancia = Math.sqrt(dist2(ouvinte.pos, pos));
      if (!permitido(player, ouvinte, distancia, room)) continue;
      if (!ouve.canSend(ouvinte)) continue;
      ouve.send(ouvinte, { de: player.name.slice(0, 16), seq: data.seq, q: data.q, x: pos.x, y: pos.y, z: pos.z });
    }
  });

  ajuste.on((player, data) => {
    const d = dados(player.name);
    if (data.silenciar) {
      d.silenciados.clear();
      for (const nome of data.silenciar) d.silenciados.add(nome.toLowerCase());
    }
    if (data.falando === false) { d.falandoEm = 0; d.cache = null; }
  });

  // The state goes on the channel's opening (the browser needs to know why the microphone does not turn on) and after that only when
  // something the player sees CHANGES: the rule, the radius or the list of who is speaking near them.
  const quadroDe = (player) => {
    const agora = Date.now();
    const falando = [];
    if (ligada()) {
      for (const p of ctx.server.playersNear(player, raio())) {
        if (p.name === player.name) continue;
        if (agora - (porJogador.get(p.name)?.falandoEm ?? 0) < FALANDO_MS) falando.push(p.name.slice(0, 16));
      }
    }
    falando.sort();
    return { ligada: ligada(), raio: raio(), falando: falando.slice(0, 16), ...(ligada() ? {} : { motivo: 'a regra voz_proximidade:voz está desligada neste servidor' }) };
  };

  estado.onOpen((player) => { dados(player.name); estado.send(player, quadroDe(player)); });
  estado.onClose((player) => porJogador.delete(player.name));

  let tick = 0;
  ctx.events.on('serverTick', () => {
    if (++tick % 10) return; // twice per second: enough for a HUD indicator
    for (const player of ctx.server.players()) {
      if (!estado.canSend(player)) continue;
      const quadro = quadroDe(player);
      const chave = `${quadro.ligada}|${quadro.raio}|${quadro.falando.join(',')}`;
      const d = dados(player.name);
      if (d.visto === chave) continue;
      d.visto = chave;
      estado.send(player, quadro);
    }
  });

  const comando = new ComandoVoz();
  /** @type {any} */ (comando).api = serviceApi;
  ctx.commands.register('voz', comando);
}
