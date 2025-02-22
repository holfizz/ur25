export class UserDto {
	email: string
	password: string
	name: string
	phone?: string
	address?: string
	role: 'BUYER' | 'SUPPLIER' | 'CARRIER' // Исключаем 'ADMIN'
}
