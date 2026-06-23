import { ApiProperty } from '@nestjs/swagger';

// This is what the client sees when listing active sessions.
// Notice we expose the deviceId but never the tokenHash — the device
// ID is a non-secret identifier, the hash is a security primitive.
export class DeviceSessionOutput {
  @ApiProperty()
  deviceId!: string;

  @ApiProperty({ required: false })
  deviceName?: string;

  @ApiProperty({ required: false })
  userAgent?: string;

  @ApiProperty()
  lastUsedAt!: Date;

  @ApiProperty()
  createdAt!: Date;

  // Whether this is the session making the current request —
  // useful for the UI to mark "this device" in the list.
  @ApiProperty()
  isCurrent!: boolean;
}
