#!/usr/bin/env node
// Pequeno adaptador para executar o código escrito para Cloudflare Workers
// em um servidor Express local / dentro de um container Docker.

import express from "express";
import type {
  Request as ExpressRequest,
  Response as ExpressResponse,
} from "express";
import type { IncomingHttpHeaders } from "http";
import pino from "pino";
import pinoHttp from "pino-http";
import worker from './handler.js';
import { env } from './env.js';

// Configura logger
const logger = pino({
  level: env.LOG_LEVEL,
  transport: {
    target: "pino-pretty",
    options: {
      colorize: env.NODE_ENV === "development",
      translateTime: "SYS:standard",
      ignore: "pid,hostname",
      singleLine: true,
    },
  },
});

// Use as implementações nativas se disponíveis, caso contrário, importe do undici
let RequestClass = globalThis.Request as any;
let HeadersClass = (globalThis as any).Headers;

if (!RequestClass || !HeadersClass) {
  const undici = await import("undici");
  RequestClass = undici.Request;
  HeadersClass = undici.Headers;
  if (!globalThis.fetch) {
    (globalThis as any).fetch = undici.fetch;
  }
}

const app = express();

// Middleware de logging HTTP
app.use(
  pinoHttp({
    logger,
    // Desabilita a serialização automática de req/res
    serializers: {
      req: () => undefined,
      res: () => undefined,
    },
    customLogLevel: (_req, res, err) => {
      if (res.statusCode >= 500 || err) return "error";
      if (res.statusCode >= 400) return "warn";
      if (res.statusCode >= 300) return "info";
      return "info";
    },
    customSuccessMessage: (req, res) => {
      return `${req.method} ${req.url} - ${res.statusCode}`;
    },
    customErrorMessage: (req, res, err) => {
      return `${req.method} ${req.url} - ${res.statusCode} - ${err.message}`;
    },
  })
);

const adaptHeaders = (req: ExpressRequest): Headers => {
  const headers = new HeadersClass();
  const reqHeaders: IncomingHttpHeaders = req.headers || {};

  Object.entries(reqHeaders).forEach(([k, v]) => {
    if (Array.isArray(v)) {
      v.forEach((val) => headers.append(k, val));
    } else if (v) {
      headers.set(k, String(v));
    }
  });

  return headers;
};

const handle = async (
  req: ExpressRequest,
  res: ExpressResponse
): Promise<void> => {
  try {
    const protocol =
      (req.headers["x-forwarded-proto"] as string) || req.protocol;
    const host = req.get("host") || `localhost:${env.PORT}`;
    const url = `${protocol}://${host}${req.originalUrl}`;

    req.log.debug({ url, method: req.method }, "Processing OAuth request");

    const headers = adaptHeaders(req);
    const request = new RequestClass(url, { method: req.method, headers });

    // chama o handler escrito para Cloudflare Workers
    const response = await worker.fetch(
      request,
      env
    );

    // propaga headers e status
    response.headers.forEach((value, key) => res.set(key, value));
    res.status(response.status);

    // envia corpo (pode ser vazio)
    const arrayBuffer = await response.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    req.log.debug(
      { statusCode: response.status, size: buffer.length },
      "Response sent"
    );

    res.send(buffer);
  } catch (err) {
    req.log.error({ err }, "Error handling OAuth request");
    res.status(500).send("Internal server error");
  }
};

// Rotas equivalentes às esperadas pelo handler Worker
app.get(
  ["/oauth/auth", "/auth", "/oauth/authorize", "/callback", "/oauth/redirect"],
  handle
);

app.get("/health", (req: ExpressRequest, res: ExpressResponse) => {
  const health = {
    status: "ok",
    timestamp: new Date().toISOString(),
    environment: env.NODE_ENV,
    uptime: process.uptime(),
  };

  req.log.debug(health, "Health check");
  res.status(200).json(health);
});

app.listen(env.PORT, () => {
  const isLocal =
    env.HOST === "localhost" ||
    env.HOST.includes("127.0") ||
    env.HOST.includes("192.168");
  const protocol = isLocal || env.INSECURE_COOKIES === "1" ? "http" : "https";
  const serverUrl = `${protocol}://${env.HOST}:${env.PORT}`;

  logger.info(
    {
      port: env.PORT,
      host: env.HOST,
      nodeEnv: env.NODE_ENV,
      logLevel: env.LOG_LEVEL,
    },
    `Auth server listening on ${serverUrl}`
  );
});
