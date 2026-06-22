import { Controller, Post, Delete, Body, Param, HttpCode, HttpStatus } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ApiKeyService } from './api-key.service';
import { CreateApiKeyInput } from './dto/create-api-key.input';
import { CurrentUser } from '../../../common/decorators/current-user.decorator';
import { JwtPayload } from '../strategies/jwt.strategy';

@ApiTags('auth')
@Controller('auth/api-keys')
export class ApiKeyController {
  constructor(private readonly apiKeyService: ApiKeyService) {}

  @Post()
  @ApiBearerAuth('access-token')
  @ApiOperation({
    summary: 'Create an API key',
    description: 'Returns the raw key once — it is never shown again. Store it securely.',
  })
  @ApiResponse({ status: 201, description: 'API key created.' })
  async create(@CurrentUser() user: JwtPayload, @Body() dto: CreateApiKeyInput) {
    const { rawKey } = await this.apiKeyService.create(user.sub, dto.scopes ?? []);
    return { apiKey: rawKey };
  }

  @Delete(':id')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiBearerAuth('access-token')
  @ApiOperation({ summary: 'Revoke an API key' })
  @ApiResponse({ status: 204, description: 'API key revoked.' })
  @ApiResponse({ status: 404, description: 'API key not found.' })
  async revoke(@CurrentUser() user: JwtPayload, @Param('id') id: string) {
    await this.apiKeyService.revoke(id, user.sub);
  }
}
