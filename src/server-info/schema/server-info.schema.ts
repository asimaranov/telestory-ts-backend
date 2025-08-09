import { ApiProperty } from '@nestjs/swagger';

export class ServerInfoResponseDto {
  @ApiProperty({
    description: 'Operating system information',
    example: 'darwin',
  })
  os: string;

  @ApiProperty({
    description: 'Operating system platform',
    example: 'darwin',
  })
  platform: string;

  @ApiProperty({
    description: 'Operating system architecture',
    example: 'x64',
  })
  arch: string;

  @ApiProperty({
    description: 'Node.js version',
    example: 'v18.17.0',
  })
  nodeVersion: string;

  @ApiProperty({
    description: 'Server public IP address',
    example: '203.0.113.1',
  })
  ipAddress: string;

  @ApiProperty({
    description: 'Country derived from IP address',
    example: 'United States',
    required: false,
  })
  country?: string;

  @ApiProperty({
    description: 'Country code derived from IP address',
    example: 'US',
    required: false,
  })
  countryCode?: string;

  @ApiProperty({
    description: 'City derived from IP address',
    example: 'New York',
    required: false,
  })
  city?: string;

  @ApiProperty({
    description: 'Region derived from IP address',
    example: 'NY',
    required: false,
  })
  region?: string;

  @ApiProperty({
    description: 'Server uptime in seconds',
    example: 3600,
  })
  uptime: number;

  @ApiProperty({
    description: 'Server uptime in human-readable format',
    example: '1h 0m 0s',
  })
  uptimeHuman: string;

  @ApiProperty({
    description: 'Total memory in bytes',
    example: 17179869184,
  })
  totalMemory: number;

  @ApiProperty({
    description: 'Total memory in human-readable format',
    example: '16.0 GB',
  })
  totalMemoryHuman: string;

  @ApiProperty({
    description: 'Free memory in bytes',
    example: 8589934592,
  })
  freeMemory: number;

  @ApiProperty({
    description: 'Free memory in human-readable format',
    example: '8.0 GB',
  })
  freeMemoryHuman: string;

  @ApiProperty({
    description: 'CPU information',
    example: [
      {
        model: 'Intel(R) Core(TM) i7-9750H CPU @ 2.60GHz',
        speed: 2600,
      },
    ],
  })
  cpus: Array<{
    model: string;
    speed: number;
  }>;
}
