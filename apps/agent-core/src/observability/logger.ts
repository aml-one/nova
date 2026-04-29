type LogContext = {
  correlationId?: string;
  [key: string]: unknown;
};

export class Logger {
  info(message: string, data?: LogContext): void {
    console.log(
      JSON.stringify({
        level: "info",
        message,
        correlationId: data?.correlationId,
        data,
        at: new Date().toISOString()
      })
    );
  }

  error(message: string, data?: LogContext): void {
    console.error(
      JSON.stringify({
        level: "error",
        message,
        correlationId: data?.correlationId,
        data,
        at: new Date().toISOString()
      })
    );
  }
}
