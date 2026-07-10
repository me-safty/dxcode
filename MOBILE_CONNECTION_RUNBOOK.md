# Conexão móvel do T3 Code

Este documento registra o setup usado para conectar o celular e o tablet Android ao T3 Code no
Linux e no Mac. Ele não contém tokens: as credenciais de pareamento são temporárias e devem ser
geradas novamente para cada aplicativo e dispositivo.

## Configuração atual

| Máquina   | Endereço Tailscale HTTPS                        | IP do tailnet   |
| --------- | ----------------------------------------------- | --------------- |
| Linux MSI | `https://gabriel-alonso-msi.tailad333c.ts.net`  | `100.70.132.45` |
| Mac mini  | `https://mac-mini-de-gabriel.tailad333c.ts.net` | `100.71.185.10` |

O Tailscale precisa permanecer conectado no dispositivo móvel, inclusive dentro de casa. Sem exit
node habilitado, somente o tráfego destinado ao tailnet passa pelo Tailscale. No Wi-Fi de casa, a
comunicação entre os pares normalmente continua direta pela rede local.

Aplicativos Android:

| Aplicativo              | Package ID               | APK                                                                       |
| ----------------------- | ------------------------ | ------------------------------------------------------------------------- |
| React Native standalone | `com.t3tools.t3code.dev` | `apps/mobile/android/app/build/outputs/apk/release/app-release.apk`       |
| Capacitor               | `tools.t3code.mobile`    | `apps/mobile-capacitor/android/app/build/outputs/apk/debug/app-debug.apk` |

Dispositivos usados no setup:

| Dispositivo | Modelo           | Último serial ADB conhecido |
| ----------- | ---------------- | --------------------------- |
| Celular     | Samsung SM-S928B | `RXCX800G1DY`               |
| Tablet      | Samsung SM-X610  | `RX2XC0094TX`               |

Sempre confirme o serial atual antes de executar comandos:

```bash
ADB="$HOME/.local/share/Android/Sdk/platform-tools/adb"
"$ADB" devices -l
```

## Verificação das máquinas

No Linux:

```bash
tailscale status
tailscale serve status
```

O Tailscale Serve do Linux deve encaminhar o HTTPS para o servidor local:

```text
https://gabriel-alonso-msi.tailad333c.ts.net/ -> http://127.0.0.1:3773
```

No Mac:

```bash
ssh mac-mini '/Applications/Tailscale.app/Contents/MacOS/Tailscale status; \
  /Applications/Tailscale.app/Contents/MacOS/Tailscale serve status'
```

O T3 Code precisa estar em execução nas duas máquinas antes de testar o aplicativo.

## Gerar credenciais de pareamento

Gere uma credencial diferente para cada combinação de dispositivo e aplicativo. O exemplo abaixo
cria uma credencial de 30 minutos para o Linux:

```bash
npx --yes t3@0.0.28 auth pairing create \
  --base-dir "$HOME/.t3" \
  --ttl 30m \
  --label "NOME DO DISPOSITIVO E APLICATIVO" \
  --base-url "https://gabriel-alonso-msi.tailad333c.ts.net" \
  --json
```

Para o Mac:

```bash
ssh mac-mini 'PATH=/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:$PATH; \
  /opt/homebrew/bin/npx --yes t3@0.0.28 auth pairing create \
  --base-dir "$HOME/.t3" \
  --ttl 30m \
  --label "NOME DO DISPOSITIVO E APLICATIVO" \
  --base-url "https://mac-mini-de-gabriel.tailad333c.ts.net" \
  --json'
```

Use o campo `credential` retornado como código de pareamento. Não registre esse código neste
documento.

## Parear os aplicativos

No React Native:

1. Abra **Settings → Environments → +**.
2. Informe o endereço HTTPS da máquina e o `credential` correspondente.
3. Repita para a outra máquina.
4. Confirme que os dois ambientes aparecem como **Connected**.

No Capacitor:

1. Abra **Settings → Connections → Add environment**.
2. Informe o endereço HTTPS da máquina e o `credential` correspondente.
3. Repita para a outra máquina.
4. Confirme os dois indicadores verdes.

## Compilar e instalar

### Capacitor

```bash
vp run --filter @t3tools/mobile-capacitor build

cd apps/mobile-capacitor/android
ANDROID_HOME="$HOME/.local/share/Android/Sdk" \
ANDROID_SDK_ROOT="$HOME/.local/share/Android/Sdk" \
./gradlew app:assembleDebug --no-daemon
```

Instalação preservando os pareamentos existentes:

```bash
ADB="$HOME/.local/share/Android/Sdk/platform-tools/adb"
"$ADB" -s SERIAL install -r \
  apps/mobile-capacitor/android/app/build/outputs/apk/debug/app-debug.apk
```

Se aparecer `INSTALL_FAILED_UPDATE_INCOMPATIBLE`, existe uma versão antiga assinada por outra
chave. A substituição abaixo apaga somente os dados do Capacitor e exige novo pareamento:

```bash
"$ADB" -s SERIAL uninstall tools.t3code.mobile
"$ADB" -s SERIAL install \
  apps/mobile-capacitor/android/app/build/outputs/apk/debug/app-debug.apk
```

### React Native standalone

```bash
cd apps/mobile/android
ANDROID_HOME="$HOME/.local/share/Android/Sdk" \
ANDROID_SDK_ROOT="$HOME/.local/share/Android/Sdk" \
./gradlew app:assembleRelease --no-daemon
```

```bash
ADB="$HOME/.local/share/Android/Sdk/platform-tools/adb"
"$ADB" -s SERIAL install -r \
  apps/mobile/android/app/build/outputs/apk/release/app-release.apk
```

Use o APK `release`: o APK de desenvolvimento depende do Metro e não é adequado para uso longe do
computador.

## Checklist final

- Tailscale conectado no Linux, Mac e dispositivo Android.
- T3 Code em execução nas duas máquinas.
- Linux e Mac aparecem como **Connected** nos dois aplicativos.
- Threads das duas máquinas são carregadas.
- O React Native abre sem Metro e sem cabo USB.
- O Capacitor respeita as barras de status e navegação em retrato e paisagem.
- `vp check`, `vp run typecheck` e `vp run lint:mobile` passam antes de distribuir novos APKs.
