import { Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { RedisLockService } from './redis-lock.service';
import { CleanupScheduler } from './jobs/cleanup.scheduler';

@Module({
  imports: [ScheduleModule.forRoot()],
  providers: [RedisLockService, CleanupScheduler],
  exports: [RedisLockService],
})
export class SchedulerModule {}
