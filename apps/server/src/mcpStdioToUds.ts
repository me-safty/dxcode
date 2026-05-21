import * as net from "node:net";

export function runMcpStdioToUds(socketPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const socket = net.createConnection(socketPath);
    let settled = false;

    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      if (error) {
        reject(error);
      } else {
        resolve();
      }
    };

    socket.once("connect", () => {
      process.stdin.pipe(socket);
      socket.pipe(process.stdout);
    });
    socket.once("error", finish);
    socket.once("close", (hadError) => {
      if (!hadError) {
        finish();
      }
    });
    process.stdin.once("error", finish);
    process.stdout.once("error", finish);
  });
}
