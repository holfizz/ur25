import { Injectable } from '@nestjs/common'
import fetch from 'node-fetch'
import { Context, Markup } from 'telegraf'
import { S3Service } from '../../common/services/s3.service'

interface OfferState {
	title?: string
	description?: string
	price?: number // Цена за голову
	quantity?: number // Количество
	breed?: string // Порода
	age?: number // Возраст
	weight?: number // Вес
	location?: string // Регион
	contact?: string // Контактные данные ЛПР
	photos?: Array<{ url: string; key: string }>
}

@Injectable()
export class TelegramOfferService {
	private offerStates: Map<number, OfferState> = new Map()

	constructor(private s3Service: S3Service) {}

	async handlePhotoUpload(ctx: Context, fileUrl: string, userId: number) {
		const state = this.offerStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Сначала начните создание объявления')
			return
		}

		try {
			// Загружаем файл
			const response = await fetch(fileUrl)
			const arrayBuffer = await response.arrayBuffer()
			const buffer = Buffer.from(arrayBuffer)

			// Генерируем уникальное имя файла
			const fileName = `offers/${userId}_${Date.now()}.jpg`

			// Загружаем в S3
			const uploadResult = await this.s3Service.upload(
				buffer,
				fileName,
				'image/jpeg',
			)

			// Добавляем URL в состояние
			if (!state.photos) {
				state.photos = []
			}
			state.photos.push({
				url: uploadResult.url,
				key: fileName,
			})

			this.offerStates.set(userId, state)

			// Если это первое фото, просим пользователя ввести название
			if (state.photos.length === 1) {
				await ctx.reply(
					'Фото успешно загружено! Теперь введите название объявления:',
					Markup.inlineKeyboard([
						[Markup.button.callback('« Отмена', 'cancel_offer')],
					]),
				)
			} else {
				await ctx.reply(
					`✅ Фото добавлено (${state.photos.length}/10)\n\nВы можете добавить еще фото или продолжить заполнение объявления:`,
					Markup.inlineKeyboard([
						[Markup.button.callback('Продолжить ▶️', 'continue_offer')],
						[Markup.button.callback('« Отмена', 'cancel_offer')],
					]),
				)
			}
		} catch (error) {
			console.error('Ошибка при загрузке фото:', error)
			await ctx.reply(
				'❌ Произошла ошибка при загрузке фото. Попробуйте еще раз.',
			)
		}
	}

	// Новый метод для обработки названия объявления
	async handleTitleInput(ctx: Context, userId: number, title: string) {
		const state = this.offerStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Сначала начните создание объявления')
			return
		}

		// Сохраняем название в состоянии
		state.title = title
		this.offerStates.set(userId, state)

		// Здесь вы можете добавить логику для сохранения объявления в базу данных
		await ctx.reply(`✅ Объявление "${title}" успешно создано!`, {
			reply_markup: {
				inline_keyboard: [[Markup.button.callback('« Назад к списку', 'menu')]],
			},
		})

		// Удаляем состояние после завершения
		this.offerStates.delete(userId)
	}

	async handleOfferDetails(ctx: Context, userId: number, details: OfferState) {
		const state = this.offerStates.get(userId)

		if (!state) {
			await ctx.reply('❌ Сначала начните создание объявления')
			return
		}

		// Сохраняем детали в состоянии
		state.price = details.price
		state.quantity = details.quantity
		state.breed = details.breed
		state.age = details.age
		state.weight = details.weight
		state.location = details.location
		state.contact = details.contact

		this.offerStates.set(userId, state)

		// Здесь вы можете добавить логику для сохранения объявления в базу данных
		await ctx.reply(`✅ Объявление успешно создано!`, {
			reply_markup: {
				inline_keyboard: [[Markup.button.callback('« Назад к списку', 'menu')]],
			},
		})

		// Удаляем состояние после завершения
		this.offerStates.delete(userId)
	}
}
