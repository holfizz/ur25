import { Injectable } from '@nestjs/common'
import { ConfigService } from '@nestjs/config'
import axios from 'axios'

@Injectable()
export class CozeService {
	private readonly apiUrl = 'https://api.coze.com/open_api/v2/chat'

	constructor(private configService: ConfigService) {}

	// Метод для общего общения с ИИ
	async generateResponse(context: string, question: string): Promise<string> {
		console.log('context', context)
		console.log('question', question)
		try {
			// Проверяем размер запроса
			if (context.length > 10000) {
				console.warn(
					`Запрос слишком большой (${context.length} байт), обрезаем до 10000 байт`,
				)
				context = context.substring(0, 10000)
			}

			console.log('Отправляем запрос в Coze API...')
			console.log('Размер контекста:', context.length)
			console.log('Размер вопроса:', question.length)

			const response = await axios.post(
				this.apiUrl,
				{
					bot_id: this.configService.get('COZE_ANALYZER_BOT_ID'),
					user: 'telegram_user',
					query: question,
					stream: false,
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
						Connection: 'keep-alive',
						Accept: '*/*',
					},
				},
			)

			console.log('Получен ответ от Coze API:', response.status)

			if (
				response.data &&
				response.data.messages &&
				response.data.messages.length > 0
			) {
				const answerMessage = response.data.messages.find(
					msg => msg.role === 'assistant' && msg.type === 'answer',
				)

				if (answerMessage) {
					return answerMessage.content
				}

				return response.data.messages[response.data.messages.length - 1].content
			} else {
				console.error('Неверный формат ответа от Coze API:', response.data)
				return 'Извините, не удалось получить ответ от ИИ.'
			}
		} catch (error) {
			this.handleApiError(error)
			return 'Произошла ошибка при обращении к ИИ. Пожалуйста, попробуйте позже.'
		}
	}

	// Метод для анализа объявлений
	async analyzeOffers(data: string): Promise<string> {
		try {
			console.log('Отправляем запрос к Coze API для анализа объявлений')

			// Отправляем запрос к Coze API
			const response = await axios.post(
				this.apiUrl,
				{
					bot_id: this.configService.get('COZE_ANALYZER_BOT_ID'),
					user: 'analyzer_bot', // Идентификатор пользователя
					query: data, // Данные для анализа
					stream: false, // Не использовать потоковую передачу
				},
				{
					headers: {
						Authorization: `Bearer ${this.configService.get('COZE_TOKEN')}`,
						'Content-Type': 'application/json',
						Connection: 'keep-alive',
						Accept: '*/*',
					},
				},
			)

			console.log(`Получен ответ от Coze API: ${response.status}`)
			console.log('Получен ответ от Coze API:', response.data)

			// Проверяем, что ответ содержит данные
			if (
				!response.data ||
				!response.data.messages ||
				!response.data.messages.length
			) {
				console.error('Пустой ответ от Coze API')
				return '{}'
			}

			// Находим ответ с типом 'answer'
			const answerMessage = response.data.messages.find(
				(msg: any) => msg.role === 'assistant' && msg.type === 'answer',
			)

			if (!answerMessage) {
				console.error('Не найден ответ с типом "answer" в ответе Coze API')
				return '{}'
			}

			return answerMessage.content
		} catch (error) {
			console.error('Ошибка при отправке запроса к Coze API:', error)
			return '{}'
		}
	}

	// Вспомогательный метод для обработки ошибок API
	private handleApiError(error: any): void {
		if (error.response) {
			console.error(
				'Ошибка API Coze:',
				error.response.status,
				error.response.data,
			)
		} else if (error.request) {
			console.error('Нет ответа от API Coze:', error.request)
		} else {
			console.error('Ошибка при настройке запроса к Coze API:', error.message)
		}
	}

	// Добавляем метод sendMessage в CozeService
	async sendMessage(prompt: string): Promise<string> {
		try {
			// Используем существующий метод generateResponse
			return await this.generateResponse(
				prompt,
				'Ответь на запрос пользователя',
			)
		} catch (error) {
			console.error('Ошибка при отправке сообщения в Coze:', error)
			return ''
		}
	}
}
