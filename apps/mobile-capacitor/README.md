# T3 Code Mobile — Capacitor

Shell Android do `apps/web`, separado do aplicativo React Native em `apps/mobile`.

O shell usa o runtime moderno de conexões do web app. Assim, o celular pode salvar
vários ambientes (por exemplo, Linux e Mac via Tailscale), mantendo apenas o ambiente
selecionado ativo.

```bash
vp run --filter @t3tools/mobile-capacitor build
vp run --filter @t3tools/mobile-capacitor open:android
```

O Android permite HTTP sem TLS para endereços privados/Tailscale. A autenticação
continua obrigatória: cada máquina precisa ser pareada para emitir seu bearer token.
