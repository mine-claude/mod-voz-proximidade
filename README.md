# Voz por proximidade

Mod do [MineClaude](https://mineclaude.com). Id `voz_proximidade`, versão `0.1.0`. Repositório privado.

## O que ele faz

Chat de voz por PROXIMIDADE, inteiro como mod: o microfone é capturado por ctx.client.media (desligado por padrão, apertar-para-falar), vai em Opus por um canal de alto volume (ctx.net.channel com bulk), o SERVIDOR só repassa a quem está perto (mesma dimensão ou a mesma sala) e o navegador toca cada voz em 3D por bus.stream do ctx.audio, com buffer de jitter. Sem WebRTC e sem servidor de fora: o áudio não sai do servidor do jogo e ninguém vê o IP de ninguém. Nada é gravado. Regra de jogo para desligar, indicador no HUD de quem está falando, silenciar jogador e volume na tela /voz. Arte por código.

## Instalar

Baixe o `.mcmod` da [última Release](../../releases/latest) e escolha um caminho:

- **Pasta de mods:** ponha o arquivo **`voz_proximidade.mcmod`** (o nome importa: o servidor exige que seja o id do mod) na `MODS_DIR` do servidor e reinicie. A Release traz esse nome pronto, ao lado da cópia com a versão no nome.
- **No jogo:** `/mod previa <link do .mcmod>`, ou a tela **Mods**.

Lado: servidor + navegador.

## Montar e empacotar aqui

Só precisa do [Bun](https://bun.sh) — nada do repositório do jogo:

```
bun tools/pack.mjs
```

Sai um `voz_proximidade-0.1.0.mcmod` determinístico (mesma entrada, mesmos bytes).

## Publicar uma versão

Suba a `version` no `package.json`, comite, e marque:

```
git tag v0.1.0 && git push origin v0.1.0
```

O workflow `.github/workflows/release.yml` monta, empacota e cria a Release com o `.mcmod` anexado.

## Arte

Arte 100% original, pintada por código.
