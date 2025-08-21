import { Controller, Get } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { NodeStatsService } from './node-stats.service.js';
import {
  AllNodesStatsDto,
  SingleNodeStatsDto,
} from './schema/node-stats.schema.js';

@ApiTags('node-stats')
@Controller('node')
export class NodeStatsController {
  constructor(private readonly nodeStatsService: NodeStatsService) {}

  @Get('stats')
  @ApiOperation({
    summary: 'Get node statistics',
    description:
      'Returns comprehensive statistics for the current node or all nodes (depending on whether this is a master node or regular node)',
  })
  @ApiResponse({
    status: 200,
    description: 'Node statistics retrieved successfully',
    type: SingleNodeStatsDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getNodeStats(): Promise<SingleNodeStatsDto> {
    return this.nodeStatsService.getCurrentNodeStats();
  }

  @Get('stats/all')
  @ApiOperation({
    summary: 'Get all nodes statistics',
    description:
      'Returns comprehensive statistics for all nodes in the system. Available on any node.',
  })
  @ApiResponse({
    status: 200,
    description: 'All nodes statistics retrieved successfully',
    type: AllNodesStatsDto,
  })
  @ApiResponse({
    status: 500,
    description: 'Internal server error',
  })
  async getAllNodesStats(): Promise<AllNodesStatsDto> {
    return this.nodeStatsService.getAllNodesStats();
  }
}
