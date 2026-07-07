#!/usr/bin/env bash
# Maestro Android smoke runner — used by mobile-qa CI (step s16) and local emulator QA.
# Expects a booted emulator with adb on PATH (android-emulator-runner provides this in CI).
set -euo pipefail

ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

export APP_VARIANT=development
export EXPO_PUBLIC_MAESTRO_AUTH_BYPASS=1
export EXPO_NO_GIT_STATUS=1
export CI="${CI:-true}"

MAESTRO_FLOWS=(
  "apps/mobile/.maestro/flows/smoke-launch.yaml"
  "apps/mobile/.maestro/flows/smoke-review.yaml"
)
OPTIONAL_FLOWS=(
  "apps/mobile/.maestro/flows/smoke-agent-push.yaml"
)

log() {
  echo "==> $*"
}

ensure_maestro() {
  if command -v maestro >/dev/null 2>&1; then
    return
  fi
  log "Installing Maestro CLI"
  curl -Ls "https://get.maestro.mobile.dev" | bash
  export PATH="${HOME}/.maestro/bin:${PATH}"
}

ensure_google_services() {
  local target="apps/mobile/secrets/google-services.development.json"
  mkdir -p apps/mobile/secrets
  if [[ -n "${GOOGLE_SERVICES_JSON:-}" && -f "${GOOGLE_SERVICES_JSON}" ]]; then
    cp "${GOOGLE_SERVICES_JSON}" "${target}"
    return
  fi
  if [[ -f "${target}" ]]; then
    return
  fi
  log "Using CI stub google-services.json (FCM not exercised in Maestro harness)"
  cp scripts/android-parity/fixtures/google-services.ci.json "${target}"
}

wait_for_emulator() {
  log "Waiting for emulator"
  adb wait-for-device
  local booted=""
  for _ in $(seq 1 60); do
    booted="$(adb shell getprop sys.boot_completed 2>/dev/null | tr -d '\r' || true)"
    if [[ "${booted}" == "1" ]]; then
      break
    fi
    sleep 2
  done
  adb shell settings put global animator_duration_scale 0 >/dev/null 2>&1 || true
  adb shell settings put global transition_animation_scale 0 >/dev/null 2>&1 || true
  adb shell settings put global window_animation_scale 0 >/dev/null 2>&1 || true
}

build_dev_client_apk() {
  log "Prebuild Android (development)"
  (
    cd apps/mobile
    bunx expo prebuild --platform android --clean
  )

  log "Assemble debug APK"
  (
    cd apps/mobile/android
    chmod +x gradlew
    ./gradlew assembleDebug -x lint --no-daemon
  )

  local apk=""
  apk="$(find apps/mobile/android/app/build/outputs/apk -name '*-debug.apk' -print -quit)"
  if [[ -z "${apk}" ]]; then
    echo "Could not find debug APK under apps/mobile/android/app/build/outputs/apk" >&2
    exit 1
  fi
  echo "${apk}"
}

install_apk() {
  local apk="$1"
  log "Installing ${apk}"
  adb install -r "${apk}"
}

start_metro() {
  log "Starting Metro dev client"
  (
    cd apps/mobile
    APP_VARIANT=development EXPO_PUBLIC_MAESTRO_AUTH_BYPASS=1 \
      bunx expo start --dev-client --scheme t3code-dev --non-interactive
  ) &
  METRO_PID=$!
  trap 'kill "${METRO_PID}" 2>/dev/null || true' EXIT

  for _ in $(seq 1 90); do
    if curl -fsS "http://127.0.0.1:8081/status" >/dev/null 2>&1; then
      log "Metro ready"
      return
    fi
    sleep 2
  done
  echo "Metro did not become ready on :8081" >&2
  exit 1
}

run_flow() {
  local flow="$1"
  local optional="${2:-false}"
  log "Maestro: ${flow}"
  if maestro test "${flow}"; then
    return 0
  fi
  log "Retry: ${flow}"
  if maestro test "${flow}"; then
    return 0
  fi
  if [[ "${optional}" == "true" ]]; then
    log "Optional flow failed (allowed): ${flow}"
    return 0
  fi
  return 1
}

main() {
  ensure_maestro
  ensure_google_services
  wait_for_emulator

  local apk
  apk="$(build_dev_client_apk)"
  install_apk "${apk}"
  start_metro

  local failed=0
  for flow in "${MAESTRO_FLOWS[@]}"; do
    if ! run_flow "${flow}"; then
      failed=1
    fi
  done

  if [[ -n "${RELAY_STAGING_URL:-}" && -n "${RELAY_STAGING_TEST_SECRET:-}" ]]; then
    for flow in "${OPTIONAL_FLOWS[@]}"; do
      if ! run_flow "${flow}" false; then
        failed=1
      fi
    done
  else
    for flow in "${OPTIONAL_FLOWS[@]}"; do
      run_flow "${flow}" true || true
    done
  fi

  if [[ "${failed}" -ne 0 ]]; then
    log "Collecting logcat slice"
    adb logcat -d -t 200 > maestro-logcat.txt 2>&1 || true
    exit 1
  fi

  log "Maestro Android smoke PASS"
}

main "$@"