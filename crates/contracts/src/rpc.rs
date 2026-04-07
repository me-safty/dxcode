use serde::{Deserialize, Serialize};
use ts_rs::TS;

pub const METHOD_SERVER_GET_CONFIG: &str = "server.getConfig";
pub const METHOD_SERVER_GET_SETTINGS: &str = "server.getSettings";
pub const METHOD_SERVER_REFRESH_PROVIDERS: &str = "server.refreshProviders";
pub const METHOD_SERVER_UPSERT_KEYBINDING: &str = "server.upsertKeybinding";
pub const METHOD_SERVER_UPDATE_SETTINGS: &str = "server.updateSettings";
pub const METHOD_ORCHESTRATION_GET_SNAPSHOT: &str = "orchestration.getSnapshot";
pub const METHOD_ORCHESTRATION_REPLAY_EVENTS: &str = "orchestration.replayEvents";
pub const METHOD_SUBSCRIBE_SERVER_CONFIG: &str = "subscribeServerConfig";
pub const METHOD_SUBSCRIBE_SERVER_LIFECYCLE: &str = "subscribeServerLifecycle";
pub const METHOD_SUBSCRIBE_ORCHESTRATION_DOMAIN_EVENTS: &str = "subscribeOrchestrationDomainEvents";
pub const METHOD_SUBSCRIBE_TERMINAL_EVENTS: &str = "subscribeTerminalEvents";

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum RpcInboundTag {
    Request,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub struct RpcRequest {
    #[serde(rename = "_tag")]
    pub kind: RpcInboundTag,
    pub id: String,
    pub tag: String,
    #[serde(default)]
    pub payload: serde_json::Value,
    #[serde(rename = "traceId", skip_serializing_if = "Option::is_none")]
    pub trace_id: Option<String>,
    #[serde(rename = "spanId", skip_serializing_if = "Option::is_none")]
    pub span_id: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq, Serialize, Deserialize, TS)]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum RpcOutboundTag {
    Chunk,
    Exit,
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "_tag")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum RpcCause {
    Fail { error: serde_json::Value },
    Die { defect: String },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "_tag")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum RpcExit {
    Success { value: serde_json::Value },
    Failure { cause: RpcCause },
}

#[derive(Clone, Debug, PartialEq, Serialize, Deserialize, TS)]
#[serde(tag = "_tag")]
#[ts(export, export_to = "packages/contracts-rust/generated/")]
pub enum RpcServerMessage {
    Chunk {
        #[serde(rename = "requestId")]
        #[ts(rename = "requestId")]
        request_id: String,
        values: Vec<serde_json::Value>,
    },
    Exit {
        #[serde(rename = "requestId")]
        #[ts(rename = "requestId")]
        request_id: String,
        exit: RpcExit,
    },
}

impl RpcServerMessage {
    #[must_use]
    pub fn success(request_id: impl Into<String>, value: serde_json::Value) -> Self {
        Self::Exit {
            request_id: request_id.into(),
            exit: RpcExit::Success { value },
        }
    }

    #[must_use]
    pub fn failure(
        request_id: impl Into<String>,
        message: impl Into<String>,
        detail: Option<serde_json::Value>,
    ) -> Self {
        let mut error = serde_json::json!({ "message": message.into() });
        if let (Some(detail), Some(target)) = (detail, error.as_object_mut()) {
            target.insert("detail".to_owned(), detail);
        }

        Self::Exit {
            request_id: request_id.into(),
            exit: RpcExit::Failure {
                cause: RpcCause::Fail { error },
            },
        }
    }

    #[must_use]
    pub fn chunk(request_id: impl Into<String>, values: Vec<serde_json::Value>) -> Self {
        Self::Chunk {
            request_id: request_id.into(),
            values,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::{RpcInboundTag, RpcRequest, RpcServerMessage};

    #[test]
    fn parses_effect_rpc_request_frames() {
        let raw = serde_json::json!({
            "_tag": "Request",
            "id": "request-1",
            "tag": "server.getConfig",
            "payload": {},
            "traceId": "0123456789abcdef0123456789abcdef",
            "spanId": "0123456789abcdef"
        });

        let request: RpcRequest = serde_json::from_value(raw).expect("request should parse");

        assert_eq!(request.kind, RpcInboundTag::Request);
        assert_eq!(request.id, "request-1");
        assert_eq!(request.tag, "server.getConfig");
        assert_eq!(
            request.trace_id.as_deref(),
            Some("0123456789abcdef0123456789abcdef")
        );
        assert_eq!(request.span_id.as_deref(), Some("0123456789abcdef"));
    }

    #[test]
    fn serializes_success_exit_frames() {
        let frame = RpcServerMessage::success("request-1", serde_json::json!({ "ok": true }));

        let value = serde_json::to_value(frame).expect("frame should serialize");

        assert_eq!(
            value,
            serde_json::json!({
                "_tag": "Exit",
                "requestId": "request-1",
                "exit": {
                    "_tag": "Success",
                    "value": {
                        "ok": true
                    }
                }
            })
        );
    }

    #[test]
    fn serializes_stream_chunk_frames() {
        let frame = RpcServerMessage::chunk(
            "request-1",
            vec![serde_json::json!({
                "version": 1,
                "type": "welcome"
            })],
        );

        let value = serde_json::to_value(frame).expect("frame should serialize");

        assert_eq!(
            value,
            serde_json::json!({
                "_tag": "Chunk",
                "requestId": "request-1",
                "values": [
                    {
                        "version": 1,
                        "type": "welcome"
                    }
                ]
            })
        );
    }
}
