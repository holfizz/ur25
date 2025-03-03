import { AuthService } from '@/auth/auth.service'
import {
	Body,
	Controller,
	HttpException,
	HttpStatus,
	Post,
	UseGuards,
} from '@nestjs/common'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { OfferService } from '../offer/offer.service'
import { TelegramService } from './telegram.service'

@Controller()
export class TelegramController {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly offerService: OfferService,
		private readonly authService: AuthService,
	) {}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN')
	@Post('verify-offer')
	async handleVerifyOffer(@Body('offerId') offerId: string) {
		return await this.offerService.verifyOffer(offerId)
	}

	@UseGuards(JwtAuthGuard, RolesGuard)
	@Roles('ADMIN')
	@Post('reject-offer')
	async handleRejectOffer(@Body('offerId') offerId: string) {
		return await this.offerService.rejectOffer(offerId)
	}

	@Post('approve-contacts')
	async approveContacts(@Body() body: { offerId: string; userId: string }) {
		try {
			const { offerId, userId } = body
			// Здесь логика подтверждения контактов
			return { success: true }
		} catch (error) {
			throw new HttpException(
				'Ошибка при подтверждении контактов',
				HttpStatus.BAD_REQUEST,
			)
		}
	}
}
