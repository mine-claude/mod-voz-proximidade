// Generated from settings.ts by "sdk check"/"sdk build": edit the .ts, not this file.
// @ts-check
// What this BROWSER remembers about the voice. Everything the player chooses in the options screen lives here, and
// nothing of it goes to the server: the microphone, the gain, the volume of each person — all of it is a decision
// about THIS machine's ears and microphone, and the server has no business knowing it (the one exception is the mute
// list, which the server gets so it stops spending bandwidth on a voice nobody will hear).
//
// Where it is saved: `localStorage`, under one key, like the game's own options and like the fog of the base mod
// (`mods/mineclaude/atmosphere/gas-fog-client.ts`). The mod does not get a per-browser storage from the SDK —
// `ctx.storage` is the server's and `ctx.config` on the browser only reads the mod.json defaults — so one key with
// one JSON is the honest way, and every read and write is wrapped: in a private window `localStorage` throws, and
// losing the settings must never cost the voice.
//
// EVERY value that comes back from the disk is clamped here (`normalizar`). A saved file is player-editable data
// like any other: a gain of 10000 or a `pessoas` with 50 thousand names cannot reach the audio graph.
/** The one key in localStorage. Namespaced by the mod id, as everything of a mod is. */
export const CHAVE = 'voz_proximidade:ajustes';
export const GANHO_MAX = 3; // 300%: the engine's own cap (MEDIA_GAIN.max)
export const PESSOA_MAX = 2; // 200% per person
export const LIMIAR_MAX = 0.5; // the voice-activation threshold of open mic, as a fraction of the meter
export const MAX_PESSOAS = 64; // how many people's volume is remembered (the oldest fall off the end)
export const MAX_NOME = 16; // a player's name, as the protocol limits it
/** The settings of someone who never opened the screen. They are also what "Restaurar padrão" goes back to. */
export const PADROES = Object.freeze({
    micLigado: false, // the switch: while it is false, no key opens a microphone
    modo: 'aperta', // 'aperta' (push to talk) or 'aberta' (open mic)
    aparelho: null, // the deviceId the player chose, or null = whatever the browser opens
    ganho: 1, // 0..GANHO_MAX, applied before the encoder
    limiar: 0, // open mic only: 0 = always on the air, which is what "open mic" meant before this existed
    volume: 1, // everyone's volume, 0..1
    surdo: false, // hear nobody
    supressao: true, // the browser's noise suppression
    eco: true, // echo cancellation
    ganhoAuto: true, // automatic gain control
    aba: 'mic', // the tab the screen opens on
    pessoas: Object.freeze({}), // lowercase name -> { v: 0..PESSOA_MAX, mudo: boolean }
});
const MODOS = ['aperta', 'aberta'];
const ABAS = ['mic', 'ouvir', 'perto'];
const num = (v, lo, hi, def) => (Number.isFinite(+v) ? Math.min(hi, Math.max(lo, +v)) : def);
const bool = (v, def) => (typeof v === 'boolean' ? v : def);
const texto = (v, max, def) => (typeof v === 'string' && v.length <= max ? v : def);
/** The store this module writes to. `null` (a private window, a host with no localStorage) is not an error. */
function loja() {
    try {
        return globalThis.localStorage ?? null;
    }
    catch {
        return null;
    } // a browser that refuses the whole API
}
/**
 * One person's entry, clamped. The volume goes up to 200% and the mute is separate from a volume of zero on
 * purpose: a muted person comes back at the volume they had, not at zero.
 */
function pessoa(bruto) {
    if (!bruto || typeof bruto !== 'object')
        return null;
    return { v: num(bruto.v, 0, PESSOA_MAX, 1), mudo: bool(bruto.mudo, false) };
}
/** Anything that came from the disk (or from another version of this mod) turned into settings this mod can use. */
export function normalizar(bruto) {
    const b = bruto && typeof bruto === 'object' && !Array.isArray(bruto) ? bruto : {};
    const pessoas = {};
    const entradas = b.pessoas && typeof b.pessoas === 'object' && !Array.isArray(b.pessoas) ? Object.entries(b.pessoas) : [];
    for (const [nome, valor] of entradas.slice(0, MAX_PESSOAS)) {
        if (typeof nome !== 'string' || !nome || nome.length > MAX_NOME)
            continue;
        const p = pessoa(valor);
        if (!p)
            continue;
        if (p.v === 1 && !p.mudo)
            continue; // nothing to remember about someone who is at the default
        pessoas[nome.toLowerCase()] = p;
    }
    return {
        micLigado: bool(b.micLigado, PADROES.micLigado),
        modo: MODOS.includes(b.modo) ? b.modo : PADROES.modo,
        aparelho: texto(b.aparelho, 128, PADROES.aparelho),
        ganho: num(b.ganho, 0, GANHO_MAX, PADROES.ganho),
        limiar: num(b.limiar, 0, LIMIAR_MAX, PADROES.limiar),
        volume: num(b.volume, 0, 1, PADROES.volume),
        surdo: bool(b.surdo, PADROES.surdo),
        supressao: bool(b.supressao, PADROES.supressao),
        eco: bool(b.eco, PADROES.eco),
        ganhoAuto: bool(b.ganhoAuto, PADROES.ganhoAuto),
        aba: ABAS.includes(b.aba) ? b.aba : PADROES.aba,
        pessoas,
    };
}
/** Reads the settings of this browser. A missing, broken or hostile file gives the defaults, never an exception. */
export function carregar(store = loja()) {
    let bruto = null;
    try {
        bruto = JSON.parse(store?.getItem(CHAVE) ?? 'null');
    }
    catch { /* no storage, or not JSON */ }
    return normalizar(bruto);
}
/**
 * Writes them back. Called on every change (it is one small JSON, and a voice option changed is a rare event), and
 * it never throws: a browser that refuses to save is a browser where the settings last for the session, not one
 * where the voice stops working.
 */
export function salvar(ajustes, store = loja()) {
    try {
        store?.setItem(CHAVE, JSON.stringify(normalizar(ajustes)));
        return true;
    }
    catch {
        return false;
    }
}
/**
 * The settings as the mod's live state uses them: the maps are a Map and a Set, because that is what `playback` and
 * `index` already read every frame.
 */
export function paraEstado(ajustes) {
    const volumes = new Map();
    const silenciados = new Set();
    for (const [nome, p] of Object.entries(ajustes.pessoas)) {
        if (p.v !== 1)
            volumes.set(nome, p.v);
        if (p.mudo)
            silenciados.add(nome);
    }
    return { volumes, silenciados };
}
/** And back: the live state turned into what goes to the disk. */
export function deEstado(estado) {
    const pessoas = {};
    for (const [nome, v] of estado.volumes)
        if (v !== 1)
            pessoas[nome] = { v, mudo: estado.silenciados.has(nome) };
    for (const nome of estado.silenciados)
        pessoas[nome] = { v: pessoas[nome]?.v ?? 1, mudo: true };
    return {
        micLigado: estado.micLigado, modo: estado.modo, aparelho: estado.aparelho, ganho: estado.ganho,
        limiar: estado.limiar, volume: estado.volume, surdo: estado.surdo, supressao: estado.supressao,
        eco: estado.eco, ganhoAuto: estado.ganhoAuto, aba: estado.aba, pessoas,
    };
}
