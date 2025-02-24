import { Command, Ctx, On, Start, Update } from 'nestjs-telegraf'
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

	@Command('register')
	async handleRegisterCommand(@Ctx() ctx: Context) {
		const userId = ctx.from.id
		await this.authService.startRegistration(userId)
		await ctx.reply('Выберите вашу роль для регистрации:', {
			reply_markup: {
				inline_keyboard: [
					[
						{ text: '👤 Покупатель', callback_data: 'role_BUYER' },
						{ text: '🛠 Поставщик', callback_data: 'role_SUPPLIER' },
					],
					[{ text: '🚚 Перевозчик', callback_data: 'role_CARRIER' }],
				],
			},
		})
	}

	@On('text')
	async onText(@Ctx() ctx: Context) {
		const message = ctx.message as Message.TextMessage
		const userId = ctx.from.id

		const offerState = this.offerService.getOfferState(userId)
		if (offerState) {
			// Передаем обработку текста в handleOfferState
			await this.offerService.handleOfferState(ctx, userId, message.text)
			return
		}

		const loginState = this.authService.getLoginState(userId)

		if (loginState) {
			const loginResult = await this.authService.login({
				email: loginState.email,
				password: message.text,
			})

			if (loginResult.success) {
				await this.telegramService.handleMenu(ctx) // Показываем меню
				this.authService.deleteLoginState(userId) // Удаляем состояние входа
			} else {
				await ctx.reply(`❌ ${loginResult.message}`)
			}
			return
		}

		await this.authService.handleTextInput(ctx, message.text)
	}

	@On('callback_query')
	async handleCallbackQuery(@Ctx() ctx: Context) {
		const query = ctx.callbackQuery as CallbackQuery.DataQuery
		await ctx.answerCbQuery()

		const userId = ctx.from.id

		if (query.data === 'create_offer') {
			// Логика для возврата к созданию объявления
			this.offerService.setOfferState(userId, {}) // Сброс состояния
			await ctx.reply(
				'🔙 Вы вернулись к созданию объявления. Пожалуйста, введите название объявления:',
			)
			return
		}

		// Обработка входа
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

		// Обработка выхода
		if (query.data === 'logout') {
			await this.authService.handleLogout(ctx)
			return
		}

		// Обработка действий меню
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
			// Получаем состояние создания объявления
			const offerState = await this.offerService.getOfferState(userId)

			if (!offerState) {
				await ctx.reply('❌ Сначала начните создание объявления')
				return
			}

			// Получаем файл с наилучшим качеством (последний в массиве)
			const photo = photos[photos.length - 1]

			// Получаем информацию о файле
			const file = await ctx.telegram.getFile(photo.file_id)
			const fileUrl = `https://api.telegram.org/file/bot${process.env.TELEGRAM_BOT_TOKEN}/${file.file_path}`

			// Сохраняем фото в S3 и добавляем URL в состояние
			await this.offerService.handlePhotoUpload(ctx, fileUrl, userId)
		} catch (error) {
			console.error('Ошибка при обработке фото:', error)
			await ctx.reply(
				'❌ Произошла ошибка при загрузке фото. Попробуйте еще раз.',
			)
		}
	}
}
