# Local Voice Mode (whisper.cpp + Kokoro)

T3 Code can run a fully local, hands-free voice loop: speak a prompt, have it
transcribed on-device with [whisper.cpp](https://github.com/ggerganov/whisper.cpp),
sent to the agent, and have the reply spoken back with
[Kokoro TTS](https://github.com/hexgrad/kokoro) — in parallel with the text
printing. Anything that looks like code (fenced blocks, inline snippets, URLs,
file paths) is stripped before it is read aloud.

The feature is **off by default** and only appears once you enable it and point
it at the required binaries/models. No large artifacts are bundled.

## What you get

- A **Voice Mode** overlay (mic button in the composer footer) with an animated,
  audio-reactive orb — like ChatGPT's voice mode.
- Three ways to submit a spoken prompt:
  - **Push-to-talk** — hold the mic button, release to submit.
  - **Silence detection** — pause and it submits automatically (auto mode).
  - **Codeword** — say "send prompt" (configurable) at the end of your sentence.
- Barge-in: start talking and the spoken reply stops immediately.

## 1. Install whisper.cpp

```bash
git clone https://github.com/ggerganov/whisper.cpp
cd whisper.cpp
cmake -B build && cmake --build build --config Release
# Download a model (base.en is a good default):
./models/download-ggml-model.sh base.en
```

This produces the `whisper-cli` binary (in `build/bin/`) and a model at
`models/ggml-base.en.bin`.

## 2. Install Kokoro + an adapter

Kokoro has no CLI, so T3 Code invokes a small adapter that reads the text to
speak on **stdin** and writes a WAV to the `--out <path>` argument. Install the
runtime:

```bash
pip install kokoro-onnx soundfile
# download kokoro-v1.0.onnx and voices-v1.0.bin from the kokoro-onnx releases
```

Save this adapter as `kokoro_adapter.py`:

```python
import argparse, sys, soundfile as sf
from kokoro_onnx import Kokoro

parser = argparse.ArgumentParser()
parser.add_argument("--out", required=True)
parser.add_argument("--voice", default="af_heart")
parser.add_argument("--model", default="kokoro-v1.0.onnx")
parser.add_argument("--voices", default="voices-v1.0.bin")
parser.add_argument("--speed", type=float, default=1.0)
args = parser.parse_args()

text = sys.stdin.read()
kokoro = Kokoro(args.model, args.voices)
samples, sample_rate = kokoro.create(text, voice=args.voice, speed=args.speed)
sf.write(args.out, samples, sample_rate)
```

(The adapter contract is only: read text on stdin, honor `--out`/`--voice`/
`--model`/`--speed`, write a WAV. Swap in any TTS you like.)

## 3. Configure T3 Code

Set the paths either in `settings.json` (in your T3 Code state directory) under
the `speech` group, or via environment variables. Settings take precedence.

```jsonc
{
  "speech": {
    "sttEnabled": true,
    "ttsEnabled": true,
    "whisperBinaryPath": "/path/to/whisper.cpp/build/bin/whisper-cli",
    "whisperModelPath": "/path/to/whisper.cpp/models/ggml-base.en.bin",
    "kokoroCommand": "python /path/to/kokoro_adapter.py",
    "kokoroModelPath": "/path/to/kokoro-v1.0.onnx",
    "kokoroVoice": "af_heart",
    "sendPromptCodeword": "send prompt",
    "submitMode": "push-to-talk"
  }
}
```

Environment variable fallbacks (used when a setting is blank):

| Variable            | Purpose                                   |
| ------------------- | ----------------------------------------- |
| `T3_WHISPER_BIN`    | Path to `whisper-cli`                     |
| `T3_WHISPER_MODEL`  | Path to the ggml whisper model            |
| `T3_KOKORO_CMD`     | Kokoro adapter command                    |
| `T3_KOKORO_MODEL`   | Kokoro model path (passed as `--model`)   |
| `T3_KOKORO_VOICE`   | Default Kokoro voice                      |

## 4. Use it

1. Restart the server so it picks up the settings.
2. Open a thread — a **mic button** appears in the composer footer (only when
   `sttEnabled` is true).
3. Click it to enter Voice Mode. Speak, then release (push-to-talk), pause
   (auto mode), or say the codeword to submit.
4. The reply prints and is spoken at the same time; code is skipped. Use the
   mute or close buttons any time; starting to talk interrupts playback.

## How it works

- Audio is captured in the browser, downsampled to 16 kHz mono, and posted to
  `POST /api/stt/transcribe` (authenticated). The server runs whisper.cpp via
  the shared `ProcessRunner`.
- The reply's streamed text is cleaned with `@t3tools/shared/speakableText`
  (drops code/URLs/paths), split into sentences, and each sentence is sent to
  `POST /api/tts/synthesize`, which runs the Kokoro adapter and returns WAV.
- Both routes require the orchestration "operate" scope and fail with a typed
  "not-configured" error when disabled or unconfigured — the UI stays hidden.
