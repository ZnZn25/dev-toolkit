import type { IncomingMessage, ServerResponse } from 'node:http'

export function handlePingRequest(request: IncomingMessage, response: ServerResponse): boolean
export function createPingMiddleware(): (request: IncomingMessage, response: ServerResponse, next: (error?: Error) => void) => void
