// Интерфейс для состояния авторизации
export interface AuthState {
	step: string
	email?: string
	password?: string
	name?: string
	role?: string
	buyerType?: string
}

// Интерфейс для состояния создания объявления
export interface OfferState {
	inputType?: string
	title?: string
	description?: string
	quantity?: number
	weight?: number
	age?: number
	price?: number
	priceType?: string
	location?: string
	photos?: Array<{ url: string }>
	videos?: Array<{ url: string }>
}

// Интерфейс для состояния создания запроса
export interface RequestState {
	inputType?: string
	title?: string
	description?: string
	quantity?: number
	weight?: number
	age?: number
	price?: number
	priceType?: string
	location?: string
}

// Интерфейс для состояния отправки сообщения
export interface MessageState {
	recipientId: string
	chatId?: string
}

// Интерфейс для состояния редактирования профиля
export interface EditState {
	field: 'name' | 'phone' | 'address'
}
