// Generated from screen.ts by "sdk check"/"sdk build": edit the .ts, not this file.
// @ts-check
// The VOICE OPTIONS, drawn on the game's GUI layer with the widget KIT (`f.ui`): no HTML, no outside image, and the
// same look as the rest of the game because the components are the ones registered in the theme.
//
// ONE body, THREE doors. The player reaches these same controls from the Esc menu (the "Voz" page of the pause), from
// the key of the `opcoes` action and from `/voz`, and all three draw the function `corpo()` below. A pause page gets
// a rectangle (`f.box`) and no title of its own (the pause already wrote it); the `/voz` screen centres its own panel
// and adds the title and the tip box. Nothing else differs — one layout to keep right, not three.
//
// THREE TABS, because of the phone. Everything on one screen reached 300 pixels of GUI tall, which does not fit the
// pause page (180) and barely fits a phone; and a player who wants to turn one person down does not want to scroll
// past the noise suppression to do it. So: "Microfone" (what goes out), "Ouvir" (what comes in) and "Perto de você"
// (one line per person). The tab is remembered along with the rest.
//
// LAYOUT, the rule that keeps being the trap: the `ui.column` is a cursor, and each component has to ask for the
// HEIGHT IT DRAWS — not that of its click rectangle. The kit's slider and progress bar draw their label ABOVE the y
// they receive (`y - LINHA`), so whoever reserves one line for them writes the label over the previous component.
// That is why both ask for TWO lines (`LINHA * 2`) and are drawn at `y + LINHA`.
import { GANHO_MAX, PESSOA_MAX, LIMIAR_MAX } from './settings.ts';
const LINHA = 9, GAP = 3, PAD = 7;
const W = 252; // the `/voz` panel; a pause page uses the width of its own box, up to this much more
const W_MAX = 300;
const CORPO = 128; // the height of a tab's content: fits the pause page's box (180) and a phone at scale 1
const CABECA = LINHA + GAP + LINHA + GAP + 12 + GAP; // state, notice, tabs
const DICA = ['Nada é gravado: o servidor esquece.', 'O microfone só abre quando você aperta.'];
const ALTURA_DICA = DICA.length * 10 + 3; // ui.tipBox: 10 px per line + 3
/** The `/voz` panel: title + the head + a tab + the tip box. */
export const ALTURA = 5 + LINHA + GAP + CABECA + CORPO + GAP + ALTURA_DICA + 6;
export const LARGURA = W;
const ABAS = [{ id: 'mic', label: 'Microfone' }, { id: 'ouvir', label: 'Ouvir' }, { id: 'perto', label: 'Perto' }];
const cortar = (texto, n) => (texto.length > n ? `${texto.slice(0, n - 1)}…` : texto);
const pct = (v) => `${Math.round(v * 100)}%`;
/**
 * The body of the voice options, drawn inside the rectangle it is given. Used by the `/voz` screen and by the pause
 * page; `titulo` and `dica` are what only the standalone screen wants.
 *
 * @param {any} f the frame of the GUI layer (`f.ui`, `f.state`)
 * @param {{ x: number, y: number, w: number, h: number }} caixa
 * @param {any} d everything the screen touches, injected (see `criarTelaVoz`)
 * @param {{ titulo?: boolean, dica?: boolean }} [opcoes]
 */
function corpo(f, caixa, d, { titulo = false, dica = false } = {}) {
    const { ui, state } = f;
    const { estado, captura } = d;
    state.modoDrop ??= { open: false };
    state.aparelhoDrop ??= { open: false };
    state.lista ??= { scroll: 0 };
    const w = Math.min(caixa.w, W_MAX);
    const col = ui.column({ x: caixa.x, y: caixa.y, w, gap: GAP });
    if (titulo)
        ui.label({ ...col.place(LINHA), text: 'Voz por proximidade', align: 'center' });
    const cap = captura.disponivel();
    ui.label({ ...col.place(LINHA), dim: true,
        text: estado.ligada ? `alcance ${estado.raio} blocos · ${cap.falar ? 'pode falar' : 'só ouvir'}` : 'desligada neste servidor' });
    // ONE line reserved for the notice, whether there is a notice or not: the rest of the screen cannot dance
    // according to the state. The mod's own notice (a device that went away) comes first, because it is the newest.
    const recado = col.place(LINHA);
    const porque = estado.recado ?? (!estado.ligada ? estado.motivo : !cap.falar ? cap.motivo : null);
    if (porque)
        ui.label({ ...recado, text: cortar(porque, Math.floor(w / 5.2)), dim: true, lines: [porque] });
    const abas = col.place(12);
    ui.tabs({
        x: abas.x, y: abas.y, w, h: 12, tabs: ABAS, active: estado.aba, focus: 'abas',
        onPick: (/** @type {string} */ id) => { estado.aba = id; d.guardar(); },
    });
    // The tab's content gets the rest of the rectangle, and never more than CORPO: the pause page's box and a phone
    // are the two places this has to fit, and both are measured by that number.
    const resto = col.place(0);
    const caixaAba = { x: resto.x, y: resto.y, w, h: Math.min(CORPO, caixa.y + caixa.h - resto.y - (dica ? ALTURA_DICA + GAP : 0)) };
    if (estado.aba === 'mic')
        abaMicrofone(f, caixaAba, d, cap);
    else if (estado.aba === 'ouvir')
        abaOuvir(f, caixaAba, d, cap);
    else
        abaPerto(f, caixaAba, d);
    if (dica)
        ui.tip({ x: caixa.x, y: caixa.y + caixa.h - ALTURA_DICA, fixed: true, lines: DICA });
}
/** Tab 1 — WHAT GOES OUT: the switch, the device, the mode, the gain, the threshold, the meter and the test. */
function abaMicrofone(f, caixa, d, cap) {
    const { ui, state } = f;
    const { estado, captura, aparelhos, teclas } = d;
    const col = ui.column({ x: caixa.x, y: caixa.y, w: caixa.w, gap: GAP });
    // 1. the switch. Until it is on, no key opens a microphone — that is the mod's promise, and it is a checkbox.
    const mic = col.place(LINHA);
    ui.checkbox({
        x: mic.x, y: mic.y, focus: 'mic', label: 'Microfone ligado', value: estado.micLigado,
        disabled: !estado.ligada || !cap.falar,
        onChange: (/** @type {boolean} */ v) => {
            estado.micLigado = v;
            if (!v)
                captura.desligar();
            else if (estado.modo === 'aberta')
                captura.abrir();
            d.guardar();
        },
    });
    // 2. WHICH microphone. The names only exist after the player has allowed one once (the browser's rule), so until
    // then the list is "Microfone 1", "Microfone 2" and the line below says why.
    // A COLUNA DO RÓTULO tem de caber o rótulo: com 42 px o "Aparelho" passava por baixo do dropdown. A medida vem
    // do próprio kit (`ui.textWidth`), que é quem sabe a largura da fonte registrada, e não de um número chutado.
    const colRotulo = Math.max(ui.textWidth('Aparelho'), ui.textWidth('Modo')) + 4;
    const linhaAp = col.row(12);
    const rotuloAp = linhaAp.place(colRotulo);
    ui.label({ x: rotuloAp.x, y: rotuloAp.y + 2, w: colRotulo, text: 'Aparelho', dim: true });
    const opcoesAp = [{ value: '', label: 'Padrão do navegador' },
        ...aparelhos.lista().map((a) => ({ value: a.id, label: cortar(a.nome, 24) }))];
    const dropAp = linhaAp.place();
    ui.dropdown({
        x: dropAp.x, y: dropAp.y, w: dropAp.w, state: state.aparelhoDrop, focus: 'aparelho',
        value: estado.aparelho ?? '', options: opcoesAp,
        placeholder: cap.listar ? 'Padrão do navegador' : 'este navegador não lista',
        onPick: (/** @type {string} */ v) => { if (aparelhos.escolher(v || null))
            d.guardar(); },
    });
    // 3. the mode, and the keys. `teclas()` is the key the PLAYER chose, not the default one.
    const linhaModo = col.row(12);
    const rotuloModo = linhaModo.place(colRotulo);
    ui.label({ x: rotuloModo.x, y: rotuloModo.y + 2, w: colRotulo, text: 'Modo', dim: true });
    const dropModo = linhaModo.place();
    ui.dropdown({
        x: dropModo.x, y: dropModo.y, w: dropModo.w, state: state.modoDrop, value: estado.modo, focus: 'modo',
        options: [{ value: 'aperta', label: `Apertar para falar (${teclas.falar()})` }, { value: 'aberta', label: 'Voz aberta (com limiar)' }],
        onPick: (/** @type {string} */ v) => {
            estado.modo = v;
            if (v === 'aberta' && estado.micLigado)
                captura.abrir();
            else
                captura.fechar();
            d.guardar();
        },
    });
    // 4. the GAIN, 0..300%. Live: the engine moves one number in the graph, the microphone is not reopened, and because
    // the gain sits before the encoder the meter below moves with it.
    const ganho = col.place(LINHA * 2);
    ui.slider({
        x: ganho.x, y: ganho.y + LINHA, w: Math.min(140, caixa.w - 40), min: 0, max: GANHO_MAX * 100, step: 10, unit: '%',
        focus: 'ganho', label: 'Ganho do microfone', value: Math.round(estado.ganho * 100),
        onChange: (/** @type {number} */ v) => { captura.ganho(v / 100); d.guardar(); },
    });
    // 5. the voice-activation threshold, which only means anything in open mic (0 = always on the air)
    const limiar = col.place(LINHA * 2);
    ui.slider({
        x: limiar.x, y: limiar.y + LINHA, w: Math.min(140, caixa.w - 40), min: 0, max: LIMIAR_MAX * 100, step: 1, unit: '%',
        focus: 'limiar', label: estado.modo === 'aberta' ? 'Abre a voz acima de' : 'Abre a voz acima de (voz aberta)',
        value: Math.round(estado.limiar * 100),
        onChange: (/** @type {number} */ v) => { estado.limiar = v / 100; d.guardar(); },
    });
    // 6. the meter, which is the only honest answer to "is it hearing me?"
    const nivel = col.place(LINHA + 7);
    ui.progress({
        x: nivel.x, y: nivel.y + LINHA, w: Math.min(140, caixa.w - 40), h: 7, value: Math.round(estado.nivel * 100), max: 100,
        label: captura.falando ? 'falando' : 'nível do microfone', text: pct(estado.nivel),
    });
    // 7. hearing yourself, with a clear on/off. It is feedback on open speakers, so it says so.
    const teste = col.place(LINHA);
    ui.checkbox({
        x: teste.x, y: teste.y, focus: 'teste', label: 'Testar microfone: ouvir-se (use fone)', value: captura.monitorando,
        disabled: !estado.micLigado || !cap.falar,
        onChange: (/** @type {boolean} */ v) => { captura.monitorar(v); if (v && estado.micLigado)
            captura.abrir(); },
    });
    // 8. the two keys, written out: this screen is also where a player finds out which key talks
    ui.label({ ...col.place(LINHA), dim: true, text: `Falar: ${teclas.falar()} · Esta tela: ${teclas.opcoes()}` });
}
/** Tab 2 — WHAT COMES IN: everyone's volume, deafen, and the browser's three cleanups. */
function abaOuvir(f, caixa, d, cap) {
    const { ui } = f;
    const { estado, captura, playback } = d;
    const col = ui.column({ x: caixa.x, y: caixa.y, w: caixa.w, gap: GAP });
    const vol = col.place(LINHA * 2);
    ui.slider({
        x: vol.x, y: vol.y + LINHA, w: Math.min(140, caixa.w - 40), min: 0, max: 100, step: 5, unit: '%', focus: 'volume',
        label: 'Volume de todos', value: Math.round(estado.volume * 100),
        onChange: (/** @type {number} */ v) => { estado.volume = v / 100; d.guardar(); },
    });
    const surdo = col.place(LINHA);
    ui.checkbox({
        x: surdo.x, y: surdo.y, focus: 'surdo', label: 'Não ouvir ninguém', value: estado.surdo,
        onChange: (/** @type {boolean} */ v) => { estado.surdo = v; if (v)
            playback.limpar(); d.guardar(); },
    });
    ui.label({ ...col.place(LINHA), text: 'Limpeza do microfone (do navegador)', dim: true });
    // The three constraints of getUserMedia. They are not live: the device has to be opened again with them, which is
    // what `recriar()` does — and the line at the bottom says so, instead of leaving the player wondering.
    const limpeza = [
        ['supressao', 'Supressão de ruído'],
        ['eco', 'Cancelamento de eco'],
        ['ganhoAuto', 'Ganho automático do navegador'],
    ];
    for (const [chave, label] of limpeza) {
        const c = col.place(LINHA);
        ui.checkbox({
            x: c.x, y: c.y, focus: chave, label, value: estado[chave], disabled: !cap.falar,
            onChange: (/** @type {boolean} */ v) => { estado[chave] = v; d.guardar(); d.reabrir(); },
        });
    }
    ui.label({ ...col.place(LINHA), dim: true, text: 'Mudar as três acima reabre o microfone.' });
}
/** Tab 3 — ONE LINE PER PERSON: their volume (0–200%) and muting them, here, without asking anybody anything. */
function abaPerto(f, caixa, d) {
    const { ui, state } = f;
    const { estado, playback, aplicar, vizinhos } = d;
    const col = ui.column({ x: caixa.x, y: caixa.y, w: caixa.w, gap: GAP });
    ui.label({ ...col.place(LINHA), text: 'Perto de você · volume e silêncio', dim: true });
    const nomes = [...new Set([...estado.falando, ...playback.tocando(), ...vizinhos()])].sort();
    // On a touch device the row and the buttons grow: the kit grows a click area to `ui.minTap` (18) around the
    // drawing, and three buttons of 12 side by side would have overlapping tap areas. At 16 with 18 of pitch they do not.
    const bt = ui.touch ? 16 : 12;
    const rowH = bt + 2;
    const sobra = col.place(0);
    const alturaLista = Math.max(rowH, caixa.y + caixa.h - sobra.y);
    ui.list({
        x: sobra.x, y: sobra.y, w: caixa.w, h: alturaLista, rowH, count: nomes.length, state: state.lista,
        // row(i, rx, ry, over, innerW): the kit delivers the row with scrolling already resolved
        row: (/** @type {number} */ i, /** @type {number} */ rx, /** @type {number} */ ry, /** @type {boolean} */ over, /** @type {number} */ innerW) => {
            const nome = nomes[i];
            if (!nome)
                return;
            if (over)
                ui.rect(rx, ry, innerW, rowH, ui.theme.slotHover);
            const chave = nome.toLowerCase();
            const calado = estado.silenciados.has(chave);
            const v = estado.volumes.get(chave) ?? 1;
            // from the right: mute, +, the percentage, −. The name takes what is left.
            let x = rx + innerW - bt;
            ui.iconButton({
                x, y: ry, size: bt, glyph: calado ? 'x' : 'o',
                // `data` is how the engine identifies the region: it is how the browser suite finds this row's button
                data: { kind: 'silenciar', nome, calado },
                tip: [calado ? `Ouvir ${nome} de novo` : `Silenciar ${nome} (só para você)`],
                onClick: () => {
                    if (calado)
                        estado.silenciados.delete(chave);
                    else {
                        estado.silenciados.add(chave);
                        playback.silenciar(nome);
                    }
                    aplicar(); // tells the server: it stops spending bandwidth on whom I do not hear
                    d.guardar();
                },
            });
            const passo = (dir) => {
                const novo = Math.min(PESSOA_MAX, Math.max(0, Math.round((v + dir * 0.1) * 10) / 10));
                if (novo === 1)
                    estado.volumes.delete(chave);
                else
                    estado.volumes.set(chave, novo);
                d.guardar();
            };
            x -= bt + 2;
            ui.iconButton({ x, y: ry, size: bt, glyph: '+', data: { kind: 'mais', nome }, disabled: v >= PESSOA_MAX,
                tip: [`Aumentar ${nome}`], onClick: () => passo(1) });
            x -= 26;
            ui.label({ x, y: ry + Math.round((rowH - 7) / 2), w: 24, text: pct(v), align: 'right', dim: v === 1 });
            x -= bt + 2;
            ui.iconButton({ x, y: ry, size: bt, glyph: '-', data: { kind: 'menos', nome }, disabled: v <= 0,
                tip: [`Diminuir ${nome}`], onClick: () => passo(-1) });
            ui.label({ x: rx + 3, y: ry + Math.round((rowH - 7) / 2), w: x - rx - 6, text: cortar(nome, 13), dim: calado });
        },
    });
}
/**
 * The body in a PANEL of its own, centred on the screen, with the title and the tip box: what both the `/voz` screen
 * and the key's menu draw. The `outside` and `panel` regions are what lets a click outside close it.
 * @param {any} f @param {any} d
 */
function painel(f, d) {
    const { ui } = f;
    const c = ui.center(W, ALTURA);
    ui.hit(0, 0, ui.width, ui.height, { kind: 'outside' });
    ui.hit(c.x, c.y, W, ALTURA, { kind: 'panel' });
    ui.panel(c.x, c.y, W, ALTURA);
    corpo(f, { x: c.x + PAD, y: c.y + 5, w: W - PAD * 2, h: ALTURA - 11 }, d, { titulo: true, dica: true });
}
/**
 * The `/voz` screen: the panel above, as the screen type the SERVER opens (`player.openScreen`). It is the SAME body
 * as the pause page and as the key's menu — only the frame around it changes.
 */
export function criarTelaVoz(d) {
    return class TelaVoz {
        /** @param {CanvasRenderingContext2D} _c @param {any} f */
        draw(_c, f) { painel(f, d); }
        /** @param {any} e */
        onKey(e) {
            if (e.code === 'Escape' || e.action === 'inventory') {
                e.data.actions.close();
                return true;
            }
            return false;
        }
        /** @param {any} e */
        onPointer(e) {
            if (e.region?.kind === 'outside') {
                e.data.actions.close();
                return true;
            }
            return true;
        }
    };
}
/**
 * The SAME controls as a PAGE of the pause (Esc → Voz), which is where a player looks for an option. The pause
 * already drew the panel and the title and hands over the rectangle in `f.box`; the body gets no title of its own and
 * no tip box, because what fits in 180 pixels of GUI is the controls.
 */
/**
 * The same controls as a MODAL MENU of this mod, which is what the `opcoes` key and the ⚙ touch button open. A menu
 * of a mod is opened by the browser itself (`ctx.ui.gui.menus.open`), with no round trip to the server — which is
 * what makes it answer a key instantly, and what makes it work while the player is only adjusting their microphone.
 *
 * `aberto()` is how the key TOGGLES: a menu does not tell a mod when it closed (a menu's hooks are `draw` and
 * `onPointer`), so the drawing itself leaves a timestamp and "open" means "drew in the last few frames". Cheap, and
 * it cannot get stuck out of step with the engine.
 */
export function criarMenuVoz(d) {
    let desenhadoEm = 0;
    let fechar = () => { };
    return {
        /** @param {CanvasRenderingContext2D} _c @param {any} f */
        draw(_c, f) {
            desenhadoEm = Date.now();
            painel(f, d);
            return true;
        },
        /** @param {any} e */
        onPointer(e) {
            if (e.region?.kind === 'outside') {
                fechar();
                return true;
            }
            return true; // the kit's own regions already handled their click
        },
        aberto: () => Date.now() - desenhadoEm < 200,
        aoFechar(fn) { fechar = fn; },
    };
}
export function criarPaginaVoz(d) {
    return {
        /** @param {CanvasRenderingContext2D} _c @param {any} f */
        draw(_c, f) {
            const box = f.box ?? { x: 4, y: 4, w: f.ui.width - 8, h: f.ui.height - 8 };
            corpo(f, { x: box.x + 4, y: box.y + 4, w: box.w - 8, h: box.h - 8 }, d);
            return true;
        },
        /** The pause owns the clicks outside the page (it goes back to its home menu); here only the kit's. */
        onPointer() { return false; },
    };
}
