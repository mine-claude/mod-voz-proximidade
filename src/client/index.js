// Generated from index.ts by "sdk check"/"sdk build": edit the .ts, not this file.
// @ts-check
// The browser entry: wires up the capture, the playback, the HUD indicator, the options (three doors to the same
// screen) and the two input actions.
//
// WHAT IS LOCAL AND WHAT IS NOT. Everything the player chooses here is about THIS machine's ears and microphone — the
// device, the gain, the volume of each person — and none of it goes to the server. The one exception is the mute
// list, and that is bandwidth, not trust: the server stops sending a voice nobody will listen to. What is local is
// also REMEMBERED in this browser (`client/settings.ts`), which is the whole point of having a screen: an option the
// player sets every time they open the game is not an option, it is a chore.
//
// THREE DOORS, ONE SCREEN:
//   Esc → Voz   a page of the pause (`ctx.ui.gui.pausePage`), next to Opções, Atalhos and Regras — where a player
//               looks for an option, and the only door that works while the game is paused.
//   a KEY       the `opcoes` action (J by default) opens the same controls as a modal menu of the mod, without
//               leaving the game, and the touch button ⚙ does it with a finger.
//   /voz        the screen type the SERVER opens (`player.openScreen`), which is how it already worked.
// All three draw the same body (`client/screen.ts`).
import { declareChannels } from '../channels.ts';
import { criarCaptura } from './capture.ts';
import { criarPlayback } from './playback.ts';
import { registrarHud } from './hud.ts';
import { criarTelaVoz, criarPaginaVoz, criarMenuVoz } from './screen.ts';
import { carregar, salvar, paraEstado, deEstado } from './settings.ts';
import { criarAparelhos } from './devices.ts';
/** `KeyJ` -> `J`, `Digit4` -> `4`, `ArrowUp` -> `Up`: what to write on a screen about a key. */
const nomeDaTecla = (code) => (code ? code.replace(/^(Key|Digit|Arrow)/, '') : 'sem tecla');
/** @param {any} ctx */
export default function registerClient(ctx) {
    const canais = declareChannels(ctx);
    const ajustes = carregar(); // what this browser remembered from the last time
    const { volumes, silenciados } = paraEstado(ajustes);
    const estado = {
        ligada: false, // what the server's game rule said
        raio: 32,
        motivo: null,
        falando: /** @type {string[]} */ ([]), // who the server says is speaking near me
        nivel: 0,
        recado: null, // the mod's OWN notice in the screen (a device that went away), newer than the server's reason
        // ---- the player's settings, loaded from this browser (client/settings.ts) ----
        micLigado: ajustes.micLigado, // the screen's switch: while it is false, the key opens no microphone
        modo: ajustes.modo, // 'aperta' (push to talk) or 'aberta' (open mic, with the threshold below)
        aparelho: ajustes.aparelho, // the deviceId the player chose, or null = the browser's default
        ganho: ajustes.ganho, // 0..3, applied before the encoder
        limiar: ajustes.limiar, // open mic: the level the voice opens above (0 = always on the air)
        volume: ajustes.volume, // everyone's volume
        surdo: ajustes.surdo,
        supressao: ajustes.supressao, eco: ajustes.eco, ganhoAuto: ajustes.ganhoAuto, // the browser's cleanups
        aba: ajustes.aba, // the tab the screen opens on
        volumes, // lowercase name -> volume (0..2), per person
        silenciados, // lowercase name
        aviso(texto) {
            console.warn(`[voz_proximidade] ${texto}`);
            // One line in the HUD, replaced (not stacked): a microphone problem is a state, not a history.
            if (linha)
                linha.set(texto);
            else
                linha = ctx.ui.hud({ id: 'voz_aviso', text: texto, corner: 'top-right' });
        },
    };
    let linha = null;
    /** Writes the settings back to this browser. Called on every change: it is one small JSON. */
    const guardar = () => { salvar(deEstado(estado)); };
    const playback = criarPlayback(ctx, estado);
    /**
     * The device or one of the browser's three cleanups changed. Those are `getUserMedia` constraints, so there is no
     * way around opening the device again: the capture is thrown away and the next `abrir()` builds another one. If the
     * microphone was open in OPEN MIC it comes back by itself; in push-to-talk the next press opens it, which is what
     * the player expects (a key that was not pressed must not open a microphone).
     */
    const reabrir = () => {
        const estavaVivo = captura.recriar();
        if (estavaVivo && estado.micLigado && estado.modo === 'aberta')
            void captura.abrir();
    };
    const aparelhos = criarAparelhos(ctx, estado, {
        aoTrocar: (motivo) => { estado.recado = motivo; guardar(); reabrir(); },
    });
    const captura = criarCaptura(ctx, canais, estado, {
        // the microphone opened: the notice is stale, and the screen has to show the device that REALLY opened (the
        // browser may have opened the default one when the chosen id no longer exists)
        aoAbrir: (aberto) => { estado.recado = null; aparelhos.conferirAberto(aberto); },
    });
    // The server sends the state on the channel's opening and whenever something the player sees changes.
    canais.estado.on((d) => {
        const era = estado.ligada;
        estado.ligada = d.ligada;
        estado.raio = d.raio;
        estado.motivo = d.motivo ?? null;
        estado.falando = d.falando ?? [];
        if (era && !d.ligada) {
            captura.desligar();
            playback.limpar();
        }
    });
    canais.ouve.on((d) => playback.receber(d));
    /** Tells the server what I want: it stops spending bandwidth sending whom I do not hear. */
    const aplicar = () => {
        try {
            if (canais.ajuste.canSend())
                canais.ajuste.send({ silenciar: [...estado.silenciados].slice(0, 32) });
        }
        catch (e) {
            console.warn(`[voz_proximidade] ajuste: ${e?.message ?? e}`);
        }
    };
    // The input action: push-to-talk on a registered key (remappable in Options > Shortcuts, like any
    // game action) and a touch button on mobile that works by holding (`hold`).
    // `touch` WITHOUT `id`: the `touch.id` is the slot of a GAME button, positioned in the page's CSS (#t-jump, #t-inv...).
    // A mod that invents a slot gets a button with no position at all, on top of the joystick. Without it, the engine puts the button
    // in the mods row (#touch-mod), which is where it fits.
    const acaoFalar = ctx.client.input.action({
        id: 'falar', name: 'Falar (voz por proximidade)', category: 'Voz', defaultKeys: ['KeyV'],
        touch: { label: '🎤', hold: true },
    });
    acaoFalar.onPress(() => { if (estado.modo === 'aperta')
        captura.abrir(); });
    acaoFalar.onRelease(() => { if (estado.modo === 'aperta')
        captura.fechar(); });
    /**
     * The options ON A KEY, which is what the owner asked for: a player adjusting the microphone in the middle of a
     * fight should not have to type a command.
     *
     * WHY `KeyJ`. The keys the base game takes are W A S D, Space, Shift, E, Q, T, / , Tab, M, F3, F, G, B, Esc, 1–9
     * and F5 (`mods/mineclaude/input/actions.ts`), and this mod already speaks on V. J is free, it is next to the
     * fingers that are already on the keyboard, and it collides with nothing. `Shift+V` would have been nicer to
     * remember, but the engine binds ONE `KeyboardEvent.code` per action and treats Shift as a key of its own — there
     * are no chords to bind —, so the honest choice is a free single key. Remappable in Opções → Atalhos like any
     * other, under the "Voz" category, and the screen writes down whatever the player picked.
     */
    const acaoOpcoes = ctx.client.input.action({
        id: 'opcoes', name: 'Opções de voz', category: 'Voz', defaultKeys: ['KeyJ'],
        touch: { label: '⚙' },
    });
    const teclas = {
        falar: () => nomeDaTecla(acaoFalar.keys()[0]),
        opcoes: () => nomeDaTecla(acaoOpcoes.keys()[0]),
    };
    const dependencias = {
        estado, captura, playback, aplicar, aparelhos, teclas, guardar, reabrir,
        vizinhos: () => ctx.client.players().map((/** @type {any} */ p) => p.name),
    };
    // DOOR 1: the page of the pause (Esc → Voz). It is drawn in pixel inside the pause's own panel (`f.box`), so it
    // works on the computer and on the phone, and it is the only door that works with the game paused.
    const pagina = criarPaginaVoz(dependencias);
    ctx.ui.gui.pausePage('voz', {
        title: 'Voz',
        icon: '🎤',
        hint: 'Microfone, volume e quem está perto',
        draw: pagina.draw,
        onPointer: pagina.onPointer,
        // opening the page is the moment to ask the browser for the device list again (it costs a promise, not a device)
        open: () => { void aparelhos.revisar(); },
    });
    // DOOR 2: the key (and the ⚙ touch button) open the same controls as a modal menu of this mod.
    const menu = criarMenuVoz(dependencias);
    ctx.ui.gui.menu('opcoes', { kind: 'modal', draw: menu.draw, onPointer: menu.onPointer });
    acaoOpcoes.onPress(() => {
        try {
            if (menu.aberto()) {
                ctx.ui.gui.menus.close('opcoes');
                return;
            } // the same key closes it
            void aparelhos.revisar();
            if (!ctx.ui.gui.menus.open('opcoes'))
                estado.aviso('voz: feche a tela aberta para ver as opções da voz');
        }
        catch (e) {
            estado.aviso(`voz: ${e?.message ?? e}`);
        }
    });
    menu.aoFechar(() => ctx.ui.gui.menus.close('opcoes'));
    // The microphone switch also by command, and only in the browser: it is the shortest way on a phone, and it is
    // also what an admin asks a player to type when the voice "is not working".
    ctx.client.commands.register('vozmic', {
        help: '/vozmic [ligar|desligar] — liga o seu microfone (o mesmo interruptor da tela de opções; serve no celular)',
        args: [{ name: 'como', type: 'enum', values: ['ligar', 'desligar'], optional: true }],
        run(e) {
            const arg = String(e.args?.[0] ?? '').toLowerCase(); // without an argument, the command is a toggle
            const quer = arg === 'ligar' ? true : arg === 'desligar' ? false : !estado.micLigado;
            if (quer && !estado.ligada)
                return e.reply('voz: a voz está desligada neste servidor');
            const d = captura.disponivel();
            if (quer && !d.falar)
                return e.reply(`voz: não dá para falar neste navegador — ${d.motivo ?? 'sem captura de áudio'}`);
            estado.micLigado = quer;
            if (!quer)
                captura.desligar();
            else if (estado.modo === 'aberta')
                captura.abrir();
            guardar();
            e.reply(quer ? `voz: microfone ligado — segure ${teclas.falar()} ou o botão 🎤 para falar` : 'voz: microfone desligado');
        },
    });
    registrarHud(ctx, estado, captura, playback);
    // DOOR 3: `/voz`, the screen type the server opens — the same body, in a panel of its own.
    ctx.screens.client('voz', criarTelaVoz(dependencias));
    // One game frame: close voices that stopped, the voice gate of open mic, close the device after silence.
    ctx.events.on('clientTickEnd', () => { playback.passo(); captura.passo(); });
    // The game opened: now the device list can be asked for (the names only come after the first permission, so this
    // is the list without names, which the screen says out loud), and the mod starts watching for a headset being
    // plugged in or pulled out.
    ctx.events.on('clientStarted', () => { void aparelhos.revisar(); aparelhos.ouvir(); });
    // The connection dropped: the microphone closes and no voice keeps playing. Nothing survives the session — except
    // what is on the disk because the player chose it, which is the point of the settings.
    ctx.events.on('clientDisconnect', () => { captura.desligar(); playback.limpar(); estado.ligada = false; estado.falando = []; });
    ctx.events.on('clientStopping', () => aparelhos.parar());
}
