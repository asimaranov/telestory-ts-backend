import { ApiProperty } from '@nestjs/swagger';

export class NodeAccountsStatsDto {
  @ApiProperty({ description: 'Total number of accounts on the node' })
  totalAccounts: number;

  @ApiProperty({ description: 'Number of active accounts' })
  activeAccounts: number;

  @ApiProperty({ description: 'Number of inactive accounts' })
  inactiveAccounts: number;

  @ApiProperty({
    description: 'List of inactive accounts with reasons',
    type: [Object],
  })
  inactiveAccountsDetails: Array<{
    name: string;
    reason: string;
    lastActive: string;
  }>;
}

export class NodeRequestStatsDto {
  @ApiProperty({ description: 'Requests processed in the last hour' })
  requestsLastHour: number;

  @ApiProperty({ description: 'Requests processed in the last day' })
  requestsLastDay: number;

  @ApiProperty({ description: 'Requests processed in the last week' })
  requestsLastWeek: number;

  @ApiProperty({ description: 'Requests processed in the last month' })
  requestsLastMonth: number;

  @ApiProperty({ description: 'Total downloads size in bytes' })
  totalDownloadSize: number;

  @ApiProperty({ description: 'Human readable download size' })
  totalDownloadSizeFormatted: string;
}

export class NodeSystemStatsDto {
  @ApiProperty({ description: 'Total disk space in bytes' })
  totalDiskSpace: number;

  @ApiProperty({ description: 'Free disk space in bytes' })
  freeDiskSpace: number;

  @ApiProperty({ description: 'Free disk space percentage' })
  freeDiskSpacePercent: number;

  @ApiProperty({ description: 'Human readable total disk space' })
  totalDiskSpaceFormatted: string;

  @ApiProperty({ description: 'Human readable free disk space' })
  freeDiskSpaceFormatted: string;

  @ApiProperty({ description: 'Human readable used disk space' })
  usedDiskSpaceFormatted: string;

  @ApiProperty({ description: 'System uptime in seconds' })
  uptime: number;

  @ApiProperty({ description: 'Human readable uptime' })
  uptimeFormatted: string;

  @ApiProperty({ description: 'Total memory in bytes' })
  totalMemory: number;

  @ApiProperty({ description: 'Free memory in bytes' })
  freeMemory: number;

  @ApiProperty({ description: 'Used memory in bytes' })
  usedMemory: number;

  @ApiProperty({ description: 'Human readable total memory' })
  totalMemoryFormatted: string;

  @ApiProperty({ description: 'Human readable free memory' })
  freeMemoryFormatted: string;

  @ApiProperty({ description: 'Human readable used memory' })
  usedMemoryFormatted: string;

  @ApiProperty({ description: 'CPU information', type: [Object] })
  cpus: Array<{
    model: string;
    speed: number;
  }>;
}

export class SingleNodeStatsDto {
  @ApiProperty({ description: 'Node identifier' })
  nodeId: string;

  @ApiProperty({ description: 'Node name' })
  nodeName: string;

  @ApiProperty({ description: 'Node IP address' })
  nodeIp: string;

  @ApiProperty({ description: 'Node API URL' })
  nodeApiUrl: string;

  @ApiProperty({ description: 'Node type (free/premium)' })
  nodeType: 'free' | 'premium';

  @ApiProperty({ description: 'Whether node is active' })
  isActive: boolean;

  @ApiProperty({ description: 'Whether node is approved by master' })
  approvedByMaster: boolean;

  @ApiProperty({ description: 'Last activity timestamp' })
  lastActive: string;

  @ApiProperty({
    description: 'Account statistics',
    type: NodeAccountsStatsDto,
  })
  accountsStats: NodeAccountsStatsDto;

  @ApiProperty({ description: 'Request statistics', type: NodeRequestStatsDto })
  requestStats: NodeRequestStatsDto;

  @ApiProperty({ description: 'System statistics', type: NodeSystemStatsDto })
  systemStats: NodeSystemStatsDto;

  @ApiProperty({ description: 'Whether stats collection was successful' })
  statsCollectionSuccess: boolean;

  @ApiProperty({ description: 'Error message if stats collection failed' })
  statsCollectionError?: string;
}

export class AllNodesStatsDto {
  @ApiProperty({
    description: 'Statistics for all nodes',
    type: [SingleNodeStatsDto],
  })
  nodes: SingleNodeStatsDto[];

  @ApiProperty({ description: 'Summary of all nodes' })
  summary: {
    totalNodes: number;
    activeNodes: number;
    inactiveNodes: number;
    approvedNodes: number;
    totalAccounts: number;
    totalActiveAccounts: number;
    totalRequestsLastDay: number;
    totalRequestsLastWeek: number;
    totalRequestsLastMonth: number;
    totalDiskSpaceUsed: number;
    totalDiskSpaceUsedFormatted: string;
  };

  @ApiProperty({ description: 'Timestamp when stats were collected' })
  collectedAt: string;
}
