import * as net from "node:net";

export function runMcpStdioToUds(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;

    const cleanup = () => {
      socket.off("connect", onConnect);
      socket.off("error", onSocketError);
      socket.off("close", onSocketClose);
      process.stdin.off("error", onStdinError);
      process.stdin.off("end", onStdinEnd);
      process.stdout.off("error", onStdoutError);
      process.stdin.unpipe(socket);
      socket.unpipe(process.stdout);
    };

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      cleanup();
      if (error) {
        if (!socket.destroyed) {
          socket.destroy();
        }
        reject(error);
        return;
      }
      if (!socket.destroyed) {
        socket.end();
      }
      resolve();
    };

    const fail = (error: Error) => {
      if (settled) return;
      if (!socket.destroyed) {
        socket.destroy();
      }
      finish(error);
    };

    const onConnect = () => {
      process.stdin.pipe(socket);
      socket.pipe(process.stdout);
    };
    const onSocketError = (error: Error) => {
      fail(error);
    };
    const onSocketClose = (hadError: boolean) => {
      if (hadError) {
        finish(new Error(`MCP stdio relay socket closed with an error: ${socketPath}`));
        return;
      }
      finish();
    };
    const onStdinError = (error: Error) => {
      fail(error);
    };
    const onStdoutError = (error: Error) => {
      fail(error);
    };
    const onStdinEnd = () => {
      if (!socket.destroyed) {
        socket.end();
      }
    };

    socket.once("connect", onConnect);
    socket.once("error", onSocketError);
    socket.once("close", onSocketClose);
    process.stdin.once("error", onStdinError);
    process.stdin.once("end", onStdinEnd);
    process.stdout.once("error", onStdoutError);
  });
}
