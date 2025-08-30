import { Controller, Body, Post, Get, Param, Query } from '@nestjs/common';
import { TelestoryAccountsService } from './telestory-accounts.service';
import {
  ApiTags,
  ApiOperation,
  ApiBody,
  ApiResponse,
  ApiProperty,
} from '@nestjs/swagger';

export class AddAccountByPhoneDto {
  @ApiProperty({
    description: 'The name of the account for identification',
    example: 'telestory_account_1',
  })
  name: string;

  @ApiProperty({
    description: 'The phone number in international format',
    example: '+1234567890',
  })
  phone: string;
}

export class ConfirmAccountByPhoneDto {
  @ApiProperty({
    description: 'The phone number in international format',
    example: '+1234567890',
  })
  phone: string;

  @ApiProperty({
    description: 'The phone code',
    example: '123456',
  })
  phoneCode: string;
}

@ApiTags('accounts')
@Controller('accounts')
export class RegularNodeAccountsController {
  constructor(
    private readonly regularNodeAccountsService: TelestoryAccountsService,
  ) {}

  @Post('addAccountByPhone')
  @ApiOperation({ summary: 'Add a new account by phone number' })
  @ApiBody({ type: AddAccountByPhoneDto })
  @ApiResponse({ status: 201, description: 'Account successfully created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async addAccountByPhone(@Body() body: AddAccountByPhoneDto) {
    const account = await this.regularNodeAccountsService.addAccountByPhone(
      body.name,
      body.phone,
    );
    return account;
  }

  @Post('confirmAccountByPhone')
  @ApiOperation({ summary: 'Confirm a new account by phone number' })
  @ApiBody({ type: ConfirmAccountByPhoneDto })
  @ApiResponse({ status: 201, description: 'Account successfully created' })
  @ApiResponse({ status: 400, description: 'Bad request' })
  async confirmAccountByPhone(@Body() body: ConfirmAccountByPhoneDto) {
    const account = await this.regularNodeAccountsService.confirmAccountByPhone(
      body.phone,
      body.phoneCode,
    );
    return account;
  }

  @Get()
  @ApiOperation({ summary: 'Get all accounts on this node' })
  @ApiResponse({
    status: 200,
    description: 'Successfully retrieved accounts on node',
    schema: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          _id: { type: 'string' },
          name: { type: 'string' },
          lastActive: { type: 'string', format: 'date-time' },
          isActive: { type: 'boolean' },
          inactiveReason: { type: 'string' },
          type: { type: 'string', enum: ['user', 'bot'] },
          bindNodeId: { type: 'string' },
          createdAt: { type: 'string', format: 'date-time' },
          updatedAt: { type: 'string', format: 'date-time' },
        },
      },
    },
  })
  @ApiResponse({ status: 500, description: 'Internal server error' })
  async getAccountsOnNode() {
    return await this.regularNodeAccountsService.getAccountsOnNode();
  }
}
