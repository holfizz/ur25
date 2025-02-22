import { Role } from '@prisma/client'
import {
	IsEmail,
	IsOptional,
	IsString,
	Matches,
	MinLength,
} from 'class-validator'

export class AuthDto {
	@IsEmail({}, { message: 'Некорректный формат email' })
	email: string

	@MinLength(6, {
		message: 'Пароль должен содержать минимум 6 символов',
	})
	@Matches(/^(?=.*[A-Za-z])(?=.*\d)[A-Za-z\d]{6,}$/, {
		message: 'Пароль должен содержать буквы и цифры',
	})
	@IsString()
	password: string
	@IsOptional()
	@IsString()
	name: string

	@IsOptional()
	@IsString()
	phone?: string

	@IsOptional()
	@IsString()
	address?: string

	@IsOptional()
	role?: Role
}
