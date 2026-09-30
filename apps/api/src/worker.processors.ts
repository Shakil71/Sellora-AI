import type { Provider } from '@nestjs/common';
import { PROCESSORS } from './worker/processors';

/** BullMQ processors run by the worker process. */
export const WORKER_PROCESSORS: Provider[] = [...PROCESSORS];
