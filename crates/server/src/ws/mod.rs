use axum::extract::ws::{Message, WebSocket};
use futures_util::{SinkExt, StreamExt};
use serde_json::Value;
use tokio::sync::{mpsc, watch};
use tracing::{error, info_span};

use t3code_contracts::rpc::{
    RpcRequest, RpcServerMessage, METHOD_ORCHESTRATION_GET_SNAPSHOT,
    METHOD_ORCHESTRATION_REPLAY_EVENTS, METHOD_SERVER_GET_CONFIG, METHOD_SERVER_GET_SETTINGS,
    METHOD_SERVER_REFRESH_PROVIDERS, METHOD_SERVER_UPDATE_SETTINGS,
    METHOD_SERVER_UPSERT_KEYBINDING, METHOD_SUBSCRIBE_ORCHESTRATION_DOMAIN_EVENTS,
    METHOD_SUBSCRIBE_SERVER_CONFIG, METHOD_SUBSCRIBE_SERVER_LIFECYCLE,
    METHOD_SUBSCRIBE_TERMINAL_EVENTS,
};
use t3code_contracts::server::{
    ServerConfigStreamEvent, ServerProviderUpdatedPayload, ServerUpsertKeybindingResult,
};

use crate::AppState;

pub async fn handle_socket(socket: WebSocket, state: AppState) {
    let (mut sender, mut receiver) = socket.split();
    let (outbound_tx, mut outbound_rx) = mpsc::unbounded_channel::<RpcServerMessage>();
    let (close_tx, close_rx) = watch::channel(false);

    let writer = tokio::spawn(async move {
        while let Some(message) = outbound_rx.recv().await {
            match serde_json::to_string(&message) {
                Ok(serialized) => {
                    if sender.send(Message::Text(serialized.into())).await.is_err() {
                        break;
                    }
                }
                Err(error) => {
                    error!(?error, "failed to serialize websocket message");
                    break;
                }
            }
        }
    });

    while let Some(next_message) = receiver.next().await {
        let message = match next_message {
            Ok(message) => message,
            Err(error) => {
                error!(?error, "websocket receive failed");
                break;
            }
        };

        match message {
            Message::Text(text) => match serde_json::from_str::<RpcRequest>(&text) {
                Ok(request) => {
                    let outbound_tx = outbound_tx.clone();
                    let state = state.clone();
                    let connection_closed = close_rx.clone();
                    tokio::spawn(async move {
                        dispatch_request(state, request, outbound_tx, connection_closed).await;
                    });
                }
                Err(error) => {
                    error!(?error, "invalid websocket rpc request");
                }
            },
            Message::Binary(_) | Message::Ping(_) | Message::Pong(_) => {}
            Message::Close(_) => break,
        }
    }

    let _ = close_tx.send(true);
    let _ = writer.await;
}

#[allow(clippy::too_many_lines)]
async fn dispatch_request(
    state: AppState,
    request: RpcRequest,
    outbound_tx: mpsc::UnboundedSender<RpcServerMessage>,
    close_rx: watch::Receiver<bool>,
) {
    let span = info_span!(
        "ws.rpc",
        method = request.tag.as_str(),
        request_id = request.id.as_str()
    );
    let _guard = span.enter();

    match request.tag.as_str() {
        METHOD_SERVER_GET_CONFIG => {
            let config = state.server_config().await;
            let _ = outbound_tx.send(RpcServerMessage::success(
                request.id,
                serde_json::to_value(config).unwrap_or(Value::Null),
            ));
        }
        METHOD_SERVER_GET_SETTINGS => {
            let settings = state.settings().await;
            let _ = outbound_tx.send(RpcServerMessage::success(
                request.id,
                serde_json::to_value(settings).unwrap_or(Value::Null),
            ));
        }
        METHOD_SERVER_REFRESH_PROVIDERS => {
            let payload = ServerProviderUpdatedPayload {
                providers: Vec::new(),
            };
            let _ = outbound_tx.send(RpcServerMessage::success(
                request.id,
                serde_json::to_value(payload).unwrap_or(Value::Null),
            ));
        }
        METHOD_SERVER_UPSERT_KEYBINDING => {
            let result = ServerUpsertKeybindingResult {
                keybindings: Vec::new(),
                issues: Vec::new(),
            };
            let _ = outbound_tx.send(RpcServerMessage::success(
                request.id,
                serde_json::to_value(result).unwrap_or(Value::Null),
            ));
        }
        METHOD_SERVER_UPDATE_SETTINGS => {
            let patch = request
                .payload
                .get("patch")
                .cloned()
                .unwrap_or_else(|| serde_json::json!({}));

            match state.update_settings(patch).await {
                Ok(settings) => {
                    let _ = outbound_tx.send(RpcServerMessage::success(
                        request.id,
                        serde_json::to_value(settings).unwrap_or(Value::Null),
                    ));
                }
                Err(error) => {
                    let _ = outbound_tx.send(RpcServerMessage::failure(
                        request.id,
                        "Unable to update settings.",
                        Some(serde_json::json!({ "detail": error.to_string() })),
                    ));
                }
            }
        }
        METHOD_ORCHESTRATION_GET_SNAPSHOT => {
            let snapshot = state.snapshot().await;
            let _ = outbound_tx.send(RpcServerMessage::success(
                request.id,
                serde_json::to_value(snapshot).unwrap_or(Value::Null),
            ));
        }
        METHOD_ORCHESTRATION_REPLAY_EVENTS => {
            let from_sequence_exclusive = request
                .payload
                .get("fromSequenceExclusive")
                .and_then(serde_json::Value::as_u64)
                .or_else(|| {
                    request
                        .payload
                        .get("fromSequence")
                        .and_then(serde_json::Value::as_u64)
                })
                .or_else(|| request.payload.as_u64())
                .unwrap_or(0);

            match state.replay_events(from_sequence_exclusive).await {
                Ok(events) => {
                    let _ = outbound_tx.send(RpcServerMessage::success(
                        request.id,
                        serde_json::to_value(events).unwrap_or(Value::Null),
                    ));
                }
                Err(error) => {
                    let _ = outbound_tx.send(RpcServerMessage::failure(
                        request.id,
                        "Unable to replay events.",
                        Some(serde_json::json!({ "detail": error.to_string() })),
                    ));
                }
            }
        }
        METHOD_SUBSCRIBE_SERVER_CONFIG => {
            let request_id = request.id.clone();
            let initial = ServerConfigStreamEvent::Snapshot {
                version: 1,
                config: state.server_config().await,
            };
            let _ = outbound_tx.send(RpcServerMessage::chunk(
                request_id.clone(),
                vec![serde_json::to_value(initial).unwrap_or(Value::Null)],
            ));

            let mut stream = state.subscribe_config();
            run_stream(close_rx, async move {
                loop {
                    let event = stream.recv().await;
                    match event {
                        Ok(event) => {
                            let message = RpcServerMessage::chunk(
                                request_id.clone(),
                                vec![serde_json::to_value(event).unwrap_or(Value::Null)],
                            );
                            if outbound_tx.send(message).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .await;
        }
        METHOD_SUBSCRIBE_SERVER_LIFECYCLE => {
            let events = vec![
                serde_json::to_value(state.welcome_event()).unwrap_or(Value::Null),
                serde_json::to_value(state.ready_event()).unwrap_or(Value::Null),
            ];
            let _ = outbound_tx.send(RpcServerMessage::chunk(request.id, events));
            await_connection_close(close_rx).await;
        }
        METHOD_SUBSCRIBE_ORCHESTRATION_DOMAIN_EVENTS => {
            let request_id = request.id.clone();
            let mut stream = state.subscribe_orchestration_events();
            run_stream(close_rx, async move {
                loop {
                    let event = stream.recv().await;
                    match event {
                        Ok(event) => {
                            let message = RpcServerMessage::chunk(
                                request_id.clone(),
                                vec![serde_json::to_value(event).unwrap_or(Value::Null)],
                            );
                            if outbound_tx.send(message).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .await;
        }
        METHOD_SUBSCRIBE_TERMINAL_EVENTS => {
            let request_id = request.id.clone();
            let mut stream = state.subscribe_terminal_events();
            run_stream(close_rx, async move {
                loop {
                    let event = stream.recv().await;
                    match event {
                        Ok(event) => {
                            let message = RpcServerMessage::chunk(request_id.clone(), vec![event]);
                            if outbound_tx.send(message).is_err() {
                                break;
                            }
                        }
                        Err(_) => break,
                    }
                }
            })
            .await;
        }
        unknown => {
            let _ = outbound_tx.send(RpcServerMessage::failure(
                request.id,
                format!("Unsupported RPC method `{unknown}`."),
                None,
            ));
        }
    }
}

async fn run_stream<F>(mut close_rx: watch::Receiver<bool>, stream: F)
where
    F: std::future::Future<Output = ()>,
{
    tokio::pin!(stream);

    tokio::select! {
        () = &mut stream => {}
        _ = close_rx.changed() => {}
    }
}

async fn await_connection_close(mut close_rx: watch::Receiver<bool>) {
    let _ = close_rx.changed().await;
}
