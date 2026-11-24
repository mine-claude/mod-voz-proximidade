// Generated from index.ts by "sdk check"/"sdk build": edit the .ts, not this file.
// @ts-check
// The browser entry: wires up the capture, the playback, the HUD indicator, the options screen and the input action.
// The local state (on? in which mode? volume? whom did I mute?) lives HERE, in the session's memory — none of it goes
// to the server beyond the mute list, and nothing is saved to disk.
import { declareChannels } from '../channels.ts';
import { criarCaptura } from './capture.ts';
import { criarPlayback } from './playback.ts';
import { registrarHud } from './hud.ts';
import { criarTelaVoz } from './screen.ts';
/** @param {any} ctx */
export default function registerClient(ctx) {
    const canais = declareChannels(ctx);
    const estado = {
        ligada: false, // what the server's game rule said
        raio: 32,
        motivo: null,
        falando: /** @type {string[]} */ ([]), // who the server says is speaking near me
        micLigado: false, // the screen's switch: while it is false, the key opens no microphone
        modo: 'aperta', // 'aperta' (push to talk) or 'aberta' (open voice)
        volume: 1,
        surdo: false,
        nivel: 0,
        volumes: new Map(), // lowercase name -> volume (reserved for a per-person adjustment)
        silenciados: new Set(), // lowercase name
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
    const playback = criarPlayback(ctx, estado);
    const captura = criarCaptura(ctx, canais, estado);
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
    const acao = ctx.client.input.action({
        id: 'falar', name: 'Falar (voz por proximidade)', category: 'Voz', defaultKeys: ['KeyV'],
        touch: { label: '🎤', hold: true },
    });
    acao.onPress(() => { if (estado.modo === 'aperta')
        captura.abrir(); });
    acao.onRelease(() => { if (estado.modo === 'aperta')
        captura.fechar(); });
    // The microphone switch also by command, and only in the browser: the `/voz` screen is drawn on the GUI layer, and
    // on a touch device the game does NOT have a GUI layer (the inventory there is the HTML one) — i.e., on mobile there is no
    // screen at all to turn the microphone on. Until the engine has a mod screen on mobile, it is this command that
    // keeps voice usable there, along with the 🎤 button.
    ctx.client.commands.register('vozmic', {
        help: '/vozmic [ligar|desligar] — liga o seu microfone (o mesmo interruptor da tela /voz; serve no celular)',
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
            e.reply(quer ? `voz: microfone ligado — segure ${(acao.keys()[0] ?? 'a tecla').replace(/^Key/, '')} ou o botão 🎤 para falar` : 'voz: microfone desligado');
        },
    });
    registrarHud(ctx, estado, captura, playback);
    ctx.screens.client('voz', criarTelaVoz({
        estado, captura, playback, aplicar,
        vizinhos: () => ctx.client.players().map((/** @type {any} */ p) => p.name),
        teclas: () => acao.keys(),
    }));
    // One game frame: close voices that stopped, close the device after silence, apply volumes.
    ctx.events.on('clientTickEnd', () => { playback.passo(); captura.passo(); });
    // The connection dropped: the microphone closes and no voice keeps playing. Nothing survives the session.
    ctx.events.on('clientDisconnect', () => { captura.desligar(); playback.limpar(); estado.ligada = false; estado.falando = []; });
}
