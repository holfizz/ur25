import { JwtAuthGuard } from '@/auth/jwt-auth.guard'
import { Roles } from '@/auth/roles.decorator'
import { RolesGuard } from '@/auth/roles.guard'
import {
	Body,
	Controller,
	Get,
	Param,
	Patch,
	Post,
	Query,
	UseGuards,
} from '@nestjs/common'
import { ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger'
import { DealService } from './deal.service'
import { CreateDealDto } from './dto/create-deal.dto'
import { UpdateDealDto } from './dto/update-deal.dto'

@ApiTags('Сделки')
@Controller('deals')
export class DealController {
	constructor(private readonly dealService: DealService) {}

	@Post()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN', 'BUYER')
	@ApiOperation({ summary: 'Создание новой сделки' })
	@ApiResponse({ status: 201, description: 'Сделка успешно создана' })
	async create(@Body() createDealDto: CreateDealDto) {
		return this.dealService.create(createDealDto)
	}

	@Get()
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN', 'SUPPLIER', 'BUYER')
	@ApiOperation({ summary: 'Получение списка сделок' })
	@ApiResponse({ status: 200, description: 'Список сделок' })
	async findAll(
		@Query('status') status?: string,
		@Query('userId') userId?: string,
		@Query('offerId') offerId?: string,
		@Query('page') page = '1',
		@Query('limit') limit = '10',
	) {
		return this.dealService.findAll({
			status,
			userId,
			offerId,
			page: parseInt(page),
			limit: parseInt(limit),
		})
	}

	@Get(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN', 'SUPPLIER', 'BUYER')
	@ApiOperation({ summary: 'Получение сделки по ID' })
	@ApiResponse({ status: 200, description: 'Сделка найдена' })
	@ApiResponse({ status: 404, description: 'Сделка не найдена' })
	async findOne(@Param('id') id: string) {
		return this.dealService.findOne(id)
	}

	@Patch(':id/approve')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN', 'SUPPLIER')
	@ApiOperation({ summary: 'Одобрение сделки' })
	@ApiResponse({ status: 200, description: 'Сделка одобрена' })
	@ApiResponse({ status: 404, description: 'Сделка не найдена' })
	async approve(@Param('id') id: string) {
		return this.dealService.updateStatus(id, 'APPROVED')
	}

	@Patch(':id/reject')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN', 'SUPPLIER')
	@ApiOperation({ summary: 'Отклонение сделки' })
	@ApiResponse({ status: 200, description: 'Сделка отклонена' })
	@ApiResponse({ status: 404, description: 'Сделка не найдена' })
	async reject(@Param('id') id: string) {
		return this.dealService.updateStatus(id, 'REJECTED')
	}

	@Patch(':id')
	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN')
	@ApiOperation({ summary: 'Обновление сделки' })
	@ApiResponse({ status: 200, description: 'Сделка обновлена' })
	@ApiResponse({ status: 404, description: 'Сделка не найдена' })
	async update(@Param('id') id: string, @Body() updateDealDto: UpdateDealDto) {
		return this.dealService.update(id, updateDealDto)
	}
}
