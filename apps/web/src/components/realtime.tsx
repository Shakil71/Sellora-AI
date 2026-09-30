'use client';

import * as React from 'react';
import { io, type Socket } from 'socket.io-client';
import { useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import type { Message, Notification } from '@/lib/types';

interface RealtimeValue {
  socket: Socket | null;
  connected: boolean;
}

const RealtimeContext = React.createContext<RealtimeValue>({ socket: null, connected: false });

/**
 * Socket.IO connection authenticated with the session cookie. Incoming events
 * invalidate the affected queries so screens update without page reloads.
 */
export function RealtimeProvider({ workspaceId, children }: { workspaceId: string; children: React.ReactNode }) {
  const qc = useQueryClient();
  const [socket, setSocket] = React.useState<Socket | null>(null);
  const [connected, setConnected] = React.useState(false);

  React.useEffect(() => {
    const url = process.env.NEXT_PUBLIC_SOCKET_URL || undefined;
    const s = io(url ?? window.location.origin, {
      path: '/socket.io',
      withCredentials: true,
      transports: ['websocket', 'polling'],
      reconnectionDelayMax: 10_000,
    });
    setSocket(s);
    s.on('connect', () => setConnected(true));
    s.on('disconnect', () => setConnected(false));
    s.on('unauthorized', () => setConnected(false));

    s.on('message.new', (payload: Message | { conversationId: string; message: Message }) => {
      const conversationId = 'conversationId' in payload && 'message' in payload ? payload.conversationId : (payload as Message).conversationId;
      qc.invalidateQueries({ queryKey: ['messages', conversationId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    });
    s.on('message.status', (p: { conversationId: string }) => qc.invalidateQueries({ queryKey: ['messages', p.conversationId] }));
    s.on('conversation.updated', (p: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', p.id] });
      qc.invalidateQueries({ queryKey: ['conversation-counts'] });
    });
    s.on('order.updated', (p: { id: string }) => {
      qc.invalidateQueries({ queryKey: ['orders'] });
      qc.invalidateQueries({ queryKey: ['order', p.id] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
      qc.invalidateQueries({ queryKey: ['inventory'] });
    });
    s.on('lead.updated', () => {
      qc.invalidateQueries({ queryKey: ['leads'] });
      qc.invalidateQueries({ queryKey: ['dashboard'] });
    });
    s.on('workflow.completed', () => {
      qc.invalidateQueries({ queryKey: ['workflow-runs'] });
      qc.invalidateQueries({ queryKey: ['workflows'] });
    });
    s.on('document.updated', (p: { knowledgeBaseId: string }) => {
      qc.invalidateQueries({ queryKey: ['knowledge-base', p.knowledgeBaseId] });
      qc.invalidateQueries({ queryKey: ['knowledge-bases'] });
    });
    s.on('notification.created', (n: Notification) => {
      qc.invalidateQueries({ queryKey: ['notifications'] });
      toast(n.title, { description: n.body ?? undefined, action: n.link ? { label: 'Open', onClick: () => (window.location.href = n.link!) } : undefined });
    });
    return () => {
      s.removeAllListeners();
      s.disconnect();
    };
  }, [qc, workspaceId]);

  return <RealtimeContext.Provider value={{ socket, connected }}>{children}</RealtimeContext.Provider>;
}

export function useRealtime() {
  return React.useContext(RealtimeContext);
}
