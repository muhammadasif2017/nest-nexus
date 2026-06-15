import { ObjectType, Field, ID } from '@nestjs/graphql';

// This is what the client sees when listing active sessions.
// Notice we expose the deviceId but never the tokenHash — the device
// ID is a non-secret identifier, the hash is a security primitive.
@ObjectType()
export class DeviceSessionOutput {
  @Field(() => ID)
  deviceId!: string;

  @Field({ nullable: true })
  deviceName?: string;

  @Field({ nullable: true })
  userAgent?: string;

  @Field()
  lastUsedAt!: Date;

  @Field()
  createdAt!: Date;

  // Whether this is the session making the current request —
  // useful for the UI to mark "this device" in the list.
  @Field()
  isCurrent!: boolean;
}