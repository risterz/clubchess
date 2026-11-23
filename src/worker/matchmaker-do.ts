import { DurableObject } from 'cloudflare:workers';
import type { Env } from './env';

export class MatchmakerDO extends DurableObject<Env> {
  async fetch(): Promise<Response> {
    return new Response('Not implemented', { status: 501 });
  }
}
