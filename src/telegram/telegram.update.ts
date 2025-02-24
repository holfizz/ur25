import { Action, Ctx, On, Start, Update } from 'nestjs-telegraf'
import { Context } from 'telegraf'
import { CallbackQuery, Message } from 'telegraf/typings/core/types/typegram'
import { TelegramAuthService } from './services/auth.service'
import { TelegramMessageService } from './services/message.service'
import { TelegramOfferService } from './services/offer.service'
import { TelegramProfileService } from './services/profile.service'
import { TelegramRequestService } from './services/request.service'
import { TelegramService } from './telegram.service'

@Update()
export class TelegramUpdate {
	constructor(
		private readonly telegramService: TelegramService,
		private readonly authService: TelegramAuthService,
		private readonly offerService: TelegramOfferService,
		private readonly requestService: TelegramRequestService,
		private readonly messageService: TelegramMessageService,
		private readonly profileService: TelegramProfileService,
	) {}

	@Start()
	async start(@Ctx() ctx: Context) {
		await ctx.reply(
			'👋 Добро пожаловать на нашу площадку для торговли КРС (крупного рогатого скота)! Пожалуйста, выберите действие:',
			{
				reply_markup: {
					inline_keyboard: [
						[
							{ text: '📝 Регистрация', callback_data: 'register' },
							{ text: '🔑 Войти', callback_data: 'login' },
						],
					],
				},
			},
		)
	}

	@Action('register')
	async handleRegisterCommand(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		await this.authService.startRegistration(userId)

		await ctx.reply('Пожалуйста, выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '👤 Покупатель', callback_data: 'role_buyer' },
						{ text: '🛠️ Поставщик', callback_data: 'role_supplier' },
					],
					[{ text: '🚚 Перевозчик', callback_data: 'role_carrier' }],
				],
			},
		})
	}
	@Action('skip_mercury')
	async handleSkipMercury(@Ctx() ctx: Context) {
		console.log('skip_mercury')
		await this.authService.handleSkipMercury(ctx)
	}
	@Action(/role_.*/)
	async handleRoleSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const role = callbackQuery.data.split('_')[1]
		await this.authService.handleRoleSelection(ctx, role)
	}

	@Action(/type_.*/)
	async handleUserTypeSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const userType = callbackQuery.data.split('_')[1]
		await this.authService.handleUserTypeSelection(ctx, userType)
	}

	@Action(/input_.*/)
	async handleInputTypeSelection(@Ctx() ctx: Context) {
		const callbackQuery = ctx.callbackQuery
		//@ts-ignore
		const inputType = callbackQuery.data.split('_')[1]
		await this.authService.setInputType(ctx, inputType)
	}

	@On('text')
	async handleText(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		const state = await this.offerService.getOfferState(userId)

		if (ctx.message && 'text' in ctx.message) {
			if (state && state.inputType === 'title') {
				await this.offerService.handleOfferTitleInput(ctx, ctx.message.text)
			} else {
				await this.authService.handleTextInput(ctx, ctx.message.text)
			}
		}
	}

	@On('callback_query')
	async handleCallbackQuery(@Ctx() ctx: Context) {
		const query = ctx.callbackQuery as CallbackQuery.DataQuery
		await ctx.answerCbQuery()

		const userId = ctx.from.id

		if (query.data === 'create_offer') {
			await this.offerService.startOfferCreation(ctx)
			return
		}

		if (query.data === 'login') {
			const isLoggedIn = await this.authService.isUserLoggedIn(userId)
			if (isLoggedIn) {
				await ctx.reply('❌ Вы уже вошли в систему')
				await this.telegramService.handleMenu(ctx)
				return
			}

			this.authService.setLoginState(userId, {})
			await ctx.reply('📧 Введите ваш email:')
			return
		}

		if (query.data === 'logout') {
			await this.authService.handleLogout(ctx)
			return
		}

		switch (query.data) {
			case 'create_ad':
				await this.offerService.handleCreateOffer(ctx)
				break
			case 'my_ads':
				await this.offerService.showMyOffers(ctx)
				break
			case 'requests':
				await this.requestService.handleRequest(ctx)
				break
			case 'messages':
				await this.messageService.handleMessages(ctx, 1)
				break
			case 'profile':
				await this.profileService.showProfile(ctx)
				break
			case 'help':
				await ctx.reply('ℹ️ Раздел помощи\n\nЗдесь будет информация о помощи.')
				break
			case 'menu':
				await this.telegramService.handleMenu(ctx)
				break
		}
	}

	@On('photo')
	async onPhoto(@Ctx() ctx: Context) {
		const photos = (ctx.message as Message.PhotoMessage).photo
		const userId = ctx.from.id

		try {
			const offerState = await this.offerService.getOfferState(userId)

			if (!offerState) {
				await ctx.reply('❌ Сначала начните создание объявления')
				return
			}

			const photo = photos[photos.length - 1]

			const file = await ctx.telegram.getFile(photo.file_id)
			const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`

			await this.offerService.handlePhotoUpload(ctx, fileUrl, userId)
		} catch (error) {
			console.error('Ошибка при обработке фото:', error)
			await ctx.reply(
				'❌ Произошла ошибка при загрузке фото. Попробуйте еще раз.',
			)
		}
	}
}
