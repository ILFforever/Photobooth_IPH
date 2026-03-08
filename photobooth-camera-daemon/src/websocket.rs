//! WebSocket handling for real-time camera events

use hyper_util::rt::TokioIo;
use tokio_tungstenite::tungstenite::Message;
use tokio_tungstenite::WebSocketStream;
use futures_util::{stream::StreamExt, sink::SinkExt};
use tokio::sync::broadcast;

/// Shared state for WebSocket clients
#[derive(Clone)]
pub struct SharedState {
    pub ws_tx: broadcast::Sender<Message>,
}

impl SharedState {
    pub fn new() -> Self {
        let (tx, _) = broadcast::channel(100);
        Self {
            ws_tx: tx,
        }
    }
}

/// Handle WebSocket connection
pub async fn handle_websocket(
    ws_stream: WebSocketStream<TokioIo<hyper::upgrade::Upgraded>>,
    shared_state: SharedState,
) {
    let (mut ws_sender, mut ws_receiver) = ws_stream.split();
    let mut rx = shared_state.ws_tx.subscribe();

    println!("WebSocket client connected");

    // Task to forward broadcast messages to this client
    let send_task = tokio::spawn(async move {
        while let Ok(msg) = rx.recv().await {
            if ws_sender.send(msg).await.is_err() {
                break;
            }
        }
    });

    // Task to handle incoming messages from client (keepalive, control)
    let recv_task = tokio::spawn(async move {
        while let Some(result) = ws_receiver.next().await {
            match result {
                Ok(Message::Close(_)) => break,
                Ok(_) => {}
                Err(e) => {
                    eprintln!("WebSocket error: {}", e);
                    break;
                }
            }
        }
    });

    // Wait for either task to complete
    tokio::select! {
        _ = send_task => {},
        _ = recv_task => {},
    }

    println!("WebSocket client disconnected");
}
