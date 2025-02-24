import { AuthService } from '@/auth/auth.service'
import {
	Body,
	Controller,
	HttpException,
	HttpStatus,
	Post,
	UseGuards,
} from '@nestjs/common'
import { Command, Ctx, On, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { Message } from 'telegraf/typings/core/types/typegram'
import { JwtAuthGuard } from '../auth/jwt-auth.guard'
import { Roles } from '../auth/roles.decorator'
import { RolesGuard } from '../auth/roles.guard'
import { OfferService } from '../offer/offer.service'
import { TelegramService } from './telegram.service'

@Update()
@Controller()
export class TelegramController {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly offerService: OfferService,
		private readonly authService: AuthService,
	) {}

	@Command('start')
	async handleStart(@Ctx() ctx: Context) {
		await this.telegramService.handleStart(ctx)
	}

	@Command('menu')
	async handleMenu(@Ctx() ctx: Context) {
		await this.telegramService.handleMenu(ctx)
	}

	@On('text')
	async handleMessage(@Ctx() ctx: Context) {
		const message = ctx.message as Message.TextMessage
		console.log('Получено сообщение:', message.text)

		// Проверяем состояние входа
		const loginState = this.authService.getLoginState(ctx.from.id)
		console.log('Состояние входа в контроллере:', loginState)

		if (loginState) {
			await this.authService.handleLoginInput(ctx, message.text)
			return
		}

		await this.telegramService.handleTextInput(ctx)
	}

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
