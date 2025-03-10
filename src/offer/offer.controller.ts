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
	async findAll() {
		return this.offerService.findAll()
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
}
