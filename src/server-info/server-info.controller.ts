import { Controller, Get } from '@nestjs/common';
import {
  ApiTags,
  ApiOperation,
  ApiResponse,
} from '@nestjs/swagger';
import { ServerInfoService } from './server-info.service';
import { ServerInfoResponseDto } from './schema/server-info.schema';

@ApiTags('server-info')
@Controller('server-info')
export class ServerInfoController {
  constructor(private readonly serverInfoService: ServerInfoService) {}

  @Get()
  @ApiOperation({ 
    summary: 'Get server information',
    description: 'Returns comprehensive server information including OS details, IP address, geolocation, and system resources'
  })
  @ApiResponse({ 
    status: 200, 
    description: 'Server information retrieved successfully',
    type: ServerInfoResponseDto
  })
  @ApiResponse({ 
    status: 500, 
    description: 'Internal server error' 
  })
  async getServerInfo(): Promise<ServerInfoResponseDto> {
    return this.serverInfoService.getServerInfo();
  }
}