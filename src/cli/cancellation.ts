/** Abort network work on shutdown, letting an active file transaction finish and unlock. */
export async function withCliCancellation<T>(run: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const interrupt = () => {
    process.exitCode = 130;
    controller.abort();
  };
  const terminate = () => {
    process.exitCode = 143;
    controller.abort();
  };
  process.on("SIGINT", interrupt);
  process.on("SIGTERM", terminate);
  try {
    return await run(controller.signal);
  } finally {
    process.off("SIGINT", interrupt);
    process.off("SIGTERM", terminate);
  }
}
