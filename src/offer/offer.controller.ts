import { CurrentUser } from '@/auth/decorators/user.decorator'
import { JwtAuthGuard } from '@/auth/jwt-auth.guard'
import {
	Body,
	Controller,
	Delete,
	Get,
	Param,
	Post,
	Put,
	Query,
	UploadedFiles,
	UseGuards,
	UseInterceptors,
} from '@nestjs/common'
import { FilesInterceptor } from '@nestjs/platform-express'
import { CreateOfferDto } from './dto/create-offer.dto'
import { OfferService } from './offer.service'

@Controller('offers')
export class OfferController {
	constructor(private readonly offerService: OfferService) {}

	@Post()
	@UseGuards(JwtAuthGuard)
	@UseInterceptors(FilesInterceptor('files'))
	async create(
		@CurrentUser('id') userId: string,
		@Body() dto: CreateOfferDto,
		@UploadedFiles() files: Express.Multer.File[],
	) {
		return this.offerService.create(userId, dto, files)
	}

	@Get()
	async findAll(@Query() query: Record<string, string>) {
		return this.offerService.findAll(query)
	}

	@Get(':id')
	async findOne(@Param('id') id: string) {
		return this.offerService.findOne(id)
	}

	@Put(':id')
	@UseGuards(JwtAuthGuard)
	@UseInterceptors(FilesInterceptor('files'))
	async update(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() dto: CreateOfferDto,
		@UploadedFiles() files: Express.Multer.File[],
	) {
		return this.offerService.update(id, userId, dto, files)
	}

	@Delete(':id')
	@UseGuards(JwtAuthGuard)
	async delete(@Param('id') id: string, @CurrentUser('id') userId: string) {
		return this.offerService.delete(id)
	}

	@Post('verify/:id')
	async verifyOffer(@Param('id') id: string) {
		return this.offerService.verifyOffer(id)
	}

	@Post('reject/:id')
	async rejectOffer(@Param('id') id: string) {
		return this.offerService.rejectOffer(id)
	}

	@Get('regions')
	async getRegions() {
		return this.offerService.getRegions()
	}

	@Get('regions-with-count')
	async getRegionsWithCount() {
		return this.offerService.getRegionsWithCount()
	}

	@Get('price-ranges')
	async getPriceRanges() {
		return this.offerService.getPriceRanges()
	}

	@Get('breeds')
	async getBreeds() {
		return this.offerService.getBreeds()
	}

	@Post(':id/request-contacts')
	@UseGuards(JwtAuthGuard)
	async requestContacts(
		@Param('id') id: string,
		@CurrentUser('id') userId: string,
		@Body() data: { message: string },
	) {
		return this.offerService.requestContacts(id, userId, data.message)
	}
}
