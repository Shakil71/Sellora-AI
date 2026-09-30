import { Module } from '@nestjs/common';
import { LoggerModule } from 'nestjs-pino';
import { DomainModule } from './domain.module';
import { loggerOptions } from './common/logger';
import { WORKER_PROCESSORS } from './worker.processors';

@Module({
  imports: [LoggerModule.forRoot(loggerOptions('sellora-worker')), DomainModule],
  providers: WORKER_PROCESSORS,
})
export class WorkerModule {}
