import { Module } from '@nestjs/common';
import { EventEmitterModule } from '@nestjs/event-emitter';

@Module({
  imports: [
    EventEmitterModule.forRoot({
      // wildcard: true enables 'user.*' listeners that catch 'user.updated', 'user.deleted', etc.
      wildcard: true,
      delimiter: '.',
      // global: true makes EventEmitter2 available everywhere without importing this module
      global: true,
      // maxListeners prevents accidental memory leaks from too many subscriptions per event
      maxListeners: 20,
      verboseMemoryLeak: true,
    }),
  ],
})
export class EventsModule {}
