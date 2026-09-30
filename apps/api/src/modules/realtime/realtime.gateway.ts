import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  SubscribeMessage,
  WebSocketGateway,
} from '@nestjs/websockets';
import type { Socket } from 'socket.io';
import { PrismaService } from '../../prisma/prisma.service';
import { TokenService, COOKIE_ACCESS } from '../auth/token.service';
import { AccessService } from '../auth/access.service';
import { REALTIME_EVENTS, REALTIME_PERMISSION_ROOMS, rooms } from './realtime.service';

interface SocketData {
  userId: string;
  tenantId: string;
  name: string;
  permissions: string[];
}

function parseCookies(header?: string): Record<string, string> {
  const out: Record<string, string> = {};
  if (!header) return out;
  for (const part of header.split(';')) {
    const idx = part.indexOf('=');
    if (idx === -1) continue;
    out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Authenticated Socket.IO gateway. Sockets join rooms for their user, their
 * workspace and each permission-scoped stream they are allowed to see.
 */
@WebSocketGateway()
export class RealtimeGateway implements OnGatewayConnection {
  private readonly logger = new Logger(RealtimeGateway.name);

  constructor(
    private readonly tokens: TokenService,
    private readonly access: AccessService,
    private readonly prisma: PrismaService,
  ) {}

  async handleConnection(client: Socket) {
    try {
      const cookies = parseCookies(client.handshake.headers.cookie);
      const token = (client.handshake.auth?.token as string | undefined) ?? cookies[COOKIE_ACCESS];
      if (!token) throw new Error('missing token');
      const payload = this.tokens.verifyAccessToken(token);
      if (!payload.tid) throw new Error('no workspace');
      if (await this.tokens.isSessionRevoked(payload.sid)) throw new Error('revoked');
      const access = await this.access.getAccess(payload.sub, payload.tid);
      if (!access) throw new Error('not a member');
      const user = await this.prisma.user.findUnique({ where: { id: payload.sub }, select: { name: true } });

      const data: SocketData = {
        userId: payload.sub,
        tenantId: payload.tid,
        name: user?.name ?? 'Agent',
        permissions: access.permissions,
      };
      client.data = data;
      await client.join(rooms.user(payload.sub));
      await client.join(rooms.tenant(payload.tid));
      for (const perm of REALTIME_PERMISSION_ROOMS) {
        if (access.permissions.includes(perm)) await client.join(rooms.tenantPermission(payload.tid, perm));
      }
      client.emit('ready', { userId: payload.sub, tenantId: payload.tid });
    } catch (err) {
      this.logger.debug(`Socket rejected: ${(err as Error).message}`);
      client.emit('unauthorized', { message: 'Authentication required' });
      client.disconnect(true);
    }
  }

  @SubscribeMessage('conversation:join')
  async joinConversation(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    const data = client.data as SocketData | undefined;
    if (!data || !body?.conversationId || !UUID_RE.test(body.conversationId)) return { ok: false };
    if (!data.permissions.includes('conversations.view')) return { ok: false };
    const conversation = await this.prisma.conversation.findFirst({
      where: { id: body.conversationId, tenantId: data.tenantId },
      select: { id: true },
    });
    if (!conversation) return { ok: false };
    await client.join(rooms.conversation(conversation.id));
    return { ok: true };
  }

  @SubscribeMessage('conversation:leave')
  async leaveConversation(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string }) {
    if (body?.conversationId) await client.leave(rooms.conversation(body.conversationId));
    return { ok: true };
  }

  /** Agents typing indicator, relayed to other agents viewing the conversation. */
  @SubscribeMessage('typing')
  typing(@ConnectedSocket() client: Socket, @MessageBody() body: { conversationId?: string; typing?: boolean }) {
    const data = client.data as SocketData | undefined;
    if (!data || !body?.conversationId || !client.rooms.has(rooms.conversation(body.conversationId))) return;
    client.to(rooms.conversation(body.conversationId)).emit(REALTIME_EVENTS.TYPING, {
      conversationId: body.conversationId,
      userId: data.userId,
      name: data.name,
      typing: Boolean(body.typing),
    });
  }
}
